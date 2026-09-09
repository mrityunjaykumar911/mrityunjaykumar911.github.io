import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { qualityOptions } from './run-quality.mjs';
import { loadKey, makeClient, MODEL } from './pipeline/client.mjs';
import { createRateLimiter } from './pipeline/rate-limit.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';
import { repairLimits, runSpecificationRepair } from './pipeline/specification-repair.mjs';
import { behaviorHash } from './pipeline/behavioral-model.mjs';
import { validatorHeapMb } from './pipeline/tla-oracle.mjs';
import { verifySelectedSpecification } from './pipeline/selected-specification-browser.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function specificationRepairOptions(args) {
  const forwarded = [];
  let sourceModel;
  let artifact;
  let maxRounds;
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('invalid_specification_repair_arguments');
    if (name === '--source-model') {
      if (sourceModel) throw new Error('duplicate_source_model');
      sourceModel = value;
    } else if (name === '--artifact') {
      if (artifact) throw new Error('duplicate_artifact');
      artifact = value;
    } else if (name === '--max-rounds') {
      if (maxRounds !== undefined || !/^[0-3]$/.test(value)) throw new Error('invalid_specification_repair_round_limit');
      maxRounds = Number(value);
    } else {
      if (name === '--modes') throw new Error('specification_repair_has_no_arms');
      forwarded.push(name, value);
    }
  }
  const options = qualityOptions(forwarded);
  if (!sourceModel || options.ids.length !== 1) throw new Error('specification_repair_single_source_and_task_required');
  if (artifact && maxRounds === 0) throw new Error('browser_verification_requires_task_adjudication');
  return { ...options, sourceModel, artifact, ...repairLimits(maxRounds ?? 2) };
}

async function main() {
  const options = specificationRepairOptions(process.argv.slice(2));
  const [id] = options.ids;
  const plan = JSON.parse(await readFile(path.join(ROOT, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (!plan.qualityFramework?.userApproved || !plan.fiveTaskRun?.userAuthorized || plan.providerSwitch?.provider !== 'xAI') throw new Error('specification_repair_not_authorized');
  const manifest = JSON.parse(await readFile(path.join(ROOT, '.tools/study-c/five-tasks/manifest.json'), 'utf8'));
  const frozenTask = manifest.tasks.find((item) => String(item.id) === id);
  if (!frozenTask) throw new Error('specification_repair_task_outside_scope');
  const prompt = await readFile(path.join(ROOT, `.tools/study-c/five-tasks/task-${id}.prompt.txt`), 'utf8');
  if (createHash('sha256').update(prompt).digest('hex') !== frozenTask.promptSha256) throw new Error('specification_repair_prompt_mismatch');
  const sourceFile = path.resolve(ROOT, options.sourceModel);
  const sourceBytes = await readFile(sourceFile, 'utf8');
  const source = JSON.parse(sourceBytes);
  if (source.promptHash !== behaviorHash(prompt) || source.modelHash !== behaviorHash(source.model)) throw new Error('specification_repair_source_mismatch');
  const artifactPath = options.artifact ? path.resolve(ROOT, options.artifact) : null;
  const html = artifactPath ? await readFile(artifactPath, 'utf8') : null;
  const directory = path.join(ROOT, '.tools/study-c/specification-repairs', options.runId, `task-${id}`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory);
  const log = createProgressLogger();
  log.setFile(path.join(directory, 'progress.log'));
  let client;
  try {
    client = options.maxRounds ? makeClient({ key: await loadKey(options.keyFile), retry: { maxAttempts: 1 }, maxConcurrentRequests: 1,
      rateLimiter: createRateLimiter({ requestsPerMinute: 10, tokensPerMinute: 120000 }) }) : undefined;
    log.log(`specification repair run=${options.runId} model=${MODEL} task=${id} rounds=${options.maxRounds} maxCalls=${options.maxCalls} heapMb=${validatorHeapMb()}; no app generation or scoring`);
    if (artifactPath) log.log(`selected-artifact verification enabled after selection only; additional binding/review ceiling=${source.model.contracts.length * 2} calls; artifact excluded from all specification prompts`);
    const summary = await log.withTask(id, () => log.withStage('generative-specification-repair', () => runSpecificationRepair({
      task: { id: frozenTask.id, prompt }, source, directory: path.join(directory, 'loop'), client, maxRounds: options.maxRounds, onProgress: log.log,
    })));
    let browserVerification = null;
    if (artifactPath && summary.taskValidatedContractIds.length) {
      const selected = JSON.parse(await readFile(path.join(directory, 'loop', 'selected-source.json'), 'utf8'));
      browserVerification = await log.withTask(id, () => log.withStage('selected-combination-browser-verification', () => verifySelectedSpecification({
        task: { id: frozenTask.id, prompt }, source: selected, selection: summary, html, client,
        directory: path.join(directory, 'selected-browser'), onProgress: log.log,
      })));
    }
    const unchanged = sourceBytes === await readFile(sourceFile, 'utf8') && (!artifactPath || html === await readFile(artifactPath, 'utf8'));
    await writeFile(path.join(directory, 'source-integrity.json'), `${JSON.stringify({ sourceFile, sourceHash: behaviorHash(sourceBytes), unchanged }, null, 2)}\n`, { flag: 'wx' });
    if (!unchanged) throw new Error('source_specification_changed');
    await writeFile(path.join(directory, 'run-result.json'), `${JSON.stringify({ modelStatus: summary.status, selectedVersion: summary.selectedVersion,
      taskValidatedContractIds: summary.taskValidatedContractIds, browserGate: browserVerification?.browserGate ?? 'not-run',
      artifactRepairAuthorized: browserVerification?.artifactRepairAuthorized ?? false,
      scopedArtifactRepairAuthorized: browserVerification?.scopedArtifactRepairAuthorized ?? false,
      repairableContractIds: browserVerification?.repairableContractIds ?? [], artifactHash: html ? behaviorHash(html) : null }, null, 2)}\n`, { flag: 'wx' });
    log.log(`repair ${summary.status}; selected=${summary.selectedVersion}; reason=${summary.stopReason}; eligible=${summary.finalValidation.coverage.eligible}/${summary.originalContractCount}`);
    if (summary.status !== 'model-admitted' || artifactPath && !browserVerification?.fullScopeVerified) process.exitCode = 2;
  } finally {
    await writeFile(path.join(directory, 'provider-usage.json'), `${JSON.stringify({ provider: 'xAI', model: MODEL, ledger: client?.ledger ?? { requests: 0 } }, null, 2)}\n`, { flag: 'wx' });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('specification_repair_failed; inspect saved evidence before another run\n'); process.exitCode = 1; });
}