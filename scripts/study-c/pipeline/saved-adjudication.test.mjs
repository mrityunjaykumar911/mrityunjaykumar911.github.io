import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { adjudicateSavedSamples, removeAssociationForDiagnostic } from './saved-adjudication.mjs';
import { TASK_ADJUDICATION_SYSTEM } from './task-adjudication.mjs';
import { savedAdjudicationOptions } from '../run-saved-adjudication.mjs';

const model = { contracts: [{ id: 'Category', requirements: [{ id: 'associate' }], actions: [{ id: 'Create', description: 'Create associated item' }],
  observables: [{ id: 'association', description: 'Associated item' }] }] };
test('diagnostic mutation changes only action and observation descriptions, never the source or obligations', () => {
  assert.equal(savedAdjudicationOptions(['--phase', 'inspect', '--run-id', 'check']).keyFile, undefined);
  assert.throws(() => savedAdjudicationOptions(['--phase', 'adjudicate', '--run-id', 'check']));
  assert.throws(() => savedAdjudicationOptions(['--phase', 'inspect', '--run-id', '../old']));
  const before = JSON.stringify(model);
  const negative = removeAssociationForDiagnostic(model, { contractId: 'Category', actionId: 'Create', observableId: 'association',
    actionDescription: 'Create an item without assigning a category', observableDescription: 'Count items without inspecting their category' });
  assert.equal(JSON.stringify(model), before);
  assert.deepEqual(negative.contracts[0].requirements, model.contracts[0].requirements);
  assert.notEqual(negative.contracts[0].actions[0].description, model.contracts[0].actions[0].description);
});

test('three same-policy judgments stay blind to labels and stop without retrying malformed evidence', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'saved-adjudication-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const samples = ['first', 'second', 'negative-control'].map((id) => ({ id, model }));
  let calls = 0;
  const result = await adjudicateSavedSamples({ directory, task: { id: 1267, prompt: 'category association', html: 'HIDDEN_HTML' }, samples,
    client: { generate: async ({ system, prompt }) => {
      calls++;
      assert.equal(system, TASK_ADJUDICATION_SYSTEM);
      assert.equal(prompt.includes('negative-control'), false);
      assert.equal(prompt.includes('HIDDEN_HTML'), false);
      return { ok: true, finishReason: 'stop', text: JSON.stringify({ contracts: [{ id: 'Category', dependencies: [], reason: 'fixture',
        requirements: [{ id: 'associate', disposition: 'violates-obligation', taskQuote: calls === 2 ? 'invented' : 'category association', rationale: 'Actual association missing' }] }] }) };
    } } });
  assert.equal(calls, 3);
  assert.equal(result.results[1].reason, 'missing_task_evidence');
  assert.equal(result.results[2].adjudication.contracts[0].accepted, false);
  assert.equal(result.artifactRepairAuthorized, false);
  await assert.rejects(adjudicateSavedSamples({ directory, task: { prompt: 'category association' }, samples, client: {} }), /EEXIST/);
});