import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadKey, makeClient, MODEL } from './study-c/pipeline/client.mjs';

export const VISUAL_VQA_PROTOCOL = 'generative-visual-quality-v1';
export const VISUAL_VQA_CRITERIA = Object.freeze([
  'hierarchy', 'readability', 'composition', 'responsiveAdaptation', 'credibility',
]);
const VIEWS = Object.freeze(['ultrawide', 'wide-short', 'desktop', 'mobile', 'studies']);

const SYSTEM = `You are a strict visual-quality reviewer for a senior ML engineer's public method page.
Inspect only the supplied screenshots and deterministic measurements. Do not infer hidden interactions or source code. The page should let readers infer engineering maturity from decisions, systems thinking, production discipline, and bounded evidence; do not reward self-declared seniority.

Review all five labeled views: ultrawide first viewport, wide-short first viewport, desktop first viewport, mobile first viewport, and desktop studies section. Identify concrete visible evidence. Pay particular attention to weak hierarchy, tiny text, excessive empty space, poor density, unbalanced columns, generic dashboard styling, clipping, overlap, awkward wrapping, and whether the three studies are distinguishable and credible.

Return JSON only:
{"protocol":"generative-visual-quality-v1","verdict":"pass|fail","summary":"concise finding","reviewedViews":["ultrawide","wide-short","desktop","mobile","studies"],"criteria":{"hierarchy":{"score":1,"evidence":"visible fact"},"readability":{"score":1,"evidence":"visible fact"},"composition":{"score":1,"evidence":"visible fact"},"responsiveAdaptation":{"score":1,"evidence":"visible fact"},"credibility":{"score":1,"evidence":"visible fact"}},"issues":[{"severity":"critical|major|minor","view":"ultrawide|wide-short|desktop|mobile|studies","evidence":"specific visible problem","recommendation":"targeted correction"}],"uncertainty":["anything the screenshots cannot establish"]}.

Use integer scores from 1 (unacceptable) to 5 (excellent). Pass only when every criterion is at least 4 and there are no critical or major issues. Do not soften a verdict because the content is technically correct. Maximum 8 issues and 5 uncertainty statements.`;

function text(value, name, maximum = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`invalid_visual_vqa_${name}`);
  return value.trim();
}

