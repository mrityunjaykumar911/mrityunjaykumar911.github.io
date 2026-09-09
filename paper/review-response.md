# Review revision: evidence and remaining experiments

## Disposition

All three reviews have now been read. Review 2 is available in [review 2.md](review%202.md); the original chat contained only an attachment placeholder. The sections below incorporate its additional experiment requests without treating them as completed results.

The original claim that disclosure contracts repay their cost while geometric contracts do not was not supported by comparable samples, guarantees, or human-effort measurements. The manuscript now reports two verification boundaries rather than a general cost ranking. This is a claim correction, not a claim that the requested new experiments were completed.

## Addressed with existing evidence

| Review request | Revision | Evidence boundary |
| --- | --- | --- |
| Lead with the oracle | Study A now leads with 1,032/2,255 containers (45.76%) showing no detected coupling, before 633/2,255 (28.07%) admitted by the local predicate. | Finite probes, fixed container dimensions, blocked external assets, and eligibility filters; not universal independence or an upper bound on every rely/guarantee method. |
| Distinguish the unexplained gap | 1,223 containers show coupling (54.24%); 399 (17.69 percentage points) show none but are unadmitted. | Bounded maximality does not prove those 399 are unreachable with a richer vocabulary. |
| Qualify maximality | Abstract, introduction, analysis, discussion, conclusion, and website say maximal **on the checked finite domains**. | The definition of the always-independent set is separated from the enumerated equality with `Immobile`; no arbitrary-N proof is supplied. |
| Analyze the 840 misses | Added the complete saved category table; the 603-item dominant class accounts for 71.79%. | Categories compare raw basis with bounds at 320px, not `Hyp` at a failing width; no causal classification is asserted. |
| Report specification obligations | Added 5 sources, 12 sinks, 11 flow edges, 2 detectors, 8 configured encodings, 2 removal declarations, and 1 clearance override. Policy: 210 physical lines, 191 after removing comment fields and formatting with two spaces. | Historical policy inventory, not the present build's sink count. Layout predicate: five inputs, three definitions, four nonblank lines, excluding its supporting machinery. These are not comparable elapsed effort. |
| Promote D3 | Transition/write-read interference is now in Method and Instruments; corrected stale aggregate language. | No paired transition-only run, affected-page count, or isolated error magnitude exists in the saved results. |
| State the C3 design contribution | Declared removal is rechecked for detectable known forms; authorized retention is a separate clearance decision. | No claim to a new IFC calculus or proof of semantic information destruction. |
| Name differing verification standards | Discussion explicitly distinguishes model-domain independence from finite detector checks against manual policy. | Neither study establishes relative cost-effectiveness. |

Reproduce counts with [review-evidence.mjs](review-evidence.mjs). It reads the saved v3 score, policy, and canonical TLA+ predicate and prints hashes and arithmetic; it does not mutate or replace the original result artifacts.

## Requests requiring new experiments (not performed)

### 1. Sound vocabulary ladder

Recomputing baseline mode or free space is possible from saved inputs. Treating either as stable is unsound: a sibling can change it. Before reporting an intermediate point:

- Define the predicate and permitted sibling edits precisely.
- Validate its assumptions under those edits, including mode flips and freeze-loop changes.
- If a rely condition restricts edits, score both the candidate and oracle under that same restricted contract.
- Re-score identical corpus records, preserve exclusions, report counterexamples and item/container rates.

Current paper marks these intermediate points **not evaluated**. It does not draw a measured curve through them.

### 2. External disclosure corpus and baseline

Select 30–50 eligible public repositories with linked PDFs before looking at findings, pin revisions, record framework and exclusions, and run any builds in isolation. Preserve a manifest and hashes. An external-site study must recover a site's actual policy and audit set; it must not invent a site-wide privacy policy from one HTML assertion.

Report separate rates with eligible denominators and uncertainty:

1. Emitted files omitted from a recoverable existing audit set. No existing audit is a separate category, not an omission rate of 100%.
2. Contact information in a linked PDF inconsistent with an explicit policy that applies to that PDF. HTML-only exclusions and intentionally public CV contact details are not automatically leaks.

