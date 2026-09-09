import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ROOT, DEFAULT_CATALOG, FACT_NAMES, loadCatalog, validateCatalog,
  factKey, resultOnly, statefulGuard, catalogGuard,
} from './gate.mjs';
import { replay, auditPublications } from './replay.mjs';
import { SCHEDULES } from './schedules.mjs';
import { runExperiment } from './run.mjs';

// Integration tests use the actual locally verified catalog, never synthesize
// a substitute if verification is missing. Run npm run study:c:verify first.
const { catalog } = await loadCatalog();
const table = catalogGuard(catalog);
const factsFrom = (bits) => Object.fromEntries(FACT_NAMES.map((name, i) => [name, bits[i] === '1']));
const byId = (id) => SCHEDULES.find((schedule) => schedule.id === id);

test('TLC records expected mutant violations, safe exploration, and one authorized key', () => {
  assert.equal(catalog.modelChecks.length, 9);
  assert.equal(catalog.modelChecks.filter((check) => check.name.startsWith('mutant-')).length, 7);
  assert.deepEqual(catalog.allowedKeys, ['11111111']);
  assert.equal(catalog.catalogStates, 256);
});

test('all 256 gate inputs agree with the explicit stateful baseline', () => {
  let allowed = 0;
  for (let i = 0; i < 256; i++) {
    const key = i.toString(2).padStart(8, '0');
    const facts = factsFrom(key);
    assert.equal(factKey(facts), key);
    assert.equal(table(facts), statefulGuard(facts), key);
    assert.equal(table(facts), i === 255, key);
    assert.equal(resultOnly(facts), key[0] === '1');
    allowed += Number(table(facts));
  }
  assert.equal(allowed, 1);
});

test('each individual missing enabling fact blocks', () => {
  for (const name of FACT_NAMES) {
    const facts = factsFrom('11111111');
    facts[name] = false;
    assert.equal(table(facts), false, name);
  }
});

test('unknown, missing, non-Boolean, and extra facts fail shut', () => {
  for (const decide of [resultOnly, statefulGuard, table]) {
    for (const value of [null, undefined, 1, 0, 'true']) {
      assert.throws(() => decide({ ...factsFrom('11111111'), checksPassed: value }), /Boolean facts/);
    }
    assert.throws(() => decide({ checksPassed: true }), /Boolean facts/);
    assert.throws(() => decide({ ...factsFrom('11111111'), agentSaysSafe: true }), /Boolean facts/);
  }
});

test('incomplete, reordered, or corrupted catalog evidence is refused', () => {
  for (const modify of [
    (c) => { c.allowedKeys.push('01111111'); },
    (c) => { c.factNames.reverse(); },
    (c) => { c.modelChecks.pop(); },
    (c) => { c.modelChecks[3].passed = false; },
    (c) => { c.modelChecks[0].distinctStates = 255; },
    (c) => { c.sourceHashes['unexpected-source'] = '0'.repeat(64); },
    (c) => { c.tools.tlcSha256 = '0'.repeat(64); },
  ]) {
    const broken = structuredClone(catalog);
    modify(broken);
    assert.throws(() => validateCatalog(broken));
  }
});

test('catalog loader detects stale sources without modifying workspace inputs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'study-c-test-'));
  try {
    for (const filename of Object.keys(catalog.sourceHashes)) {
      const destination = path.join(root, filename);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(ROOT, filename), destination);
    }
    await mkdir(path.join(root, '.tools'), { recursive: true });
    await copyFile(path.join(ROOT, '.tools/tla2tools.jar'), path.join(root, '.tools/tla2tools.jar'));
    await loadCatalog({ root, filename: DEFAULT_CATALOG });
    const model = path.join(root, 'formal/agent/ReleaseGate.tla');
    await writeFile(model, `${await readFile(model, 'utf8')}\n`);
    await assert.rejects(loadCatalog({ root, filename: DEFAULT_CATALOG }), /Stale TLC catalog/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const schedule of SCHEDULES) {
  test(`schedule ${schedule.id}: output audit and positive/negative control`, () => {
    const strong = replay(schedule.actions, statefulGuard);
    const formal = replay(schedule.actions, table);
    assert.deepEqual(formal, strong);
    assert.equal(formal.publications.length, schedule.expectedSafePublications);
    assert.ok(formal.audit.every((record) => record.safe));
  });
}

test('ticket revalidation blocks even when all seven live facts are good', () => {
  const schedule = byId('old-ticket-after-fresh-evidence');
  const formal = replay(schedule.actions, table);
  assert.equal(formal.events.at(-1).factKey, '11111110');
  assert.equal(formal.events.at(-1).outcome, 'blocked');
  const weak = replay(schedule.actions, resultOnly);
  assert.equal(weak.publications[0].artifact.revision, 1);
  assert.equal(weak.publications[0].revision, 2);
  assert.ok(weak.audit[0].failures.includes('stale-artifact'));
  assert.ok(weak.audit[0].failures.includes('superseded-attempt'));
});

test('late completions retain their original attempt identity', () => {
  const formal = replay(byId('late-superseded-result').actions, table);
  const snapshot = formal.events.at(-1).after;
  assert.equal(snapshot.attempt, 2);
  assert.equal(snapshot.evidence.attempt, 1);
  assert.equal(snapshot.evidence.status, 'success');
  assert.equal(snapshot.publications.length, 0);
});

test('duplicate append is observable and rejected by output audit', () => {
  const weak = replay(byId('duplicate-commit').actions, resultOnly);
  assert.equal(weak.audit.length, 2);
  assert.deepEqual(weak.audit.map((record) => record.safe), [true, false]);
  assert.deepEqual(weak.audit[1].failures, ['duplicate-release']);
});

test('audit inspects published bytes metadata and commit context, not a gate flag', () => {
  const [valid] = replay(byId('valid-release').actions, table).publications;
  for (const [field, value, violation] of [
    ['status', 'unknown', 'checks-not-successful'],
    ['inventory', false, 'inventory-incomplete'],
    ['revision', 0, 'stale-artifact'],
    ['policy', 0, 'stale-policy'],
    ['attempt', 0, 'superseded-attempt'],
  ]) {
    const bad = structuredClone(valid);
    bad.artifact[field] = value;
    bad.allowed = true; // Not consulted by the oracle.
    assert.ok(auditPublications([bad])[0].failures.includes(violation));
  }
  assert.deepEqual(auditPublications([{ ...valid, cancelled: true }])[0].failures, ['cancelled']);
});

test('block-everything is detected by positive release controls', () => {
  const blocked = replay(byId('valid-release').actions, () => false);
  assert.equal(blocked.publications.length, 0);
  assert.notEqual(blocked.publications.length, byId('valid-release').expectedSafePublications);
});

test('malformed actions and unknown decisions abort rather than publish', () => {
  assert.throws(() => replay([{ type: 'unrecognized' }], table), /Unknown replay action/);
  assert.throws(() => replay([{ type: 'finish', attempt: 1, status: 'success', inventory: 'true' }], table), /Malformed completion/);
  assert.throws(() => replay(byId('valid-release').actions, () => undefined), /Unknown gate decision/);
  assert.throws(() => replay(byId('valid-release').actions, () => 'allow'), /Unknown gate decision/);
});

test('complete three-way experiment has identical strong traces and exposes baseline faults', () => {
  assert.equal(new Set(SCHEDULES.map((s) => s.id)).size, SCHEDULES.length);
  const { results } = runExperiment(catalog);
  assert.ok(results[0].unsafePublications > 0);
  assert.equal(results[1].unsafePublications, 0);
  assert.equal(results[2].missedExpectedReleaseScenarios, 0);
});