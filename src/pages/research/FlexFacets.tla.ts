import { readFile } from 'node:fs/promises';
import type { APIRoute } from 'astro';

export const prerender = true;

const specificationPath = new URL('../../../formal/research/sln/FlexFacets.tla', import.meta.url);

export const GET: APIRoute = async () => {
  const specification = await readFile(specificationPath);

  return new Response(specification, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};