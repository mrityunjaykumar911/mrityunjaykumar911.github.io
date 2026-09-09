// ArtifactsBench five-task runner (coding + judging via grok-4.6). Executes the
// faithful loop: generate a self-contained HTML artifact, render it headless and
// capture three full-page screenshots (utils.py convention), then score it with
// the pinned MLLM judge template plus those screenshots. Per-stage results are
// cached so a crash resumes without re-billing. Budget is waived for these five
// tasks by recorded authorization; usage is still tracked. B/G/T repair arms are
// applied when --arms is set. Credentials stay process-local and are never logged.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeClient, loadKey, MODEL } from './pipeline/client.mjs';
import { renderAndCapture } from './pipeline/render.mjs';
import { extractLastHtmlOrSvg } from './pipeline/extract.mjs';
import { decodeJudgeTemplate, judgeArtifact } from './pipeline/judge.mjs';
import { buildArm, ARM_IDS } from './pipeline/arms.mjs';
import { createRateLimiter, pLimit } from './pipeline/rate-limit.mjs';
import { generatedCacheIdentity, verifiedGeneratedFeedback } from './pipeline/generative-tla.mjs';
import { GENERATIVE_PROTOCOL as TLA_PROTOCOL_VERSION, generateTaskContracts } from './pipeline/task-contracts.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';

const REPAIR_POLICY = 'failure-only-v1';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIVE = path.join(ROOT, '.tools/study-c/five-tasks');
const SMOKE = path.join(ROOT, '.tools/study-c/smoke-inputs');
const RUNS = path.join(ROOT, '.tools/study-c/five-run');
const digest = (value) => createHash('sha256').update(value).digest('hex');

const progressLogger = createProgressLogger();
const progress = progressLogger.log;

const CODER_SYSTEM =
  'You are a code expert. Produce a single, complete, self-contained HTML document ' +
  'that runs offline: inline all CSS and JavaScript, use no external network resources, ' +
  'CDNs, fonts, or images. Return the entire document inside one ```html code block, ' +
  'starting with <!DOCTYPE html> and a single <html>...</html> element.';

