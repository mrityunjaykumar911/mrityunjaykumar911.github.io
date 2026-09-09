#!/usr/bin/env python3
"""
Settle the dataset question, then compute the coupling score.

PART A (gate). Are the bbox `style` strings resolved from stylesheet rules, or only inline
style attributes? If only inline, then "a child with no flex declaration takes the default
flex: 0 1 auto" is unsound and inflates the coupled count. We test this by comparing the
number of inline style="" attributes in the raw HTML against the number of styled nodes in
the bbox tree.

PART B (score). Over real flex containers, classify each child as independent /
independent_if_width_set / coupled, flag escaping descendants using bbox geometry, and report
the decomposable-container fraction. That fraction is the number the decision rule needs.

Reuses the cached parquet shard. No re-download.

    python coupling_score.py --n 2000
    python coupling_score.py --n 4000 --shards 2,3
"""

import argparse, json, re
from collections import Counter

REPO = "xcodemind/webcode2m"

FLEX_DISPLAYS = {"flex", "inline-flex", "-webkit-box", "-ms-flexbox", "-moz-flex",
                 "-webkit-inline-box", "-ms-inline-flexbox", "-moz-box"}
GRID_DISPLAYS = {"grid", "inline-grid", "-ms-grid"}
DEFINITE = re.compile(r"^[\d.]+(px|rem|em|vw|vh|ch|ex|cm|mm|in|pt|pc|%)$", re.I)
INLINE_STYLE_ATTR = re.compile(r'style\s*=\s*["\']', re.I)


def sval(style, prop):
    if not style:
        return None
    m = re.search(rf"(?:^|;)\s*{re.escape(prop)}\s*:\s*([^;]+)", style, re.I)
    return m.group(1).strip().lower().replace("!important", "").strip() if m else None


def parse_flex(v):
    if v is None:
        return None
    v = v.strip().lower()
    if v == "none":
        return (0.0, 0.0, "auto")
    if v == "auto":
        return (1.0, 1.0, "auto")
    if v in ("initial", "unset", "revert"):
        return (0.0, 1.0, "auto")
    parts, nums, basis = v.split(), [], None
    for p in parts:
        if re.match(r"^[\d.]+$", p):
            nums.append(float(p))
        else:
            basis = p
    grow = nums[0] if nums else 0.0
    shrink = nums[1] if len(nums) > 1 else 1.0
    if basis is None:
        basis = "0%" if len(nums) == 1 else "auto"
    return (grow, shrink, basis)


def classify_child(style):
    """independent | independent_if_width_set | coupled  (+ reason)"""
    fl = parse_flex(sval(style, "flex"))
    if fl is None:
        g = sval(style, "flex-grow")
        s = sval(style, "flex-shrink")
        b = sval(style, "flex-basis")
        if g is None and s is None and b is None:
            # no flex declaration at all -> CSS default 0 1 auto -> shrinkable, content basis
            return "coupled", "default_0_1_auto"
        grow = float(g) if g and re.match(r"^[\d.]+$", g) else 0.0
        shrink = float(s) if s and re.match(r"^[\d.]+$", s) else 1.0
        basis = b or "auto"
        fl = (grow, shrink, basis)
    grow, shrink, basis = fl
    basis_definite = bool(DEFINITE.match(basis)) or basis in ("0", "0px", "0%")
    minw = sval(style, "min-width")
    minw_zero = minw in ("0", "0px", "0%")

    if grow == 0.0 and shrink == 0.0 and basis_definite:
        return "independent", "no_grow_no_shrink_definite_basis"
    if grow == 0.0 and shrink == 0.0 and basis == "auto":
        w = sval(style, "width")
        if w and DEFINITE.match(w):
            return "independent", "flex_none_with_definite_width"
        return "independent_if_width_set", "flex_none_width_unknown"
    if basis in ("0", "0px", "0%") and minw_zero:
        return "independent", "zero_basis_min_width_zero"
    return "coupled", "grow_or_shrink_active"


def contained(child_bb, parent_bb, tol=1.0):
    try:
        cx, cy, cw, ch = child_bb
        px, py, pw, ph = parent_bb
    except Exception:
        return None
    return (cx >= px - tol and cy >= py - tol and
            cx + cw <= px + pw + tol and cy + ch <= py + ph + tol)


def walk(node):
    stack = [node]
    while stack:
        nd = stack.pop()
        if not isinstance(nd, dict):
            continue
        yield nd
        for ch in nd.get("children") or []:
            stack.append(ch)


