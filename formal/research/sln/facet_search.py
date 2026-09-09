#!/usr/bin/env python3
"""
Facet search, exact rational arithmetic, over exactly the semantics FlexFacets.tla models.

Division of labour:
  TLC     mechanised counterexamples on a SMALL domain (fast when a violation exists)
  here    exhaustive search over the FULL domain, exact rationals, memoised
  browser 1309 labelled real items, final ground truth

Why this is fast where TLC is not. TLC re-evaluates Used(cfg,C) inside the invariant for
every one of the 3*|Variants| nested resolutions, per state, interpretively, with no
sharing between states. Every variant config is itself a member of the same config space,
so a single memo table over (cfg, width) collapses the whole job to |Config| * |Widths|
resolutions -- 331,776 instead of ~7 million.

Ground truth per (cfg, item i): does i's used main size stay fixed under EVERY change to a
sibling's flex base size, at EVERY width in the interval? That is the product construction
from the TLA+ module, computed directly.
"""

import itertools, json, argparse, time, sys
from fractions import Fraction as F
from flexmodel import Item, resolve

INF = None


# ---------------------------------------------------------------- semantics
_cache = {}


def used(cfg, C):
    """Memoised. cfg is a tuple of (basis, grow, shrink, min, max) tuples."""
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


# ---------------------------------------------------------------- facets
# A facet may reference ONLY item i's own declared properties. It may not read a sibling,
# and it may not read the container width, because the width is a free parameter over the
# interval and the grow/shrink MODE is itself sibling-dependent (TLC refuted mode-conditioned
# facets in 2 seconds; see FlexFacets.tla).
B, G, S, MN, MX = 0, 1, 2, 3, 4


def f_inflexible(it):            # grow 0 and shrink 0: never resized in either mode
    return it[G] == 0 and it[S] == 0


def f_fixed_bounds(it):          # min == max: clamped to a point whatever is distributed
    return it[MX] is not None and it[MN] == it[MX]


def f_zero_everything(it):       # basis 0, min 0, cannot grow: shrinking 0 stays 0
    return it[B] == 0 and it[MN] == 0 and it[G] == 0


def f_shrink_floor(it):          # cannot grow, and basis already at/below its own min
    return it[G] == 0 and it[B] <= it[MN]


def f_grow_ceiling(it):          # cannot shrink, and basis already at/above its own max
    return it[S] == 0 and it[MX] is not None and it[B] >= it[MX]


def f_pinned_both_ways(it):      # cannot move down past min, cannot move up past max
    return it[MX] is not None and it[B] <= it[MN] and it[B] >= it[MX]


