import { z } from 'zod';
import publicRaw from './resume.yaml';
import latestRaw from './resume.latest.yaml';
import {
  resumeSchema,
  localOverlaySchema,
  type Resume,
  type LocalOverlay,
} from './schema';
import { flagActive, type PreviewState } from '../lib/preview';

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

function validate(raw: unknown): Resume {
  const parsed = resumeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`résumé data failed validation:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** The default résumé shown when no public detail flag is selected. */
export const resume: Resume = validate(publicRaw);

function validateOverlay(raw: unknown, source: string): LocalOverlay {
  const parsed = localOverlaySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${source} failed validation:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** Public detail used by the flag-gated static page. */
const publicOverlay = validateOverlay(latestRaw, 'resume.latest.yaml');

/** Optional git-ignored development override. */
const localOverlayModules = import.meta.glob<{ default: unknown }>(
  ['./resume.local.yaml', './resume.local.yml'],
  { eager: true }
);
const localOverlayEntry = Object.entries(localOverlayModules).find(([k]) =>
  /resume\.local\.ya?ml$/.test(k)
);
const localOverlay = localOverlayEntry
  ? validateOverlay(localOverlayEntry[1].default, 'resume.local.yaml')
  : null;
const overlay = import.meta.env.DEV && localOverlay ? localOverlay : publicOverlay;

if (import.meta.env.DEV) {
  const keys = Object.keys(localOverlayModules);
  // eslint-disable-next-line no-console
  console.log(
    `[resume] local overlay ${localOverlay ? 'LOADED' : 'not found'}` +
      (keys.length ? ` (glob keys: ${keys.join(', ')})` : ' (glob matched nothing)')
  );
}

/** Drop flagged content the current preview state does not unlock. */
function stripFlags(input: Resume, preview: PreviewState): Resume {
  return {
    ...input,
    experience: input.experience
      .filter((r) => flagActive(preview, r.flag))
      .map((r) => ({
        ...r,
        detail: r.detail.filter((g) => flagActive(preview, g.flag)),
      })),
    research: {
      ...input.research,
      notes: input.research.notes.filter((n) => flagActive(preview, n.flag)),
    },
  };
}

/** Fold the selected public or local development overlay onto the résumé. */
function applyOverlay(base: Resume, ov: LocalOverlay, preview: PreviewState): Resume {
  if (!flagActive(preview, ov.flag)) return base;

  const merged: Resume = {
    ...base,
    profile: { ...base.profile, ...(ov.profile ?? {}) },
    experience: base.experience.map((role) => {
      const patch = ov.experienceOverrides?.[role.company];
      if (!patch || !flagActive(preview, patch.flag)) return role;
      return { ...role, ...patch };
    }),
  };

  // Re-validate so a malformed overlay fails loudly during dev or build.
  return validate(merged);
}

/** Resolve the résumé for a requested set of flags. */
export function resolveResume(preview: PreviewState): Resume {
  const stripped = stripFlags(resume, preview);
  if (!preview.active || !overlay) return stripped;
  return applyOverlay(stripped, overlay, preview);
}

export default resume;
