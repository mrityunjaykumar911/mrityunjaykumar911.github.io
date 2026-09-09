#!/usr/bin/env python3
"""
Close the two open questions on the coupling result.

(1) STATIC vs ACTIVE coupling. `flex: 0 1 auto` only couples siblings when the container
    overflows and shrinking activates. Using bbox geometry we separate:
      statically coupled : cannot be proven independent from CSS alone   (the 97.5% figure)
      actively coupled   : children's total main-axis extent fills the container, so
                           shrink/grow was plausibly engaged at the observed width
      slack              : measurable free space remains -> not actively coupled here
    Report both. The static number is the sound one for interval verification; the active
    number preempts "your classifier is too strict".

(2) GRID. Classify grid containers by their grid-template-columns track values.

Reuses cached shards.

    python coupling_refine.py --n 6000 --shards 2,3,4
"""

import argparse, json, re
from collections import Counter

REPO = "xcodemind/webcode2m"
FLEX_DISPLAYS = {"flex", "inline-flex", "-webkit-box", "-ms-flexbox", "-moz-flex",
                 "-webkit-inline-box", "-ms-inline-flexbox", "-moz-box"}
GRID_DISPLAYS = {"grid", "inline-grid", "-ms-grid"}
DEFINITE = re.compile(r"^[\d.]+(px|rem|em|vw|vh|ch|ex|cm|mm|in|pt|pc|%)$", re.I)
FR = re.compile(r"^[\d.]+fr$", re.I)
CONTENT_KW = ("auto", "min-content", "max-content", "fit-content")


def sval(style, prop):
    if not style:
        return None
    m = re.search(rf"(?:^|;)\s*{re.escape(prop)}\s*:\s*([^;]+)", style, re.I)
    return m.group(1).strip().lower().replace("!important", "").strip() if m else None


def walk(node):
    stack = [node]
    while stack:
        nd = stack.pop()
        if not isinstance(nd, dict):
            continue
        yield nd
        for ch in nd.get("children") or []:
            stack.append(ch)


def split_top(v):
    out, buf, d = [], [], 0
    for ch in v:
        if ch == "(":
            d += 1; buf.append(ch)
        elif ch == ")":
            d -= 1; buf.append(ch)
        elif ch.isspace() and d == 0:
            if buf: out.append("".join(buf)); buf = []
        else:
            buf.append(ch)
    if buf: out.append("".join(buf))
    return out


def split_args(s):
    out, buf, d = [], [], 0
    for ch in s:
        if ch == "(": d += 1; buf.append(ch)
        elif ch == ")": d -= 1; buf.append(ch)
        elif ch == "," and d == 0: out.append("".join(buf).strip()); buf = []
        else: buf.append(ch)
    if buf: out.append("".join(buf).strip())
    return out


def track_coupled(t):
    t = t.strip().lower()
    if not t: return False
    if t.startswith("repeat(") and t.endswith(")"):
        a = split_args(t[7:-1])
        return any(track_coupled(x) for x in split_top(" ".join(a[1:]) if len(a) > 1 else ""))
    if t.startswith("minmax(") and t.endswith(")"):
        a = split_args(t[7:-1])
        return not (len(a) == 2 and a[0].strip().lower() in ("0", "0px", "0%"))
    if t.startswith("fit-content("): return True
    if t in CONTENT_KW: return True
    if FR.match(t): return True
    if DEFINITE.match(t): return False
    return True


def classify_gtc(v):
    v = (v or "").strip().lower()
    if not v or v in ("none", "inherit", "initial", "unset", "revert"): return "none"
    tr = split_top(v)
    return "coupled" if any(track_coupled(t) for t in tr) else "independent"


