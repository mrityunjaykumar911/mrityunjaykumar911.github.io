import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runQualityTrial } from './quality-trial.mjs';
import { qualityOptions } from '../run-quality.mjs';
import { buildJudgePrompt } from './judge.mjs';
import { BEHAVIOR_COMPILER_VERSION, behaviorHash } from './behavioral-model.mjs';
import { QUALITY_PROTOCOL } from './quality-contracts.mjs';
import { TASK_ADJUDICATION_PROTOCOL } from './task-adjudication.mjs';

function sourceRecord(accepted = [true, true]) {
  const model = { contracts: accepted.map((_flag, index) => ({ id: `contract${index}`, state: [{ id: 'count', initial: 0, exploreMax: 1 }],
    actions: [{ id: 'Add', enabled: true, updates: { count: { op: 'add', args: [{ var: 'count' }, 1] } } }] })) };
  return { model, modelHash: behaviorHash(model), grounding: { accepted: accepted.every(Boolean), contracts: model.contracts.map((contract, index) => ({
    id: contract.id, accepted: accepted[index], reason: accepted[index] ? 'review accepted' : 'unsupported observable',
  })) } };
}

test('final evaluator receives literal generated content without replacement-token expansion', () => {
  const answer = '<html>$& $` $\' $Checklist</html>';
  const prompt = buildJudgePrompt({ template: '$Checklist\n$Question\n$Answer', checklist: 'rubric', question: '$Answer is task text', answer });
  assert.equal(prompt, `rubric\n$Answer is task text\n${answer}`);
});

test('new runner requires explicit task/run scope and rejects path traversal', () => {
  assert.throws(() => qualityOptions(['--run-id', '../old', '--tasks', '1097', '--key-file', 'key']));
  assert.throws(() => qualityOptions(['--run-id', 'new', '--tasks', '1097', '--key-file', 'key', '--unknown', 'yes']));
  assert.deepEqual(qualityOptions(['--run-id', 'trial', '--tasks', '1097', '--key-file', 'key']).ids, ['1097']);
  assert.deepEqual(qualityOptions(['--run-id', 'trial', '--tasks', '1267', '--key-file', 'key', '--modes', 'formal']).modes, ['formal']);
  assert.throws(() => qualityOptions(['--run-id', 'trial', '--tasks', '1267', '--key-file', 'key', '--modes', 'formal,formal']));
});

test('both selections lock before held-out scoring; identical outputs receive one rating', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-trial-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const order = [];
  const budgets = [];
  let judgeCalls = 0;
  const summary = await runQualityTrial({ task: { id: 1097, prompt: 'Count' }, client: {}, directory,
    author: async () => { order.push('model'); return sourceRecord(); },
    bind: async () => ({ review: { accepted: true } }),
    produce: async () => { order.push('initial'); return { html: 'same', htmlHash: 'same' }; },
    critique: async () => ({ ok: true, score: 15, issues: [] }),
    improve: async ({ formal, initial, client }) => { order.push(formal ? 'formal' : 'executable'); budgets.push(client.limits);
      return { report: { status: 'unchanged' }, selectedArtifact: initial }; },
    finalJudge: async () => { judgeCalls++; order.push('final'); const selections = JSON.parse(await readFile(path.join(directory, 'selections-locked.json'), 'utf8'));
      assert.ok(selections.reports.formal); assert.ok(selections.reports.executable); return { ok: true, score: 73 }; } });
  assert.deepEqual(order, ['model', 'initial', 'executable', 'formal', 'final']);
  assert.deepEqual(budgets[0], budgets[1]);
  assert.equal(judgeCalls, 1);
  assert.equal(summary.scores.formal.scoreSource, 'initial');
  assert.equal(summary.status, 'complete');
  assert.equal(summary.compilerVersion, BEHAVIOR_COMPILER_VERSION);
  const selections = JSON.parse(await readFile(path.join(directory, 'selections-locked.json'), 'utf8'));
  assert.equal(selections.compilerVersion, BEHAVIOR_COMPILER_VERSION);
});

