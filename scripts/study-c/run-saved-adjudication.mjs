import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadKey, makeClient, MODEL } from './pipeline/client.mjs';
import { createRateLimiter } from './pipeline/rate-limit.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';
import { behaviorHash, validateBehaviorModel } from './pipeline/behavioral-model.mjs';
import { adjudicateSavedSamples, removeAssociationForDiagnostic } from './pipeline/saved-adjudication.mjs';
import { inspectSavedPrerequisites } from './pipeline/saved-prerequisite-inspection.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function savedAdjudicationOptions(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--phase', '--run-id', '--key-file'].includes(name) || values[name] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('invalid_saved_adjudication_arguments');
    values[name] = args[index + 1];
  }
  if (!['inspect', 'adjudicate'].includes(values['--phase']) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(values['--run-id'] ?? '') ||
      values['--phase'] === 'adjudicate' && !values['--key-file']) throw new Error('saved_adjudication_scope_required');
  return { phase: values['--phase'], runId: values['--run-id'], keyFile: values['--key-file'] };
}

async function main() {
  const options = savedAdjudicationOptions(process.argv.slice(2));
  const plan = JSON.parse(await readFile(path.join(ROOT, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (!plan.qualityFramework?.userApproved || !plan.qualityFramework.taskScope.includes(1267) || plan.providerSwitch?.provider !== 'xAI') throw new Error('saved_adjudication_not_authorized');
  const manifest = JSON.parse(await readFile(path.join(ROOT, '.tools/study-c/five-tasks/manifest.json'), 'utf8'));
  const prompt = await readFile(path.join(ROOT, '.tools/study-c/five-tasks/task-1267.prompt.txt'), 'utf8');
  if (createHash('sha256').update(prompt).digest('hex') !== manifest.tasks.find((item) => String(item.id) === '1267')?.promptSha256) throw new Error('frozen_task_mismatch');
  const base = path.join(ROOT, '.tools/study-c/specification-repairs/semantic-1267-repair-v1/task-1267/loop');
  const sourcePaths = [path.join(base, 'round-1/proposal.json'), path.join(base, 'round-2/proposal.json')];
  const sourceBytes = await Promise.all(sourcePaths.map((file) => readFile(file, 'utf8')));
  const models = sourceBytes.map((text) => JSON.parse(text).model);
  const negative = removeAssociationForDiagnostic(models[1], { contractId: 'category_mgmt', actionId: 'cat_todo_submit', observableId: 'cat_todo_dom',
    actionDescription: 'Type TodoW3mKpN in the to-do title input and save it without assigning or selecting any category. The category created earlier is left unused.',
    observableDescription: 'Number of recorded to-do rows titled TodoW3mKpN, regardless of their category; do not inspect the category association.' });
  const samples = [{ id: 'sample-1', model: models[0] }, { id: 'sample-2', model: models[1] }, { id: 'sample-3', model: negative }];
  for (const sample of samples) validateBehaviorModel(sample.model, prompt);
  const artifactPath = path.join(ROOT, '.tools/study-c/quality-runs/quality-v3-1267-T-1gb-first/task-1267/initial/desktop/html_desktop.html');
  const artifactBytes = await readFile(artifactPath, 'utf8');
  const inputs = { taskId: 1267, promptHash: behaviorHash(prompt), sourceFiles: sourcePaths.map((file, index) => ({ file, hash: behaviorHash(sourceBytes[index]) })),
    artifactPath, artifactHash: behaviorHash(artifactBytes), samples: samples.map((item) => ({ id: item.id, modelHash: behaviorHash(item.model) })) };
  const directory = path.join(ROOT, '.tools/study-c/saved-adjudication', options.runId);
  const log = createProgressLogger();
  if (options.phase === 'inspect') {
    await mkdir(path.dirname(directory), { recursive: true });
    await mkdir(directory);
    log.setFile(path.join(directory, 'inspection-progress.log'));
    await writeFile(path.join(directory, 'inputs.json'), `${JSON.stringify(inputs, null, 2)}\n`, { flag: 'wx' });
    await writeFile(path.join(directory, 'sample-roles.json'), JSON.stringify({ 'sample-1': 'saved round-1', 'sample-2': 'saved round-2',
      'sample-3': 'round-2 diagnostic copy without category association', expectedNegative: { sample: 'sample-3', contract: 'category_mgmt', requirement: 'req_cat_linked', disposition: 'violates-obligation' } }), { flag: 'wx' });
    await writeFile(path.join(directory, 'negative-model.json'), `${JSON.stringify(negative, null, 2)}\n`, { flag: 'wx' });
    const inspection = await log.withTask(1267, () => log.withStage('offline-prerequisites', () => inspectSavedPrerequisites({ artifactPath, samples: samples.slice(0, 2) })));
    const unchanged = (await Promise.all(sourcePaths.map((file) => readFile(file, 'utf8')))).every((text, index) => text === sourceBytes[index]) && artifactBytes === await readFile(artifactPath, 'utf8');
    await writeFile(path.join(directory, 'offline-inspection.json'), `${JSON.stringify({ ...inspection, inputs, sourceUnchanged: unchanged }, null, 2)}\n`, { flag: 'wx' });
    if (!unchanged) throw new Error('source_changed');
    log.log(`offline inspection finished; ${inspection.checks.length} checks; no API calls; sources unchanged`);
    return;
  }
  const prior = JSON.parse(await readFile(path.join(directory, 'offline-inspection.json'), 'utf8'));
  if (!prior.sourceUnchanged || behaviorHash(prior.inputs) !== behaviorHash(inputs)) throw new Error('offline_inspection_identity_mismatch');
  const liveDirectory = path.join(directory, 'live');
  await mkdir(liveDirectory);
  log.setFile(path.join(liveDirectory, 'progress.log'));
  const client = makeClient({ key: await loadKey(options.keyFile), maxConcurrentRequests: 1, retry: { maxAttempts: 1 },
    rateLimiter: createRateLimiter({ requestsPerMinute: 10, tokensPerMinute: 120000 }) });
  try {
    log.log('task=1267 saved adjudication only; three samples, maxCalls=3, no repair/bindings/scoring');
    const summary = await log.withTask(1267, () => log.withStage('saved-sample-adjudication', () => adjudicateSavedSamples({ task: { id: 1267, prompt }, samples,
      client, directory: path.join(liveDirectory, 'evidence'), onProgress: log.log })));
    const negativeVerdict = summary.results[2].adjudication?.contracts.find((item) => item.id === 'category_mgmt');
    const associationVerdict = negativeVerdict?.requirements.find((item) => item.id === 'req_cat_linked');
    const unchanged = (await Promise.all(sourcePaths.map((file) => readFile(file, 'utf8')))).every((text, index) => text === sourceBytes[index]) && artifactBytes === await readFile(artifactPath, 'utf8');
    const outcome = { results: summary.results.map((item) => ({ id: item.id, status: item.status, accepted: item.adjudication?.contracts.filter((contract) => contract.accepted).length ?? null,
      generated: samples.find((sample) => sample.id === item.id).model.contracts.length })),
      negativeControl: { detected: associationVerdict?.disposition === 'violates-obligation', blocked: negativeVerdict?.accepted === false, verdict: associationVerdict ?? null },
      sourceUnchanged: unchanged, fullRepairRunStarted: false, artifactRepairAuthorized: false };
    await writeFile(path.join(liveDirectory, 'outcome.json'), `${JSON.stringify(outcome, null, 2)}\n`, { flag: 'wx' });
    log.log(`adjudication finished; negative detected=${outcome.negativeControl.detected}; sources unchanged=${unchanged}`);
    if (!unchanged || !outcome.negativeControl.detected || summary.results.some((item) => item.status !== 'reviewed')) process.exitCode = 2;
  } finally {
    await writeFile(path.join(liveDirectory, 'usage.json'), `${JSON.stringify({ provider: 'xAI', model: MODEL, ledger: client.ledger }, null, 2)}\n`, { flag: 'wx' });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('saved_adjudication_check_failed; inspect evidence before any further call\n'); process.exitCode = 1; });
}