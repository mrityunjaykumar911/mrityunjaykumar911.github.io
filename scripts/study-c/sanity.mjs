// A direct, one-request inference sanity check. No token-count preflight or
// retries. The atomic attempt record prevents resubmission on a command rerun.
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classifyCountError } from './token-count.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const resultPath = path.join(root, '.tools/study-c/direct-sanity.json');
const attemptPath = path.join(root, '.tools/study-c/direct-sanity.attempt.json');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--key-file') throw new Error('invalid_arguments');
  const plan = JSON.parse(await readFile(path.join(root, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (plan.model.provider !== 'Anthropic') throw new Error('anthropic_provider_not_selected');
  const model = plan.model.immutableModelId;
  if (model !== 'claude-opus-4-8') throw new Error('unexpected_model');
  const report = { test: 'direct_generation_sanity', model, startedAt: new Date().toISOString(),
    maxOutputTokens: 64, requestsAttempted: 0, retries: 0, generationOutcome: 'not_sent',
    credentialDisplayedOrPersisted: false };
  let key;
  try {
    key = (await readFile(args[1], 'utf8')).replace(/^\uFEFF/, '').trim();
    if (!/^sk-ant-api03-[A-Za-z0-9_-]+$/.test(key)) throw new Error('credential_format');
    await mkdir(path.dirname(resultPath), { recursive: true });
    let marker;
    try { marker = await open(attemptPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      console.log(JSON.stringify({ test: report.test, result: 'prior_attempt_exists',
        newRequestsAttempted: 0, note: 'Inspect the existing sanitized report; no retry was sent.' }));
      return;
    }
    try {
      await marker.writeFile(JSON.stringify({ model, startedAt: report.startedAt,
        outcome: 'reserved_before_send_do_not_retry_automatically' }));
    } finally { await marker.close(); }
    report.requestsAttempted = 1;
    report.generationOutcome = 'unknown';
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 64,
          messages: [{ role: 'user', content: 'Reply with exactly SANITY_OK.' }] }),
      });
      report.httpStatus = response.status;
      let body;
      try { body = await response.json(); } catch { /* No raw response logging. */ }
      if (!response.ok) {
        report.generationOutcome = 'api_rejected';
        report.diagnostic = classifyCountError(body, response.status);
        process.exitCode = 1;
      } else {
        const text = Array.isArray(body?.content)
          ? body.content.filter((block) => block.type === 'text').map((block) => block.text).join('').trim()
          : '';
        report.generationOutcome = text === 'SANITY_OK' ? 'passed' : 'unexpected_response';
        report.exactModelReturned = body?.model === model;
        report.usage = {};
        for (const name of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
          if (Number.isSafeInteger(body?.usage?.[name])) report.usage[name] = body.usage[name];
        }
        if (report.generationOutcome !== 'passed') process.exitCode = 1;
      }
    } catch {
      report.generationOutcome = 'transport_failed_outcome_unknown';
      process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString();
    await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally { key = undefined; }
}

main().catch(() => {
  console.error('Sanity check could not complete; no raw request, credential, or exception logged.');
  process.exitCode = 1;
});