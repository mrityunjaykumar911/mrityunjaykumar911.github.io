// Count-only transport. Never falls back to generation, another model, or a
// text-only prompt. Raw API errors, headers, and request content stay private.
import { createHash } from 'node:crypto';

export const COUNT_ENDPOINT = 'https://api.anthropic.com/v1/messages/count_tokens';

export class TokenCountError extends Error {
  constructor(code, diagnostic) {
    super(code);
    this.name = 'TokenCountError';
    this.diagnostic = diagnostic;
  }
}

export function classifyCountError(body, httpStatus) {
  // Emit only locally defined categories, never arbitrary server strings.
  // Even an error that echoes credentials or the evaluator checklist cannot
  // leak those values through the report, Error.message, or a stack trace.
  const types = new Set(['invalid_request_error', 'authentication_error',
    'permission_error', 'not_found_error', 'rate_limit_error', 'api_error',
    'overloaded_error', 'request_too_large']);
  const apiType = types.has(body?.error?.type) ? body.error.type : 'unrecognized_error';
  const message = typeof body?.error?.message === 'string' ? body.error.message.toLowerCase() : '';
  let reason = 'unclassified_api_rejection';
  if (/credit balance|insufficient (?:credit|balance)|purchase credits|billing|payment required/.test(message)) {
    reason = 'account_billing_or_credit_restriction';
  } else if (/token count|token counting|count_tokens/.test(message) && /not supported|unsupported|not available|unavailable/.test(message)) {
    reason = 'token_counting_unavailable';
  } else if (/model/.test(message) && /not supported|unsupported|not found|not available|does not exist|invalid model/.test(message)) {
    reason = 'requested_model_unavailable_for_counting';
  } else if (/authentication|api.key|x-api-key/.test(message) && /invalid|missing|unauthorized/.test(message)) {
    reason = 'credential_not_accepted';
  } else if (/permission|access denied|not authorized|not permitted/.test(message)) {
    reason = 'account_permission_restriction';
  } else if (/max_tokens/.test(message)) {
    reason = 'max_tokens_validation';
  } else if (/thinking|output_config|effort/.test(message)) {
    reason = 'thinking_configuration_validation';
  } else if (/image|base64|media_type/.test(message)) {
    reason = 'image_validation';
  } else if (/too long|too large|maximum.*(?:size|length|tokens)/.test(message)) {
    reason = 'request_size_validation';
  } else if (/messages|role|content|text|json/.test(message)) {
    reason = 'message_schema_validation';
  }
  return { httpStatus, apiType, reason };
}

export async function countMessageTokens({ model, content, key, fetchImpl = fetch }) {
  if (typeof model !== 'string' || !/^claude-[a-z0-9.-]+$/.test(model)) {
    throw new TokenCountError('invalid_count_model', { reason: 'invalid_count_model' });
  }
  if (typeof key !== 'string' || !/^sk-ant-api03-[A-Za-z0-9_-]+$/.test(key)) {
    throw new TokenCountError('credential_format_not_accepted', { reason: 'credential_format_not_accepted' });
  }
  if (!Array.isArray(content) || content.length === 0) {
    throw new TokenCountError('invalid_count_content', { reason: 'invalid_count_content' });
  }
  const payload = { model, messages: [{ role: 'user', content }] };
  const serialized = JSON.stringify(payload);
  let response;
  try {
    response = await fetchImpl(COUNT_ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: serialized, redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new TokenCountError('token_count_transport_failure', { reason: 'token_count_transport_failure' });
  }
  let body;
  try { body = await response.json(); } catch { /* A non-JSON response is never a count. */ }
  if (!response.ok) {
    throw new TokenCountError(`token_count_http_${response.status}`, classifyCountError(body, response.status));
  }
  if (!Number.isSafeInteger(body?.input_tokens) || body.input_tokens < 0) {
    throw new TokenCountError('invalid_token_count', { httpStatus: response.status, reason: 'invalid_token_count' });
  }
  return {
    inputTokens: body.input_tokens,
    payloadSha256: createHash('sha256').update(serialized).digest('hex'),
  };
}