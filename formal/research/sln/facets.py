#!/usr/bin/env python3
"""
The admissibility condition, in one place, so the TLA+ model, the exhaustive searches, the
bound-sensitivity sweep and the browser scorer cannot drift apart.

HISTORY, because the correction matters more than the final form.

v1  Four separately-named facets: Inflexible, FixedByBounds, ShrinkFloor, GrowCeiling.
v2  Collapsed to  (grow=0 \/ basis >= max) /\ (shrink=0 \/ basis =< min).
    Verified sound and MAXIMAL on the baseline domain, gap to the ceiling exactly 0.
v3  Bound sensitivity (step 4) refuted v2's maximality. On a domain where min == max is
    reachable, four always-independent shapes are rejected, e.g.

        basis=0, grow=1, shrink=0, min=60, max=60

    min == max pins this item at 60 whatever happens around it, but v2 asks whether the RAW
    basis is at a bound -- 0 >= 60 is false -- so it rejects. The baseline domain hid this
    because its mins {0,60} and maxes {inf,120} never coincide, so FixedByBounds fired zero
    times there and the collapse looked lossless.

    The error was comparing against the raw flex base size. Section 9.7 never uses it that
    way: step 3 works from the HYPOTHETICAL main size, which is the basis already clamped by
    the item's own bounds, and step 5d re-clamps to the same bounds every round. So the
    question "can this item move" is a question about where the hypothetical size sits
    relative to the bounds, not where the basis does.

v3 is strictly weaker than v2 (it admits everything v2 admits, and more), still reads only
the item's own properties, and still mentions neither the siblings, the container width, nor
the grow/shrink mode.
"""

from fractions import Fraction as F


def hyp(basis, minS, maxS):
    """Hypothetical main size: flex base size clamped by the item's own used min and max,
    floored at zero. This is what step 3 of 9.7 actually starts from."""
    v = basis
    if maxS is not None and v > maxS:
        v = maxS
    if v < minS:
        v = minS
    return v if v > 0 else (minS if minS > 0 else v * 0)


def cannot_grow(basis, grow, shrink, minS, maxS):
    """Growth is blocked: either there is no grow factor, or the item already sits at its
    own maximum, so distributing positive free space to it changes nothing."""
    if grow == 0:
        return True
    return maxS is not None and hyp(basis, minS, maxS) >= maxS


def cannot_shrink(basis, grow, shrink, minS, maxS):
    """Shrinkage is blocked: either there is no shrink factor, or the item already sits at
    its own minimum, so taking negative free space from it changes nothing."""
    if shrink == 0:
        return True
    return hyp(basis, minS, maxS) <= minS


def immobile(basis, grow, shrink, minS, maxS):
    """ADMISSIBLE. The item cannot move in either direction, so its used main size is
    invariant under any change to a sibling, at any container width."""
    return (cannot_grow(basis, grow, shrink, minS, maxS) and
            cannot_shrink(basis, grow, shrink, minS, maxS))


def immobile_tuple(it):
    """it = (basis, grow, shrink, min, max), max None meaning no maximum."""
    return immobile(it[0], it[1], it[2], it[3], it[4])


def which_facet(it):
    """Which named clause explains this admission. For reporting only; the condition itself
    is the single predicate above."""
    b, g, s, mn, mx = it
    h = hyp(b, mn, mx)
    at_max = mx is not None and h >= mx
    at_min = h <= mn
    if g == 0 and s == 0:
        return "F1 Inflexible"
    if mx is not None and mn == mx:
        return "F2 FixedByBounds"
    if g == 0 and at_min:
        return "F3 ShrinkFloor"
    if at_max and s == 0:
        return "F4 GrowCeiling"
    return None
