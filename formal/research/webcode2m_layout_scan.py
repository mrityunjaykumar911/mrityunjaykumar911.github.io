#!/usr/bin/env python3
"""
Stream WebCode2M from HuggingFace and measure how decomposable real flex/grid layout is.

Tier 1 of the study: value-shape distribution from authored CSS.
Answers: how often is grid-template-columns written in a coupled shape (bare `fr`, `auto`,
min-content/max-content/fit-content) versus an independent shape (fixed lengths, percentages,
minmax(0, ...)), and how often do flex shorthands / min-width:0 appear in the coupled shape.

This does NOT need the 2.56M-row download. It streams.

Usage:
    python webcode2m_layout_scan.py --probe                 # inspect schema first
    python webcode2m_layout_scan.py --n 5000 --out scan.json
    python webcode2m_layout_scan.py --selftest              # validate the classifier

Deps: pip install datasets
"""

import argparse
import json
import re
import sys
from collections import Counter

DATASET = "xcodemind/webcode2m"
CONFIG = "default"
SPLIT = "train"

# Schema verified against the HF datasets-server (config "default", split "train",
# 2066 parquet files under data/):
#   image  : Image            (do not decode; we never touch it)
#   bbox   : string           element bounding boxes -- precomputed layout geometry
#   text   : string           HTML with embedded <style> CSS   <-- what we scan
#   score  : int64            quality score from their neural scorer
#   scale  : Sequence[int64]
#   lang   : string
#   tokens : Sequence[int64]
#   hash   : string

# ---------------------------------------------------------------- CSS extraction

STYLE_BLOCK = re.compile(r"<style[^>]*>(.*?)</style>", re.I | re.S)
# property: value  (approximate; adequate for counting value shapes)
DECL = re.compile(r"([-a-zA-Z]+)\s*:\s*([^;{}]+)", re.S)


def extract_css(html: str) -> str:
    """Concatenate all <style> block contents. WebCode2M inlines extracted CSS into <style>."""
    if not html:
        return ""
    return "\n".join(STYLE_BLOCK.findall(html))


def declarations(css: str):
    """Yield (property_lower, value_stripped) pairs."""
    for m in DECL.finditer(css):
        prop = m.group(1).strip().lower()
        val = " ".join(m.group(2).split())
        if prop and val:
            yield prop, val


# ---------------------------------------------------------------- track splitting

def split_top_level(value: str, sep=" "):
    """Split on whitespace at paren depth 0. Keeps minmax(...)/repeat(...) intact."""
    out, buf, depth = [], [], 0
    for ch in value:
        if ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch.isspace() and depth == 0:
            if buf:
                out.append("".join(buf))
                buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf))
    return out


def split_args(inner: str):
    """Split a function's argument list on top-level commas."""
    out, buf, depth = [], [], 0
    for ch in inner:
        if ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            out.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf).strip())
    return out


CONTENT_KEYWORDS = ("auto", "min-content", "max-content", "fit-content")
FR = re.compile(r"^[\d.]+fr$", re.I)
DEFINITE = re.compile(r"^[\d.]+(px|rem|em|vw|vh|ch|ex|cm|mm|in|pt|pc|%)$", re.I)


def track_is_coupled(track: str) -> bool:
    """
    A track couples siblings if its size depends on content.
      coupled : auto | min-content | max-content | fit-content(...) | bare <n>fr
      free    : fixed length | percentage | minmax(0, <anything>)
    Rationale: a bare `1fr` carries an automatic minimum equivalent to minmax(auto, 1fr),
    so content can expand the track. minmax(0, 1fr) removes that.
    """
    t = track.strip().lower()
    if not t:
        return False

    if t.startswith("repeat(") and t.endswith(")"):
        args = split_args(t[len("repeat("):-1])
        # args[0] is the count (or auto-fill/auto-fit); the rest is the track list
        inner = " ".join(args[1:]) if len(args) > 1 else ""
        return any(track_is_coupled(x) for x in split_top_level(inner))

    if t.startswith("minmax(") and t.endswith(")"):
        args = split_args(t[len("minmax("):-1])
        if len(args) == 2:
            lo = args[0].strip().lower()
            # minmax(0, ...) pins the minimum, decoupling from content
            if lo in ("0", "0px", "0%"):
                return False
            return True
        return True

    if t.startswith("fit-content("):
        return True
    if t in CONTENT_KEYWORDS:
        return True
    if FR.match(t):
        return True  # bare fr => automatic minimum => coupled
    if DEFINITE.match(t):
        return False
    return True  # unknown shape: count conservatively as coupled


