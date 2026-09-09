import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeClient, loadKey, MODEL } from './pipeline/client.mjs';
import { createRateLimiter } from './pipeline/rate-limit.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';
import { QUALITY_PROTOCOL, requestOnce } from './pipeline/quality-contracts.mjs';
import { runQualityTrial } from './pipeline/quality-trial.mjs';
import { decodeJudgeTemplate, buildJudgePrompt } from './pipeline/judge.mjs';
import { extractOverallScore, scoreToNumber } from './pipeline/extract.mjs';
import { validatorHeapMb } from './pipeline/tla-oracle.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const log = createProgressLogger();
const digest = (text) => createHash('sha256').update(text).digest('hex');

export function qualityOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--run-id', '--tasks', '--key-file', '--modes', '--specification-repair-rounds'].includes(name) || options[name] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('invalid_quality_arguments');
    options[name] = args[index + 1];
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(options['--run-id'] ?? '') || !options['--key-file'] ||
      !/^\d+(,\d+)*$/.test(options['--tasks'] ?? '')) throw new Error('quality_arguments_required');
  const modes = (options['--modes'] ?? 'executable,formal').split(',');
  if (new Set(modes).size !== modes.length || modes.some((mode) => !['executable', 'formal'].includes(mode))) throw new Error('invalid_quality_modes');
  const rounds = options['--specification-repair-rounds'] ?? '0';
  if (!/^[0-3]$/.test(rounds)) throw new Error('invalid_specification_repair_rounds');
  return { runId: options['--run-id'], keyFile: options['--key-file'], ids: options['--tasks'].split(','), modes, specificationRepairRounds: Number(rounds) };
}

async function main() {
  const { runId, keyFile, ids, modes, specificationRepairRounds } = qualityOptions(process.argv.slice(2));
  const jvmHeapMb = validatorHeapMb();
  const plan = JSON.parse(await readFile(path.join(ROOT, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (!plan.qualityFramework?.userApproved || !plan.fiveTaskRun?.userAuthorized) throw new Error('quality_protocol_not_approved');
  if (plan.providerSwitch?.provider !== 'xAI') throw new Error('quality_provider_not_authorized');
  const manifest = JSON.parse(await readFile(path.join(ROOT, '.tools/study-c/five-tasks/manifest.json'), 'utf8'));
  if (new Set(ids).size !== ids.length || ids.length > 5 || ids.some((id) => !manifest.tasks.some((task) => String(task.id) === id))) throw new Error('quality_tasks_outside_authorization');
  const tasks = [];
  for (const id of ids) {
    const task = manifest.tasks.find((item) => String(item.id) === id);
    const prompt = await readFile(path.join(ROOT, `.tools/study-c/five-tasks/task-${id}.prompt.txt`), 'utf8');
    const checklist = await readFile(path.join(ROOT, `.tools/study-c/five-tasks/task-${id}.checklist.txt`), 'utf8');
    if (digest(prompt) !== task.promptSha256 || digest(checklist) !== task.checklistSha256) throw new Error('quality_task_hash_mismatch');
    tasks.push({ ...task, prompt, checklist });
  }
  const source = await readFile(path.join(ROOT, '.tools/study-c/smoke-inputs/prompt_mllm_check.py'), 'utf8');
  if (digest(source) !== manifest.sourceFiles['prompt_mllm_check.py'].sha256) throw new Error('judge_template_hash_mismatch');
  const template = decodeJudgeTemplate(source);
  const directory = path.join(ROOT, '.tools/study-c/quality-runs', runId);
  await mkdir(directory, { recursive: true });
  const lock = await open(path.join(directory, 'run.lock'), 'wx');
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    log.setFile(path.join(directory, 'progress.log'));
    log.log(`run=${runId} tasks=${ids.join(',')} modes=${modes.join(',')} protocol=${QUALITY_PROTOCOL} jvmHeapMb=${jvmHeapMb}`);
    log.log(`specificationRepairRounds=${specificationRepairRounds}; additional shared model call ceiling=${specificationRepairRounds * 3} per task`);
    const client = makeClient({ key: await loadKey(keyFile), retry: { maxAttempts: 1 }, maxConcurrentRequests: 2,
      rateLimiter: createRateLimiter({ requestsPerMinute: 10, tokensPerMinute: 120000 }) });
    const results = [];
    for (const task of tasks) {
      let result;
      try {
        result = await log.withTask(task.id, () => log.withStage('quality-trial', () => runQualityTrial({
        task: { id: task.id, prompt: task.prompt }, client, modes, specificationRepairRounds, directory: path.join(directory, `task-${task.id}`), onProgress: log.log,
        finalJudge: async ({ artifact, directory: judgeDir }) => {
          const prompt = buildJudgePrompt({ template, checklist: task.checklist, question: task.prompt, answer: artifact.answer });
          const judged = await requestOnce({ client, directory: judgeDir, method: 'judge', prompt, images: artifact.render.imageBuffers,
            purpose: `quality-final-${task.id}`, maxOutputTokens: 8000, onProgress: log.log });
          const rawScore = judged.ok ? extractOverallScore(judged.text) : null;
          const score = rawScore === null ? null : scoreToNumber(rawScore);
          return { ok: judged.ok && score !== null, score, rawScore, judgeModel: MODEL, reason: judged.reason ?? (score === null ? 'score_not_parsed' : null) };
        },
        })));
      } catch {
        result = { taskId: task.id, status: 'blocked', reason: 'shared_setup_or_final_evaluation_failed', blockedArmRate: 1 };
        await writeFile(path.join(directory, `task-${task.id}`, 'trial-error.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      }
      results.push(result);
      log.log(`task ${task.id}: ${result.status}`);
    }
    const summary = { runId, modes, specificationRepairRounds, jvmHeapMb, protocol: QUALITY_PROTOCOL, provider: 'xAI', model: MODEL, manifestSha256: manifest.manifestSha256,
      status: results.every((result) => result.status === 'complete') ? 'complete' : 'incomplete',
      judgeCaveat: 'Final calls are held out of selection but use the coder model family; not the published Gemini leaderboard protocol.',
      usage: client.ledger, blockedArmRate: results.reduce((sum, result) => sum + result.blockedArmRate, 0) / results.length, tasks: results };
    await writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    log.log(`quality run ${summary.status}; summary=${path.join(directory, 'summary.json')}`);
    if (summary.status !== 'complete') process.exitCode = 2;
  } finally {
    await lock.close();
    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(directory, 'run.lock'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { log.log('quality_run_failed; inspect saved evidence before resuming'); process.exitCode = 1; });
}