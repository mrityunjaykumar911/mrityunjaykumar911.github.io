# Step 4 result: bound sensitivity, and a correction to the condition

`PROBLEM.md` §9 conceded that bounded checking proves nothing on its own, and committed to
moving the bound and reporting what broke. Something did.

---

## 1. The condition was wrong, and moving the bound is what found it

The collapsed form reported in `RESULT-3.md` compared the **raw flex base size** to the bounds:

```
v2:  (grow = 0 \/ basis >= max) /\ (shrink = 0 \/ basis =< min)
```

It was verified sound and maximal on the baseline domain, gap to the ceiling exactly zero.
That verification was real but the domain was lucky: baseline mins come from `{0, 60}` and
maxes from `{inf, 120}`, which never coincide, so `min == max` never arose and the
`FixedByBounds` clause fired **zero times**. The collapse looked lossless because the case it
lost was unreachable.

Domain D7 makes `min == max` reachable. v2 is still sound there, but it is **not maximal**: it
rejects four always-independent shapes, all of them `min = max` with the basis outside the
bounds. The smallest:

```
basis = 0, grow = 1, shrink = 0, min = 60, max = 60
```

`min = max = 60` pins this item at 60 no matter what any sibling does. v2 asks whether the raw
basis is at a bound — `0 >= 60` is false — and concludes the item can still grow.

The mistake was starting from the basis. §9.7 never uses it that way: step 3 starts from the
**hypothetical main size**, the basis already clamped by the item's own bounds, and step 5d
re-clamps to those same bounds every round. So the question is where `Hyp` sits relative to the
bounds, not where the basis does.

```
Hyp(i)           = clamp(basis(i), min(i), max(i))

CannotGrow(i)   == grow(i)   = 0  \/  Hyp(i) >= max(i)
CannotShrink(i) == shrink(i) = 0  \/  Hyp(i) =< min(i)

Immobile(i)     == CannotGrow(i) /\ CannotShrink(i)
```

`Hyp` is a function of item `i` alone, so this is still item-local, still mentions no sibling,
no container width and no grow/shrink mode. v3 is strictly weaker than v2 — it admits
everything v2 admitted, plus the `min = max` family.

The four instruments now import one definition (`facets.py`) so they cannot drift apart again.

---

## 2. The sweep

Eight domains, ground truth recomputed from scratch in each by product construction.
**3,499,776 (config, item) pairs.**

| domain | pairs | indep % | sound | maximal | covers % | residue % |
|---|---|---|---|---|---|---|
| D0 baseline | 331,776 | 42.65 | yes | yes | 97.70 | 2.30 |
| D1 fewer items, N=2 | 4,608 | 51.82 | yes | yes | 80.40 | 19.60 |
| D2 more items, N=4 | 262,144 | 57.63 | yes | yes | 75.92 | 24.08 |
| D3 more bases, none at a bound | 786,432 | 37.77 | yes | yes | 99.28 | 0.72 |
| D4 non-unit factors {0,1,3} | 1,119,744 | 35.30 | yes | yes | 78.69 | 21.31 |
| D5 width interval 16x wider | 331,776 | 43.24 | yes | yes | 96.36 | 3.64 |
| D6 coprime widths (rounding stress) | 331,776 | 42.18 | yes | yes | 98.77 | 1.23 |
| D7 `min == max` reachable | 331,776 | 62.33 | yes | yes | 90.24 | 9.76 |

**Sound on every domain. Maximal on every domain.** Under v2, D7 read `maximal: no` and
`covers: 76.87%`.

---

## 3. What is robust and what is not

This is the part worth stating precisely, because the two halves of the table behave
completely differently.

**Robust — the structural claims.** Soundness and maximality hold across every axis moved:
item count 2 to 4, base values on and off the bounds, non-unit flex factors, a width interval
16x wider, coprime widths chosen to stress rounding, and coinciding bounds. These are the
claims the design rests on, and no domain refuted them.

**Not robust — the coverage number.** `covers %` ranges from **75.92% to 99.28%** and residue
from **0.72% to 24.08%**, a 33x spread. The 97.70% in `RESULT-3.md` is a property of the
baseline domain, not of the condition, and quoting it as a constant would be wrong.

Two readable drivers:

- **Item count.** More siblings means more ways for free space to be contested, so more items
  are independent for reasons that live in the sibling set rather than in the item. Residue
  rises with N.
- **Bases sitting on bounds.** D3 chooses bases (0, 40, 90, 150) that never coincide with the
  bounds (0, 60, 120) and residue collapses to 0.72%. When a base can land exactly on a bound,
  more items are pinned for local reasons and the local condition catches them.

The corollary is that no synthetic coverage figure should be carried into the design review.
The only coverage number that means anything is the measured one: **78.15% recall on 3,844
browser-labelled real items**, with the engine-relevant figure being **28.07% of real
containers fully certified** (`RESULT-3f.md`).

---

## 4. Verification status after the correction

| claim | instrument | status |
|---|---|---|
| v3 sound, 8 domains, 3.5M pairs | `bound_sensitivity.py`, exact rationals | pass |
| v3 maximal, 8 domains | `bound_sensitivity.py` | pass |
| collapsed form = facet disjunction | TLC `CollapseAgrees` | pass |
| v3 sound on baseline, all 331,776 states | TLC `Sound` | pass, 8 min 21 s |
| maximality certificate, 28 witnesses | TLC `FlexWitness` | pass, 2 s |
| v3 precision on real pages | `score_immobile.py`, 3,004 admits | **100.00%**, 0 false admits |
| v3 recall on real pages | 3,004 / 3,844 | 78.15% |
| model fidelity vs Chromium | 34,078 / 34,086 at 0.5px | 99.98% |

Recall moved 78.12% → 78.15% (+1 item) and `F2 FixedByBounds` went from 0 to 31 admissions.
The correction is nearly invisible on real pages because `min == max` is rare in authored CSS.
That is not a reason it did not matter: v2 was making a claim it could not support, and only
moving the bound exposed it.

---

## 5. Remaining

- Step 5: write `RESULT.md` as the consolidated design review, with the decomposable-surface
  objective from `PROBLEM.md` §3 as the headline and the container rate, not the item rate, as
  the number quoted first.
- `RESULT-3.md` §1 and §3 still state the v2 predicate and its 97.70% coverage as final.
  Superseded by this document; to be folded in during step 5.
