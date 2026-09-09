// Concurrency and rate-limiting primitives for the ArtifactsBench runner.
// Dependency-free so the benchmark harness has no supply-chain surface. All
// timing is driven through an injectable clock so the behaviour is unit-testable
// without real delays. These bound parallel xAI calls to stay under the account
// request-per-minute (RPM) and token-per-minute (TPM) ceilings while allowing
// the independent B/G/T arms (and multiple tasks) to run concurrently.

// A p-limit style concurrency gate: at most `concurrency` supplied thunks run at
// once; the rest queue in FIFO order. Rejections propagate to the caller and do
// not stall the queue.
export function pLimit(concurrency) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('pLimit: concurrency must be a positive integer');
  }
  const queue = [];
  let active = 0;
  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => { active--; drain(); });
    }
  };
  const limited = (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drain();
  });
  limited.activeCount = () => active;
  limited.pendingCount = () => queue.length;
  return limited;
}

// A continuously-refilling token bucket with FIFO async waiting. `take(n)`
// resolves once `n` tokens are available; requests larger than the capacity are
// clamped to the capacity so they can never deadlock.
export class TokenBucket {
  constructor({ capacity, refillPerSecond, now = Date.now }) {
    if (!(capacity > 0)) throw new Error('TokenBucket: capacity must be positive');
    if (!(refillPerSecond > 0)) throw new Error('TokenBucket: refillPerSecond must be positive');
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
    this.tokens = capacity;
    this.last = now();
    this.queue = [];
    this.timer = null;
  }

  #refill() {
    const t = this.now();
    const elapsed = (t - this.last) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
      this.last = t;
    }
  }

  take(amount) {
    const need = Math.min(Math.max(Number(amount) || 0, 0), this.capacity);
    return new Promise((resolve) => {
      this.queue.push({ need, resolve });
      this.#process();
    });
  }

  #process() {
    if (this.timer) return;
    this.#refill();
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (this.tokens >= head.need) {
        this.tokens -= head.need;
        this.queue.shift();
        head.resolve();
        continue;
      }
      const deficit = head.need - this.tokens;
      const waitMs = Math.max(5, Math.ceil((deficit / this.refillPerSecond) * 1000));
      this.timer = setTimeout(() => { this.timer = null; this.#process(); }, waitMs);
      this.timer.unref?.();
      return;
    }
  }

  available() {
    this.#refill();
    return this.tokens;
  }
}

// Combines optional RPM and TPM buckets. `acquire({ tokens })` resolves only
// once both a request slot and the estimated token budget are available. Buckets
// refill monotonically, so acquiring them in series cannot deadlock.
export function createRateLimiter({ requestsPerMinute, tokensPerMinute, now = Date.now } = {}) {
  const buckets = [];
  if (requestsPerMinute > 0) {
    buckets.push({
      kind: 'requests',
      bucket: new TokenBucket({ capacity: requestsPerMinute, refillPerSecond: requestsPerMinute / 60, now }),
      cost: () => 1,
    });
  }
  if (tokensPerMinute > 0) {
    buckets.push({
      kind: 'tokens',
      bucket: new TokenBucket({ capacity: tokensPerMinute, refillPerSecond: tokensPerMinute / 60, now }),
      cost: (req) => Math.max(1, Number(req?.tokens) || 0),
    });
  }
  return {
    async acquire(req = { tokens: 0 }) {
      for (const { bucket, cost } of buckets) {
        await bucket.take(cost(req));
      }
    },
    snapshot() {
      return Object.fromEntries(buckets.map(({ kind, bucket }) => [kind, Math.floor(bucket.available())]));
    },
  };
}
