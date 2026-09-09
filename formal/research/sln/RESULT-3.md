# Step 3 result: the admissibility condition, and its maximality

Status: **closed on the synthetic domain.** Open on the real corpus (step 3f below).

---

## 1. The condition

An engine may certify a flex item's used main size as independent of its siblings, across the
whole viewport interval, exactly when the item cannot move in either direction:

```
CannotGrow(i)    ==  grow(i) = 0    \/  basis(i) >= max(i)
CannotShrink(i)  ==  shrink(i) = 0  \/  basis(i) =< min(i)

Immobile(i)      ==  CannotGrow(i)  /\  CannotShrink(i)
```

Four literals. It reads only item `i`'s own declared properties. It does not read a sibling,
it does not read the container width, and it does not read the grow/shrink mode.

The mode's absence is the load-bearing part. `Growing(cfg, C)` sums *every* item's
hypothetical size, so a sibling can flip it. TLC refuted a mode-conditioned candidate in two
seconds (counterexample recorded in `FlexFacets.tla`). Because `Immobile` never mentions the
mode or the width, width-independence across the interval is free: the condition is invariant
over the interval by construction, not by checking each width.

Distributing the disjunction recovers the four facets, so this is one predicate wearing four
hats rather than four separate discoveries:

| distributed clause | facet |
|---|---|
| `grow=0 /\ shrink=0` | Inflexible |
| `grow=0 /\ basis=<min` | ShrinkFloor |
| `basis>=max /\ shrink=0` | GrowCeiling |
| `basis>=max /\ basis=<min` | FixedByBounds |

---

## 2. What was proved, and by what

Domain: `N=3`, bases `{0,60,120}`, factors `{0,1}`, mins `{0,60}`, maxes `{inf,120}`, widths
`{120,240,360}`. 48 item shapes, 110,592 configs, **331,776 (cfg, item) pairs**. Ground truth
is the product construction: item `i` is independent iff its used size is unchanged under
every admissible change to any sibling's flex base size, at every width.

| claim | value | instrument | time |
|---|---|---|---|
| independent, ground truth | 141,492 / 331,776 = **42.65%** | `facet_search.py` | 49 s |
| unsound admits | **0** | `facet_search.py` | — |
| collapsed form = facet disjunction | holds on all 331,776 states | TLC `CollapseAgrees` | in the 8m21s run |
| soundness | no violation | TLC `Sound`, `flexfacets-sound.cfg` | 8 min 21 s |
| completeness deliberately false, witness found | shape `basis=60 grow=0 shrink=1 min=0 max=120` | TLC `Complete` | 33 s |
| coverage of independent items | 138,240 / 141,492 = **97.70%** | `facet_search.py` | — |
| **maximality** | 28/28 rejected shapes have a coupling witness | `FlexWitness.tla`, TLC | **1.2 s** |
| irreducible residue | 3,252 / 141,492 = **2.30%** | `facet_maximal.py` | 47 s |

TLC's completeness witness and Python's top unexplained shape are the same shape, found
independently. That is the cross-check.

---

## 3. Why maximality is the result, not soundness

Soundness alone is unfalsifiable as a contribution. A reviewer asks "why not a weaker
condition?" and a soundness proof has no answer. `grow=0 /\ shrink=0 /\ basis=0` is also
sound and admits almost nothing.

The maximality argument is short because locality does the work. A locally-evaluable
condition sees only the item's shape, so it must treat every context carrying that shape
alike. Therefore:

> a shape is admissible by **some** sound local condition
> **iff** every `(cfg, item)` pair carrying that shape is independent.

So the union of always-independent shapes is the *unique* weakest sound locally-evaluable
condition. It is a ceiling, not a heuristic. Computing it gives:

- 48 shapes total
- 20 **always** independent — the ceiling
- 12 **sometimes** independent — unreachable by any local condition, ever
- 16 **never** independent

and `Immobile` admits exactly those 20. **Gap to the ceiling: 0 shapes, 0 pairs.**

`FlexWitness.tla` turns that into a certificate TLC checks mechanically: for each of the 28
rejected shapes it carries a concrete config plus a one-item basis edit that moves it, and
asserts both `Maximal` (each witness really is coupled) and `WitnessesRejected` (we do not
admit any of them). One state, 1.2 seconds. The maximality argument is now machine-checked
rather than asserted in prose.

---

## 4. The residue is the honest cost of locality

2.30% of independent items carry a shape that is independent *here* and coupled *there*. The
biggest group is `basis=60, grow=0, shrink=1, min=0, max=*` — independent in 768 of 6,912
contexts (11%). It is at neither bound and it can shrink, so whether it moves depends
entirely on whether the container has slack. No condition restricted to the item's own
properties can distinguish those cases, because the distinguishing information is in the
siblings.

That number is the price of the locality constraint, stated as a bound rather than hidden.
Buying it back requires a container-level fact that is itself sibling-independent, and
`Growing(cfg,C)` is provably not one. This is a real limit, not a gap to be closed later.

---

## 5. Correction to the record

I previously told you the `-Heap 16g -Workers 8` run was "hours, not minutes" and to kill it.
That was wrong. It finishes in **8 min 21 s** at 8 workers and reports no violation. The
"Computed 65536 initial states" line is TLC's state-generation progress marker doubling as it
goes; the invariant evaluation had not started yet.

Both instruments were still worth having. TLC gave the mechanised counterexamples and the
maximality certificate. Python gave the ceiling, which TLC cannot express as an invariant
because it is a property of the whole state space rather than of any one state.

---

## 6. Next: step 3f, the only step that can still falsify this

Everything above is on a synthetic domain with three bases and three widths. It says the
condition is optimal *given the algorithm*. It says nothing about how often the condition
fires on real pages.

The test is to score `Immobile` against the **1,309 browser-labelled items** from
`perturb.py` (250 pages, 519 containers, 320–1920 px, bidirectional perturbation, 73.26%
independent across the interval).

Two numbers decide it:

- **precision** — of the items `Immobile` admits, how many did the browser label independent?
  This must be 100%. Anything less means the model, the extraction, or an assumption is wrong,
  and the failure is a bug report against `MODEL.md`, not an accuracy figure.
- **recall** — of the 959 browser-independent items, how many does `Immobile` admit? The
  synthetic ceiling was 97.70%, but real pages skew heavily toward `flex: 0 1 auto`, which is
  the residue shape. Recall could plausibly land far lower.

`perturb.py` currently records only geometry, not declared properties, so it must re-run with
`flex-grow`, `flex-shrink`, `flex-basis`, `min-width`/`min-height`, `max-width`/`max-height`
and the resolved automatic minimum size captured per item. That is step 3f.

If recall on real pages is low, the honest conclusion is that the condition is optimal and the
fragment is thin, and the engine's contribution becomes the coupled-container summary. That
outcome is written into the gate in `STEPS.md` and stands.
