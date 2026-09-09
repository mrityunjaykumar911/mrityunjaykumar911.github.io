import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capturePingPongTraces, loadPingPongContract, replaySpecification, validateBinding } from './ping-pong-replay.mjs';
import { validateSpec } from './tla-oracle.mjs';

const binding = { scoreA: '#scoreA', scoreB: '#scoreB', pointA: '#pointA', pointB: '#pointB', reset: ['#reset'] };
const fixture = (cap) => `<!doctype html><html><body>
<button id="pointA">Player A</button><span id="scoreA">0</span>
<button id="pointB">Player B</button><span id="scoreB">0</span>
<button id="reset">Reset</button><script>
const state = [0, 0];
function render() { document.querySelector('#scoreA').textContent = state[0]; document.querySelector('#scoreB').textContent = state[1]; }
function point(player) {
  if (Math.max(...state) >= 11 && Math.abs(state[0] - state[1]) >= 2) return;
  if (state[player] >= ${cap}) return;
  state[player]++; render();
}
document.querySelector('#pointA').onclick = () => point(0);
document.querySelector('#pointB').onclick = () => point(1);
document.querySelector('#reset').onclick = () => { state[0] = 0; state[1] = 0; render(); };
</script></body></html>`;

test('bindings accept only bounded selector data', () => {
  assert.deepEqual(validateBinding(binding), binding);
  assert.throws(() => validateBinding({ ...binding, pointB: binding.pointA }));
  assert.throws(() => validateBinding({ ...binding, reset: 'arbitrary code' }));
});

test('invalid observations cannot become executable TLA code', async () => {
  assert.throws(() => replaySpecification({ tla: '', cfg: '', actions: ['not-an-action'], snapshots: [] }));
});

test('actual mobile taps beyond 99 pass for uncapped scores and fail for the cap mutant', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'study-c-browser-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const contract = await loadPingPongContract();
  const actions = [...Array.from({ length: 100 }, () => ['A', 'B']).flat(), 'A', 'A', 'B'];
  for (const [name, cap] of [['correct', 'Infinity'], ['mutant', '99']]) {
    const outDir = path.join(root, name);
    const [trace] = await capturePingPongTraces({ html: fixture(cap), binding, outDir, traces: [{ id: 'extended-deuce', actions }] });
    assert.equal(trace.status, 'recorded');
    const evidence = await validateSpec({ specDir: path.join(outDir, 'tlc'), ...replaySpecification({ ...contract, ...trace }) });
    if (name === 'correct') {
      assert.equal(evidence.level, 'checked', JSON.stringify(evidence));
      assert.deepEqual(trace.snapshots.at(-1), { scoreA: 102, scoreB: 100 });
    } else {
      assert.equal(evidence.violatedInvariant, 'SnapshotMatches', JSON.stringify(evidence));
      assert.deepEqual(evidence.counterexample, { scoreA: 100, scoreB: 99, step: 199 });
    }
  }
});