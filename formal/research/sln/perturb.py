#!/usr/bin/env python3
"""
Step 2d. Measure flex item independence DIRECTLY, by perturbation in a real browser.

This replaces every CSS-parsing proxy used earlier. The research question is:

    does item i's used main size depend on a sibling's content?

That is answered by changing a sibling's content and seeing whether item i moves. No parsing, no
reconstructed inputs, no unobservable content sizes.

Method, per page, per width, inside one page load:
  1. find every element whose COMPUTED display is flex or inline-flex
  2. record each in-flow child's used main size
  3. for each child j: inject a wide inline-block into j (changing j's min-content and
     max-content without touching any declared property), re-measure siblings, revert
  4. any sibling that moved is coupled to j

An item is independent AT a width if no sibling perturbation moves it. It is independent ACROSS
the interval only if that holds at every width, which is what a verification engine needs.

Bias direction, stated up front: the perturbation may fail to disturb some genuinely coupled
pairs, so this UNDER-detects coupling and therefore OVER-reports independence. Any low
independence result is a lower bound on coupling, which makes a negative result stronger.

    python perturb.py --pages 400 --out perturb.json
"""

import argparse, json, statistics, sys
from collections import Counter
from pathlib import Path

WIDTHS = [320, 480, 768, 1024, 1280, 1920]
DEFAULT_PAGES = Path(__file__).with_name("pages.json")

