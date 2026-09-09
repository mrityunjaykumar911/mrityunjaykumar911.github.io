# Execution steps: flex item independence

Working memory for this project. Self-contained on purpose. Read this before doing anything.
Companion document: `PROBLEM.md` (problem, metric, goals, non-goals, defense).

---

## State at start

Already done:
- Corpus scan over WebCode2M, 4,608 pages, 535,583 nodes. Scripts in `formal/research/`:
  `webcode2m_layout_scan.py`, `bbox_probe.py`, `coupling_score.py`, `coupling_refine.py`.
- Dataset gate passed. Styled-node to inline-style-attribute ratio 6.5, so stylesheet rules are
  resolved into the `bbox` tree. "No flex declaration implies default `flex: 0 1 auto`" is sound.
- Flex: 1.1 percent of containers decomposable under a syntactic proxy. 97.5 percent coupled.
  88 percent of coupled children are the plain CSS default. 5.7 percent of containers excluded
  for escaping descendants. 48.2 percent actively coupled at the capture width.
- Grid: 464 containers, 339 with declared tracks, 69.9 percent coupled. Independent cases are
  mostly trivial (`100%`, fixed pixel tracks).

Known defects in the above:
- Numbers are container-counted, not node-weighted. Wrong unit. Must be recomputed.
- Wrapped flex containers were included, which invalidates the active/slack split for roughly
  11 percent of containers (the negative tail in the free-space histogram).
- The syntactic proxy marks every shrinkable item coupled, which misses freeze-at-minimum.

The open hypothesis this plan tests:
> An item clamped at its minimum size freezes there, and its final size is then its own
> minimum, which depends on its own content and not on any sibling. So items the proxy called
> coupled may be independent. Because every flex item has an automatic content-derived minimum,
> this case may be common.

---

## Rules of engagement

R1. Cheapest falsification first. Test the hypothesis before building machinery on it.
R2. Decision rules are written before the run that produces the number, never after.
R3. State the goal before acting. Show reasoning, not just output.
R4. Prior-art kill check before committing effort to any new direction.
R5. A negative result is a result. Do not reinterpret to rescue a hypothesis.
R6. Every reported number carries its unit, its denominator, and its bound.

---

## Step 0. Lock the two open decisions

**0a. Denominator.** Report two numbers, always together.
- Primary: fraction of nodes *under flex containers* admitted as independent. Isolates what is
  new.
- Secondary: whole-page decomposable surface, including block and float content already handled
  by prior work. The engine-level claim.
Reason: reporting only the primary oversells; reporting only the secondary buries the
contribution under content that was never the problem.
Output: recorded here. Done.

**0b. Wrapping.** Non-goal N4 excludes wrapping from the model, so the corpus measurement must
exclude or segment it too. Containers with `flex-wrap: wrap` are reported as a separate bucket,
never merged into the main figure.
Reason: the model and the measurement must have the same scope or the comparison is meaningless.
Output: recorded here. Done.

---

## Step 1. Pin the algorithm

**1a. Fetch the specification.** Retrieve CSS Flexible Box Layout Module Level 1, section 9.7
"Resolving Flexible Lengths", verbatim. Also section 9.2 for flex base size and hypothetical main
size, and the definition of the automatic minimum size.
Reason: writing a formal model from a half-remembered algorithm produces a specification of a
system nobody uses. This is an hour of work that protects days of it.
Output: `sln/SPEC-9.7.md`, the algorithm quoted with its step numbering preserved.

**1b. Restate as pseudocode.** Reduce to the in-scope fragment: single line, main axis, definite
container size. Mark every simplification explicitly against the spec's step numbers.
Reason: the mapping from spec steps to model steps is what a reviewer will audit.
Output: `sln/MODEL.md`, pseudocode plus a table of simplifications and their justification.

---

## Step 2. Implement, validate, and test the hypothesis

**2a. Implement.** Write the pseudocode as a Python function: inputs are container main size and
per-item (flex base size, grow, shrink, min, max); output is per-item used main size plus which
items froze and why.
Output: `sln/flexmodel.py`.

**2b. Unit-test against worked cases.** Hand-computed cases covering: no flexing needed, grow
only, shrink only, one item clamped at min, cascading refreeze across two rounds.
Reason: catches implementation error before it contaminates the corpus comparison.
Output: passing test suite in `sln/test_flexmodel.py`.

