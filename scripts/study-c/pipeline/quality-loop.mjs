import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { behaviorHash } from './behavioral-model.mjs';
import { evaluateQualityArtifact, selectQualityCandidate } from './quality-evidence.mjs';
import { requestOnce, parseObject } from './quality-contracts.mjs';
import { extractLastHtmlOrSvg } from './extract.mjs';
import { renderAndCapture } from './render.mjs';

export const QUALITY_LIMITS = Object.freeze({ maxCalls: 22, maxOutputTokens: 110000 });
export function budgetClient(client, limits = QUALITY_LIMITS) {
  if (![limits.maxCalls, limits.maxOutputTokens].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('invalid_arm_budget');
  const accounting = { calls: 0, reservedOutputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, unknownUsageCalls: 0 };
  const invoke = (method) => async (request) => {
    if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0 || accounting.calls >= limits.maxCalls ||
        accounting.reservedOutputTokens + request.maxOutputTokens > limits.maxOutputTokens) throw new Error('arm_budget_exhausted');
    accounting.calls++;
    accounting.reservedOutputTokens += request.maxOutputTokens;
    const result = await client[method](request);
    if (!result.usage) accounting.unknownUsageCalls++;
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens']) if (Number.isSafeInteger(result.usage?.[field])) accounting[field] += result.usage[field];
    return result;
  };
  return { generate: invoke('generate'), judge: invoke('judge'), accounting, limits };
}

const CRITIC = `You are the development visual/usability critic, NOT the final benchmark judge. Evaluate only the task, supplied HTML and actual desktop/mobile screenshots. Do not invent interaction observations from static images. Return JSON:
{"dimensions":{"readability":0..5,"layout":0..5,"feedback":0..5,"accessibility":0..5},"issues":[{"id":"identifier","evidence":"specific visible or source fact","target":"element or rule","change":"targeted remedy"}]}.
Use integer dimension scores. Give no more than 6 actionable issues. Review clipped/overlapping content, readable typography, visible and usable controls, contrasting states, and consistent UI feedback. Do not invent mandatory features absent from the task. Do not use a benchmark checklist or overall leaderboard score. Empty issues is valid. This critic is a fallible development signal, not correctness proof.`;

export function parseDevelopmentCritic(text) {
  const record = parseObject(text);
  const dimensions = ['readability', 'layout', 'feedback', 'accessibility'];
  if (!record.dimensions || dimensions.some((name) => !Number.isInteger(record.dimensions[name]) || record.dimensions[name] < 0 || record.dimensions[name] > 5) ||
      !Array.isArray(record.issues) || record.issues.length > 6 || record.issues.some((issue) =>
        ['id', 'evidence', 'target', 'change'].some((name) => typeof issue[name] !== 'string' || !issue[name].trim() || issue[name].length > 2000))) throw new Error('invalid_development_critic');
  return { ...record, ok: true, score: dimensions.reduce((sum, name) => sum + record.dimensions[name], 0), scale: 'development-0-20' };
}

export async function critiqueArtifact({ task, artifact, client, directory, onProgress }) {
  const response = await requestOnce({ client, directory, method: 'judge', system: undefined,
    prompt: `${CRITIC}\n${JSON.stringify({ task: task.prompt, html: artifact.html, views: ['desktop: first three images', 'mobile: last three images'] })}`,
    images: artifact.criticImages, purpose: 'quality-development-critic', maxOutputTokens: 4000, onProgress });
  if (!response.ok) throw new Error('development_critic_failed');
  const critic = parseDevelopmentCritic(response.text);
  await writeFile(path.join(directory, 'critic.json'), `${JSON.stringify(critic, null, 2)}\n`, 'utf8');
  return critic;
}

