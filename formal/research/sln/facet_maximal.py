#!/usr/bin/env python3
"""
Step 3c. Is the candidate condition the WEAKEST sound locally-evaluable condition?

This is the question PROBLEM.md section 3 poses and that neither counting nor a single TLC
soundness check answers. Soundness says "we never admit a coupled item". It does not say
"we admit everything a local condition could admit". Without the second, any coverage number
is unfalsifiable: a reviewer asks "why not a better condition?" and we have no answer.

The construction.

A locally-evaluable condition is a predicate on the item's own declared properties ALONE.
So it is exactly a SUBSET of item shapes -- the shape is all the information it can see.
Therefore:

    a shape may be admitted by SOME sound local condition
      <=>  every (cfg, item) pair with that shape is independent

because if even one context makes that shape coupled, a condition admitting the shape admits
that pair, and is unsound. There is no cleverness available: the condition cannot look at the
context that distinguishes them.

Hence the union of ALL always-independent shapes is the unique WEAKEST sound locally-evaluable
condition. It is the ceiling. Anything below it is leaving admissible surface on the table;
nothing above it is sound. This script computes that ceiling, measures the gap to our named
facets, and reports the residue -- independent items that NO local condition can ever admit,
which bounds what locality costs us.
"""

import itertools, json, argparse, time, sys
from fractions import Fraction as F
from collections import defaultdict
from flexmodel import Item, resolve

_cache = {}


def used(cfg, C):
    k = (cfg, C)
    r = _cache.get(k)
    if r is None:
        r = tuple(resolve(C, [Item(basis=b, grow=g, shrink=s, minS=mn, maxS=mx, margin=F(0))
                              for (b, g, s, mn, mx) in cfg]).used)
        _cache[k] = r
    return r


def independent_across(cfg, i, widths, bases):
    for C in widths:
        mine = used(cfg, C)[i]
        for j in range(len(cfg)):
            if j == i:
                continue
            for b in bases:
                if b == cfg[j][0]:
                    continue
                alt = list(cfg)
                alt[j] = (b,) + cfg[j][1:]
                if used(tuple(alt), C)[i] != mine:
                    return False
    return True


B, G, S, MN, MX = 0, 1, 2, 3, 4

NAMED = {
    "F1 Inflexible":   lambda it: it[G] == 0 and it[S] == 0,
    "F3 ShrinkFloor":  lambda it: it[G] == 0 and it[B] <= it[MN],
    "F4 GrowCeiling":  lambda it: it[S] == 0 and it[MX] is not None and it[B] >= it[MX],
    "F5 ZeroCollapsed": lambda it: it[B] == 0 and it[MN] == 0 and it[G] == 0,
}


