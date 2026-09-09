import { readFile } from 'node:fs/promises';
import type { APIRoute } from 'astro';

export const prerender = true;

const paperPath = new URL('../../../paper/verifiable-web-artifacts.pdf', import.meta.url);

export const GET: APIRoute = async () => {
  const paper = await readFile(paperPath);

  return new Response(paper, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="verifiable-web-artifacts.pdf"',
    },
  });
};