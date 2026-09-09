#!/usr/bin/env python3
"""
Step 2a. Implementation of sln/MODEL.md, which is the in-scope fragment of
CSS Flexible Box Layout section 9.7 "Resolving Flexible Lengths".

Exact rational arithmetic throughout (assumption A3): browsers are fixed-point, and float
rounding produces apparent coupling that is an artefact of arithmetic rather than of the
algorithm. Discretisation happens only downstream, for a solver, where it is a declared bound.

Step numbers in comments refer to sln/SPEC-9.7.md.
"""

from fractions import Fraction as F
from dataclasses import dataclass
from typing import Optional, List

GROW, SHRINK = "grow", "shrink"


@dataclass
class Item:
    basis: F               # flex base size          (A1: own property)
    grow: F = F(0)         # flex grow factor   >= 0
    shrink: F = F(1)       # flex shrink factor >= 0
    minS: F = F(0)         # used min main size >= 0 (A1: own property)
    maxS: Optional[F] = None   # used max main size, None = +infinity (D2)
    margin: F = F(0)       # TOTAL main-axis margin (start + end)

    def __post_init__(self):
        self.basis = F(self.basis)
        self.grow = F(self.grow)
        self.shrink = F(self.shrink)
        self.minS = F(self.minS)
        self.margin = F(self.margin)
        if self.maxS is not None:
            self.maxS = F(self.maxS)
        assert self.grow >= 0 and self.shrink >= 0 and self.minS >= 0
        assert self.maxS is None or self.maxS >= self.minS


# A2 relaxed. The specification is explicit that steps 1, 4 and 5b use OUTER sizes:
# step 1 sums "the outer hypothetical main sizes", step 4 sums "the outer sizes".
# Collapsing outer to inner was a simplification the spec never makes, and margins are the
# second most common declaration in the corpus. Clamping in step 5d still applies to the
# INNER size, so margin is added only where the spec says "outer".


def _clamp(v: F, lo: F, hi: Optional[F]) -> F:
    if hi is not None and v > hi:
        v = hi
    if v < lo:
        v = lo
    return v


def hypothetical(it: Item) -> F:
    """Hypothetical main size: flex base size clamped by used min and max, floored at 0 (D3)."""
    return max(F(0), _clamp(it.basis, it.minS, it.maxS))


@dataclass
class Result:
    used: List[F]
    mode: str
    frozen_at: List[str]   # why each item froze
    rounds: int


def resolve(container: F, items: List[Item]) -> Result:
    C = F(container)
    n = len(items)
    hyp = [hypothetical(it) for it in items]

    # 1. Determine the used flex factor
    outer_hyp = sum(hyp[i] + items[i].margin for i in range(n))
    mode = GROW if outer_hyp < C else SHRINK

    # 2. Initialise
    target = [it.basis for it in items]
    frozen = [False] * n
    why = [""] * n

    def factor(i):
        return items[i].grow if mode == GROW else items[i].shrink

    def freeze(i, value, reason):
        target[i] = value
        frozen[i] = True
        why[i] = reason

    # 3. Size inflexible items
    for i, it in enumerate(items):
        if factor(i) == 0:
            freeze(i, hyp[i], "step3_zero_factor")
        elif mode == GROW and it.basis > hyp[i]:
            freeze(i, hyp[i], "step3_basis_above_max")
        elif mode == SHRINK and it.basis < hyp[i]:
            freeze(i, hyp[i], "step3_basis_below_min")

    def free_space():
        # 4 / 5b: frozen contribute target, unfrozen contribute BASIS (not current target)
        used = F(0)
        for i in range(n):
            inner = target[i] if frozen[i] else items[i].basis
            used += inner + items[i].margin        # outer size
        return C - used

    # 4. Initial free space
    initial_free = free_space()

    rounds = 0
    # 5. Loop
    while True:
        # a
        if all(frozen):
            break
        rounds += 1
        unfrozen = [i for i in range(n) if not frozen[i]]
        before = sum(frozen)

        # b
        remaining = free_space()
        sum_factors = sum(factor(i) for i in unfrozen)
        if sum_factors < 1:
            scaled = initial_free * sum_factors
            if abs(scaled) < abs(remaining):
                remaining = scaled

        # c
        if remaining == 0:
            # Distributing zero still RESETS the target to the flex base size. The spec's
            # "if the remaining free space is non-zero" is an optimisation, not permission to
            # keep the value step 5d clamped to in an earlier round. Chromium resets; leaving
            # the stale clamped value here was a real bug, found by browser validation.
            for i in unfrozen:
                target[i] = items[i].basis
        else:
            if mode == GROW:
                total_grow = sum(items[i].grow for i in unfrozen)
                if total_grow > 0:
                    for i in unfrozen:
                        target[i] = items[i].basis + remaining * items[i].grow / total_grow
            else:
                scaled_shrink = {i: items[i].shrink * items[i].basis for i in unfrozen}
                total_scaled = sum(scaled_shrink.values())
                if total_scaled > 0:
                    for i in unfrozen:
                        target[i] = (items[i].basis
                                     - abs(remaining) * scaled_shrink[i] / total_scaled)
                else:
                    # D1: spec gap. No basis to scale by, so the free space is undistributable.
                    # Freeze everything at its clamped basis and record that this fired.
                    for i in unfrozen:
                        freeze(i, max(F(0), _clamp(items[i].basis, items[i].minS, items[i].maxS)),
                               "D1_zero_scaled_shrink")
                    continue

        # d. Fix min/max violations
        violation = {}
        total_violation = F(0)
        for i in unfrozen:
            unclamped = target[i]
            clamped = max(F(0), _clamp(unclamped, items[i].minS, items[i].maxS))  # D3 order
            target[i] = clamped
            violation[i] = clamped - unclamped
            total_violation += violation[i]

        # e. Freeze over-flexed items
        if total_violation == 0:
            for i in unfrozen:
                freeze(i, target[i], "step5e_total_zero")
        elif total_violation > 0:
            for i in unfrozen:
                if violation[i] > 0:
                    freeze(i, target[i], "step5e_min_violation")
        else:
            for i in unfrozen:
                if violation[i] < 0:
                    freeze(i, target[i], "step5e_max_violation")

        # D4: the spec guarantees progress. Fail loudly rather than spin.
        assert sum(frozen) > before, "step 5e froze nothing; model or input is wrong"

    # 6
    return Result(used=list(target), mode=mode, frozen_at=why, rounds=rounds)


def used_sizes(container, specs):
    """Convenience: specs is a list of dicts with keys basis/grow/shrink/minS/maxS."""
    return resolve(container, [Item(**s) for s in specs]).used


if __name__ == "__main__":
    r = resolve(200, [Item(basis=100, shrink=1, minS=0),
                      Item(basis=100, shrink=1, minS=60),
                      Item(basis=100, shrink=1, minS=95)])
    print("mode:", r.mode, " rounds:", r.rounds)
    print("used:", [str(x) for x in r.used])
    print("why :", r.frozen_at)
