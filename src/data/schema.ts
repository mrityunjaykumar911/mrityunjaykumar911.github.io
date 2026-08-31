import { z } from 'zod';

/**
 * Shape of src/data/resume.yaml.
 *
 * Parsed at build time, so a renamed key, a missing required field or a
 * malformed URL fails `astro build` instead of shipping a broken page.
 * `.strict()` on the top level means a typo'd section name is an error too.
 */

/** Year-month ("2022-05") or bare year ("2020"). */
const yearMonth = z
  .string()
  .regex(/^\d{4}(-\d{2})?$/, 'expected "YYYY" or "YYYY-MM"');

/** Site-relative ("/cv/x.pdf"), absolute, or mailto. */
const href = z
  .string()
  .refine(
    (v) => v.startsWith('/') || /^(https?:|mailto:)/.test(v),
    'expected an absolute URL, a mailto: link, or a root-relative path'
  );

/** A flag name used to select optional résumé content. */
const flag = z.string().min(1).optional();

const profile = z.object({
  name: z.string(),
  pronunciation: z.string().optional(),
  /** Current job title — drives the hero eyebrow and the <title>. */
  role: z.string(),
  focus: z.string(),
  company: z.string(),
  location: z.string(),
  email: z.string().email(),
  avatar: z.string(),
  resumePdf: z.string(),
  /** Big serif hero line. One word may be wrapped in *asterisks* to highlight it. */
  headline: z.string(),
  /** Paragraph under the hero headline. */
  intro: z.string(),
  /** Exactly three short facts for the acid signal strip. */
  signals: z.array(z.string()).length(3),
  /** Paragraphs for the About section. */
  about: z.array(z.string()).min(1),
  /** Heading for the closing contact section. */
  contactHeading: z.string(),
  /** Three proof points supporting the closing elevator pitch. */
  contactAreas: z.array(z.string()).length(3),
  /** <meta description> / OpenGraph / JSON-LD. Plain text. */
  tagline: z.string(),
  summary: z.string(),
});

const link = z.object({
  label: z.string(),
  handle: z.string(),
  href,
  icon: z.enum(['github', 'linkedin', 'mail', 'file', 'link']),
});

/** One cell of the About capability grid. */
const capability = z.object({
  label: z.string(),
  value: z.string(),
});

const skillGroup = z.object({
  group: z.string(),
  items: z.array(z.string()).min(1),
});

const bulletGroup = z.object({
  title: z.string().nullable().default(null),
  bullets: z.array(z.string()).min(1),
  flag,
});

const role = z.object({
  company: z.string(),
  role: z.string(),
  location: z.string(),
  start: yearMonth,
  /** null means the role is current. */
  end: yearMonth.nullable().default(null),
  /** The one-paragraph description shown in the Work list. */
  summary: z.string(),
  /** Short area labels rendered as mono tags. */
  tags: z.array(z.string()).default([]),
  /** Optional bullets under the paragraph (mostly used by the preview overlay). */
  lead: z.array(z.string()).default([]),
  /** Optional deeper breakdown behind a "Full detail" toggle. */
  detail: z.array(bulletGroup).default([]),
  /** Hide the whole role unless the flag is active. */
  flag,
});

const school = z.object({
  school: z.string(),
  degree: z.string(),
  location: z.string(),
  start: z.coerce.string(),
  end: z.coerce.string(),
});

/** One entry in the Research & Systems section. */
const researchNote = z.object({
  type: z.string(),
  title: z.string(),
  meta: z.string(),
  href: href.nullable().default(null),
  flag,
});

const research = z.object({
  feature: z.object({
    label: z.string(),
    title: z.string(),
    body: z.string(),
    link: z
      .object({ href, text: z.string() })
      .nullable()
      .default(null),
  }),
  notes: z.array(researchNote).min(1),
});

export const resumeSchema = z
  .object({
    profile,
    links: z.array(link).min(1),
    capabilities: z.array(capability).min(1),
    /** Not rendered directly — feeds JSON-LD `knowsAbout`. */
    skills: z.array(skillGroup),
    experience: z.array(role).min(1),
    research,
    education: z.array(school),
  })
  .strict();

/**
 * Shape of the optional, git-ignored `src/data/resume.local.yaml`.
 *
 * Every key is optional. `profile` is shallow-merged over the public profile;
 * `experienceOverrides` is keyed by `company` and merged over that role.
 * Typically the whole overlay carries a single `flag`.
 */
export const localOverlaySchema = z
  .object({
    flag,
    profile: profile.partial().optional(),
    experienceOverrides: z
      .record(
        z.string(),
        z
          .object({
            role: z.string(),
            summary: z.string(),
            tags: z.array(z.string()),
            lead: z.array(z.string()),
            detail: z.array(bulletGroup),
            flag,
          })
          .partial()
      )
      .optional(),
  })
  .strict();

export type LocalOverlay = z.infer<typeof localOverlaySchema>;
export type Resume = z.infer<typeof resumeSchema>;
export type Role = z.infer<typeof role>;
export type BulletGroup = z.infer<typeof bulletGroup>;
export type ResearchNote = z.infer<typeof researchNote>;
export type Research = z.infer<typeof research>;
export type Link = z.infer<typeof link>;
export type Capability = z.infer<typeof capability>;
export type SkillGroup = z.infer<typeof skillGroup>;
export type School = z.infer<typeof school>;