test('old compiler trial summaries cannot be reused or trigger new paid requests', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-compiler-identity-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const task = { id: 42, prompt: 'Count' };
  const armLimits = { maxCalls: 1, maxOutputTokens: 100 };
  const modes = ['formal'];
  const summaryPath = path.join(directory, 'summary.json');
  let authorCalls = 0;
  for (const compiler of [{}, { compilerVersion: 'previous-compiler' }]) {
    const archived = JSON.stringify({ trialIdentity: behaviorHash({ protocol: QUALITY_PROTOCOL, ...compiler, task, armLimits, modes }) });
    await writeFile(summaryPath, archived, 'utf8');
    await assert.rejects(runQualityTrial({ task, armLimits, modes, directory, client: {},
      author: async () => { authorCalls++; throw new Error('must not regenerate'); } }), /trial_identity_changed/);
    assert.equal(await readFile(summaryPath, 'utf8'), archived);
  }
  assert.equal(authorCalls, 0);
});

test('total grounding rejection still generates and rates a baseline without a false T score', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-grounding-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const summary = await runQualityTrial({ task: { id: 42, prompt: 'Count' }, directory, client: {},
    author: async () => sourceRecord([false, false]), produce: async () => ({ html: 'fresh', htmlHash: 'fresh' }),
    critique: () => { throw new Error('must not optimize without evidence'); },
    finalJudge: async () => { await readFile(path.join(directory, 'selections-locked.json')); return { ok: true, score: 72 }; } });
  assert.equal(summary.status, 'incomplete');
  assert.equal(summary.evaluationStatus, 'baseline-only');
  assert.equal(summary.scores.initial.score, 72);
  assert.equal(summary.scores.formal.score, null);
  assert.equal(summary.contractCoverage.excluded.length, 2);
  assert.equal(summary.blockedArmRate, 1);
});

test('partial rejection keeps useful contracts in both arms and preserves the excluded denominator', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-partial-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const active = [];
  const summary = await runQualityTrial({ task: { id: 1097, prompt: 'Count' }, directory, client: {},
    author: async () => sourceRecord([true, false, true]), bind: async () => ({ review: { accepted: true } }),
    produce: async () => ({ html: 'fresh', htmlHash: 'fresh' }), critique: async () => ({ ok: true, score: 15, issues: [] }),
    improve: async ({ record, initial }) => { active.push(record.model.contracts.map((contract) => contract.id)); return { selectedArtifact: initial, report: { status: 'unchanged' } }; },
    finalJudge: async () => ({ ok: true, score: 74 }) });
  assert.deepEqual(active, [['contract0', 'contract2'], ['contract0', 'contract2']]);
  assert.equal(summary.contractCoverage.generated, 3);
  assert.equal(summary.contractCoverage.eligible, 2);
  assert.equal(summary.contractCoverage.excluded[0].id, 'contract1');
  assert.equal(summary.status, 'incomplete');
  assert.equal(summary.evaluationStatus, 'partial-contract-coverage');
  assert.equal(summary.reports.formal.formalCoverageComplete, false);
  assert.equal(summary.scores.initial.score, 74);
});

test('model API failure cannot cancel baseline generation', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-api-failure-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const summary = await runQualityTrial({ task: { id: 1097, prompt: 'Count' }, directory, client: {},
    author: async () => { throw new Error('model generation failed'); }, produce: async () => ({ html: 'fresh', htmlHash: 'fresh' }),
    finalJudge: async () => ({ ok: true, score: 70 }) });
  assert.equal(summary.scores.initial.score, 70);
  assert.equal(summary.contractCoverage.generated, null);
  assert.equal(summary.evaluationStatus, 'baseline-only');
});

test('formal-only rerun skips the executable arm and includes scope in cache identity', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-formal-only-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const modes = [];
  const args = { task: { id: 1267, prompt: 'Record tasks' }, directory, client: {}, modes: ['formal'],
    author: async () => sourceRecord(), bind: async () => ({ review: { accepted: true } }),
    produce: async () => ({ html: 'fresh', htmlHash: 'fresh' }), critique: async () => ({ ok: true, score: 15, issues: [] }),
    improve: async ({ formal, initial }) => { modes.push(formal); return { selectedArtifact: initial, report: { status: 'unchanged' } }; },
    finalJudge: async () => ({ ok: true, score: 74 }) };
  const summary = await runQualityTrial(args);
  assert.deepEqual(modes, [true]);
  assert.deepEqual(Object.keys(summary.scores), ['initial', 'formal']);
  assert.deepEqual(Object.keys(summary.reports), ['formal']);
  assert.equal(summary.blockedArmRate, 0);
  await assert.rejects(runQualityTrial({ ...args, modes: ['executable', 'formal'] }), /trial_identity_changed/);
});

