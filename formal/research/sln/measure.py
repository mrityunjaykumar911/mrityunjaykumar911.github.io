#!/usr/bin/env python3
"""
Step 3f, part 1. Measure BOTH halves of the scoring problem in one browser pass:

  (a) the LABEL   -- is item i's used main size independent of its siblings, across the
                     viewport interval? By bidirectional perturbation, as in perturb.py.
  (b) the INPUTS  -- item i's own flex base size, used min main size, used max main size,
                     flex-grow and flex-shrink, at each width.

(b) is the part that killed the first attempt at this project. Parsing declared CSS cannot
recover a used flex base size (`flex-basis:auto` -> `width:auto` -> max-content) or an
automatic minimum size (`min-width:auto` -> content-based minimum). Those are content
functions, not declarations. So we do not parse them. We MEASURE them, by construction, in
the same browser that produced the labels.

HOW THE INPUTS ARE MEASURED.

Each probe makes item i inflexible (`flex-grow:0; flex-shrink:0 !important`) so that free
space distribution cannot influence it. Its used main size is then exactly its hypothetical
main size, clamp(basis, min, max), and we steer that expression to isolate one term:

  basis : bounds removed (min 0, max none)      -> clamp(basis, 0, inf)  = basis
  min   : flex-basis forced to 0, bounds kept   -> clamp(0, min, max)    = min
  max   : flex-basis forced huge, min forced 0  -> clamp(HUGE, 0, max)   = max
                                                   (still HUGE => max is infinite)

The container is never touched, so percentage bases and percentage bounds keep resolving
against the same containing block they resolve against in the real layout.

BORDER-BOX OFFSET. getBoundingClientRect returns the border box, so every one of the four
numbers carries the same padding+border offset. The condition under test only ever compares
basis against min and basis against max, so the offset cancels and no unpadding is needed.
Recorded per item anyway, so the assumption is auditable rather than implicit.

    python measure.py --pages 250 --out items.json
"""

import argparse, json, sys
from collections import Counter
from pathlib import Path

WIDTHS = [320, 480, 768, 1024, 1280, 1920]
DEFAULT_PAGES = Path(__file__).with_name("pages.json")
HUGE = 200000          # flex-basis for the max probe
INF_THRESHOLD = 150000  # measured max at or above this means "no maximum"

