#!/usr/bin/env python3
"""
Step 2c, primary validation. Compare flexmodel.py against a real browser.

Why this replaces corpus validation as the primary check: WebCode2M gives us partial authored
CSS and observed boxes, but not computed styles. Container padding, borders, box-sizing and
min-content are all unobservable there, so every one of them injects error, concentrated in
shrink mode. Reconstructing unknown inputs and then "validating" against them is fitting, not
testing.

Here every input is controlled. Chromium is the oracle. Ground truth is exact.

Controls, so nothing is ambiguous:
  - global reset: margin/padding/border zero, box-sizing border-box
  - empty divs, so content-based min-content is zero
  - min-width always declared explicitly, which overrides the automatic minimum
  - flex-basis always an explicit px length, so the basis is definite

    python browser_validate.py --cases 3000
"""

import argparse, json, random
from fractions import Fraction as F
from flexmodel import Item, resolve

TOL = 0.06   # px. Chromium lays out in 1/64px LayoutUnits.


def _css_num(x):
    """
    Fractions stringify as '1/2', which is INVALID CSS: Chromium discards the declaration and
    falls back to the initial value. Emit a decimal instead. All factors used here (1/4, 1/2)
    are exactly representable in decimal, so no precision is lost.
    """
    return f"{float(x):g}"


def build_html(C, items):
    kids = []
    for it in items:
        mx = "none" if it["max"] is None else f"{it['max']}px"
        half = F(it["margin"], 2)
        kids.append(
            f"<div style=\"flex-grow:{_css_num(it['grow'])};flex-shrink:{_css_num(it['shrink'])};"
            f"flex-basis:{it['basis']}px;min-width:{it['min']}px;max-width:{mx};"
            f"margin:0 {_css_num(half)}px\"></div>"
        )
    return (
        "<!doctype html><style>*{margin:0;padding:0;border:0;box-sizing:border-box}"
        "body{margin:0}</style>"
        f"<div id='c' style='display:flex;flex-wrap:nowrap;width:{C}px'>"
        + "".join(kids) + "</div>"
    )


SUBUNIT_OK = True   # set False to exclude flex factors below 1


def gen_case(rng):
    n = rng.randint(2, 5)
    C = rng.choice([200, 300, 400, 500, 640, 800, 1000])
    items = []
    for _ in range(n):
        basis = rng.choice([0, 20, 50, 80, 100, 150, 200, 300])
        # mix of zero and non-zero factors, including sub-unit factors (spec step 5b)
        if SUBUNIT_OK:
            grow = rng.choice([0, 0, 1, 2, 3, F(1, 4), F(1, 2)])
            shrink = rng.choice([0, 1, 1, 2, 3, F(1, 2)])
        else:
            grow = rng.choice([0, 0, 1, 2, 3])
            shrink = rng.choice([0, 1, 1, 2, 3])
        mn = rng.choice([0, 0, 0, 20, 50, 90])
        mx = rng.choice([None, None, None, 120, 200, 400])
        if mx is not None and mx < mn:
            mx = None
        margin = rng.choice([0, 0, 0, 10, 20, 40])
        items.append({"basis": basis, "grow": grow, "shrink": shrink,
                      "min": mn, "max": mx, "margin": margin})
    return C, items


