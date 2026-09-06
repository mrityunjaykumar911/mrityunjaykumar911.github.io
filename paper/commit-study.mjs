import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const start = process.env.START_COMMIT;
const end = process.env.END_COMMIT;
if (!start || !end) {
  throw new Error('Set START_COMMIT and END_COMMIT before running the commit study.');
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commits = git('rev-list', '--reverse', `${start}^..${end}`).split(/\r?\n/).filter(Boolean);
const outputDir = path.resolve('paper', 'figures');
await mkdir(outputDir, { recursive: true });

const classify = (file) => {
  if (/^(tests\/|scripts\/|playwright\.config|\.github\/workflows\/)/.test(file)) return 'evidence';
  if (/^src\/data\//.test(file)) return 'content';
  if (/^(src\/|public\/)/.test(file)) return 'product';
  return 'other';
};

const countDeclaredTests = (commit) => {
  let files = [];
  try {
    files = git('ls-tree', '-r', '--name-only', commit, 'tests/e2e')
      .split(/\r?\n/)
      .filter((file) => file.endsWith('.spec.ts'));
  } catch {
    return 0;
  }
  return files.reduce((total, file) => {
    const source = git('show', `${commit}:${file}`);
    return total + (source.match(/^\s*test\s*\(/gm)?.length ?? 0);
  }, 0);
};

const observations = commits.map((commit, index) => {
  const numstat = git('diff-tree', '--no-commit-id', '--numstat', '-r', commit)
    .split(/\r?\n/)
    .filter(Boolean);
  const changed = { product: 0, evidence: 0, content: 0, other: 0 };
  let filesChanged = 0;
  for (const line of numstat) {
    const [added, deleted, file] = line.split('\t');
    const churn = (Number(added) || 0) + (Number(deleted) || 0);
    changed[classify(file)] += churn;
    filesChanged += 1;
  }
  const snapshotCount = git('ls-tree', '-r', '--name-only', commit, 'tests/e2e')
    .split(/\r?\n/)
    .filter((file) => file.endsWith('.png')).length;
  return {
    commit: `C${index + 1}`,
    filesChanged,
    changedLines: changed,
    declaredTests: countDeclaredTests(commit),
    visualBaselines: snapshotCount,
  };
});

const study = {
  commitCount: observations.length,
  observations,
  totals: observations.reduce((totals, observation) => {
    totals.product += observation.changedLines.product;
    totals.evidence += observation.changedLines.evidence;
    totals.content += observation.changedLines.content;
    totals.other += observation.changedLines.other;
    return totals;
  }, { product: 0, evidence: 0, content: 0, other: 0 }),
};
await writeFile(path.join(outputDir, 'commit-metrics.json'), `${JSON.stringify(study, null, 2)}\n`);

const width = 1400;
const height = 520;
const margin = { top: 92, right: 90, bottom: 72, left: 82 };
const chartWidth = width - margin.left - margin.right;
const chartHeight = height - margin.top - margin.bottom;
const maximumLogChurn = Math.max(...observations.flatMap((item) => [
  Math.log10(item.changedLines.product + 1),
  Math.log10(item.changedLines.evidence + 1),
]));
const maximumTests = Math.max(...observations.map((item) => item.declaredTests), 1);
const x = (index) => margin.left + (index + 0.5) * chartWidth / observations.length;
const churnY = (value) => margin.top + chartHeight - Math.log10(value + 1) / maximumLogChurn * chartHeight;
const testY = (value) => margin.top + chartHeight - value / maximumTests * chartHeight;
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const barWidth = Math.max(8, chartWidth / observations.length * 0.22);
const bars = observations.map((item, index) => {
  const center = x(index);
  const productY = churnY(item.changedLines.product);
  const evidenceY = churnY(item.changedLines.evidence);
  return `
    <rect x="${center - barWidth - 2}" y="${productY}" width="${barWidth}" height="${margin.top + chartHeight - productY}" fill="#111827" rx="2" />
    <rect x="${center + 2}" y="${evidenceY}" width="${barWidth}" height="${margin.top + chartHeight - evidenceY}" fill="#087a55" rx="2" />
    <text x="${center}" y="${height - 42}" text-anchor="middle">${escape(item.commit)}</text>`;
}).join('');
const testPoints = observations.map((item, index) => `${x(index)},${testY(item.declaredTests)}`).join(' ');
const testDots = observations.map((item, index) => (
  `<circle cx="${x(index)}" cy="${testY(item.declaredTests)}" r="5" fill="#7c3aed" />`
)).join('');
const phases = [
  { from: 0, to: 0, label: 'migration' },
  { from: 1, to: 6, label: 'behavior' },
  { from: 7, to: 12, label: 'content + privacy' },
  { from: 13, to: 17, label: 'visual TDD' },
];
const phaseMarkup = phases.map((phase, index) => {
  const phaseLeft = margin.left + phase.from * chartWidth / observations.length;
  const phaseWidth = (phase.to - phase.from + 1) * chartWidth / observations.length;
  return `<rect x="${phaseLeft}" y="${margin.top}" width="${phaseWidth}" height="${chartHeight}" fill="${index % 2 ? '#f7f8fa' : '#eef5f1'}" />
    <text x="${phaseLeft + phaseWidth / 2}" y="${margin.top - 18}" text-anchor="middle" class="phase">${escape(phase.label)}</text>`;
}).join('');

const html = `<!doctype html><html><head><style>
  html,body{margin:0;background:#fff;font-family:Arial,sans-serif;color:#111827}
  svg{display:block} text{font-size:15px;fill:#4b5563}.title{font-size:24px;font-weight:700;fill:#111827}.phase{font-size:14px;font-weight:700;fill:#087a55}.axis{stroke:#9ca3af;stroke-width:1}.legend{font-size:14px}
</style></head><body><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <text x="${margin.left}" y="34" class="title">Commit-level evolution of executable evidence</text>
  ${phaseMarkup}
  <line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}" class="axis" />
  ${bars}
  <polyline points="${testPoints}" fill="none" stroke="#7c3aed" stroke-width="4" />${testDots}
  <rect x="${width - 650}" y="20" width="14" height="14" fill="#111827"/><text x="${width - 630}" y="32" class="legend">product change (log churn)</text>
  <rect x="${width - 425}" y="20" width="14" height="14" fill="#087a55"/><text x="${width - 405}" y="32" class="legend">test/audit change</text>
  <line x1="${width - 210}" y1="27" x2="${width - 196}" y2="27" stroke="#7c3aed" stroke-width="4"/><text x="${width - 190}" y="32" class="legend">test declarations</text>
  <text transform="translate(22 ${margin.top + chartHeight / 2}) rotate(-90)" text-anchor="middle">log10(changed lines + 1)</text>
</svg></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: path.join(outputDir, 'commit-trajectory.png') });
await browser.close();

console.log(JSON.stringify(study, null, 2));
