import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatorHeapMb, validateSpec } from './tla-oracle.mjs';

test('validator heap is bounded and rejects invalid configuration', () => {
  assert.equal(validatorHeapMb(512), 512);
  assert.equal(validatorHeapMb('1024'), 1024);
  for (const value of ['', 0, -1, 63, 8193, '1g', 1024.5, NaN, Infinity]) {
    assert.throws(() => validatorHeapMb(value), /invalid_validator_heap_mb/);
  }
});

test('both validator JVMs use and record the requested 1 GB heap', async (context) => {
  const specDir = await mkdtemp(path.join(tmpdir(), 'study-c-heap-'));
  const scratch = [];
  context.after(async () => {
    await rm(specDir, { recursive: true, force: true });
    await Promise.all(scratch.map((directory) => rm(directory, { recursive: true, force: true })));
  });
  let calls = 0;
  const result = await validateSpec({ specDir, tla: 'fixture', cfg: 'INVARIANT TypeOK', java: 'test-java', heapMb: 1024,
    runProcess: async (_java, args) => {
      calls++;
      assert.ok(args.includes('-Xmx1024m'));
      assert.equal(args.includes('-Xmx512m'), false);
      scratch.push(args.find((arg) => arg.startsWith('-Djava.io.tmpdir=')).slice('-Djava.io.tmpdir='.length));
      return { status: 0, output: args.includes('tla2sany.SANY') ? 'Semantic processing of module TaskSpec'
        : 'Model checking completed. No error has been found.\n3 distinct states found' };
    } });
  assert.equal(result.level, 'checked');
  assert.equal(calls, 2);
  assert.equal(JSON.parse(await readFile(path.join(specDir, 'execution.json'), 'utf8')).heapMb, 1024);
});