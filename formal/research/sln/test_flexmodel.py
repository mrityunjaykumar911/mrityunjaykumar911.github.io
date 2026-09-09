#!/usr/bin/env python3
"""
Step 2b. Hand-computed cases from sln/MODEL.md.

Every expected value below was worked out by hand from the spec BEFORE the implementation was
written, so this is an independent check rather than a transcription of the code's behaviour.
The derivation is in each docstring so a reviewer can audit the arithmetic without rerunning it.
"""

from fractions import Fraction as F
from flexmodel import Item, resolve, GROW, SHRINK


def used(container, items):
    return resolve(container, items).used


def test_1_no_flexing_needed():
    """
    C=400, three items basis 100, grow 0 (so nothing may grow), shrink 1.
    sum(hyp)=300 < 400 -> GROW mode.
    Step 3: every item has grow factor 0 -> all freeze at hyp = 100.
    Result [100,100,100]; 100px of free space is deliberately left unused.
    """
    r = resolve(400, [Item(basis=100, grow=0, shrink=1) for _ in range(3)])
    assert r.mode == GROW
    assert r.used == [F(100)] * 3
    assert all(w == "step3_zero_factor" for w in r.frozen_at)


def test_2_grow_only():
    """
    C=400, two items basis 100, grow 1 each.
    sum(hyp)=200 < 400 -> GROW. initialFree = 200.
    Round 1: remaining=200, totalGrow=2, target = 100 + 200*(1/2) = 200 each.
    No violations -> freeze all. Result [200,200], filling the container exactly.
    """
    r = resolve(400, [Item(basis=100, grow=1) for _ in range(2)])
    assert r.mode == GROW
    assert r.used == [F(200), F(200)]
    assert sum(r.used) == 400


def test_3_shrink_only():
    """
    C=200, two items basis 200, shrink 1, grow 0.
    sum(hyp)=400, not < 200 -> SHRINK. initialFree = -200.
    scaledShrink = 1*200 = 200 each, total 400.
    target = 200 - 200*(200/400) = 100 each. Result [100,100].
    """
    r = resolve(200, [Item(basis=200, grow=0, shrink=1) for _ in range(2)])
    assert r.mode == SHRINK
    assert r.used == [F(100), F(100)]
    assert sum(r.used) == 200


def test_4_one_item_clamped_at_min():
    """
    C=200. A: basis 200, min 150. B: basis 200, min 0. Both shrink 1.
    SHRINK, initialFree = -200.
    Round 1: target = 200 - 200*(200/400) = 100 each.
             A clamps up to 150 -> min violation +50. B unchanged.
             totalViolation = +50 > 0 -> freeze A at 150.
    Round 2: remaining = 200 - (150 + 200) = -150. scaledShrink B = 200, total 200.
             target B = 200 - 150 = 50. No violation -> freeze.
    Result A=150, B=50.
    """
    r = resolve(200, [Item(basis=200, shrink=1, minS=150),
                      Item(basis=200, shrink=1, minS=0)])
    assert r.used == [F(150), F(50)]
    assert sum(r.used) == 200
    assert r.frozen_at[0] == "step5e_min_violation"
    assert r.rounds == 2


def test_5_cascading_refreeze():
    """
    The case that separates a correct implementation from a plausible one:
    freezing one item changes the free space enough to push a SECOND item into violation,
    which then pushes the arithmetic again. Three rounds.

    C=200. Three items basis 100, shrink 1. mins: A=0, B=60, D=95.
    sum(hyp)=300 -> SHRINK. initialFree = -100.
    Round 1: scaledShrink 100 each, total 300. target = 100 - 100*(100/300) = 200/3 each.
             D clamps up to 95 (violation +95-200/3). A, B unviolated (200/3 > 60).
             total > 0 -> freeze D at 95.
    Round 2: remaining = 200 - (95 + 100 + 100) = -95. total scaled = 200.
             target = 100 - 95*(100/200) = 52.5 for A and B.
             B clamps up to 60 -> violation +7.5 -> freeze B at 60.
    Round 3: remaining = 200 - (95 + 60 + 100) = -55. total scaled = 100.
             target A = 100 - 55 = 45. No violation -> freeze.
    Result A=45, B=60, D=95, summing to 200.
    """
    r = resolve(200, [Item(basis=100, shrink=1, minS=0),
                      Item(basis=100, shrink=1, minS=60),
                      Item(basis=100, shrink=1, minS=95)])
    assert r.used == [F(45), F(60), F(95)]
    assert sum(r.used) == 200
    assert r.rounds == 3, f"expected a 3-round cascade, got {r.rounds}"