def load_rows(n, shards):
    from huggingface_hub import hf_hub_download
    import pyarrow.parquet as pq
    got = 0
    for sh in shards:
        p = hf_hub_download(repo_id=REPO, filename=f"data/{sh:05d}.parquet", repo_type="dataset")
        pf = pq.ParquetFile(p)
        for b in pf.iter_batches(batch_size=64, columns=["bbox"]):
            d = b.to_pydict()
            for i in range(len(d["bbox"])):
                yield d["bbox"][i]
                got += 1
                if got >= n: return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6000)
    ap.add_argument("--shards", default="2,3,4")
    ap.add_argument("--slack", type=float, default=0.05, help="free-space fraction to count as slack")
    ap.add_argument("--out", default="coupling_refine.json")
    a = ap.parse_args()
    shards = [int(x) for x in a.shards.split(",")]

    flex_total = 0
    active = 0
    slack = 0
    degenerate = 0
    slack_hist = Counter()
    grid_total = 0
    grid_cls = Counter()
    grid_vals = Counter()
    pages = 0

    for bj in load_rows(a.n, shards):
        try:
            tree = json.loads(bj)
        except Exception:
            continue
        pages += 1
        for nd in walk(tree):
            st = nd.get("style")
            disp = sval(st, "display")
            if disp in GRID_DISPLAYS:
                grid_total += 1
                gtc = sval(st, "grid-template-columns")
                k = classify_gtc(gtc)
                grid_cls[k] += 1
                if gtc: grid_vals[gtc[:44]] += 1
                continue
            if disp not in FLEX_DISPLAYS:
                continue
            kids = [c for c in (nd.get("children") or []) if isinstance(c, dict)]
            if len(kids) < 2:
                continue
            pb = nd.get("bbox")
            if not (isinstance(pb, list) and len(pb) == 4) or pb[2] <= 0:
                degenerate += 1
                continue
            col = (sval(st, "flex-direction") or "row").startswith("column")
            axis = 3 if col else 2          # h for column, w for row
            parent_extent = pb[3] if col else pb[2]
            tot = 0.0
            bad = False
            for c in kids:
                cb = c.get("bbox")
                if not (isinstance(cb, list) and len(cb) == 4):
                    bad = True; break
                tot += max(0.0, cb[axis])
            if bad or parent_extent <= 0:
                degenerate += 1
                continue
            flex_total += 1
            free = (parent_extent - tot) / parent_extent
            slack_hist[round(min(max(free, -1), 1), 1)] += 1
            if free > a.slack:
                slack += 1
            else:
                active += 1

    pct = lambda x, d: round(100.0 * x / d, 1) if d else None
    res = {
        "pages": pages,
        "flex_containers_measured": flex_total,
        "actively_coupled": active, "actively_coupled_pct": pct(active, flex_total),
        "slack_not_active": slack, "slack_pct": pct(slack, flex_total),
        "degenerate_skipped": degenerate,
        "slack_histogram": {str(k): v for k, v in sorted(slack_hist.items())},
        "grid_containers": grid_total,
        "grid_classification": dict(grid_cls),
        "grid_coupled_pct": pct(grid_cls.get("coupled", 0),
                                grid_cls.get("coupled", 0) + grid_cls.get("independent", 0)),
        "grid_no_tracks_declared": grid_cls.get("none", 0),
        "top_grid_track_values": grid_vals.most_common(15),
    }
    json.dump(res, open(a.out, "w"), indent=2)

    print("\n=========== STATIC vs ACTIVE COUPLING ===========")
    print(f"flex containers measured : {flex_total}   (skipped degenerate: {degenerate})")
    print(f"  actively coupled       : {active}  ({res['actively_coupled_pct']}%)   children fill the container")
    print(f"  slack, not active here : {slack}  ({res['slack_pct']}%)   free space > {int(a.slack*100)}%")
    print("\n  free-space histogram (fraction of container unused):")
    for k, v in sorted(slack_hist.items()):
        print(f"    {k:>5}  {'#' * min(60, v * 60 // max(slack_hist.values()))} {v}")

    print("\n=========== GRID ===========")
    print(f"grid containers          : {grid_total}")
    print(f"  with declared tracks   : {grid_cls.get('coupled',0)+grid_cls.get('independent',0)}")
    print(f"    coupled              : {grid_cls.get('coupled',0)}  ({res['grid_coupled_pct']}%)")
    print(f"    independent          : {grid_cls.get('independent',0)}")
    print(f"  no tracks declared     : {grid_cls.get('none',0)}")
    print("\n  top track values:")
    for v, c in res["top_grid_track_values"]:
        print(f"    {c:>5}  {v}")
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
