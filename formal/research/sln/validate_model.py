#!/usr/bin/env python3
"""
Step 2c. Validate flexmodel.py against observed layout in WebCode2M.

The circularity problem: for `flex-basis: auto` items the basis is the content size, which we
cannot see. Inferring it from the observed box and then predicting that box is circular.

So the PRIMARY test is restricted to containers where every child has a DEFINITE DECLARED basis
(from flex-basis, a length in the flex shorthand, or width). Those inputs come from the CSS, not
from the answer.

`min-width: auto` resolves to min-content, which we also cannot see. That only matters if
clamping occurs, so we run with min=0 / max=inf. A mismatch is then evidence that real clamping
happened, which is a finding rather than a failure. Reported separately.

Two model-free sanity checks ride along:
  V2 conservation: in shrink mode the children's used sizes should sum to the container size.
  V3 equal-basis grow: equal bases with equal positive grow factors should give equal used sizes.

    python validate_model.py --n 6000 --shards 2,3,4
"""

import argparse, json, re
from fractions import Fraction as F
from collections import Counter
from flexmodel import Item, resolve, GROW, SHRINK

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
    """Return a Fraction for a definite length, or None if not definite."""
    if v is None:
        return None
    v = v.strip().lower()
    if v in ("0",):
        return F(0)
    m = LEN.match(v)
    if not m:
        return None
    val = F(m.group(1))
    unit = (m.group(2) or "").lower()
    if unit == "px":
        return val
    if unit == "%":
        return None if pct_base is None else val * F(pct_base) / 100
    return None  # bare number that is not 0: not a length


def parse_flex_shorthand(v):
    """Return (grow, shrink, basis_str) or None if absent."""
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


def child_props(style, container_main):
    """
    Extract (grow, shrink, basis) with basis definite, else None for basis.
    CSS property defaults when nothing is declared: flex: 0 1 auto.
    """
    sh = parse_flex_shorthand(sval(style, "flex"))
    if sh:
        grow, shrink, basis_s = sh
    else:
        g = sval(style, "flex-grow")
        s = sval(style, "flex-shrink")
        b = sval(style, "flex-basis")
        grow = F(g) if g and re.match(r"^[\d.]+$", g) else F(0)
        shrink = F(s) if s and re.match(r"^[\d.]+$", s) else F(1)
        basis_s = b or "auto"

    basis = length(basis_s, container_main)
    if basis is None and basis_s in ("auto", "content", None):
        # basis auto resolves to the used `width`, if that is definite
        basis = length(sval(style, "width"), container_main)
    return grow, shrink, basis



