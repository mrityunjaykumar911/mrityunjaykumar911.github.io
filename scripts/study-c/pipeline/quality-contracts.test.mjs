import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assessGrounding, authorQualityModel, eligibleQualityRecord, requestOnce, MODEL_GENERATOR, GROUNDING_REVIEW, TEST_ENVIRONMENT } from './quality-contracts.mjs';
import { BEHAVIOR_COMPILER_VERSION, MODEL_PROTOCOL, behaviorHash } from './behavioral-model.mjs';
import { captureGeneratedTraces } from './generated-browser.mjs';

test('review must cover every generated contract and explicitly accept each obligation', () => {
  const model = { contracts: [{ id: 'Count' }, { id: 'Reset' }] };
  assert.throws(() => assessGrounding(model, { contracts: [{ id: 'Count', accepted: true, reason: 'valid' }] }));
  assert.equal(assessGrounding(model, { contracts: [{ id: 'Count', accepted: true, reason: 'valid' },
    { id: 'Reset', accepted: false, reason: 'Unsupported default' }] }).accepted, false);
  assert.match(MODEL_GENERATOR, /2030-01-01T12:00:00Z/);
  assert.match(MODEL_GENERATOR, /SEARCH ONLY/);
  assert.match(MODEL_GENERATOR, /completion:optional \{when:boolean expression,requirementId,reason:string\}/);
  assert.match(GROUNDING_REVIEW, /Reject premature completion/);
});

test('request cache preserves rejected responses and avoids an unrecorded second paid call', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-request-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const args = { directory, client: { generate: async () => { calls++; return { ok: false, reason: 'fixture' }; } },
    prompt: 'task only', system: 'review', purpose: 'fixture', maxOutputTokens: 10 };
  await requestOnce(args);
  await requestOnce(args);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'response.json'), 'utf8')).ok, false);
  await assert.rejects(requestOnce({ ...args, prompt: 'different' }), /request_cache_mismatch/);
});

test('touch contracts receive actual touch pointer events, not synthetic mouse clicks', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-touch-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const contract = { actions: [{ id: 'Touch' }], observables: [{ id: 'touches' }], traces: [{ id: 'touch', actions: ['Touch'] }] };
  const binding = { setup: [], actions: { Touch: [{ op: 'tap', selector: '#touch' }] }, observables: { touches: { op: 'number', selector: '#count' } } };
  const html = '<html><body><button id="touch">Touch</button><span id="count">0</span><script>document.querySelector("#touch").onpointerdown = event => { if (event.pointerType === "touch") document.querySelector("#count").textContent++; };</script></body></html>';
  const [result] = await captureGeneratedTraces({ contract, binding, html, outDir: directory });
  assert.equal(result.status, 'recorded');
  assert.deepEqual(result.snapshots, [{ touches: 0 }, { touches: 1 }]);
});

test('generator and reviewer receive the same execution environment and no evaluator scores', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-environment-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const contract = { id: 'counter', requirements: [{ id: 'counting', statement: 'Count', sourceQuote: 'Count' }], assumptions: [],
    state: [{ id: 'count', initial: 0, exploreMax: 1 }],
    actions: [{ id: 'Add', description: 'Add one', requirementId: 'counting', enabled: true, updates: { count: { op: 'add', args: [{ var: 'count' }, 1] } } }],
    observables: [{ id: 'count', description: 'count', requirementId: 'counting', expression: { var: 'count' } }],
    invariants: [{ id: 'positive', description: 'nonnegative', requirementId: 'counting', expression: { op: 'gte', args: [{ var: 'count' }, 0] } }] };
  const model = { version: MODEL_PROTOCOL, contracts: [contract, { ...contract, id: 'other' }] };
  let calls = 0;
  const record = await authorQualityModel({ task: { id: 42, prompt: 'Count', score: 99 }, directory, client: {
    generate: async ({ prompt }) => {
      const input = JSON.parse(prompt);
      assert.deepEqual(input.environment, TEST_ENVIRONMENT);
      assert.equal(input.task, 'Count');
      assert.equal(Object.hasOwn(input, 'score'), false);
      calls++;
      return { ok: true, text: JSON.stringify(calls === 1 ? model : { contracts: model.contracts.map((item) => ({ id: item.id, accepted: true, reason: 'reviewed' })) }) };
    },
  } });
  assert.equal(calls, 2);
  assert.deepEqual(record.environment, TEST_ENVIRONMENT);
  assert.equal(record.compilerVersion, BEHAVIOR_COMPILER_VERSION);
});

test('eligibility excludes undeclared dead ends but not explicit completion or a search frontier', () => {
  const counter = { id: 'counter', state: [{ id: 'count', initial: 0, exploreMax: 1 }],
    actions: [{ id: 'Add', enabled: true, updates: { count: { op: 'add', args: [{ var: 'count' }, 1] } } }] };
  const finite = { ...counter, id: 'finite', actions: [{ ...counter.actions[0], enabled: { op: 'eq', args: [{ var: 'count' }, 0] } }] };
  const completed = { ...finite, id: 'completed', completion: { when: { op: 'eq', args: [{ var: 'count' }, 1] },
    requirementId: 'counting', reason: 'The single-increment test scenario is complete.' } };
  const model = { contracts: [counter, finite, completed] };
  const source = { model, modelHash: behaviorHash(model), grounding: { accepted: true,
    contracts: model.contracts.map((contract) => ({ id: contract.id, accepted: true, reason: 'fixture accepted' })) } };
  const before = JSON.stringify(source);
  const scoped = eligibleQualityRecord(source);
  assert.deepEqual(scoped.coverage.eligibleIds, ['counter', 'completed']);
  assert.equal(scoped.coverage.generated, 3);
  assert.equal(scoped.coverage.full, false);
  assert.equal(scoped.coverage.excluded[0].id, 'finite');
  assert.equal(scoped.coverage.excluded[0].reason, 'undeclared_model_dead_end');
  assert.equal(scoped.coverage.excluded[0].coverage.undeclaredDeadEnds, 1);
  assert.equal(JSON.stringify(source), before);
});

test('saved 1097 rejection retains the two accepted contracts without modifying archived evidence', async (context) => {
  const filename = new URL('../../../.tools/study-c/quality-runs/quality-v2-1097-first/task-1097/shared-model/model.json', import.meta.url);
  let source;
  try { source = await readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('local archived run unavailable'); return; } throw error; }
  const scoped = eligibleQualityRecord(JSON.parse(source));
  assert.deepEqual(scoped.coverage.eligibleIds, ['two_side_point_counting', 'sides_stay_independent']);
  assert.equal(scoped.coverage.generated, 3);
  assert.equal(scoped.coverage.full, false);
  assert.equal(scoped.coverage.excluded[0].id, 'html_mobile_runtime');
  assert.equal(await readFile(filename, 'utf8'), source);
});