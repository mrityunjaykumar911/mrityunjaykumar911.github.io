# Step 3f result: Immobile scored against real pages

Corpus: 1,200 WebCode2M pages, Chromium, six widths 320/480/768/1024/1280/1920, bidirectional
perturbation, container pinned on both axes. 2,493 flex containers measured at every width;
238 dropped as degenerate (zero inner main size); **2,255 containers, 5,681 items** scored.

| | value |
|---|---|
| GATE 1 fidelity — model reproduces browser | **99.98%** (34,078/34,086 at 0.5px) |
| GATE 2 precision — admits that were truly independent | **100.00%** (3,003/3,003) |
| recall — of browser-independent items, admitted | **78.12%** (3,003/3,844) |
| items browser-labelled independent across interval | 67.66% (3,844/5,681) |
| containers where every item is independent | 45.76% (1,032/2,255) |
| **containers where every item is CERTIFIED** | **28.07%** (633/2,255) |
| node-weighted decomposable surface | **30.01%** (1,705/5,681 items) |

Both gates pass. Zero false admits across 3,003 admissions is the number that matters most:
`Immobile` was proved sound against `MODEL.md` on a synthetic domain, and it stayed sound on
real pages that nothing in its derivation ever saw.

---

## 1. Read the last two rows, not the first ones

Precision 100% and recall 78% are properties of the *condition*. **28.07%** is the property of
the *engine*, and it is the number a reviewer should be handed first.

A compositional engine gets no partial credit inside a container. If one item out of four is
coupled, the container's layout is not decomposable and it must be verified monolithically;
the three certified items buy nothing. So the per-item rate (52.86% of all items admitted)
overstates the usable result by roughly 23 points against the container rate.

The honest summary is: **on real pages, a bit over a quarter of flex containers can be
discharged compositionally with a four-literal item-local check, and the check never lies.**

The gap from 28.07% to the 45.76% ceiling is what a better *local* condition could not close
either — the ceiling itself is measured, not assumed, and Step 3c proved `Immobile` is already
the weakest sound locally-evaluable condition. Closing that gap requires leaving locality,
which means a container-level fact that is provably sibling-independent, and the only obvious
candidate (the grow/shrink mode) is provably not one.

---

## 2. Corrections to previously reported numbers

**Independence across the interval was 73.26%. It is 67.66%.** The earlier figure came from
`perturb.py`, whose instrument had three defects, all found by the fidelity gate:

1. **Unpinned container.** A content-sized container (column flex with auto height,
   inline-flex, shrink-to-fit) resizes when a child's content changes, and then *every* child
   moves — through the container's size, not through sibling coupling. The engine's contract
   takes the container's inner main size as given, so that movement is out of scope by
   construction. Verified on page 7 container 2: emptying child 3 shrank the container
   333.7 → 293.6 and moved children 1 and 2. This direction *under*-reports independence.
2. **Unpinned cross axis.** Same failure one axis over: a 300px probe widens a content-sized
   container, which changes an item's cross size, which changes its content-based main size and
   its automatic minimum size. Both axes are now pinned, and pinning is asserted to be inert
   before any reading is taken.
3. **CSS transitions.** This one is worth stating plainly because it silently invalidated
   everything. A running transition sits *above* author `!important` and inline `!important`
   in the cascade. On a page with `transition: all`, every property a probe sets lands in the
   style attribute, starts a transition from the old value, and reads back **the old value**.
   Demonstrated on page 638: `color: rgb(1,2,3) !important` read back as the author's colour.
   The probes were measuring unmodified elements and the labels were read mid-transition.
   Transitions and animations are now disabled before anything is measured.

Net effect of the fixes: 1 and 2 raised independence, 3 and the degenerate-container filter
lowered it. 67.66% is the corrected value.

---

## 3. What the fidelity gate caught in the model

Gate 1 is a correctness gate on the instrument, and it earned its place. Fidelity went
98.07% → 99.98% through four attributed fixes, none of which changed the condition:

| defect | signature | fix |
|---|---|---|
| flex `gap` absent from the model | total off by exactly `(n-1) x gap` | subtract main-axis gaps from the container's inner size, per step 1 |
| border-box bases fed to a content-box algorithm | **equal and opposite** errors between siblings — total right, split wrong | the scaled shrink factor is `shrink x INNER basis`; convert and move padding+border into the outer term |
| degenerate containers | predicted nonzero, browser zero | drop containers with zero inner main size — they carry no layout |
| anonymous flex items | browser fits into *less* space than modelled | bare text inside a flex container becomes a flex item that `el.children` cannot see; skip those containers rather than guess its properties |

Remaining residual: **8 observations in 2 containers (0.02%)**, both `<svg>` items. A replaced
element with an intrinsic aspect ratio has its main size coupled to its cross size through the
ratio rather than through §9.7. That is a declared non-goal in `MODEL.md`, not a new defect.
Reproduce with `python diag_item.py --page 158 --idx 0 --width 320`.

---

## 4. Which facet actually pays

| facet | admits | share |
|---|---|---|
| F3 ShrinkFloor — `grow=0 /\ basis =< min` | 2,733 | 91.0% |
| F1 Inflexible — `grow=0 /\ shrink=0` | 270 | 9.0% |
| F2 FixedByBounds, F4 GrowCeiling | ~0 | negligible |

Nine tenths of everything the engine can certify comes from one clause: **an item that cannot
grow and is already sitting on its content-based minimum.** That is the default
`flex: 0 1 auto` item whose content has been squeezed to its min-content floor, which is what
most real flex children are.

This is the finding that inverts the project's own earlier proxy. The CSS-parsing pass marked
every `flex: 0 1 auto` item as coupled because it *can* shrink, and reported 1.1%. It can
shrink; it mostly already has. The distinction is invisible to a parser and requires either
the resolved automatic minimum size or a browser, which is why measurement replaced parsing.

## 5. What is still open

- **Recall gap, 841 items.** The largest missed shape is `grow=0, shrink>0, not at min, not at
  max` (603 items): items with genuine slack that happen not to move. Independent *here*,
  coupled *there* — the residue class, unreachable by any local condition. Consistent with the
  2.30% synthetic residue being much larger on real pages, as predicted.
- **Corpus bias, stated.** External images are blocked, so `<img>` without intrinsic
  dimensions collapses to alt-text size. This corpus under-represents image-driven flex bases.
  Labels and inputs are read from the same rendered page, so the two always agree about the
  content; the bias is in what the corpus contains, not in the measurement.
- **`flex-wrap` excluded.** 6,067 container-width observations skipped. Multi-line flex is a
  separate problem and a declared non-goal.
- Bound sensitivity (step 4) and the write-up of the engine design (step 5) are unstarted.
