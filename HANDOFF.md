# Handoff — site rebuilt as Astro

Everything below is yours to run. Nothing has been pushed. Git is untouched
(still just the pre-existing `D create_backup99.sh`). No GitHub Actions exist
yet. The old site is still live and still in git history.

---

## 1. What changed and why

The repo used to contain **only Hugo build output** — no `config.toml`, no
`content/`, empty `.gitmodules`. Every edit meant hand-editing 44 KB of
generated HTML. Also broken: analytics (GA4 id wired to the retired Universal
Analytics API — dead since July 2023), no OpenGraph/Twitter/JSON-LD, five
empty `<a href="">` project links, ~1 MB of FontAwesome JS from a dead CDN,
stale content (still said "May 2022–till" at Microsoft).

Now: an **Astro** project. Content lives in one file. A push triggers a
GitHub Actions build that deploys to Pages. No server code — Pages doesn't
run any, and a résumé site doesn't need it.

### New layout

| Path | What it is |
| --- | --- |
| `src/data/resume.yaml` | **The only file you normally edit.** All *published* content. |
| `src/data/resume.local.yaml` | **Git-ignored.** Current-employer detail, shown only in local preview (see §1a). |
| `src/data/resume.local.example.yaml` | Committed template for the above. |
| `src/data/schema.ts` | Zod schemas. A typo'd key or bad URL **fails the build** instead of shipping broken. |
| `src/data/resume.ts` | Loads + validates the YAML; `resolveResume(preview)` folds in the overlay. |
| `src/lib/text.ts` | Inline-markup renderer (`*em*`, `**strong**`, `` `code` ``, `[x](url)`), date formatting. |
| `src/lib/preview.ts` | Preview-flag parsing. Inert in any build; live only under `astro dev`. |
| `src/layouts/Base.astro` | `<head>`: SEO, OG/Twitter, JSON-LD `Person`, self-hosted font preloads. No external requests. |
| `src/components/*.astro` | SiteHeader, Hero, SignalStrip, Work, Research, About, Contact, SiteFooter, Icon (inline SVG), PreviewBanner. |
| `public/fonts/` | Manrope, Newsreader, DM Mono — self-hosted woff2 (latin subset). |
| `src/pages/index.astro` | The page. Assembles sections, JSON-LD, and the reveal / menu / scroll-spy script. |
| `src/pages/404.astro` | Styled 404 → `dist/404.html`. |
| `public/` | `favicon.ico`, `images/mrityunjay.jpg`, `cv/MrityunjayKumar-CV.pdf`. |
| `astro.config.mjs` | `site` = Pages URL, `output: 'static'`, sitemap, YAML plugin. |

### Look — editorial, adapted from the `mjay/gpt56sol-version` branch

Warm paper `#f4f1e8` / dark ink, faint 32 px engineering grid, three fonts
(**Newsreader** serif display, **Manrope** sans, **DM Mono** labels), three
committed accents — **teal / coral / acid lime**. Big serif hero with an acid
highlight-swipe on one word. Numbered sections 01–04, an acid signal strip,
an **inverted dark Research section**, a full-bleed **coral contact section**,
scroll-reveal. Single committed light theme — **no dark mode** (it would
fight the palette). Fonts self-hosted, icons inlined → **zero external
requests**. Prints to a clean ink-on-white document.

### Content notes

- **Published** framing is conservative, matching the gpt56 branch:
  "Software Engineer" at Microsoft, "backend services for PowerPoint…
  dependable service engineering," Research split into its own section,
  "12+ years." The RL / "Senior ML Engineer" identity is in
  `resume.local.yaml`, preview-only (§1a).
- `research:` block replaces the old Publications + Projects sections — one
  feature story (Rolis / Stony Brook) + a notes list (papers, patent, Raft,
  backup FS, music-rec).
- `skills:` in the YAML is **not rendered** — it only feeds JSON-LD
  `knowsAbout`. The visible skills live in `capabilities:`.
- LinkedIn: `linkedin.com/in/mrkumar20` (you corrected this).
- Email on the site: `mjay.cse@gmail.com`. The old site's blog / Quora /
  Twitter links are dropped — add them back under `links:` if you want them.
- The stat strip and the big serif hero name from the first draft are gone.

---

## 1a. Preview flags — hiding current-employer work

**The problem:** this is a static site in a *public* repo. Anything in the
built HTML or in `resume.yaml` is world-readable (Google, `view-source`,
GitHub). CSS/JS "hiding" hides nothing.

**The design:**

| | Published site | You, locally |
| --- | --- | --- |
| `resume.yaml` | generic Microsoft entry | same |
| `resume.local.yaml` (git-ignored) | **not in the repo, not in CI** | the real RL detail |
| `astro dev` + `?flags=latest` | — | folds the overlay in |
| `astro build` / CI | preview params inert at build → generic only | — |

Two independent guards: the overlay file never leaves your machine, **and**
preview flags are ignored outside `astro dev`. The published site physically
cannot contain the hidden content.

**Using it:**

```
npm run dev
http://localhost:4321/                 the published view (what peers see)
http://localhost:4321/?flags=latest    + the resume.local.yaml overlay
http://localhost:4321/?preview         + everything flagged, any name
```

