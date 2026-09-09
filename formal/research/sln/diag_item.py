#!/usr/bin/env python3
"""
Dump the raw computed style and the step-by-step probe readings for one flex item, so a
fidelity mismatch or a false admit can be attributed to a specific cause rather than guessed
at.

    python diag_item.py --page 638 --idx 2 --width 320
"""

import argparse, json
from pathlib import Path

DEFAULT_PAGES = Path(__file__).with_name("pages.json")

JS = r"""
(cfg) => {
  const IDX = cfg.idx, HUGE = cfg.huge;
  let ci = 0;
  for (const el of document.querySelectorAll('*')) {
    let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
    const d = cs.display;
    if (d !== 'flex' && d !== 'inline-flex') continue;
    const col = (cs.flexDirection || 'row').startsWith('column');
    const kids = Array.from(el.children).filter(c => {
      const s = getComputedStyle(c);
      return s.position !== 'absolute' && s.position !== 'fixed' && s.display !== 'none';
    });
    if (kids.length < 2 || kids.length > cfg.maxChildren) continue;
    if (ci !== IDX) { ci++; continue; }

    const sz = c => { const r = c.getBoundingClientRect(); return col ? r.height : r.width; };
    const contRect = el.getBoundingClientRect();
    const contMain0 = col ? contRect.height : contRect.width;
    const contCross0 = col ? contRect.width : contRect.height;
    const num = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
    const contPB = col
      ? num(cs.paddingTop)+num(cs.paddingBottom)+num(cs.borderTopWidth)+num(cs.borderBottomWidth)
      : num(cs.paddingLeft)+num(cs.paddingRight)+num(cs.borderLeftWidth)+num(cs.borderRightWidth);
    const crossPB = col
      ? num(cs.paddingLeft)+num(cs.paddingRight)+num(cs.borderLeftWidth)+num(cs.borderRightWidth)
      : num(cs.paddingTop)+num(cs.paddingBottom)+num(cs.borderTopWidth)+num(cs.borderBottomWidth);
    const bb = cs.boxSizing === 'border-box';

    const savedCont = el.getAttribute('style');
    const CP = (p, v) => el.style.setProperty(p, v, 'important');
    CP(col ? 'height' : 'width',  (bb ? contMain0  : contMain0  - contPB)  + 'px');
    CP(col ? 'width'  : 'height', (bb ? contCross0 : contCross0 - crossPB) + 'px');
    for (const p of ['min-width','min-height']) CP(p,'0');
    for (const p of ['max-width','max-height']) CP(p,'none');
    CP('flex-grow','0'); CP('flex-shrink','0'); CP('flex-basis','auto');

    const MAIN_MIN = col ? 'min-height' : 'min-width';
    const MAIN_MAX = col ? 'max-height' : 'max-width';
    const rows = [];
    for (let k = 0; k < kids.length; k++) {
      const it = kids[k];
      const saved = it.getAttribute('style');
      const restore = () => { if (saved === null) it.removeAttribute('style');
                              else it.setAttribute('style', saved); };
      const P = (p,v) => it.style.setProperty(p,v,'important');
      const inflex = () => { P('flex-grow','0'); P('flex-shrink','0'); };
      const ks = getComputedStyle(it);
      const used = sz(it);

      inflex(); P(MAIN_MIN,'0'); P(MAIN_MAX,'none');
      const basis = sz(it); restore();
      inflex(); P('flex-basis','0px');
      const minv = sz(it); restore();
      inflex(); P('flex-basis', HUGE+'px'); P(MAIN_MIN,'0');
      const maxv = sz(it); restore();

      rows.push({ k: k, tag: it.tagName, cls: (it.className || '').toString().slice(0,60),
                  used: used, basis: basis, min: minv, max: maxv,
                  style: { display: ks.display, position: ks.position, boxSizing: ks.boxSizing,
                    flexGrow: ks.flexGrow, flexShrink: ks.flexShrink, flexBasis: ks.flexBasis,
                    width: ks.width, height: ks.height,
                    minWidth: ks.minWidth, maxWidth: ks.maxWidth,
                    minHeight: ks.minHeight, maxHeight: ks.maxHeight,
                    overflow: ks.overflow, aspectRatio: ks.aspectRatio,
                    alignSelf: ks.alignSelf } });
    }
    if (savedCont === null) el.removeAttribute('style');
    else el.setAttribute('style', savedCont);

    return { col: col, display: d, contMain: contMain0, contPB: contPB,
             gap: num(col ? cs.rowGap : cs.columnGap),
             justify: cs.justifyContent, align: cs.alignItems,
             boxSizing: cs.boxSizing, rows: rows };
  }
  return null;
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(DEFAULT_PAGES))
    ap.add_argument("--page", type=int, required=True)
    ap.add_argument("--idx", type=int, required=True)
    ap.add_argument("--width", type=int, default=320)
    ap.add_argument("--max-children", type=int, default=8)
    a = ap.parse_args()

    pages = json.load(open(a.src, encoding="utf-8"))["pages"]
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": a.width, "height": 900})
        pg.route("**/*", lambda r: (r.continue_() if r.request.url.startswith(("data:", "about:"))
                                    else r.abort()))
        pg.set_content(pages[a.page]["html"], wait_until="domcontentloaded", timeout=20000)
        pg.add_style_tag(content=("*,*::before,*::after{transition:none !important;"
                                  "animation:none !important}"))
        pg.set_viewport_size({"width": a.width, "height": 900})
        res = pg.evaluate(JS, {"idx": a.idx, "huge": 200000, "maxChildren": a.max_children})
        br.close()

    if not res:
        print("container not found")
        return
    print(f"page {a.page} container {a.idx} @{a.width}px  "
          f"{'COLUMN' if res['col'] else 'ROW'}  display={res['display']}")
    print(f"container inner main {res['contMain'] - res['contPB']}  gap {res['gap']}  "
          f"justify {res['justify']}  align {res['align']}  boxSizing {res['boxSizing']}")
    for r in res["rows"]:
        print(f"\n item {r['k']}  <{r['tag']} class='{r['cls']}'>")
        print(f"   used {r['used']:.3f}   basis {r['basis']:.3f}   "
              f"min {r['min']:.3f}   max {r['max']:.3f}")
        for k, v in r["style"].items():
            print(f"     {k:12} {v}")


if __name__ == "__main__":
    main()
