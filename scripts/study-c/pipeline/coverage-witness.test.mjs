import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deriveSchedules, compareBehaviorTrace, initialState, transition } from './behavioral-model.mjs';
import { captureGeneratedTraces } from './generated-browser.mjs';
import { compileCoverageGoal, findCoverageWitness } from './coverage-witness.mjs';
import { createProgressLogger } from './progress.mjs';

const count = { var: 'count' };
const contract = { id: 'counter', state: [{ id: 'count', initial: 0, exploreMax: 12 }],
  actions: [
    { id: 'Add', description: 'Tap Add', enabled: true, updates: { count: { op: 'add', args: [count, 1] } } },
    { id: 'Reset', description: 'Tap Reset', enabled: { op: 'gt', args: [count, 0] }, updates: { count: 0 } },
  ], observables: [{ id: 'count', description: 'displayed count', expression: count }],
  invariants: [{ id: 'nonnegative', expression: { op: 'gte', args: [count, 0] } }] };
const binding = { setup: [], actions: { Add: [{ op: 'tap', selector: '#add' }], Reset: [{ op: 'tap', selector: '#reset' }] },
  observables: { count: { op: 'number', selector: '#count' } } };
const html = (cap) => `<html><body><button id="add" onclick="if (+document.querySelector('#count').textContent < ${cap}) document.querySelector('#count').textContent++">Add</button><button id="reset" onclick="document.querySelector('#count').textContent=0">Reset</button><span id="count">0</span></body></html>`;

test('coverage goals cannot redefine product bounds or become artifact-failure claims', () => {
  assert.throws(() => compileCoverageGoal(contract, { field: 'count', value: 13 }));
  const goal = compileCoverageGoal(contract, { field: 'count', value: 12 });
  assert.match(goal.tla, /CoverageTargetNotReached == v_count < 12/);
  assert.match(goal.tla, /v_count' = \(v_count \+ 1\)/);
});

test('TLC and deeper nonformal search expose the same cap missed by shallow schedules', async (context) => {
  const evidenceRoot = process.env.STUDY_C_WITNESS_EVIDENCE_ROOT;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const directory = await mkdtemp(path.join(evidenceRoot ?? tmpdir(), 'study-c-witness-'));
  if (!evidenceRoot) context.after(() => rm(directory, { recursive: true, force: true }));
  const log = createProgressLogger();
  log.setFile(path.join(directory, 'progress.log'));
  const stage = (name, work) => log.withTask('synthetic-counter', () => log.withStage(name, work));
  const baseline = deriveSchedules(contract, { maxStates: 128, maxDepth: 8, maxTraces: 16 });
  const baselineActions = baseline.traces.reduce((sum, trace) => sum + trace.actions.length, 0);
  const goal = { field: 'count', value: 12 };
  const nonformalStarted = performance.now();
  const deeper = deriveSchedules(contract, { maxStates: 128, maxDepth: 12, maxTraces: 16 });
  const targetPaths = deeper.traces.flatMap((trace) => {
    let state = initialState(contract);
    for (const [index, action] of trace.actions.entries()) {
      state = transition(contract, state, action);
      if (state[goal.field] >= goal.value) return [{ id: 'nonformal-target', actions: trace.actions.slice(0, index + 1) }];
    }
    return [];
  }).sort((first, second) => first.actions.length - second.actions.length);
  const nonformal = targetPaths[0];
  const nonformalSearchMs = performance.now() - nonformalStarted;
  assert.ok(nonformal, 'ordinary model search must independently reach the same declared goal');
  const formalStarted = performance.now();
  const witness = await stage('tlc-search', () => findCoverageWitness({ contract, goal, directory: path.join(directory, 'tlc') }));
  const formalSearchMs = performance.now() - formalStarted;
  assert.equal(witness.status, 'reached', JSON.stringify(witness));
  assert.equal(witness.artifactFailure, false);
  assert.equal(witness.trace.actions.length, 12);
  assert.ok(witness.trace.actions.length <= baselineActions);
  assert.deepEqual(nonformal.actions, witness.trace.actions);
  const traces = [...baseline.traces, witness.trace, nonformal];
  const observed = await stage('browser-mutant', () => captureGeneratedTraces({ contract: { ...contract, traces },
    html: html(10), binding, outDir: path.join(directory, 'mutant') }));
  assert.ok(observed.every((trace) => trace.status === 'recorded'));
  const baselineResults = observed.slice(0, baseline.traces.length).map((trace) => compareBehaviorTrace(contract, trace, trace.snapshots));
  assert.ok(baselineResults.every((result) => result.status === 'passed'));
  const formalCapture = observed[baseline.traces.length];
  const failed = compareBehaviorTrace(contract, formalCapture, formalCapture.snapshots);
  const nonformalFailed = compareBehaviorTrace(contract, observed.at(-1), observed.at(-1).snapshots);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.failures[0], { step: 11, observable: 'count', expected: 11, observed: 10 });
  assert.deepEqual(nonformalFailed.failures, failed.failures);
  const repaired = await stage('browser-repaired', () => captureGeneratedTraces({ contract: { ...contract, traces },
    html: html('Infinity'), binding, outDir: path.join(directory, 'repaired') }));
  assert.ok(repaired.every((trace) => trace.status === 'recorded' && compareBehaviorTrace(contract, trace, trace.snapshots).status === 'passed'));
  const evidence = { protocol: 'witness-depth-comparison-v1', recordedAt: new Date().toISOString(), pid: process.pid,
    origin: 'existing hand-constructed regression fixture; not a generated contract or benchmark artifact',
    providerCalls: 0, benchmarkOutcome: false, contract, binding, goal,
    baseline: { traces: baseline.traces.length, actions: baselineActions, coverage: baseline.coverage, results: baselineResults },
    formal: { trace: witness.trace, searchMs: formalSearchMs, failures: failed.failures, validation: witness.validation },
    nonformal: { trace: nonformal, searchMs: nonformalSearchMs, coverage: deeper.coverage, failures: nonformalFailed.failures },
    sameActions: true, sameFailures: true, repairedTraces: repaired.length, repairedAllPassed: true,
    conclusion: 'Both searches detect the same seeded defect with 12 browser actions. This fixture demonstrates depth coverage, not an incremental TLA+ detection advantage.',
    limitations: ['One intentionally constructed cap defect', 'Known shared goal; not blind defect discovery',
      'Search compute not matched; wall times are single local measurements, not performance benchmarks',
      'Fixture repair is manual; no evidence of generative repair efficacy'] };
  await writeFile(path.join(directory, 'comparison.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  log.log(`same actions and failures; first failure step=11; API calls=0; evidence=${directory}`);
  context.diagnostic(JSON.stringify({ baselineTraces: baseline.traces.length, baselineActions,
    witnessActions: witness.trace.actions.length, nonformalActions: nonformal.actions.length,
    firstFailureStep: failed.failures[0].step, formalSearchMs, nonformalSearchMs, evidenceDirectory: directory,
    limitation: evidence.conclusion }));
});