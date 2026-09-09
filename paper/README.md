# Papers

This directory contains two anonymous studies: the five-page visual-TDD case study and the executable-contracts manuscript. The latter uses PLDI 2026's anonymous `acmsmall` review format; its supporting formal research and disclosure-policy artifacts live under [formal/](../formal/). The visual-analysis scripts and arXiv package belong to the visual-TDD study, not the executable-contracts manuscript.

## Study C: generated-artifact feasibility close-out

[Study C1 experiment design](study-c-experiment.md) specifies an ArtifactsBench-derived generation-and-repair comparison using browser feedback, generated state-machine tests, and TLA+-checked feedback. [The optimization report](study-c-optimization-report.md) records its exploratory implementation and failures. [The compact closure record](figures/study-c-closure.json) preserves the final measurements, source hashes, and claim boundaries without provider responses or credentials.

The completed paid feasibility run used xAI `grok-4.6` on task 1267. It took 49 minutes 45 seconds and 13 provider requests (349,968 recorded tokens). The fresh artifact received a local baseline rating of 58/100; the formal arm was blocked before repair and received no score. An offline synthetic control later showed TLC and ordinary deeper graph search producing the same 12-action defect-revealing trace. No artifact-quality gain or incremental TLA+ detection advantage was established. No further paid run is planned; offline fixture and harness checks must not be reported as benchmark outcomes.

## Review revision and evidence boundary

[review-response.md](review-response.md) records which reviewer requests are addressed and which require new experiments. The manuscript reports finite-domain maximality, an observed browser upper bound, and a single disclosure case—not a cost-effectiveness ranking. Page counts are deliberately not hardcoded in the website because they change with revisions.

Run `node paper/review-evidence.mjs` from the repository root to reproduce the oracle headroom, 840-item miss breakdown, and historical policy inventory. [review-evidence.mjs](review-evidence.mjs) validates count identities and prints source hashes without editing saved results, collecting new pages, or reading secret values. These derived counts are not a new scoring run or a measurement of human time.

The canonical PDF remains [verifiable-web-artifacts.pdf](verifiable-web-artifacts.pdf), compiled from [verifiable-web-artifacts.tex](verifiable-web-artifacts.tex). Astro prerenders it through the existing research route; do not maintain another copy in the public asset tree. Rebuild the site after rebuilding the paper to refresh the static output.

## Build the visual-TDD paper

```powershell
pdflatex -interaction=nonstopmode -halt-on-error -jobname=executable-evidence-public-resumes -output-directory=paper paper\test-driven-public-resume.tex
pdflatex -interaction=nonstopmode -halt-on-error -jobname=executable-evidence-public-resumes -output-directory=paper paper\test-driven-public-resume.tex
```

## Build the executable-contracts paper

```powershell
pdflatex -interaction=nonstopmode -halt-on-error -jobname=verifiable-web-artifacts -output-directory=paper paper\verifiable-web-artifacts.tex
pdflatex -interaction=nonstopmode -halt-on-error -jobname=verifiable-web-artifacts -output-directory=paper paper\verifiable-web-artifacts.tex
```

## Reproduce the Playwright visual study

Supply the compared deployments at runtime so identifying URLs are not stored in the study script:

```powershell
$env:LEGACY_URL='<legacy-url>'
$env:MODERN_URL='<modern-url>'
node paper\visual-study.mjs
```

The script measures both pages at `1440x900` and `390x844`, writes aggregate metrics to `figures/metrics.json`, redacts text and imagery, and captures plain and x-ray views.

## Reproduce the commit study

```powershell
node -e "process.env.START_COMMIT='<first-commit>'; process.env.END_COMMIT='<last-commit>'; import('./paper/commit-study.mjs')"
```

This writes anonymized commit observations to `figures/commit-metrics.json` and renders `figures/commit-trajectory.png`.

## Render Mermaid diagrams

```powershell
node paper\render-mermaid.mjs
```

The Mermaid sources live in `diagrams/`. Rendering requires network access to load Mermaid, but the paper and arXiv package use static PNG outputs and compile without JavaScript or image conversion.

## arXiv package

`executable-evidence-arxiv.zip` contains only `main.tex` and the six referenced PNG figures. It intentionally excludes the generated PDF and LaTeX intermediates, following arXiv source-submission guidance.
