// xAI model calls for the ArtifactsBench runner: single coding/repair generation
// and a multimodal judge scoring. Reuses the safety posture proven by the
// sanity probe: store:false verified on every serialized request, no automatic
// retries, telemetry disabled, credentials process-local and never serialized.
import { createXai } from '@ai-sdk/xai';
import { generateText, streamText } from 'ai';
import { readFile } from 'node:fs/promises';
import { pLimit } from './rate-limit.mjs';

export const MODEL = 'grok-4.6';
export const BASE_URL = 'https://api.x.ai/v1';
export const ENDPOINT = `${BASE_URL}/responses`;

// Default resilience posture. Retries only cover transient faults; terminal
// faults (auth, credit, bad request) fail fast so we never hammer the API.
export const DEFAULT_RETRY = Object.freeze({ maxAttempts: 1, baseDelayMs: 1_000, maxDelayMs: 30_000 });
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 3;
// Two independent deadlines: an absolute ceiling for the whole request, and a
// stream-idle watchdog that fires only when a started stream goes quiet. The
// idle watchdog is armed AFTER the first token so a model that reasons silently
// for a long time before emitting text is never killed mid-thought.
export const DEFAULT_TIMEOUTS = Object.freeze({ totalMs: 900_000, streamIdleMs: 120_000 });

function validKey(key) {
  return typeof key === 'string' && /^[\x21-\x7e]{20,4096}$/.test(key) && !key.startsWith('sk-ant-');
}

function safeReason(error, status) {
  const text = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  if (/insufficient.*(?:credit|balance)|credit balance|billing|purchase credits/.test(text)) return 'account_credit_restriction';
  if (status === 401) return 'authentication_rejected';
  if (status === 403) return 'permission_rejected';
  if (status === 404) return 'model_or_endpoint_unavailable';
  if (status === 429) return 'rate_or_quota_restriction';
  if (status !== null && status >= 400) return 'api_request_rejected';
  return 'transport_or_sdk_failure';
}

// Transient faults worth retrying: raw transport/SDK drops (the mid-stream
// disconnect we observed), 429 throttling, 5xx server errors, and a stream that
// went idle after starting. A total-deadline breach is NOT retried by default:
// the request genuinely ran too long, so a blind retry just repeats the cost.
export function isRetryable(reason, status) {
  if (reason === 'transport_or_sdk_failure' || reason === 'rate_or_quota_restriction') return true;
  if (reason === 'stream_idle_timeout') return true;
  if (typeof status === 'number' && status >= 500) return true;
  return false;
}

// Exponential backoff with full jitter, honouring a server Retry-After when the
// throttle response provided one. Bounded by maxDelayMs.
export function computeBackoffMs(attempt, cfg, retryAfterMs) {
  const { baseDelayMs, maxDelayMs } = cfg;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(maxDelayMs, retryAfterMs);
  }
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(Math.random() * ceiling);
}

// Conservative token estimate (~4 chars/token) used to reserve TPM budget before
// a call. Non-text parts (screenshots) are charged a flat allowance.
export function estimateRequestTokens({ messages = [], system = '', maxOutputTokens = 0 }) {
  let chars = String(system || '').length;
  for (const message of messages) {
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const part of content) {
      if (part?.type === 'text') chars += String(part.text || '').length;
      else chars += 4_000; // image/file part allowance
    }
  }
  return Math.ceil(chars / 4) + Math.max(0, Number(maxOutputTokens) || 0);
}

const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });

export async function loadKey(keyFile) {
  const key = (await readFile(keyFile, 'utf8')).replace(/^\uFEFF/, '').trim();
  if (!validKey(key)) throw new Error('credential_format_not_accepted');
  return key;
}

