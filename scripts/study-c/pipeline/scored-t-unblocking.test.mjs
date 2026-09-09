import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runQualityTrial } from './quality-trial.mjs';
import { validateSpec } from './tla-oracle.mjs';
import { MODEL_PROTOCOL, behaviorHash } from './behavioral-model.mjs';
import { SEMANTIC_PROTOCOL } from './semantic-contract.mjs';
import { evaluateQualityArtifact } from './quality-evidence.mjs';
import { saved1267TypedFixture } from './fixtures/saved-1267-typed-prerequisites.mjs';

const prompt = 'Record an item with an accessible save control';
function sourceRecord() {
  const contract = { id: 'Save', requirements: [{ id: 'record', statement: prompt, sourceQuote: prompt, basis: 'Explicit fixture task', evidenceMode: 'state' }], assumptions: [],
    state: [{ id: 'count', initial: 0, exploreMax: 1 }], actions: [{ id: 'SaveItem', requirementId: 'record', description: 'Click Save', enabled: { op: 'eq', args: [{ var: 'count' }, 0] }, updates: { count: 1 } }],
    observables: [{ id: 'count', requirementId: 'record', description: 'Recorded item count', expression: { var: 'count' } }],
    invariants: [{ id: 'valid', requirementId: 'record', description: 'No negative count', expression: { op: 'gte', args: [{ var: 'count' }, 0] } }],
    completion: { when: { op: 'eq', args: [{ var: 'count' }, 1] }, requirementId: 'record', reason: 'Saved item is observable' },
    semantics: { version: SEMANTIC_PROTOCOL, scenarioChoices: [], prerequisites: [], evidence: [], ambiguities: [{ id: 'layout', statement: 'The original interpretation assumes a particular button placement.' }] } };
  const model = { version: MODEL_PROTOCOL, contracts: [contract, { ...structuredClone(contract), id: 'SecondSave' }] };
  return { model, modelHash: behaviorHash(model), promptHash: behaviorHash(prompt), semanticProtocol: SEMANTIC_PROTOCOL,
    grounding: { accepted: false, contracts: model.contracts.map((item) => ({ id: item.id, accepted: false, reason: 'Unsupported layout assumption' })) } };
}
const validate = (args) => validateSpec({ ...args, java: path.resolve('.tools/java/jdk-21.0.12.1+1-jre/bin/java.exe') });
const html = (hidden) => `<html><body><button id="save" ${hidden ? 'hidden' : ''} onclick="document.querySelector('#count').textContent='1'">Save</button><span id="count">0</span></body></html>`;

