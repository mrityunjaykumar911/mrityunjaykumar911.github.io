import type { APIRoute } from 'astro';
import { resume } from '../data/resume';
import { renderResumeMarkdown } from '../lib/resume-markdown';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const markdown = renderResumeMarkdown(
    resume,
    site ?? new URL('https://mrityunjaykumar911.github.io')
  );

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};