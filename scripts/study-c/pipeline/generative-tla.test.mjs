import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateGeneratedContract, generativeTlaArm, generatedCacheIdentity, verifiedGeneratedFeedback } from './generative-tla.mjs';
import { GENERATIVE_PROTOCOL } from './task-contracts.mjs';

const model = `---- MODULE TaskSpec ----
EXTENDS Naturals, Sequences
CONSTANTS ReplayMode, InputActions, InputObserved
VARIABLES amount, step
ReplayActions == <<>>
ReplayObserved == <<>>
Init == amount = 0 /\\ step = 0
Next == IF ReplayMode THEN IF step < Len(InputActions) THEN /\\ amount' = amount + 1 /\\ step' = step + 1
                          ELSE UNCHANGED <<amount, step>>
        ELSE /\\ amount' = (IF amount < 2 THEN amount + 1 ELSE 0) /\\ UNCHANGED step
TypeOK == amount \\in Nat /\\ step \\in Nat
Nonnegative == amount >= 0
SnapshotMatches == IF ReplayMode THEN InputObserved[step+1].amount = amount ELSE TRUE
====`;
const contract = { id: 'increment', kind: 'tla', requirement: 'Count increments', sourceQuote: 'Count increments',
  observables: [{ id: 'amount', description: 'count' }], actions: [{ id: 'Add', description: 'press Add once' }],
  traces: [{ id: 'add', actions: ['Add'] }], tla: model,
  cfg: 'INIT Init\nNEXT Next\nCONSTANTS ReplayMode = FALSE\nInputActions <- ReplayActions\nInputObserved <- ReplayObserved\nINVARIANTS TypeOK Nonnegative SnapshotMatches\n' };

async function directory(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'generated-tla-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('actual generated-interface model accepts correct snapshots and detects a browser mismatch', async (context) => {
  const root = await directory(context);
  for (const [name, amount] of [['correct', 1], ['mutant', 0]]) {
    const result = await evaluateGeneratedContract({ contract, html: '', evidenceDir: path.join(root, name),
      bind: async () => ({}), capture: async () => [{ id: 'add', actions: ['Add'], status: 'recorded', snapshots: [{ amount: 0 }, { amount }] }] });
    assert.equal(result.status, name === 'correct' ? 'passed' : 'failed', JSON.stringify(result));
    assert.equal(result.probes[0].check.counterexample.step, 0);
  }
});

test('vacuous generated predicates cannot be accepted as passing evidence', async (context) => {
  const result = await evaluateGeneratedContract({ contract, html: '', evidenceDir: await directory(context),
    bind: async () => ({}), capture: async () => [{ id: 'add', actions: ['Add'], status: 'recorded', snapshots: [{ amount: 0 }, { amount: 1 }] }],
    validate: async () => ({ level: 'checked', distinctStates: 2 }) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'unobserved_or_vacuous_generated_invariant');
});

test('multiple generated contracts control repair; old fixed-contract cache cannot pass', async (context) => {
  const generatedContracts = { protocolVersion: GENERATIVE_PROTOCOL, contractSha256: 'generated-hash', contracts: [contract, { ...contract, id: 'other' }] };
  const artifact = { extracted: { content: '<html>fixture</html>' } };
  let repairs = 0;
  const result = await generativeTlaArm({ generatedContracts, artifact, evidenceDir: await directory(context),
    task: { id: 12345 }, repairPrompt: () => { repairs++; },
    evaluate: async () => ({ status: 'passed', validation: { level: 'checked' }, failures: [] }) });
  assert.equal(repairs, 0);
  assert.equal(result.repairPrompt, null);
  const identity = generatedCacheIdentity(artifact.extracted.content, generatedContracts);
  assert.equal(verifiedGeneratedFeedback(result, identity), true);
  assert.equal(verifiedGeneratedFeedback({ ...result, protocolVersion: 'ping-pong-replay-v1' }, identity), false);
});