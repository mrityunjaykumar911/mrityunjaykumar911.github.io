import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { qualityOptions } from './run-quality.mjs';
import { makeClient, loadKey, MODEL } from './pipeline/client.mjs';
import { budgetClient } from './pipeline/quality-loop.mjs';
import { createRateLimiter } from './pipeline/rate-limit.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';
import { runCompletionPreflight } from './pipeline/completion-preflight.mjs';
import { validatorHeapMb } from './pipeline/tla-oracle.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function completionPreflightOptions(args) {
  if (args.includes('--modes')) throw new Error('completion_preflight_has_no_arms');
  const options = qualityOptions(args);
  if (options.ids.length !== 1) throw new Error('completion_preflight_one_task_required');
  return options;
}

async function main() {
  const { runId, ids: [id], keyFile } = completionPreflightOptions(process.argv.slice(2));
  const plan = JSON.parse(await readFile(path.join(ROOT, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (!plan.qualityFramework?.userApproved || !plan.fiveTaskRun?.userAuthorized || plan.providerSwitch?.provider !== 'xAI') throw new Error('preflight_not_authorized');
  const manifest = JSON.parse(await readFile(path.join(ROOT, '.tools/study-c/five-tasks/manifest.json'), 'utf8'));
  const task = manifest.tasks.find((item) => String(item.id) === id);
  if (!task) throw new Error('preflight_task_outside_authorization');
  const prompt = await readFile(path.join(ROOT, `.tools/study-c/five-tasks/task-${id}.prompt.txt`), 'utf8');
  if (createHash('sha256').update(prompt).digest('hex') !== task.promptSha256) throw new Error('preflight_task_hash_mismatch');
  const directory = path.join(ROOT, '.tools/study-c/completion-validation', runId, `task-${id}`);
  await mkdir(directory, { recursive: true });
  const lock = await open(path.join(directory, 'run.lock'), 'wx');
  const log = createProgressLogger();
  log.setFile(path.join(directory, 'progress.log'));
  let client;
  let bounded;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    client = makeClient({ key: await loadKey(keyFile), retry: { maxAttempts: 1 }, maxConcurrentRequests: 1,
      rateLimiter: createRateLimiter({ requestsPerMinute: 10, tokensPerMinute: 120000 }) });
    bounded = budgetClient(client, { maxCalls: 2, maxOutputTokens: 16000 });
    log.log(`run=${runId} task=${id} model=${MODEL} jvmHeapMb=${validatorHeapMb()} maxCalls=2 no HTML generation, binding or scoring`);
    const report = await log.withTask(id, () => log.withStage('generation-review-model-checks', () => runCompletionPreflight({
      task: { id: task.id, prompt }, client: bounded, directory, onProgress: log.log,
    })));
    log.log(`modelGate=${report.modelGate} generated=${report.generatedContracts} checked=${report.checkedContracts} finite=${report.checkedFiniteContracts}; browserGate=not-run`);
    if (report.modelGate !== 'passed') process.exitCode = 2;
  } finally {
    if (client) await writeFile(path.join(directory, 'usage.json'), `${JSON.stringify({ provider: 'xAI', model: MODEL,
      accounting: bounded?.accounting, ledger: client.ledger }, null, 2)}\n`, 'utf8');
    await lock.close();
    await unlink(path.join(directory, 'run.lock'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('completion_preflight_failed; inspect saved responses and progress before retrying\n'); process.exitCode = 1; });
}