FACETS = {
    "F1 Inflexible      grow=0 and shrink=0": f_inflexible,
    "F2 FixedByBounds   min=max":             f_fixed_bounds,
    "F3 ShrinkFloor     grow=0 and basis<=min": f_shrink_floor,
    "F4 GrowCeiling     shrink=0 and basis>=max": f_grow_ceiling,
    "F5 ZeroCollapsed   basis=0 and min=0 and grow=0": f_zero_everything,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="facet_search.json")
    ap.add_argument("--examples", type=int, default=15)
    ap.add_argument("--n", type=int, default=3)
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
    print(f"domain: {len(per_item)} per-item variants, N={n} -> {ncfg} configs, "
          f"{ncfg*n} (cfg,item) pairs")
    print(f"widths: {[str(w) for w in WIDTHS]}")
    print("this is the SAME domain as flexfacets-sound.cfg\n")

    t0 = time.time()
    n_items = n_indep = 0
    stats = {k: {"fires": 0, "unsound": 0, "covers": 0} for k in FACETS}
    union_covers = union_unsound = 0
    unexplained, unsound_ex = [], []
    unexplained_shapes = {}

    for ci, cfg in enumerate(itertools.product(per_item, repeat=n)):
        if ci % 20000 == 0 and ci:
            print(f"  {ci}/{ncfg} configs  {time.time()-t0:.0f}s  "
                  f"cache {len(_cache)}", file=sys.stderr)
        for i in range(n):
            n_items += 1
            it = cfg[i]
            truth = independent_across(cfg, i, WIDTHS, BASES)
            if truth:
                n_indep += 1

            fired = False
            for name, fn in FACETS.items():
                if fn(it):
                    stats[name]["fires"] += 1
                    fired = True
                    if truth:
                        stats[name]["covers"] += 1
                    else:
                        stats[name]["unsound"] += 1
                        if len(unsound_ex) < a.examples:
                            unsound_ex.append({"facet": name, "item": i,
                                               "cfg": [[str(x) for x in t] for t in cfg]})
            if fired:
                union_covers += 1 if truth else 0
                union_unsound += 0 if truth else 1
            elif truth:
                # record the SHAPE of the missed item so facets can be named from it
                shape = (str(it[B]), str(it[G]), str(it[S]), str(it[MN]), str(it[MX]))
                unexplained_shapes[shape] = unexplained_shapes.get(shape, 0) + 1
                if len(unexplained) < a.examples:
                    unexplained.append({"item": i,
                                        "cfg": [[str(x) for x in t] for t in cfg]})

    el = time.time() - t0
    res = {
        "domain": {"per_item_variants": len(per_item), "N": n, "configs": ncfg,
                   "widths": [str(w) for w in WIDTHS]},
        "seconds": round(el, 1),
        "items_examined": n_items,
        "independent_ground_truth": n_indep,
        "independent_pct": round(100 * n_indep / n_items, 2),
        "union_sound": union_unsound == 0,
        "union_unsound_count": union_unsound,
        "union_covers": union_covers,
        "union_coverage_pct": round(100 * union_covers / n_indep, 2) if n_indep else None,
        "facets": stats,
        "unsound_examples": unsound_ex,
        "unexplained_independent_shapes": sorted(
            [{"basis": s[0], "grow": s[1], "shrink": s[2], "min": s[3], "max": s[4],
              "count": c} for s, c in unexplained_shapes.items()],
            key=lambda d: -d["count"]),
        "unexplained_examples": unexplained,
    }
    json.dump(res, open(a.out, "w"), indent=2)

    print(f"\n=============== FACET SEARCH ({el:.0f}s, "
          f"{len(_cache)} memoised resolutions) ===============")
    print(f"(cfg,item) pairs examined : {n_items}")
    print(f"independent (ground truth): {n_indep}  ({res['independent_pct']}%)")
    print("\nper facet:")
    for k, v in stats.items():
        verdict = "SOUND" if v["unsound"] == 0 else f"UNSOUND ({v['unsound']} bad admits)"
        print(f"  {k:46} fires={v['fires']:>7}  covers={v['covers']:>7}  {verdict}")
    print("\nunion of facets:")
    print(f"  sound                    : {res['union_sound']}  (bad admits {union_unsound})")
    print(f"  covers                   : {union_covers}/{n_indep}  "
          f"({res['union_coverage_pct']}% of truly independent items)")
    print(f"  MISSED independent items : {n_indep - union_covers}")

    if unsound_ex:
        print(f"\n---- UNSOUND ADMITS (first {len(unsound_ex)}) ----")
        for u in unsound_ex:
            marks = ["*" if k == u["item"] else " " for k in range(n)]
            print(f"  [{u['facet']}]")
            print("   " + " | ".join(f"{m}{tuple(t)}" for m, t in zip(marks, u["cfg"])))

    if res["unexplained_independent_shapes"]:
        print(f"\n---- independent but UNEXPLAINED, grouped by item shape ----")
        print(f"     {'basis':>6} {'grow':>5} {'shrink':>7} {'min':>5} {'max':>6}   count")
        for s in res["unexplained_independent_shapes"][:25]:
            print(f"     {s['basis']:>6} {s['grow']:>5} {s['shrink']:>7} "
                  f"{s['min']:>5} {str(s['max']):>6}   {s['count']}")

    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
