const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Renders the deliberately tiny inline-markup subset allowed in resume.yaml:
 *
 *   `code`   [text](https://url)   **strong**   *emphasis*
 *
 * Input is HTML-escaped first, so YAML content can never inject markup — the
 * only tags in the output are the ones produced here. This is not a Markdown
 * parser and is not trying to be one; anything more structural belongs in a
 * component, not in the data file.
 */
export function inlineMarkup(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\(((?:https?:|mailto:)[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Plain-text version, for <meta> tags where markup would leak through. */
export function stripMarkup(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * "2022-05" -> "May 2022", "2020" -> "2020".
 *
 * Deliberately string-sliced rather than routed through `new Date()`: parsing
 * "2022-05" yields UTC midnight, which reads back as April in any negative-UTC
 * timezone — including the one this site's author builds in.
 */
export function formatMonth(value: string): string {
  const [year, month] = value.split('-');
  if (!month) return year;
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** "May 2022 to Present" / "Jul 2020 to May 2022" */
export function formatRange(start: string, end: string | null): string {
  return `${formatMonth(start)} to ${end ? formatMonth(end) : 'Present'}`;
}

/** ISO 8601 value for <time datetime> and JSON-LD. */
export function isoDate(value: string): string {
  return value;
}
