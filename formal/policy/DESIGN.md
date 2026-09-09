# Disclosure verification for published web artifacts

A design review. Worked example: `mrityunjaykumar911.github.io`.

---

## 0. What this is, and what it is not

**Not a new mechanism.** The core is lattice-based information flow control, which is
Denning 1976. Applying IFC to systems that assemble content from mixed-trust sources is a
crowded area right now: APPA (arXiv 2607.24625), AgentFlow (2608.22868), SPA (2608.27234),
GIF (2606.23277), the LLMbda calculus (2602.20064), CIV (2508.09288). CONTINUITY
(2609.05269) in particular models components with assume-guarantee contracts and composes
them, which is the same shape as what is below.

The one structural difference is worth stating precisely, because it is a difference in
*where* the check runs and not in the theory. Every system above tracks flow through a
**runtime** — tokens, tool calls, memory. This checks the **artifact**, after the build, from
the bytes, trusting no labels the generator produced. That is a weaker claim (it sees only
what got emitted, not why) and a more robust one (it survives a generator that lies, is
mislabelled, or was replaced by an LLM last Tuesday).

**The contribution of this document is the design and the honesty of its accounting**, not
the mechanism: which sinks exist, where labels come from, what may count as a declassifier,
what the check cannot see, and what it cost. Two real defects in the worked example fell out
of building it, and both are of a kind that a careful 150-assertion test suite structurally
cannot catch.

---

## 1. The problem

`formal/README.md` in the worked example states the gap in its own words:

> "It does not prove that the Astro implementation refines the model automatically;
> Playwright and workflow checks are the executable refinement boundary."

Concretely, that repository has:

- `ResumePublication.tla`, 7 variables, 5 safety invariants, 3 mutants. Sound, small, and it
  abstracts every kind of private content into one boolean, `content = "localDetail"`.
- ~150 Playwright assertions, of which a large fraction are disclosure properties written as
  string matching: `expect(publishedHtml).not.toContain('<profile-email>')`,
  `expect(context).not.toMatch(/mailto:/i)`, four preview-only markers that must not appear.
- A markdown table mapping model states to implementation files, maintained by hand.

Nothing checks that the table is complete, that every model transition is exercised, or that
the sink set the tests cover is the sink set the build emits. The abstraction gap and the
enumeration gap are both unmanaged, and each produced a real defect.

---

## 2. Design

### 2.1 One policy, two checkers

`policy.json` is the single description. Two things read it and must agree:

```
policy.json ──> gen_policy_tla.py ──> Policy*.tla ──> TLC     (is the policy coherent?)
            └─> check_artifacts.py ────────────────> dist/    (does the build obey it?)
```

Neither half suffices, and the reason is the whole design:

- The **model** quantifies over the declared sink set, so it can state properties about sinks
  *as a set* — including that every published sink is audited at all. It cannot see a single
  byte of output.
- The **checker** reads real bytes and cannot be fooled by a mislabelled generator. It can
  only ever speak for sinks it was pointed at.

The gap between them is exactly the refinement gap, and generating both from one file is what
keeps it from reopening.

### 2.2 The lattice

Audience is a total order, `public < flagged < local`. PII is an orthogonal flag. A label is
the pair; join is componentwise. Sources carry labels, sinks carry clearances, and the
property is the obvious one:

```
SinkWithinClearance ==
    \A k \in published :
        /\ Rank(ContentAud(k)) =< Rank(Clearance[k])
        /\ ContentPII(k) => SinkAllowsPII[k]
```

`NoPrivateInProduction` from the old model is the single instance of this where
`Clearance = "public"` and the source is the local overlay.

### 2.3 Declassification is a declared set, never a transformation

This is the load-bearing decision. A source is declassified at a sink only by being listed in
the policy. No transformation earns it automatically.

**An encoding is not a declassifier.** Reversing a string, base64, HTML entities, percent
encoding, splitting across attributes — all preserve the information, so all preserve the
label. Only transformations that destroy information may be declared: dropping the field,
truncating to a non-identifying prefix, replacing an address with a form endpoint.

Nothing downstream can tell the difference by looking at bytes, which is why it must be
written down rather than inferred.

