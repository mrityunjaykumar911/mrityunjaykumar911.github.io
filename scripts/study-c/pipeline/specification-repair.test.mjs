import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_PROTOCOL, BEHAVIOR_COMPILER_VERSION, behaviorHash } from './behavioral-model.mjs';
import { SEMANTIC_PROTOCOL } from './semantic-contract.mjs';
import { QUALITY_PROTOCOL } from './quality-contracts.mjs';
import { checkRepairProposal, repairLimits, runSpecificationRepair } from './specification-repair.mjs';
import { validateSpec } from './tla-oracle.mjs';
import { specificationRepairOptions } from '../run-specification-repair.mjs';

const task = { id: 'fixture', prompt: 'Record an item', html: 'SECRET_HTML', checklist: 'SECRET_CHECKLIST', score: 99 };
const contract = { id: 'Record', requirements: [{ id: 'record', statement: 'Record an item', sourceQuote: 'Record an item', basis: 'Explicit fixture obligation', evidenceMode: 'state' }], assumptions: [],
  state: [{ id: 'saved', initial: 0, exploreMax: 1 }],
  actions: [{ id: 'Save', description: 'Save item', requirementId: 'record', enabled: { op: 'eq', args: [{ var: 'saved' }, 0] }, updates: { saved: 1 } }],
  observables: [{ id: 'saved', description: 'Recorded item count', requirementId: 'record', expression: { var: 'saved' } }],
  invariants: [{ id: 'valid', description: 'One saved item', requirementId: 'record', expression: { op: 'lte', args: [{ var: 'saved' }, 1] } }],
  semantics: { version: SEMANTIC_PROTOCOL, scenarioChoices: [], prerequisites: [], ambiguities: [], evidence: [] } };
function fixture() {
  const model = { version: MODEL_PROTOCOL, contracts: [structuredClone(contract), { ...structuredClone(contract), id: 'Second' }] };
  return { protocol: QUALITY_PROTOCOL, compilerVersion: BEHAVIOR_COMPILER_VERSION, semanticProtocol: SEMANTIC_PROTOCOL,
    promptHash: behaviorHash(task.prompt), model, modelHash: behaviorHash(model), grounding: { accepted: true,
      contracts: model.contracts.map((item) => ({ id: item.id, accepted: true, reason: 'Fixture review' })) } };
}
function candidate(source) {
  const model = structuredClone(source.model);
  for (const item of model.contracts) item.completion = { when: { op: 'eq', args: [{ var: 'saved' }, 1] }, requirementId: 'record', reason: 'The finite save operation is complete.' };
  return { model, changes: model.contracts.map((item) => ({ contractId: item.id, reason: 'Undeclared finite dead end reported by schedule and TLC.', preservedRequirements: ['record'], ambiguityResolutions: [] })) };
}
const checked = async () => ({ level: 'checked', detail: 'fixture_validation', distinctStates: 2 });
function fakeClient(proposals, { preservation = true, decide, dependencies = () => [] } = {}) {
  const requests = [];
  let generations = 0;
  return { requests, generate: async (request) => {
    requests.push(request);
    assert.equal(request.prompt.includes('SECRET_HTML'), false);
    assert.equal(request.prompt.includes('SECRET_CHECKLIST'), false);
    let output;
    if (request.purpose.startsWith('specification-repair-')) output = proposals[Math.min(generations++, proposals.length - 1)];
    else {
      const input = JSON.parse(request.prompt);
      const model = input.model;
      output = { contracts: model.contracts.map((item) => ({ id: item.id, dependencies: dependencies(item, input.phase), reason: 'Task-grounded fixture audit',
        requirements: item.requirements.map((requirement) => ({ id: requirement.id, taskQuote: task.prompt, rationale: 'Recording remains observable.',
          disposition: decide ? decide(item, input.phase) : preservation ? 'preserves-obligation' : 'violates-obligation' })) })) };
    }
    return { ok: true, text: JSON.stringify(output), finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  } };
}
async function directory(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'specification-repair-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('repair is bounded, generated from diagnostics, independently reviewed and revalidated', async (context) => {
  const source = fixture();
  const before = JSON.stringify(source);
  const proposal = candidate(source);
  const client = fakeClient([proposal]);
  const root = await directory(context);
  const result = await runSpecificationRepair({ task, source, client, directory: root, validate: checked });
  assert.equal(result.status, 'model-admitted');
  assert.equal(result.selectedVersion, 'round-1');
  assert.equal(result.accounting.calls, 3);
  assert.equal(result.originalContractCount, 2);
  assert.equal(result.artifactRepairAuthorized, false);
  assert.equal(JSON.stringify(source), before);
  assert.match(client.requests[0].prompt, /undeclared_model_dead_end/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'original-source.json'), 'utf8')), source);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'selected-source.json'), 'utf8')).model, proposal.model);
  await runSpecificationRepair({ task, source, client, directory: root, validate: checked });
  assert.equal(client.requests.length, 3);
  await assert.rejects(runSpecificationRepair({ task, source, client, directory: root, maxRounds: 1, validate: checked }), /identity_changed/);
});

