import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureGeneratedTraces, validateGeneratedBinding } from './generated-browser.mjs';

const html = `<html><body><div id="names"><span>Work</span></div><input id="name"><select id="offset"><option>Early</option><option>At due time</option></select><button id="save">Save</button><div id="notice"></div><script>document.querySelector('#save').onclick=()=>{const label=document.createElement('span');label.textContent=document.querySelector('#name').value;document.querySelector('#names').appendChild(label);if(document.querySelector('#offset').value==='At due time')setTimeout(()=>{document.querySelector('#notice').textContent='Reminder'},1000)};</script></body></html>`;
function fixture(name = 'StudyItem742', offset = 'At due time') {
  const contract = { actions: [{ id: 'Create' }, { id: 'Wait' }], observables: [{ id: 'notice' }], traces: [{ id: 'trace', actions: ['Create', 'Wait'] }],
    semantics: { scenarioChoices: [{ id: 'name', kind: 'fresh-name', value: name }, { id: 'offset', kind: 'setting', value: offset }, { id: 'channel', kind: 'delivery-channel', value: 'in-page' }],
      prerequisites: [{ id: 'unused', kind: 'absent', choiceId: 'name' }, { id: 'offsetConfigured', kind: 'setting', choiceId: 'offset', actionId: 'Create' },
        { id: 'delivery', kind: 'capability', choiceId: 'channel', observableId: 'notice' }] } };
  const binding = { setup: [], actions: { Create: [{ op: 'fill', selector: '#name', value: name }, { op: 'select', selector: '#offset', value: offset }, { op: 'click', selector: '#save' }], Wait: [{ op: 'advance', ms: 1000 }] },
    observables: { notice: { op: 'textIncludes', selector: '#notice', text: 'Reminder' } },
    prerequisites: { unused: { selector: '#names span' }, offsetConfigured: { op: 'select', selector: '#offset', value: offset }, delivery: { channel: 'in-page' } } };
  return { contract, binding };
}

test('real browser blocks seeded-name conflicts before setup and executes fresh names with explicit reminder configuration', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'browser-prerequisites-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const conflicting = fixture('Work');
  conflicting.binding.setup = [{ op: 'click', selector: '#does-not-exist' }];
  const [blocked] = await captureGeneratedTraces({ ...conflicting, html, outDir: path.join(directory, 'conflict') });
  assert.equal(blocked.reason, 'scenario_name_conflict');
  assert.equal(blocked.snapshots.length, 0);
  const [valid] = await captureGeneratedTraces({ ...fixture(), html, outDir: path.join(directory, 'valid') });
  assert.equal(valid.status, 'recorded', JSON.stringify(valid));
  assert.deepEqual(valid.snapshots, [{ notice: 0 }, { notice: 0 }, { notice: 1 }]);
  assert.ok(valid.prerequisiteChecks.some((check) => check.status === 'configured' && check.value === 'At due time'));
  const [unsupported] = await captureGeneratedTraces({ ...fixture('OtherStudyItem', 'Unsupported offset'), html, outDir: path.join(directory, 'unsupported') });
  assert.equal(unsupported.reason, 'unsupported_scenario_setting');
});

test('default settings and unsupported delivery channels cannot silently satisfy prerequisites', () => {
  const { contract, binding } = fixture();
  binding.actions.Create.splice(1, 1);
  assert.throws(() => validateGeneratedBinding(binding, contract), /scenario_setting_not_explicit/);
  const second = fixture();
  second.binding.prerequisites.delivery.channel = 'closed-app';
  assert.throws(() => validateGeneratedBinding(second.binding, second.contract), /unsupported_delivery_channel/);
});

test('saved app seeded Work blocks the archived category assumption without deleting or renaming data', async (context) => {
  const artifact = new URL('../../../.tools/study-c/quality-runs/quality-v3-1267-T-1gb-first/task-1267/initial/desktop/html_desktop.html', import.meta.url);
  let saved;
  try { saved = await readFile(artifact, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('archived HTML unavailable'); return; } throw error; }
  const directory = await mkdtemp(path.join(tmpdir(), 'saved-prerequisite-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const { contract, binding } = fixture('Work');
  binding.prerequisites.unused.selector = '#catList .cat-left > span:last-child';
  const [result] = await captureGeneratedTraces({ contract, binding, html: saved, outDir: directory });
  assert.equal(result.reason, 'scenario_name_conflict');
  assert.equal(result.prerequisiteChecks[0].matches, 1);
  assert.equal(result.snapshots.length, 0);
  assert.equal(await readFile(artifact, 'utf8'), saved);
});