def margin_sides(style, pct_base=None):
    """
    Total main-axis margin per axis. Returns (row_margin, col_margin, has_auto).
    Longhands win over the shorthand, matching cascade order in a single declaration block.
    """
    def one(v):
        if v is None:
            return None, False
        v = v.strip().lower()
        if v == "auto":
            return None, True
        return length(v, pct_base), False

    top = right = bottom = left = None
    has_auto = False
    sh = sval(style, "margin")
    if sh:
        parts = sh.split()
        vals = []
        for p_ in parts:
            v, au = one(p_)
            has_auto = has_auto or au
            vals.append(v)
        if len(vals) == 1:
            top = right = bottom = left = vals[0]
        elif len(vals) == 2:
            top = bottom = vals[0]; right = left = vals[1]
        elif len(vals) == 3:
            top, right, bottom = vals[0], vals[1], vals[2]; left = vals[1]
        elif len(vals) >= 4:
            top, right, bottom, left = vals[0], vals[1], vals[2], vals[3]
    for name, setter in (("margin-top","t"),("margin-right","r"),
                         ("margin-bottom","b"),("margin-left","l")):
        raw = sval(style, name)
        if raw is not None:
            v, au = one(raw)
            has_auto = has_auto or au
            if setter == "t": top = v
            elif setter == "r": right = v
            elif setter == "b": bottom = v
            else: left = v
    z = lambda x: F(0) if x is None else x
    return z(left) + z(right), z(top) + z(bottom), has_auto


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
        cx, cy, cw, ch = cb
        px, py, pw, ph = pb
    except Exception:
        return None
    return (cx >= px - tol and cy >= py - tol and
            cx + cw <= px + pw + tol and cy + ch <= py + ph + tol)


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
                if got >= n:
                    return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6000)
    ap.add_argument("--shards", default="2,3,4")
    ap.add_argument("--out", default="validation.json")
    a = ap.parse_args()
    shards = [int(x) for x in a.shards.split(",")]

    seen = 0
    skipped = Counter()
    testable = 0
    errors = []          # per-item absolute error in px, full-information containers
    signed = []          # predicted - observed
    err_by_mode = {'grow': [], 'shrink': []}
    within_1px = 0
    within_2pct = 0
    total_items = 0
    mode_counts = Counter()

    v2_checked = v2_pass = 0
    v3_checked = v3_pass = 0
    d1_fired = 0

    for bj in load_rows(a.n, shards):
        try:
            tree = json.loads(bj)
        except Exception:
            continue
        for nd in walk(tree):
            st = nd.get("style")
            disp = sval(st, "display")
            if disp not in FLEX_DISPLAYS:
                continue
            all_kids = [c for c in (nd.get("children") or []) if isinstance(c, dict)]
            # Spec 4.1: an absolutely-positioned child of a flex container does NOT
            # participate in flex layout. Nor does display:none. They are not flex items.
            kids = []
            oof = 0
            for c in all_kids:
                cs = c.get("style")
                pos = (sval(cs, "position") or "static")
                dsp = (sval(cs, "display") or "")
                if pos in ("absolute", "fixed") or dsp == "none":
                    oof += 1
                    continue
                kids.append(c)
            if oof:
                skipped["_had_out_of_flow_children"] += 1
            if len(kids) < 2:
                skipped["fewer_than_2_flex_items"] += 1
                continue
            pb = nd.get("bbox")
            if not (isinstance(pb, list) and len(pb) == 4) or pb[2] <= 0:
                skipped["bad_container_bbox"] += 1
                continue
            seen += 1

            # decision 0b: wrapping is out of scope for the model
            wrap = (sval(st, "flex-wrap") or "nowrap")
            if "wrap" in wrap and wrap != "nowrap":
                skipped["wrapped"] += 1
                continue
            col = (sval(st, "flex-direction") or "row").startswith("column")
            axis = 3 if col else 2
            C = F(pb[axis])
            if C <= 0:
                skipped["zero_container"] += 1
                continue

            # escaping descendants are excluded by the cut rule
            if any(contained(c.get("bbox"), pb) is False for c in kids):
                skipped["escaping"] += 1
                continue

            obs, props, ok, auto_m = [], [], True, False
            for c in kids:
                cb = c.get("bbox")
                if not (isinstance(cb, list) and len(cb) == 4):
                    ok = False
                    break
                obs.append(F(cb[axis]))
                g, sk, b = child_props(c.get("style"), C)
                rm, cm, ha = margin_sides(c.get("style"), C)
                auto_m = auto_m or ha
                props.append((g, sk, b, cm if col else rm))
            if not ok:
                skipped["bad_child_bbox"] += 1
                continue
            if auto_m:
                # auto margins absorb free space in spec 9.5, after resolution. Out of scope.
                skipped["auto_margin"] += 1
                continue

            # ---- V2: conservation. Model-free.
            tot = sum(obs)
            if tot > C:
                pass  # overflow, cannot conclude
            v2_checked += 1
            if abs(tot - C) <= 1:
                v2_pass += 1

            # ---- V3: equal basis + equal positive grow -> equal used sizes. Model-free.
            gs = {p[0] for p in props}
            bs = {p[2] for p in props}
            if len(gs) == 1 and next(iter(gs)) > 0 and len(bs) == 1 and next(iter(bs)) is not None:
                v3_checked += 1
                if max(obs) - min(obs) <= 1:
                    v3_pass += 1

            # ---- V1: primary test, full-information containers only
            if any(p[2] is None for p in props):
                skipped["basis_not_definite"] += 1
                continue
            testable += 1
            items = [Item(basis=b, grow=g, shrink=sk, minS=F(0), maxS=None, margin=mg)
                     for (g, sk, b, mg) in props]
            try:
                r = resolve(C, items)
            except AssertionError:
                skipped["model_assert"] += 1
                continue
            mode_counts[r.mode] += 1
            if any(w == "D1_zero_scaled_shrink" for w in r.frozen_at):
                d1_fired += 1
            for pred, o in zip(r.used, obs):
                e = abs(pred - o)
                signed.append(float(pred - o))
                err_by_mode[r.mode].append(float(e))
                errors.append(float(e))
                total_items += 1
                if e <= 1:
                    within_1px += 1
                if o > 0 and e / o <= F(2, 100):
                    within_2pct += 1

    errors.sort()
    def pctl(p):
        if not errors:
            return None
        return round(errors[min(len(errors) - 1, int(p * len(errors)))], 3)

    under = sum(1 for x in signed if x < -1)     # we predicted too small: browser clamped UP
    over = sum(1 for x in signed if x > 1)       # we predicted too large: unmodelled consumer
    exact = len(signed) - under - over
    def med(xs):
        if not xs: return None
        xs = sorted(xs); return round(xs[len(xs)//2], 2)

    res = {
        "flex_containers_seen": seen,
        "signed_under_predicted_pct": round(100*under/len(signed),1) if signed else None,
        "signed_over_predicted_pct": round(100*over/len(signed),1) if signed else None,
        "signed_within_1px_pct": round(100*exact/len(signed),1) if signed else None,
        "median_err_grow_px": med(err_by_mode["grow"]),
        "median_err_shrink_px": med(err_by_mode["shrink"]),
        "p90_err_grow_px": (lambda xs: round(sorted(xs)[int(.9*len(xs))],1) if xs else None)(err_by_mode["grow"]),
        "p90_err_shrink_px": (lambda xs: round(sorted(xs)[int(.9*len(xs))],1) if xs else None)(err_by_mode["shrink"]),
        "skipped": dict(skipped),
        "full_information_containers": testable,
        "items_compared": total_items,
        "median_abs_error_px": pctl(0.50),
        "p90_abs_error_px": pctl(0.90),
        "p99_abs_error_px": pctl(0.99),
        "within_1px_pct": round(100 * within_1px / total_items, 1) if total_items else None,
        "within_2pct_pct": round(100 * within_2pct / total_items, 1) if total_items else None,
        "mode_counts": dict(mode_counts),
        "D1_zero_scaled_shrink_fired": d1_fired,
        "V2_conservation_checked": v2_checked,
        "V2_conservation_pass_pct": round(100 * v2_pass / v2_checked, 1) if v2_checked else None,
        "V3_equal_basis_grow_checked": v3_checked,
        "V3_pass_pct": round(100 * v3_pass / v3_checked, 1) if v3_checked else None,
    }
    json.dump(res, open(a.out, "w"), indent=2)

    print("\n============ 2c MODEL VALIDATION ============")
    print(f"flex containers seen           : {seen}")
    for k, v in skipped.most_common():
        print(f"  skipped, {k:22}: {v}")
    print(f"\nfull-information containers    : {testable}")
    print(f"items compared                 : {total_items}")
    print(f"  median abs error   : {res['median_abs_error_px']} px")
    print(f"  p90 abs error      : {res['p90_abs_error_px']} px")
    print(f"  p99 abs error      : {res['p99_abs_error_px']} px")
    print(f"  within 1px         : {res['within_1px_pct']}%")
    print(f"  within 2%          : {res['within_2pct_pct']}%")
    print(f"  modes              : {dict(mode_counts)}")
    print(f"  D1 spec-gap fired  : {d1_fired}")
    print("\n---- error direction (diagnostic) ----")
    print(f"  under-predicted (browser bigger; clamped UP to min-content?) : {res['signed_under_predicted_pct']}%")
    print(f"  over-predicted  (unmodelled space consumer)                  : {res['signed_over_predicted_pct']}%")
    print(f"  within 1px                                                   : {res['signed_within_1px_pct']}%")
    print(f"  median err  grow {res['median_err_grow_px']} px   shrink {res['median_err_shrink_px']} px")
    print(f"  p90 err     grow {res['p90_err_grow_px']} px   shrink {res['p90_err_shrink_px']} px")
    print("\n---- model-free sanity checks ----")
    print(f"V2 conservation  {v2_pass}/{v2_checked}  ({res['V2_conservation_pass_pct']}%)")
    print(f"V3 equal-basis   {v3_pass}/{v3_checked}  ({res['V3_pass_pct']}%)")

    print("\n============ VERDICT ============")
    w = res["within_2pct_pct"]
    if total_items == 0:
        print("NO TESTABLE CONTAINERS. The corpus does not declare definite bases often enough.")
        print("The model cannot be validated this way. Do NOT proceed to 2d. Diagnose first.")
    elif w is not None and w >= 80:
        print(f"{w}% of items within 2%. Model tracks observed layout. Proceed to 2d.")
    elif w is not None and w >= 50:
        print(f"{w}% within 2%. Partial. Likely real min-content clamping we cannot see.")
        print("Inspect before proceeding.")
    else:
        print(f"only {w}% within 2%. Model does NOT track observed layout. STOP and diagnose.")
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
