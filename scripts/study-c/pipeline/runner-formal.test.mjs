import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTask, stage } from '../run-five.mjs';
import { generatedCacheIdentity } from './generative-tla.mjs';
import { GENERATIVE_PROTOCOL } from './task-contracts.mjs';

const initial = { ok: true, answer: '<html>fixture</html>', extracted: { type: 'html', content: '<html>fixture</html>' },
  render: { observations: { rendered: true, consoleErrors: [], pageErrors: [] }, imageBuffers: [] } };
const pools = { arm: (run) => run(), judge: (run) => run() };
const generated = { protocolVersion: GENERATIVE_PROTOCOL, contractSha256: 'test-generated', contracts: [{ id: 'one' }, { id: 'two' }] };
const contractsFor = async () => generated;
const suite = { complete: true, status: 'passed', contracts: [{ status: 'passed', validation: { level: 'checked' } }, { status: 'passed', validation: { level: 'checked' } }] };

async function directory(context) {
  const dir = await mkdtemp(path.join(tmpdir(), 'study-c-runner-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('a blocked T arm never repairs, judges, or borrows the initial score', async (context) => {
  let produced = 0;
  const judged = [];
  const result = await runTask({ runDir: await directory(context), task: { id: 1097 }, arms: ['T'], pools, contractsFor,
    produce: async () => { produced++; return initial; },
    feedbackFor: async () => ({ kind: 'tla', ok: false, reason: 'formal_validation_failed', repairPrompt: 'must not execute' }),
    judge: async ({ purpose }) => { judged.push(purpose); return { ok: true, score: 77 }; } });
  assert.equal(produced, 1);
  assert.deepEqual(judged, ['judge-initial-1097']);
  assert.equal(result.arms.T.status, 'blocked');
  assert.equal(result.arms.T.score, null);
});

test('verified unchanged T reuses the initial rating without a repair or extra judge', async (context) => {
  let produced = 0;
  let judged = 0;
  const identity = generatedCacheIdentity(initial.extracted.content, generated);
  const result = await runTask({ runDir: await directory(context), task: { id: 1097 }, arms: ['T'], pools, contractsFor,
    produce: async () => { produced++; return initial; },
    feedbackFor: async () => ({ ...identity, kind: 'tla', ok: true, suite, validation: { level: 'checked' }, replay: { complete: true }, repairPrompt: null }),
    judge: async () => { judged++; return { ok: true, score: 77 }; } });
  assert.equal(produced, 1);
  assert.equal(judged, 1);
  assert.equal(result.arms.T.status, 'unchanged');
  assert.equal(result.arms.T.scoreSource, 'initial');
  assert.equal(result.arms.T.score, 77);
});

test('old T feedback, repair, and judge caches are left untouched and never reused', async (context) => {
  const runDir = await directory(context);
  const legacyFile = path.join(runDir, 'task-1097/arm-T/feedback/result.json');
  await mkdir(path.dirname(legacyFile), { recursive: true });
  const legacy = JSON.stringify({ kind: 'tla', validation: { level: 'unparseable' }, repairPrompt: 'add a cap' });
  await writeFile(legacyFile, legacy);
  const identity = generatedCacheIdentity(initial.extracted.content, generated);
  const judgeDir = path.join(runDir, 'task-1097/judge/arm-T');
  await mkdir(judgeDir, { recursive: true });
  await writeFile(path.join(judgeDir, 'result.json'), JSON.stringify({ ok: true, score: 75 }));
  let feedbackCalls = 0;
  const result = await runTask({ runDir, task: { id: 1097 }, arms: ['T'], pools, contractsFor,
    produce: async () => initial,
    feedbackFor: async () => { feedbackCalls++; return { ...identity, kind: 'tla', ok: true,
      suite, validation: { level: 'checked' }, replay: { complete: true }, repairPrompt: 'fix observed trace' }; },
    judge: async () => ({ ok: true, score: 76 }) });
  assert.equal(feedbackCalls, 2);
  assert.equal(result.arms.T.postRepair.status, 'passed');
  assert.equal(result.arms.T.score, 76);
  assert.equal(await readFile(legacyFile, 'utf8'), legacy);
  assert.equal(JSON.parse(await readFile(path.join(judgeDir, 'result.json'), 'utf8')).score, 75);
});

test('a failed stage cache is not treated as success on resume', async (context) => {
  const dir = await directory(context);
  await writeFile(path.join(dir, 'result.json'), JSON.stringify({ ok: false }));
  let calls = 0;
  const result = await stage(dir, async () => { calls++; return { ok: true }; });
  assert.equal(calls, 1);
  assert.equal(result.cached, false);
});

test('contract generation receives only task text and precedes artifact generation', async (context) => {
  const events = [];
  const result = await runTask({ runDir: await directory(context), task: { id: 9898, prompt: 'Different task', secretScore: 75 }, arms: ['T'], pools,
    contractsFor: async ({ task }) => { events.push('contracts'); assert.deepEqual(task, { id: 9898, prompt: 'Different task' }); return generated; },
    produce: async () => { events.push('artifact'); return initial; },
    feedbackFor: async () => ({ ok: false, reason: 'test-blocked' }), judge: async () => ({ ok: true, score: 71 }) });
  assert.deepEqual(events, ['contracts', 'artifact']);
  assert.equal(result.arms.T.score, null);
});

test('failed generation does not invoke the fixed-contract fallback', async (context) => {
  let feedbackCalls = 0;
  const result = await runTask({ runDir: await directory(context), task: { id: 1097, prompt: 'Score counter' }, arms: ['T'], pools,
    contractsFor: async () => { throw new Error('invalid-model-response'); }, produce: async () => initial,
    feedbackFor: async () => { feedbackCalls++; }, judge: async () => ({ ok: true, score: 75 }) });
  assert.equal(feedbackCalls, 0);
  assert.equal(result.arms.T.status, 'blocked');
});