Compare pinned Gitleaks or TruffleHog configurations on matched inputs. Separate raw-file scanning from PDF extraction/normalization, specify intended secret classes, and adjudicate false positives. Personal contact information is not necessarily a credential, and a credential scanner need not target the same policy. Keep findings aggregate or redacted; do not publish harvested contact details or discovered secrets.

Before a new study, harden the prototype: missing files, unreadable PDFs, unavailable labelled values, and unknown flows must not silently count as successful certification. Existing checker limitations are now named in the paper; the historical results were not silently recomputed with changed semantics.

### 3. Human effort and maintenance

Prospectively record authoring/review time, declarations and corrections, and repeated maintenance after an introduced source read, new output, and representation change. Use comparable tasks and operators for geometry and disclosure; report censored or abandoned tasks. Specification size and historical compute runtimes cannot reconstruct person-hours.

### 4. Image and transition ablations

Use the same page snapshots with frozen cached assets and original intrinsic dimensions, recording unavailable assets. Arbitrary mocks do not restore the original layout. Compare blocked versus asset-preserved results on both all eligible pages and the stable-eligibility subset. Report label changes and container coverage changes.

Run a separate, paired transition-enabled/disabled ablation. Capture affected pages, probe read-back deviations, and label flips, holding other fixes and filters constant. Do not use 73.26% minus 67.66% as a transition-only effect.

### 5. Flow inference, semantic leaks, and replication

- Conservative import/build-graph inference can expose new dependencies, but not infer intended security labels or all value-level/dynamic flows. Validate unknown handling and missed-flow recall with mutations; retain human policy decisions.
- Semantic leaks require a separately labelled benchmark with false-positive/false-negative accounting and human adjudication. Adding a semantic model is not a soundness proof.
- Independent replication requires another researcher to run and interpret the pipeline. The author, an assistant, or a second automated code review does not satisfy that requirement.

## Recommended next milestone

Harden the byte checker and freeze an external-corpus protocol with explicit policy eligibility and a baseline, then measure human effort during that study. In parallel, validate a richer layout contract and asset-preserving ablation. The resulting evidence may support a narrower comparative claim; this revision does not presume the outcome.

## Review 2: additional requests and cautions

| Request | Status and required evidence |
| --- | --- |
| Information ladder | Pending; the soundness/contract constraints in section 1 apply. Its illustrative intermediate percentages are not data. Full recomputation for one layout is not proof of invariance under all sibling edits. |
| Decomposition theorem and 17.69-point non-locality claim | Not established. The revision reports the 399-container gap, but bounded-domain maximality cannot show every real-corpus miss requires non-local information. |
| Causal taxonomy of rejected containers | Pending. Define mechanism-specific interventions, distinguish observed coupling from predicate rejection, and record a reproducible attribution rule with an unknown category. Container pinning and cross-axis controls are measurement conditions here, not measured causes that can be assigned percentages retrospectively. The 840-item shape table is descriptive, not this causal taxonomy. |
| Disclosure mutation campaign | Pending. Use synthetic marker values in isolated fixture builds for reversal, base64, entities, percent encoding, attributes, PDF content, new sinks, undeclared sources, and clearance changes. Compare the same mutants against existing tests and the byte checker; validate that each mutation took effect and is observable. Report detections, misses, unsupported cases, and clean controls. Undeclared sources are a known limitation, not an assumed success. The three existing abstract policy mutants are not this campaign. |
| Geometry baselines | Pending matched re-scoring of an empty recognizer, syntactic heuristic, local predicate, and browser/full-model reference under identical eligibility and perturbation contracts. Do not join the historical 1.1% proxy and current 28.07% into a controlled comparison without matching the inputs and filters. |
| Utility and cost accounting | Report soundness evidence, coverage, execution cost, and human effort separately before selecting any weighted objective. An empty recognizer has vacuous soundness and zero coverage; its precision is undefined (0/0), not measured 100%. Seconds and implementation complexity cannot simply be added into an interpretable benefit denominator. |
| Verification of the instruments | Already reflected as a working principle and in the manuscript's measurement controls. Claims that “normal evaluation would not catch” a defect require an explicit baseline, not an unmeasured yes/no table. |

The stronger proposed thesis is a research direction. A general information-theoretic ceiling, causal percentages, near-complete disclosure coverage, and an arbitrary-N maximality proof are not conclusions supported by the existing artifacts. The public method page presents the research as a case study in testing and revising a claim, separate from the personal working process.