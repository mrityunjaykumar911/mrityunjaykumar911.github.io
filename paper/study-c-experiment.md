# Study C1 — does model-based feedback improve generated artifacts?

**Status: closed negative feasibility study. No further paid run is authorized.**

This document preserves the predeclared design and historical amendments. The only paid feasibility run used task 1267 and xAI `grok-4.6`: 13 requests, 349,968 recorded tokens, and 49 minutes 45 seconds. Its fresh artifact received a local baseline rating of 58/100; the formal arm blocked before HTML repair and received no score. A later offline control found that TLC and ordinary deeper graph search produced the same synthetic 12-action defect trace. No ArtifactsBench improvement or incremental TLA+ detection advantage was established. See [the optimization report](study-c-optimization-report.md) for the chronology and limitations. No weight update, fine-tuning, RL, or cross-task policy learning occurred.

## Historical allocation and protocol amendments

The remainder of this section is retained as chronology. Its pending gates and proposed reruns are not current instructions and do not override the close-out above.

On 2026-09-07 the user selected **ANT / Opus 4.8** for coding, **ANT / Opus 5** for judging, a **20,000-token cap**, noncommercial research with downloads and isolated execution allowed, and **self-review**. ANT is interpreted as Anthropic's Claude API. Official documentation identifies the models as [claude-opus-4-8](https://platform.claude.com/docs/en/models/opus-4-8/overview) and [claude-opus-5](https://platform.claude.com/docs/en/models/opus-5/overview); account availability has not been checked. Documentation verification is not an inference result or an account authorization check. Credentials must be configured locally as `ANTHROPIC_API_KEY`; never put them in this plan, browser sandbox, or chat.

The cap is interpreted conservatively as **20,000 total experiment API tokens**, covering input and output across both models, all arms, repeated context, images, and retries—not 20,000 per call. Thinking tokens count within output usage; cached input counts at full token volume even if discounted in dollars. Avoid double-counting provider usage components. This allocation does not fund the 12-task development study, pilot, or confirmation below.

**Active scope C1-smoke-20k:** attempt one prompt-selected eligible task, one shared initial generation, at most one repair per B/G/T arm, and one blinded judge rating per final artifact. Do not separately rate the initial artifact. This targets at most seven Messages requests, with automatic retries disabled; metadata/token-count preflight is not generation. Equal repair and evaluation allocations must be reserved before starting. Task selection still precedes inspection of generated outcomes; any token-fit exclusion must be recorded without searching model outputs for an easy win.

One full paired block may not fit: three image-bearing judge inputs repeat the code and checklist. Per-request output caps and thinking/effort settings remain unchosen until the complete request shapes can be costed. Do not silently remove screenshots, shorten the official checklist, give one arm extra repairs, substitute models, or consume another arm's reserve to finish. If the block cannot fit, report a budget-limited/incomplete smoke test or request a revised cap before additional inference.