export async function produceQualityArtifact({ task, prompt, client, directory, onProgress = () => {} }) {
  const response = await requestOnce({ client, directory: path.join(directory, 'generation'),
    system: 'Produce a complete executable self-contained offline HTML document with inline CSS and JavaScript. Return exactly one html code block. Use no external URLs or network resources.',
    prompt: prompt ?? task.prompt, purpose: 'quality-code-generation', maxOutputTokens: 20000, onProgress });
  if (!response.ok || !['stop', 'end-turn'].includes(response.finishReason)) throw new Error('incomplete_quality_generation');
  const extracted = extractLastHtmlOrSvg(response.text);
  if (extracted.type !== 'html') throw new Error('quality_html_missing');
  const html = extracted.content;
  onProgress('rendering desktop/mobile quality evidence');
  const desktop = await renderAndCapture({ html, outDir: path.join(directory, 'desktop'), index: 'desktop', count: 3, viewport: { width: 1280, height: 720 }, offline: true });
  const mobile = await renderAndCapture({ html, outDir: path.join(directory, 'mobile'), index: 'mobile', count: 3, viewport: { width: 390, height: 844 }, offline: true });
  if (![desktop, mobile].every((render) => render.observations.rendered && !render.observations.captureError && render.imageBuffers.length === 3)) throw new Error('quality_render_incomplete');
  return { html, answer: response.text, htmlHash: behaviorHash(html), render: desktop,
    criticImages: [...desktop.imageBuffers, ...mobile.imageBuffers], screenshotPaths: [...desktop.imagePaths, ...mobile.imagePaths] };
}

export async function runImprovementArm({ task, record, initial, client, formal, directory, onProgress = () => {},
  evaluate = evaluateQualityArtifact, critique = critiqueArtifact, produce = produceQualityArtifact }) {
  await mkdir(directory, { recursive: true });
  const assessment = await evaluate({ record, html: initial.html, client, formal, directory: path.join(directory, 'initial-evidence'), onProgress });
  const base = { mode: formal ? 'formal' : 'executable', modelHash: record.modelHash, initialHash: initial.htmlHash, assessment };
  let selectedArtifact = initial;
  let report;
  if (!assessment.complete) report = { ...base, status: 'blocked', decision: { selected: 'initial', reason: 'incomplete_initial_evidence' } };
  else {
    const initialCritic = await critique({ task, artifact: initial, client, directory: path.join(directory, 'initial-critic'), onProgress });
    const failures = assessment.contracts.flatMap((contract) => (contract.failures ?? []).map((failure) => ({ contract: contract.id, ...failure })));
    if (!failures.length && !initialCritic.issues.length) report = { ...base, status: 'unchanged', initialCritic,
      decision: { selected: 'initial', reason: 'no_actionable_development_findings' } };
    else {
      const prompt = [task.prompt, 'Correct these executed behavioral failures and evidenced development usability issues:',
        JSON.stringify({ failures, visualIssues: initialCritic.issues }, null, 2),
        'action_unavailable is measured browser evidence that a reviewed existing control is hidden or disabled at the tested viewport. Restore legitimate user access without removing the feature or bypassing prerequisites. It is not a TLC counterexample.',
        'Preserve all other behavior and design. Make targeted changes, not a redesign. Exploration limits are not product requirements.',
        'Return the complete corrected self-contained HTML. The final benchmark evaluator is not available.', initial.html].join('\n\n');
      const candidate = await produce({ task, prompt, client, directory: path.join(directory, 'candidate'), onProgress });
      const candidateEvidence = await evaluate({ record, html: candidate.html, client, formal, directory: path.join(directory, 'candidate-evidence'), onProgress });
      const candidateCritic = candidateEvidence.complete ? await critique({ task, artifact: candidate, client,
        directory: path.join(directory, 'candidate-critic'), onProgress }) : null;
      const decision = selectQualityCandidate({ initial: assessment, candidate: candidateEvidence, initialCritic, candidateCritic });
      if (decision.selected === 'candidate') selectedArtifact = candidate;
      report = { ...base, status: candidateEvidence.complete ? 'complete' : 'blocked', candidateHash: candidate.htmlHash,
        candidateEvidence, initialCritic, candidateCritic, decision };
    }
  }
  report.selectedHash = selectedArtifact.htmlHash;
  await writeFile(path.join(directory, 'selection.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { report, selectedArtifact };
}