test('rejected proposal feedback drives the next generated attempt within the limit', async (context) => {
  const source = fixture();
  const bad = candidate(source);
  bad.model.contracts.pop();
  const client = fakeClient([bad, candidate(source)]);
  const result = await runSpecificationRepair({ task, source, client, directory: await directory(context), validate: checked });
  assert.equal(result.rounds[0].reason, 'changed_contract_inventory');
  assert.equal(result.selectedVersion, 'round-2');
  assert.equal(result.accounting.calls, 4);
  assert.match(client.requests[1].prompt, /changed_contract_inventory/);
});

test('task adjudication rejection and exhausted budget cannot promote a passing candidate', async (context) => {
  const source = fixture();
  const client = fakeClient([candidate(source)], { preservation: false });
  const result = await runSpecificationRepair({ task, source, client, directory: await directory(context), maxRounds: 1, validate: checked });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.stopReason, 'repair_round_budget_exhausted');
  assert.equal(result.selectedVersion, 'original');
  assert.equal(result.rounds[0].reason, 'no_task_validated_contract_improvement');
  assert.equal(client.requests.length, 2);
  assert.throws(() => repairLimits(4), /round_limit/);
  const zero = await runSpecificationRepair({ task, source, directory: await directory(context), maxRounds: 0, validate: checked });
  assert.equal(zero.accounting.calls, 0);
});

test('lineage, task-validated behavior and ambiguity explanations remain protected without freezing assumptions', () => {
  const original = fixture().model;
  const check = (proposal, protectedIds = []) => checkRepairProposal({ original, selected: original, proposal, protectedIds });
  const proposal = candidate({ model: original });
  assert.equal(check(proposal, ['Record']).contracts[0].reason, 'changed_passing_contract');
  proposal.model.contracts[0].requirements = [];
  assert.equal(check(proposal).contracts[0].reason, 'changed_requirement_inventory');
  const bound = candidate({ model: original });
  bound.model.contracts[0].state[0].exploreMax = 0;
  assert.equal(check(bound).accepted, true);
  original.contracts[0].semantics.ambiguities = [{ id: 'unknown', statement: 'Unresolved precondition' }];
  const erased = candidate({ model: original });
  erased.model.contracts[0].semantics.ambiguities = [];
  assert.equal(check(erased).contracts[0].reason, 'unexplained_ambiguity_change');
});

test('infrastructure-only failure does not request a semantic repair', async (context) => {
  const source = fixture();
  source.model = candidate(source).model;
  source.modelHash = behaviorHash(source.model);
  const client = fakeClient([]);
  const result = await runSpecificationRepair({ task, source, client, directory: await directory(context),
    validate: async () => ({ level: 'unvalidated', detail: 'java_unavailable', failureKind: 'infrastructure' }) });
  assert.equal(result.stopReason, 'infrastructure_or_unclassified_blocker');
  assert.equal(client.requests.length, 0);
});

