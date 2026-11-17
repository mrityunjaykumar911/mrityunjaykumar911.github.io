import katex from 'katex';

/**
 * Build-time math rendering. KaTeX turns TeX into HTML plus MathML at build
 * time, so pages ship no math JavaScript and make no third-party requests.
 * A TeX error fails the build instead of shipping broken math.
 */
export function tex(source: string, displayMode = false): string {
  return katex.renderToString(source, { displayMode, throwOnError: true, output: 'htmlAndMathml' });
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text with inline `$...$` math. Text outside the math is HTML-escaped. */
export function mathText(text: string): string {
  return text
    .split(/(\$[^$]+\$)/g)
    .map((part) => (part.startsWith('$') && part.endsWith('$') && part.length > 2 ? tex(part.slice(1, -1)) : escapeHtml(part)))
    .join('');
}
