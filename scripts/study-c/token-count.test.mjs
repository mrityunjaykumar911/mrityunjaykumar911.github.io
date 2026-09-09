import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNT_ENDPOINT, TokenCountError, classifyCountError, countMessageTokens } from './token-count.mjs';

const key = 'sk-ant-api03-FAKE_TEST_CREDENTIAL_NOT_REAL';
const model = 'claude-opus-4-8';
const content = [{ type: 'text', text: 'Public fixture prompt.' }];
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

test('sends documented count-only payload with no generation fields', async () => {
  let calls = 0;
  const result = await countMessageTokens({ model, content, key, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, COUNT_ENDPOINT);
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers['x-api-key'], key);
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    assert.deepEqual(JSON.parse(request.body), { model, messages: [{ role: 'user', content }] });
    assert.ok(!request.body.includes(key));
    return response({ input_tokens: 42 });
  } });
  assert.equal(calls, 1);
  assert.equal(result.inputTokens, 42);
  assert.match(result.payloadSha256, /^[a-f0-9]{64}$/);
});

test('preserves all three judge images without text-only fallback', async () => {
  const images = [1, 2, 3].map((n) => ({ type: 'image', source: {
    type: 'base64', media_type: 'image/png', data: Buffer.from(`fixture${n}`).toString('base64'),
  } }));
  await countMessageTokens({ model: 'claude-opus-5', content: [...content, ...images], key,
    fetchImpl: async (_, request) => {
      const payload = JSON.parse(request.body);
      assert.equal(payload.model, 'claude-opus-5');
      assert.deepEqual(payload.messages[0].content, [...content, ...images]);
      return response({ input_tokens: 3000 });
    } });
});

test('400 diagnostic classifies billing without leaking key or checklist', async () => {
  let calls = 0;
  await assert.rejects(countMessageTokens({ model, content, key, fetchImpl: async () => {
    calls++;
    return response({ error: { type: 'invalid_request_error',
      message: `Your credit balance is too low. ${key} PRIVATE_CHECKLIST_SENTINEL` } }, 400);
  } }), (error) => {
    assert.ok(error instanceof TokenCountError);
    assert.equal(error.message, 'token_count_http_400');
    assert.equal(error.diagnostic.reason, 'account_billing_or_credit_restriction');
    assert.ok(!JSON.stringify(error).includes(key));
    assert.ok(!JSON.stringify(error).includes('PRIVATE_CHECKLIST_SENTINEL'));
    assert.ok(!error.stack.includes(key));
    return true;
  });
  assert.equal(calls, 1, 'No automatic retry or alternate endpoint');
});

test('diagnostics only emit controlled categories', () => {
  for (const [message, reason] of [
    ['model not supported', 'requested_model_unavailable_for_counting'],
    ['token counting not supported', 'token_counting_unavailable'],
    ['max_tokens: required', 'max_tokens_validation'],
    ['thinking type is invalid', 'thinking_configuration_validation'],
    ['invalid base64 image', 'image_validation'],
    ['messages.0.content is invalid', 'message_schema_validation'],
    [`unknown ${key}`, 'unclassified_api_rejection'],
  ]) {
    const diagnostic = classifyCountError({ error: { type: key, message } }, 400);
    assert.equal(diagnostic.reason, reason);
    assert.equal(diagnostic.apiType, 'unrecognized_error');
    assert.ok(!JSON.stringify(diagnostic).includes(key));
  }
});

test('transport and invalid responses fail closed without raw exception messages', async () => {
  const failing = [
    async () => { throw new Error(`Network failed with ${key}`); },
    async () => new Response('not JSON', { status: 400 }),
    ...[null, {}, { input_tokens: -1 }, { input_tokens: 1.5 }, { input_tokens: '42' }]
      .map((body) => async () => response(body)),
  ];
  for (const fetchImpl of failing) {
    await assert.rejects(countMessageTokens({ model, content, key, fetchImpl }), (error) => {
      assert.ok(error instanceof TokenCountError);
      assert.ok(!error.stack.includes(key));
      return true;
    });
  }
});

test('invalid credential or request configuration never reaches the network', async () => {
  const fetchImpl = async () => { assert.fail('Network must not be called'); };
  for (const override of [{ key: 'invalid' }, { model: undefined }, { content: [] }]) {
    await assert.rejects(countMessageTokens({ model, content, key, fetchImpl, ...override }), TokenCountError);
  }
});