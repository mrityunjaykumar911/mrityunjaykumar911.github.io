import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ROOT, DEFAULT_CATALOG, loadCatalog, catalogGuard, statefulGuard, resultOnly, digest } from './gate.mjs';
import { replay } from './replay.mjs';
import { SCHEDULES } from './schedules.mjs';

export function runExperiment(catalog) {
  const conditions = { 'result-only': resultOnly, 'stateful-guard': statefulGuard, 'tlc-catalog': catalogGuard(catalog) };
  const traces = {};
  const results = [];
  for (const [condition, decide] of Object.entries(conditions)) {
    const started = performance.now();
    const cases = SCHEDULES.map((schedule) => {
      const trace = replay(schedule.actions, decide);
      traces[`${condition}/${schedule.id}`] = trace;
      const unsafe = trace.audit.filter((record) => !record.safe);
      const safe = trace.audit.length - unsafe.length;
      return {
        id: schedule.id, category: schedule.category,
        expectedSafePublications: schedule.expectedSafePublications,
        publications: trace.publications.length, safePublications: safe,
        unsafePublications: unsafe.length,
        satisfied: unsafe.length === 0 && safe === schedule.expectedSafePublications,
        missedExpectedRelease: safe < schedule.expectedSafePublications,
        blockedActions: trace.events.filter((event) => event.outcome === 'blocked').length,
        violationKinds: [...new Set(unsafe.flatMap((record) => record.failures))].sort(),
      };
    });
    results.push({
      condition, scenarios: cases.length,
      satisfiedScenarios: cases.filter((c) => c.satisfied).length,
      unsafeScenarios: cases.filter((c) => c.unsafePublications > 0).length,
      unsafePublications: cases.reduce((sum, c) => sum + c.unsafePublications, 0),
      safePublications: cases.reduce((sum, c) => sum + c.safePublications, 0),
      expectedReleaseScenarios: cases.filter((c) => c.expectedSafePublications > 0).length,
      missedExpectedReleaseScenarios: cases.filter((c) => c.missedExpectedRelease).length,
      replayElapsedMs: Number((performance.now() - started).toFixed(3)),
      cases,
    });
  }
  // The handwritten baseline is expected to be extensionally equivalent.
  // Check entire traces, not just the counts, before reporting agreement.
  for (const schedule of SCHEDULES) {
    assert.deepEqual(traces[`stateful-guard/${schedule.id}`], traces[`tlc-catalog/${schedule.id}`]);
  }
  for (const result of results.filter((r) => r.condition !== 'result-only')) {
    assert.equal(result.satisfiedScenarios, SCHEDULES.length, `${result.condition} failed a declared contract`);
  }
  assert.ok(results[0].unsafeScenarios > 0, 'Fixtures must expose the weak baseline, not report vacuous agreement.');
  return { results, traces };
}

export async function main() {
  const tracePath = path.join(ROOT, '.tools/study-c/replay-traces.json');
  const reportPath = path.join(ROOT, 'paper/figures/study-c.json');
  const tempPath = `${reportPath}.tmp`;
  await mkdir(path.dirname(reportPath), { recursive: true });
  // A failed rerun must not leave an old result looking current.
  await rm(reportPath, { force: true });
  await rm(tempPath, { force: true });
  const { catalog, sha256 } = await loadCatalog();
  const files = ['scripts/study-c/gate.mjs', 'scripts/study-c/replay.mjs',
    'scripts/study-c/schedules.mjs', 'scripts/study-c/run.mjs', 'scripts/study-c/harness.test.mjs'];
  const sourceHashes = {};
  for (const file of files) sourceHashes[file] = digest(await readFile(path.join(ROOT, file)));
  const { results, traces } = runExperiment(catalog);
  const traceBytes = `${JSON.stringify(traces, null, 2)}\n`;
  // Check source stability once more before publishing a report.
  for (const file of files) assert.equal(digest(await readFile(path.join(ROOT, file))), sourceHashes[file]);
  assert.equal(digest(await readFile(DEFAULT_CATALOG)), sha256);
  const report = {
    schemaVersion: 1,
    experiment: 'Study C: seeded release-protocol replay pilot',
    generatedAt: new Date().toISOString(),
    scope: {
      modelCalls: 0, weightUpdates: 0, rlUpdates: 0,
      schedules: SCHEDULES.length, conditions: 3, actualConcurrency: false,
      domain: 'One destination; revision/policy/attempt IDs bounded to 2; max two commits.',
      claim: 'Finite model checks and fixed replay fixtures, not agent performance or an ArtifactsBench score.',
      limitations: [
        'Shared simulator and fact extractor; conformance to TLA+ is tested, not formally proved.',
        'The catalog and handwritten stateful conjunction are equivalent by construction.',
        'Replay timing is a single in-process observation, not a latency or parallel-speedup benchmark.',
        'No real publication, distributed atomicity, ABA/hash handling, or liveness proof.',
        'No model-generated schedules, independent replication, or human-effort measurements.',
      ],
    },
    verification: {
      catalogSha256: sha256, generatedAt: catalog.generatedAt,
      catalogStates: catalog.catalogStates, allowedKeys: catalog.allowedKeys,
      modelChecks: catalog.modelChecks.map((check) => ({ ...check,
        expectedOutcome: check.name.startsWith('mutant-') ? 'ReleaseSafe counterexample found' : 'invariant holds in checked domain',
      })),
      sourceHashes: catalog.sourceHashes, tools: catalog.tools,
    },
    replaySourceHashes: sourceHashes,
    scheduleSha256: digest(JSON.stringify(SCHEDULES)),
    traces: { path: '.tools/study-c/replay-traces.json', sha256: digest(traceBytes) },
    nodeVersion: process.version, statefulAndCatalogTracesIdentical: true, results,
  };
  await mkdir(path.dirname(tracePath), { recursive: true });
  await writeFile(tracePath, traceBytes);
  await writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`);
  await rename(tempPath, reportPath);
  console.table(results.map(({ condition, satisfiedScenarios, scenarios, unsafePublications,
    safePublications, missedExpectedReleaseScenarios }) => ({ condition,
    satisfied: `${satisfiedScenarios}/${scenarios}`, unsafePublications, safePublications, missedExpectedReleaseScenarios })));
  console.log('Stateful and TLC-catalog traces are identical. No model calls, weight changes, or RL.');
  console.log('Report: paper/figures/study-c.json; full traces: .tools/study-c/replay-traces.json');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[study-c] ${error.message}`); process.exitCode = 1; });
}