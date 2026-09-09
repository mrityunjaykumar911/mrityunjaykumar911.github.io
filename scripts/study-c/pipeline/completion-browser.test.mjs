import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { BEHAVIOR_COMPILER_VERSION, behaviorHash } from './behavioral-model.mjs';
import { mutateArtifact, mutationVerdict, runCompletionBrowser } from './completion-browser.mjs';
import { verifySavedCompletionModels } from '../verify-completion-models.mjs';
import { completionBrowserOptions } from '../run-completion-browser.mjs';

test('mutations require one exact source site and preserve literal replacement text', () => {
  assert.equal(completionBrowserOptions(['--config', 'fixture.json', '--key-file', 'fixture-key']).configFile, 'fixture.json');
  assert.throws(() => completionBrowserOptions(['--config', 'fixture.json']));
  const mutation = { id: 'date-save', before: 'due: selected', after: 'due: "$&"' };
  assert.equal(mutateArtifact('item = {due: selected}', mutation), 'item = {due: "$&"}');
  assert.throws(() => mutateArtifact('due: selected due: selected', mutation), /mutation_site_not_unique/);
  assert.throws(() => mutateArtifact('unrelated', mutation), /mutation_site_not_unique/);
});

test('only passing control, real later-step mismatch, and passing restoration establish sensitivity', () => {
  const suite = (status, failures = [], complete = true) => ({ complete, contracts: [{ id: 'Dates', status, failures }] });
  const passed = suite('passed');
  const failed = suite('failed', [{ step: 1, observable: 'date', expected: 1, observed: 0 }]);
  assert.equal(mutationVerdict(passed, failed, passed, ['Dates']), 'detected_and_restored');
  assert.equal(mutationVerdict(passed, passed, passed, ['Dates']), 'not_detected');
  assert.equal(mutationVerdict(passed, suite('blocked', [], false), passed, ['Dates']), 'blocked_mutant_evidence');
  assert.equal(mutationVerdict(suite('failed'), failed, passed, ['Dates']), 'blocked_control_not_passing');
  assert.equal(mutationVerdict(passed, failed, suite('blocked', [], false), ['Dates']), 'blocked_restoration');
  assert.equal(mutationVerdict(passed, suite('failed', [{ step: 0 }]), passed, ['Dates']), 'not_detected');
});

test('browser sensitivity keeps original bindings and records excluded mutation targets', async (context) => {
  assert.equal(typeof verifySavedCompletionModels, 'function');
  const directory = await mkdtemp(path.join(tmpdir(), 'completion-browser-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const contract = { id: 'Record', state: [{ id: 'count', initial: 0, exploreMax: 1 }],
    actions: [{ id: 'Add', enabled: true, updates: { count: { op: 'add', args: [{ var: 'count' }, 1] } } }],
    observables: [{ id: 'count', expression: { var: 'count' } }], invariants: [{ id: 'valid', expression: true }] };
  const model = { contracts: [contract, { ...contract, id: 'Category' }] };
  const source = { model, modelHash: behaviorHash(model), grounding: { accepted: false,
    contracts: [{ id: 'Record', accepted: true, reason: 'fixture' }, { id: 'Category', accepted: false, reason: 'unsupported' }] } };
  const preflight = { sourceModelHash: source.modelHash, compilerVersion: BEHAVIOR_COMPILER_VERSION,
    contracts: model.contracts.map((item) => ({ id: item.id, validation: { level: 'checked' } })) };
  let bindings = 0;
  const report = await runCompletionBrowser({ source, preflight, html: 'save original', directory,
    mutations: [{ id: 'record', before: 'original', after: 'broken', contractIds: ['Record'] },
      { id: 'category', before: 'original', after: 'broken', contractIds: ['Category'] }],
    bind: async ({ html }) => { bindings++; assert.equal(html, 'save original'); return { binding: 'frozen' }; },
    evaluate: async ({ bind, html, record }) => {
      await bind({ contract: record.model.contracts[0], html });
      return { complete: true, contracts: [{ id: 'Record', status: html.includes('broken') ? 'failed' : 'passed',
        failures: html.includes('broken') ? [{ step: 2, observable: 'count', expected: 1, observed: 0 }] : [] }] };
    } });
  assert.equal(bindings, 1);
  assert.equal(report.mutations[0].status, 'detected_and_restored');
  assert.equal(report.mutations[1].status, 'blocked_control_not_passing');
  assert.equal(report.coverage.generated, 2);
  assert.equal(report.coverage.eligible, 1);
  assert.equal(report.browserGate, 'incomplete');
  const sourceFile = path.join(directory, 'source-fixture.json');
  await writeFile(sourceFile, JSON.stringify(source), 'utf8');
  await verifySavedCompletionModels({ sourceFile: path.relative(process.cwd(), sourceFile),
    directory: path.relative(process.cwd(), path.join(directory, 'recheck')), java: '.tools/java/fixture.exe', taskId: 'fixture',
    validate: async ({ specDir, java }) => {
      assert.ok(path.isAbsolute(specDir));
      assert.equal(java, path.resolve('.tools/java/fixture.exe'));
      return { level: 'checked', distinctStates: 2 };
    } });
});