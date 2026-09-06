# Publication Safety Model

`ResumePublication.tla` specifies the correctness-sensitive state of the public resume site. It deliberately excludes typography and layout optimization, which remain in Astro/CSS and are checked by Playwright.

## Safety invariants

- Production never renders the git-ignored local overlay.
- Canonical root and detailed routes remain indexable.
- Query-driven preview content remains `noindex`.
- A static build requires passing validation.
- Deployment requires both passing validation and a ready build.

## Refinement map

| TLA+ state | Implementation boundary | Executable refinement check |
| --- | --- | --- |
| `mode`, `content` | `src/lib/preview.ts`, `src/data/resume.ts` | Public/private route tests |
| `request`, `robots` | `ResumePage.astro`, `Base.astro` | Canonical, robots, and sitemap tests |
| `tests`, `build`, `deployment` | `.github/workflows/deploy.yml` | CI job dependencies |
| Rendered geometry | Astro components and CSS | Playwright geometry and screenshot tests |

The model proves properties of this abstract publication state machine. It does not prove that the Astro implementation refines the model automatically; Playwright and workflow checks are the executable refinement boundary.

## Run

```powershell
npm run test:tla
```

The runner uses Java from `JAVA_HOME`, `PATH`, or the git-ignored `.tools/java` directory. It downloads pinned TLA+ tools release `v1.7.4` into `.tools` when needed.

The command checks the safe model and then verifies three deliberate mutants. Each mutant must produce the expected counterexample, demonstrating that the safety invariants are not vacuous.
