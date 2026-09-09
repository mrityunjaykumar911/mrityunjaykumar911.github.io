import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureGeneratedTraces, validateGeneratedBinding } from './generated-browser.mjs';

const contract = { actions: [{ id: 'Increment' }], observables: [{ id: 'points' }], traces: [{ id: 'increment', actions: ['Increment', 'Increment'] }] };
const binding = { setup: [], actions: { Increment: [{ op: 'click', selector: '#add' }] }, observables: { points: { op: 'number', selector: '#score' } } };

test('generated bindings cannot include scripts or expected-value constants', () => {
  assert.equal(validateGeneratedBinding(binding, contract), binding);
  assert.throws(() => validateGeneratedBinding({ ...binding, actions: { Increment: [{ op: 'evaluate', value: 'evil()' }] } }, contract));
  assert.throws(() => validateGeneratedBinding({ ...binding, observables: { points: { op: 'constant', value: 10 } } }, contract));
});

test('domain-neutral executor observes actual DOM updates and records mapping failures as blocked', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'generated-browser-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const html = '<html><body><button id="add" onclick="document.querySelector(\'#score\').textContent++">Add</button><span id="score">0</span></body></html>';
  const [trace] = await captureGeneratedTraces({ contract, binding, html, outDir: path.join(root, 'valid') });
  assert.equal(trace.status, 'recorded');
  assert.deepEqual(trace.snapshots, [{ points: 0 }, { points: 1 }, { points: 2 }]);
  const [missing] = await captureGeneratedTraces({ contract, binding, html: '<html><body>missing</body></html>', outDir: path.join(root, 'missing') });
  assert.equal(missing.status, 'blocked');
});