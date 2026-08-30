/**
 * Preview flags used for per-request rendering under `astro dev`.
 *
 * Production is static, so its root page routes matching query parameters to
 * the prebuilt `latest.html` page instead. Content in `resume.latest.yaml` is
 * public and discoverable. The optional `resume.local.yaml` remains ignored
 * and is used only as a development override.
 */

export interface PreviewState {
  /** true when at least one flag is active. */
  active: boolean;
  /** Active flag names. Contains '*' when `?preview` was used (matches all). */
  flags: Set<string>;
}

const INERT: PreviewState = { active: false, flags: new Set() };

/**
 * Parse preview flags from a request URL.
 *
 *   ?preview                  → reveal everything hidden
 *   ?flags=latest             → reveal content tagged `flag: latest`
 *   ?flags=latest,newthing    → several at once
 *
 * Returns the inert state in any non-dev context.
 */
export function readPreview(url: URL): PreviewState {
  // Dev only. `astro build` / `astro preview` / CI → import.meta.env.DEV false.
  if (!import.meta.env.DEV) {
    return INERT;
  }

  const flags = new Set<string>();

  // From the URL (works because `astro dev` renders every request live).
  if (url.searchParams.has('preview')) flags.add('*');
  const raw = url.searchParams.get('flags');
  if (raw) for (const n of raw.split(/[\s,]+/)) if (n) flags.add(n);

  // Fallback: `PREVIEW_FLAGS=latest npm run dev` (or `PREVIEW_FLAGS='*'`).
  const env =
    typeof process !== 'undefined' ? process.env?.PREVIEW_FLAGS : undefined;
  if (env) for (const n of env.split(/[\s,]+/)) if (n) flags.add(n);

  const state = { active: flags.size > 0, flags };

  // eslint-disable-next-line no-console
  console.log(
    `[preview] url="${url.pathname}${url.search}" → active=${state.active} flags=[${[
      ...flags,
    ].join(',')}]`
  );

  return state;
}

/**
 * Should content carrying `flag` be shown?
 *
 *   - undefined / '' flag  → always shown (normal content)
 *   - a named flag         → shown only when that flag (or '*') is active
 */
export function flagActive(state: PreviewState, flag?: string | null): boolean {
  if (!flag) return true;
  if (!state.active) return false;
  return state.flags.has('*') || state.flags.has(flag);
}
