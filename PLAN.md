# Site upgrade — migration plan

Rebuild `mrityunjaykumar911.github.io` from committed-Hugo-output to a
source-controlled **Astro** site, deployed by **GitHub Actions** to GitHub
Pages. Content comes from the July 2026 résumé (`src/data/resume.yaml`).

Nothing is pushed and no GitHub Actions run until the local build is green
and the local preview has been eyeballed.

---

## Status

| Phase | State |
| --- | --- |
| 1. Scaffold Astro project + data model | ✅ done |
| 2. Build components + pages | ✅ done |
| 3. Assets into `public/` | ✅ done |
| 4. **Local build passes** | ⏳ in progress |
| 5. **Local preview looks right** | ☐ |
| 6. Remove stale Hugo output | ☐ |
| 7. `.gitignore` + GH Actions workflow | ☐ |
| 8. Commit + push + enable Pages "GitHub Actions" source | ☐ |
| 9. Verify live site | ☐ |

---

## Phase 4 — local build (run these)

```powershell
# 1. reinstall deps under Node 22 (they were first installed under Node 18)
npm install

# 2. type-check + production build; writes ./dist
npm run build
```

Expected: `astro check` reports `0 errors`, then
`[build] Complete!` with `dist/index.html`, `dist/404.html`,
`dist/sitemap-index.xml` listed.

If `astro check` fails on `src/data/resume.yaml` — that is the schema doing
its job. The error names the bad field.

## Phase 5 — local preview

```powershell
npm run preview        # serves ./dist at http://localhost:4321
#   — or, for hot reload while tweaking —
npm run dev            # http://localhost:4321
```

Eyeball checklist:
- [ ] Hero: name, role, summary, contact pills, avatar
- [ ] Dark/light toggle works, no white flash on reload in dark
- [ ] Experience timeline renders; Microsoft marked "Present"
- [ ] Publications + patent links open
- [ ] Projects grid (delete `projects:` block in yaml to hide)
- [ ] Mobile width (DevTools ~375px): nav collapses, no horizontal scroll
- [ ] `view-source`: `<meta property="og:*">`, `<script type="application/ld+json">`
- [ ] `/nonsense-url` → styled 404

## Phase 6 — remove stale Hugo output

These are the old generated site; the Astro build replaces all of them:

```powershell
git rm -r --quiet index.html index.xml sitemap.xml categories tags assets cv
git rm --quiet --ignore-unmatch create_backup99.sh
```

`favicon.ico` + the avatar now live in `public/`. Keep `.gitmodules`? It is
empty — remove it too:

```powershell
git rm --quiet .gitmodules
```

## Phase 7 — .gitignore + workflow

`.gitignore` gains `node_modules/`, `dist/`, `.astro/`.
`.github/workflows/deploy.yml` — official Astro + Pages action, builds on
push to `master`, deploys the artifact.

## Phase 8 — ship

```powershell
git add -A
git commit -m "Rebuild site as Astro; deploy via GitHub Actions"
git push origin master
```

Then on GitHub: **Settings → Pages → Build and deployment → Source =
GitHub Actions** (one-time switch away from "Deploy from a branch").

## Phase 9 — verify live

- Actions tab: `deploy` workflow green
- https://mrityunjaykumar911.github.io/ serves the new site
- https://mrityunjaykumar911.github.io/cv/MrityunjayKumar-CV.pdf resolves
- Old deep links (e.g. `/tags/`) → the new 404

---

## Rollback

The old site is plain files in git history. `git revert <sha>` +
switch Pages source back to "Deploy from a branch: master" restores it.
