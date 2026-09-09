#!/usr/bin/env python3
"""
Step 2d, part 1. Extract real flex container configurations from the cached WebCode2M shards
into a compact JSON file, so the width-sweep analysis can run elsewhere.

This does NO analysis. It only pulls out what the sweep needs, so the output stays small.

    python extract_containers.py --n 12000 --shards 2,3,4 --out containers.json

Output is one record per usable flex container:
  C     container observed main size (px)
  dir   "row" | "column"
  items list of {g, s, b, mn, mx, m, obs}
          g/s   grow, shrink factors as strings (Fraction-safe)
          b     declared definite basis, or null if not observable
          mn/mx declared min/max main size, or null
          m     total main-axis margin
          obs   observed used main size (px)
"""

import argparse, json, re
from fractions import Fraction as F
from collections import Counter

REPO = "xcodemind/webcode2m"
FLEX_DISPLAYS = {"flex", "inline-flex", "-webkit-box", "-ms-flexbox", "-moz-flex",
                 "-webkit-inline-box", "-ms-inline-flexbox", "-moz-box"}
LEN = re.compile(r"^(-?[\d.]+)(px|%)?$", re.I)


def sval(style, prop):
    if not style:
        return None
    m = re.search(rf"(?:^|;)\s*{re.escape(prop)}\s*:\s*([^;]+)", style, re.I)
    return m.group(1).strip().lower().replace("!important", "").strip() if m else None


def length(v, pct_base=None):
    if v is None:
        return None
    v = v.strip().lower()
    if v == "0":
        return F(0)
    m = LEN.match(v)
    if not m:
        return None
    val, unit = F(m.group(1)), (m.group(2) or "").lower()
    if unit == "px":
        return val
    if unit == "%":
        return None if pct_base is None else val * F(pct_base) / 100
    return None


def parse_flex(v):
    if v is None:
        return None
    v = v.strip().lower()
    if v == "none":
        return (F(0), F(0), "auto")
    if v == "auto":
        return (F(1), F(1), "auto")
    if v in ("initial", "unset", "revert"):
        return (F(0), F(1), "auto")
    parts, nums, basis = v.split(), [], None
    for p in parts:
        if re.match(r"^[\d.]+$", p):
            nums.append(F(p))
        else:
            basis = p
    grow = nums[0] if nums else F(0)
    shrink = nums[1] if len(nums) > 1 else F(1)
    if basis is None:
        basis = "0%" if len(nums) == 1 else "auto"
    return (grow, shrink, basis)


def child_props(style, C):
    sh = parse_flex(sval(style, "flex"))
    if sh:
        grow, shrink, basis_s = sh
    else:
        g, s, b = sval(style, "flex-grow"), sval(style, "flex-shrink"), sval(style, "flex-basis")
        grow = F(g) if g and re.match(r"^[\d.]+$", g) else F(0)
        shrink = F(s) if s and re.match(r"^[\d.]+$", s) else F(1)
        basis_s = b or "auto"
    basis = length(basis_s, C)
    if basis is None and basis_s in ("auto", "content"):
        basis = length(sval(style, "width"), C)
    return grow, shrink, basis


def margin_main(style, C, col):
    def one(v):
        if v is None:
            return None, False
        v = v.strip().lower()
        if v == "auto":
            return None, True
        return length(v, C), False
    top = right = bottom = left = None
    auto = False
    sh = sval(style, "margin")
    if sh:
        vals = []
        for p in sh.split():
            v, au = one(p)
            auto = auto or au
            vals.append(v)
        if len(vals) == 1:
            top = right = bottom = left = vals[0]
        elif len(vals) == 2:
            top = bottom = vals[0]; right = left = vals[1]
        elif len(vals) == 3:
            top, right, bottom, left = vals[0], vals[1], vals[2], vals[1]
        elif len(vals) >= 4:
            top, right, bottom, left = vals[0], vals[1], vals[2], vals[3]
    for name in ("margin-top", "margin-right", "margin-bottom", "margin-left"):
        raw = sval(style, name)
        if raw is not None:
            v, au = one(raw)
            auto = auto or au
            if name.endswith("top"): top = v
            elif name.endswith("right"): right = v
            elif name.endswith("bottom"): bottom = v
            else: left = v
    z = lambda x: F(0) if x is None else x
    return (z(top) + z(bottom) if col else z(left) + z(right)), auto


