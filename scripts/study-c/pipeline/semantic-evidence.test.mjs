import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_PROTOCOL, validateBehaviorModel, initialState, transition, completionState, deriveSchedules, compileBehaviorContract, compareBehaviorTrace, observeModel } from './behavioral-model.mjs';
import { SEMANTIC_PROTOCOL } from './semantic-contract.mjs';
import { validateSpec } from './tla-oracle.mjs';

const equal = (name, value) => ({ op: 'eq', args: [{ var: name }, value] });
const contract = {
  id: 'PersistLatest', requirements: [{ id: 'persistence', statement: 'Persist the latest edit after reload', sourceQuote: 'Persist the latest edit after reload', basis: 'Explicit fixture requirement.', evidenceMode: 'latest-after-action' }], assumptions: [],
  state: [{ id: 'value', initial: 0, exploreMax: 2 }],
  actions: [
    { id: 'Create', description: 'Create value 1', requirementId: 'persistence', enabled: equal('value', 0), updates: { value: 1 } },
    { id: 'Edit', description: 'Edit to value 2', requirementId: 'persistence', enabled: equal('value', 1), updates: { value: 2 } },
    { id: 'Reload', description: 'Reload and observe latest value', requirementId: 'persistence', enabled: { op: 'and', args: [{ op: 'gt', args: [{ var: 'value' }, 0] }, { op: 'not', args: [{ evidence: 'latest' }] }] }, updates: {} },
  ],
  observables: [{ id: 'visibleValue', requirementId: 'persistence', description: 'Actual visible value', expression: { var: 'value' } }],
  invariants: [{ id: 'valid', requirementId: 'persistence', description: 'Nonnegative value', expression: { op: 'gte', args: [{ var: 'value' }, 0] } }],
  completion: { when: equal('value', 2), requirementId: 'persistence', reason: 'Latest edited value observed after reload.' },
  semantics: { version: SEMANTIC_PROTOCOL, scenarioChoices: [], ambiguities: [], prerequisites: [],
    evidence: [{ id: 'latest', requirementId: 'persistence', invalidatedBy: ['Create', 'Edit'], establishedBy: 'Reload', observables: ['visibleValue'] }] },
};

test('latest evidence is invalidated by edit; useful early reload ordering remains executable', () => {
  validateBehaviorModel({ version: MODEL_PROTOCOL, contracts: [contract, { ...contract, id: 'Other' }] }, 'Persist the latest edit after reload');
  let state = initialState(contract);
  for (const action of ['Create', 'Reload', 'Edit']) { state = transition(contract, state, action); assert.ok(state); }
  assert.equal(completionState(contract, state), false);
  const prefix = { actions: ['Create', 'Reload', 'Edit'] };
  assert.equal(compareBehaviorTrace(contract, prefix, [{ visibleValue: 0 }, { visibleValue: 1 }, { visibleValue: 1 }, { visibleValue: 2 }]).completionSatisfied, false);
  state = transition(contract, state, 'Reload');
  assert.equal(completionState(contract, state), true);
  const schedules = deriveSchedules(contract);
  assert.equal(schedules.coverage.undeclaredDeadEnds, 0);
  assert.ok(schedules.traces.some((trace) => JSON.stringify(trace.actions.slice(0, 3)) === JSON.stringify(['Create', 'Reload', 'Edit'])));
  assert.ok(schedules.traces.some((trace) => completionState(contract, trace.actions.reduce((current, action) => transition(contract, current, action), initialState(contract)))));
});

test('real TLC agrees on evidence freshness and still rejects stale browser values after reload', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'semantic-evidence-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const check = (name, ...args) => validateSpec({ specDir: path.join(root, name), ...compileBehaviorContract(...args) });
  const model = await check('model', contract);
  assert.equal(model.level, 'checked', JSON.stringify(model));
  const trace = { actions: ['Create', 'Reload', 'Edit', 'Reload'] };
  let state = initialState(contract);
  const snapshots = [observeModel(contract, state)];
  for (const action of trace.actions) { state = transition(contract, state, action); snapshots.push(observeModel(contract, state)); }
  assert.equal(compareBehaviorTrace(contract, trace, snapshots).completionSatisfied, true);
  assert.equal((await check('correct', contract, trace, snapshots)).level, 'checked');
  snapshots[4].visibleValue = 1;
  assert.equal(compareBehaviorTrace(contract, trace, snapshots).status, 'failed');
  assert.equal(compareBehaviorTrace(contract, trace, snapshots).completionSatisfied, false);
  const bad = await check('stale', contract, trace, snapshots);
  assert.equal(bad.violatedInvariant, 'SnapshotMatches');
  assert.equal(bad.counterexample.step, 4);
});

test('saved date failure cannot claim completion with stale evidence; original bytes remain unchanged', async (context) => {
  const sourceFile = new URL('../../../.tools/study-c/completion-validation/completion-1267-fresh-v1/task-1267/shared-model/model.json', import.meta.url);
  let source;
  try { source = await readFile(sourceFile, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('archived generated model unavailable'); return; } throw error; }
  const saved = JSON.parse(source).model.contracts.find((item) => item.id === 'date_setting');
  const diagnostic = { ...saved, semantics: { evidence: [{ id: 'latest', invalidatedBy: ['create_pay_rent', 'edit_pay_rent_date'], establishedBy: 'reload_pay_rent' }] } };
  const actions = ['create_pay_rent', 'reload_pay_rent', 'edit_pay_rent_date'];
  const end = (model) => actions.reduce((state, action) => transition(model, state, action), initialState(model));
  assert.equal(completionState(saved, end(saved)), true);
  assert.equal(completionState(diagnostic, end(diagnostic)), false);
  assert.equal(deriveSchedules(diagnostic).coverage.undeclaredDeadEnds, 1);
  const root = await mkdtemp(path.join(tmpdir(), 'saved-semantic-negative-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = await validateSpec({ specDir: root, ...compileBehaviorContract(diagnostic) });
  assert.equal(result.detail, 'model_deadlock', JSON.stringify(result));
  assert.equal(await readFile(sourceFile, 'utf8'), source);
});