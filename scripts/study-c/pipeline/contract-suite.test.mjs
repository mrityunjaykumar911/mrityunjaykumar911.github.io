import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runContractSuite } from './contract-suite.mjs';

async function directory(context) {
  const dir = await mkdtemp(path.join(tmpdir(), 'study-c-contracts-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('contracts run concurrently within the cap and keep deterministic isolated results', async (context) => {
  let active = 0;
  let peak = 0;
  const directories = new Set();
  const contracts = ['lifecycle', 'input', 'reload'].map((id) => ({ id, kind: 'tla' }));
  const result = await runContractSuite({ contracts, outDir: await directory(context), concurrency: 2,
    runContract: async ({ evidenceDir }) => {
      active++;
      peak = Math.max(peak, active);
      directories.add(evidenceDir);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return { status: 'passed', validation: { level: 'checked' } };
    } });
  assert.equal(peak, 2);
  assert.equal(directories.size, 3);
  assert.deepEqual(result.contracts.map((contract) => contract.id), ['lifecycle', 'input', 'reload']);
  assert.equal(result.status, 'passed');
});

test('a crashing contract is blocked without hiding another contract failure', async (context) => {
  const result = await runContractSuite({ outDir: await directory(context),
    contracts: [{ id: 'crash', kind: 'tla' }, { id: 'failure', kind: 'tla' }],
    runContract: async ({ contract }) => {
      if (contract.id === 'crash') throw new Error('fixture');
      return { status: 'failed', validation: { level: 'checked' }, failures: [{ step: 1 }] };
    } });
  assert.equal(result.complete, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.contracts[1].status, 'failed');
});

test('unvalidated evidence and duplicate contract IDs fail closed', async (context) => {
  const outDir = await directory(context);
  const result = await runContractSuite({ outDir, contracts: [{ id: 'invalid', kind: 'tla' }],
    runContract: async () => ({ status: 'passed', validation: { level: 'unparseable' } }) });
  assert.equal(result.status, 'blocked');
  await assert.rejects(runContractSuite({ outDir, contracts: [{ id: 'same' }, { id: 'same' }] }));
});