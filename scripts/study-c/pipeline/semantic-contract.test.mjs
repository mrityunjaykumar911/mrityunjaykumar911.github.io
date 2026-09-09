import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEMANTIC_PROTOCOL, assessSemanticContract } from './semantic-contract.mjs';
import { authorQualityModel, reviewQualityModel, eligibleQualityRecord } from './quality-contracts.mjs';
import { MODEL_PROTOCOL, behaviorHash } from './behavioral-model.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function semanticFixture() {
  return { id: 'Changes', requirements: [{ id: 'required', statement: 'Record changes', sourceQuote: 'Record changes', basis: 'The prompt explicitly requests recording changes.', evidenceMode: 'state' }],
    assumptions: [], actions: [{ id: 'Change', requirementId: 'required' }, { id: 'Reload', requirementId: 'required' }],
    observables: [{ id: 'value', requirementId: 'required' }], invariants: [{ id: 'valid', requirementId: 'required' }],
    semantics: { version: SEMANTIC_PROTOCOL, scenarioChoices: [{ id: 'name', kind: 'fresh-name', value: 'StudyItem742', reason: 'Unique diagnostic input, not a required product label.' }],
      prerequisites: [{ id: 'unusedName', kind: 'absent', choiceId: 'name' }], ambiguities: [], evidence: [] } };
}

test('required behavior stays separate from scenario choices and unresolved interpretations', () => {
  const contract = semanticFixture();
  assert.equal(assessSemanticContract(contract).accepted, true);
  contract.actions[0].requirementId = 'name';
  assert.equal(assessSemanticContract(contract).reason, 'scenario_choice_used_as_requirement');
  contract.actions[0].requirementId = 'required';
  contract.semantics.ambiguities.push({ id: 'timing', statement: 'The prompt does not specify exact reminder timing.' });
  assert.equal(assessSemanticContract(contract).reason, 'unresolved_semantic_ambiguity');
});

test('quotation alone and uncheckable scenario settings do not establish semantic admission', () => {
  const contract = semanticFixture();
  delete contract.requirements[0].basis;
  assert.equal(assessSemanticContract(contract).reason, 'requirement_entailment_basis_missing');
  contract.requirements[0].basis = 'Explicit obligation';
  contract.semantics.prerequisites = [];
  assert.equal(assessSemanticContract(contract).reason, 'scenario_prerequisite_missing');
  contract.semantics.scenarioChoices = [{ id: 'offset', kind: 'setting', value: { type: 'option-label', value: 'At due time' }, reason: 'Configured test value.' }];
  assert.equal(assessSemanticContract(contract).reason, 'scenario_prerequisite_missing');
  contract.requirements[0].evidenceMode = 'latest-after-action';
  assert.equal(assessSemanticContract(contract).reason, 'temporal_evidence_missing');
});

test('semantic admission retains rejected contracts in the original denominator despite reviewer approval', () => {
  const contract = semanticFixture();
  contract.state = [{ id: 'count', initial: 0, exploreMax: 1 }];
  contract.actions = [{ id: 'Add', requirementId: 'required', enabled: true, updates: { count: { op: 'add', args: [{ var: 'count' }, 1] } } }];
  const ambiguous = structuredClone(contract);
  ambiguous.id = 'Ambiguous';
  ambiguous.semantics.ambiguities = [{ id: 'unclear', statement: 'Exact reminder timing is unresolved.' }];
  const model = { contracts: [contract, ambiguous] };
  const source = { model, modelHash: behaviorHash(model), semanticProtocol: SEMANTIC_PROTOCOL,
    grounding: { contracts: model.contracts.map((item) => ({ id: item.id, accepted: true, reason: 'fallible reviewer' })) } };
  const before = JSON.stringify(source);
  const scoped = eligibleQualityRecord(source);
  assert.equal(scoped.coverage.generated, 2);
  assert.deepEqual(scoped.coverage.eligibleIds, ['Changes']);
  assert.equal(scoped.coverage.excluded[0].reason, 'unresolved_semantic_ambiguity');
  assert.equal(scoped.coverage.excluded[0].stage, 'semantic-preflight');
  assert.equal(JSON.stringify(source), before);
});

test('authoring preserves malformed contracts as explicit rejections instead of losing the inventory', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'semantic-inventory-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const first = semanticFixture();
  const second = { ...semanticFixture(), id: 'Other' };
  const model = { version: MODEL_PROTOCOL, contracts: [first, second] };
  let calls = 0;
  const record = await authorQualityModel({ task: { id: 'fixture', prompt: 'Record changes' }, directory,
    client: { generate: async () => ({ ok: true, text: JSON.stringify(++calls === 1 ? model : {
      contracts: model.contracts.map((item) => ({ id: item.id, accepted: true, reason: 'fixture reviewer' })) }) }) } });
  assert.equal(calls, 2);
  assert.equal(record.model.contracts.length, 2);
  assert.ok(record.structuralReviews.every((item) => !item.accepted && item.reason === 'invalid_behavior_state'));
  const scoped = eligibleQualityRecord(record);
  assert.equal(scoped.coverage.generated, 2);
  assert.equal(scoped.coverage.eligible, 0);
  assert.equal(scoped.coverage.excluded.length, 2);
});

test('revised models use the same review gates without generating a replacement model', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'semantic-review-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const model = { version: MODEL_PROTOCOL, contracts: [semanticFixture(), { ...semanticFixture(), id: 'Other' }] };
  let calls = 0;
  const record = await reviewQualityModel({ task: { id: 'fixture', prompt: 'Record changes', checklist: 'held out' }, model, directory,
    client: { generate: async ({ purpose, prompt }) => {
      calls++;
      assert.match(purpose, /^quality-grounding-/);
      assert.equal(prompt.includes('held out'), false);
      return { ok: true, text: JSON.stringify({ contracts: model.contracts.map((item) => ({ id: item.id, accepted: true, reason: 'fixture reviewer' })) }) };
    } } });
  assert.equal(calls, 1);
  assert.deepEqual(record.model, model);
  assert.equal(record.modelHash, behaviorHash(model));
  assert.equal(eligibleQualityRecord(record).coverage.eligible, 0);
});

test('single fresh semantic sample retains all four ambiguity rejections and does not claim temporal evidence', async (context) => {
  const sourceFile = new URL('../../../.tools/study-c/completion-validation/semantic-1267-fresh-v1/task-1267/shared-model/model.json', import.meta.url);
  let bytes;
  try { bytes = await readFile(sourceFile, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('fresh semantic run unavailable'); return; } throw error; }
  const source = JSON.parse(bytes);
  const scoped = eligibleQualityRecord(source);
  assert.equal(scoped.coverage.generated, 4);
  assert.equal(scoped.coverage.eligible, 0);
  assert.equal(scoped.coverage.excluded.length, 4);
  assert.ok(scoped.coverage.excluded.every((item) => item.reason === 'unresolved_semantic_ambiguity'));
  assert.equal(source.grounding.contracts.filter((item) => item.accepted).length, 1);
  assert.equal(source.model.contracts.reduce((count, contract) => count + contract.semantics.evidence.length, 0), 0);
  assert.equal(await readFile(sourceFile, 'utf8'), bytes);
});