test('formal-only blocked denominator counts only the requested arm', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-formal-blocked-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const summary = await runQualityTrial({ task: { id: 1267, prompt: 'Record tasks' }, directory, client: {}, modes: ['formal'],
    author: async () => sourceRecord([false, false]), produce: async () => ({ html: 'fresh', htmlHash: 'fresh' }),
    finalJudge: async () => ({ ok: true, score: 70 }) });
  assert.equal(summary.blockedArmRate, 1);
  assert.equal(summary.scores.formal.score, null);
  assert.equal(Object.hasOwn(summary.scores, 'executable'), false);
});

test('scored T uses the revalidated generative selection before app work and keeps the evaluator held out', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-repair-scored-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = sourceRecord([false, false]);
  const selected = sourceRecord();
  selected.promptHash = behaviorHash('Count');
  for (const contract of selected.model.contracts) contract.requirements = [{ id: 'counting' }];
  selected.modelHash = behaviorHash(selected.model);
  selected.taskAdjudication = { contracts: selected.model.contracts.map((item) => ({ id: item.id, dependencies: [], reason: 'Fixture task evidence',
    requirements: [{ id: 'counting', disposition: 'preserves-obligation', taskQuote: 'Count', rationale: 'Counting is requested' }] })) };
  const order = [];
  const args = { task: { id: 1267, prompt: 'Count', checklist: 'HIDDEN' }, directory, client: {}, modes: ['formal'], specificationRepairRounds: 2,
    author: async () => source, repair: async ({ task, directory, maxRounds }) => {
      assert.deepEqual(task, { id: 1267, prompt: 'Count' }); assert.equal(maxRounds, 2); order.push('repair');
      await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'selected-source.json'), JSON.stringify(selected));
      return { status: 'model-admitted', originalModelHash: source.modelHash, selectedModelHash: selected.modelHash,
        compilerVersion: BEHAVIOR_COMPILER_VERSION, adjudicationProtocol: TASK_ADJUDICATION_PROTOCOL,
        taskValidatedContractIds: selected.model.contracts.map((item) => item.id),
        selectedContractVersions: Object.fromEntries(selected.model.contracts.map((item) => [item.id, { contractHash: behaviorHash(item) }])), accounting: { calls: 3 } };
    }, produce: async () => { order.push('initial'); return { html: 'initial', htmlHash: 'initial' }; }, bind: async () => ({ review: { accepted: true } }),
    critique: async () => ({ ok: true, score: 15, issues: [] }), improve: async ({ record, initial }) => {
      order.push('formal'); assert.equal(record.modelHash, selected.modelHash); return { report: { status: 'unchanged' }, selectedArtifact: initial };
    }, finalJudge: async () => { order.push('judge'); await readFile(path.join(directory, 'selections-locked.json')); return { ok: true, score: 70 }; } };
  const summary = await runQualityTrial(args);
  assert.deepEqual(order, ['repair', 'initial', 'formal', 'judge']);
  assert.equal(summary.scores.formal.score, 70);
  assert.equal(summary.modelPreparation.accounting.calls, 3);
  assert.equal(summary.contractCoverage.generated, 2);
  await assert.rejects(runQualityTrial({ ...args, specificationRepairRounds: 0 }), /trial_identity_changed/);
});

test('scored T never falls back to a false score when selected specification evidence is unavailable', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-repair-blocked-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const summary = await runQualityTrial({ task: { id: 1267, prompt: 'Count' }, directory, client: {}, specificationRepairRounds: 1,
    author: async () => sourceRecord(), repair: async () => { throw new Error('fixture repair unavailable'); },
    produce: async () => ({ html: 'baseline', htmlHash: 'baseline' }), improve: () => { throw new Error('must not run'); },
    finalJudge: async () => ({ ok: true, score: 71 }) });
  assert.equal(summary.modelPreparation.status, 'blocked');
  assert.equal(summary.scores.initial.score, 71);
  assert.equal(summary.scores.formal.score, null);
  assert.equal(summary.contractCoverage.generated, 2);
  assert.equal(qualityOptions(['--tasks', '1267', '--run-id', 'fresh', '--key-file', 'fixture', '--specification-repair-rounds', '2']).specificationRepairRounds, 2);
  assert.throws(() => qualityOptions(['--tasks', '1267', '--run-id', 'fresh', '--key-file', 'fixture', '--specification-repair-rounds', '4']));
});