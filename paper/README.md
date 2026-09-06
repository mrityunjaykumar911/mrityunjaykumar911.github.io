# From Resume Claims to Browser Contracts

This directory contains an anonymous five-page case study, its reproducible visual-analysis scripts, and an arXiv-ready source package.

## Build the paper

```powershell
pdflatex -interaction=nonstopmode -halt-on-error -jobname=executable-evidence-public-resumes -output-directory=paper paper\test-driven-public-resume.tex
pdflatex -interaction=nonstopmode -halt-on-error -jobname=executable-evidence-public-resumes -output-directory=paper paper\test-driven-public-resume.tex
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