JS = r"""
(cfg) => {
  const MAXC = cfg.maxContainers, MAXK = cfg.maxChildren, EPS = cfg.eps;
  const PROBE = cfg.probePx;
  const out = [];
  let ci = 0;
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (ci >= MAXC) break;
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { continue; }
    const d = cs.display;
    if (d !== 'flex' && d !== 'inline-flex') continue;
    const col = (cs.flexDirection || 'row').startsWith('column');
    const kids = Array.from(el.children).filter(c => {
      const s = getComputedStyle(c);
      return s.position !== 'absolute' && s.position !== 'fixed' && s.display !== 'none';
    });
    if (kids.length < 2 || kids.length > MAXK) continue;

    const sz = c => { const r = c.getBoundingClientRect(); return col ? r.height : r.width; };
    const base = kids.map(sz);
    const contRect = el.getBoundingClientRect();
    const contMain = col ? contRect.height : contRect.width;

    // outer extent of children, to tell "independent because slack" from structural
    let outer = 0;
    for (const c of kids) {
      const s = getComputedStyle(c);
      const m = col ? (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0)
                    : (parseFloat(s.marginLeft) || 0) + (parseFloat(s.marginRight) || 0);
      outer += sz(c) + m;
    }

    // coupling[j][i] = perturbing child j moved child i.
    // BIDIRECTIONAL. Growing a sibling cannot move an item already pinned at its content
    // minimum, but SHRINKING a sibling frees space and can let it expand. Probing only one
    // direction over-reports independence, so we do both and take the union.
    const coupling = kids.map(() => kids.map(() => false));
    const grewOnly = kids.map(() => kids.map(() => false));
    for (let j = 0; j < kids.length; j++) {
      // (1) grow j's content
      const probe = document.createElement('span');
      probe.style.cssText = col
        ? 'display:block;width:1px;height:' + PROBE + 'px;flex:none'
        : 'display:inline-block;width:' + PROBE + 'px;height:1px;flex:none';
      kids[j].appendChild(probe);
      const afterGrow = kids.map(sz);
      probe.remove();

      // (2) shrink j's content to nothing
      const saved = kids[j].innerHTML;
      kids[j].innerHTML = '';
      const afterShrink = kids.map(sz);
      kids[j].innerHTML = saved;

      for (let i = 0; i < kids.length; i++) {
        if (i === j) continue;
        const g = Math.abs(afterGrow[i] - base[i]) > EPS;
        const h = Math.abs(afterShrink[i] - base[i]) > EPS;
        if (g) grewOnly[j][i] = true;
        if (g || h) coupling[j][i] = true;
      }
    }

    // sanity: layout restored after revert
    const restored = kids.map(sz);
    let clean = true;
    for (let i = 0; i < kids.length; i++)
      if (Math.abs(restored[i] - base[i]) > EPS) clean = false;

    out.push({ idx: ci, n: kids.length, col: col, wrap: cs.flexWrap,
               contMain: contMain, childOuter: outer, base: base,
               coupling: coupling, growOnly: grewOnly, clean: clean });
    ci++;
  }
  return out;
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=400)
    ap.add_argument("--src", default=str(DEFAULT_PAGES))
    ap.add_argument("--max-containers", type=int, default=12)
    ap.add_argument("--max-children", type=int, default=8)
    ap.add_argument("--eps", type=float, default=0.5)
    ap.add_argument("--probe-px", type=int, default=300)
    ap.add_argument("--out", default="perturb.json")
    a = ap.parse_args()

    data = json.load(open(a.src, encoding="utf-8"))
    pages = data["pages"][:a.pages]
    print(f"loaded {len(pages)} pages, sweeping widths {WIDTHS}")

    from playwright.sync_api import sync_playwright
    cfg = {"maxContainers": a.max_containers, "maxChildren": a.max_children,
           "eps": a.eps, "probePx": a.probe_px}

    # key: (page, container idx) -> per width: set of independent child indices
    indep_at_width = {}
    seen_container = {}
    per_width_items = Counter()
    per_width_indep = Counter()
    slack_flags = {}
    growonly_at_width = {}
    unclean = 0
    errors = 0
    wrapped_containers = 0

    with sync_playwright() as p:
        br = p.chromium.launch()
        page = br.new_page(viewport={"width": 1280, "height": 900})
        for pi, rec in enumerate(pages):
            try:
                page.set_content(rec["html"], wait_until="load", timeout=15000)
            except Exception:
                errors += 1
                continue
            for W in WIDTHS:
                try:
                    page.set_viewport_size({"width": W, "height": 900})
                    res = page.evaluate(JS, cfg)
                except Exception:
                    errors += 1
                    continue
                for c in res:
                    if not c["clean"]:
                        unclean += 1
                        continue
                    if c["wrap"] and c["wrap"] != "nowrap":
                        wrapped_containers += 1
                        continue
                    key = (pi, c["idx"])
                    n = c["n"]
                    seen_container.setdefault(key, n)
                    if seen_container[key] != n:
                        continue  # container changed shape across widths; skip
                    # item i independent at this width iff no j moved it
                    indep = set()
                    indep_growonly = set()
                    for i in range(n):
                        if not any(c["coupling"][j][i] for j in range(n) if j != i):
                            indep.add(i)
                        if not any(c["growOnly"][j][i] for j in range(n) if j != i):
                            indep_growonly.add(i)
                    growonly_at_width.setdefault(key, []).append(indep_growonly)
                    per_width_items[W] += n
                    per_width_indep[W] += len(indep)
                    indep_at_width.setdefault(key, []).append(indep)
                    slack = c["contMain"] - c["childOuter"]
                    slack_flags.setdefault(key, []).append(slack > 1)
            if (pi + 1) % 50 == 0:
                print(f"  {pi+1}/{len(pages)} pages", file=sys.stderr)
        br.close()

    # across-interval independence: independent at EVERY width measured
    total_items = 0
    indep_items = 0
    growonly_items = [0, 0]
    indep_with_slack = 0
    containers_full_indep = 0
    containers_total = 0
    for key, sets in indep_at_width.items():
        if len(sets) < len(WIDTHS):
            continue  # must be measured at every width
        n = seen_container[key]
        containers_total += 1
        always = set.intersection(*sets)
        go = growonly_at_width.get(key)
        if go and len(go) == len(WIDTHS):
            growonly_items[0] += n
            growonly_items[1] += len(set.intersection(*go))
        total_items += n
        indep_items += len(always)
        if len(always) == n:
            containers_full_indep += 1
        if always and all(slack_flags[key]):
            indep_with_slack += len(always)

    pct = lambda x, d: round(100.0 * x / d, 2) if d else None
    res = {
        "pages_attempted": len(pages),
        "widths": WIDTHS,
        "probe_px": a.probe_px,
        "errors": errors,
        "unclean_reverts": unclean,
        "wrapped_containers_skipped": wrapped_containers,
        "per_width_independent_pct": {str(w): pct(per_width_indep[w], per_width_items[w])
                                      for w in WIDTHS},
        "containers_measured_all_widths": containers_total,
        "items_total": total_items,
        "items_independent_across_interval": indep_items,
        "ACROSS_INTERVAL_INDEPENDENT_PCT": pct(indep_items, total_items),
        "grow_only_probe_would_say_pct": pct(growonly_items[1], growonly_items[0]),
        "containers_fully_decomposable": containers_full_indep,
        "containers_fully_decomposable_pct": pct(containers_full_indep, containers_total),
        "independent_items_that_had_slack_at_all_widths": indep_with_slack,
    }
    json.dump(res, open(a.out, "w"), indent=2)

    print("\n=========== PERTURBATION RESULT (browser ground truth) ===========")
    print(f"pages {len(pages)}   errors {errors}   unclean reverts {unclean}   "
          f"wrapped skipped {wrapped_containers}")
    print("\nindependent at each width, in isolation:")
    for w in WIDTHS:
        print(f"   {w:>5}px : {res['per_width_independent_pct'][str(w)]}%   "
              f"({per_width_indep[w]}/{per_width_items[w]} items)")
    print(f"\ncontainers measured at all widths : {containers_total}")
    print(f"items                              : {total_items}")
    print(f"independent ACROSS the interval    : {indep_items}  "
          f"({res['ACROSS_INTERVAL_INDEPENDENT_PCT']}%)   <-- THE GATE NUMBER")
    print(f"fully decomposable containers      : {containers_full_indep}  "
          f"({res['containers_fully_decomposable_pct']}%)")
    print(f"  of independent items, had slack at every width: {indep_with_slack}")
    print(f"\n  [bias check] grow-only probe would have reported: "
          f"{res['grow_only_probe_would_say_pct']}%  "
          f"({growonly_items[1]}/{growonly_items[0]})")

    g = res["ACROSS_INTERVAL_INDEPENDENT_PCT"]
    print("\n=========== GATE ===========")
    if g is None:
        print("no data")
    elif g >= 50:
        print(f"{g}% independent across the interval -> HYPOTHESIS SURVIVES. Proceed to step 3.")
    elif g >= 20:
        print(f"{g}% -> partial. Sub-fragment exists but is thin. Judgement call.")
    else:
        print(f"{g}% -> NEGATIVE RESULT. No useful sub-fragment. Stop, and the engine's "
              f"contribution is the coupled-container summary.")
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