// Idempotent per-stage cache. Only SUCCESSFUL results are persisted; a failed
// stage (ok === false) is returned but not cached, so a rerun retries it instead
// of replaying a stale failure.
export async function stage(dir, run, accept = () => true) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'result.json');
  try {
    await access(file);
    const result = JSON.parse(await readFile(file, 'utf8'));
    if (result?.ok !== false && accept(result)) return { ...result, cached: true };
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = await progressLogger.withStage(path.relative(RUNS, dir).replaceAll('\\', '/'), run);
  if (result?.ok !== false && accept(result)) {
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  return { cached: false, ...result };
}

// One coding/repair generation: persist the answer, extract + render, capture
// screenshots, and record observations. Returns paths and buffers for judging.
async function produceArtifact({ client, dir, prompt, purpose, index }) {
  await mkdir(dir, { recursive: true });
  progress(`  generate: ${purpose} (streaming)`);
  const gen = await stage(path.join(dir, 'gen'), () =>
      client.generate({
        system: CODER_SYSTEM, prompt, purpose,
        onProgress: ({ chars, ms }) => progress(`  generate: ${purpose} … ${chars} chars @ ${(ms / 1000).toFixed(1)}s`),
        onRetry: ({ attempt, reason, delayMs }) => progress(`  generate: ${purpose} retry #${attempt} after ${reason}; backoff ${(delayMs / 1000).toFixed(1)}s`),
      }));
  if (!gen.ok) { progress(`  generate: ${purpose} FAILED (${gen.reason || 'error'})`); return { ok: false, gen }; }
  const ttft = gen.msToFirstToken != null ? `, ttft ${(gen.msToFirstToken / 1000).toFixed(1)}s` : '';
  progress(`  generate: ${purpose} ok${gen.cached ? ' (cached)' : ''} (${gen.usage?.outputTokens ?? '?'} out tok, ${((gen.ms ?? 0) / 1000).toFixed(1)}s${ttft})`);
  const answer = gen.text ?? '';
  await writeFile(path.join(dir, 'answer.txt'), answer, 'utf8');
  const extracted = extractLastHtmlOrSvg(answer);
  if (extracted.type === 'none' || !extracted.content) {
    progress(`  extract: ${purpose} no html/svg block`);
    return { ok: false, gen, extractedType: 'none' };
  }
  const html = extracted.type === 'svg'
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${extracted.content}</body></html>`
    : extracted.content;
  progress(`  render: ${purpose} (${extracted.type}) …`);
  const render = await progressLogger.withStage(`render-${purpose}`, () => renderAndCapture({ html, outDir: dir, index, count: 3 }));
  progress(`  render: ${purpose} done (rendered=${render.observations.rendered}, consoleErr=${render.observations.consoleErrors.length})`);
  return { ok: true, gen, answer, extracted, render };
}

export function runTask(options) {
  return progressLogger.withTask(options.task.id, () => runTaskWithProgress(options));
}

async function runTaskWithProgress({ client, task, template, checklist, runDir, arms, pools,
  produce = produceArtifact, feedbackFor = buildArm, judge = judgeArtifact, contractsFor = generateTaskContracts }) {
  const taskDir = path.join(runDir, `task-${task.id}`);
  const record = { id: task.id, difficulty: task.difficulty, category: task.category, arms: {} };
  progress(`task ${task.id} (${task.difficulty}): start; arms=[${arms.join(',') || 'none'}]`);
  let generatedContracts;
  if (arms.includes('T')) {
    try {
      generatedContracts = await progressLogger.withStage('contract-generation', () => contractsFor({ task: { id: task.id, prompt: task.prompt }, client,
        outDir: path.join(taskDir, TLA_PROTOCOL_VERSION), onProgress: progress }));
      record.contractGeneration = { status: 'generated', contractSha256: generatedContracts.contractSha256,
        count: generatedContracts.contracts.length, cached: generatedContracts.cached };
    } catch {
      record.contractGeneration = { status: 'blocked', reason: 'contract_generation_invalid_or_incomplete' };
      progress(`task ${task.id}: contract generation blocked; baseline arms can still run`);
    }
  }

  // Shared initial artifact across arms.
  const initial = await produce({
    client, dir: path.join(taskDir, 'initial'), prompt: task.prompt,
    purpose: `gen-initial-${task.id}`, index: `initial_${task.id}`,
  });
  record.initial = summarize(initial);
  if (!initial.ok) return record;

  const question = task.prompt;

  // Build each arm's final artifact concurrently: the arms are independent once
  // the shared initial exists. The arm pool caps parallelism; the client's rate
  // limiter and global gate keep total load under account RPM/TPM limits.
  const armResults = await Promise.all(arms.map((arm) => pools.arm(async () => {
    progress(`task ${task.id} arm ${arm}: build feedback …`);
    if (arm === 'T' && !generatedContracts) return { arm, finalArtifact: null,
      meta: { status: 'blocked', reason: record.contractGeneration.reason, repaired: false, score: null, protocolVersion: TLA_PROTOCOL_VERSION } };
    const identity = arm === 'T' ? generatedCacheIdentity(initial.extracted.content, generatedContracts) : null;
    const armDir = path.join(taskDir, `arm-${arm}`, REPAIR_POLICY, identity?.key ?? '');
    const feedback = await stage(path.join(armDir, 'feedback'), () =>
      feedbackFor({ arm, client, task, artifact: initial, evidenceDir: path.join(armDir, 'evidence'), onProgress: progress, generatedContracts }),
      (result) => arm !== 'T' || verifiedGeneratedFeedback(result, identity));
    if (feedback.ok === false || (arm === 'T' && !verifiedGeneratedFeedback(feedback, identity))) {
      const reason = feedback.reason ?? 'unverified_formal_feedback';
      progress(`task ${task.id} arm ${arm}: BLOCKED (${reason}); no repair or judge call`);
      return { arm, finalArtifact: null, meta: { status: 'blocked', reason, repaired: false, score: null,
        protocolVersion: arm === 'T' ? TLA_PROTOCOL_VERSION : null, validation: feedback.validation ?? null, suite: feedback.suite ?? null } };
    }
    let finalArtifact = initial;
    let repaired = false;
    let postRepair = null;
    if (feedback.repairPrompt) {
      const r = await produce({
        client, dir: path.join(armDir, 'repair'),
        prompt: feedback.repairPrompt, purpose: `repair-${arm}-${task.id}`,
        index: `arm_${arm}_${task.id}`,
      });
      if (r.ok) { finalArtifact = r; repaired = true; }
      else {
        return { arm, finalArtifact: null, meta: { status: 'repair-failed', repaired: false, score: null,
          reason: r.gen?.reason ?? 'artifact_generation_failed', protocolVersion: TLA_PROTOCOL_VERSION } };
      }
      if (arm === 'T' && repaired) {
        const finalIdentity = generatedCacheIdentity(finalArtifact.extracted.content, generatedContracts);
        const finalDir = path.join(armDir, 'post-repair', finalIdentity.key);
        progress(`task ${task.id} arm T: replaying the same generated contracts after repair`);
        const verified = await stage(path.join(finalDir, 'feedback'), () => feedbackFor({
          arm, client, task, artifact: finalArtifact, generatedContracts, evidenceDir: path.join(finalDir, 'evidence'), onProgress: progress,
        }), (result) => verifiedGeneratedFeedback(result, finalIdentity));
        postRepair = { status: verified.ok ? verified.suite.status : 'blocked',
          reason: verified.reason ?? null, failures: verified.replay?.failures ?? null, evidenceDir: verified.evidenceDir ?? finalDir };
      }
    }
    return {
      arm, finalArtifact, judgeKey: identity ? path.join('arm-T', REPAIR_POLICY, identity.key) : path.join(`arm-${arm}`, REPAIR_POLICY),
      meta: { status: repaired ? 'repaired' : 'unchanged', repaired, feedbackKind: feedback.kind, findings: feedback.findings,
        validation: feedback.validation ?? null, postRepair,
        ...(identity ? { protocolVersion: identity.protocolVersion, contractSha256: identity.contractSha256,
          sourceSha256: identity.sourceSha256, replay: feedback.replay, suite: feedback.suite, evidenceDir: feedback.evidenceDir } : {}) },
    };
  })));

  const judgeTargets = [{ key: 'initial', artifact: initial }];
  for (const { arm, finalArtifact, meta, judgeKey } of armResults) {
    record.arms[arm] = meta;
    if (!finalArtifact) continue;
    if (!meta.repaired) {
      record.arms[arm].scoreSource = 'initial';
      continue;
    }
    judgeTargets.push({ key: `arm-${arm}`, judgeKey, artifact: finalArtifact });
  }

  // Score every target concurrently, regardless of gate outcome.
  await Promise.all(judgeTargets.map((target) => pools.judge(async () => {
    progress(`task ${task.id} judge ${target.key} …`);
    const jdir = path.join(taskDir, 'judge', target.judgeKey ?? target.key);
    const j = await stage(jdir, () => judge({
      client, template, checklist, question,
      answer: target.artifact.answer, imageBuffers: target.artifact.render.imageBuffers,
      purpose: `judge-${target.key}-${task.id}`,
    }));
    progress(`task ${task.id} judge ${target.key}: score=${j.score ?? 'null'}${j.cached ? ' (cached)' : ''}`);
    const slot = target.key === 'initial' ? record.initial : record.arms[target.key.replace('arm-', '')];
    slot.score = j.score;
    if (!j.ok || j.score === null) slot.judgeIssue = j.reason || 'score_not_parsed';
  })));

  for (const arm of Object.values(record.arms)) {
    if (arm.scoreSource !== 'initial') continue;
    arm.score = record.initial.score;
    if (record.initial.judgeIssue) arm.judgeIssue = record.initial.judgeIssue;
  }
  return record;
}

function summarize(artifact) {
  if (!artifact.ok) {
    return { ok: false, reason: artifact.extractedType === 'none' ? 'no_html_block' : (artifact.gen?.reason || 'generation_failed') };
  }
  return {
    ok: true, extractedType: artifact.extracted.type,
    rendered: artifact.render.observations.rendered,
    consoleErrors: artifact.render.observations.consoleErrors.length,
    pageErrors: artifact.render.observations.pageErrors.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const keyIdx = args.indexOf('--key-file');
  if (keyIdx === -1 || !args[keyIdx + 1]) throw new Error('key_file_argument_required');
  const only = (args[args.indexOf('--tasks') + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const armsArg = args.indexOf('--arms') === -1 ? 'none' : args[args.indexOf('--arms') + 1];
  const arms = armsArg === 'none' ? [] : armsArg.split(',').map((s) => s.trim()).filter((a) => ARM_IDS.includes(a));

  const plan = JSON.parse(await readFile(path.join(ROOT, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (plan.providerSwitch?.provider !== 'xAI') throw new Error('provider_switch_not_configured');
  if (plan.fiveTaskRun?.userAuthorized !== true) throw new Error('five_task_run_not_authorized');

  const manifest = JSON.parse(await readFile(path.join(FIVE, 'manifest.json'), 'utf8'));
  // Re-verify the pinned judge template hash before any billing.
  const templateSource = await readFile(path.join(SMOKE, 'prompt_mllm_check.py'), 'utf8');
  if (digest(templateSource) !== manifest.sourceFiles['prompt_mllm_check.py'].sha256) {
    throw new Error('judge_template_hash_mismatch');
  }
  const template = decodeJudgeTemplate(templateSource);

  const selected = manifest.tasks.filter((t) => !only.length || only.includes(String(t.id)));
  if (!selected.length) throw new Error('no_tasks_selected');
  progress(`config ok: model=${MODEL}, tasks=[${selected.map((t) => t.id).join(',')}], arms=[${arms.join(',') || 'none'}]`);

  // Optional --run-id reuses an existing run directory so already-cached stages
  // (e.g. a prior initial artifact) are not re-billed when extending with arms.
  const runIdArg = args[args.indexOf('--run-id') + 1];
  const runId = args.indexOf('--run-id') !== -1 && runIdArg
    ? runIdArg
    : `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(RUNS, runId);
  await mkdir(runDir, { recursive: true });
  const progressFile = path.join(runDir, 'progress.log');
  progressLogger.setFile(progressFile);
  await writeFile(path.join(runDir, 'runtime.json'), `${JSON.stringify({
    pid: process.pid, runId, startedAt: new Date().toISOString(), taskIds: selected.map((task) => task.id),
    vscodeTask: process.env.VSCODE_TASK_LABEL ?? null, progressFile, heartbeatMs: 5000,
  }, null, 2)}\n`, 'utf8');
  progress(`runner started; pid=${process.pid}; progressFile=${progressFile}`);
  progress(`configuration: tasks=[${selected.map((task) => task.id).join(',')}] arms=[${arms.join(',')}] protocol=${TLA_PROTOCOL_VERSION}`);

  const key = await loadKey(args[keyIdx + 1]);
  // Rate limits + concurrency are configurable via plan.rateLimits; defaults are
  // conservative for a single API key doing heavy reasoning calls. The client
  // enforces RPM/TPM + a global in-flight cap; the pools bound task/arm/judge fan-out.
  const rl = plan.rateLimits ?? {};
  const rateLimiter = createRateLimiter({
    requestsPerMinute: rl.requestsPerMinute ?? 60,
    tokensPerMinute: rl.tokensPerMinute ?? 2_000_000,
  });
  const client = makeClient({
    key, rateLimiter,
    maxConcurrentRequests: rl.maxConcurrentRequests ?? 3,
    retry: rl.retry,
    timeouts: rl.timeouts,
  });
  const pools = {
    task: pLimit(rl.taskConcurrency ?? 2),
    arm: pLimit(rl.armConcurrency ?? 3),
    judge: pLimit(rl.judgeConcurrency ?? 2),
  };
  progress(`runId=${runId}; key loaded (process-local); limits rpm=${rl.requestsPerMinute ?? 60} tpm=${rl.tokensPerMinute ?? 2_000_000} maxInFlight=${rl.maxConcurrentRequests ?? 3}; concurrency task=${rl.taskConcurrency ?? 2} arm=${rl.armConcurrency ?? 3} judge=${rl.judgeConcurrency ?? 2}; starting …`);

  const results = await Promise.all(selected.map((task) => pools.task(async () => {
    // Verify each task's frozen prompt/checklist hash before use.
    const prompt = await readFile(path.join(FIVE, `task-${task.id}.prompt.txt`), 'utf8');
    const checklist = await readFile(path.join(FIVE, `task-${task.id}.checklist.txt`), 'utf8');
    if (digest(prompt) !== task.promptSha256 || digest(checklist) !== task.checklistSha256) {
      throw new Error(`task_${task.id}_hash_mismatch`);
    }
    const rec = await runTask({ client, task: { ...task, prompt }, template, checklist, runDir, arms, pools });
    await writeFile(path.join(runDir, `task-${task.id}`, `summary-${TLA_PROTOCOL_VERSION}.json`), `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
    progress(`task ${task.id}: complete`);
    return rec;
  })));

  const summary = {
    schemaVersion: 1, runId, model: MODEL, provider: 'xAI', arms,
    formalProtocolVersion: arms.includes('T') ? TLA_PROTOCOL_VERSION : null,
    repairPolicy: REPAIR_POLICY,
    status: results.some((result) => !result.initial?.ok || result.initial?.judgeIssue ||
      Object.values(result.arms).some((arm) => ['blocked', 'repair-failed'].includes(arm.status) || arm.postRepair?.status === 'blocked' || arm.judgeIssue))
      ? 'incomplete' : 'complete',
    manifestSha256: manifest.manifestSha256, generatedAt: new Date().toISOString(),
    rateLimits: {
      requestsPerMinute: rl.requestsPerMinute ?? 60,
      tokensPerMinute: rl.tokensPerMinute ?? 2_000_000,
      maxConcurrentRequests: rl.maxConcurrentRequests ?? 3,
      taskConcurrency: rl.taskConcurrency ?? 2,
      armConcurrency: rl.armConcurrency ?? 3,
      judgeConcurrency: rl.judgeConcurrency ?? 2,
      timeouts: rl.timeouts ?? null,
    },
    usageLedger: client.ledger,
    caveats: [
      'Five related local-utility tasks: a feasibility sample, NOT representative ArtifactsBench coverage.',
      'Judge shares the coder model family (grok-4.6); scores are not comparable to the published Gemini-judged leaderboard.',
      'T contracts and traces are model-generated from each task prompt, not selected from fixed task contracts. Failed or unmapped contracts are blocked, not passes.',
      'All arms repair only reported failures; G findings are model code review, T findings are executed bounded contract evidence, neither proves the HTML correct.',
    ],
    tasks: results,
  };
  const summaryPath = path.join(runDir, arms.includes('T') ? `summary-${TLA_PROTOCOL_VERSION}.json` : 'summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  if (summary.status === 'incomplete') process.exitCode = 2;
  progress(`FINISHED (${summary.status}): ${results.length} task(s); summary -> ${path.relative(ROOT, summaryPath)}`);
  console.log(JSON.stringify({
    runId, arms, usage: client.ledger,
    scores: results.map((r) => ({
      id: r.id, difficulty: r.difficulty, initial: r.initial?.score ?? null,
      arms: Object.fromEntries(Object.entries(r.arms).map(([k, v]) => [k, v.score ?? null])),
    })),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`five-run failed: ${error.message}`);
    process.exitCode = 1;
  });
}
