// Read-only account preflight. Credentials are read by this process only,
// never printed, persisted, passed to a child, or sent to a candidate sandbox.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reportPath = path.join(root, '.tools/study-c/account-preflight.json');
const origin = 'https://api.anthropic.com';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--key-file') {
    throw new Error('Usage: node scripts/study-c/preflight.mjs --key-file <external credential file>');
  }
  const plan = JSON.parse(await readFile(path.join(root, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (plan.model.provider !== 'Anthropic' || plan.judge.provider !== 'Anthropic') {
    throw new Error('Anthropic preflight is not enabled for the selected provider.');
  }
  const requested = [plan.model.immutableModelId, plan.judge.immutableModelId];
  if (requested.some((id) => typeof id !== 'string' || !/^claude-[a-z0-9.-]+$/.test(id))) {
    throw new Error('The plan must name two explicit Anthropic model IDs.');
  }
  let key;
  const report = {
    checkedAt: new Date().toISOString(),
    provider: 'Anthropic',
    metadataOnly: true,
    messagesRequests: 0,
    requestedModels: [],
    allRequestedModelsAvailable: false,
    credentialDisplayedOrPersisted: false,
    status: 'preflight_incomplete',
  };
  try {
    try {
      key = (await readFile(args[1], 'utf8')).replace(/^\uFEFF/, '').trim();
    } catch {
      report.status = 'credential_file_unavailable';
      return report;
    }
    if (!/^sk-ant-api03-[A-Za-z0-9_-]+$/.test(key)) {
      report.status = 'credential_format_not_accepted';
      return report;
    }
    for (const id of requested) {
      let response;
      try {
        response = await fetch(`${origin}/v1/models/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        });
        const check = { requestedModel: id, httpStatus: response.status, exactModelAvailable: false };
        if (response.ok) {
          const metadata = await response.json();
          check.exactModelAvailable = metadata.id === id;
          // Never serialize the raw body: only the exact expected ID match.
        } else {
          await response.body?.cancel();
        }
        report.requestedModels.push(check);
        if ([401, 403].includes(response.status)) break;
      } catch {
        // Raw fetch/SDK errors can contain request data. Emit a fixed code.
        report.requestedModels.push({ requestedModel: id, httpStatus: null,
          exactModelAvailable: false, error: 'metadata_request_failed' });
        break;
      }
    }
    report.allRequestedModelsAvailable = report.requestedModels.length === requested.length &&
      report.requestedModels.every((check) => check.exactModelAvailable);
    report.status = report.allRequestedModelsAvailable ? 'requested_models_available' : 'blocked_model_access';
    return report;
  } finally {
    key = undefined;
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
}

main().then((report) => {
  console.log(JSON.stringify(report, null, 2));
  if (!report.allRequestedModelsAvailable) process.exitCode = 1;
}).catch(() => {
  // Neither filesystem exceptions nor request exceptions are printed raw.
  console.error('Account preflight failed. No generation was attempted; no credential was logged.');
  process.exitCode = 1;
});