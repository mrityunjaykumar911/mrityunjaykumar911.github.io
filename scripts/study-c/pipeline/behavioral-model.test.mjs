import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_PROTOCOL, validateBehaviorModel, transition, deriveSchedules, compileBehaviorContract, compareBehaviorTrace } from './behavioral-model.mjs';
import { validateSpec } from './tla-oracle.mjs';

const variable = (name) => ({ var: name });
const operation = (op, ...args) => ({ op, args });
const contract = {
  id: 'ItemCount', requirements: [{ id: 'record', statement: 'Record items', sourceQuote: 'Record items' }], assumptions: [],
  state: [{ id: 'count', initial: 0, exploreMax: 2 }],
  actions: [
    { id: 'Add', description: 'Add one item', requirementId: 'record', enabled: true, updates: { count: operation('add', variable('count'), 1) } },
    { id: 'Delete', description: 'Delete one item', requirementId: 'record', enabled: operation('gt', variable('count'), 0), updates: { count: operation('sub', variable('count'), 1) } },
  ],
  observables: [{ id: 'itemCount', description: 'Visible item count', requirementId: 'record', expression: variable('count') }],
  invariants: [{ id: 'nonnegative', description: 'Count is nonnegative', requirementId: 'record', expression: operation('gte', variable('count'), 0) }],
};

test('generated models validate structurally without task IDs or executable code', () => {
  const model = { version: MODEL_PROTOCOL, contracts: [contract, { ...contract, id: 'Other' }] };
  assert.equal(validateBehaviorModel(model, 'Record items'), model);
  assert.throws(() => validateBehaviorModel(model, 'Different requirement'), /ungrounded/);
  const bad = structuredClone(model);
  bad.contracts[0].actions[0].updates.count = { op: 'eval', args: ['evil()'] };
  assert.throws(() => validateBehaviorModel(bad, 'Record items'));
});

test('preconditions suppress impossible operations; exploration bounds do not cap domain behavior', () => {
  assert.equal(transition(contract, { count: 0 }, 'Delete'), null);
  assert.deepEqual(transition(contract, { count: 99 }, 'Add'), { count: 100 });
  const schedule = deriveSchedules(contract);
  assert.equal(schedule.coverage.discoveredStates, 3);
  assert.equal(schedule.coverage.coveredTransitions, 4);
  assert.ok(schedule.traces.some((trace) => trace.actions.includes('Delete')));
  assert.ok(schedule.traces.every((trace) => trace.actions[0] !== 'Delete'));
  assert.equal(schedule.coverage.exhaustive, false);
});

test('same interpreter detects incorrect observations without a formal tool', () => {
  const trace = { actions: ['Add', 'Add', 'Delete'] };
  assert.equal(compareBehaviorTrace(contract, trace, [{ itemCount: 0 }, { itemCount: 1 }, { itemCount: 2 }, { itemCount: 1 }]).status, 'passed');
  const bad = compareBehaviorTrace(contract, trace, [{ itemCount: 0 }, { itemCount: 1 }, { itemCount: 2 }, { itemCount: 2 }]);
  assert.deepEqual(bad.failures, [{ step: 3, observable: 'itemCount', expected: 1, observed: 2 }]);
});

test('compiled model and per-step replay agree with interpreter under real TLC', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'behavior-compile-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const checked = await validateSpec({ specDir: path.join(root, 'model'), ...compileBehaviorContract(contract) });
  assert.equal(checked.level, 'checked', JSON.stringify(checked));
  for (const [label, values] of [['good', [0, 1, 2]], ['bad', [0, 1, 1]]]) {
    const result = await validateSpec({ specDir: path.join(root, label), ...compileBehaviorContract(contract, { actions: ['Add', 'Add'] }, values.map((itemCount) => ({ itemCount }))) });
    if (label === 'good') assert.equal(result.level, 'checked', JSON.stringify(result));
    else { assert.equal(result.violatedInvariant, 'SnapshotMatches'); assert.equal(result.counterexample.step, 2); }
  }
});