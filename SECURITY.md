# Security Policy

This repository builds [mrityunjaykumar911.github.io](https://mrityunjaykumar911.github.io/),
a personal portfolio and résumé site. It is a static [Astro](https://astro.build) site,
built by GitHub Actions and served by GitHub Pages. It has no server code, no user
accounts, and no forms. The only third-party script is Google Analytics.

## Supported versions

There are no numbered releases. Only the site that is live now, deployed from the
latest commit on `master`, is supported. Fixes ship as a new deploy.

| Version | Supported |
| --- | --- |
| Live site (latest `master` deploy) | :white_check_mark: |
| Older commits, forks, and local builds | :x: |

## Reporting a vulnerability

Please report privately. **Do not open a public issue or pull request** for a security
problem.

Use GitHub private vulnerability reporting:
[Report a vulnerability](https://github.com/mrityunjaykumar911/mrityunjaykumar911.github.io/security/advisories/new)
(Security tab, then "Report a vulnerability").

Please include:

- The affected URL, file, or workflow.
- Steps to reproduce, and a proof of concept if you have one.
- What an attacker could do with it, and any conditions it depends on.

## What to expect

This is a personal project with one maintainer, so these are targets, not guarantees.

| Step | Target |
| --- | --- |
| Acknowledge your report | Within 5 days |
| Confirm or decline, with reasons | Within 14 days |
| Fix a confirmed critical or high issue | Within 14 days of confirmation |
| Fix other confirmed issues | Within 90 days of confirmation |
| Status updates while open | At least every 14 days |

After a fix is deployed, I publish a GitHub security advisory and credit you if you
want to be credited. Please keep details private until then. There is no bug bounty.

## Scope

In scope:

- Script injection or XSS in any published page.
- Publication of content that is meant to stay private. Examples: the local-only
  résumé overlay (`src/data/resume.local.yaml`), raw study material excluded by
  `.gitignore`, or contact details beyond what the site shows on purpose.
- Secrets committed to the repository or its history.
- The build and deploy pipeline: workflow permissions, untrusted code running with
  write access, dependency supply-chain risks, or a way to deploy content without a
  commit to `master`.
- A dependency vulnerability that is reachable in the published site or in the
  build. Please show how it is reachable; Dependabot already tracks advisories.

Out of scope:

- GitHub, GitHub Pages, or Google Analytics themselves. Report those to the vendor.
- Missing HTTP security headers. GitHub Pages does not allow custom headers, so these
  are only in scope with a working exploit.
- Automated scanner output without a proof of concept.
- Denial of service, rate limiting, and volume-based attacks.
- Social engineering, and attacks that need a compromised device or browser.

## Safe harbor

Good-faith research that follows this policy is welcome. I will not pursue or support
legal action for it. Stay within these limits:

- Test only against the public site in a non-destructive way, or against your own
  fork or local build.
- Do not access, change, or keep data that is not yours.
- Do not run denial-of-service or automated high-volume tests.
- Give a reasonable time to fix before any public disclosure.

## How the site is protected

- Every deploy is gated by CI: a TLA+ publication-safety model, offline study tests,
  and Playwright browser tests must pass before the build job runs.
- Workflow tokens are least-privilege. Only the deploy job can write to Pages, and
  the test job that runs on pull requests is read-only.
- GitHub Actions are pinned to full commit SHAs. Dependabot keeps actions and npm
  packages current.
- Only `master` can deploy. Pull requests run tests but never build or deploy, and
  manual runs from other branches are refused.
- Private material, such as the local résumé overlay, is git-ignored, so CI never sees
  it. Only the local development server renders it.
