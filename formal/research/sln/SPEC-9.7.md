# CSS Flexible Box Layout: the algorithm we are modelling

Step 1a output. Source: [W3C CSS Flexible Box Layout Module Level 1, section 9.7](https://www.w3.org/TR/css-flexbox-1/#resolve-flexible-lengths),
from [`w3c/csswg-drafts`](https://github.com/w3c/csswg-drafts/blob/main/css-flexbox-1/Overview.bs).
The excerpt is attributed under the [W3C Document License](https://www.w3.org/copyright/document-license-2023/).

Quoted verbatim with the specification's own step numbering preserved. Markup stripped, wording
untouched. Analysis is confined to the last section and is clearly marked as hypothesis.

---

## Section 9.7 Resolving Flexible Lengths (verbatim)

To resolve the flexible lengths of the items within a flex line:

1. **Determine the used flex factor.** Sum the outer hypothetical main sizes of all items on the
   line. If the sum is less than the flex container's inner main size, use the flex grow factor
   for the rest of this algorithm; otherwise, use the flex shrink factor.

2. Each item in the flex line has a **target main size**, initially set to its flex base size.
   Each item is initially *unfrozen* and may become *frozen*.

   > Note: An item's target main size doesn't change after freezing.

3. **Size inflexible items.** Freeze, setting its target main size to its hypothetical main
   size:
   - any item that has a flex factor of zero
   - if using the flex grow factor: any item that has a flex base size greater than its
     hypothetical main size
   - if using the flex shrink factor: any item that has a flex base size smaller than its
     hypothetical main size

4. **Calculate initial free space.** Sum the outer sizes of all items on the line, and subtract
   this from the flex container's inner main size. For frozen items, use their outer target main
   size; for other items, use their outer flex base size.

5. Loop:

   a. **Check for flexible items.** If all the flex items on the line are frozen, exit this loop.

   b. **Calculate the remaining free space** as for initial free space, above. If the sum of the
      unfrozen flex items' flex factors is less than one, multiply the initial free space by this
      sum. If the magnitude of this value is less than the magnitude of the remaining free space,
      use this as the remaining free space.

   c. If the remaining free space is non-zero, **distribute it proportional to the flex
      factors**:

      - *If using the flex grow factor.* For every unfrozen item on the line, find the ratio of
        the item's flex grow factor to the sum of the flex grow factors of all unfrozen items on
        the line. Set the item's target main size to its flex base size plus a fraction of the
        remaining free space proportional to the ratio.

      - *If using the flex shrink factor.* For every unfrozen item on the line, multiply its flex
        shrink factor by its inner flex base size, and note this as its **scaled flex shrink
        factor**. Find the ratio of the item's scaled flex shrink factor to the sum of the scaled
        flex shrink factors of all unfrozen items on the line. Set the item's target main size to
        its flex base size minus a fraction of the absolute value of the remaining free space
        proportional to the ratio.
        > Note this may result in a negative inner main size; it will be corrected in the next
        > step.

   d. **Fix min/max violations.** Clamp each non-frozen item's target main size by its used min
      and max main sizes and floor its content-box size at zero. If the item's target main size
      was made smaller by this, it's a max violation. If the item's target main size was made
      larger by this, it's a min violation.

   e. **Freeze over-flexed items.** The total violation is the sum of the adjustments from the
      previous step `∑(clamped size - unclamped size)`. If the total violation is:
      - Zero: Freeze all items.
      - Positive: Freeze all the items with min violations.
      - Negative: Freeze all the items with max violations.

      > Note: This freezes at least one item, ensuring that the loop makes progress and
      > eventually terminates.

   f. Return to the start of this loop.

6. Set each item's used main size to its target main size.

---

## Supporting definitions (verbatim)

**Flex base size**, from section 9.2 step `algo-main-item`, clauses A through E. The clause that
matters for our in-scope fragment:

> A. If the item has a definite used flex basis, that's the flex base size.

> When determining the flex base size, the item's min and max main sizes are ignored (no clamping
> occurs).

**Hypothetical main size**, same section:

> The hypothetical main size is the item's flex base size clamped according to its used min and
> max main sizes (and flooring the content box size at zero).

**Automatic minimum size**, section 4.5:

> To provide a more reasonable default minimum size for flex items, the used value of a main axis
> automatic minimum size on a flex item whose computed `overflow` value is non-scrollable is its
> content-based minimum size; for main-axis scroll containers the automatic minimum size is zero,
> as usual.

> For non-replaced elements: Use the larger of the content size suggestion and the transferred
> size suggestion (if one exists), capped by the specified size suggestion (if one exists).

> **content size suggestion**: the min-content size in the main axis.

> **specified size suggestion**: If the item's preferred main size is definite and not automatic,
> then the specified size suggestion is that size.

This is why the automatic minimum matters for us: for a typical non-replaced flex item with no
specified width, the used minimum main size is its **min-content size**, which is a property of
that item's own content.

---

## Candidate independence mechanisms

Hypotheses to be resolved in step 3. **None of these are conclusions.** They are the places in
the algorithm where sibling-independence might arise, written down so the model checker has
concrete targets and so a reviewer can see what we expected before we checked.

**C1. Zero flex factor.** Step 3 freezes any item with a flex factor of zero, setting its target
main size to its hypothetical main size. Hypothetical main size is the item's own flex base size
clamped by its own min and max. All own properties. This should be sibling-independent, and it is
what the corpus proxy already assumed. One correction to the proxy: the frozen value is the
*hypothetical* main size, not the flex base size, so an item with a zero factor and a basis below
its minimum settles at its minimum, not its basis.

**C2. Basis outside the item's own min/max.** Step 3 also freezes, when shrinking, any item whose
flex base size is smaller than its hypothetical main size. Since hypothetical main size is the
basis clamped to the item's own range, "basis smaller than hypothetical" means the basis is below
the item's own minimum. Such an item freezes immediately at its own minimum, regardless of its
shrink factor. Symmetrically when growing, an item whose basis exceeds its own maximum freezes at
its maximum. **This is the case the corpus proxy missed.** Caveat: whether grow or shrink is in
use comes from step 1, which sums all items' hypothetical main sizes against the container, so it
is sibling-dependent. C2 is therefore conditional on the mode, not unconditional.

**C3. Clamped at minimum through step 5.** Step 5e freezes min-violating items only when the
total violation is positive, and the total violation is summed across all items, so the *decision*
is sibling-dependent. But the *value* an item is clamped to is its own minimum. So an item that
ends clamped at its minimum has a sibling-independent size, while whether it ends there is
sibling-dependent. This forces the independence property to be stated over a perturbation range:
item i is independent if it stays clamped across the whole range, not at a single point.

**C4. The sub-unit flex factor clause.** Step 5b scales the free space when the sum of unfrozen
flex factors is below one. This interacts with clamping in ways that are not obvious by
inspection, and is a likely source of counterexamples.

**Implementation trap to carry into step 2a.** Step 4 and step 5b compute free space using the
outer *target* main size for frozen items but the outer *flex base size* for unfrozen ones, not
their current target. Getting this wrong produces a model that converges to plausible but wrong
sizes, which the corpus validation in 2c should catch.

---

## Simplifications for the in-scope model

Recorded here, to be justified in `MODEL.md` at step 1b.

- Single flex line. No wrapping. Non-goal N4.
- Main axis only.
- Container has a definite inner main size, so section 9.2 clause A gives the flex base size
  directly and the infinite-available-space clauses D and E do not apply.
- No aspect ratios, so the transferred size suggestion never exists and clause B does not apply.
- Outer size equals inner size. Margins, borders and padding are zero.
- Sizes are integers.
