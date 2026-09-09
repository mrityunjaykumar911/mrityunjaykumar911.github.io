#!/usr/bin/env python3
"""
Step 3f, part 2. Score the Immobile condition against real browser-labelled items.

Everything before this is on a synthetic domain and says the condition is OPTIMAL GIVEN THE
ALGORITHM. It says nothing about how often the condition fires on pages people actually
write. That is what this measures, and it is the only remaining step that can falsify the
work.

TWO GATES, in this order. The second is not read unless the first passes.

GATE 1, FIDELITY. Feed the measured inputs through flexmodel.resolve and compare against the
used sizes the browser actually produced. If the inputs do not reproduce the layout, then
either a measurement probe is wrong or MODEL.md is wrong, and any score computed on top is
meaningless. This is a correctness gate on the instrument, not a tunable accuracy figure.

GATE 2, PRECISION. Of the items Immobile admits, how many did the browser label independent?
This must be 100%. Immobile is proved sound against the model; a real-page violation is
therefore a proof that some assumption of the model does not hold on real pages, and the
counterexample is a bug report against MODEL.md. There is no exchange rate here either.

Only then does RECALL mean anything: of the items the browser labelled independent, how many
does Immobile admit? That is the number that decides whether the fragment is worth building
an engine on. The synthetic ceiling was 97.70%, but real pages are dominated by the default
`flex: 0 1 auto`, which is the residue shape, so recall is expected to be much lower and a
low value is a real finding rather than a failure.

    python score_immobile.py --src items.json
"""

import argparse, json
from fractions import Fraction as F
from collections import Counter
from flexmodel import Item, resolve


def q(x):
    """Browser pixels are LayoutUnits, 1/64 px. Quantise so float noise is not treated as
    signal, then work in exact rationals."""
    return F(round(float(x) * 64), 64)


# ---- the condition under test, imported so the browser scorer, the exhaustive searches and
# the bound-sensitivity sweep cannot drift apart. Item-local: no sibling, no width, no mode.
import facets


def _tup(it, inf_thr):
    """Measured record -> the (basis, grow, shrink, min, max) tuple facets.py expects.
    Padding and border cancel in every comparison the condition makes, so the border-box
    readings can be used directly."""
    mx = None if it["max"] >= inf_thr else q(it["max"])
    mn = q(it["min"])
    if mx is not None and mx < mn:
        mx = mn
    return (q(it["basis"]), F(it["g"]).limit_denominator(1000),
            F(it["s"]).limit_denominator(1000), mn, mx)


def immobile(it, inf_thr):
    return facets.immobile_tuple(_tup(it, inf_thr))


