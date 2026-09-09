import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingOperation, validatePrerequisiteValue } from './prerequisite-values.mjs';
import { captureGeneratedTraces, validateGeneratedBinding } from './generated-browser.mjs';
import { SEMANTIC_PROTOCOL, assessSemanticContract } from './semantic-contract.mjs';
import { MODEL_GENERATOR, reviewQualityModel } from './quality-contracts.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saved1267TypedFixture } from './fixtures/saved-1267-typed-prerequisites.mjs';
import { deriveSchedules, validateBehaviorModel } from './behavioral-model.mjs';

test('typed settings produce exact native operations, not prose extraction or silent timezone conversions', () => {
  assert.deepEqual(settingOperation({ type: 'option-label', value: 'At due time' }), { op: 'select', value: 'At due time', controlType: 'option-label' });
  assert.equal(settingOperation({ type: 'datetime-local', value: '2030-01-03T12:00' }).value, '2030-01-03T12:00');
  assert.equal(settingOperation({ type: 'date', value: '2032-02-29' }).op, 'fill');
  for (const value of ['calendar date 2030-01-03', '2030-02-30', '2030-02-29', '2030-13-01']) {
    assert.throws(() => settingOperation({ type: 'date', value }), /invalid_native_date_setting/);
  }
  for (const value of ['2030-01-03T12:00:00Z', '2030-01-03T24:00', '2030-01-03T12:60', '2030-01-03T12:00+00:00']) {
    assert.throws(() => settingOperation({ type: 'datetime-local', value }), /invalid_native_date_setting/);
  }
  assert.throws(() => settingOperation('At due time'), /invalid_typed_setting/);
  assert.throws(() => settingOperation({ type: 'script', value: 'anything' }), /invalid_typed_setting/);
});

test('channel identifiers are closed tokens; legacy strings are not silently upgraded', () => {
  assert.doesNotThrow(() => validatePrerequisiteValue({ kind: 'delivery-channel', value: 'in-page' }));
  assert.throws(() => validatePrerequisiteValue({ kind: 'delivery-channel', value: 'in-app reminder text in the page DOM' }), /unsupported_delivery_channel/);
  assert.throws(() => validatePrerequisiteValue({ kind: 'setting', value: 'category Work selected' }), /invalid_typed_setting/);
  assert.doesNotThrow(() => validatePrerequisiteValue({ kind: 'setting', value: 'category Work selected' }, { typed: false }));
});

test('typed bindings require matching operation, exact value and a later commit step', () => {
  const contract = { actions: [{ id: 'Save' }], observables: [{ id: 'count' }], semantics: { version: SEMANTIC_PROTOCOL,
    scenarioChoices: [{ id: 'offset', kind: 'setting', value: { type: 'option-label', value: 'At due time' } }],
    prerequisites: [{ id: 'configured', kind: 'setting', choiceId: 'offset', actionId: 'Save' }] } };
  const binding = { setup: [], actions: { Save: [{ op: 'select', selector: '#offset', value: 'At due time' }, { op: 'click', selector: '#save' }] },
    observables: { count: { op: 'count', selector: '.item' } }, prerequisites: { configured: { op: 'select', selector: '#offset', value: 'At due time', commitStep: 1 } } };
  assert.equal(validateGeneratedBinding(binding, contract), binding);
  binding.prerequisites.configured.commitStep = 0;
  assert.throws(() => validateGeneratedBinding(binding, contract), /setting_commit_order_invalid/);
  binding.prerequisites.configured.commitStep = 1;
  binding.prerequisites.configured.value = 'Default';
  assert.throws(() => validateGeneratedBinding(binding, contract), /unsupported_scenario_setting/);
  assert.match(MODEL_GENERATOR, /semantic-contract-v2/);
  assert.match(MODEL_GENERATOR, /Reminder offset\/enable choices must be explicit/);
});

test('new semantic admission rejects archived prose rather than interpreting it as an executable setting', () => {
  const contract = { requirements: [{ id: 'required', basis: 'Task', evidenceMode: 'state' }],
    semantics: { version: SEMANTIC_PROTOCOL, scenarioChoices: [{ id: 'setting', kind: 'setting', value: 'calendar date applied on create', reason: 'Diagnostic' }],
      ambiguities: [], prerequisites: [], evidence: [] } };
  assert.equal(assessSemanticContract(contract).reason, 'invalid_typed_setting');
});