def test_6_sub_unit_flex_factors():
    """
    Step 5b: if the sum of unfrozen flex factors is below one, the free space is scaled by that
    sum, so the items take only a fraction of it and the container is left partly empty.
    This is the clause most likely to be silently wrong.

    C=400, two items basis 100, grow 0.25 each (sum 0.5 < 1).
    sum(hyp)=200 < 400 -> GROW. initialFree = 200.
    Round 1: remaining = 200, but sumFactors = 0.5 < 1
             -> scaled = 200 * 0.5 = 100, |100| < |200| -> remaining = 100.
             totalGrow = 0.5. target = 100 + 100*(0.25/0.5) = 150 each.
    Result [150,150], total 300, leaving 100px unused on purpose.
    """
    r = resolve(400, [Item(basis=100, grow=F(1, 4)) for _ in range(2)])
    assert r.mode == GROW
    assert r.used == [F(150), F(150)]
    assert sum(r.used) == 300, "sub-unit factors must leave free space unconsumed"


def test_7_exact_arithmetic_no_rounding():
    """A3: thirds must stay exact, never become 66.666..."""
    r = resolve(200, [Item(basis=100, shrink=1) for _ in range(3)])
    assert r.used == [F(200, 3)] * 3
    assert sum(r.used) == 200


def test_8_frozen_target_not_basis_in_free_space():
    """
    Guards the trap in MODEL.md: free space uses the frozen item's TARGET but the unfrozen
    item's BASIS. If an implementation wrongly used the unfrozen item's current target, case 5
    would not produce 45/60/95.
    """
    r = resolve(200, [Item(basis=100, shrink=1, minS=0),
                      Item(basis=100, shrink=1, minS=60),
                      Item(basis=100, shrink=1, minS=95)])
    assert r.used == [F(45), F(60), F(95)]


def test_11_zero_remaining_resets_to_basis():
    """
    REGRESSION. Found by browser validation, not by hand analysis or the corpus.

    An item can survive several rounds with a min violation while max-violating siblings freeze
    around it. If the remaining free space then lands on exactly zero, step 5c is skipped. The
    original implementation left the item at the value step 5d had clamped it to in an earlier
    round (90). Chromium returns 100, its flex base size.

    Chromium is right: distributing zero free space still sets the target to basis + 0. The
    spec's "if the remaining free space is non-zero" is an optimisation, not permission to keep
    a stale clamped value.

    Case below is the exact one the browser disagreed on. Item index 1 is the one that matters.
    """
    items = [Item(basis=0,   grow=0,      shrink=F(1, 2), minS=50, maxS=None),
             Item(basis=100, grow=0,      shrink=2,       minS=90, maxS=200),
             Item(basis=300, grow=F(1, 2), shrink=1,      minS=50, maxS=200),
             Item(basis=0,   grow=3,      shrink=0,       minS=20, maxS=None, margin=10),
             Item(basis=150, grow=F(1, 2), shrink=1,      minS=20, maxS=120)]
    r = resolve(500, items)
    assert r.used[1] == F(100), f"expected basis 100, got {r.used[1]} (stale clamped value?)"
    assert sum(r.used) + 10 == 500


def test_9_margins_are_outer():
    """
    A2 relaxed. Spec step 1 sums OUTER hypothetical main sizes and step 4 sums OUTER sizes,
    so margins consume main-axis space before anything is distributed.

    C=400, two items basis 100, grow 1, total main-axis margin 50 each.
    outer hypothetical = (100+50)+(100+50) = 300 < 400 -> GROW.
    initialFree = 400 - 300 = 100  (not 200; the margins ate 100).
    Round 1: totalGrow = 2, target = 100 + 100*(1/2) = 150 each.
    Result [150,150]. Outer total = 150+50+150+50 = 400, exactly filling the container.

    A model that ignored margins would give 100 + 200*(1/2) = 200 each, so this case
    discriminates.
    """
    r = resolve(400, [Item(basis=100, grow=1, margin=50) for _ in range(2)])
    assert r.mode == GROW
    assert r.used == [F(150), F(150)], r.used
    assert sum(r.used) + 100 == 400


def test_10_margins_flip_the_mode():
    """
    Margins can flip grow into shrink. Two items basis 100 in a 250px container:
    without margins, outer 200 < 250 -> GROW. With 40 total margin each, outer 280 -> SHRINK.
    """
    grow_case = resolve(250, [Item(basis=100, grow=1, shrink=1) for _ in range(2)])
    shrink_case = resolve(250, [Item(basis=100, grow=1, shrink=1, margin=40) for _ in range(2)])
    assert grow_case.mode == GROW
    assert shrink_case.mode == SHRINK


if __name__ == "__main__":
    import sys
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok    {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
