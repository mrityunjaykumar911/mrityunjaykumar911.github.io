import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { budgetClient, parseDevelopmentCritic, runImprovementArm } from './quality-loop.mjs';

const evidence = (failed = false) => ({ complete: true, status: failed ? 'failed' : 'passed', contracts: [{ id: 'count', status: failed ? 'failed' : 'passed',
  failures: failed ? [{ step: 1, observable: 'count', expected: 1, observed: 0 }] : [], checks: [{ id: 'path-1', actions: ['Add'], status: failed ? 'failed' : 'passed', failures: failed ? [{ step: 1, observable: 'count' }] : [] }] }] });
const critic = { ok: true, score: 12, issues: [{ evidence: 'control clipped', target: 'button', change: 'fix width' }] };

test('equal per-arm reservations block overspend without sending an extra API request', async () => {
  let calls = 0;
  const client = budgetClient({ generate: async () => { calls++; return { ok: true, usage: { totalTokens: 7 } }; } }, { maxCalls: 2, maxOutputTokens: 20 });
  await client.generate({ maxOutputTokens: 10 });
  await client.generate({ maxOutputTokens: 10 });
  await assert.rejects(client.generate({ maxOutputTokens: 1 }), /arm_budget_exhausted/);
  assert.equal(calls, 2);
  assert.equal(client.accounting.totalTokens, 14);
});

test('critic outputs have a development-only scale and require evidence', () => {
  const report = parseDevelopmentCritic(JSON.stringify({ dimensions: { readability: 4, layout: 3, feedback: 4, accessibility: 3 }, issues: [] }));
  assert.equal(report.score, 14);
  assert.equal(report.scale, 'development-0-20');
  assert.throws(() => parseDevelopmentCritic('{"Overall Score":99}'));
});

test('one targeted candidate is selected with preserved behavior and no final-judge dependency', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-loop-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  let generations = 0;
  const result = await runImprovementArm({ task: { prompt: 'Count' }, record: { modelHash: 'model' }, directory, formal: true,
    initial: { html: '<html>initial</html>', htmlHash: 'initial' }, client: {},
    evaluate: async ({ html }) => evidence(html.includes('initial')),
    critique: async () => critic,
    produce: async ({ prompt }) => { generations++; assert.match(prompt, /targeted changes/); assert.doesNotMatch(prompt, /Overall Score/);
      return { html: '<html>candidate</html>', htmlHash: 'candidate' }; } });
  assert.equal(generations, 1);
  assert.equal(result.selectedArtifact.htmlHash, 'candidate');
  assert.equal(JSON.parse(await readFile(path.join(directory, 'selection.json'), 'utf8')).decision.reason, 'fewer_behavior_failures');
});

test('unknown behavior blocks candidate generation even when quality could improve', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-block-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const result = await runImprovementArm({ task: { prompt: 'Count' }, record: {}, initial: { html: 'initial', htmlHash: 'initial' }, directory,
    evaluate: async () => ({ complete: false }), critique: () => { throw new Error('should not run'); }, produce: () => { throw new Error('should not run'); } });
  assert.equal(result.report.status, 'blocked');
});