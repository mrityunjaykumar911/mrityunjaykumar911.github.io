/** Prefix a root-relative URL with Astro's configured deployment base. */
export function withBase(href: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (!base || href === base || href.startsWith(`${base}/`)) return href;
  return `${base}${href}`;
}