### 2.4 Three concrete checks

| | what it does | what it caught |
|---|---|---|
| **C1** | walk `dist/`, report every publishable file the policy does not enumerate | the executable form of `PublishedSinksAreAudited` |
| **C2** | search each sink for each PII source under *every* listed encoding | **F1** |
| **C3** | re-check declared declassifications and fail if the content is still detectable | keeps `policy.json` from becoming a suppression file |

C3 is the property worth arguing for. Declaring a declassification you did not implement does
not silence the checker; it converts a quiet `LEAK` into a louder `DISHONEST`. Demonstrated
below.

---

## 3. Findings on the worked example

### F1 — the email is in the published HTML, reversed

```html
<a href="#contact-email" id="contact-email" data-email-reversed="moc.liamg@esc.yajm">
```

Present in `dist/index.html` and `dist/latest.html`. The governing assertion is

```js
expect(publishedHtml).not.toContain('<profile-email>');   // passes
```

It passes because the test checks a *representation*. The information is intact and recovered
by `.split('').reverse().join('')`. Note that the same policy is enforced by *regex* at
`llms.txt` and by *literal match* at `index.html` — one sink is defended against a class,
the other against a string.

C2 catches it because the policy lists `reversed` among the encodings for `profile_email`,
and the label survives every encoding by construction.

### F2 — two published PDFs that no assertion opens

`dist/cv/MrityunjayKumar-CV.pdf` contains the email and a phone number. The suite works hard
to keep phone numbers out — a regex on the legacy CV HTML route, another on `llms.txt` — and
`llms.txt` states it "intentionally excludes personal contact details and private employment
records". The PDF is linked, shipped, and outside the enumerated sink set.
`dist/research/executable-evidence-public-resumes.pdf` likewise.

**Severity, stated honestly.** This is not a breach. A CV is contact material; the email is
probably there on purpose. The defect is that the *stated* policy is enforced inconsistently
across sinks, because tests cover the sinks somebody remembered. In the fixed policy `cv_pdf`
carries `allows_pii: true` with a written reason, which is the correct outcome: the engine's
job was to force the decision to be made once and recorded, not to make it.

### Both, reproduced mechanically

`PolicyCurrent` encodes the repository as it actually is, and TLC refutes it:

```
Error: Invariant Safety is violated.
State 2:  published = {"cv_pdf"}
```

The checker, on real bytes:

```
--- C2  PII-labelled content reaching a sink that does not allow it ---
    LEAK  dist/index.html                   <- profile_email  as reversed
    LEAK  dist/latest.html                  <- profile_email  as reversed
    LEAK  dist/cv/MrityunjayKumar-CV.pdf    <- profile_email  as literal
    LEAK  dist/cv/MrityunjayKumar-CV.pdf    <- profile_phone  as literal
--- declared sinks outside the audited set ---
    cv_pdf, paper_pdf
RESULT: FAIL
```

And running the *fixed* policy against the *unfixed* code, to show C3 working:

```
--- C3  declassifications the artifact does not honour ---
    DISHONEST  dist/index.html   claims profile_email declassified, still present as reversed
    DISHONEST  dist/latest.html  claims profile_email declassified, still present as reversed
```

---

## 4. Non-vacuity, and two vacuity bugs found along the way

The previous model established a convention: every invariant must have a mutant that
produces a counterexample. Keeping it caught two real problems in this model.

**Vacuity bug 1 — spec mutants prove nothing here.** The first attempt mutated the
transition relation: publish without auditing, audit ignoring PII, publish with no audit.
All three passed. The reason is structural: these invariants are properties of the
**policy-artifact pair**, not of the transition relation, so against a clean policy removing
a guard exposes nothing. Mutation had to move to the policy.

**Vacuity bug 2 — `ProdCarriesNoLocal` was a tautology.** It read:

```tla
ActiveFlows(k) == IF mode = "prod" THEN Flows[k] \ LocalSources ELSE Flows[k]
ProdCarriesNoLocal == mode = "prod" => \A k : ActiveFlows(k) \cap LocalSources = {}
```

