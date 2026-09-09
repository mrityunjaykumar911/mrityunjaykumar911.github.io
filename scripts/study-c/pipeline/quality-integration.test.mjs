import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_PROTOCOL, behaviorHash, validateBehaviorModel } from './behavioral-model.mjs';
import { runImprovementArm } from './quality-loop.mjs';
import { evaluateQualityArtifact } from './quality-evidence.mjs';

const expression = (op, ...args) => ({ op, args });
const count = { var: 'count' };
const contract = { id: 'counter', requirements: [{ id: 'counting', statement: 'Count button presses', sourceQuote: 'Count button presses' }], assumptions: [],
  state: [{ id: 'count', initial: 0, exploreMax: 1 }], actions: [{ id: 'Add', description: 'Tap Add', requirementId: 'counting', enabled: true,
    updates: { count: expression('add', count, 1) } }, { id: 'Reset', description: 'Tap Reset', requirementId: 'counting', enabled: expression('gt', count, 0), updates: { count: 0 } }],
  observables: [{ id: 'count', description: 'displayed count', requirementId: 'counting', expression: count }],
  invariants: [{ id: 'nonnegative', description: 'nonnegative count', requirementId: 'counting', expression: expression('gte', count, 0) }] };
const binding = { setup: [], actions: { Add: [{ op: 'tap', selector: '#add' }], Reset: [{ op: 'tap', selector: '#reset' }] },
  observables: { count: { op: 'number', selector: '#count' } } };
const html = (working) => `<html><body><button id="add" onclick="${working ? 'document.querySelector(\'#count\').textContent++' : 'void 0'}">Add</button><button id="reset" onclick="document.querySelector('#count').textContent=0">Reset</button><span id="count">0</span></body></html>`;

test('full browser/TLC improvement path selects a behavior repair under both matched modes', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-integration-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const task = { id: 'fixture', prompt: 'Count button presses' };
  const model = validateBehaviorModel({ version: MODEL_PROTOCOL, contracts: [contract, { ...contract, id: 'second' }] }, task.prompt);
  const record = { model, modelHash: behaviorHash(model), grounding: { accepted: true } };
  const tracesByMode = [];
  for (const formal of [false, true]) {
    const result = await runImprovementArm({ task, record, formal, directory: path.join(directory, String(formal)),
      initial: { html: html(false), htmlHash: behaviorHash(html(false)) },
      critique: async () => ({ ok: true, score: 14, issues: [] }),
      produce: async () => ({ html: html(true), htmlHash: behaviorHash(html(true)) }),
      evaluate: (args) => evaluateQualityArtifact({ ...args,
        bind: async ({ contract: selected, schedule }) => ({ interfaceContract: { ...selected, traces: schedule.traces }, binding, review: { accepted: true } }),
      }),
    });
    assert.equal(result.report.status, 'complete', JSON.stringify(result.report));
    assert.equal(result.report.decision.selected, 'candidate');
    assert.equal(result.report.decision.reason, 'fewer_behavior_failures');
    assert.equal(result.report.candidateEvidence.status, 'passed');
    tracesByMode.push(result.report.assessment.contracts.map((item) => item.checks.map((check) => check.actions)));
    assert.ok(await readFile(path.join(directory, String(formal), 'selection.json'), 'utf8'));
  }
  assert.deepEqual(tracesByMode[0], tracesByMode[1]);
});

test('TLC checks observation sensitivity at later steps, not just the initial snapshot', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality-later-step-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const { compileBehaviorContract } = await import('./behavioral-model.mjs');
  const { validateSpec } = await import('./tla-oracle.mjs');
  const trace = { actions: ['Add', 'Reset'] };
  for (let step = 0; step < 3; step++) {
    const observations = [{ count: 0 }, { count: 1 }, { count: 0 }];
    observations[step].count++;
    const result = await validateSpec({ specDir: path.join(directory, String(step)), ...compileBehaviorContract(contract, trace, observations) });
    assert.equal(result.violatedInvariant, 'SnapshotMatches');
    assert.equal(result.counterexample.step, step);
  }
});