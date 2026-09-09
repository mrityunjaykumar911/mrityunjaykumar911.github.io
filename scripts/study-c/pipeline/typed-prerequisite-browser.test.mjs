import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SEMANTIC_PROTOCOL } from './semantic-contract.mjs';
import { captureGeneratedTraces } from './generated-browser.mjs';

const html = `<html><body><select id="offset"><option>Early</option><option>At due time</option></select><input id="due" type="datetime-local"><button id="save" onclick="document.querySelector('#count').textContent='1'">Save</button><span id="count">0</span></body></html>`;
function fixture() {
  const contract = { actions: [{ id: 'Save' }], observables: [{ id: 'count' }], traces: [{ id: 'trace', actions: ['Save'] }],
    semantics: { version: SEMANTIC_PROTOCOL,
      scenarioChoices: [{ id: 'offset', kind: 'setting', value: { type: 'option-label', value: 'At due time' } },
        { id: 'due', kind: 'setting', value: { type: 'datetime-local', value: '2030-01-03T12:00:00' } }],
      prerequisites: [{ id: 'configuredOffset', kind: 'setting', choiceId: 'offset', actionId: 'Save' }, { id: 'configuredDate', kind: 'setting', choiceId: 'due', actionId: 'Save' }] } };
  const binding = { setup: [], actions: { Save: [{ op: 'select', selector: '#offset', value: 'At due time' }, { op: 'fill', selector: '#due', value: '2030-01-03T12:00:00' }, { op: 'click', selector: '#save' }] },
    observables: { count: { op: 'number', selector: '#count' } }, prerequisites: {
      configuredOffset: { selector: '#offset', op: 'select', value: 'At due time', commitStep: 2 },
      configuredDate: { selector: '#due', op: 'fill', value: '2030-01-03T12:00:00', commitStep: 2 },
    } };
  return { contract, binding };
}

test('typed browser settings read back native values and must remain configured until commit', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'typed-prerequisite-browser-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const [correct] = await captureGeneratedTraces({ ...fixture(), html, outDir: path.join(directory, 'correct') });
  assert.equal(correct.status, 'recorded', JSON.stringify(correct));
  assert.deepEqual(correct.snapshots, [{ count: 0 }, { count: 1 }]);
  assert.equal(correct.prerequisiteChecks.filter((check) => check.status === 'verified-before-commit').length, 2);
  const overwritten = fixture();
  overwritten.binding.actions.Save.splice(2, 0, { op: 'select', selector: '#offset', value: 'Early' });
  for (const mapping of Object.values(overwritten.binding.prerequisites)) mapping.commitStep = 3;
  const [blocked] = await captureGeneratedTraces({ ...overwritten, html, outDir: path.join(directory, 'overwritten') });
  assert.equal(blocked.reason, 'scenario_setting_not_applied_at_commit');
  assert.equal(blocked.snapshots.length, 1);
  const [wrongControl] = await captureGeneratedTraces({ ...fixture(), html: html.replace('type="datetime-local"', 'type="text"'), outDir: path.join(directory, 'wrong-control') });
  assert.equal(wrongControl.reason, 'scenario_setting_control_type_mismatch');
  const [unsupported] = await captureGeneratedTraces({ ...fixture(), html: html.replace('<option>At due time</option>', ''), outDir: path.join(directory, 'unsupported') });
  assert.equal(unsupported.reason, 'unsupported_scenario_setting');
});