def walk(node):
    stack = [node]
    while stack:
        nd = stack.pop()
        if not isinstance(nd, dict):
            continue
        yield nd
        for ch in nd.get("children") or []:
            stack.append(ch)


def contained(cb, pb, tol=1.0):
    try:
        cx, cy, cw, chh = cb
        px, py, pw, ph = pb
    except Exception:
        return None
    return (cx >= px - tol and cy >= py - tol and
            cx + cw <= px + pw + tol and cy + chh <= py + ph + tol)


def load_rows(n, shards):
    from huggingface_hub import hf_hub_download
    import pyarrow.parquet as pq
    got = 0
    for sh in shards:
        p = hf_hub_download(repo_id=REPO, filename=f"data/{sh:05d}.parquet", repo_type="dataset")
        for b in pq.ParquetFile(p).iter_batches(batch_size=64, columns=["bbox"]):
            d = b.to_pydict()
            for i in range(len(d["bbox"])):
                yield d["bbox"][i]
                got += 1
                if got >= n:
                    return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12000)
    ap.add_argument("--shards", default="2,3,4")
    ap.add_argument("--out", default="containers.json")
    a = ap.parse_args()
    shards = [int(x) for x in a.shards.split(",")]

    out, skip = [], Counter()
    pages = 0

    for bj in load_rows(a.n, shards):
        try:
            tree = json.loads(bj)
        except Exception:
            continue
        pages += 1
        for nd in walk(tree):
            st = nd.get("style")
            if sval(st, "display") not in FLEX_DISPLAYS:
                continue
            pb = nd.get("bbox")
            if not (isinstance(pb, list) and len(pb) == 4):
                skip["bad_container_bbox"] += 1
                continue
            wrap = sval(st, "flex-wrap") or "nowrap"
            if "wrap" in wrap and wrap != "nowrap":
                skip["wrapped"] += 1
                continue
            col = (sval(st, "flex-direction") or "row").startswith("column")
            axis = 3 if col else 2
            C = pb[axis]
            if C <= 0:
                skip["zero_container"] += 1
                continue

            kids = []
            for c in (nd.get("children") or []):
                if not isinstance(c, dict):
                    continue
                cs = c.get("style")
                if (sval(cs, "position") or "static") in ("absolute", "fixed"):
                    continue
                if (sval(cs, "display") or "") == "none":
                    continue
                kids.append(c)
            if len(kids) < 2:
                skip["fewer_than_2_items"] += 1
                continue
            if any(contained(c.get("bbox"), pb) is False for c in kids):
                skip["escaping"] += 1
                continue

            items, bad = [], False
            for c in kids:
                cb = c.get("bbox")
                if not (isinstance(cb, list) and len(cb) == 4):
                    bad = True
                    break
                cs = c.get("style")
                g, s, b = child_props(cs, F(C))
                m, auto = margin_main(cs, F(C), col)
                if auto:
                    bad = True
                    break
                mn = length(sval(cs, "min-height" if col else "min-width"), F(C))
                mx = length(sval(cs, "max-height" if col else "max-width"), F(C))
                items.append({"g": str(g), "s": str(s),
                              "b": None if b is None else float(b),
                              "mn": None if mn is None else float(mn),
                              "mx": None if mx is None else float(mx),
                              "m": float(m), "obs": cb[axis]})
            if bad:
                skip["bad_child_or_auto_margin"] += 1
                continue

            out.append({"C": C, "dir": "column" if col else "row", "items": items})

    with open(a.out, "w") as f:
        json.dump({"pages": pages, "skipped": dict(skip), "containers": out}, f)

    import os
    print(f"pages scanned      : {pages}")
    print(f"containers written : {len(out)}")
    for k, v in skip.most_common():
        print(f"  skipped {k:26}: {v}")
    print(f"\nwrote {a.out}  ({os.path.getsize(a.out)/1e6:.1f} MB)")
    print("\nStage this file back for the sweep analysis.")


if __name__ == "__main__":
    main()