test('explicit diagnostic viewports reject invalid dimensions before opening a browser', async () => {
  await assert.rejects(captureGeneratedTraces({ viewport: { width: 0, height: 720 } }), /invalid_browser_viewport/);
  await assert.rejects(captureGeneratedTraces({ viewport: { width: 1280.5, height: 720 } }), /invalid_browser_viewport/);
});

test('saved diagnostic fixture corrects representations without changing archived state transitions or obligations', async (context) => {
  const file = new URL('../../../.tools/study-c/specification-repairs/semantic-1267-repair-v1/task-1267/loop/round-2/proposal.json', import.meta.url);
  let source;
  try { source = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('archived proposal unavailable'); return; } throw error; }
  const prompt = await readFile(new URL('../../../.tools/study-c/five-tasks/task-1267.prompt.txt', import.meta.url), 'utf8');
  const original = JSON.parse(source).model;
  const fixture = saved1267TypedFixture(original);
  validateBehaviorModel(fixture.model, prompt);
  assert.equal(fixture.model.contracts.length, original.contracts.length);
  for (const contract of fixture.model.contracts) {
    const prior = original.contracts.find((item) => item.id === contract.id);
    assert.deepEqual(contract.requirements, prior.requirements);
    assert.deepEqual(contract.state, prior.state);
    assert.deepEqual(contract.invariants, prior.invariants);
    assert.deepEqual(contract.completion, prior.completion);
    assert.deepEqual(contract.actions.map(({ id, enabled, updates }) => ({ id, enabled, updates })), prior.actions.map(({ id, enabled, updates }) => ({ id, enabled, updates })));
    validateGeneratedBinding(fixture.bindings[contract.id], { ...contract, traces: deriveSchedules(contract).traces });
    if (contract.id !== 'record_todo') assert.throws(() => validateGeneratedBinding(fixture.bindings[contract.id], prior), /unsupported_scenario_setting/);
  }
  assert.notEqual(fixture.sourceModelHash, fixture.diagnosticModelHash);
  assert.ok(fixture.changes.some((item) => item.target === 'date_dom' && item.field === 'description'));
  assert.equal(await readFile(file, 'utf8'), source);
});

test('saved browser outcomes retain the mobile block and do not confuse detected mutations with fixture passes', async (context) => {
  const root = new URL('../../../.tools/study-c/typed-prerequisites/', import.meta.url);
  let mobile;
  let desktop;
  try {
    mobile = JSON.parse(await readFile(new URL('1267-offline-v1/summary.json', root), 'utf8'));
    desktop = JSON.parse(await readFile(new URL('1267-category-desktop-v1/summary.json', root), 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') { context.skip('local saved browser results unavailable'); return; } throw error; }
  assert.equal(mobile.status, 'incomplete');
  assert.equal(mobile.controls.filter((item) => item.status === 'passed').length, 3);
  assert.equal(mobile.controls.find((item) => item.contractId === 'category_mgmt').status, 'blocked');
  assert.ok(mobile.mutations.filter((item) => item.id !== 'category-loss').every((item) => item.detected));
  assert.equal(desktop.status, 'passed');
  assert.deepEqual(desktop.testedContractIds, ['category_mgmt']);
  assert.equal(desktop.mutations[0].detected, true);
  for (const summary of [mobile, desktop]) {
    assert.equal(summary.sourceUnchanged, true);
    assert.equal(summary.providerCalls, 0);
    assert.equal(summary.candidatePromoted, false);
  }
});

test('new generated candidates cannot bypass typed rules by returning legacy semantics', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'typed-generation-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const model = { version: 'generated-behavior-v2', contracts: ['First', 'Second'].map((id) => ({ id, semantics: { version: 'semantic-contract-v1' } })) };
  let calls = 0;
  const record = await reviewQualityModel({ task: { id: 'fixture', prompt: 'Record items' }, model, directory, requiredSemanticVersion: SEMANTIC_PROTOCOL,
    client: { generate: async () => { calls++; return { ok: true, text: JSON.stringify({ contracts: model.contracts.map((contract) => ({ id: contract.id, accepted: true, reason: 'Fixture review' })) }) }; } } });
  assert.equal(calls, 1);
  assert.ok(record.structuralReviews.every((item) => item.accepted === false && item.reason === 'new_generation_semantic_version_mismatch'));
  assert.deepEqual(record.model, model);
});