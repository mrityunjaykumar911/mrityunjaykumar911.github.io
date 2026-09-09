#!/usr/bin/env python3
"""
Step 2d, revised. Extract real page HTML from the cached WebCode2M shards, filtered to pages
that actually contain a flex container.

Why HTML and not parsed CSS: the coupling question is answered by rendering and perturbing in a
real browser, not by parsing declarations. That removes the unobservable-input problem entirely
(content-based flex bases, min-content, padding, borders, box-sizing).

WebCode2M inlines the extracted CSS into <style>, so each page is self-contained and renders
offline with no network.

    python extract_pages.py --pages 1200 --shards 2,3,4 --out pages.json
"""

import argparse, json, os, re
from collections import Counter

REPO = "xcodemind/webcode2m"
FLEX_RE = re.compile(r"display\s*:\s*(inline-)?flex", re.I)


def has_flex_in_tree(bbox_json):
    """Cheap check on the layout tree so we only keep pages with real flex containers."""
    return bool(FLEX_RE.search(bbox_json or ""))


def load_rows(limit_scan, shards):
    from huggingface_hub import hf_hub_download
    import pyarrow.parquet as pq
    got = 0
    for sh in shards:
        p = hf_hub_download(repo_id=REPO, filename=f"data/{sh:05d}.parquet", repo_type="dataset")
        for b in pq.ParquetFile(p).iter_batches(batch_size=64, columns=["bbox", "text", "score"]):
            d = b.to_pydict()
            for i in range(len(d["text"])):
                yield d["bbox"][i], d["text"][i], d["score"][i]
                got += 1
                if got >= limit_scan:
                    return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=1200, help="pages WITH flex to keep")
    ap.add_argument("--scan", type=int, default=20000, help="max rows to scan")
    ap.add_argument("--shards", default="2,3,4")
    ap.add_argument("--max-bytes", type=int, default=120000, help="skip giant pages")
    ap.add_argument("--out", default="pages.json")
    a = ap.parse_args()
    shards = [int(x) for x in a.shards.split(",")]

    kept, scanned = [], 0
    skip = Counter()

    for bj, html, score in load_rows(a.scan, shards):
        scanned += 1
        if not html:
            skip["empty"] += 1
            continue
        if len(html) > a.max_bytes:
            skip["too_big"] += 1
            continue
        if not has_flex_in_tree(bj):
            skip["no_flex"] += 1
            continue
        kept.append({"html": html, "score": score})
        if len(kept) >= a.pages:
            break

    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"scanned": scanned, "kept": len(kept), "pages": kept}, f)

    print(f"rows scanned : {scanned}")
    print(f"pages kept   : {len(kept)}")
    for k, v in skip.most_common():
        print(f"  skipped {k:12}: {v}")
    print(f"\nwrote {a.out}  ({os.path.getsize(a.out)/1e6:.1f} MB)")
    print("\nStage this file back. The perturbation experiment runs in Chromium on the other side.")


if __name__ == "__main__":
    main()
