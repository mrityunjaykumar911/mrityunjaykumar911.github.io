import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { behaviorHash, completionState, deriveSchedules, initialState, transition } from './behavioral-model.mjs';
import { runCompletionPreflight } from './completion-preflight.mjs';
import { completionPreflightOptions } from '../run-completion-preflight.mjs';

test('paid preflight requires a single explicit task and safe separate run ID', () => {
  const args = ['--tasks', '1267', '--run-id', 'completion-1267-fresh-v1', '--key-file', 'fixture-key'];
  assert.deepEqual(completionPreflightOptions(args).ids, ['1267']);
  assert.throws(() => completionPreflightOptions([...args, '--modes', 'formal']));
  assert.throws(() => completionPreflightOptions(['--tasks', '1267,1097', '--run-id', 'fresh', '--key-file', 'fixture-key']));
  assert.throws(() => completionPreflightOptions(['--tasks', '1267', '--run-id', '../old', '--key-file', 'fixture-key']));
});

function sourceRecord() {
  const contract = { id: 'Save', state: [{ id: 'saved', initial: 0, exploreMax: 1 }],
    actions: [{ id: 'SaveItem', enabled: { op: 'eq', args: [{ var: 'saved' }, 0] }, updates: { saved: 1 } }],
    observables: [{ id: 'saved', expression: { var: 'saved' } }], invariants: [{ id: 'valid', expression: true }],
    completion: { when: { op: 'eq', args: [{ var: 'saved' }, 1] }, requirementId: 'save', reason: 'Scenario saved' } };
  const model = { contracts: [contract, { ...contract, id: 'Other' }] };
  return { model, modelHash: behaviorHash(model), grounding: { accepted: true,
    contracts: model.contracts.map((item) => ({ id: item.id, accepted: true, reason: 'fixture review' })) } };
}

test('preflight checks every generated contract, including rejected ones, without changing the source', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'completion-preflight-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = sourceRecord();
  source.grounding.contracts[1].accepted = false;
  const before = JSON.stringify(source);
  const order = [];
  const report = await runCompletionPreflight({ task: { id: 'fixture', prompt: 'Save' }, directory,
    author: async () => { order.push('author'); return source; },
    validate: async ({ tla }) => { order.push('validate'); assert.match(tla, /CompletedIdle/); return { level: 'checked', distinctStates: 2 }; } });
  assert.deepEqual(order, ['author', 'validate', 'validate']);
  assert.equal(report.generatedContracts, 2);
  assert.equal(report.checkedFiniteContracts, 2);
  assert.equal(report.coverage.eligible, 1);
  assert.equal(report.modelGate, 'incomplete');
  assert.equal(report.browserGate, 'not-run');
  assert.equal(JSON.stringify(source), before);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'model-checks.json'), 'utf8')).length, 2);
});

test('only complete admitted model evidence passes the model gate; browser and semantic gates stay pending', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'completion-preflight-pass-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const args = { task: { id: 'fixture', prompt: 'Save' }, directory, author: async () => sourceRecord() };
  const passed = await runCompletionPreflight({ ...args, validate: async () => ({ level: 'checked', distinctStates: 2 }) });
  assert.equal(passed.modelGate, 'passed');
  assert.equal(passed.semanticInspection, 'pending');
  const blocked = await runCompletionPreflight({ ...args, validate: async () => ({ level: 'parsed', detail: 'model_deadlock' }) });
  assert.equal(blocked.modelGate, 'incomplete');
  assert.equal(blocked.checkedContracts, 0);
});

test('fresh archived generation declares terminal states but has a date completion-order counterexample', async (context) => {
  const sourceFile = new URL('../../../.tools/study-c/completion-validation/completion-1267-fresh-v1/task-1267/shared-model/model.json', import.meta.url);
  let sourceBytes;
  try { sourceBytes = await readFile(sourceFile, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('local fresh preflight unavailable'); return; } throw error; }
  const source = JSON.parse(sourceBytes);
  assert.equal(source.modelHash, behaviorHash(source.model));
  assert.equal(source.model.contracts.length, 4);
  for (const contract of source.model.contracts) {
    const schedule = deriveSchedules(contract);
    assert.ok(contract.completion);
    assert.equal(schedule.coverage.completedStates, 1);
    assert.equal(schedule.coverage.undeclaredDeadEnds, 0);
    assert.equal(schedule.coverage.frontier, 0);
  }
  const dates = source.model.contracts.find((contract) => contract.id === 'date_setting');
  const actions = ['create_pay_rent', 'reload_pay_rent', 'edit_pay_rent_date'];
  assert.ok(deriveSchedules(dates).traces.some((trace) => JSON.stringify(trace.actions) === JSON.stringify(actions)));
  let state = initialState(dates);
  for (const action of actions) { state = transition(dates, state, action); assert.ok(state); }
  assert.equal(completionState(dates, state), true);
  assert.match(dates.completion.reason, /persistence was checked by reload/);
  assert.equal(source.grounding.contracts.find((review) => review.id === 'date_setting').accepted, false);
  assert.equal(await readFile(sourceFile, 'utf8'), sourceBytes);
});