def classify_gtc(value: str) -> str:
    """Classify a grid-template-columns value as 'independent' or 'coupled'."""
    v = value.strip().lower()
    if v in ("none", "inherit", "initial", "unset", "revert"):
        return "none"
    tracks = split_top_level(v)
    if not tracks:
        return "none"
    return "coupled" if any(track_is_coupled(t) for t in tracks) else "independent"


# ---------------------------------------------------------------- flex shorthand

def parse_flex(value: str):
    """
    Return (grow, shrink, basis) from a `flex` shorthand. CSS defaults for the shorthand's
    omitted parts: `flex: <grow>` => grow, 1, 0%.  Property default (no flex at all) is 0 1 auto.
    """
    v = value.strip().lower()
    if v == "none":
        return (0.0, 0.0, "auto")
    if v in ("initial", "unset", "revert"):
        return (0.0, 1.0, "auto")
    if v == "auto":
        return (1.0, 1.0, "auto")
    parts = v.split()
    grow, shrink, basis = 0.0, 1.0, "0%"
    nums = []
    for p in parts:
        if re.match(r"^[\d.]+$", p):
            nums.append(float(p))
        else:
            basis = p
    if len(nums) >= 1:
        grow = nums[0]
    if len(nums) >= 2:
        shrink = nums[1]
    if len(parts) == 1 and len(nums) == 1:
        basis = "0%"
    return (grow, shrink, basis)


def classify_flex(value: str) -> str:
    """
    'independent'  : used size cannot be moved by sibling content
                     (no grow, no shrink, definite basis)
    'coupled'      : otherwise. Note `flex: 1 1 0` is still coupled unless min-width:0 is set,
                     because the automatic minimum (min-width:auto -> min-content) applies.
                     min-width:0 is counted separately at page level.
    """
    grow, shrink, basis = parse_flex(value)
    basis_definite = bool(DEFINITE.match(basis)) or basis in ("0", "0px", "0%")
    if grow == 0.0 and shrink == 0.0 and basis_definite:
        return "independent"
    if grow == 0.0 and shrink == 0.0 and basis == "auto":
        return "independent_if_width_set"
    return "coupled"


# ---------------------------------------------------------------- per-page scan

def scan_html(html: str) -> dict:
    css = extract_css(html)
    if not css:
        return {}
    c = Counter()
    for prop, val in declarations(css):
        if prop == "display":
            v = val.lower()
            if v in ("flex", "inline-flex"):
                c["display_flex"] += 1
            elif v in ("grid", "inline-grid"):
                c["display_grid"] += 1
        elif prop in ("grid-template-columns", "grid-template-rows"):
            c["gtc_total"] += 1
            c["gtc_" + classify_gtc(val)] += 1
        elif prop == "flex":
            c["flex_total"] += 1
            c["flex_" + classify_flex(val)] += 1
        elif prop in ("min-width", "min-inline-size"):
            if val.strip().lower() in ("0", "0px", "0%"):
                c["min_width_zero"] += 1
        elif prop == "flex-basis":
            c["flex_basis_" + ("content" if val.strip().lower() in ("auto", "content") else "definite")] += 1
    return dict(c)


# ---------------------------------------------------------------- driver

def pick_html_field(example: dict):
    """WebCode2M field names vary by config; find the code/text field, ignore images."""
    for k in ("text", "code", "html", "content"):
        if k in example and isinstance(example[k], str):
            return k
    for k, v in example.items():
        if isinstance(v, str) and "<" in v and len(v) > 200:
            return k
    return None


def probe():
    from datasets import load_dataset, get_dataset_config_names
    try:
        print("configs:", get_dataset_config_names(DATASET))
    except Exception as e:
        print("config listing failed:", e)
    ds = load_dataset(DATASET, CONFIG, split=SPLIT, streaming=True)
    try:
        print("features:", ds.features)
    except Exception:
        pass
    for ex in ds.take(1):
        print("keys:", list(ex.keys()))
        for k, v in ex.items():
            info = f"{type(v).__name__}"
            if isinstance(v, str):
                info += f" len={len(v)} :: {v[:200]!r}"
            print(f"  {k}: {info}")
        print("chosen html field:", pick_html_field(ex))


