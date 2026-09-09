// Budget feasibility only: NEVER calls /v1/messages. Calibration screenshots
// are authored fixtures, not model outputs and not benchmark results.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { countMessageTokens, TokenCountError } from './token-count.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INPUT = path.join(ROOT, '.tools/study-c/smoke-inputs');
const OUT = path.join(ROOT, '.tools/study-c/smoke-budget');
const digest = (value) => createHash('sha256').update(value).digest('hex');

// Decode the pinned prompt's literal strings, without importing/executing
// Python or untrusted remote source. Fail on any unfamiliar syntax.
export function decodeJudgeTemplate(source) {
  const body = source.match(/prompt_mllm_content = \(([\s\S]*?)\n\)/)?.[1];
  if (!body) throw new Error('judge_template_not_recognized');
  let template = '';
  for (const line of body.trim().split(/\r?\n/)) {
    if (!/^\s*"(?:[^"\\]|\\.)*"\s*$/.test(line)) throw new Error('judge_template_not_literal');
    template += JSON.parse(line.trim());
  }
  for (const field of ['Checklist', 'Question', 'Answer']) {
    if (template.split(`$${field}`).length !== 2) throw new Error('judge_template_placeholder_mismatch');
  }
  return template;
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--key-file') {
    throw new Error('credential_file_argument_required');
  }
  const plan = JSON.parse(await readFile(path.join(ROOT, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (plan.model.provider !== 'Anthropic' || plan.judge.provider !== 'Anthropic') {
    throw new Error('anthropic_provider_not_selected');
  }
  if (!plan.userAuthorization.isolatedExecutionAllowed || plan.userAuthorization.totalTokenCap !== 20000) {
    throw new Error('unexpected_authorization');
  }
  const manifest = JSON.parse(await readFile(path.join(INPUT, 'manifest.json'), 'utf8'));
  const prompt = await readFile(path.join(INPUT, 'task.prompt.txt'), 'utf8');
  const checklist = await readFile(path.join(INPUT, 'judge.checklist.txt'), 'utf8');
  const templateSource = await readFile(path.join(INPUT, 'prompt_mllm_check.py'), 'utf8');
  if (digest(prompt) !== manifest.selectedTask.promptSha256 ||
      digest(checklist) !== manifest.selectedTask.checklistSha256 ||
      digest(templateSource) !== manifest.sourceFiles['prompt_mllm_check.py'].sha256) {
    throw new Error('public_input_hash_mismatch');
  }
  await mkdir(OUT, { recursive: true });
  const report = {
    schemaVersion: 1, stage: 'C1-smoke-20k-budget-preflight', checkedAt: new Date().toISOString(),
    taskId: manifest.selectedTask.id, generationRequests: 0, billedGenerationTokens: 0,
    tokenCountRequests: 0, credentialDisplayedOrPersisted: false, countAttempts: [],
    cap: plan.userAuthorization.totalTokenCap,
    status: 'preflight_incomplete', inferenceAuthorized: false,
    limitations: [
      'Token-count API responses are estimates, not a hard upper bound.',
      'Calibration images are not model outputs; future full-page image dimensions may differ.',
      'Empty-code envelope excludes generated code, repeated repair context, contracts, and feedback.',
      'Readiness and a whole-block budget admission are still required even if this estimate fits.',
    ],
  };
  let key;
  try {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const images = [];
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
        serviceWorkers: 'block', acceptDownloads: false });
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent('<!doctype html><html><head><style>body{margin:0;background:#f4f1e8;font:24px sans-serif;color:#17201d}main{padding:60px}section{display:flex;gap:40px}article{padding:40px;border:1px solid #aaa;background:white}strong{font-size:80px;display:block}</style></head><body><main><h1>Calibration fixture — not a model artifact</h1><section><article>Player A<strong>0</strong></article><article>Player B<strong>0</strong></article></section></main></body></html>');
      for (let index = 0; index < 3; index++) {
        const bytes = await page.screenshot({ fullPage: true, type: 'png' });
        await writeFile(path.join(OUT, `calibration-${index + 1}.png`), bytes);
        images.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') } });
      }
      report.calibration = { width: 1280, height: 720, imageCount: images.length,
        browser: browser.version(), screenshotHashes: images.map((image) => digest(Buffer.from(image.source.data, 'base64'))) };
    } finally { await browser.close(); }
    // Key is loaded AFTER browser teardown; it is never in the child process
    // environment, logs, candidate input, or written request metadata.
    key = (await readFile(process.argv[3], 'utf8')).replace(/^\uFEFF/, '').trim();
    if (!/^sk-ant-api03-[A-Za-z0-9_-]+$/.test(key)) throw new Error('credential_format_not_accepted');
    async function count(label, model, content) {
      const attempt = { label, model, status: 'pending' };
      report.countAttempts.push(attempt);
      report.tokenCountRequests += 1;
      try {
        const result = await countMessageTokens({ model, content, key });
        Object.assign(attempt, { status: 'counted', ...result });
        return result;
      } catch (error) {
        attempt.status = 'failed';
        if (error instanceof TokenCountError) attempt.diagnostic = error.diagnostic;
        throw error;
      }
    }
    const template = decodeJudgeTemplate(templateSource);
    const judgeText = template.replace(/\$(Checklist|Question|Answer)/g,
      (_, field) => ({ Checklist: checklist, Question: prompt, Answer: '<html></html>' })[field]);
    const initialText = `${prompt}\nReturn one complete, self-contained HTML document with inline CSS/JavaScript and no external dependencies or commentary.`;
    const initial = await count('initial_prompt', plan.model.immutableModelId, [{ type: 'text', text: initialText }]);
    const judge = await count('judge_envelope', plan.judge.immutableModelId, [{ type: 'text', text: judgeText }, ...images]);
    report.counts = { initialPromptOnly: initial, judgeWithEmptyCodeAndThreeImages: judge };
    const estimatedBaseInput = initial.inputTokens + 3 * judge.inputTokens;
    report.accounting = {
      estimatedBaseInput,
      remainingBeforeAllOutputsAndRepairInputs: report.cap - estimatedBaseInput,
      proposedOutputCaps: { initial: 1024, eachRepair: 1024, eachJudge: 256 },
      maximumOutputsAtProposedCaps: 4 * 1024 + 3 * 256,
      envelopePlusMaximumOutputs: estimatedBaseInput + 4 * 1024 + 3 * 256,
      stillExcluded: 'Three repair prompts, repeated initial/final code, contract/feedback, input uncertainty and larger screenshots.',
    };
    report.status = report.accounting.envelopePlusMaximumOutputs > report.cap
      ? 'blocked_proposed_envelope_exceeds_cap_before_repair_inputs'
      : 'base_envelope_fits_full_block_not_yet_established';
  } catch (error) {
    // Only emit controlled reason codes; no raw network/filesystem exceptions.
    report.status = 'preflight_error';
    report.errorCode = /^([a-z_]+|token_count_http_\d+)$/.test(error.message) ? error.message : 'local_or_network_preflight_failure';
    if (error instanceof TokenCountError) report.apiDiagnostic = error.diagnostic;
  } finally {
    key = undefined;
    await writeFile(path.join(OUT, 'budget-preflight.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.status === 'preflight_error') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Budget preflight could not start. No generation attempted.'); process.exitCode = 1; });
}