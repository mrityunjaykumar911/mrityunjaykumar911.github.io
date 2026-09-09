import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureGeneratedTraces, validateGeneratedBinding } from './generated-browser.mjs';

const html = `<html><body><input id="date" type="date"><button id="save" onclick="document.querySelector('#stored').textContent=document.querySelector('#date').value">Save</button><span id="stored"></span></body></html>`;
function fixture(actions = ['Set', 'Save']) {
  return { contract: { actions: [{ id: 'Set' }, { id: 'Save' }, { id: 'Overwrite' }, { id: 'Reload' }], observables: [{ id: 'stored' }], traces: [{ id: 'trace', actions }],
    semantics: { version: 'semantic-contract-v2', scenarioChoices: [{ id: 'date', kind: 'setting', value: { type: 'date', value: '2030-01-04' } }],
      prerequisites: [{ id: 'dateSet', kind: 'setting', choiceId: 'date', actionId: 'Set' }] } },
    binding: { setup: [], actions: { Set: [{ op: 'fill', selector: '#date', value: '2030-01-04' }], Save: [{ op: 'click', selector: '#save' }],
      Overwrite: [{ op: 'fill', selector: '#date', value: '2030-01-05' }], Reload: [{ op: 'reload' }] },
      observables: { stored: { op: 'textIncludes', selector: '#stored', text: '2030-01-04' } },
      prerequisites: { dateSet: { op: 'fill', selector: '#date', value: '2030-01-04', commitActionId: 'Save', commitStep: 0 } } } };
}

test('explicit cross-action commit reference is validated without guessing invalid legacy targets', () => {
  const { contract, binding } = fixture();
  assert.equal(validateGeneratedBinding(binding, contract), binding);
  delete binding.prerequisites.dateSet.commitActionId;
  assert.throws(() => validateGeneratedBinding(binding, contract), /setting_commit_order_invalid/);
  binding.prerequisites.dateSet.commitActionId = 'Unknown';
  assert.throws(() => validateGeneratedBinding(binding, contract), /setting_commit_order_invalid/);
});

test('browser tracks cross-action setting commits, overwrites, reload invalidation and incomplete prefixes', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'replay-closure-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = async (name, actions) => (await captureGeneratedTraces({ ...fixture(actions), html, outDir: path.join(root, name) }))[0];
  const correct = await run('correct', ['Set', 'Save']);
  assert.equal(correct.status, 'recorded', JSON.stringify(correct));
  assert.deepEqual(correct.snapshots, [{ stored: 0 }, { stored: 0 }, { stored: 1 }]);
  assert.ok(correct.prerequisiteChecks.some((item) => item.status === 'verified-before-commit' && item.actionId === 'Save' && item.settingActionId === 'Set'));
  assert.deepEqual(correct.pendingSettings, {});
  const overwritten = await run('overwrite', ['Set', 'Overwrite', 'Save']);
  assert.equal(overwritten.reason, 'scenario_setting_not_applied_at_commit');
  const reload = await run('reload', ['Set', 'Reload', 'Save']);
  assert.equal(reload.reason, 'scenario_setting_not_configured_for_commit');
  const prefix = await run('prefix', ['Save', 'Set']);
  assert.equal(prefix.status, 'recorded');
  assert.equal(prefix.pendingSettings.dateSet.status, 'pending');
  assert.equal(prefix.prerequisiteChecks.some((item) => item.status === 'verified-before-commit'), false);
});

test('real pointer interception keeps contextual evidence and is not mislabeled as an application failure', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'replay-modal-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const contract = { actions: [{ id: 'Open' }, { id: 'Save' }], observables: [{ id: 'saved' }], traces: [{ id: 'modal', actions: ['Open', 'Save'] }] };
  const binding = { setup: [], actions: { Open: [{ op: 'click', selector: '#open' }], Save: [{ op: 'click', selector: '#save' }] },
    observables: { saved: { op: 'count', selector: '.saved' } } };
  const html = '<html><body><button id="open" onclick="document.querySelector(\'#overlay\').style.display=\'block\'">Open</button><button id="save">Save</button><div id="overlay" style="display:none;position:fixed;inset:0;background:white;z-index:9"></div></body></html>';
  const [trace] = await captureGeneratedTraces({ contract, binding, html, outDir: root });
  assert.equal(trace.status, 'blocked');
  assert.equal(trace.reason, 'control_intercepted', JSON.stringify(trace));
  assert.equal(trace.diagnostic.actionId, 'Save');
  assert.equal(trace.diagnostic.operationIndex, 0);
  assert.equal(trace.diagnostic.interception.interceptor.id, 'overlay');
  assert.equal(trace.failedAction, undefined);
  assert.match(trace.diagnostic.message, /intercepts pointer events/);
  assert.ok(trace.diagnosticScreenshot);
});

test('explicit UI context routing preserves observations and cannot save work as a hidden setup step', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'context-routing-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const contract = { actions: [{ id: 'Save' }], observables: [{ id: 'count' }], traces: [{ id: 'trace', actions: ['Save'] }] };
  const html = '<html><body><button id="save" onclick="document.querySelector(\'#count\').textContent=1">Save</button><span id="count">0</span><div id="modal" style="position:fixed;inset:0;background:white"><button id="close" onclick="document.querySelector(\'#modal\').hidden=true;document.querySelector(\'#modal\').style.display=\'none\'">Close</button></div></body></html>';
  const binding = { setup: [], actions: { Save: [{ op: 'click', selector: '#save' }] }, observables: { count: { op: 'number', selector: '#count' } },
    contexts: { Save: [{ selector: '#modal', state: 'visible', before: [{ op: 'click', selector: '#close' }], after: [] }] } };
  const [correct] = await captureGeneratedTraces({ contract, binding, html, outDir: path.join(root, 'correct') });
  assert.equal(correct.status, 'recorded', JSON.stringify(correct));
  assert.deepEqual(correct.snapshots, [{ count: 0 }, { count: 1 }]);
  assert.equal(correct.contextChecks.length, 2);
  binding.contexts.Save[0].before.push({ op: 'click', selector: '#save' });
  const [invalid] = await captureGeneratedTraces({ contract, binding, html, outDir: path.join(root, 'invalid') });
  assert.equal(invalid.status, 'blocked');
  assert.match(invalid.diagnostic.message, /context_changed_model_observation/);
  binding.contexts.Save[0].before = [{ op: 'click', selector: '#missing' }];
  const [unresolved] = await captureGeneratedTraces({ contract, binding, html, outDir: path.join(root, 'unresolved') });
  assert.equal(unresolved.diagnostic.actionId, 'Save');
  assert.equal(unresolved.diagnostic.phase, 'context-before');
});