# The in-scope model

Step 1b output. Pseudocode for the fragment we will implement and check, with every
simplification mapped to the clause of `SPEC-9.7.md` it removes.

Rule: 2a implements this file exactly. If 2a needs a decision not written here, it comes back
here first.

---

## Assumptions

**A1 (load-bearing).** For each item i, the flex base size and the used minimum and maximum main
sizes are functions of item i and the container only. They never depend on a sibling.

Justification: a content-based size is the item's own min-content or max-content size measured
against available space supplied by the container. No sibling enters that computation. This is
what makes the independence question well posed at all. If bases were sibling-dependent, every
item would be coupled trivially and there would be nothing to check.

Consequence: we do not model *how* the basis is computed. It is an opaque per-item integer. This
is what keeps `flex: 0 1 auto` in scope, which matters because it is 88 percent of the corpus.

Threat: if some real case makes an item's content size depend on a sibling, A1 fails and the
result is scoped to cases where it holds. We are not aware of such a case in single-line main-axis
layout, but it is stated so a reviewer can attack it.

**A2. RELAXED at step 2c, after the first validation run.** Originally: outer size equals inner
size, margins and padding zero. That was wrong and the first validation run exposed it. Median
error was 1px but p90 was 147px, a bimodal distribution meaning the model was exact on some
containers and badly wrong on others.

Cause: the specification is explicit that step 1 sums the **outer** hypothetical main sizes and
step 4 sums the **outer** sizes. Collapsing outer to inner is a simplification the spec never
makes, and `margin` is the second most common declaration in the corpus at 7,099 occurrences.
Margins consume main-axis space directly, so ignoring them predicts correctly when they are zero
and overshoots when they are not.

Now: items carry a total main-axis margin. Steps 1, 4 and 5b use outer sizes. Clamping in step 5d
still applies to the inner size, so margin is added only where the spec says "outer". Borders and
padding remain out of scope, and remain a candidate cause if error persists.

Auto margins are excluded rather than modelled. They absorb positive free space in section 9.5,
after resolution, so they are a different mechanism and out of scope here.

**A3.** Arithmetic is exact rational in the Python model, and discretised only for the checker.
Reason: browsers use fixed-point and rounding introduces its own apparent coupling. We do not want
rounding artefacts confounding an independence result. Discretisation for the checker is a
deliberate, separately reported bound.

---

## Inputs

```
C            container inner main size, a definite positive integer
n            item count
basis[i]     flex base size                     (A1: own property)
grow[i]      flex grow factor,   >= 0
shrink[i]    flex shrink factor, >= 0
minS[i]      used min main size, >= 0           (A1: own property)
maxS[i]      used max main size, >= minS[i], may be +infinity
```

Derived:

```
hyp[i] = clamp(basis[i], minS[i], maxS[i])      # hypothetical main size
```

## Pseudocode

Step numbers in comments refer to `SPEC-9.7.md`.

```
# 1. Determine the used flex factor
if sum(hyp[i] for all i) < C:  mode = GROW
else:                          mode = SHRINK

# 2. Initialise
for all i:
    target[i] = basis[i]
    frozen[i] = false

# 3. Size inflexible items
for all i:
    factor = grow[i] if mode == GROW else shrink[i]
    if factor == 0:
        freeze(i, hyp[i])
    elif mode == GROW  and basis[i] > hyp[i]:
        freeze(i, hyp[i])
    elif mode == SHRINK and basis[i] < hyp[i]:
        freeze(i, hyp[i])

# 4. Initial free space
#    frozen items contribute target, unfrozen contribute BASIS (not target)
initialFree = C - ( sum(target[i] for frozen i) + sum(basis[i] for unfrozen i) )

# 5. Loop
while true:
    # a
    if all frozen: break

    # b
    remainingFree = C - ( sum(target[i] for frozen i) + sum(basis[i] for unfrozen i) )
    sumFactors = sum(grow[i] if mode == GROW else shrink[i] for unfrozen i)
    if sumFactors < 1:
        scaled = initialFree * sumFactors
        if abs(scaled) < abs(remainingFree):
            remainingFree = scaled

    # c
    if remainingFree != 0:
        if mode == GROW:
            totalGrow = sum(grow[i] for unfrozen i)
            for unfrozen i:
                target[i] = basis[i] + remainingFree * grow[i] / totalGrow
        else:
            for unfrozen i:
                scaledShrink[i] = shrink[i] * basis[i]
            totalScaled = sum(scaledShrink[i] for unfrozen i)
            for unfrozen i:
                target[i] = basis[i] - abs(remainingFree) * scaledShrink[i] / totalScaled

    # d
    totalViolation = 0
    for unfrozen i:
        unclamped   = target[i]
        target[i]   = clamp(target[i], minS[i], maxS[i])
        target[i]   = max(0, target[i])
        violation[i] = target[i] - unclamped
        totalViolation += violation[i]

    # e
    if   totalViolation == 0: freeze all unfrozen
    elif totalViolation >  0: freeze every unfrozen i with violation[i] > 0   # min violations
    else:                     freeze every unfrozen i with violation[i] < 0   # max violations

# 6
for all i: used[i] = target[i]
```