[Anthropic's token-counting documentation](https://platform.claude.com/docs/en/build-with-claude/token-counting) describes preflight counts as estimates. The future runner must reserve input with a justified upper-bound allowance plus maximum output (including thinking), reconcile actual usage after every call, and retain the reservation on timeout/uncertain billing. An estimate alone is not a hard guarantee. If the runner cannot establish sufficiently bounded admission under the user's cap, it must not start inference. No budget enforcer or actual-task agent adapter has been implemented yet; configuration fields are not enforcement.

**Amendments relative to the full design below:** one task/replicate/repair/rating replaces the larger repetition counts, per-call inference allocations must fit the global cap, retries are disabled, and human review is self-review only. Only descriptive smoke-test outputs are permitted—no inferential intervals, superiority/equivalence claim, or ArtifactsBench gain. Formal confirmation requires renewed resources and a new freeze. Full-study budget fields remain planning values, not active allowances.

Using an Opus judge changes the historical Gemini evaluation condition. The coding and judging models also share a provider/family, so blinding arm labels does not remove possible family-related evaluation bias. Retain deterministic behavioral checks, report this limitation, and reserve independent human or cross-provider corroboration for a later authorized study. For this self-reviewed smoke test, do not claim separate human evaluators or author blinding that did not occur; keep official checklists and hidden tests out of the coding agent's inputs.

Download/isolated-execution permission is recorded, but it is not a substitute for checking individual dataset/assets' license conditions and preserving attribution. `runAuthorized` and smoke readiness remain false until credential access, manifest, contract/adapter calibration, and budget admission are verified. The existing synthetic replay result is unchanged.

**Current preflight blocker (2026-09-08 UTC):** Both requested IDs were available through Anthropic's model-metadata endpoint, but the initial text-only token-count request returned HTTP 400 with an account billing/credit restriction. This is not evidence of a malformed image request or a model-generation failure. No generation was attempted. The count-only transport now emits allowlisted diagnostic categories and is covered by offline Node tests; it never logs the credential, raw API error, or judging checklist. Resolve the account restriction before rerunning `npm run study:c:budget`. Even a successful count does not authorize inference until whole-block budget admission and the test adapters are ready.

## 1. Decision and falsifiable hypotheses

**Question:** With one fixed coding model and a matched inference/test budget, does executable feedback selected using a TLA+ task model improve the quality of the final web artifact?

- **H1, harness-package value:** T scores higher than B on the preselected tasks.
- **H2, incremental model-based value:** T scores higher than G with the same task contract, assertion oracle, repair prompt, release semantics, and concrete-test budget.
- **Mechanism prediction:** T discovers and reproduces more relevant multi-step failures before repair, followed by fewer failures on independent hidden interaction tests. An increased judge score alone does not establish this mechanism.
- **Null worth reporting:** T and G are equivalent or G is better. The current release-gate pilot already shows that a TLC-derived conjunction is not behaviorally better than the same handwritten conjunction.

The intended intervention is **test-sequence discovery → concrete browser failure → agent repair**, not a green authorization bit. The existing release model validates evidence handling only. It cannot generate diagnoses of arbitrary JavaScript or improve a screenshot on its own.

## 2. Benchmark identity and claims

Use [Tencent ArtifactsBench](https://github.com/Tencent-Hunyuan/ArtifactsBenchmark), associated with [arXiv:2507.04952](https://arxiv.org/abs/2507.04952). Its reported 1,825 tasks cover visual/interactive code generation. The published methodology is principally single-turn artifact evaluation, not this multi-turn intervention.

The following implementation facts were inspected on 2026-09-07; these moving source URLs must be replaced by an exact commit in the run lock:

- [Evaluation entry point](https://github.com/Tencent-Hunyuan/ArtifactsBenchmark/blob/main/test.sh): three screenshots and a Gemini judge path.
- [Rendering utilities](https://github.com/Tencent-Hunyuan/ArtifactsBenchmark/blob/main/src/utils.py): HTML/SVG extraction, full-page screenshots after network idle, three captures with a default one-second interval. The inspected capture function does not execute task-specific clicks. Screenshot count must not be reported as state-transition coverage.
- [Judge driver](https://github.com/Tencent-Hunyuan/ArtifactsBenchmark/blob/main/src/infer_gemini.py): question, final answer, checklist and images are supplied to the judge. Its summary can exclude rows with failed score parsing, and image attachment can fall back to text-only. Our ledger must expose both cases rather than silently changing the denominator or modality.
- [Judge prompt](https://github.com/Tencent-Hunyuan/ArtifactsBenchmark/blob/main/src/prompts/prompt_mllm_check.py): an overall score is requested. Separate visual/functional numeric subscores must not be invented from this scalar output.
- [Dataset](https://huggingface.co/datasets/tencent/ArtifactsBenchmark): its card currently specifies CC-BY-NC-4.0, while the repository LICENSE specifies CC-BY-4.0. Record and respect the license of each fetched asset; resolve intended-use/redistribution permission before acquisition. Do not assume the code repository's license overrides the dataset card.

**Reporting label:** “ArtifactsBench-derived stateful subset, iterative repair, fixed-model study.” Do not compare its mean directly with MiniMax-M2's 66.8, mix judge versions, or call a subset improvement an official full-benchmark gain. A later full-suite evaluation would require the appropriate scope, licensing, and benchmark protocol disclosure.

## 3. Treatment arms

| Arm | Visible engineering feedback | Sequence selection | Release protocol |
| --- | --- | --- | --- |
| B — browser baseline | Common render/console/smoke checks; ordinary browser tools and agent-authored tests | Agent-directed, within the same tool/action budget | Same stateful gate as G and T |
| G — conventional model-based testing | B plus concrete failures against the frozen task contract | Seeded coverage-guided property-based walks, boundary cases, reset/cancel/retry operations where specified | Handwritten stateful gate |
| T — TLA+-guided model-based testing | Same failure schema and oracle as G | Bounded task-model exploration; select traces exercising uncovered state/action pairs and event-order combinations | TLC-catalog gate, equivalent to G's gate |

All arms receive the same original task, human-reviewed behavioral requirements, coding scaffold, output format, and tool interface. The human-readable contract adds no requirement absent from the original prompt. The serialized contract is available read-only to all arms, so H1 is not secretly “give only T a specification.” What differs is automated test selection and its returned evidence. B is allowed to use its budget to write tests; do not deliberately cripple it.

G is a serious baseline, not only a few happy-path assertions. It uses the same abstract state/action representation and predicate evaluator as T, with explicit coverage tracking and boundary/event-order sampling. Both selectors receive the same prior test observations. The primary comparison excludes a separate LLM critic, extra model calls, or richer prose available only to T.

Selector rules must be implemented and frozen on development tasks. The proposed G selector uses seeded walks, weighting an enabled action inversely by its previously visited state/action count, cycling the same boundary-value pool available to T. The proposed T selector obtains bounded successor transitions from TLC, constructs replayable paths up to the same length bound, and greedily chooses traces maximizing previously uncovered state/action and adjacent-action-pair coverage; ties are broken lexicographically. Both reset from the same starting fixtures, encode specified invalid actions as rejection/no-op transitions, and retain previous coverage across rounds. Record the realized algorithm and all traversal/selection work, including offline model exploration. If both selectors choose the same tests, the expected evidence is a tie, not a reason to weaken G.

**Negative control:** On development tasks, feed G and T the same concrete trace batch. Their observations, violation classifications, normalized feedback, and release decisions must be identical. Any difference is an adapter bug, not a formal-method advantage. Equal selected sequences may also produce no effect in the main study; that is a valid result.

## 4. What the task models describe

Start with local stateful HTML/JavaScript tasks in Web Applications, Management Systems, and Quick Tools. Eligible behaviors include, when explicitly requested, add/edit/delete, undo/reset, filtering and selection, validation before commit, persistence, and cancellation or retry semantics. Do not add arbitrary security or asynchronous requirements solely to make TLA+ useful.

For each eligible task, before any candidate output is inspected:

1. Extract behavioral obligations from the original prompt—not from the official judge checklist or published reference outputs.
2. Create one bounded contract: state variables, abstract actions, preconditions, expected state changes, error/no-op transitions, and invariants. Record numerical bounds and observability limits. Do not equate bounded safety with liveness or unbounded correctness.
3. Have a second reviewer validate the contract against the prompt and record authoring/review minutes. If no independent reviewer is available, mark the work self-reviewed; do not claim independent validation.
4. Build an external action/observation adapter shared by G and T. Derive state from actual DOM, storage, and intercepted local responses as appropriate, not from an agent-written `safe=true` flag. Locator/mapping failures are `unknown`, not proof of application failure or success.
5. Validate the adapter on a known-correct fixture and requirement-breaking mutants. Include legal successful paths and intentional rejected/no-op actions so a block-everything checker fails calibration.

The contract's canonical representation feeds both the conventional interpreter and TLA+ translation. Differential tests over bounded states/actions verify that they agree. This shared representation reduces translation confounds but is itself a trusted, fallible part of the experiment.

**TLA+ is not a JavaScript verifier in this experiment.** TLC explores the specified model to obtain test traces. A trace becomes evidence against a candidate only after its actions are replayed on the real artifact and observed state violates the independently implemented oracle. If TLC finds a counterexample in the task specification itself, fix/review that specification during development; do not send a model-only failure to the coding agent as though its code caused it. During confirmation, unexpected spec defects trigger the amendment rule below.

### Illustrative task, not an assigned benchmark ID

For a prompt that explicitly requires deletion with undo: add an item, delete it, undo, then inspect the item list and counters. Repeated undo must have the behavior stated by that prompt. A useful failure report identifies the action sequence and the concrete duplicate/missing item. Checking a release ticket alone cannot discover that bug. This example is not a measured result or a claim that a particular benchmark task exists.

## 5. Task selection, separation, and sample size

The sampling unit is a **unique prompt family**, not a screenshot, seed, repair turn, or judge call. Detect exact and near duplicates before selection; select at most one task per family and keep development, pilot, and confirmation families disjoint.

- **Development:** 12 unique tasks, used only to stabilize adapters, budget enforcement, prompt format, and negative controls. No inferential claim.
- **Pilot:** 30 different unique tasks, three independent initial generations per task. Estimate operational feasibility and paired-score variability, not a confirmatory gain.
- **Confirmation:** target at least 120 new unique tasks, three initial generations per task; use the variance-only sample-size rule below before touching confirmation outputs. Resource ceiling: 240 tasks. If the needed number exceeds the ceiling or eligible pool, declare the planned test underpowered or amend before running—do not quietly claim adequate power.

Construct the eligible pool using original prompts and official category/difficulty metadata where available. Record missing metadata rather than invent labels. Stratify proportionally by category and difficulty; use deterministic hash ordering within strata and largest-remainder allocation. Freeze the sampling seed, exclusion reasons, task IDs, prompt hashes, family IDs, contract hashes, allocation, and ordered reserve list before generation. Do not select tasks because a model failed them or because T can already solve them.

The pilot also records all tasks excluded for unavailable assets, server requirements, licensing, ambiguity, or inability to define an observable contract. Report eligible/total proportions. Results concern that eligible stateful subset, not arbitrary ArtifactsBench tasks. Public benchmark prompts may have appeared in model training; these are researcher-held-out splits, not guaranteed contamination-free data.

### Pilot-based sizing, fixed before confirmation

Use pilot task-level paired differences averaged over generation/judge repetitions. For each primary contrast compute its sample standard deviation `s`. The normal-approximation planning formula for a 3-point effect, 80% power, and two-sided per-contrast alpha 0.025 is:

`N_required = ceil(((2.2414 + 0.8416) * s / 3)^2)`.

Choose the larger requirement for T−B and T−G, with minimum 120; freeze the resulting N and strata before confirmation. Publish pilot variance and sensitivity to its uncertainty. This approximation is a planning tool, not proof of power. Do not use the pilot's favored mean effect to lower the target, combine pilot results into confirmation, or inspect confirmation scores to decide when to stop.

## 6. Paired generation and repair workflow

1. Pin one coding model version, deployment/provider fingerprint, tokenizer, sampling parameters, context limit, and initial prompt. For self-hosting, pin checkpoint/quantization hashes. No moving model alias or silent version substitution.
2. For each task and generation replicate, generate the initial artifact once. Save its exact response, serialized code, context, and hashes. Clone that checkpoint into isolated B/G/T runs. A shared initial failure remains in all arms and may be repaired; it is not an exclusion.
3. Run up to three repair rounds. After a candidate is complete, snapshot it, run the condition's checks, normalize the returned evidence, and let the same model edit it. Three rounds is a cap, not three opportunities to pick a favorable score.
4. Use fresh workspaces, browsers, and model sessions per arm. Randomize B/G/T execution order within each task/replicate and interleave blocks across time. Seeds pair common starting conditions, not a guarantee of deterministic remote inference. Record provider seed support.
5. Freeze the final artifact as the **latest fully received candidate at stop/deadline**. Do not choose the highest judge score, best-looking revision, or last passing revision. A partial final response does not overwrite the preceding complete candidate; malformed but complete output does. The same rule applies to all arms.
6. Score every final artifact in a separate sandbox, even if its release gate refused it. Release decisions and artifact quality are different outcomes. No real deployment is required.

The initial artifact is also scored offline as a descriptive reference. It is not a fourth budget-matched arm, and its scores are never returned during repair. No official evaluator calls, checklist access, hidden tests, or leaderboard feedback are available to the agent.

Select a model whose input modalities and tool-call interface support the frozen scaffold. If screenshots cannot be consumed directly, use the same non-LLM browser observations for all arms; do not add a vision-model assistant to only one condition. Provider outages during generation are infrastructure failures: retry the same request under a fixed policy and record unresolved trials as missing, not score 0. An actual model-produced refusal, empty response, or malformed complete candidate is an artifact outcome. Preserve unknown billing/partial-response outcomes rather than pretending a timed-out request was free.

### Budget proposal

The planning record is the canonical numeric budget. The initial proposal allows one initial generation (8,192 output tokens) plus up to three repair calls sharing 16,384 additional output tokens, with at most 8,192 per repair call. Each arm has the same cumulative input-token cap, tool-call cap, browser-action cap, and elapsed-time limit.

G/T may run at most 24 concrete traces of up to 8 task actions per repair round, within the shared browser-action cap. Trace shrinking and verification reruns consume that budget too. Both get the same selector CPU/wall limit; exhausted exploration is `unknown/incomplete`, not a success. The simulator's tiny eight-bit catalog is not a substitute for task-model exploration.

All hidden reasoning tokens, tool outputs, and any auxiliary model calls count toward the declared limits. If a provider cannot expose or bound a required usage field, mark that limitation and do not claim exact resource matching. No adaptive best-of-N, invisible extra verifier model, cross-arm memory, or model-driven prompt optimizer is permitted.

The primary study is serial within an arm. This isolates feedback utility from scheduling advantages. It can run different tasks concurrently only with fixed resource reservations and matched load. Record actual usage in addition to equal caps: equal opportunities need not produce equal consumption.

## 7. Repair feedback contract

All conditions receive the same envelope, with a fixed deterministic presentation order:

- `revisionHash`, `contractHash`, `checkRunId`;
- `status`: `pass`, `fail`, or `unknown`;
- observed render and console failures;
- up to three concrete violations, each containing `requirementId`, starting conditions, ordered actions, expected predicate, observed value, and screenshot/log references;
- coverage and truncation/timeout indicators.

For G/T, sort reproducible violations by shortest failing sequence, then requirement ID and action serialization. Shrink using the same algorithm and remaining budget. Cap feedback at the same token count. Do not give T an essay while G receives an error code. Verifier names, praise, “formally verified” language, and final judge scores are absent from the repair prompt.

All reported failures must have a replay reference tied to the exact candidate hash. An asynchronous or unstable failure must be flagged with the observed reproduction count; do not disguise flaky observations as a universal counterexample. A model timeout or adapter error may be reported as `unknown` but must not instruct a spurious code fix.

## 8. Evaluation — three distinct outputs

### A. Primary: artifact quality under the benchmark judge

Use the original task, frozen official checklist and judge prompt, and the same extraction/rendering/screenshot convention for all arms. Serialize only the final code in the same wrapper; no repair transcript, arm label, verifier log, or claimed safety result goes to the judge. Preserve actual code comments; label-blinding cannot hide all stylistic clues, so document that limitation.

Use a pinned judge version (Gemini-2.5-Pro is the historical reference, not an assumed available immutable endpoint) and three independent judgments per immutable artifact. Reuse the same captured screenshots for those repetitions; capture reliability is checked separately. Randomize evaluation order and use anonymous artifact IDs. Record complete inputs, prompt hashes, raw judge responses, parser result, usage, model fingerprint, and screenshot hashes. The official overall score is 0–100; report points, not percentage improvement.

If a different judge or transport implementation is needed, freeze it before pilot/confirmation and disclose the study variant. Validate the adapter's serialized prompt/images against the pinned reference on fixtures. Its repository uses a custom API payload: having the Python script does not mean that endpoint is directly usable. A Node orchestrator may call a pinned evaluator or use a parity-tested adapter; an unvalidated port is not the official implementation.

**Missingness and failure rules:**

- Empty generation, no complete HTML/SVG after the common extractor, or artifact-caused failure to render within the fixed render limit gets study score 0 and an explicit failure code. Console errors in an otherwise renderable artifact do not automatically make its score 0. Retain malformed bytes for audit.
- A failed image capture caused by environment outage, missing judge images, malformed judge response, or rate limit is an evaluation failure, not an artifact score. Retry the identical input under the fixed retry policy; never switch to text-only or re-generate the candidate to fill the cell.
- After retries, retain the assigned cell as missing. Report completion denominators and worst-case score bounds for every unresolved cell, assigning T=0/control=100 for a conservative superiority bound. Do not assert a gain unless it survives missing-data sensitivity; if needed report confirmation as incomplete.
- Report the reference harness's parseable-row mean only as a compatibility diagnostic, with its denominator. The primary result uses all assigned trials and the explicit rules above. It is therefore a disclosed study scoring policy, not an unchanged leaderboard score.

### B. Secondary: independent functional behavior

A separately implemented, frozen hidden suite tests the same prompt requirements with unseen action sequences and values within declared bounds. It does not read gate approvals and is not derived by simply rerunning T's selected trace list. Include longer sequences as a separately labelled stress subset; do not conflate unmodelled requirements with in-domain failures.

Report per-task fraction of hidden tests passed, all-required-tests pass rate, renderability, reproducible invariant violations, coverage/unknown rate, and regressions from the common initial artifact. Calibrate the hidden oracle on known-correct and deliberately faulty fixtures. Do not claim semantic oracle independence merely because its function name differs from the gate's.

The official checklist and these tests stay inaccessible to the agent, contract author, and repair selectors. A separate evaluator may use the original prompt and checklist to author evaluation checks. Any prompt/checklist inconsistency is logged; it is not silently converted into a new requirement for one arm.

### C. Secondary: delivery and cost

Report evidence-freshness violations, unauthorized release attempts versus actually executed simulated releases, false blocks, and timeout/unknown decisions separately. These are not extra points in the quality score.

Measure model input/output/reasoning tokens, model calls, browser actions, verifier CPU/wall time, end-to-end elapsed time, API dollars, and analyst time. Separate one-time contract/adapter authoring and review, implementation of each test selector, and ongoing maintenance from per-trial execution. Show actual billed shared-initial-generation cost and conceptual per-arm cost without double-counting or pretending shared setup is free. No overall cost-effectiveness claim follows from lookup speed alone.

## 9. Analysis and decision rules

Let `S[i,r,a,j]` be the final overall score for task family `i`, initial-generation replicate `r`, arm `a`, and judge replicate `j`. Average the three judge scores per artifact, then average over the three generation replicates per task. Compute paired task-level differences `d[i] = mean(T) − mean(control)`.

- Co-primary contrasts: T−B and T−G. Do not select whichever looks best after running.
- Estimate mean differences and Bonferroni-adjusted **97.5% two-sided intervals** for each contrast using 20,000 stratified task-cluster bootstrap resamples with a frozen analysis seed. Resample complete task blocks, keeping all arm/generation/judge outcomes paired. Repeated judge calls are not independent tasks.
- Use a declared practical effect threshold of **3 score points**. Evidence of an observed practically relevant gain requires point estimate at least 3 and adjusted lower bound above 0. Claiming the true gain is at least 3 would instead require the lower bound above 3. Neither threshold is a predicted outcome.
- Call T's incremental quality benefit supported only when both contrasts pass that rule and results survive the missingness sensitivity. A T−B improvement alone supports the added testing/repair package, not a specific advantage of TLC over conventional model-based tests.
- Report hidden-test and renderability differences with task-cluster intervals. If the overall score rises but functional behavior declines, report a trade-off, not broadly improved correctness. Functional noninferiority for a “no functional degradation” claim uses a predeclared five-percentage-point margin on task-normalized hidden-test pass fraction.
- Do not infer equivalence from nonsignificance. A separate equivalence claim requires both bounds inside the predeclared ±3-point interval. A wide inconclusive interval is not a successful null result.
- Publish all task-level scores, negative results, declared contrasts, and exclusions. Category/difficulty/trace-coverage analyses are exploratory and must not replace the primary outcome.

Have two blinded human reviewers inspect a hash-selected 20% task subset, with balanced arm coverage and one prespecified generation replicate per task. Record artifact preference/functionality judgments and disagreements with the automated judge. This is corroboration, not permission to discard unfavorable judge scores or claim independent replication of the whole pipeline.

## 10. Fast stages and stop conditions

1. **Development gate (12 tasks):** end-to-end generation, concrete tests, feedback, repair, artifact extraction, and blinded judging work; G/T parity holds on identical traces; correct fixtures pass and each claimed invariant has a detected mutant. Fix infrastructure here, not in confirmation.
2. **Pilot (30 tasks):** test whether task-model traces map reliably to executable actions, record unknowns and feedback coverage, estimate variance and costs. Require at least 95% successful observation-adapter executions on calibration fixtures and no unresolved semantic disagreement in G/T parity tests before confirmation. These are readiness thresholds, not artifact-quality targets.
3. **Freeze:** obtain approvals, resolve all plan pins, publish/register a timestamped protocol and immutable manifest, compute N, and hash the run lock before confirmation. A locally written draft is not an external preregistration.
4. **Confirmation:** run all assigned tasks without changing the model, selector, feedback format, budgets, contracts, or scoring rules. No early stopping for a favorable p-value. Report failures and missing cells.

If a specification or oracle bug is found after freeze, retain the original result, document the defect without arm-specific outcome selection, and version an amendment. Apply any correction to all affected arms and rerun the affected complete blocks; distinguish amended from original analyses. Do not quietly replace a difficult task from the reserve list after seeing generated code.

### Workload accounting (not results)

At 30 pilot tasks × 3 initial generations: 90 initial artifacts, 270 repaired finals across B/G/T, and 1,080 requested judge ratings including initial artifacts at three ratings each. At 120 confirmation tasks: 360 initial artifacts, 1,080 finals, and 4,320 requested ratings. Cached identical artifacts may share a blinded rating batch by an arm-independent hash rule fixed in advance; report assignments and actual calls separately. These counts exclude retries and are not a budget authorization.

## 11. Parallel verification is a separate C2 experiment

Only after the adapter and quality loop are validated, compare T-serial with T-parallel on matched tasks/checkpoints and fixed inference/action caps. Do not fold the scheduling change into H2.

Parallel mode allows drafting while immutable-revision checks execute. Each feedback item and release ticket carries artifact, contract/policy, and attempt identities. A stale result may guide a later repair only if explicitly identified and replayed on the new revision; it cannot authorize it. Commit requires authoritative atomic validation (lock/CAS), not reuse of prepare-time facts. Natural and injected races remain separate test sets.

The same test selection priorities and feedback schema apply in both modes. Record actual overlap, queued/obsolete work, latency to actionable feedback, p50/p95 elapsed time, resource use, task quality, and incomplete releases. Fixed wall-time caps can change the amount of completed work; also compare at fixed completed-repair counts as a sensitivity analysis. Report all runs, with timeout values included rather than only successful completions.

A speedup claim requires lower elapsed time plus quality noninferiority within 3 points and functional noninferiority within five percentage points, with predefined paired intervals and no increase in observed release violations. Zero observed violations is not proof of deployed safety. C2 needs its own variance-based sample sizing/freeze; it is not powered by the 20 replay fixtures.

## 12. Required run ledger and implementation order

Before execution, fill the plan's unresolved model/judge IDs, versions, dataset revision, task manifest, consent/licensing disposition, resource environment, and financial cap. API credentials belong in the environment or secret store, never in the plan or logs.

Each trial ledger needs: study/arm/task/family/replicate IDs; all source and policy hashes; model fingerprints and parameters; shared-initial checkpoint hash; candidate revision hashes; every selected trace and why it was selected; observed actions/state and failures; normalized feedback; per-step usage/time; stop reason; final-artifact hash; release decision; screenshot hashes; judge inputs/responses/parse outcome; hidden-test results; and deviations. Keep append-only histories with explicit supersession, not overwritten successful rows.

Implement in this order:

1. Manifest builder, prompt-only contract representation, and fixture/hidden-oracle validation.
2. One fixed-model generation adapter and immutable candidate snapshots, under a Node/npm orchestrator.
3. Browser observation adapter plus conventional selector G; it must be useful before T is added.
4. TLA+ translation and trace selector T; concrete replay and shared feedback normalization.
5. Parity-tested benchmark rendering/judge adapter and complete trial ledger.
6. Pilot, power/freeze decision, confirmation, then optional real parallelism.

The existing [release model](../formal/agent/ReleaseGate.tla), [catalog verifier](../scripts/study-c/tlc.mjs), and [replay runner](../scripts/study-c/run.mjs) are reusable **protocol fixtures**, not implementations of steps 1–5. `npm run study:c` still runs only the synthetic pilot. `npm run build` still builds the website. No benchmark-execution command is claimed to exist yet.