JS = r"""
(cfg) => {
  const MAXC = cfg.maxContainers, MAXK = cfg.maxChildren, EPS = cfg.eps;
  const PROBE = cfg.probePx, HUGE = cfg.huge;
  const out = [];
  let ci = 0;
  for (const el of document.querySelectorAll('*')) {
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

    // Anonymous flex items. Text sitting directly inside a flex container is wrapped in an
    // anonymous flex item and consumes main-axis space, but it is not an Element, so
    // el.children cannot see it. Left in, the container appears to have fewer items than it
    // really has and the model predicts too much space for the ones it can see. The
    // anonymous item has no style to probe, so the container is skipped rather than guessed.
    let anonText = false;
    for (const nd of el.childNodes)
      if (nd.nodeType === 3 && nd.textContent.trim() !== '') anonText = true;
    if (anonText) { out.push({ idx: ci, skip: 'anonymous_flex_item' }); ci++; continue; }

    const sz = c => { const r = c.getBoundingClientRect(); return col ? r.height : r.width; };
    const contRect = el.getBoundingClientRect();
    // container padding+border on the main axis, so the CONTENT box is recoverable:
    // step 1 of 9.7 compares outer hypothetical sizes against the container's inner size.
    const contPB = col
      ? (parseFloat(cs.paddingTop)  || 0) + (parseFloat(cs.paddingBottom) || 0) +
        (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
      : (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight)  || 0) +
        (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const contMain0 = col ? contRect.height : contRect.width;
    const base0 = kids.map(sz);          // sizes BEFORE pinning, to verify pinning is inert

    // ---------------- PIN THE CONTAINER ----------------
    // The engine's contract is per container and takes the container's inner main size as
    // GIVEN: "for this container at this width, are the item sizes decoupled?" A content-sized
    // container (a column flex with auto height, an inline-flex, a float, a shrink-to-fit
    // block) resizes when a child's content changes, and then EVERY child moves -- through the
    // container's size, not through sibling coupling. Left unpinned, that mislabels
    // structurally independent items as coupled, in the direction that UNDER-reports
    // independence. So the main size is fixed for the duration of the probes, and the
    // container is made inflexible so an ancestor flex layout cannot resize it either.
    //
    // BOTH AXES are pinned, not just the main one. A container that is content-sized on the
    // CROSS axis feeds back: a wide probe widens the container, which changes an item's cross
    // size, which changes its content-based main size and its automatic minimum size. The item
    // then moves without any main-axis coupling at all. Assumption A1 in MODEL.md is exactly
    // that flex base size and used min are functions of the item and the container, so a
    // measurement that lets the container move is measuring a different question.
    const contCross0 = col ? contRect.width : contRect.height;
    const crossPB = col
      ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight)  || 0) +
        (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
      : (parseFloat(cs.paddingTop)  || 0) + (parseFloat(cs.paddingBottom) || 0) +
        (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const bb = cs.boxSizing === 'border-box';
    const savedCont = el.getAttribute('style');
    const restoreCont = () => {
      if (savedCont === null) el.removeAttribute('style');
      else el.setAttribute('style', savedCont);
    };
    const CP = (p, v) => el.style.setProperty(p, v, 'important');
    // border-box containers take the border box; content-box containers take the inner size.
    const mainPx  = (bb ? contMain0  : contMain0  - contPB)  + 'px';
    const crossPx = (bb ? contCross0 : contCross0 - crossPB) + 'px';
    CP(col ? 'height' : 'width',  mainPx);
    CP(col ? 'width'  : 'height', crossPx);
    for (const p of ['min-width', 'min-height']) CP(p, '0');
    for (const p of ['max-width', 'max-height']) CP(p, 'none');
    CP('flex-grow', '0'); CP('flex-shrink', '0'); CP('flex-basis', 'auto');

    // Pinning must be a no-op on the current layout. If it is not, the container's size was
    // not reproducible and every number below would be measured against a different layout.
    const pinnedMain = sz(el);
    const base = kids.map(sz);
    let pinOK = Math.abs(pinnedMain - contMain0) <= EPS;
    for (let i = 0; i < kids.length; i++)
      if (Math.abs(base[i] - base0[i]) > EPS) pinOK = false;

    // ---------------- (a) LABEL: bidirectional sibling perturbation ----------------
    // With the container pinned, any movement in item i IS sibling coupling through 9.7.
    // contDrift counts probes where the pin failed to hold; a nonzero count invalidates the
    // container rather than being quietly averaged away.
    const coupling = kids.map(() => kids.map(() => false));
    let contDrift = 0;
    for (let j = 0; j < kids.length; j++) {
      const probe = document.createElement('span');
      probe.style.cssText = col
        ? 'display:block;width:1px;height:' + PROBE + 'px;flex:none'
        : 'display:inline-block;width:' + PROBE + 'px;height:1px;flex:none';
      kids[j].appendChild(probe);
      const afterGrow = kids.map(sz);
      if (Math.abs(sz(el) - contMain0) > EPS) contDrift++;
      probe.remove();

      const saved = kids[j].innerHTML;
      kids[j].innerHTML = '';
      const afterShrink = kids.map(sz);
      if (Math.abs(sz(el) - contMain0) > EPS) contDrift++;
      kids[j].innerHTML = saved;

      for (let i = 0; i < kids.length; i++) {
        if (i === j) continue;
        if (Math.abs(afterGrow[i]   - base[i]) > EPS) coupling[j][i] = true;
        if (Math.abs(afterShrink[i] - base[i]) > EPS) coupling[j][i] = true;
      }
    }

    // ---------------- (b) INPUTS: per-item measurement by construction --------------
    const MAIN_MIN = col ? 'min-height' : 'min-width';
    const MAIN_MAX = col ? 'max-height' : 'max-width';
    const items = [];
    let probeFail = false;

    for (let k = 0; k < kids.length; k++) {
      const it = kids[k];
      const savedStyle = it.getAttribute('style');
      const restore = () => {
        if (savedStyle === null) it.removeAttribute('style');
        else it.setAttribute('style', savedStyle);
      };
      const P = (p, v) => it.style.setProperty(p, v, 'important');
      const inflex = () => { P('flex-grow', '0'); P('flex-shrink', '0'); };

      const ks = getComputedStyle(it);
      const g = parseFloat(ks.flexGrow)   || 0;
      const s = parseFloat(ks.flexShrink);
      const pb = col
        ? (parseFloat(ks.paddingTop)  || 0) + (parseFloat(ks.paddingBottom) || 0) +
          (parseFloat(ks.borderTopWidth) || 0) + (parseFloat(ks.borderBottomWidth) || 0)
        : (parseFloat(ks.paddingLeft) || 0) + (parseFloat(ks.paddingRight)  || 0) +
          (parseFloat(ks.borderLeftWidth) || 0) + (parseFloat(ks.borderRightWidth) || 0);
      const mg = col
        ? (parseFloat(ks.marginTop)  || 0) + (parseFloat(ks.marginBottom) || 0)
        : (parseFloat(ks.marginLeft) || 0) + (parseFloat(ks.marginRight)  || 0);

      // basis: inflexible, bounds removed
      inflex(); P(MAIN_MIN, '0'); P(MAIN_MAX, 'none');
      const basis = sz(it);
      restore();

      // min: inflexible, flex-basis 0, author bounds intact
      inflex(); P('flex-basis', '0px');
      const minv = sz(it);
      restore();

      // max: inflexible, flex-basis huge, min removed
      inflex(); P('flex-basis', HUGE + 'px'); P(MAIN_MIN, '0');
      const maxv = sz(it);
      restore();

      if (Math.abs(sz(it) - base[k]) > EPS) probeFail = true;

      items.push({ g: g, s: (isNaN(s) ? 1 : s), basis: basis, min: minv, max: maxv,
                   used: base[k], pb: pb, mg: mg });
    }

    // sanity: whole container restored, and the pin held throughout
    const restored = kids.map(sz);
    let clean = !probeFail && pinOK && contDrift === 0;
    for (let i = 0; i < kids.length; i++)
      if (Math.abs(restored[i] - base[i]) > EPS) clean = false;

    restoreCont();

    out.push({ idx: ci, n: kids.length, col: col, wrap: cs.flexWrap,
               contMain: contMain0, contPB: contPB, boxSizing: cs.boxSizing,
               // main-axis gap. Section 9.7 step 1 subtracts the gaps from the free space
               // before anything is distributed. It is a container constant, so it changes
               // the layout but cannot change an item-local condition.
               gap: (function () {
                 const g = col ? cs.rowGap : cs.columnGap;
                 const v = parseFloat(g);
                 return isNaN(v) ? 0 : v;   // 'normal' resolves to 0 for flex
               })(),
               justify: cs.justifyContent,
               pinOK: pinOK, contDrift: contDrift,
               items: items, coupling: coupling, clean: clean });
    ci++;
  }
  return out;
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=250)
    ap.add_argument("--src", default=str(DEFAULT_PAGES))
    ap.add_argument("--max-containers", type=int, default=12)
    ap.add_argument("--max-children", type=int, default=8)
    ap.add_argument("--eps", type=float, default=0.5)
    ap.add_argument("--probe-px", type=int, default=300)
    ap.add_argument("--out", default="items.json")
    a = ap.parse_args()

    data = json.load(open(a.src, encoding="utf-8"))
    pages = data["pages"][:a.pages]
    print(f"loaded {len(pages)} pages, widths {WIDTHS}")

    from playwright.sync_api import sync_playwright
    cfg = {"maxContainers": a.max_containers, "maxChildren": a.max_children,
           "eps": a.eps, "probePx": a.probe_px, "huge": HUGE}

    records = {}     # (page, container) -> {width -> container record}
    skip = Counter()
    errors = 0

    with sync_playwright() as p:
        br = p.chromium.launch()
        page = br.new_page(viewport={"width": 1280, "height": 900})
        # Block every external request. WebCode2M inlines the CSS, so a page's layout is
        # self-contained, but its <img> and font URLs point at the live web. Those are
        # unreachable from here and would resolve differently on any other machine, which
        # makes the measurement non-reproducible and slow. Blocking them explicitly is both
        # faster and deterministic. Stated cost: images without intrinsic dimensions collapse
        # to their alt-text size, so this corpus under-represents image-driven flex bases.
        # Both the label and the inputs are read from the SAME rendered page, so the label
        # and the condition always agree about what the content is.
        page.route("**/*", lambda route: (route.continue_()
                                          if route.request.url.startswith(("data:", "about:"))
                                          else route.abort()))
        for pi, rec in enumerate(pages):
            try:
                page.set_content(rec["html"], wait_until="domcontentloaded", timeout=15000)
                # Kill transitions and animations before anything is measured.
                #
                # This is not cosmetic. In the CSS cascade a running TRANSITION outranks
                # everything, including author !important and inline !important. A page with
                # `transition: all .3s` therefore swallows every property the probes set: the
                # override lands in the style attribute, a transition starts from the OLD
                # value, and the immediate read back returns the old value. The probe then
                # silently measures the unmodified element. It also corrupts the labels,
                # because a size read mid-transition is not the settled layout.
                # Verified on page 638: `color: rgb(1,2,3) !important` read back as the
                # author's colour until transitions were disabled.
                page.add_style_tag(content=(
                    "*,*::before,*::after{"
                    "transition:none !important;"
                    "animation:none !important;"
                    "animation-duration:0s !important;"
                    "transition-duration:0s !important;"
                    "caret-color:transparent !important}"))
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
                    if c.get("skip"):
                        skip[c["skip"]] += 1
                        continue
                    if not c.get("pinOK", True):
                        skip["pin_failed"] += 1
                        continue
                    if c.get("contDrift", 0):
                        skip["container_drifted"] += 1
                        continue
                    if not c["clean"]:
                        skip["unclean_revert"] += 1
                        continue
                    if c["wrap"] and c["wrap"] != "nowrap":
                        skip["wrapped"] += 1
                        continue
                    key = f"{pi}:{c['idx']}"
                    records.setdefault(key, {})[str(W)] = c
            if (pi + 1) % 25 == 0:
                print(f"  {pi+1}/{len(pages)} pages", file=sys.stderr)
        br.close()

    # keep only containers measured at EVERY width with a stable child count
    kept = {}
    for key, byw in records.items():
        if len(byw) != len(WIDTHS):
            skip["not_all_widths"] += 1
            continue
        ns = {byw[str(w)]["n"] for w in WIDTHS}
        if len(ns) != 1:
            skip["shape_changed"] += 1
            continue
        kept[key] = byw

    n_items = sum(next(iter(v.values()))["n"] for v in kept.values())
    out = {"widths": WIDTHS, "huge": HUGE, "inf_threshold": INF_THRESHOLD,
           "pages": len(pages), "errors": errors, "skipped": dict(skip),
           "containers": len(kept), "items": n_items, "data": kept}
    json.dump(out, open(a.out, "w"))

    print(f"\ncontainers measured at all widths : {len(kept)}")
    print(f"items                             : {n_items}")
    print(f"errors {errors}   skipped {dict(skip)}")
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