test('real TLC feeds deadlock traces to the repair loop and checks the proposed finite scenario', async (context) => {
  const source = fixture();
  const client = fakeClient([candidate(source)]);
  const root = await directory(context);
  const result = await runSpecificationRepair({ task, source, client, directory: root, maxRounds: 1,
    validate: validateSpec });
  assert.equal(result.status, 'model-admitted', JSON.stringify(result));
  const input = JSON.parse(client.requests[0].prompt);
  assert.ok(input.feedback.contracts.every((item) => item.validation.detail === 'model_deadlock'));
  assert.match(input.feedback.contracts[0].toolDiagnostics['tlc.log'].text, /Deadlock reached/);
  assert.ok(result.finalValidation.contracts.every((item) => item.validation.level === 'checked' && item.validation.distinctStates === 2));
  assert.equal(result.accounting.calls, 3);
});

test('interrupted generation is not silently retried and source remains selected', async (context) => {
  const source = fixture();
  const root = await directory(context);
  let calls = 0;
  const client = { generate: async () => { calls++; throw new Error('fixture_transport_failure'); } };
  const result = await runSpecificationRepair({ task, source, client, directory: root, validate: checked });
  assert.equal(result.selectedVersion, 'original');
  assert.equal(result.stopReason, 'repair_generation_unavailable_or_invalid');
  assert.equal(result.accounting.calls, 1);
  await runSpecificationRepair({ task, source, client, directory: root, validate: checked });
  assert.equal(calls, 1);
});

test('saved-source command enforces one task, safe run IDs and explicit bounded rounds', () => {
  const args = ['--tasks', '1267', '--run-id', 'repair-v1', '--key-file', 'fixture', '--source-model', 'source.json'];
  assert.equal(specificationRepairOptions(args).maxRounds, 2);
  assert.equal(specificationRepairOptions([...args, '--max-rounds', '0']).maxCalls, 0);
  assert.throws(() => specificationRepairOptions([...args, '--max-rounds', '99']));
  assert.throws(() => specificationRepairOptions([...args, '--modes', 'formal']));
  assert.throws(() => specificationRepairOptions(args.map((item) => item === '1267' ? '1267,1097' : item)));
  assert.throws(() => specificationRepairOptions(args.map((item) => item === 'repair-v1' ? '../old' : item)));
  assert.equal(specificationRepairOptions([...args, '--artifact', 'saved.html']).artifact, 'saved.html');
  assert.throws(() => specificationRepairOptions([...args, '--max-rounds', '0', '--artifact', 'saved.html']));
});

test('partial progress preserves the denominator and protects the passing contract in the next round', async (context) => {
  const source = fixture();
  const partial = candidate(source);
  delete partial.model.contracts[1].completion;
  partial.changes.pop();
  const complete = candidate(source);
  complete.changes.shift();
  const client = fakeClient([partial, complete]);
  const result = await runSpecificationRepair({ task, source, client, directory: await directory(context), validate: checked });
  assert.equal(result.rounds[0].status, 'selected');
  assert.deepEqual(result.rounds[0].passingAfter, ['Record']);
  assert.equal(result.rounds[0].originalContractCount, 2);
  const secondInput = JSON.parse(client.requests.find((request) => request.purpose === 'specification-repair-fixture-2').prompt);
  assert.deepEqual(secondInput.protectedContractIds, ['Record']);
  assert.equal(result.status, 'model-admitted');
  assert.equal(result.accounting.calls, 6);
});

test('archived semantic rejection becomes repair feedback without modifying or relabeling the source', async (context) => {
  const sourceFile = new URL('../../../.tools/study-c/completion-validation/semantic-1267-fresh-v1/task-1267/shared-model/model.json', import.meta.url);
  let bytes;
  try { bytes = await readFile(sourceFile, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('archived semantic sample unavailable'); return; } throw error; }
  const source = JSON.parse(bytes);
  const prompt = await readFile(new URL('../../../.tools/study-c/five-tasks/task-1267.prompt.txt', import.meta.url), 'utf8');
  let calls = 0;
  const result = await runSpecificationRepair({ task: { id: 1267, prompt }, source, directory: await directory(context), maxRounds: 1, validate: checked,
    client: { generate: async ({ prompt: inputText }) => {
      calls++;
      const input = JSON.parse(inputText);
      assert.equal(input.feedback.coverage.generated, 4);
      assert.equal(input.feedback.coverage.eligible, 0);
      assert.ok(input.feedback.coverage.excluded.every((item) => item.reason === 'unresolved_semantic_ambiguity'));
      assert.equal(input.originalModel.contracts.length, 4);
      return { ok: true, text: JSON.stringify({ model: input.currentModel, changes: [] }), finishReason: 'stop' };
    } } });
  assert.equal(calls, 1);
  assert.equal(result.rounds[0].reason, 'unchanged_repair_candidate');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.originalContractCount, 4);
  assert.equal(result.selectedModelHash, source.modelHash);
  assert.equal(await readFile(sourceFile, 'utf8'), bytes);
});

