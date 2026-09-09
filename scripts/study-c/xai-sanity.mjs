// Native Node path documented by xAI: @ai-sdk/xai + ai, no Python bridge.
// No browser, token-count probe, automatic retry, tools, or benchmark run.
import { createXai } from '@ai-sdk/xai';
import { generateText } from 'ai';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ENDPOINT = 'https://api.x.ai/v1/responses';
export const MODEL = 'grok-4.6';
const MAX_OUTPUT = 256;

// Classify in memory, never serialize arbitrary SDK error fields. An SDK
// exception can contain headers, request bodies, response text, or the key.
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

function validKey(key) {
  // Do not assume a specific xAI prefix beyond rejecting accidental Anthropic
  // credentials. Permit only a single nonempty printable header value.
  return typeof key === 'string' && /^[\x21-\x7e]{20,4096}$/.test(key) && !key.startsWith('sk-ant-');
}

export async function requestSanity({ key, fetchImpl = fetch }) {
  const report = {
    provider: 'xAI', model: MODEL, transport: '@ai-sdk/xai responses + ai.generateText',
    maxOutputTokens: MAX_OUTPUT, maxRetries: 0, store: false, telemetryEnabled: false,
    requestsAttempted: 0, httpStatus: null, outcome: 'not_sent',
  };
  if (!validKey(key)) return { ...report, outcome: 'credential_format_not_accepted' };
  const guardedFetch = async (url, init) => {
    if (String(url) !== ENDPOINT || init?.method !== 'POST' || report.requestsAttempted !== 0) {
      throw new Error('unexpected_or_duplicate_request_blocked');
    }
    const payload = JSON.parse(init.body);
    // Verify privacy and scope at the serialized request boundary too.
    if (payload.model !== MODEL || payload.store !== false || payload.max_output_tokens !== MAX_OUTPUT ||
        payload.previous_response_id || payload.tools?.length || payload.stream) {
      throw new Error('unexpected_request_configuration');
    }
    report.requestsAttempted++;
    const response = await fetchImpl(url, { ...init, redirect: 'error' });
    report.httpStatus = response.status;
    return response;
  };
  try {
    const xai = createXai({ apiKey: key, baseURL: 'https://api.x.ai/v1', fetch: guardedFetch });
    const result = await generateText({
      model: xai.responses(MODEL),
      prompt: 'Reply with exactly SANITY_OK.',
      maxOutputTokens: MAX_OUTPUT,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000),
      providerOptions: { xai: { store: false } },
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    });
    report.outcome = result.text.trim() === 'SANITY_OK' ? 'passed' : 'response_received_unexpected_text';
    report.exactModelReturned = result.finalStep.response.modelId === MODEL;
    if (typeof result.finalStep.response.modelId === 'string' && /^grok-[a-z0-9.-]{1,100}$/.test(result.finalStep.response.modelId)) {
      report.returnedModel = result.finalStep.response.modelId;
    }
    if (['stop', 'length', 'content-filter', 'tool-calls', 'error', 'other'].includes(result.finishReason)) {
      report.finishReason = result.finishReason;
    }
    report.usage = {};
    // Output reasoning tokens are already part of outputTokens; don't add
    // reasoning/cached token subfields again. Record only numeric totals.
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens']) {
      if (Number.isSafeInteger(result.usage[field]) && result.usage[field] >= 0) report.usage[field] = result.usage[field];
    }
  } catch (error) {
    report.outcome = report.httpStatus !== null && report.httpStatus >= 400
      ? 'api_rejected' : report.requestsAttempted ? 'request_outcome_unknown' : 'local_request_blocked';
    report.reason = safeReason(error, report.httpStatus);
  }
  return report;
}

export async function runSanity({ keyFile, outputDir = path.join(ROOT, '.tools/study-c/xai-sanity'), fetchImpl = fetch }) {
  await mkdir(outputDir, { recursive: true });
  let marker;
  try { marker = await open(path.join(outputDir, 'attempt.json'), 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw new Error('attempt_record_unavailable');
    return { provider: 'xAI', outcome: 'prior_attempt_exists', newRequestsAttempted: 0 };
  }
  const startedAt = new Date().toISOString();
  try {
    await marker.writeFile(JSON.stringify({ startedAt, model: MODEL, status: 'reserved_do_not_retry_automatically' }));
    await marker.sync();
  } finally { await marker.close(); }
  let key;
  let result;
  try {
    key = (await readFile(keyFile, 'utf8')).replace(/^\uFEFF/, '').trim();
    result = await requestSanity({ key, fetchImpl });
  } catch {
    result = { provider: 'xAI', model: MODEL, outcome: 'local_setup_failure', requestsAttempted: 0 };
  } finally { key = undefined; }
  const report = { schemaVersion: 1, test: 'xai_node_direct_generation_sanity', startedAt,
    finishedAt: new Date().toISOString(), ...result,
    credentialDisplayedOrPersisted: false, benchmarkTasksExecuted: 0 };
  await writeFile(path.join(outputDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--key-file') throw new Error('key_file_argument_required');
  const plan = JSON.parse(await readFile(path.join(ROOT, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (plan.providerSwitch?.provider !== 'xAI' || plan.providerSwitch?.sanityModel !== MODEL) {
    throw new Error('provider_switch_not_configured');
  }
  const report = await runSanity({ keyFile: args[1] });
  console.log(JSON.stringify(report, null, 2));
  if (report.outcome !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('xAI sanity could not complete; raw SDK errors and credentials were not logged.');
    process.exitCode = 1;
  });
}