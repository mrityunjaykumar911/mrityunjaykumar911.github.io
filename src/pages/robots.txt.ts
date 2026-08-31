import type { APIRoute } from 'astro';
import { withBase } from '../lib/url';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site ?? new URL('https://mrityunjaykumar911.github.io');
  const allowedPath = withBase('/');
  const sitemapUrl = new URL(withBase('/sitemap-index.xml'), siteUrl).href;

  return new Response(
    [
      `User-agent: *`,
      `Allow: ${allowedPath}`,
      `Disallow: ${withBase('/latest.html')}`,
      ``,
      `Sitemap: ${sitemapUrl}`,
      ``,
    ].join('\n'),
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
};