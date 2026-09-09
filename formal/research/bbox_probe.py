#!/usr/bin/env python3
"""
Probe the WebCode2M `bbox` column.

Pivotal question: does the per-element `style` string in the bbox layout tree carry
`display`, flex, and grid properties? If yes, container-to-child coupling is measurable
directly from this dataset and no browser rendering pass is needed.

Avoids streaming (WinError 10038 on Windows) by downloading one parquet shard.

    pip install datasets huggingface_hub pyarrow
    python bbox_probe.py --n 200
"""

import argparse, json, re
from collections import Counter

REPO = "xcodemind/webcode2m"

LAYOUT_PROPS = {
    "display", "flex", "flex-grow", "flex-shrink", "flex-basis", "flex-direction",
    "flex-wrap", "grid-template-columns", "grid-template-rows", "grid-column",
    "grid-row", "grid-area", "gap", "width", "height", "min-width", "max-width",
    "position", "float", "align-items", "justify-content",
}


def load_rows(n, shard):
    """Download one parquet shard and yield up to n rows. Robust on Windows."""
    from huggingface_hub import hf_hub_download
    import pyarrow.parquet as pq

    fn = f"data/{shard:05d}.parquet"
    print(f"downloading {fn} ...")
    path = hf_hub_download(repo_id=REPO, filename=fn, repo_type="dataset")
    print(f"  -> {path}")
    pf = pq.ParquetFile(path)
    got = 0
    # read only the columns we need; never touch `image`
    for batch in pf.iter_batches(batch_size=64, columns=["bbox", "text", "score", "lang"]):
        d = batch.to_pydict()
        for i in range(len(d["bbox"])):
            yield {k: d[k][i] for k in d}
            got += 1
            if got >= n:
                return


def walk(node, depth=0):
    """Yield (node, depth, parent) over the bbox tree."""
    stack = [(node, 0, None)]
    while stack:
        nd, d, par = stack.pop()
        if not isinstance(nd, dict):
            continue
        yield nd, d, par
        for ch in nd.get("children") or []:
            stack.append((ch, d + 1, nd))


def props_of(style):
    """Property names present in a style string."""
    if not style or not isinstance(style, str):
        return []
    return [m.group(1).strip().lower()
            for m in re.finditer(r"([-a-zA-Z]+)\s*:", style)]


def style_val(style, prop):
    if not style:
        return None
    m = re.search(rf"(?:^|;)\s*{re.escape(prop)}\s*:\s*([^;]+)", style, re.I)
    return m.group(1).strip().lower() if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--shard", type=int, default=2)
    ap.add_argument("--out", default="bbox_probe.json")
    a = ap.parse_args()

    prop_freq = Counter()
    node_types = Counter()
    display_vals = Counter()
    flexlike = Counter()
    pages = 0
    nodes = 0
    pages_with_flex_container = 0
    bbox_ok = 0
    examples = []

    for row in load_rows(a.n, a.shard):
        try:
            tree = json.loads(row["bbox"])
        except Exception:
            continue
        pages += 1
        page_has_flex = False
        for nd, depth, par in walk(tree):
            nodes += 1
            node_types[nd.get("type", "?")] += 1
            if isinstance(nd.get("bbox"), list) and len(nd["bbox"]) == 4:
                bbox_ok += 1
            st = nd.get("style")
            ps = props_of(st)
            prop_freq.update(ps)
            dv = style_val(st, "display")
            if dv:
                display_vals[dv] += 1
                if "flex" in dv or "grid" in dv:
                    page_has_flex = True
                    if len(examples) < 5:
                        kids = [(c.get("type"), c.get("style"), c.get("bbox"))
                                for c in (nd.get("children") or [])[:4]]
                        examples.append({
                            "container_type": nd.get("type"),
                            "container_style": st,
                            "container_bbox": nd.get("bbox"),
                            "children": kids,
                        })
            for p in ("flex", "flex-grow", "flex-basis", "grid-template-columns", "min-width"):
                if p in ps:
                    flexlike[p] += 1
        if page_has_flex:
            pages_with_flex_container += 1

    result = {
        "pages": pages,
        "nodes": nodes,
        "nodes_with_valid_bbox": bbox_ok,
        "pages_with_flex_or_grid_container": pages_with_flex_container,
        "top_50_style_properties": prop_freq.most_common(50),
        "layout_props_present": {p: prop_freq.get(p, 0) for p in sorted(LAYOUT_PROPS)},
        "display_values": display_vals.most_common(20),
        "flexlike_prop_counts": dict(flexlike),
        "node_types_top": node_types.most_common(15),
        "examples": examples,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"\npages={pages}  nodes={nodes}  bbox_ok={bbox_ok}")
    print(f"pages with a flex/grid container: {pages_with_flex_container}")
    print("\n--- VERDICT ---")
    has_display = prop_freq.get("display", 0)
    has_flex = sum(prop_freq.get(p, 0) for p in ("flex", "flex-grow", "flex-basis"))
    has_grid = prop_freq.get("grid-template-columns", 0)
    print(f"display present in styles      : {has_display}")
    print(f"flex props present in styles   : {has_flex}")
    print(f"grid-template-columns present  : {has_grid}")
    if has_display and (has_flex or has_grid):
        print(">> bbox tree carries layout properties: coupling is measurable WITHOUT rendering.")
    elif has_display:
        print(">> display present but flex/grid props sparse: partial. Check examples.")
    else:
        print(">> style strings do NOT carry layout props: rendering pass still required.")
    print("\ntop style properties:", prop_freq.most_common(25))
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
