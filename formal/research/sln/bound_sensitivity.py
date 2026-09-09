#!/usr/bin/env python3
"""
Step 4. Bound sensitivity.

PROBLEM.md section 9 concedes the obvious objection: bounded checking proves nothing on its
own. Every result so far -- soundness, the 20-shape ceiling, maximality, the 2.30% residue --
was computed on ONE domain: N=3, three bases, unit factors, three widths. A reviewer is
entitled to ask whether the condition is an artefact of that box.

The commitment made in reply was to move the bound and report what happens, including if it
breaks. That is this script. For each domain it recomputes from scratch:

  independent %   ground truth by product construction
  unsound         does Immobile ever admit a coupled item
  ceiling         the always-independent shapes, i.e. the weakest sound LOCAL condition
  gap             ceiling minus Immobile; 0 means Immobile is still maximal
  residue %       independent items no local condition can reach

A domain where the gap opens is the interesting outcome, not a failure: it names a shape that
is always independent under richer inputs and that Immobile is needlessly rejecting.

    python bound_sensitivity.py
"""

import itertools, json, time, argparse, sys
from fractions import Fraction as F
from flexmodel import Item, resolve

B, G, S, MN, MX = 0, 1, 2, 3, 4

from facets import immobile_tuple as immobile


def run(name, bases, grows, shrinks, mins, maxes, widths, n):
    cache = {}

    def used(cfg, C):
        k = (cfg, C)
        r = cache.get(k)
        if r is None:
            r = tuple(resolve(C, [Item(basis=b, grow=g, shrink=s, minS=mn, maxS=mx,
                                       margin=F(0))
                                  for (b, g, s, mn, mx) in cfg]).used)
            cache[k] = r
        return r

    def indep(cfg, i):
        for C in widths:
            mine = used(cfg, C)[i]
            for j in range(n):
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

    shapes = list(itertools.product(bases, grows, shrinks, mins, maxes))
    ncfg = len(shapes) ** n
    tot = {s: 0 for s in shapes}
    ind = {s: 0 for s in shapes}

    t0 = time.time()
    for cfg in itertools.product(shapes, repeat=n):
        for i in range(n):
            sh = cfg[i]
            tot[sh] += 1
            if indep(cfg, i):
                ind[sh] += 1

    pairs = sum(tot.values())
    n_ind = sum(ind.values())
    always = {s for s in shapes if tot[s] and ind[s] == tot[s]}
    sometimes = {s for s in shapes if 0 < ind[s] < tot[s]}
    adm = {s for s in shapes if immobile(s)}

    unsound = sorted(adm - always)          # admitted but not always independent
    gap = sorted(always - adm)              # always independent but rejected
    ceiling_pairs = sum(tot[s] for s in always)
    adm_pairs = sum(ind[s] for s in adm)
    residue = sum(ind[s] for s in sometimes)

    return {
        "domain": name,
        "shapes": len(shapes), "configs": ncfg, "pairs": pairs,
        "seconds": round(time.time() - t0, 1),
        "independent": n_ind,
        "independent_pct": round(100 * n_ind / pairs, 2),
        "unsound_shapes": [str(s) for s in unsound],
        "sound": not unsound,
        "gap_shapes": [str(s) for s in gap],
        "maximal": not gap,
        "ceiling_pct_of_independent": round(100 * ceiling_pairs / n_ind, 2) if n_ind else None,
        "immobile_covers_pct": round(100 * adm_pairs / n_ind, 2) if n_ind else None,
        "residue_pct": round(100 * residue / n_ind, 2) if n_ind else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="bound_sensitivity.json")
    a = ap.parse_args()

    INF = None
    DOMAINS = [
        # name, bases, grows, shrinks, mins, maxes, widths, N
        ("D0 baseline (as in FlexFacets)",
         [0, 60, 120], [0, 1], [0, 1], [0, 60], [INF, 120], [120, 240, 360], 3),

        ("D1 fewer items  N=2",
         [0, 60, 120], [0, 1], [0, 1], [0, 60], [INF, 120], [120, 240, 360], 2),

        ("D2 more items   N=4 (smaller shape set)",
         [0, 60], [0, 1], [0, 1], [0, 60], [INF], [120, 240], 4),

        ("D3 more bases, none coinciding with a bound",
         [0, 40, 90, 150], [0, 1], [0, 1], [0, 60], [INF, 120], [120, 240, 360], 3),

        ("D4 NON-UNIT flex factors {0,1,3}",
         [0, 60], [0, 1, 3], [0, 1, 3], [0, 60], [INF, 120], [120, 240, 360], 3),

        ("D5 wider width interval, 16x range",
         [0, 60, 120], [0, 1], [0, 1], [0, 60], [INF, 120], [60, 120, 240, 480, 960], 3),

        ("D6 coprime widths (rounding stress)",
         [0, 60, 120], [0, 1], [0, 1], [0, 60], [INF, 120], [101, 233, 377], 3),

        ("D7 min == max reachable (activates F2)",
         [0, 60, 120], [0, 1], [0, 1], [0, 60], [INF, 60], [120, 240, 360], 3),
    ]

    rows = []
    for (name, bs, gs, ss, mns, mxs, ws, n) in DOMAINS:
        bases = [F(x) for x in bs]
        maxes = [None if x is None else F(x) for x in mxs]
        print(f"running {name} ...", file=sys.stderr)
        r = run(name, bases, [F(x) for x in gs], [F(x) for x in ss],
                [F(x) for x in mns], maxes, [F(x) for x in ws], n)
        rows.append(r)
        print(f"  {r['pairs']} pairs, {r['seconds']}s, sound={r['sound']} "
              f"maximal={r['maximal']}", file=sys.stderr)

    json.dump(rows, open(a.out, "w"), indent=2)

    print("\n" + "=" * 108)
    print("BOUND SENSITIVITY")
    print("=" * 108)
    print(f"{'domain':44} {'pairs':>9} {'indep%':>7} {'sound':>6} {'maximal':>8} "
          f"{'covers%':>8} {'residue%':>9}")
    print("-" * 108)
    for r in rows:
        print(f"{r['domain']:44} {r['pairs']:>9} {r['independent_pct']:>7} "
              f"{str(r['sound']):>6} {str(r['maximal']):>8} "
              f"{r['immobile_covers_pct']:>8} {r['residue_pct']:>9}")
    print("-" * 108)

    bad = [r for r in rows if not r["sound"]]
    ng = [r for r in rows if not r["maximal"]]
    if bad:
        print("\nUNSOUND on:")
        for r in bad:
            print(f"  {r['domain']}: {r['unsound_shapes']}")
    else:
        print("\nSOUND on every domain tested. No domain admits a coupled item.")
    if ng:
        print("\nNOT MAXIMAL on:")
        for r in ng:
            print(f"  {r['domain']}")
            print(f"    always-independent shapes Immobile rejects "
                  f"(basis, grow, shrink, min, max):")
            for s in r["gap_shapes"]:
                print(f"      {s}")
    else:
        print("MAXIMAL on every domain tested. Immobile equals the weakest sound "
              "locally-evaluable condition throughout.")

    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