def which_facet(it, inf_thr):
    return facets.which_facet(_tup(it, inf_thr))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="items.json")
    ap.add_argument("--out", default="score_immobile.json")
    ap.add_argument("--tol", type=float, default=1.0, help="fidelity tolerance in px")
    ap.add_argument("--examples", type=int, default=10)
    a = ap.parse_args()

    D = json.load(open(a.src))
    WIDTHS = [str(w) for w in D["widths"]]
    INF = D["inf_threshold"]

    # Degenerate containers carry no information: a container whose inner main size is zero
    # lays every item out at zero, so every item is trivially "independent" and trivially
    # predicted. Including them inflates both the label rate and the fidelity rate without
    # any layout actually having happened. Dropped before either gate, and counted.
    degenerate = set()
    for key, byw in D["data"].items():
        inner = [float(byw[w]["contMain"]) - float(byw[w]["contPB"]) for w in WIDTHS]
        if max(inner) <= 1.0:
            degenerate.add(key)
    keys = [k for k in D["data"] if k not in degenerate]
    print(f"containers: {len(D['data'])}  degenerate (zero-size, dropped): {len(degenerate)}  "
          f"used: {len(keys)}\n")

    # ---------------- GATE 1: fidelity ----------------
    fid_ok = fid_bad = 0
    fid_examples = []
    worst = 0.0
    for key in keys:
        byw = D["data"][key]
        for w in WIDTHS:
            c = byw[w]
            # container inner main size, minus the main-axis gaps, which 9.7 removes from the
            # free space before any distribution
            C = q(c["contMain"]) - q(c["contPB"]) - q(c.get("gap", 0)) * (c["n"] - 1)
            items = []
            for it in c["items"]:
                # Probes read the BORDER box. The scaled flex shrink factor in step 5b is
                # shrink x the INNER flex base size, so feeding border-box bases skews the
                # proportion between items with different padding: the total comes out right
                # and the split comes out wrong, in equal and opposite amounts. Convert to
                # inner sizes and move padding+border into the outer term, which leaves every
                # outer size identical: (basis - pb) + (margin + pb) = basis + margin.
                pb = q(it["pb"])
                mx = None if it["max"] >= INF else max(F(0), q(it["max"]) - pb)
                mn = max(F(0), q(it["min"]) - pb)
                if mx is not None and mx < mn:
                    mx = mn          # spec: max is clamped up to min
                items.append(Item(basis=max(F(0), q(it["basis"]) - pb),
                                  grow=F(it["g"]).limit_denominator(1000),
                                  shrink=F(it["s"]).limit_denominator(1000),
                                  minS=mn, maxS=mx, margin=q(it["mg"]) + pb))
            # model returns inner sizes; the browser reading is the border box
            pred = [u + q(c["items"][k]["pb"])
                    for k, u in enumerate(resolve(C, items).used)]
            for i, it in enumerate(c["items"]):
                d = abs(float(pred[i]) - float(it["used"]))
                worst = max(worst, d)
                if d <= a.tol:
                    fid_ok += 1
                else:
                    fid_bad += 1
                    if len(fid_examples) < a.examples:
                        fid_examples.append({
                            "key": key, "width": w, "i": i, "diff": round(d, 3),
                            "predicted": round(float(pred[i]), 3),
                            "browser": round(float(it["used"]), 3),
                            "container_inner": round(float(C), 3),
                            "justify": c["justify"],
                            "items": [{k: round(float(v), 2) if k != "g" and k != "s"
                                       else v for k, v in x.items()} for x in c["items"]],
                        })
    fid_total = fid_ok + fid_bad
    fid_pct = 100.0 * fid_ok / fid_total if fid_total else 0.0

    print("=============== GATE 1: FIDELITY ===============")
    print(f"item-width observations : {fid_total}")
    print(f"model reproduces browser: {fid_ok}  ({fid_pct:.2f}%)   tolerance {a.tol}px")
    print(f"mismatches              : {fid_bad}   worst diff {worst:.3f}px")
    if fid_examples:
        print(f"\nfirst {len(fid_examples)} mismatches:")
        for e in fid_examples:
            print(f"  {e['key']} @{e['width']}px item{e['i']}  "
                  f"predicted {e['predicted']} vs browser {e['browser']} "
                  f"(diff {e['diff']}, container inner {e['container_inner']}, "
                  f"justify {e['justify']})")

    # ---------------- labels + condition, across the interval ----------------
    n_items = 0
    label_indep = 0
    admitted = 0
    tp = fp = 0
    facet_counter = Counter()
    fp_examples = []
    missed_shapes = Counter()

    for key in keys:
        byw = D["data"][key]
        n = byw[WIDTHS[0]]["n"]
        for i in range(n):
            n_items += 1
            # browser label: independent at EVERY width
            lab = all(
                not any(byw[w]["coupling"][j][i] for j in range(n) if j != i)
                for w in WIDTHS)
            # condition: must hold at EVERY width (basis/bounds can be percentages)
            adm = all(immobile(byw[w]["items"][i], INF) for w in WIDTHS)
            if lab:
                label_indep += 1
            if adm:
                admitted += 1
                f = which_facet(byw[WIDTHS[0]]["items"][i], INF)
                facet_counter[f or "(mixed across widths)"] += 1
                if lab:
                    tp += 1
                else:
                    fp += 1
                    if len(fp_examples) < a.examples:
                        it = byw[WIDTHS[0]]["items"][i]
                        fp_examples.append({
                            "key": key, "i": i, "facet": f,
                            "at_320": {k: round(float(v), 2) for k, v in it.items()},
                        })
            elif lab:
                it = byw[WIDTHS[0]]["items"][i]
                atmax = it["max"] < INF and q(it["basis"]) >= q(it["max"])
                atmin = q(it["basis"]) <= q(it["min"])
                missed_shapes[(f"grow={'0' if it['g']==0 else '>0'}",
                               f"shrink={'0' if it['s']==0 else '>0'}",
                               f"at_min={atmin}", f"at_max={atmax}")] += 1

    # ---------------- the actual objective from PROBLEM.md section 3 ----------------
    # Decomposable surface, node weighted. A container is only useful to a compositional
    # engine if EVERY item in it is certifiable: one coupled item forces the whole container
    # to be verified monolithically, so partial credit is not a thing. Reported alongside the
    # per-item rate because the per-item rate flatters the result.
    cont_total = cont_all_admitted = cont_all_indep = 0
    items_in_decomposable = 0
    for key in keys:
        byw = D["data"][key]
        n = byw[WIDTHS[0]]["n"]
        cont_total += 1
        adm_all = all(all(immobile(byw[w]["items"][i], INF) for w in WIDTHS) for i in range(n))
        ind_all = all(
            all(not any(byw[w]["coupling"][j][i] for j in range(n) if j != i) for w in WIDTHS)
            for i in range(n))
        if adm_all:
            cont_all_admitted += 1
            items_in_decomposable += n
        if ind_all:
            cont_all_indep += 1

    prec = 100.0 * tp / admitted if admitted else None
    rec = 100.0 * tp / label_indep if label_indep else None

    print("\n=============== GATE 2: PRECISION ===============")
    print(f"items (across interval) : {n_items}")
    print(f"browser says independent: {label_indep}  ({100*label_indep/n_items:.2f}%)")
    print(f"Immobile admits         : {admitted}  ({100*admitted/n_items:.2f}%)")
    print(f"  true admits           : {tp}")
    print(f"  FALSE admits          : {fp}")
    print(f"PRECISION               : {prec:.2f}%" if prec is not None else "PRECISION : n/a")
    if fp:
        print("\n  A false admit is a soundness failure ON REAL PAGES. Immobile is proved")
        print("  sound against MODEL.md, so each one is a counterexample to an assumption")
        print("  in MODEL.md, not an accuracy shortfall. First few:")
        for e in fp_examples:
            print(f"    {e['key']} item{e['i']} via {e['facet']}: {e['at_320']}")

    print("\n=============== RECALL ===============")
    print(f"RECALL                  : {rec:.2f}%   ({tp}/{label_indep})"
          if rec is not None else "RECALL : n/a")
    print("\n=============== DECOMPOSABLE SURFACE (the objective) ===============")
    print(f"containers                        : {cont_total}")
    print(f"  every item browser-independent  : {cont_all_indep}  "
          f"({100*cont_all_indep/cont_total:.2f}%)   <- the ceiling on real pages")
    print(f"  every item CERTIFIED by Immobile: {cont_all_admitted}  "
          f"({100*cont_all_admitted/cont_total:.2f}%)   <- what an engine can actually claim")
    print(f"node-weighted surface (items in fully certified containers): "
          f"{items_in_decomposable}/{n_items}  ({100*items_in_decomposable/n_items:.2f}%)")

    print("\nadmitted items by facet:")
    for k, v in facet_counter.most_common():
        print(f"  {k:22} {v:>5}  ({100*v/admitted:.1f}% of admits)")
    print("\nindependent but NOT admitted, by shape (at 320px):")
    for k, v in missed_shapes.most_common(12):
        print(f"  {', '.join(k):55} {v:>5}")

    res = {
        "fidelity": {"observations": fid_total, "match": fid_ok, "pct": round(fid_pct, 2),
                     "mismatch": fid_bad, "worst_px": round(worst, 3),
                     "tolerance_px": a.tol, "examples": fid_examples},
        "items": n_items, "browser_independent": label_indep,
        "admitted": admitted, "true_admits": tp, "false_admits": fp,
        "precision_pct": round(prec, 2) if prec is not None else None,
        "recall_pct": round(rec, 2) if rec is not None else None,
        "containers": cont_total,
        "containers_all_independent": cont_all_indep,
        "containers_all_certified": cont_all_admitted,
        "containers_all_certified_pct": round(100*cont_all_admitted/cont_total, 2),
        "node_weighted_surface_pct": round(100*items_in_decomposable/n_items, 2),
        "admits_by_facet": dict(facet_counter),
        "missed_shapes": {", ".join(k): v for k, v in missed_shapes.most_common()},
        "false_admit_examples": fp_examples,
    }
    json.dump(res, open(a.out, "w"), indent=2)
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
