import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectQualityCandidate, evaluateQualityArtifact } from './quality-evidence.mjs';
import { behaviorHash, deriveSchedules } from './behavioral-model.mjs';

const suite = (fail = false) => ({ complete: true, contracts: [{ id: 'Count', status: fail ? 'failed' : 'passed',
  failures: fail ? [{ step: 1, observable: 'count' }] : [], checks: [{ id: 'path-1', actions: ['Add'], status: fail ? 'failed' : 'passed', failures: fail ? [{ step: 1, observable: 'count' }] : [] }] }] });
const critic = (score) => ({ ok: true, score });

test('quality gains never justify losing a passing behavior or reducing evidence', () => {
  assert.equal(selectQualityCandidate({ initial: suite(), candidate: suite(true), initialCritic: critic(70), candidateCritic: critic(90) }).selected, 'initial');
  assert.equal(selectQualityCandidate({ initial: suite(), candidate: { complete: false }, initialCritic: critic(70), candidateCritic: critic(90) }).reason, 'incomplete_behavior_evidence');
  assert.equal(selectQualityCandidate({ initial: suite(), candidate: { complete: true, contracts: [] }, initialCritic: critic(70), candidateCritic: critic(90) }).selected, 'initial');
});

test('candidate can win through behavior or visual improvement without using final ratings', () => {
  assert.equal(selectQualityCandidate({ initial: suite(true), candidate: suite(), initialCritic: critic(70), candidateCritic: critic(70) }).reason, 'fewer_behavior_failures');
  assert.equal(selectQualityCandidate({ initial: suite(), candidate: suite(), initialCritic: critic(70), candidateCritic: critic(75) }).reason, 'development_quality_improved');
  assert.equal(selectQualityCandidate({ initial: suite(), candidate: suite(), initialCritic: critic(70), candidateCritic: critic(70) }).selected, 'initial');
});

test('formal and nonformal arms execute exactly the same graph-derived actions and observations', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'quality-parity-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const contract = { id: 'Count', requirements: [{ statement: 'Count' }], assumptions: [], state: [{ id: 'count', initial: 0, exploreMax: 1 }],
    actions: [{ id: 'Add', enabled: true, updates: { count: { op: 'add', args: [{ var: 'count' }, 1] } } }],
    observables: [{ id: 'count', expression: { var: 'count' } }], invariants: [{ expression: { op: 'gte', args: [{ var: 'count' }, 0] } }] };
  const model = { contracts: [contract] };
  const record = { model, modelHash: behaviorHash(model), grounding: { accepted: true } };
  const executed = [];
  let validations = 0;
  for (const formal of [false, true]) {
    const result = await evaluateQualityArtifact({ record, html: '<html>same</html>', directory: path.join(root, String(formal)), formal,
      bind: async ({ contract, schedule }) => ({ interfaceContract: { ...contract, traces: schedule.traces }, binding: {}, review: { accepted: true } }),
      capture: async ({ contract: spec }) => { executed.push(spec.traces); return spec.traces.map((trace) => ({ ...trace, status: 'recorded', snapshots: [{ count: 0 }, { count: 1 }] })); },
      validate: async () => { validations++; return { level: 'checked', distinctStates: 2 }; } });
    assert.equal(result.status, 'passed', JSON.stringify(result));
  }
  assert.deepEqual(executed[0], executed[1]);
  assert.deepEqual(executed[0], deriveSchedules(contract).traces);
  assert.equal(validations, 2);
});

test('model completion cannot certify uncommitted settings; prefixes and committed settings stay distinct', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'quality-pending-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const contract = { id: 'Date', requirements: [{ statement: 'Set date' }], state: [{ id: 'set', initial: 0, exploreMax: 1 }],
    actions: [{ id: 'Set', enabled: { op: 'eq', args: [{ var: 'set' }, 0] }, updates: { set: 1 } }],
    observables: [{ id: 'set', expression: { var: 'set' } }], invariants: [], completion: { when: { op: 'eq', args: [{ var: 'set' }, 1] } },
    semantics: { version: 'semantic-contract-v2', evidence: [] } };
  for (const name of ['pending', 'committed', 'prefix']) {
    const active = structuredClone(contract);
    if (name === 'prefix') delete active.completion;
    const model = { contracts: [active] };
    const result = await evaluateQualityArtifact({ record: { model, modelHash: behaviorHash(model), grounding: { accepted: true } }, html: '', formal: false,
      directory: path.join(root, name),
      bind: async ({ contract, schedule }) => ({ interfaceContract: { ...contract, traces: schedule.traces }, binding: {}, review: { accepted: true } }),
      capture: async ({ contract }) => contract.traces.map((trace) => ({ ...trace, status: 'recorded', snapshots: [{ set: 0 }, { set: 1 }],
        pendingSettings: name === 'committed' ? {} : { date: { status: 'pending', actionId: 'Set', value: '2030-01-04' } } })) });
    assert.equal(result.status, name === 'pending' ? 'blocked' : 'passed', JSON.stringify(result));
    if (name === 'pending') {
      assert.equal(result.complete, false);
      assert.equal(result.contracts[0].reason, 'completion_has_uncommitted_settings');
      assert.equal(result.contracts[0].checks[0].modelCompletionSatisfied, true);
      assert.equal(result.contracts[0].checks[0].completionSatisfied, false);
    }
  }
});

test('saved binding failures retain their precise cause instead of becoming review rejections', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'quality-binding-failure-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const model = { contracts: [{ id: 'Setting', requirements: [{ statement: 'Set value' }], state: [{ id: 'set', initial: 0, exploreMax: 1 }],
    actions: [{ id: 'Set', enabled: true, updates: { set: 1 } }], observables: [], invariants: [] }] };
  const result = await evaluateQualityArtifact({ record: { model, modelHash: behaviorHash(model), grounding: { accepted: true } }, html: '', formal: false, directory: root,
    bind: async () => ({ review: { accepted: false }, failure: { reason: 'setting_commit_order_invalid', prerequisite: { id: 'date' } } }),
    capture: async () => assert.fail('invalid binding must not execute') });
  assert.equal(result.contracts[0].reason, 'setting_commit_order_invalid');
  assert.equal(result.contracts[0].stage, 'binding');
});