def load_rows(n, shards):
    from huggingface_hub import hf_hub_download
    import pyarrow.parquet as pq
    got = 0
    for sh in shards:
        fn = f"data/{sh:05d}.parquet"
        path = hf_hub_download(repo_id=REPO, filename=fn, repo_type="dataset")
        pf = pq.ParquetFile(path)
        for batch in pf.iter_batches(batch_size=64, columns=["bbox", "text"]):
            d = batch.to_pydict()
            for i in range(len(d["bbox"])):
                yield d["bbox"][i], d["text"][i]
                got += 1
                if got >= n:
                    return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--shards", default="2")
    ap.add_argument("--out", default="coupling_score.json")
    a = ap.parse_args()
    shards = [int(x) for x in a.shards.split(",")]

    inline_attrs = 0
    styled_nodes = 0
    total_nodes = 0
    pages = 0

    containers = 0
    containers_escaping = 0
    containers_decomposable = 0
    containers_coupled = 0
    containers_conditional = 0
    child_cls = Counter()
    reasons = Counter()
    grid_containers = 0
    samples = []

    for bbox_json, html in load_rows(a.n, shards):
        try:
            tree = json.loads(bbox_json)
        except Exception:
            continue
        pages += 1
        inline_attrs += len(INLINE_STYLE_ATTR.findall(html or ""))

        for nd in walk(tree):
            total_nodes += 1
            st = nd.get("style")
            if st:
                styled_nodes += 1
            disp = sval(st, "display")
            if disp in GRID_DISPLAYS:
                grid_containers += 1
            if disp not in FLEX_DISPLAYS:
                continue
            kids = [c for c in (nd.get("children") or []) if isinstance(c, dict)]
            if len(kids) < 2:
                continue  # a container with <2 children has no sibling coupling to speak of
            containers += 1

            esc = False
            for c in kids:
                r = contained(c.get("bbox"), nd.get("bbox"))
                if r is False:
                    esc = True
                    break
            if esc:
                containers_escaping += 1
                continue  # excluded by the cut rule

            verdicts = []
            for c in kids:
                v, why = classify_child(c.get("style"))
                child_cls[v] += 1
                reasons[why] += 1
                verdicts.append(v)

            if all(v == "independent" for v in verdicts):
                containers_decomposable += 1
                if len(samples) < 6:
                    samples.append({"bbox": nd.get("bbox"), "style": (nd.get("style") or "")[:120],
                                    "n_children": len(kids), "verdict": "decomposable"})
            elif any(v == "coupled" for v in verdicts):
                containers_coupled += 1
            else:
                containers_conditional += 1

    # ---- Part A verdict
    ratio = (styled_nodes / inline_attrs) if inline_attrs else float("inf")
    if ratio >= 2.0:
        gate = "SOUND: tree styles far exceed inline style attributes -> stylesheet rules ARE resolved into the tree"
    elif ratio >= 1.2:
        gate = "LIKELY SOUND: tree styles exceed inline attributes, some rule resolution"
    else:
        gate = "UNSOUND: tree styles ~= inline attributes -> only inline styles captured; 'absence implies default' inflates coupled counts"

    analyzed = containers - containers_escaping
    pct = lambda x, d: round(100.0 * x / d, 1) if d else None

    res = {
        "pages": pages, "total_nodes": total_nodes,
        "styled_nodes": styled_nodes, "inline_style_attrs": inline_attrs,
        "styled_to_inline_ratio": round(ratio, 2) if ratio != float("inf") else None,
        "gate_verdict": gate,
        "grid_containers": grid_containers,
        "flex_containers_2plus_children": containers,
        "excluded_escaping_descendants": containers_escaping,
        "analyzed": analyzed,
        "decomposable": containers_decomposable,
        "conditional": containers_conditional,
        "coupled": containers_coupled,
        "decomposable_pct": pct(containers_decomposable, analyzed),
        "conditional_pct": pct(containers_conditional, analyzed),
        "coupled_pct": pct(containers_coupled, analyzed),
        "escaping_pct_of_containers": pct(containers_escaping, containers),
        "child_classification": dict(child_cls),
        "reasons": dict(reasons),
        "samples": samples,
    }
    json.dump(res, open(a.out, "w"), indent=2)

    print("\n================ PART A: DATASET GATE ================")
    print(f"pages {pages}   nodes {total_nodes}   styled nodes {styled_nodes}   inline style= attrs {inline_attrs}")
    print(f"styled/inline ratio: {res['styled_to_inline_ratio']}")
    print(gate)

    print("\n================ PART B: COUPLING SCORE ================")
    print(f"flex containers with >=2 children : {containers}")
    print(f"  excluded, escaping descendants  : {containers_escaping}  ({res['escaping_pct_of_containers']}%)")
    print(f"  analyzed                        : {analyzed}")
    print(f"    decomposable                  : {containers_decomposable}  ({res['decomposable_pct']}%)")
    print(f"    conditional (needs width info): {containers_conditional}  ({res['conditional_pct']}%)")
    print(f"    coupled                       : {containers_coupled}  ({res['coupled_pct']}%)")
    print(f"grid containers seen              : {grid_containers}")
    print(f"\nchild classification: {dict(child_cls)}")
    print(f"reasons: {dict(reasons)}")

    d = res["decomposable_pct"]
    print("\n================ DECISION ================")
    if d is None:
        print("no data")
    elif d >= 50:
        print(f"{d}% decomposable -> BUILD THE SUB-FRAGMENT. Flex/grid extension is the contribution.")
    elif d >= 20:
        print(f"{d}% decomposable -> sub-fragment real but insufficient. Contribution shifts to summarising coupled containers.")
    else:
        print(f"{d}% decomposable -> NEGATIVE RESULT. Modular decomposition does not extend to flex by restriction.")
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