def named_admits(it):
    return any(f(it) for f in NAMED.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--out", default="facet_maximal.json")
    a = ap.parse_args()

    BASES = [F(0), F(60), F(120)]
    GROWS = [F(0), F(1)]
    SHRINKS = [F(0), F(1)]
    MINS = [F(0), F(60)]
    MAXES = [None, F(120)]
    WIDTHS = [F(120), F(240), F(360)]

    per_item = list(itertools.product(BASES, GROWS, SHRINKS, MINS, MAXES))
    n = a.n
    ncfg = len(per_item) ** n
    print(f"domain: {len(per_item)} shapes, N={n}, {ncfg} configs, {ncfg*n} (cfg,item) pairs\n")

    # per shape: how many pairs, how many independent
    tot = defaultdict(int)
    ind = defaultdict(int)
    t0 = time.time()
    for ci, cfg in enumerate(itertools.product(per_item, repeat=n)):
        if ci % 25000 == 0 and ci:
            print(f"  {ci}/{ncfg}  {time.time()-t0:.0f}s", file=sys.stderr)
        for i in range(n):
            sh = cfg[i]
            tot[sh] += 1
            if independent_across(cfg, i, WIDTHS, BASES):
                ind[sh] += 1

    n_pairs = sum(tot.values())
    n_ind = sum(ind.values())

    # THE CEILING: shapes that are independent in EVERY context
    always = [sh for sh in per_item if tot[sh] and ind[sh] == tot[sh]]
    sometimes = [sh for sh in per_item if 0 < ind[sh] < tot[sh]]
    never = [sh for sh in per_item if ind[sh] == 0]

    ceiling_pairs = sum(tot[sh] for sh in always)          # all independent by construction
    named_shapes = [sh for sh in per_item if named_admits(sh)]
    named_pairs = sum(tot[sh] for sh in named_shapes)
    named_unsound = sum(tot[sh] - ind[sh] for sh in named_shapes)

    # residue: independent pairs whose shape is only SOMETIMES independent.
    # No local condition can ever reach these. This is the price of locality.
    residue = sum(ind[sh] for sh in sometimes)

    fmt = lambda sh: (f"basis={sh[B]} grow={sh[G]} shrink={sh[S]} "
                      f"min={sh[MN]} max={'inf' if sh[MX] is None else sh[MX]}")

    print(f"\n================ MAXIMALITY ({time.time()-t0:.0f}s) ================")
    print(f"(cfg,item) pairs           : {n_pairs}")
    print(f"independent (ground truth) : {n_ind}  ({100*n_ind/n_pairs:.2f}%)")
    print()
    print(f"shapes total               : {len(per_item)}")
    print(f"  ALWAYS independent       : {len(always)}   <- the admissible ceiling")
    print(f"  SOMETIMES independent    : {len(sometimes)} <- unreachable by ANY local condition")
    print(f"  NEVER independent        : {len(never)}")
    print()
    print(f"WEAKEST SOUND LOCAL CONDITION admits : {ceiling_pairs} pairs "
          f"({100*ceiling_pairs/n_ind:.2f}% of independent)")
    print(f"our named facets F1,F3,F4,F5 admit   : {named_pairs} pairs "
          f"({100*named_pairs/n_ind:.2f}% of independent)   unsound admits {named_unsound}")
    print(f"GAP, our facets to the ceiling       : {ceiling_pairs - named_pairs} pairs")
    print(f"RESIDUE, ceiling to ground truth     : {residue} pairs "
          f"({100*residue/n_ind:.2f}% of independent)  <- the cost of locality, irreducible")

    print(f"\n---- the {len(always)} always-independent shapes (the ceiling) ----")
    for sh in always:
        mark = "  named" if named_admits(sh) else "  MISSED BY OUR FACETS"
        print(f"   {fmt(sh):>62}   pairs={tot[sh]:>6}{mark}")

    if sometimes:
        print(f"\n---- shapes independent only SOMETIMES (locality can never admit these) ----")
        for sh in sorted(sometimes, key=lambda s: -ind[s])[:20]:
            print(f"   {fmt(sh):>62}   indep {ind[sh]:>6}/{tot[sh]:<6} "
                  f"({100*ind[sh]/tot[sh]:.0f}%)")

    res = {
        "pairs": n_pairs, "independent": n_ind,
        "shapes_total": len(per_item), "shapes_always": len(always),
        "shapes_sometimes": len(sometimes), "shapes_never": len(never),
        "ceiling_pairs": ceiling_pairs,
        "ceiling_pct_of_independent": round(100*ceiling_pairs/n_ind, 2),
        "named_pairs": named_pairs,
        "named_pct_of_independent": round(100*named_pairs/n_ind, 2),
        "named_unsound_admits": named_unsound,
        "gap_named_to_ceiling": ceiling_pairs - named_pairs,
        "residue_pairs": residue,
        "residue_pct_of_independent": round(100*residue/n_ind, 2),
        "always_shapes": [{"shape": fmt(sh), "pairs": tot[sh], "named": named_admits(sh)}
                          for sh in always],
        "sometimes_shapes": [{"shape": fmt(sh), "indep": ind[sh], "total": tot[sh]}
                             for sh in sorted(sometimes, key=lambda s: -ind[s])],
    }
    json.dump(res, open(a.out, "w"), indent=2)
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