// A client that verifies store:false and endpoint scope on every request while
// permitting the many sequential calls a real run needs. Adds transient-fault
// retries, an optional RPM/TPM rate limiter, and a global in-flight cap so
// parallel arms/tasks stay within account limits. Tracks a usage ledger.
export function makeClient({
  key,
  fetchImpl = fetch,
  rateLimiter = null,
  retry = {},
  timeouts = {},
  maxConcurrentRequests = DEFAULT_MAX_CONCURRENT_REQUESTS,
} = {}) {
  if (!validKey(key)) throw new Error('credential_format_not_accepted');
  const retryCfg = { ...DEFAULT_RETRY, ...retry };
  const timeoutCfg = { ...DEFAULT_TIMEOUTS, ...timeouts };
  const gate = pLimit(Math.max(1, maxConcurrentRequests));
  const ledger = {
    requests: 0, retries: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
    lastStatus: null, lastRetryAfterMs: null,
  };
  const guardedFetch = async (url, init) => {
    if (String(url) !== ENDPOINT || init?.method !== 'POST') throw new Error('unexpected_request_target');
    const payload = JSON.parse(init.body);
    // Streaming is permitted (it only changes delivery, not persistence); the
    // billing-safety invariants store:false and no server-side chaining stay enforced.
    if (payload.store !== false || payload.previous_response_id) {
      throw new Error('unexpected_request_configuration');
    }
    ledger.requests++;
    const response = await fetchImpl(url, { ...init, redirect: 'error' });
    ledger.lastStatus = response.status;
    ledger.lastRetryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
    return response;
  };
  const xai = createXai({ apiKey: key, baseURL: BASE_URL, fetch: guardedFetch });

  const recordUsage = (rawUsage) => {
    const usage = {};
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens']) {
      if (Number.isSafeInteger(rawUsage?.[field]) && rawUsage[field] >= 0) {
        usage[field] = rawUsage[field];
        ledger[field] += rawUsage[field];
      }
    }
    return usage;
  };

  // A single attempt at the model call (streaming when a progress sink is given).
  async function attemptOnce({ messages, system, maxOutputTokens, purpose, onProgress }) {
    const started = Date.now();
    // Manual abort control so we can distinguish a total-deadline breach from a
    // stream-idle stall, and record time-to-first-token for diagnostics.
    const controller = new AbortController();
    let timedOutKind = null;
    let idleTimer = null;
    const totalTimer = setTimeout(() => { timedOutKind = 'total_timeout'; controller.abort(); }, timeoutCfg.totalMs);
    totalTimer.unref?.();
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { timedOutKind = 'stream_idle_timeout'; controller.abort(); }, timeoutCfg.streamIdleMs);
      idleTimer.unref?.();
    };
    const shared = {
      model: xai.responses(MODEL),
      system, messages,
      maxOutputTokens, maxRetries: 0,
      abortSignal: controller.signal,
      providerOptions: { xai: { store: false } },
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    };
    let msToFirstToken = null;
    try {
      // Streaming path: surface incremental text so callers see true async
      // progress instead of waiting for the whole completion in one blocking read.
      if (typeof onProgress === 'function') {
        const result = streamText(shared);
        let text = '';
        let lastTick = started;
        for await (const delta of result.textStream) {
          if (msToFirstToken === null) msToFirstToken = Date.now() - started;
          text += delta;
          armIdle(); // watchdog runs only once text has started flowing
          const now = Date.now();
          if (now - lastTick >= 1000) {
            onProgress({ chars: text.length, ms: now - started });
            lastTick = now;
          }
        }
        const usage = recordUsage(await result.usage);
        const response = (await result.finalStep).response;
        return {
          purpose, ok: true, text, finishReason: await result.finishReason,
          modelId: response?.modelId, usage, ms: Date.now() - started, msToFirstToken,
        };
      }
      const result = await generateText(shared);
      return {
        purpose, ok: true, text: result.text, finishReason: result.finishReason,
        modelId: result.finalStep?.response?.modelId, usage: recordUsage(result.usage), ms: Date.now() - started,
      };
    } catch (error) {
      return {
        purpose, ok: false, reason: timedOutKind ?? safeReason(error, ledger.lastStatus),
        httpStatus: ledger.lastStatus, ms: Date.now() - started, msToFirstToken,
      };
    } finally {
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
    }
  }

  // Retry wrapper: reserves rate-limit budget, runs under the global gate, and
  // retries transient faults only when explicitly configured. A failed response
  // may already have incurred provider charges; store:false is not a billing cap.
  async function call({ messages, system, maxOutputTokens, purpose, onProgress, onRetry }) {
    const estTokens = estimateRequestTokens({ messages, system, maxOutputTokens });
    const started = Date.now();
    let last;
    for (let attempt = 1; attempt <= retryCfg.maxAttempts; attempt++) {
      if (rateLimiter) await rateLimiter.acquire({ tokens: estTokens });
      last = await gate(() => attemptOnce({ messages, system, maxOutputTokens, purpose, onProgress }));
      if (last.ok) return { ...last, attempts: attempt, ms: Date.now() - started };
      const retryable = isRetryable(last.reason, last.httpStatus);
      if (!retryable || attempt >= retryCfg.maxAttempts) {
        return { ...last, attempts: attempt, ms: Date.now() - started };
      }
      ledger.retries++;
      const delayMs = computeBackoffMs(attempt, retryCfg, ledger.lastRetryAfterMs);
      onRetry?.({ attempt, reason: last.reason, httpStatus: last.httpStatus ?? null, delayMs });
      await sleep(delayMs);
    }
    return { ...last, attempts: retryCfg.maxAttempts, ms: Date.now() - started };
  }

  return {
    ledger,
    // Coding / repair generation: text-only prompt, larger output budget.
    generate: ({ system, prompt, maxOutputTokens = 20_000, purpose, onProgress, onRetry }) =>
      call({ system, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], maxOutputTokens, purpose, onProgress, onRetry }),
    // Multimodal judge: prompt text plus rendered full-page screenshots.
    judge: ({ prompt, images, maxOutputTokens = 4_000, purpose = 'judge', onProgress, onRetry }) =>
      call({
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...images.map((image) => ({ type: 'file', data: image, mediaType: 'image/png' }))],
        }],
        maxOutputTokens, purpose, onProgress, onRetry,
      }),
  };
}

// Parse an HTTP Retry-After header (delta-seconds or an HTTP date) into ms.
function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(value);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null;
}
