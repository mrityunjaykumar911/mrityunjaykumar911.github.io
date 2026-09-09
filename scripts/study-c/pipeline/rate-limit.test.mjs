import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pLimit, TokenBucket, createRateLimiter } from './rate-limit.mjs';

test('pLimit never exceeds the configured concurrency', async () => {
  const limit = pLimit(2);
  let active = 0;
  let peak = 0;
  const task = () => new Promise((resolve) => {
    active++;
    peak = Math.max(peak, active);
    setTimeout(() => { active--; resolve(); }, 5);
  });
  await Promise.all(Array.from({ length: 8 }, () => limit(task)));
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded 2`);
  assert.equal(limit.activeCount(), 0);
  assert.equal(limit.pendingCount(), 0);
});

test('pLimit rejects invalid concurrency', () => {
  assert.throws(() => pLimit(0));
  assert.throws(() => pLimit(1.5));
});

test('pLimit propagates rejections without stalling the queue', async () => {
  const limit = pLimit(1);
  const results = await Promise.allSettled([
    limit(() => Promise.reject(new Error('boom'))),
    limit(() => Promise.resolve('ok')),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[1].value, 'ok');
});

test('TokenBucket refills at the configured rate (injected clock)', async () => {
  let now = 10_000;
  const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 5, now: () => now });
  assert.equal(bucket.available(), 10);
  await bucket.take(10);
  assert.equal(Math.floor(bucket.available()), 0);
  now += 1_000; // one second -> +5 tokens
  assert.equal(Math.floor(bucket.available()), 5);
  now += 10_000; // never exceeds capacity
  assert.equal(bucket.available(), 10);
});

test('TokenBucket clamps oversized requests to capacity so they cannot deadlock', async () => {
  let now = 0;
  const bucket = new TokenBucket({ capacity: 4, refillPerSecond: 1000, now: () => now });
  await bucket.take(9_999); // clamped to 4, satisfiable immediately
  assert.ok(bucket.available() <= 4);
});

test('TokenBucket validates constructor arguments', () => {
  assert.throws(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 }));
  assert.throws(() => new TokenBucket({ capacity: 1, refillPerSecond: 0 }));
});

test('createRateLimiter acquires request + token budget and reports a snapshot', async () => {
  const limiter = createRateLimiter({ requestsPerMinute: 600, tokensPerMinute: 6_000 });
  await limiter.acquire({ tokens: 100 });
  const snap = limiter.snapshot();
  assert.ok(snap.requests <= 600 && snap.requests >= 598);
  assert.ok(snap.tokens <= 6_000 && snap.tokens >= 5_900);
});

test('createRateLimiter with no limits is a no-op pass-through', async () => {
  const limiter = createRateLimiter({});
  await limiter.acquire({ tokens: 10_000_000 });
  assert.deepEqual(limiter.snapshot(), {});
});