export function parseVisualVqa(textResponse) {
  const json = textResponse.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
  const value = JSON.parse(json);
  if (value?.protocol !== VISUAL_VQA_PROTOCOL || !['pass', 'fail'].includes(value.verdict)) throw new Error('invalid_visual_vqa_envelope');
  if (!Array.isArray(value.reviewedViews) || JSON.stringify(value.reviewedViews) !== JSON.stringify(VIEWS)) throw new Error('invalid_visual_vqa_views');
  if (!value.criteria || Object.keys(value.criteria).sort().join() !== [...VISUAL_VQA_CRITERIA].sort().join()) throw new Error('invalid_visual_vqa_criteria');
  const criteria = {};
  for (const name of VISUAL_VQA_CRITERIA) {
    const record = value.criteria[name];
    if (!Number.isInteger(record?.score) || record.score < 1 || record.score > 5) throw new Error('invalid_visual_vqa_score');
    criteria[name] = { score: record.score, evidence: text(record.evidence, 'evidence') };
  }
  if (!Array.isArray(value.issues) || value.issues.length > 8) throw new Error('invalid_visual_vqa_issues');
  const issues = value.issues.map((issue) => {
    if (!['critical', 'major', 'minor'].includes(issue?.severity) || !VIEWS.includes(issue?.view)) throw new Error('invalid_visual_vqa_issue');
    return { severity: issue.severity, view: issue.view, evidence: text(issue.evidence, 'issue_evidence'),
      recommendation: text(issue.recommendation, 'recommendation') };
  });
  if (!Array.isArray(value.uncertainty) || value.uncertainty.length > 5) throw new Error('invalid_visual_vqa_uncertainty');
  const uncertainty = value.uncertainty.map((item) => text(item, 'uncertainty', 1000));
  const computedPass = Object.values(criteria).every(({ score }) => score >= 4) &&
    issues.every(({ severity }) => severity === 'minor');
  return { protocol: VISUAL_VQA_PROTOCOL, verdict: value.verdict, summary: text(value.summary, 'summary'),
    reviewedViews: [...VIEWS], criteria, issues, uncertainty, passed: value.verdict === 'pass' && computedPass,
    verdictConsistent: (value.verdict === 'pass') === computedPass };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function deterministicVisualIssues(measurements) {
  const issues = [];
  for (const [view, record] of Object.entries(measurements ?? {})) {
    if (!record || typeof record !== 'object') throw new Error('invalid_visual_measurements');
    if (record.horizontalOverflow > 1) issues.push({ severity: 'critical', view, evidence: `${record.horizontalOverflow}px horizontal overflow` });
    if (record.substantiveTextBelow14Px > 0) issues.push({ severity: 'major', view,
      evidence: `${record.substantiveTextBelow14Px} substantive text elements render below 14px` });
    if (view === 'ultrawide' && record.hero?.contentShare < 0.7) issues.push({ severity: 'major', view,
      evidence: `hero content uses only ${record.hero.contentShare} of the viewport width` });
    if (view === 'ultrawide' && record.hero?.columnGapShare > 0.16) issues.push({ severity: 'major', view,
      evidence: `empty space between hero columns consumes ${record.hero.columnGapShare} of the viewport width` });
    if (view === 'ultrawide' && record.hero?.titlePx > 96) issues.push({ severity: 'major', view,
      evidence: `${record.hero.titlePx}px hero title overwhelms the supporting hierarchy` });
    if (view === 'ultrawide' && record.hero?.ledePx < 20) issues.push({ severity: 'major', view,
      evidence: `${record.hero.ledePx}px hero lede is undersized for the canvas` });
    if (view === 'ultrawide' && record.hero?.systemCopyPx < 16) issues.push({ severity: 'major', view,
      evidence: `${record.hero.systemCopyPx}px technical descriptions are undersized for the canvas` });
    if (view === 'ultrawide' && record.headerBorderBottomPx > 0) issues.push({ severity: 'minor', view,
      evidence: `${record.headerBorderBottomPx}px decorative rule spans the top header` });
    if (view === 'mobile' && record.hero?.viewportShare > 1.1) issues.push({ severity: 'major', view,
      evidence: `hero occupies ${record.hero.viewportShare} mobile viewports before the next section` });
  }
  return issues;
}

export async function evaluateVisualVqa({ images, measurements, outputDir, keyFile, client = null }) {
  if (!Array.isArray(images) || images.length !== VIEWS.length || images.some((image, index) => image.id !== VIEWS[index] || !Buffer.isBuffer(image.buffer))) {
    throw new Error('invalid_visual_vqa_images');
  }
  await mkdir(outputDir, { recursive: true });
  const imageHashes = images.map(({ id, buffer }) => ({ id, sha256: sha256(buffer) }));
  const prompt = `${SYSTEM}\n\nInput metadata:\n${JSON.stringify({ views: VIEWS, measurements })}`;
  const requestHash = sha256(JSON.stringify({ protocol: VISUAL_VQA_PROTOCOL, prompt, imageHashes }));
  await writeFile(path.join(outputDir, 'attempt.json'), `${JSON.stringify({ protocol: VISUAL_VQA_PROTOCOL,
    startedAt: new Date().toISOString(), requestHash, model: MODEL }, null, 2)}\n`, { flag: 'wx' });
  const activeClient = client ?? makeClient({ key: await loadKey(keyFile) });
  const response = await activeClient.judge({ prompt, images: images.map(({ buffer }) => buffer),
    maxOutputTokens: 3000, purpose: 'method-page-generative-vqa' });
  if (!response.ok) throw new Error(`visual_vqa_request_failed:${response.reason}`);
  const result = parseVisualVqa(response.text);
  const report = { ...result, model: response.modelId ?? MODEL, requestHash, imageHashes, measurements,
    usage: response.usage ?? null, attempts: response.attempts ?? 1, providerCalls: 1,
    rawResponsePersisted: false, finishedAt: new Date().toISOString() };
  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}