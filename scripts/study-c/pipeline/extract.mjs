// Pure extraction helpers ported faithfully from the pinned ArtifactsBench
// src/extract_ans.py. No model calls, no I/O; unit-testable in isolation.

// Port of extract_last_html_or_svg_block: last <html>..</html> (DOTALL), else
// last <svg>..</svg>. Returns { type: 'html'|'svg'|'none', content }.
export function extractLastHtmlOrSvg(text) {
  const str = typeof text === 'string' ? text : '';
  const html = [...str.matchAll(/<html[^>]*>[\s\S]*?<\/html>/gi)];
  if (html.length) return { type: 'html', content: html[html.length - 1][0] };
  const svg = [...str.matchAll(/<svg[^>]*>[\s\S]*?<\/svg>/gi)];
  if (svg.length) return { type: 'svg', content: svg[svg.length - 1][0] };
  return { type: 'none', content: null };
}

// Port of extract_mllm_overall: last "Overall Score": <number|range>. Returns
// the numeric string exactly as matched, or null. English and Chinese keys.
export function extractOverallScore(text) {
  const str = typeof text === 'string' ? text : '';
  const patterns = [
    /"Overall Score":\s*"?(\d+(?:\.\d+)?|\d+-\d+)"?/g,
    /"总体打分":\s*"?(\d+(?:\.\d+)?|\d+-\d+)"?/g,
  ];
  for (const pattern of patterns) {
    const matches = [...str.matchAll(pattern)];
    if (matches.length) return matches[matches.length - 1][1];
  }
  return null;
}

// Normalize a matched score string to a number in [0,100]; ranges collapse to
// their midpoint (mirrors how a range would be read on the 0-100 scale).
export function scoreToNumber(raw) {
  if (typeof raw !== 'string') return null;
  if (/^\d+-\d+$/.test(raw)) {
    const [lo, hi] = raw.split('-').map(Number);
    const mid = (lo + hi) / 2;
    return mid >= 0 && mid <= 100 ? mid : null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