**2c. Validate against observed layout.** For real flex containers in WebCode2M, feed the model
the children's properties and the container's observed main size, then compare predicted used
sizes against the observed `bbox` values.
Reason: this is the only available check that the model is the flex algorithm rather than my idea
of it. We have 535,583 nodes of ground truth already downloaded and unused.
Output: `sln/validation.json`. Report median and 90th-percentile absolute error in pixels, and
the fraction of containers predicted within tolerance.
Criterion, fixed now: if the model does not predict the majority of containers within a few
pixels, the model is wrong or the extracted properties are incomplete. Diagnose before going on.
Do not proceed to step 3 with an unvalidated model.

**2d. Measure the hypothesis. Sharpened.** The naive version of this step counted how often an
item freezes at its minimum. That is the wrong question, because independence has to hold across
the width interval the engine verifies over, not at one width.

Correct question: sweep the container main size across a realistic interval, for example 320 to
1920 pixels, and count how often an item stays clamped at its own minimum across the **entire**
interval. Only those items are independent in the sense the engine needs.

Reason this matters: for the common default item (`flex: 0 1 auto`, no width) the basis resolves
to max-content and the automatic minimum is min-content. Since max-content is at least
min-content, the basis is never below the minimum, so mechanism C2 never fires on the common
case. That leaves C3, clamped-at-minimum, which holds at narrow widths and fails at wide ones.
An item clamped at one end of the interval and flexing at the other is not independent over the
interval.

Output: `sln/freeze_rate.json`, reporting both the per-width rate and the across-interval rate.
The across-interval rate is the one the gate reads.

---

## GATE (between step 2 and step 3)

Decision rule, fixed in advance:

- Freeze-at-minimum accounts for a **large** share of proxy-coupled items: hypothesis survives.
  The formal work is justified. Proceed to step 3.
- Freeze-at-minimum is **rare**: Δ is near zero by construction. Stop. Write up the negative
  result, keep the 1.1 percent as the answer, and the engine's contribution stays the sound
  summary of coupled containers.

Do not proceed past this gate on the grounds that the formal work would be interesting anyway.

---

## Step 3. Formal treatment (only past the gate)

**3a. Specify.** `sln/FlexIndependence.tla`. Model the resolution algorithm as validated in
step 2. Small bounded domain: 3 items, discretised sizes.

**3b. State independence.** Product construction: two configurations identical except item k's
flex base size. Invariant asserts every other item's used size agrees.
Reason: independence is a relational property, so it needs two runs compared, not one run
checked.

**3c. Search for the condition.** Use the checker to find the weakest predicate over one item's
own properties that implies the invariant. Subject to the local-evaluability constraint from
`PROBLEM.md` section 3: the predicate may reference only item i's properties and container-level
facts, never a sibling's content.
Output: candidate condition C, with counterexamples for each rejected candidate.

**3d. Non-vacuity.** Mutant configurations, each weakening C in one specific way, each required
to produce its expected counterexample. Match the existing `formal/` mutant convention.
Output: `sln/flex-safe.cfg`, `sln/flex-mutant-*.cfg`.

**3e. Record the gap.** Also derive the exact characterisation, ignoring local evaluability, and
report the coverage difference between it and C. That difference is the price of locality.

---

## Step 4. Bound sensitivity

**4a.** Re-run 3a to 3d at increased item count and finer size granularity. Confirm no violations
appear that the smaller bound missed.
Reason: this is the concession in `PROBLEM.md` section 9 turned into an experiment. If a larger
bound finds new violations, the original bound was too small and the result is reported at the
larger one.
Output: `sln/bound_sensitivity.json`.

---

## Step 5. Recompute and report

**5a.** Re-run the corpus measurement under condition C, node-weighted, per decision 0a, with
wrapped containers segmented per decision 0b.

**5b.** Compute Δ against the syntactic baseline, and record the evaluation cost of C: decidable
from authored CSS alone, or requires computed content sizes and therefore a render pass.

**5c.** Write the result with unit, denominator and bound attached to every number (R6).
Output: `sln/RESULT.md`.

---

## Effort shape

Steps 1 and 2 are hours. Step 3 is days. The gate sits between them deliberately. That ordering
is the whole design of this plan.
