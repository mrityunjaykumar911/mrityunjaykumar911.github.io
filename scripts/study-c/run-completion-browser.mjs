import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeClient, loadKey, MODEL } from './pipeline/client.mjs';
import { budgetClient } from './pipeline/quality-loop.mjs';
import { eligibleQualityRecord } from './pipeline/quality-contracts.mjs';
import { createRateLimiter } from './pipeline/rate-limit.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';
import { runCompletionBrowser } from './pipeline/completion-browser.mjs';
import { validateSpec } from './pipeline/tla-oracle.mjs';
import { behaviorHash } from './pipeline/behavioral-model.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function completionBrowserOptions(args) {
  if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--key-file' || !args[1] || !args[3]) throw new Error('completion_browser_config_and_key_required');
  return { configFile: args[1], keyFile: args[3] };
}

async function main() {
  const { configFile, keyFile } = completionBrowserOptions(process.argv.slice(2));
  const config = JSON.parse(await readFile(path.resolve(ROOT, configFile), 'utf8'));
  const plan = JSON.parse(await readFile(path.join(ROOT, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (!plan.qualityFramework?.userApproved || !plan.qualityFramework.taskScope.includes(config.taskId) ||
      plan.providerSwitch?.provider !== 'xAI') throw new Error('completion_browser_not_authorized');
  const sourcePath = path.resolve(ROOT, config.sourceModel);
  const artifactPath = path.resolve(ROOT, config.artifact);
  const sourceBytes = await readFile(sourcePath, 'utf8');
  const source = JSON.parse(sourceBytes);
  const preflight = JSON.parse(await readFile(path.resolve(ROOT, config.preflight), 'utf8'));
  const html = await readFile(artifactPath, 'utf8');
  const scoped = eligibleQualityRecord(source);
  if (!scoped.coverage.eligible || preflight.taskId !== String(config.taskId) && preflight.taskId !== config.taskId) throw new Error('invalid_browser_preflight_scope');
  const directory = path.resolve(ROOT, config.output);
  await mkdir(directory, { recursive: true });
  const lock = await open(path.join(directory, 'run.lock'), 'wx');
  const log = createProgressLogger();
  log.setFile(path.join(directory, 'progress.log'));
  let client;
  let bounded;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await writeFile(path.join(directory, 'inputs.json'), `${JSON.stringify({ ...config, sourceHash: behaviorHash(sourceBytes),
      artifactHash: behaviorHash(html) }, null, 2)}\n`, { flag: 'wx' });
    client = makeClient({ key: await loadKey(keyFile), retry: { maxAttempts: 1 }, maxConcurrentRequests: 2,
      rateLimiter: createRateLimiter({ requestsPerMinute: 10, tokensPerMinute: 120000 }) });
    bounded = budgetClient(client, { maxCalls: scoped.coverage.eligible * 2, maxOutputTokens: scoped.coverage.eligible * 7500 });
    log.log(`browser check: task=${config.taskId} admitted=${scoped.coverage.eligible}/${scoped.coverage.generated} maxCalls=${bounded.limits.maxCalls}; no code generation or scoring`);
    const report = await log.withTask(config.taskId, () => log.withStage('browser-control-mutation-restoration', () => runCompletionBrowser({
      source, preflight, html, mutations: config.mutations, client: bounded, directory, onProgress: log.log,
      validate: (args) => validateSpec({ ...args, java: path.resolve(ROOT, config.java) }),
    })));
    const unchanged = await readFile(sourcePath, 'utf8') === sourceBytes && await readFile(artifactPath, 'utf8') === html;
    await writeFile(path.join(directory, 'source-integrity.json'), `${JSON.stringify({ unchanged, sourceHash: behaviorHash(sourceBytes),
      artifactHash: behaviorHash(html) }, null, 2)}\n`, 'utf8');
    if (!unchanged) throw new Error('archived_input_changed');
    log.log(`browserGate=${report.browserGate}; ${report.mutations.map((item) => `${item.id}=${item.status}`).join('; ')}`);
    if (report.browserGate !== 'passed') process.exitCode = 2;
  } finally {
    if (client) await writeFile(path.join(directory, 'usage.json'), `${JSON.stringify({ provider: 'xAI', model: MODEL,
      accounting: bounded?.accounting, ledger: client.ledger }, null, 2)}\n`, 'utf8');
    await lock.close();
    await unlink(path.join(directory, 'run.lock'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('completion_browser_failed; inspect saved evidence before retrying\n'); process.exitCode = 1; });
}