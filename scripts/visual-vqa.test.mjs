import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deterministicVisualIssues, evaluateVisualVqa, parseVisualVqa, VISUAL_VQA_CRITERIA, VISUAL_VQA_PROTOCOL } from './visual-vqa.mjs';

function response(overrides = {}) {
  return JSON.stringify({ protocol: VISUAL_VQA_PROTOCOL, verdict: 'pass', summary: 'The hierarchy and composition are consistently legible.',
    reviewedViews: ['ultrawide', 'wide-short', 'desktop', 'mobile', 'studies'],
    criteria: Object.fromEntries(VISUAL_VQA_CRITERIA.map((name) => [name, { score: 4, evidence: `${name} is visibly coherent.` }])),
    issues: [], uncertainty: ['Static screenshots do not establish interaction quality.'], ...overrides });
}

test('visual VQA parser fails closed on malformed, incomplete, or inconsistent approval', () => {
  assert.equal(parseVisualVqa(response()).passed, true);
  assert.throws(() => parseVisualVqa('{}'), /invalid_visual_vqa_envelope/);
  assert.throws(() => parseVisualVqa(response({ reviewedViews: ['desktop'] })), /invalid_visual_vqa_views/);
  const record = JSON.parse(response());
  record.criteria.readability.score = 3;
  const inconsistent = parseVisualVqa(JSON.stringify(record));
  assert.equal(inconsistent.passed, false);
  assert.equal(inconsistent.verdictConsistent, false);
  record.verdict = 'fail';
  record.issues = [{ severity: 'major', view: 'wide-short', evidence: 'The system labels are too small.', recommendation: 'Increase label size and rebalance the panel.' }];
  assert.equal(parseVisualVqa(JSON.stringify(record)).passed, false);
});

test('fixture VQA client is invoked exactly once and raw output is never persisted', async (context) => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'visual-vqa-'));
  context.after(() => rm(outputDir, { recursive: true, force: true }));
  let calls = 0;
  const client = { judge: async ({ images }) => { calls++; assert.equal(images.length, 5);
    return { ok: true, text: response(), modelId: 'fixture-vqa', usage: { totalTokens: 10 }, attempts: 1 }; } };
  const images = ['ultrawide', 'wide-short', 'desktop', 'mobile', 'studies'].map((id) => ({ id, buffer: Buffer.from(id) }));
  const report = await evaluateVisualVqa({ images, measurements: { fixture: true }, outputDir, client });
  assert.equal(calls, 1);
  assert.equal(report.passed, true);
  assert.equal(report.rawResponsePersisted, false);
  const persisted = JSON.parse(await readFile(path.join(outputDir, 'report.json'), 'utf8'));
  assert.equal(Object.hasOwn(persisted, 'text'), false);
  await assert.rejects(evaluateVisualVqa({ images, measurements: {}, outputDir, client }), /EEXIST/);
});

test('deterministic preflight blocks tiny substantive text, overflow, and an overlong mobile hero', () => {
  assert.deepEqual(deterministicVisualIssues({ ultrawide: { horizontalOverflow: 0, substantiveTextBelow14Px: 0,
    headerBorderBottomPx: 0, hero: { viewportShare: 0.8, contentShare: 0.75, columnGapShare: 0.12,
      titlePx: 88, ledePx: 21, systemCopyPx: 17 } } }), []);
  assert.deepEqual(deterministicVisualIssues({ ultrawide: { horizontalOverflow: 0, substantiveTextBelow14Px: 0,
    headerBorderBottomPx: 1, hero: { viewportShare: 0.8, contentShare: 0.6, columnGapShare: 0.2,
      titlePx: 108, ledePx: 17, systemCopyPx: 13 } } }), [
    { severity: 'major', view: 'ultrawide', evidence: 'hero content uses only 0.6 of the viewport width' },
    { severity: 'major', view: 'ultrawide', evidence: 'empty space between hero columns consumes 0.2 of the viewport width' },
    { severity: 'major', view: 'ultrawide', evidence: '108px hero title overwhelms the supporting hierarchy' },
    { severity: 'major', view: 'ultrawide', evidence: '17px hero lede is undersized for the canvas' },
    { severity: 'major', view: 'ultrawide', evidence: '13px technical descriptions are undersized for the canvas' },
    { severity: 'minor', view: 'ultrawide', evidence: '1px decorative rule spans the top header' },
  ]);
  assert.deepEqual(deterministicVisualIssues({ mobile: { horizontalOverflow: 3, substantiveTextBelow14Px: 2, hero: { viewportShare: 1.4 } } }), [
    { severity: 'critical', view: 'mobile', evidence: '3px horizontal overflow' },
    { severity: 'major', view: 'mobile', evidence: '2 substantive text elements render below 14px' },
    { severity: 'major', view: 'mobile', evidence: 'hero occupies 1.4 mobile viewports before the next section' },
  ]);
});