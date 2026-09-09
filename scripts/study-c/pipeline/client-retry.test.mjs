import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryable, computeBackoffMs, estimateRequestTokens, DEFAULT_RETRY, makeClient } from './client.mjs';

test('default client never repeats a potentially billed failed request', async () => {
  let requests = 0;
  const client = makeClient({ key: 'fixture-only-not-a-real-key', fetchImpl: async () => {
    requests++;
    return new Response(JSON.stringify({ error: { message: 'temporary fixture failure' } }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  } });
  const result = await client.generate({ prompt: 'fixture', maxOutputTokens: 1 });
  assert.equal(DEFAULT_RETRY.maxAttempts, 1);
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.equal(requests, 1);
  assert.equal(client.ledger.retries, 0);
});

test('isRetryable retries only transient faults', () => {
  assert.equal(isRetryable('transport_or_sdk_failure', null), true);
  assert.equal(isRetryable('rate_or_quota_restriction', 429), true);
  assert.equal(isRetryable('api_request_rejected', 503), true);
  assert.equal(isRetryable('api_request_rejected', 500), true);
  assert.equal(isRetryable('stream_idle_timeout', 200), true);
});

test('isRetryable fails fast on terminal faults', () => {
  assert.equal(isRetryable('authentication_rejected', 401), false);
  assert.equal(isRetryable('permission_rejected', 403), false);
  assert.equal(isRetryable('model_or_endpoint_unavailable', 404), false);
  assert.equal(isRetryable('account_credit_restriction', 400), false);
  assert.equal(isRetryable('api_request_rejected', 400), false);
  // A total-deadline breach is deliberately NOT retried (avoids repeating cost).
  assert.equal(isRetryable('total_timeout', 200), false);
});

test('computeBackoffMs honours a server Retry-After, capped by maxDelayMs', () => {
  assert.equal(computeBackoffMs(1, DEFAULT_RETRY, 5_000), 5_000);
  assert.equal(computeBackoffMs(1, DEFAULT_RETRY, 999_999), DEFAULT_RETRY.maxDelayMs);
});

test('computeBackoffMs uses bounded full-jitter backoff without Retry-After', () => {
  for (let attempt = 1; attempt <= 10; attempt++) {
    for (let i = 0; i < 50; i++) {
      const delay = computeBackoffMs(attempt, DEFAULT_RETRY, null);
      assert.ok(delay >= 0, 'delay must be non-negative');
      assert.ok(delay < DEFAULT_RETRY.maxDelayMs + 1, 'delay must be bounded by maxDelayMs');
      const ceiling = Math.min(DEFAULT_RETRY.maxDelayMs, DEFAULT_RETRY.baseDelayMs * 2 ** (attempt - 1));
      assert.ok(delay <= ceiling, `delay ${delay} exceeded ceiling ${ceiling}`);
    }
  }
});

test('estimateRequestTokens sums text length and output budget', () => {
  const est = estimateRequestTokens({
    system: 'x'.repeat(40),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'y'.repeat(400) }] }],
    maxOutputTokens: 1_000,
  });
  // (40 + 400) / 4 = 110 input, + 1000 output budget
  assert.equal(est, 1_110);
});

test('estimateRequestTokens charges a flat allowance for image/file parts', () => {
  const est = estimateRequestTokens({
    system: '',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'hi' },
      { type: 'file', data: new Uint8Array(10), mediaType: 'image/png' },
    ] }],
    maxOutputTokens: 0,
  });
  // ceil((2 + 4000) / 4) = 1001
  assert.equal(est, 1_001);
});
