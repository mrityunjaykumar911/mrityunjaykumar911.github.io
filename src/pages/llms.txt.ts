import type { APIRoute } from 'astro';
import { resume } from '../data/resume';
import { stripMarkup } from '../lib/text';
import { withBase } from '../lib/url';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site ?? new URL('https://mrityunjaykumar911.github.io');
  const canonicalUrl = new URL(withBase('/'), siteUrl).href;
  const currentRole = resume.experience.find((role) => role.company === 'Microsoft');
  const expertise = resume.skills.flatMap((group) => group.items);
  const citedResearch = resume.research.notes.filter((note) => note.href).slice(0, 3);

  const lines = [
    `# ${resume.profile.name}`,
    ``,
    `> ${stripMarkup(resume.profile.tagline)}`,
    ``,
    `## Professional profile`,
    ``,
    `- Role: ${resume.profile.role} at ${resume.profile.company}`,
    `- Focus: ${resume.profile.focus}`,
    `- Experience: 12+ years across ML systems, distributed services, storage, and data infrastructure`,
    ``,
    `## Engineering focus`,
    ``,
    `- Distributed infrastructure for reliable LLM agents`,
    `- Inference engines, rigorous model evaluation, and RL systems at scale`,
    `- Zero-to-one architecture, implementation, observability, and production delivery`,
    ``,
    `## Current engineering work`,
    ``,
    ...(currentRole?.lead.map((bullet) => `- ${stripMarkup(bullet)}`) ?? []),
    ``,
    `## Core expertise`,
    ``,
    ...expertise.map((item) => `- ${item}`),
    ``,
    `## Research and intellectual property`,
    ``,
    ...citedResearch.map(
      (note) => `- [${note.title}](${note.href}): ${stripMarkup(note.meta)}`
    ),
    ``,
    `## Canonical sources`,
    ``,
    `- [Professional profile](${canonicalUrl})`,
    `- [Source repository](https://github.com/mrityunjaykumar911/mrityunjaykumar911.github.io)`,
    ``,
    `## Privacy`,
    ``,
    `This context intentionally excludes personal contact details and private employment records.`,
    ``,
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};