test('task authority selects a corrected independent contract despite a disputed sibling and rechecks the exact mix', async (context) => {
  const source = fixture();
  const proposal = candidate(source);
  proposal.model.contracts[0].requirements[0].statement = 'Record an item without requiring a particular row layout';
  proposal.model.contracts[0].requirements[0].sourceQuote = 'Record';
  const client = fakeClient([proposal], { decide: (item) => item.id === 'Record' ? 'corrects-unsupported-assumption' : 'violates-obligation' });
  let validations = 0;
  const result = await runSpecificationRepair({ task, source, client, maxRounds: 1, directory: await directory(context),
    validate: async () => { validations++; return checked(); } });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.taskValidatedContractIds, ['Record']);
  assert.deepEqual(result.rounds[0].adoptedIds, ['Record']);
  assert.equal(result.originalContractCount, 2);
  assert.equal(result.finalValidation.coverage.eligible, 1);
  const adjudicationRequests = client.requests.filter((request) => request.purpose.startsWith('specification-adjudication-') || request.purpose.startsWith('specification-combination-'));
  assert.equal(adjudicationRequests.length, 2);
  assert.equal(adjudicationRequests[0].system, adjudicationRequests[1].system);
  const combined = JSON.parse(adjudicationRequests[1].prompt).model;
  assert.deepEqual(combined.contracts[0], proposal.model.contracts[0]);
  assert.deepEqual(combined.contracts[1], source.model.contracts[1]);
  assert.equal(validations, 6);
  assert.equal(result.artifactRepairAuthorized, false);
});

test('task authority rejects combined contradictions and dependent candidates without discarding unrelated progress', async (context) => {
  const source = fixture();
  const proposal = candidate(source);
  const contradictory = fakeClient([proposal], { decide: (item, phase) => phase === 'combination' && item.id === 'Second' ? 'unresolved' : 'preserves-obligation' });
  const result = await runSpecificationRepair({ task, source, client: contradictory, maxRounds: 1, directory: await directory(context), validate: checked });
  assert.equal(result.selectedVersion, 'original');
  assert.equal(result.rounds[0].reason, 'combined_specification_not_validated');
  assert.ok(result.rounds[0].combinationIssues.some((item) => item.contractId === 'Second'));
  const dependent = fakeClient([proposal], { decide: (item) => item.id === 'Second' ? 'unresolved' : 'preserves-obligation',
    dependencies: (item) => item.id === 'Record' ? ['Second'] : [] });
  const blocked = await runSpecificationRepair({ task, source, client: dependent, maxRounds: 1, directory: await directory(context), validate: checked });
  assert.equal(blocked.selectedVersion, 'original');
  assert.ok(blocked.rounds[0].contractDecisions.some((item) => item.reason === 'incompatible_contract_dependency'));
  assert.equal(blocked.accounting.calls, 2);
});

test('task authority local proposal errors do not veto a valid sibling contract', async (context) => {
  const source = fixture();
  const proposal = candidate(source);
  proposal.changes[1].preservedRequirements = [];
  const client = fakeClient([proposal]);
  const result = await runSpecificationRepair({ task, source, client, maxRounds: 1, directory: await directory(context), validate: checked });
  assert.deepEqual(result.taskValidatedContractIds, ['Record']);
  assert.equal(result.rounds[0].scope.contracts[1].reason, 'unjustified_requirement_preservation');
  assert.equal(result.selectedVersion, 'round-1');
});