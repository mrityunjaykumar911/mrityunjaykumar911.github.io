import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessTaskAdjudication, TASK_ADJUDICATION_SYSTEM } from './task-adjudication.mjs';
import { chooseContractVersions, dependencyConsistency } from './contract-combination.mjs';
import { behaviorHash } from './behavioral-model.mjs';
import { readFile } from 'node:fs/promises';

const task = { prompt: 'Record items with category association and automatic reminders.' };
const model = { contracts: [{ id: 'Category', requirements: [{ id: 'association' }] }, { id: 'Reminder', requirements: [{ id: 'reminder' }] }] };
function verdict(disposition = 'corrects-unsupported-assumption') {
  return { contracts: [
    { id: 'Category', dependencies: [], reason: 'Association stays measurable without an invented row-layout requirement.',
      requirements: [{ id: 'association', disposition, taskQuote: 'category association', rationale: 'Task requires association, not a particular label placement.' }] },
    { id: 'Reminder', dependencies: [], reason: 'Reminder behavior retained.',
      requirements: [{ id: 'reminder', disposition: 'preserves-obligation', taskQuote: 'automatic reminders', rationale: 'Automatic reminders remain observable.' }] },
  ] };
}

test('task-grounded corrections are distinct from losing an obligation or unresolved interpretation', () => {
  assert.equal(assessTaskAdjudication(task, model, verdict()).contracts[0].accepted, true);
  assert.equal(assessTaskAdjudication(task, model, verdict('violates-obligation')).contracts[0].accepted, false);
  assert.equal(assessTaskAdjudication(task, model, verdict('unresolved')).contracts[0].accepted, false);
  assert.match(TASK_ADJUDICATION_SYSTEM, /NEVER additional requirements/);
  assert.match(TASK_ADJUDICATION_SYSTEM, /identical policy for candidate and combined-model review/);
});

test('unverifiable quotations, missing obligations and hidden dependencies cannot be accepted', () => {
  const review = verdict();
  review.contracts[0].requirements[0].taskQuote = 'same-row category label';
  assert.throws(() => assessTaskAdjudication(task, model, review), /missing_task_evidence/);
  review.contracts[0].requirements = [];
  assert.throws(() => assessTaskAdjudication(task, model, review), /invalid_task_adjudication/);
  const declared = structuredClone(model);
  declared.contracts[1].dependencies = ['Category'];
  assert.deepEqual(assessTaskAdjudication(task, declared, verdict()).contracts[1].dependencies, ['Category']);
});

test('independent accepted contracts survive a disputed sibling, but dependent repairs do not', () => {
  const selected = { contracts: [{ id: 'Record', revision: 0 }, { id: 'Category', revision: 0 }, { id: 'Reminder', revision: 0 }] };
  const candidate = { contracts: selected.contracts.map((contract) => ({ ...contract, revision: 1 })) };
  const adjudication = { contracts: [{ id: 'Record', accepted: true, dependencies: [] }, { id: 'Category', accepted: false, dependencies: [] }, { id: 'Reminder', accepted: true, dependencies: ['Category'] }] };
  const report = { contracts: candidate.contracts.map((contract) => ({ id: contract.id, eligible: true, validation: { level: 'checked' } })) };
  const result = chooseContractVersions({ selected, candidate, adjudication, report, version: 'round-1' });
  assert.deepEqual(result.adoptedIds, ['Record']);
  assert.deepEqual(result.model.contracts.map((contract) => contract.revision), [1, 0, 0]);
  assert.equal(result.model.contracts.length, 3);
  assert.equal(result.decisions[2].reason, 'incompatible_contract_dependency');
  assert.equal(dependencyConsistency(candidate, adjudication, ['Record', 'Reminder']).length, 1);
});

test('a changed dependency cannot silently invalidate a previously selected contract', () => {
  const selected = { contracts: [{ id: 'Record', revision: 0 }, { id: 'Category', revision: 0 }] };
  const candidate = { contracts: [{ id: 'Record', revision: 0 }, { id: 'Category', revision: 1 }] };
  const adjudication = { contracts: candidate.contracts.map((contract) => ({ id: contract.id, accepted: true, dependencies: [] })) };
  const report = { contracts: candidate.contracts.map((contract) => ({ id: contract.id, eligible: true, validation: { level: 'checked' } })) };
  const result = chooseContractVersions({ selected, candidate, adjudication, report, version: 'round-1', trustedIds: ['Record', 'Category'],
    provenance: { Record: { dependencyHashes: { Category: behaviorHash(selected.contracts[1]) } } } });
  assert.deepEqual(result.adoptedIds, []);
  assert.deepEqual(result.model, selected);
});

test('saved same-row rejection is historical evidence, not the new task authority', async (context) => {
  const file = new URL('../../../.tools/study-c/specification-repairs/semantic-1267-repair-v1/task-1267/loop/round-2/decision.json', import.meta.url);
  let bytes;
  try { bytes = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('saved repair unavailable'); return; } throw error; }
  const decision = JSON.parse(bytes);
  const prompt = await readFile(new URL('../../../.tools/study-c/five-tasks/task-1267.prompt.txt', import.meta.url), 'utf8');
  assert.match(decision.preservation.contracts.find((item) => item.id === 'category_mgmt').reason, /same to-do row/);
  assert.equal(prompt.includes('same to-do row'), false);
  const model = decision.proposedModel;
  const review = { contracts: model.contracts.map((contract) => ({ id: contract.id, reason: 'Offline fixture adjudication, not a new live verdict', dependencies: [],
    requirements: contract.requirements.map((requirement) => ({ id: requirement.id, taskQuote: requirement.sourceQuote,
      disposition: contract.id === 'category_mgmt' ? 'corrects-unsupported-assumption' : 'preserves-obligation', rationale: 'The task is authoritative; legacy layout assumptions are not obligations.' })) })) };
  assert.equal(assessTaskAdjudication({ prompt }, model, review).contracts.find((item) => item.id === 'category_mgmt').accepted, true);
  const category = review.contracts.find((item) => item.id === 'category_mgmt');
  category.requirements.find((item) => item.id === 'req_cat_linked').disposition = 'violates-obligation';
  category.requirements.find((item) => item.id === 'req_cat_linked').rationale = 'Removing the actual category association would lose the task obligation.';
  assert.equal(assessTaskAdjudication({ prompt }, model, review).contracts.find((item) => item.id === 'category_mgmt').accepted, false);
  assert.equal(await readFile(file, 'utf8'), bytes);
});