The definition removes exactly what the invariant then asserts is absent. It could not fail.
`ResumePublication.tla` has the same latent flaw: `OpenPreview` branches on `mode`, so
`NoPrivateInProduction` can only restate the branch. **Both models were assuming the thing
they claimed to prove.**

The fix makes the guard a policy constant, `StripsLocal`, corresponding to one expression in
`src/data/resume.ts`:

```ts
const overlay = import.meta.env.DEV && localOverlay ? localOverlay : publicOverlay;
```

Every disclosure guarantee of the built site rests on that ternary, so the model now names it
and a mutant can delete it.

Final state, all three invariants independently falsifiable:

| instance | result | invariant | witness |
|---|---|---|---|
| `PolicyCurrent` (the real repo) | VIOLATION | Safety | `cv_pdf` |
| `PolicyFixed` | PASS | — | — |
| mut-unaudited (drop CV PDF from audited) | VIOLATION | PublishedSinksAreAudited | `cv_pdf` |
| mut-piiblind (drop the declassification) | VIOLATION | SinkWithinClearance | `index_html` |
| mut-localleak (delete the DEV guard) | VIOLATION | ProdCarriesNoLocal | `index_html` |

---

## 5. What it cannot do

Stated up front, because a design review that only lists strengths is not one.

- **Semantic disclosure is out of reach.** The checker finds a known value under a known
  encoding. It will not notice that a paragraph paraphrases something confidential, or that
  three public facts compose into a private one. Every honest IFC system has this boundary;
  this one has it at the artifact rather than the runtime.
- **Labels are hand-assigned.** `policy.json` says `resume.local.yaml` is `local`. Nothing
  derives that. A mislabelled source is verified against the wrong clearance, silently.
- **Flows are declared, not inferred.** No dataflow analysis of the Astro build; the
  `flows` field is written by hand. A component that starts reading a new source and is not
  added to `flows` is invisible. Inferring flows from the build graph is the obvious next
  increment and is not done here.
- **Images and fonts are skipped**, so PII in a screenshot or an EXIF field is not seen.
- **Only what the build emits.** A page rendered client-side from an API the checker never
  calls is outside the scope entirely. The worked example is static, which is why it is a
  fair example and also why it is an easy one.
- **The audience lattice is three points.** Real disclosure policies have per-recipient
  clearances. Nothing here breaks at that scale, but nothing here demonstrates it either.

---

## 6. Cost

| | |
|---|---|
| model check, all five instances | ~8 s total, TLC, one core |
| artifact check over `dist/` | under 2 s, 15 files including two PDFs |
| policy file | 12 sinks, 5 sources, ~200 lines of JSON |
| new code | `Disclosure.tla` 200 lines, `gen_policy_tla.py` 165, `check_artifacts.py` 200 |

Cheap enough to run on every commit, which matters: a check that runs in CI catches the sink
you added last week, and a check that runs quarterly does not.

---

## 7. What this replaces

`ResumePublication.tla` is retired. `NoPrivateInProduction`, `PreviewIsNoIndex`,
`BuildRequiresValidation` and `DeployRequiresValidatedBuild` become instances of
`SinkWithinClearance` and `PublishRequiresAudit` over a declared sink set, with the
indexability axis foldable into the lattice as a second orthogonal flag (not done here; it is
the same construction as PII and adds nothing to the argument).

The Playwright suite stays. It checks things this does not — accessibility roles, navigation,
metadata correctness, that the analytics beacon fires. What it should stop doing is
hand-rolling disclosure assertions per sink, since that is the part that was inconsistent
across sinks and silent about the sinks it forgot.

---

## 8. Open, in order

1. **Infer `flows` from the Astro build graph** instead of declaring them. This is the
   largest remaining source of unsoundness and the one a reviewer will press on first.
2. **Fold indexability into the lattice**, retiring the rest of the old model.
3. **Partition the existing 150 Playwright assertions** into: implied by the policy, not
   expressible as flow, and disclosure assertions that should be deleted as redundant. The
   third bucket is the maintenance saving and is currently unmeasured.
4. **Wire into `deploy.yml`** ahead of the build job, so `PublishRequiresAudit` is enforced
   rather than modelled.
