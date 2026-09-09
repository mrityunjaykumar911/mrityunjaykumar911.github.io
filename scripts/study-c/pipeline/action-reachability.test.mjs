import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureGeneratedTraces } from './generated-browser.mjs';
import { evaluateQualityArtifact, selectQualityCandidate } from './quality-evidence.mjs';
import { behaviorHash } from './behavioral-model.mjs';
import { bindQualityContract, MAPPING_REVIEW } from './quality-contracts.mjs';

export const reachabilityContract = { id: 'Save', requirements: [{ id: 'save', statement: 'Save an item' }],
  state: [{ id: 'count', initial: 0, exploreMax: 1 }],
  actions: [{ id: 'SaveItem', description: 'Save item', requirementId: 'save', enabled: { op: 'eq', args: [{ var: 'count' }, 0] }, updates: { count: 1 } }],
  observables: [{ id: 'count', description: 'Stored item count', requirementId: 'save', expression: { var: 'count' } }],
  invariants: [{ id: 'valid', requirementId: 'save', description: 'At most one item', expression: { op: 'lte', args: [{ var: 'count' }, 1] } }],
  completion: { when: { op: 'eq', args: [{ var: 'count' }, 1] }, requirementId: 'save', reason: 'Finite save done' } };
const binding = { setup: [], actions: { SaveItem: [{ op: 'click', selector: '#save' }] }, observables: { count: { op: 'number', selector: '#count' } } };
async function directory(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'action-reachability-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('real browser records a unique hidden control but not missing selectors or failed setup as action evidence', async (context) => {
  const root = await directory(context);
  const contract = { ...reachabilityContract, traces: [{ id: 'path-1', actions: ['SaveItem'] }] };
  const html = '<html><body><button id="save" hidden>Save</button><span id="count">0</span></body></html>';
  const [hidden] = await captureGeneratedTraces({ contract, binding, html, outDir: path.join(root, 'hidden') });
  assert.equal(hidden.failedAction.reason, 'control_hidden');
  assert.equal(hidden.failedAction.step, 1);
  const [missing] = await captureGeneratedTraces({ contract, binding, html: html.replace('id="save"', 'id="other"'), outDir: path.join(root, 'missing') });
  assert.equal(missing.failedAction, undefined);
  const [setup] = await captureGeneratedTraces({ contract, binding: { ...binding, setup: [{ op: 'click', selector: '#save' }] }, html, outDir: path.join(root, 'setup') });
  assert.equal(setup.failedAction, undefined);
});

test('reviewed action failures require matching initial observations and preserve prefix checks in candidate selection', async (context) => {
  const root = await directory(context);
  const model = { contracts: [reachabilityContract] };
  const record = { model, modelHash: behaviorHash(model), grounding: { accepted: true } };
  const trace = { id: 'path-1', actions: ['SaveItem'], snapshots: [{ count: 0 }], status: 'blocked', failedAction: {
    actionId: 'SaveItem', step: 1, operationIndex: 0, selector: '#save', op: 'click', matchedElements: 1, visible: false, enabled: true, reason: 'control_hidden' } };
  const args = { record, html: 'fixture', directory: root, formal: false,
    bind: async ({ contract, schedule }) => ({ interfaceContract: { ...contract, traces: schedule.traces }, binding, review: { accepted: true } }), capture: async () => [trace] };
  const failed = await evaluateQualityArtifact(args);
  assert.equal(failed.complete, true);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.contracts[0].failures[0].kind, 'action_unavailable');
  const critic = { ok: true, score: 10 };
  const bad = structuredClone(failed);
  bad.contracts[0].checks[0].observations[0].count = 1;
  assert.equal(selectQualityCandidate({ initial: failed, candidate: bad, initialCritic: critic, candidateCritic: { ok: true, score: 12 } }).reason, 'action_prefix_observation_regression');
  trace.snapshots[0].count = 1;
  const blocked = await evaluateQualityArtifact({ ...args, directory: path.join(root, 'bad-state') });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.contracts[0].reason, 'unverified_action_preceding_state');
});

test('binding generation and review distinguish target fidelity from application reachability', async (context) => {
  const root = await directory(context);
  let calls = 0;
  const result = await bindQualityContract({ contract: reachabilityContract, schedule: { traces: [] }, html: '<button id="save" hidden>Save</button><span id="count">0</span>', directory: root,
    client: { generate: async ({ prompt, system }) => {
      calls++;
      if (calls === 1) assert.match(JSON.parse(prompt).reachabilityRule, /even when CSS hides it/);
      else { assert.equal(system, MAPPING_REVIEW); assert.match(system, /do not reject a unique correct target solely/); }
      return { ok: true, text: JSON.stringify(calls === 1 ? binding : { accepted: true, reason: 'Fixture verifies target semantics; reachability must execute' }) };
    } } });
  assert.equal(calls, 2);
  assert.equal(result.review.accepted, true);
});