A dark red **Preview** banner shows whenever an overlay is active, so you
always know which view you are looking at.

**To move something from hidden → public later:** cut it from
`resume.local.yaml`, paste it into `resume.yaml`, commit.

**Granular flags:** tag any role / detail-group / research-note in either
file with `flag: somename`; it then needs `?flags=somename`. The
`resume.local.yaml` overlay as a whole is gated on `flag: latest`.

---

## 2. Verify locally  (Node 22 — you have v22.23.2)

```powershell
npm install        # already done once; safe to re-run
npm run build      # astro check (types + schema) then astro build -> dist/
```

Green build =
```
0 errors  (from astro check)
[build] Complete!   with dist/index.html, dist/404.html, dist/sitemap-index.xml
```

Build fails? Most likely `astro check` caught something in a `.yaml` file —
the message names the field. Fix it, re-run. Send me the output if it's not
obvious.

Then preview:

```powershell
npm run dev        # http://localhost:4321 — hot reload; use this
# npm run preview  # serves the last build only (no ?flags support)
```

Eyeball at `http://localhost:4321/` (published view):
- [ ] Hero — serif headline with acid-lime swipe on "reliable", "Software
      Engineer at Microsoft" eyebrow, portrait in a teal frame, "01 / 04"
- [ ] Acid signal strip band; fonts look right (serif headings, mono labels)
- [ ] Work (02) — 4 roles; Microsoft reads generic, no "Full detail" toggle
- [ ] Research (03) — dark section, teal feature card, notes list with arrows
- [ ] About (04) — big serif copy + 2×2 capability grid
- [ ] Contact — coral section with the giant "@" watermark
- [ ] Scroll — sections fade/rise in once; nav underline tracks position
- [ ] DevTools ~375 px — hamburger menu works, **no sideways scroll**
- [ ] `Ctrl+U` — `og:title`, `application/ld+json` present; **search source for
      "7,000" or "LLM-as-judge" → must NOT appear**
- [ ] Network tab — no requests to fonts.googleapis.com / unpkg / any 3rd party
- [ ] `http://localhost:4321/whatever` → styled 404
- [ ] `Ctrl+P` → clean ink-on-white document

Then the preview overlay at `http://localhost:4321/?flags=latest`:
- [ ] Dark-red **Preview** banner at the top
- [ ] Hero headline + eyebrow switch to the RL framing
- [ ] Microsoft role becomes "Senior ML Engineer — RL Reward & Evaluation…"
      with RL tags, 3 lead bullets, and a "Full detail" toggle (4 groups)
- [ ] Stop the server, `npm run build`, then search `dist/` for "7,000" →
      **must NOT appear** (proves the build ignores the overlay)

---

## 3. Finish the migration  (only after the preview looks right)

### 3a. Remove the old Hugo output

```powershell
git rm -r --quiet index.html index.xml sitemap.xml categories tags assets cv
git rm --quiet --ignore-unmatch create_backup99.sh .gitmodules
```
(`favicon.ico` and the avatar are now in `public/`. `.gitmodules` is empty.)

### 3b. `.gitignore` — already done

Now covers `dist/`, `.astro/`, `node_modules/`, and
`src/data/resume.local.yaml`. Confirm the overlay is ignored:

```powershell
git check-ignore src/data/resume.local.yaml   # should echo the path
git status --porcelain src/data/resume.local.yaml   # should print nothing
```

### 3c. Add the deploy workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Let a run finish; don't cancel an in-progress deploy.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 3d. Commit + push

```powershell
git add -A
git status          # sanity-check what's staged
git commit -m "Rebuild site as Astro; deploy via GitHub Actions"
git push origin master
```

### 3e. One-time GitHub setting

Repo → **Settings → Pages → Build and deployment → Source** →
change from "Deploy from a branch" to **GitHub Actions**.

(Until you flip this, the Action builds but Pages keeps serving the old
branch files.)

---

## 4. Verify live

- **Actions** tab — `Deploy to GitHub Pages` run is green (~1–2 min)
- https://mrityunjaykumar911.github.io/ — new site
- https://mrityunjaykumar911.github.io/cv/MrityunjayKumar-CV.pdf — resolves
- https://mrityunjaykumar911.github.io/tags/ (an old path) — new 404 page
- Paste the URL into a Slack/Discord message — link preview now unfurls with
  title + description + photo

---

## 5. Day-to-day after this

Edit `src/data/resume.yaml` → `git commit` → `git push`. The Action rebuilds
and redeploys in ~2 min. Run `npm run build` locally first if you want to be
sure it passes.

New résumé PDF: drop it at `public/cv/MrityunjayKumar-CV.pdf` (same name),
commit, push.

---

## 6. Rollback

The old site is intact in git history.

```powershell
git revert <this-commit-sha>
git push
```
Then switch **Settings → Pages → Source** back to
"Deploy from a branch → master".

---

## Analytics (deliberately left out)

The old GA snippet was broken and is not carried over. If you want analytics,
tell me which (GA4 with a real `gtag.js` tag, or a lighter privacy-friendly
option like Plausible/Umami) and I'll wire it into `Base.astro` behind a
single config flag. Right now the site ships with **zero third-party
scripts and zero cookies**.
