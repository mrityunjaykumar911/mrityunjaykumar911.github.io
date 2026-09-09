import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { invariantNames, tlaArm, tlaCacheIdentity, verifiedTFeedback, validateSpec } from './tla-oracle.mjs';

const tla = `---- MODULE TaskSpec ----
EXTENDS Naturals
VARIABLE score
Init == score = 0
Next == score' = IF score < 2 THEN score + 1 ELSE 0
TypeOK == score \\in Nat
ScoreNonNegative == score >= 0
====`;
const cfg = 'INIT Init\nNEXT Next\nINVARIANTS\n  TypeOK\n  ScoreNonNegative\n';

async function directory(context) {
  const dir = await mkdtemp(path.join(tmpdir(), 'study-c-tla-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('collects all multiline and repeated invariant declarations', () => {
  assert.deepEqual(invariantNames(`${cfg}CONSTANT Limit = 2\nINVARIANT WinByTwo \\* note\n`),
    ['TypeOK', 'ScoreNonNegative', 'WinByTwo']);
});

test('SANY and TLC run in the directory containing the saved module', async (context) => {
  const specDir = await directory(context);
  const calls = [];
  const result = await validateSpec({ specDir, tla, cfg, java: 'test-java', runProcess: async (_java, args, _timeout, cwd) => {
    calls.push(args);
    assert.equal(cwd, specDir);
    assert.equal(await readFile(path.join(cwd, 'TaskSpec.tla'), 'utf8'), tla);
    return { status: 0, signal: null, timedOut: false, output: args.includes('tla2sany.SANY')
      ? 'Semantic processing of module TaskSpec'
      : 'Model checking completed. No error has been found.\n3 distinct states found' };
  } });
  assert.equal(result.level, 'checked');
  assert.equal(calls.length, 2);
});

test('SANY semantic errors prevent TLC execution even with exit zero', async (context) => {
  let calls = 0;
  const result = await validateSpec({ specDir: await directory(context), tla, cfg, java: 'test-java', runProcess: async () => {
    calls++;
    return { status: 0, output: 'Semantic processing of module TaskSpec\nSemantic errors:' };
  } });
  assert.equal(result.level, 'unparseable');
  assert.equal(calls, 1);
});

test('Java crashes and malformed invariant lists are not app or syntax failures', async (context) => {
  const crashed = await validateSpec({ specDir: await directory(context), tla, cfg, java: 'test-java',
    runProcess: async () => ({ status: 0, output: 'java.lang.NullPointerException: Cannot invoke String.length()' }) });
  assert.equal(crashed.detail, 'sany_tool_failure');
  assert.equal(crashed.failureKind, 'infrastructure');
  const invalid = await validateSpec({ specDir: await directory(context), tla, cfg: 'INVARIANTS TypeOK, Nonnegative' });
  assert.equal(invalid.detail, 'invalid_invariant_configuration');
  assert.equal(invalid.failureKind, 'invalid_specification');
});

test('simultaneous validators use distinct JVM temp and state directories', async (context) => {
  const scratch = [];
  const jobs = await Promise.all([directory(context), directory(context), directory(context)]);
  const results = await Promise.all(jobs.map((specDir) => validateSpec({ specDir, tla, cfg, java: 'test-java',
    runProcess: async (_java, args) => {
      const temp = args.find((arg) => arg.startsWith('-Djava.io.tmpdir='));
      assert.ok(temp);
      scratch.push(temp);
      if (args.includes('tlc2.TLC')) assert.equal(args[args.indexOf('-metadir') + 1], path.join(temp.slice('-Djava.io.tmpdir='.length), 'states'));
      return { status: 0, output: args.includes('tla2sany.SANY') ? 'Semantic processing of module TaskSpec'
        : 'Model checking completed. No error has been found.\n3 distinct states found' };
    } })));
  assert.equal(new Set(scratch).size, 6);
  assert.ok(results.every((result) => result.level === 'checked'));
});

test('real parallel validators safely load the shared standard-library imports', async (context) => {
  const imported = tla.replace('EXTENDS Naturals', 'EXTENDS Naturals, Integers, Sequences, FiniteSets, TLC');
  const dirs = await Promise.all([directory(context), directory(context), directory(context)]);
  const results = await Promise.all(dirs.map((specDir) => validateSpec({ specDir, tla: imported, cfg })));
  assert.ok(results.every((result) => result.level === 'checked'), JSON.stringify(results));
});

test('TLC timeout and invariant violation cannot produce checked evidence', async (context) => {
  for (const failure of [
    { status: null, timedOut: true, output: '' },
    { status: 12, output: 'Invariant ScoreNonNegative is violated.\nModel checking completed.' },
  ]) {
    const result = await validateSpec({ specDir: await directory(context), tla, cfg, java: 'test-java', runProcess: async (_java, args) =>
      args.includes('tla2sany.SANY') ? { status: 0, output: 'Semantic processing of module TaskSpec' } : failure });
    assert.notEqual(result.level, 'checked');
  }
});

test('real local SANY and TLC validate a finite fixture', async (context) => {
  const result = await validateSpec({ specDir: await directory(context), tla, cfg });
  assert.equal(result.level, 'checked', JSON.stringify(result));
  assert.equal(result.distinctStates, 3);
});

test('ping-pong contract validates bounds separately and rejects wrong browser snapshots', async (context) => {
  const model = await readFile(new URL('../../../formal/study-c/ping-pong/TaskSpec.tla', import.meta.url), 'utf8');
  const config = await readFile(new URL('../../../formal/study-c/ping-pong/TaskSpec.cfg', import.meta.url), 'utf8');
  const specDir = await directory(context);
  const checked = await validateSpec({ specDir, tla: model, cfg: config });
  assert.equal(checked.level, 'checked', `${JSON.stringify(checked)}\n${await readFile(path.join(specDir, 'tlc.log'), 'utf8')}`);
  const replay = config.replace('Replay = FALSE', 'Replay = TRUE');
  const replayModel = model.replace('ReplayActions == <<>>', 'ReplayActions == <<"A">>')
    .replace('ReplayObservedA == <<>>', 'ReplayObservedA == <<0, 0>>')
    .replace('ReplayObservedB == <<>>', 'ReplayObservedB == <<0, 0>>');
  const wrong = await validateSpec({ specDir: await directory(context), tla: replayModel, cfg: replay });
  assert.equal(wrong.violatedInvariant, 'SnapshotMatches', JSON.stringify(wrong));
  assert.deepEqual(wrong.counterexample, { scoreA: 1, scoreB: 0, step: 1 });
});

const binding = { scoreA: '#scoreA', scoreB: '#scoreB', pointA: '#pointA', pointB: '#pointB', reset: ['#reset'] };
const artifact = { extracted: { content: '<html>fixture</html>' } };
const task = { id: 1097, prompt: 'Create a mobile ping-pong score counter.' };
const noCalls = { generate: () => { throw new Error('unexpected_model_call'); } };

test('failed formal validation blocks all downstream work and produces no repair prompt', async (context) => {
  let modelCalls = 0;
  let browserCalls = 0;
  const result = await tlaArm({ task, artifact, evidenceDir: await directory(context),
    client: { generate: () => { modelCalls++; } }, capture: () => { browserCalls++; },
    validate: async () => ({ level: 'unparseable', detail: 'sany_parse_error' }) });
  assert.equal(result.ok, false);
  assert.equal(result.repairPrompt, null);
  assert.equal(result.reason, 'formal_validation_failed');
  assert.equal(modelCalls, 0);
  assert.equal(browserCalls, 0);
});

test('passing executed traces do not trigger a speculative repair', async (context) => {
  let repairs = 0;
  const result = await tlaArm({ task, artifact, client: noCalls, binding, evidenceDir: await directory(context),
    validate: async () => ({ level: 'checked' }),
    capture: async () => [{ id: 'point', status: 'recorded', actions: ['A'], snapshots: [{ scoreA: 0, scoreB: 0 }, { scoreA: 1, scoreB: 0 }] }],
    repairPrompt: () => { repairs++; } });
  assert.equal(result.ok, true);
  assert.equal(result.repairPrompt, null);
  assert.equal(repairs, 0);
  assert.equal(verifiedTFeedback(result, await tlaCacheIdentity(artifact.extracted.content)), true);
});

test('only executed snapshot violations become repair feedback', async (context) => {
  let calls = 0;
  const result = await tlaArm({ task, artifact, client: noCalls, binding, evidenceDir: await directory(context),
    validate: async () => ++calls === 1 ? { level: 'checked' } :
      { level: 'parsed', violatedInvariant: 'SnapshotMatches', counterexample: { scoreA: 1, scoreB: 0, step: 1 } },
    capture: async () => [{ id: 'point', status: 'recorded', actions: ['A'], snapshots: [{ scoreA: 0, scoreB: 0 }, { scoreA: 0, scoreB: 0 }] }],
    repairPrompt: ({ findings }) => findings });
  assert.equal(result.ok, true);
  assert.equal(result.replay.failures.length, 1);
  assert.match(result.repairPrompt, /"scoreA": 1/);
  assert.match(result.repairPrompt, /no fixed score cap/);
});

test('legacy advisory feedback and different artifacts are not valid T caches', async () => {
  const identity = await tlaCacheIdentity(artifact.extracted.content);
  assert.equal(verifiedTFeedback({ kind: 'tla', validation: { level: 'unparseable' } }, identity), false);
  assert.notEqual(identity.key, (await tlaCacheIdentity('<html>changed</html>')).key);
});

test('tasks without a checked contract fail closed without API calls', async () => {
  const result = await tlaArm({ task: { id: 1267 }, artifact, client: noCalls });
  assert.equal(result.reason, 'unsupported_formal_contract');
  assert.equal(result.repairPrompt, null);
});