Note on step 5c: target is recomputed from `basis[i]` every round, not accumulated from the
previous round's target. Accumulating is a common and silent bug.

---

## Simplifications, mapped to the spec

| Simplification | Spec clause dropped | Justification and cost |
|---|---|---|
| Single flex line, no wrapping | §9.3 line breaking | Non-goal N4. Multi-line changes which items share free space, so it is a different problem, not a smaller one. Cost: excludes wrapped containers, roughly 11 percent of the corpus. Decision 0b requires reporting them as a separate bucket. |
| Main axis only | §9.4 to §9.6 cross-axis sizing | The independence question is about sharing main-axis space. Cross-axis sizing does not redistribute main space. |
| Container inner main size is definite | §9.2 `algo-available` infinite case | Removes sizing under min-content and max-content constraints. Cost: excludes intrinsically sized flex containers. |
| Basis is an opaque own-property integer | §9.2 clauses A to E | Per A1. We model the value, not its derivation. This is what keeps the default `flex: 0 1 auto` in scope. |
| No aspect ratios | §9.2 clause B, transferred size suggestion | Removes replaced-element paths. Cost: images as flex items are out of scope. |
| Outer equals inner size | box model | Per A2. Margins shift arithmetic but not the dependency structure. Worth revisiting if a counterexample looks margin-sensitive. |
| Integer or exact-rational sizes | real arithmetic | Per A3. Browsers are fixed-point anyway. Reported as a bound, not hidden. |

---

## Open implementation decisions for 2a

**D1. Division by zero in step 5c, shrink branch.** `totalScaled` is the sum of
`shrink[i] * basis[i]` over unfrozen items. If every unfrozen item has basis zero, this is zero
and the division is undefined. The spec does not address it. Decision: treat `remainingFree` as
undistributable in that case and freeze all unfrozen items at their clamped basis. Record it as a
model choice, not a spec fact, and check whether it ever fires on real data in 2c.

**D2. `maxS[i]` infinity.** Represent as `None` in Python and as a sentinel above the largest
representable size in the checker.

**D3. Floor at zero.** Step 5d floors the content-box size at zero after clamping. With A2 this is
just `max(0, target)`, applied after the min/max clamp, in that order.

**D4. Termination.** The spec asserts step 5e freezes at least one item per round. The
implementation should assert this and fail loudly rather than loop, since a silent infinite loop
here would be indistinguishable from a slow corpus run.

---

## Validation status (step 2c, completed)

**Primary oracle: Chromium, not the corpus.** Corpus validation was attempted first and hit a
ceiling at 63 percent within 2 percent, with all residual error concentrated in shrink mode.
The cause is that WebCode2M exposes partial authored CSS and observed boxes but no computed
styles, so container padding, borders, `box-sizing` and min-content are all unobservable.
Reconstructing unknown inputs and then checking against them is fitting, not testing. Browser
validation controls every input and gives exact ground truth.

**Result: 3,000 randomised cases, 100.0 percent exact** with integer flex factors. 1,859 grow
cases and 1,141 shrink cases, worst absolute difference 0.0077px, which is Chromium's 1/64px
LayoutUnit rounding. Median difference exactly zero.

**One real bug found, and only by the browser.** When the remaining free space lands on exactly
zero, step 5c is skipped, and the original implementation left the item at the value step 5d had
clamped it to in an earlier round. Chromium resets it to the flex base size. Chromium is right:
distributing zero still sets target to basis plus zero, and the spec's "if the remaining free
space is non-zero" is an optimisation rather than permission to keep a stale value. Reaching this
requires a multi-round cascade that lands on exactly zero free space, so neither the corpus nor
the six hand-computed cases could have found it. Locked in as `test_11`.

**Known divergence, precisely scoped.** With sub-unit flex factors (below 1) combined with
multi-round freezing, the model and Chromium disagree, at a rate of roughly 0.13 percent of
random cases. This is the step 5b clause that scales free space by the factor sum, interacting
with refreezing. My trace follows the spec text; Chromium leaves the item at its basis. Not
resolved. It does not affect the research question, because sub-unit flex factors are rare in
authored CSS and the coupling question concerns the default `flex: 0 1 auto` shrink path, which
is inside the 100 percent validated set. Recorded rather than hidden, and it is a genuine
instance of the spec-versus-implementation question a verification engine has to answer: you
must state which one you verify against.

---

## What the model must reproduce, as a check on 1b itself

Before trusting it, the implementation in 2a must reproduce these by hand-calculation in 2b:

1. No flexing needed: all items fit, nothing grows or shrinks.
2. Grow only: free space split by grow factors.
3. Shrink only: overflow distributed by scaled shrink factors.
4. One item clamped at its minimum, forcing a refreeze round.
5. Cascading refreeze: two rounds, where freezing one item changes the free space enough to push a
   second item into violation.
6. The sub-unit factor case from step 5b, where the sum of unfrozen factors is below one.

Case 5 is the one that distinguishes a correct implementation from a plausible one. Case 6 is the
one most likely to be silently wrong.