def predict(C, items):
    return resolve(F(C), [Item(basis=F(i["basis"]), grow=F(i["grow"]), shrink=F(i["shrink"]),
                               minS=F(i["min"]),
                               maxS=None if i["max"] is None else F(i["max"]),
                               margin=F(i["margin"]))
                          for i in items])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="browser_validation.json")
    ap.add_argument("--show", type=int, default=8, help="mismatches to print")
    ap.add_argument("--no-subunit", action="store_true",
                    help="exclude flex factors below 1 (spec step 5b corner)")
    a = ap.parse_args()

    global SUBUNIT_OK
    SUBUNIT_OK = not a.no_subunit
    from playwright.sync_api import sync_playwright
    rng = random.Random(a.seed)

    matched = 0
    mismatched = []
    worst = 0.0
    errors = []
    by_mode = {"grow": [0, 0], "shrink": [0, 0]}   # [match, total]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for k in range(a.cases):
            C, items = gen_case(rng)
            try:
                r = predict(C, items)
            except AssertionError as e:
                mismatched.append({"C": C, "items": items, "error": f"model assert: {e}"})
                continue
            page.set_content(build_html(C, items))
            obs = page.eval_on_selector_all(
                "#c > div", "els => els.map(e => e.getBoundingClientRect().width)")
            pred = [float(x) for x in r.used]
            diffs = [abs(pv - ov) for pv, ov in zip(pred, obs)]
            worst = max(worst, max(diffs) if diffs else 0)
            errors.extend(diffs)
            ok = all(d <= TOL for d in diffs)
            by_mode[r.mode][1] += 1
            if ok:
                matched += 1
                by_mode[r.mode][0] += 1
            elif len(mismatched) < 200:
                mismatched.append({"C": C, "items": items, "mode": r.mode,
                                   "predicted": pred, "observed": obs,
                                   "max_diff": max(diffs), "rounds": r.rounds,
                                   "frozen_at": r.frozen_at})
        browser.close()

    errors.sort()
    pct = lambda x, d: round(100.0 * x / d, 2) if d else None
    res = {
        "cases": a.cases,
        "matched": matched,
        "match_pct": pct(matched, a.cases),
        "worst_abs_diff_px": round(worst, 4),
        "median_abs_diff_px": round(errors[len(errors)//2], 6) if errors else None,
        "p99_abs_diff_px": round(errors[int(0.99*len(errors))], 6) if errors else None,
        "grow_match_pct": pct(by_mode["grow"][0], by_mode["grow"][1]),
        "shrink_match_pct": pct(by_mode["shrink"][0], by_mode["shrink"][1]),
        "grow_cases": by_mode["grow"][1],
        "shrink_cases": by_mode["shrink"][1],
        "tolerance_px": TOL,
        "mismatch_examples": mismatched[:20],
    }
    json.dump(res, open(a.out, "w"), indent=2, default=str)

    print("\n========= BROWSER VALIDATION (Chromium is the oracle) =========")
    print(f"cases            : {a.cases}")
    print(f"matched          : {matched}   ({res['match_pct']}%)")
    print(f"  grow  mode     : {by_mode['grow'][0]}/{by_mode['grow'][1]}  ({res['grow_match_pct']}%)")
    print(f"  shrink mode    : {by_mode['shrink'][0]}/{by_mode['shrink'][1]}  ({res['shrink_match_pct']}%)")
    print(f"median abs diff  : {res['median_abs_diff_px']} px")
    print(f"p99 abs diff     : {res['p99_abs_diff_px']} px")
    print(f"worst abs diff   : {res['worst_abs_diff_px']} px   (tolerance {TOL})")

    if mismatched:
        print(f"\n---- first {min(a.show, len(mismatched))} mismatches ----")
        for m in mismatched[:a.show]:
            if "error" in m:
                print(f"  C={m['C']}  {m['error']}")
                continue
            print(f"\n  C={m['C']}  mode={m['mode']}  rounds={m['rounds']}  maxdiff={m['max_diff']:.3f}")
            for it, pv, ov in zip(m["items"], m["predicted"], m["observed"]):
                flag = "  <-- " if abs(pv - ov) > TOL else "      "
                print(f"    basis={it['basis']:>4} g={str(it['grow']):>4} s={str(it['shrink']):>4} "
                      f"min={it['min']:>3} max={str(it['max']):>4} m={it['margin']:>3}"
                      f" | pred {pv:>9.3f}  obs {ov:>9.3f}{flag}")

    print("\n========= VERDICT =========")
    mp = res["match_pct"]
    if mp is not None and mp >= 99:
        print(f"{mp}% exact. Model IS the flex algorithm for the in-scope fragment. Proceed to 2d.")
    elif mp is not None and mp >= 90:
        print(f"{mp}% exact. Close, but the mismatches are real model bugs. Fix before 2d.")
    else:
        print(f"only {mp}% exact. Model is wrong. Diagnose from the mismatches above.")
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
