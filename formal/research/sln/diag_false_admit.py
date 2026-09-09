#!/usr/bin/env python3
"""
Diagnose a false admit. Immobile is proved sound against MODEL.md, so a real-page violation
means one of three things, and they need separating before anything is concluded:

  (i)   the LABEL is wrong -- the perturbation moved something other than the sibling,
        so the observed movement is not intra-container coupling at all
  (ii)  a measurement PROBE is wrong -- the recovered basis/min/max are not the used values
  (iii) MODEL.md is wrong -- a real mechanism of section 9.7 that the model omits

The obvious suspect for (i): injecting a 300px probe into a sibling can widen the CONTAINER
itself when the container is shrink-to-fit (inline-flex, float, absolutely positioned, a
grid/flex item with auto size). Then every child moves, but through the container's main
size, not through sibling coupling. The engine's contract is per-container and takes the
container's inner main size as GIVEN, so that movement is out of scope by construction and
counting it as coupling mislabels the item.

This script re-renders one page and prints, for each perturbation, whether the container's
own inner main size moved.
"""

import argparse, json
from pathlib import Path

DEFAULT_PAGES = Path(__file__).with_name("pages.json")

JS = r"""
(cfg) => {
  const IDX = cfg.idx, PROBE = cfg.probePx, EPS = cfg.eps;
  const out = [];
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
    const cmain = () => sz(el);
    const base = kids.map(sz), c0 = cmain();

    const par = el.parentElement;
    const pcs = par ? getComputedStyle(par) : null;

    const events = [];
    for (let j = 0; j < kids.length; j++) {
      const probe = document.createElement('span');
      probe.style.cssText = col
        ? 'display:block;width:1px;height:' + PROBE + 'px;flex:none'
        : 'display:inline-block;width:' + PROBE + 'px;height:1px;flex:none';
      kids[j].appendChild(probe);
      const ag = kids.map(sz), cg = cmain();
      probe.remove();

      const saved = kids[j].innerHTML;
      kids[j].innerHTML = '';
      const as = kids.map(sz), csr = cmain();
      kids[j].innerHTML = saved;

      events.push({ j: j,
        grow:   { cont: cg,  kids: ag, contMoved: Math.abs(cg  - c0) > EPS },
        shrink: { cont: csr, kids: as, contMoved: Math.abs(csr - c0) > EPS } });
    }

    out.push({ idx: IDX, col: col, display: d,
               contMain0: c0, base: base,
               containerStyle: { display: d, width: cs.width, flexBasis: cs.flexBasis,
                                 flexGrow: cs.flexGrow, flexShrink: cs.flexShrink,
                                 position: cs.position, float: cs.float },
               parentDisplay: pcs ? pcs.display : null,
               events: events });
    break;
  }
  return out;
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(DEFAULT_PAGES))
    ap.add_argument("--page", type=int, required=True)
    ap.add_argument("--idx", type=int, required=True)
    ap.add_argument("--width", type=int, default=320)
    ap.add_argument("--probe-px", type=int, default=300)
    ap.add_argument("--max-children", type=int, default=8)
    ap.add_argument("--eps", type=float, default=0.5)
    a = ap.parse_args()

    pages = json.load(open(a.src, encoding="utf-8"))["pages"]
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": a.width, "height": 900})
        pg.set_content(pages[a.page]["html"], wait_until="load", timeout=20000)
        pg.set_viewport_size({"width": a.width, "height": 900})
        res = pg.evaluate(JS, {"idx": a.idx, "probePx": a.probe_px, "eps": a.eps,
                               "maxChildren": a.max_children})
        br.close()

    if not res:
        print("container not found")
        return
    c = res[0]
    print(f"page {a.page} container {a.idx} @ {a.width}px   "
          f"{'column' if c['col'] else 'row'}  display={c['display']}")
    print(f"container style : {c['containerStyle']}")
    print(f"parent display  : {c['parentDisplay']}")
    print(f"container main  : {c['contMain0']}")
    print(f"child sizes     : {[round(x,2) for x in c['base']]}")
    print()
    for e in c["events"]:
        for kind in ("grow", "shrink"):
            d = e[kind]
            moved = [i for i, (x, y) in enumerate(zip(d["kids"], c["base"]))
                     if abs(x - y) > a.eps and i != e["j"]]
            flag = "  <<< CONTAINER RESIZED" if d["contMoved"] else ""
            print(f"perturb child {e['j']} [{kind:6}]  container "
                  f"{c['contMain0']:.1f} -> {d['cont']:.1f}{flag}")
            print(f"    siblings moved: {moved}   sizes "
                  f"{[round(x,2) for x in d['kids']]}")


if __name__ == "__main__":
    main()
