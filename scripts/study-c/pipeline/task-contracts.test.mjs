import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateTaskContracts, parseContractResponse, generatedReplaySpecification } from './task-contracts.mjs';

export function contractFixture(id, sourceQuote) {
  return { id, sourceQuote, requirement: sourceQuote,
    observables: [{ id: 'amount', description: 'number of recorded items' }],
    actions: [{ id: 'Add', description: 'add one item' }], traces: [{ id: 'single-add', actions: ['Add'] }],
    tla: `---- MODULE TaskSpec ----
EXTENDS Naturals, Sequences
CONSTANTS ReplayMode, InputActions, InputObserved
VARIABLES amount, step
ReplayActions == <<>>
ReplayObserved == <<>>
Init == amount = 0 /\\ step = 0
Next == IF ReplayMode THEN IF step < Len(InputActions) THEN amount' = amount + 1 /\\ step' = step + 1 ELSE UNCHANGED <<amount, step>>
        ELSE amount' = IF amount < 2 THEN amount + 1 ELSE 0 /\\ UNCHANGED step
TypeOK == amount \\in Nat /\\ step \\in Nat
Nonnegative == amount >= 0
SnapshotMatches == IF ReplayMode THEN InputObserved[step+1].amount = amount ELSE TRUE
====`,
    cfg: 'INIT Init\nNEXT Next\nCONSTANTS ReplayMode = FALSE\nInputActions <- ReplayActions\nInputObserved <- ReplayObserved\nINVARIANTS TypeOK Nonnegative SnapshotMatches\n' };
}

test('contracts come from the model for arbitrary tasks; artifact and judge data are excluded', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'generative-contracts-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [id, prompt] of [[42, 'Record appointments'], [999, 'Count points']]) {
    let calls = 0;
    const client = { generate: async (request) => {
      calls++;
      assert.equal(request.prompt, prompt);
      assert.equal(request.system.includes('<html>secret</html>'), false);
      return { ok: true, text: JSON.stringify({ contracts: [contractFixture(`first-${id}`, prompt), contractFixture(`second-${id}`, prompt)] }) };
    } };
    const args = { task: { id, prompt, artifact: '<html>secret</html>', score: 75 }, client, outDir: path.join(root, String(id)) };
    const first = await generateTaskContracts(args);
    const second = await generateTaskContracts(args);
    assert.equal(calls, 1);
    assert.equal(first.contracts[0].id, `first-${id}`);
    assert.equal(second.cached, true);
    assert.equal(first.contractSha256, second.contractSha256);
    assert.ok(await readFile(path.join(args.outDir, 'generation.json'), 'utf8'));
  }
});

test('ungrounded, unsafe and incomplete generated contracts are rejected', () => {
  const prompt = 'Record items';
  const contracts = [contractFixture('one', prompt), contractFixture('two', prompt)];
  const parse = () => parseContractResponse(JSON.stringify({ contracts }), prompt);
  assert.equal(parse().length, 2);
  contracts[0].sourceQuote = 'invented persistence requirement';
  assert.throws(parse, /ungrounded/);
  contracts[0].sourceQuote = prompt;
  contracts[0].tla += '\nEXTENDS IOUtils';
  assert.throws(parse, /unsupported_model_extension/);
});

test('replay values are serialized data, never model-generated browser verdicts', () => {
  const contract = contractFixture('one', 'Record items');
  const spec = generatedReplaySpecification(contract, contract.traces[0], [{ amount: 0 }, { amount: 1 }]);
  assert.match(spec.cfg, /ReplayMode = TRUE/);
  assert.match(spec.tla, /amount \|-> 1/);
  assert.throws(() => generatedReplaySpecification(contract, contract.traces[0], [{ amount: 0 }, { amount: 'malicious' }]));
});