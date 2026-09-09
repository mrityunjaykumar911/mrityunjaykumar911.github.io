import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { MODEL_PROTOCOL, BEHAVIOR_COMPILER_VERSION, behaviorHash } from './behavioral-model.mjs';
import { assessTaskAdjudication, TASK_ADJUDICATION_PROTOCOL } from './task-adjudication.mjs';
import { verifySelectedSpecification } from './selected-specification-browser.mjs';
import { validateSpec } from './tla-oracle.mjs';

const task = { id: 'fixture', prompt: 'Record an item' };
function inputs() {
  const contract = { id: 'Record', requirements: [{ id: 'record', statement: 'Record an item', sourceQuote: task.prompt, basis: 'Explicit task', evidenceMode: 'state' }], assumptions: [],
    state: [{ id: 'count', initial: 0, exploreMax: 1 }], actions: [{ id: 'Save', requirementId: 'record', description: 'Click save', enabled: { op: 'eq', args: [{ var: 'count' }, 0] }, updates: { count: 1 } }],
    observables: [{ id: 'count', requirementId: 'record', description: 'Visible item count', expression: { var: 'count' } }],
    invariants: [{ id: 'valid', requirementId: 'record', description: 'Nonnegative count', expression: { op: 'gte', args: [{ var: 'count' }, 0] } }],
    completion: { when: { op: 'eq', args: [{ var: 'count' }, 1] }, requirementId: 'record', reason: 'Item recorded' },
    semantics: { version: 'semantic-contract-v1', scenarioChoices: [], ambiguities: [], prerequisites: [], evidence: [] } };
  const model = { version: MODEL_PROTOCOL, contracts: [contract, { ...structuredClone(contract), id: 'Second' }] };
  const taskAdjudication = assessTaskAdjudication(task, model, { contracts: model.contracts.map((item) => ({ id: item.id, reason: 'Recording task preserved', dependencies: [],
    requirements: [{ id: 'record', disposition: 'preserves-obligation', taskQuote: task.prompt, rationale: 'Actual count observed after saving' }] })) });
  const source = { model, modelHash: behaviorHash(model), promptHash: behaviorHash(task.prompt), taskAdjudication };
  const selection = { selectedModelHash: source.modelHash, compilerVersion: BEHAVIOR_COMPILER_VERSION, adjudicationProtocol: TASK_ADJUDICATION_PROTOCOL,
    taskValidatedContractIds: ['Record', 'Second'], originalContractCount: 2, selectedContractVersions: Object.fromEntries(model.contracts.map((item) => [item.id, { version: 'fixture', contractHash: behaviorHash(item), dependencyHashes: {} }])) };
  return { task, source, selection };
}
const html = (working) => `<html><body><button id="save" onclick="${working ? "document.querySelector('#count').textContent='1'" : 'void 0'}">Save</button><span id="count">0</span></body></html>`;
const bind = async ({ contract, schedule }) => ({ interfaceContract: { ...contract, traces: schedule.traces }, review: { accepted: true, reason: 'Fixture mapping' },
  binding: { setup: [], actions: { Save: [{ op: 'click', selector: '#save' }] }, observables: { count: { op: 'number', selector: '#count' } } } });
async function directory(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'selected-browser-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('exact selected combination requires real browser observations and TLC before HTML repair guidance', async (context) => {
  const root = await directory(context);
  const args = inputs();
  const validate = (input) => validateSpec(input);
  const working = await verifySelectedSpecification({ ...args, html: html(true), directory: path.join(root, 'working'), bind, validate });
  assert.equal(working.browserGate, 'verified', JSON.stringify(working));
  assert.equal(working.artifactRepairAuthorized, false);
  const broken = await verifySelectedSpecification({ ...args, html: html(false), directory: path.join(root, 'broken'), bind, validate });
  assert.equal(broken.browserGate, 'verified', JSON.stringify(broken));
  assert.equal(broken.artifactRepairAuthorized, true);
  assert.equal(broken.guidance[0].failures[0].step, 1);
  assert.equal(broken.evidence.contracts[0].checks[0].tlc.violatedInvariant, 'SnapshotMatches');
  assert.equal(broken.modelHash, args.selection.selectedModelHash);
  assert.notEqual(broken.artifactHash, working.artifactHash);
});

test('mismatched versions and unavailable joint dependency replay never authorize broad guidance', async (context) => {
  const args = inputs();
  const root = await directory(context);
  const wrong = { ...args.selection, selectedModelHash: 'wrong' };
  await assert.rejects(verifySelectedSpecification({ ...args, selection: wrong, html: html(false), directory: path.join(root, 'wrong') }), /identity_mismatch/);
  args.source.taskAdjudication.contracts[1].dependencies = ['Record'];
  args.selection.selectedContractVersions.Second.dependencyHashes.Record = behaviorHash(args.source.model.contracts[0]);
  const blocked = await verifySelectedSpecification({ ...args, html: html(false), directory: path.join(root, 'dependency'),
    validate: async () => ({ level: 'checked', distinctStates: 2 }),
    bind: async () => { throw new Error('fixture unavailable mapping'); } });
  assert.equal(blocked.artifactRepairAuthorized, false);
  assert.equal(blocked.scopedArtifactRepairAuthorized, false);
  assert.ok(blocked.blockers.some((item) => item.reason === 'joint_dependency_browser_replay_required'));
  assert.equal(blocked.browserGate, 'incomplete');
});