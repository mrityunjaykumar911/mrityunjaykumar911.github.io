import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ENDPOINT, MODEL, requestSanity, runSanity } from './xai-sanity.mjs';

const key = 'xai-FAKE_LOCAL_TEST_VALUE_NOT_A_REAL_KEY';
function success(text = 'SANITY_OK') {
  return new Response(JSON.stringify({
    id: 'test_response', object: 'response', status: 'completed', created_at: 1, model: MODEL,
    output: [{ type: 'message', role: 'assistant', id: 'test_message', status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('real Node SDK serializes one Responses request with store false and bounded output', async () => {
  let calls = 0;
  const result = await requestSanity({ key, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(String(url), ENDPOINT);
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${key}`);
    const body = JSON.parse(init.body);
    assert.equal(body.model, MODEL);
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 256);
    assert.ok(!body.previous_response_id);
    assert.ok(!body.tools?.length);
    assert.ok(!init.body.includes(key));
    return success();
  } });
  assert.equal(calls, 1);
  assert.equal(result.outcome, 'passed');
  assert.equal(result.exactModelReturned, true);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  assert.equal(result.telemetryEnabled, false);
});

test('SDK does not retry retryable HTTP errors or expose server-echoed credentials', async () => {
  for (const status of [400, 401, 429, 500]) {
    let calls = 0;
    const result = await requestSanity({ key, fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: `failure ${key}`, type: 'server_error' } }), {
        status, headers: { 'content-type': 'application/json' },
      });
    } });
    assert.equal(calls, 1);
    assert.equal(result.outcome, 'api_rejected');
    assert.equal(result.httpStatus, status);
    assert.ok(!JSON.stringify(result).includes(key));
  }
});

test('raw response text and reasoning are not persisted even when unexpected', async () => {
  const result = await requestSanity({ key, fetchImpl: async () => success(key) });
  assert.equal(result.outcome, 'response_received_unexpected_text');
  assert.ok(!JSON.stringify(result).includes(key));
});

test('transport failure retains unknown outcome without retries or secret errors', async () => {
  let calls = 0;
  const result = await requestSanity({ key, fetchImpl: async () => { calls++; throw new Error(key); } });
  assert.equal(calls, 1);
  assert.equal(result.outcome, 'request_outcome_unknown');
  assert.ok(!JSON.stringify(result).includes(key));
});

test('bad or wrong-provider credentials never reach transport', async () => {
  let calls = 0;
  for (const invalid of ['', 'sk-ant-api03-FAKE_ANTHROPIC_CREDENTIAL', `${key}\nsecond-value`, undefined]) {
    const result = await requestSanity({ key: invalid, fetchImpl: async () => { calls++; return success(); } });
    assert.equal(result.outcome, 'credential_format_not_accepted');
  }
  assert.equal(calls, 0);
});

test('one-shot ledger prevents duplicate submission and stores no credential or file path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'study-c-xai-test-'));
  try {
    const keyFile = path.join(dir, 'fixture.txt');
    const outputDir = path.join(dir, 'results');
    await writeFile(keyFile, `\uFEFF${key}\r\n`);
    let calls = 0;
    const opts = { keyFile, outputDir, fetchImpl: async () => { calls++; return success(); } };
    assert.equal((await runSanity(opts)).outcome, 'passed');
    assert.equal((await runSanity(opts)).outcome, 'prior_attempt_exists');
    assert.equal(calls, 1);
    const saved = await readFile(path.join(outputDir, 'result.json'), 'utf8');
    assert.ok(!saved.includes(key));
    assert.ok(!saved.includes(keyFile));
    assert.equal(JSON.parse(saved).benchmarkTasksExecuted, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});