def run(n: int, out: str):
    from datasets import load_dataset
    ds = load_dataset(DATASET, CONFIG, split=SPLIT, streaming=True)

    total = Counter()
    pages_scanned = 0
    pages_with_css = 0
    pages_with_grid = 0
    pages_with_flex = 0
    field = None

    for i, ex in enumerate(ds.take(n)):
        if field is None:
            field = pick_html_field(ex)
            if field is None:
                print("could not find an HTML field; run --probe", file=sys.stderr)
                return
            print(f"using field: {field}", file=sys.stderr)
        try:
            stats = scan_html(ex.get(field) or "")
        except Exception:
            continue
        pages_scanned += 1
        if stats:
            pages_with_css += 1
            if stats.get("gtc_total"):
                pages_with_grid += 1
            if stats.get("display_flex") or stats.get("flex_total"):
                pages_with_flex += 1
            total.update(stats)
        if pages_scanned % 500 == 0:
            print(f"  {pages_scanned} pages...", file=sys.stderr)

    gtc_t = total.get("gtc_total", 0)
    flex_t = total.get("flex_total", 0)
    result = {
        "dataset": DATASET,
        "pages_scanned": pages_scanned,
        "pages_with_css": pages_with_css,
        "pages_with_grid_tracks": pages_with_grid,
        "pages_with_flex": pages_with_flex,
        "counts": dict(total),
        "grid_track_declarations": gtc_t,
        "grid_coupled_pct": round(100 * total.get("gtc_coupled", 0) / gtc_t, 2) if gtc_t else None,
        "grid_independent_pct": round(100 * total.get("gtc_independent", 0) / gtc_t, 2) if gtc_t else None,
        "flex_declarations": flex_t,
        "flex_coupled_pct": round(100 * total.get("flex_coupled", 0) / flex_t, 2) if flex_t else None,
        "min_width_zero_declarations": total.get("min_width_zero", 0),
    }
    with open(out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------- selftest

def selftest():
    grid_cases = [
        ("1fr 1fr", "coupled"),
        ("minmax(0, 1fr) minmax(0, 1fr)", "independent"),
        ("repeat(3, 1fr)", "coupled"),
        ("repeat(3, minmax(0, 1fr))", "independent"),
        ("200px 1fr", "coupled"),
        ("200px 300px", "independent"),
        ("50% 50%", "independent"),
        ("auto 1fr", "coupled"),
        ("min-content max-content", "coupled"),
        ("fit-content(200px) 100px", "coupled"),
        ("repeat(auto-fill, minmax(0, 200px))", "independent"),
        ("none", "none"),
    ]
    flex_cases = [
        # `flex: none` is 0 0 auto: basis resolves from `width`, so independence is
        # conditional on a definite width being set elsewhere.
        ("none", "independent_if_width_set"),
        ("0 0 200px", "independent"),
        ("1 1 auto", "coupled"),
        ("0 1 auto", "coupled"),
        ("1", "coupled"),
        ("auto", "coupled"),
    ]
    ok = True
    for val, want in grid_cases:
        got = classify_gtc(val)
        flag = "ok " if got == want else "FAIL"
        if got != want:
            ok = False
        print(f"  [{flag}] grid {val!r:45} -> {got} (want {want})")
    for val, want in flex_cases:
        got = classify_flex(val)
        flag = "ok " if got == want else "FAIL"
        if got != want:
            ok = False
        print(f"  [{flag}] flex {val!r:45} -> {got} (want {want})")

    html = """<html><style>
      .a { display: grid; grid-template-columns: repeat(3, 1fr); }
      .b { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .c { display: flex; }
      .c > * { flex: 1 1 0; min-width: 0; }
    </style></html>"""
    print("\n  scan_html:", scan_html(html))
    print("\nSELFTEST", "PASSED" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--out", default="webcode2m_layout_scan.json")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    elif a.probe:
        probe()
    else:
        run(a.n, a.out)