test('scored T repairs a reviewed inaccessible control and reaches held-out scoring only after real browser/TLC regression', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'scored-t-unblocking-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = sourceRecord();
  const candidateModel = structuredClone(source.model);
  for (const contract of candidateModel.contracts) contract.semantics.ambiguities = [];
  let modelCalls = 0;
  let appCalls = 0;
  const ratings = [];
  const summary = await runQualityTrial({ task: { id: 'offline', prompt, checklist: 'HIDDEN_RUBRIC' }, directory, modes: ['formal'], specificationRepairRounds: 1,
    author: async () => source, validate,
    client: { generate: async ({ purpose, prompt: input }) => {
      modelCalls++;
      assert.equal(input.includes('HIDDEN_RUBRIC'), false);
      assert.equal(input.includes('<html>'), false);
      const request = JSON.parse(input);
      const output = purpose.startsWith('specification-repair-') ? { model: candidateModel,
        changes: candidateModel.contracts.map((contract) => ({ contractId: contract.id, reason: 'Remove an unsupported layout interpretation; retain accessible recording.',
          preservedRequirements: ['record'], ambiguityResolutions: [{ id: 'layout', disposition: 'non-goal', reason: 'Task requires access, not a particular placement.' }] })) }
        : { contracts: request.model.contracts.map((contract) => ({ id: contract.id, dependencies: [], reason: 'Task obligation retained', requirements: [{ id: 'record',
          disposition: 'corrects-unsupported-assumption', taskQuote: prompt, rationale: 'Required control access remains measurable without arbitrary layout.' }] })) };
      return { ok: true, finishReason: 'stop', text: JSON.stringify(output) };
    } },
    bind: async ({ contract, schedule }) => ({ interfaceContract: { ...contract, traces: schedule.traces }, review: { accepted: true, reason: 'Fixture reviewed mapping' },
      binding: { setup: [], actions: { SaveItem: [{ op: 'click', selector: '#save' }] }, observables: { count: { op: 'number', selector: '#count' } } } }),
    produce: async ({ prompt: repairPrompt }) => {
      appCalls++;
      if (repairPrompt) { assert.match(repairPrompt, /control_hidden/); assert.match(repairPrompt, /action_unavailable/); assert.equal(repairPrompt.includes('HIDDEN_RUBRIC'), false); }
      const content = html(!repairPrompt);
      return { html: content, answer: content, htmlHash: behaviorHash(content) };
    }, critique: async () => ({ ok: true, score: 14, issues: [] }),
    finalJudge: async ({ artifact }) => {
      const lock = JSON.parse(await readFile(path.join(directory, 'selections-locked.json'), 'utf8'));
      assert.equal(lock.reports.formal.decision.selected, 'candidate');
      assert.equal(lock.reports.formal.candidateEvidence.status, 'passed');
      ratings.push(artifact.htmlHash);
      return { ok: true, score: 50, origin: 'deterministic scoring fixture, not benchmark evidence' };
    },
  });
  assert.equal(modelCalls, 3);
  assert.equal(appCalls, 2);
  assert.equal(ratings.length, 2);
  assert.equal(summary.status, 'complete', JSON.stringify(summary));
  assert.equal(summary.reports.formal.decision.selected, 'candidate');
  assert.equal(summary.reports.formal.assessment.contracts[0].failures[0].kind, 'action_unavailable');
  assert.equal(summary.reports.formal.assessment.contracts[0].checks[0].tlc.level, 'checked');
  assert.equal(summary.reports.formal.candidateEvidence.contracts[0].checks[0].tlc.level, 'checked');
  assert.equal(summary.scores.formal.scoreSource, 'formal');
  assert.notEqual(summary.scores.formal.artifactHash, summary.scores.initial.artifactHash);
});

test('saved 1267 hidden category control becomes explicit repair evidence without changing the mobile viewport or artifact', async (context) => {
  const artifactPath = new URL('../../../.tools/study-c/quality-runs/quality-v3-1267-T-1gb-first/task-1267/initial/desktop/html_desktop.html', import.meta.url);
  const proposalPath = new URL('../../../.tools/study-c/specification-repairs/semantic-1267-repair-v1/task-1267/loop/round-2/proposal.json', import.meta.url);
  let saved;
  let proposal;
  try { [saved, proposal] = await Promise.all([readFile(artifactPath, 'utf8'), readFile(proposalPath, 'utf8')]); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('local archived evidence unavailable'); return; } throw error; }
  const fixture = saved1267TypedFixture(JSON.parse(proposal).model);
  const model = { ...fixture.model, contracts: fixture.model.contracts.filter((contract) => contract.id === 'category_mgmt') };
  const directory = await mkdtemp(path.join(tmpdir(), 'saved-category-reachability-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const evidence = await evaluateQualityArtifact({ record: { model, modelHash: behaviorHash(model), grounding: { accepted: true } }, html: saved, directory,
    formal: true, validate, bind: async ({ contract, schedule }) => ({ interfaceContract: { ...contract, traces: schedule.traces }, binding: fixture.bindings.category_mgmt,
      review: { accepted: true, reason: 'Manually inspected diagnostic mapping, not a generated review' } }) });
  assert.equal(evidence.status, 'failed', JSON.stringify(evidence));
  const failure = evidence.contracts[0].failures[0];
  assert.equal(failure.kind, 'action_unavailable');
  assert.equal(failure.browserEvidence.selector, '#addCatBtn');
  assert.equal(failure.browserEvidence.visible, false);
  assert.equal(failure.step, 1);
  assert.equal(evidence.contracts[0].checks[0].tlc.level, 'checked');
  assert.equal(saved, await readFile(artifactPath, 'utf8'));
  assert.equal(proposal, await readFile(proposalPath, 'utf8'));
});