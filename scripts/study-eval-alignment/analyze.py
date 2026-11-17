"""Judge-human alignment on SummEval, stratified by human uncertainty.

Judge:  GPT-4 G-Eval (Liu et al. 2023), 20 sampled scores per summary.
Humans: the three SummEval expert annotators (Fabbri et al. 2021).
Method: follows Elangovan et al., "Beyond Correlation" (ICLR 2025), adapted to
        the binary pass/fail verdicts the eval platform produces.

Run:    python3 scripts/study-eval-alignment/analyze.py
Output: src/data/studies/eval-alignment.json (read by the study page)

Inputs are downloaded from pinned commits and verified by SHA-256. No raw data
is committed to this repository.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import pathlib
import sys
import urllib.request

import krippendorff
import numpy as np
from scipy import stats

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = pathlib.Path(__file__).resolve().parent / ".cache"
OUT = ROOT / "src" / "data" / "studies" / "eval-alignment.json"

GEVAL = "https://raw.githubusercontent.com/nlpyang/geval/6f84404ce4503d2ba0cde0293c5d402ecf2976a8/results"
PAIRS = "https://raw.githubusercontent.com/cambridgeltl/PairS/55ad950e389c87fbcfd29d7b922fb360e7165d02/data/SummEval"
SOURCES = {
    "model_annotations.aligned.jsonl": (f"{PAIRS}/model_annotations.aligned.jsonl",
                                        "f0d4166e0cdeb439b387c4449634b067b7e9f721b9ef4c2b722f6b7550d3d6ab"),
    "gpt4_coh_detailed.json": (f"{GEVAL}/gpt4_coh_detailed.json",
                               "bec62a6a8408b7f0c7a55a665d8c9a44b97eecf671bf0b4319284b192d218508"),
    "gpt4_con_detailed.json": (f"{GEVAL}/gpt4_con_detailed.json",
                               "e09609ab249fc6aa2e4f11b7c16d7531b7036b163c8251e54a04ce4c3efa76ed"),
    "gpt4_flu_detailed.json": (f"{GEVAL}/gpt4_flu_detailed.json",
                               "4f08454a9ac1c3c58f6e4d067a00ed37d83d4de2206b010d8a1ba6ef18ceae7d"),
    "gpt4_rel_detailed.json": (f"{GEVAL}/gpt4_rel_detailed.json",
                               "c222933ff5ba552bb9ec3d2b495022a89b8019cf246710988a4e49804d47585a"),
}

# G-Eval rates fluency on 1-3 and the other dimensions on 1-5. Human fluency is
# 1-5, so it is mapped to 1-3 the way Elangovan et al. do it.
DIMENSIONS = {
    "coherence": {"file": "gpt4_coh_detailed.json", "scale": 5},
    "consistency": {"file": "gpt4_con_detailed.json", "scale": 5},
    "fluency": {"file": "gpt4_flu_detailed.json", "scale": 3},
    "relevance": {"file": "gpt4_rel_detailed.json", "scale": 5},
}
BOOTSTRAP_REPS = 2000
SEED = 20261117


# ---------------------------------------------------------------- data

def fetch() -> None:
    CACHE.mkdir(exist_ok=True)
    for name, (url, sha) in SOURCES.items():
        path = CACHE / name
        if not path.exists():
            print(f"downloading {url}", file=sys.stderr)
            urllib.request.urlretrieve(url, path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != sha:
            raise SystemExit(f"{name}: sha256 {digest} does not match pinned {sha}")


def fluency_to_3(x: int) -> int:
    return 1 if x < 3 else (2 if x == 3 else 3)


def parse_judge(responses: list[str], scale: int) -> list[int]:
    out = []
    for r in responses:
        r = r.strip()[:1]
        if r.isdigit() and 1 <= int(r) <= scale:
            out.append(int(r))
    return out


def load() -> dict[str, dict]:
    experts = {}
    for line in (CACHE / "model_annotations.aligned.jsonl").read_text().splitlines():
        row = json.loads(line)
        experts[(row["id"], row["model_id"])] = row["expert_annotations"]

    data = {}
    for dim, cfg in DIMENSIONS.items():
        rows = json.loads((CACHE / cfg["file"]).read_text())
        docs, systems, human, judge = [], [], [], []
        for row in rows:
            key = (row["doc_id"], row["system_id"])
            h = [a[dim] for a in experts[key]]
            if cfg["scale"] == 3:
                h = [fluency_to_3(x) for x in h]
            samples = parse_judge(row["all_responses"], cfg["scale"])
            if len(h) != 3 or not samples:
                raise SystemExit(f"unexpected row {key} for {dim}")
            docs.append(row["doc_id"])
            systems.append(row["system_id"])
            human.append(h)
            judge.append(samples)
        data[dim] = {
            "scale": cfg["scale"],
            "doc": np.array(docs),
            "system": np.array(systems),
            "human": np.array(human),                 # (n, 3) ordinal
            "judge_samples": judge,                   # list of lists
        }
    return data


# ---------------------------------------------------------------- metrics

def pass_threshold(scale: int) -> int:
    """Binary verdict: pass means 4 or 5 on a 1-5 scale, 3 on a 1-3 scale."""
    return 4 if scale == 5 else 3


def judge_point(samples: list[int]) -> int:
    """Ordinal judge verdict: median of the samples, half rounded up."""
    return int(np.floor(np.median(samples) + 0.5))


def kappa(a: np.ndarray, b: np.ndarray) -> float:
    a = a.astype(int)
    b = b.astype(int)
    po = np.mean(a == b)
    pa, pb = a.mean(), b.mean()
    pe = pa * pb + (1 - pa) * (1 - pb)
    return float((po - pe) / (1 - pe)) if pe < 1 else float("nan")


def binary_block(H: np.ndarray, J: np.ndarray, Jshare: np.ndarray) -> dict:
    """Agreement metrics for binary humans H (n,3) and judge J (n,)."""
    n = len(J)
    if n == 0:
        return {"n": 0}
    pairs = list(itertools.combinations(range(3), 2))
    maj = (H.sum(1) >= 2).astype(int)
    hh_agree = np.mean([np.mean(H[:, i] == H[:, j]) for i, j in pairs])
    hm_agree = np.mean([np.mean(J == H[:, i]) for i in range(3)])
    # Random labeler: independent pass/fail at the judge's pass rate.
    q = J.mean()
    rand_agree = np.mean([np.mean(q * H[:, i] + (1 - q) * (1 - H[:, i])) for i in range(3)])
    out = {
        "n": int(n),
        "hh_agreement": float(hh_agree),
        "hm_agreement": float(hm_agree),
        "random_agreement": float(rand_agree),
        "hh_kappa": float(np.mean([kappa(H[:, i], H[:, j]) for i, j in pairs])),
        "hm_kappa": float(np.mean([kappa(J, H[:, i]) for i in range(3)])),
        "judge_vs_majority_agreement": float(np.mean(J == maj)),
        "judge_vs_majority_kappa": kappa(J, maj),
        "human_pass_rate": float(maj.mean()),
        "judge_pass_rate": float(J.mean()),
        "judge_mean_confidence": float(np.mean(np.maximum(Jshare, 1 - Jshare))),
    }
    pos, neg = maj == 1, maj == 0
    out["sensitivity"] = float(np.mean(J[pos] == 1)) if pos.any() else float("nan")
    out["specificity"] = float(np.mean(J[neg] == 0)) if neg.any() else float("nan")
    return out


def ordinal_block(H: np.ndarray, Jp: np.ndarray) -> dict:
    """Paper-style ordinal metrics: Krippendorff alpha HH and HM (human median vs judge)."""
    n = len(Jp)
    if n < 3:
        return {"n": int(n)}
    hmed = np.median(H, axis=1)
    def alpha(rows):
        try:
            return float(krippendorff.alpha(reliability_data=rows, level_of_measurement="ordinal"))
        except Exception:
            return float("nan")
    pairs = list(itertools.combinations(range(3), 2))
    return {
        "n": int(n),
        "alpha_hh": alpha(H.T.astype(float)),
        "alpha_hm_median": alpha(np.vstack([hmed, Jp]).astype(float)),
        "alpha_hh_pairwise": float(np.nanmean([alpha(np.vstack([H[:, i], H[:, j]]).astype(float)) for i, j in pairs])),
        "alpha_hm_pairwise": float(np.nanmean([alpha(np.vstack([Jp, H[:, i]]).astype(float)) for i in range(3)])),
        "spearman_hm_median": float(stats.spearmanr(hmed, Jp).statistic),
    }


def system_block(D: dict, Hb: np.ndarray, Jb: np.ndarray, Jmean: np.ndarray) -> dict:
    systems = sorted(set(D["system"]))
    h_score = np.array([D["human"][D["system"] == s].mean() for s in systems])
    j_score = np.array([Jmean[D["system"] == s].mean() for s in systems])
    maj = (Hb.sum(1) >= 2).astype(int)
    h_pass = np.array([maj[D["system"] == s].mean() for s in systems])
    j_pass = np.array([Jb[D["system"] == s].mean() for s in systems])
    pair_agree = []
    for a, b in itertools.combinations(range(len(systems)), 2):
        dh, dj = h_pass[a] - h_pass[b], j_pass[a] - j_pass[b]
        if dh != 0:
            pair_agree.append(np.sign(dh) == np.sign(dj))
    return {
        "systems": len(systems),
        "kendall_tau_score": float(stats.kendalltau(h_score, j_score).statistic),
        "kendall_tau_pass_rate": float(stats.kendalltau(h_pass, j_pass).statistic),
        "pairwise_order_agreement": float(np.mean(pair_agree)),
    }


def analyze_dimension(D: dict, idx: np.ndarray | None = None, ordinal: bool = True) -> tuple:
    """All metrics for one dimension, optionally on a resampled row index."""
    sel = slice(None) if idx is None else idx
    t = pass_threshold(D["scale"])
    H = D["human"][sel]
    samples = [D["judge_samples"][i] for i in (range(len(D["human"])) if idx is None else idx)]
    Jp = np.array([judge_point(s) for s in samples])
    Jshare = np.array([np.mean(np.array(s) >= t) for s in samples])
    Jb = (Jshare > 0.5).astype(int)
    Hb = (H >= t).astype(int)

    unanimous_b = (Hb.min(1) == Hb.max(1))
    n_unique = np.array([len(set(r)) for r in H])

    res = {
        "binary": {
            "all": binary_block(Hb, Jb, Jshare),
            "unanimous": binary_block(Hb[unanimous_b], Jb[unanimous_b], Jshare[unanimous_b]),
            "split": binary_block(Hb[~unanimous_b], Jb[~unanimous_b], Jshare[~unanimous_b]),
        },
    }
    if ordinal:
        res["ordinal"] = {
            "all": ordinal_block(H, Jp),
            **{f"unique_{k}": ordinal_block(H[n_unique == k], Jp[n_unique == k]) for k in (1, 2, 3)},
        }
    return res, Hb, Jb, Jp, Jshare


def bootstrap(D: dict, rng: np.random.Generator) -> dict:
    """Cluster bootstrap over documents. Each replicate resamples whole documents."""
    docs = np.unique(D["doc"])
    rows_by_doc = {d: np.flatnonzero(D["doc"] == d) for d in docs}
    keys = [
        ("binary", "all", "hm_agreement"), ("binary", "all", "hh_agreement"),
        ("binary", "all", "hm_kappa"), ("binary", "all", "hh_kappa"),
        ("binary", "all", "judge_vs_majority_kappa"),
        ("binary", "unanimous", "hm_agreement"), ("binary", "split", "hm_agreement"),
        ("binary", "split", "hh_agreement"),
        ("binary", "all", "judge_pass_rate"), ("binary", "all", "human_pass_rate"),
        ("binary", "unanimous", "sensitivity"), ("binary", "unanimous", "specificity"),
    ]
    draws = {k: [] for k in keys}
    gap = []
    for _ in range(BOOTSTRAP_REPS):
        pick = rng.choice(docs, size=len(docs), replace=True)
        idx = np.concatenate([rows_by_doc[d] for d in pick])
        r, *_ = analyze_dimension(D, idx, ordinal=False)
        for k in keys:
            draws[k].append(r[k[0]][k[1]][k[2]])
        gap.append(r["binary"]["all"]["hm_agreement"] - r["binary"]["all"]["hh_agreement"])
    ci = {".".join(k): [float(np.nanpercentile(v, 2.5)), float(np.nanpercentile(v, 97.5))] for k, v in draws.items()}
    ci["binary.all.hm_minus_hh_agreement"] = [float(np.percentile(gap, 2.5)), float(np.percentile(gap, 97.5))]
    return ci


def confidence_curve(Hb: np.ndarray, Jb: np.ndarray, Jshare: np.ndarray) -> list[dict]:
    """Trust-or-escalate view: keep only verdicts at or above a judge confidence level."""
    conf = np.maximum(Jshare, 1 - Jshare)
    unanimous = Hb.min(1) == Hb.max(1)
    maj = (Hb.sum(1) >= 2).astype(int)
    out = []
    for level in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
        keep = conf >= level
        out.append({
            "min_confidence": level,
            "coverage": float(keep.mean()),
            "agreement_with_majority": float(np.mean(Jb[keep] == maj[keep])) if keep.any() else None,
            "split_share_kept": float(np.mean(~unanimous[keep])) if keep.any() else None,
        })
    return out


def auc(score: np.ndarray, label: np.ndarray) -> float:
    """Probability that a random human-pass item outscores a random human-fail item."""
    pos, neg = score[label == 1], score[label == 0]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    return float(stats.mannwhitneyu(pos, neg).statistic / (len(pos) * len(neg)))


def discrimination(Hb: np.ndarray, Jmean: np.ndarray) -> dict:
    """Threshold-free view: does the judge rank human-pass items above human-fail items?"""
    maj = (Hb.sum(1) >= 2).astype(int)
    unanimous = Hb.min(1) == Hb.max(1)
    return {
        "auc_all": auc(Jmean, maj),
        "auc_unanimous": auc(Jmean[unanimous], maj[unanimous]),
        "auc_split": auc(Jmean[~unanimous], maj[~unanimous]),
    }


def recalibrated(D: dict, Hb: np.ndarray, Jmean: np.ndarray, rng: np.random.Generator, reps: int = 200) -> dict:
    """Cross-fitted threshold: fit the judge cut-off on half the documents so its pass
    rate matches the human pass rate there, then score agreement on the other half."""
    docs = np.unique(D["doc"])
    maj = (Hb.sum(1) >= 2).astype(int)
    unanimous = Hb.min(1) == Hb.max(1)
    acc = {"all": [], "unanimous": [], "split": [], "kappa_all": [], "kappa_split": []}
    for _ in range(reps):
        fit_docs = rng.choice(docs, size=len(docs) // 2, replace=False)
        fit = np.isin(D["doc"], fit_docs)
        cut = np.quantile(Jmean[fit], 1 - maj[fit].mean())
        J = (Jmean >= cut).astype(int)
        t = ~fit
        for name, m in (("all", t), ("unanimous", t & unanimous), ("split", t & ~unanimous)):
            acc[name].append(np.mean([np.mean(J[m] == Hb[m, i]) for i in range(3)]))
        acc["kappa_all"].append(np.mean([kappa(J[t], Hb[t, i]) for i in range(3)]))
        acc["kappa_split"].append(np.mean([kappa(J[t & ~unanimous], Hb[t & ~unanimous, i]) for i in range(3)]))
    return {
        "hm_agreement_all": float(np.mean(acc["all"])),
        "hm_agreement_unanimous": float(np.mean(acc["unanimous"])),
        "hm_agreement_split": float(np.mean(acc["split"])),
        "hm_kappa_all": float(np.mean(acc["kappa_all"])),
        "hm_kappa_split": float(np.mean(acc["kappa_split"])),
        "reps": reps,
    }


def lee_correction(p: float, n: int, q0: float, m0: int, q1: float, m1: int, z: float = 1.96) -> tuple:
    """Bias-corrected pass rate and its 95% interval (Lee et al. 2025)."""
    denom = q0 + q1 - 1
    theta = min(max((p + q0 - 1) / denom, 0.0), 1.0) if denom > 0 else float("nan")
    pt = (n * p + z * z / 2) / (n + z * z)
    q0t, q1t = (m0 * q0 + 1) / (m0 + 2), (m1 * q1 + 1) / (m1 + 2)
    nt, m0t, m1t = n + z * z, m0 + 2, m1 + 2
    d = q0t + q1t - 1
    tht = (pt + q0t - 1) / d
    dth = 2 * z * z * (-(1 - tht) * q0t * (1 - q0t) / m0t + tht * q1t * (1 - q1t) / m1t) / d ** 2
    var = (pt * (1 - pt) / nt + (1 - tht) ** 2 * q0t * (1 - q0t) / m0t + tht ** 2 * q1t * (1 - q1t) / m1t) / d ** 2
    half = z * np.sqrt(var)
    return theta, max(tht + dth - half, 0.0), min(tht + dth + half, 1.0)


def correction_check(D: dict, Hb: np.ndarray, Jb: np.ndarray, rng: np.random.Generator,
                     reps: int = 500, boot: int = 400) -> dict:
    """Design doc section 7.4, Method A: estimate sensitivity and specificity on a
    calibration half of the documents, correct the judge pass rate on the other half.
    Compares the closed-form interval (Lee et al.) with a document-level cluster
    bootstrap of the same estimator."""
    docs, inv = np.unique(D["doc"], return_inverse=True)
    maj = (Hb.sum(1) >= 2).astype(int)
    # Per-document sufficient statistics: items, judge passes, human passes,
    # true positives, human fails, true negatives.
    k = len(docs)
    S = np.zeros((k, 6))
    np.add.at(S, inv, np.column_stack([np.ones_like(Jb), Jb, maj, Jb * maj, 1 - maj, (1 - Jb) * (1 - maj)]))

    def estimate(cal_rows, test_rows):
        c, t = cal_rows.sum(0), test_rows.sum(0)
        q1 = c[3] / c[2]
        q0 = c[5] / c[4]
        p = t[1] / t[0]
        d = q0 + q1 - 1
        return min(max((p + q0 - 1) / d, 0.0), 1.0) if d > 0 else np.nan

    raw_err, cor_err, cov_closed, cov_boot, w_closed, w_boot = [], [], [], [], [], []
    for _ in range(reps):
        perm = rng.permutation(k)
        cal_i, test_i = perm[: k // 2], perm[k // 2:]
        c, t = S[cal_i].sum(0), S[test_i].sum(0)
        q1, q0 = c[3] / c[2], c[5] / c[4]
        p, truth = t[1] / t[0], t[2] / t[0]
        theta, lo, hi = lee_correction(p, int(t[0]), q0, int(c[4]), q1, int(c[2]))
        raw_err.append(abs(p - truth))
        cor_err.append(abs(theta - truth))
        cov_closed.append(lo <= truth <= hi)
        w_closed.append(hi - lo)
        bs = np.array([
            estimate(S[rng.choice(cal_i, len(cal_i))], S[rng.choice(test_i, len(test_i))])
            for _ in range(boot)
        ])
        blo, bhi = np.nanpercentile(bs, [2.5, 97.5])
        cov_boot.append(blo <= truth <= bhi)
        w_boot.append(bhi - blo)
    return {
        "reps": reps,
        "bootstrap_reps": boot,
        "mean_abs_error_raw": float(np.mean(raw_err)),
        "mean_abs_error_corrected": float(np.mean(cor_err)),
        "closed_form_ci95_coverage": float(np.mean(cov_closed)),
        "closed_form_ci95_mean_width": float(np.mean(w_closed)),
        "cluster_bootstrap_ci95_coverage": float(np.mean(cov_boot)),
        "cluster_bootstrap_ci95_mean_width": float(np.mean(w_boot)),
    }


def perception(D: dict, Jp: np.ndarray) -> list[dict]:
    """Judge score distribution within each bin of the human median."""
    hmed = np.floor(np.median(D["human"], axis=1) + 0.5).astype(int)
    out = []
    for b in range(1, D["scale"] + 1):
        m = hmed == b
        counts = [int(np.sum(Jp[m] == v)) for v in range(1, D["scale"] + 1)]
        out.append({"human_median": b, "n": int(m.sum()), "judge_counts": counts})
    return out


def clean(x):
    """Strict JSON: undefined statistics (NaN) become null."""
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x]
    if isinstance(x, float) and not np.isfinite(x):
        return None
    return x


def main() -> None:
    fetch()
    data = load()
    rng = np.random.default_rng(SEED)
    result = {
        "meta": {
            "judge": "GPT-4 G-Eval, 20 sampled scores per summary (Liu et al. 2023)",
            "humans": "3 SummEval expert annotators (Fabbri et al. 2021)",
            "items_per_dimension": 1600,
            "documents": 100,
            "systems": 16,
            "binary_rule": "pass = score >= 4 on 1-5, or 3 on 1-3; judge passes when more than half of its 20 samples pass",
            "bootstrap": f"{BOOTSTRAP_REPS} replicates, resampling documents (cluster bootstrap), seed {SEED}",
            "sources": {name: {"url": url, "sha256": sha} for name, (url, sha) in SOURCES.items()},
        },
        "dimensions": {},
    }
    for dim, D in data.items():
        res, Hb, Jb, Jp, Jshare = analyze_dimension(D)
        Jmean = np.array([np.mean(s) for s in D["judge_samples"]])
        res["system"] = system_block(D, Hb, Jb, Jmean)
        res["ci95"] = bootstrap(D, rng)
        res["confidence_curve"] = confidence_curve(Hb, Jb, Jshare)
        res["perception"] = perception(D, Jp)
        res["discrimination"] = discrimination(Hb, Jmean)
        res["recalibrated"] = recalibrated(D, Hb, Jmean, rng)
        res["correction_check"] = correction_check(D, Hb, Jb, rng)
        res["scale"] = D["scale"]
        result["dimensions"][dim] = res
        b = res["binary"]
        print(f"{dim:12s} split={b['split']['n']:4d}/{b['all']['n']} "
              f"HH={b['all']['hh_agreement']:.3f} HM={b['all']['hm_agreement']:.3f} "
              f"| unanimous HM={b['unanimous']['hm_agreement']:.3f} "
              f"| split HH={b['split']['hh_agreement']:.3f} HM={b['split']['hm_agreement']:.3f} "
              f"rand={b['split']['random_agreement']:.3f} "
              f"| kHH={b['all']['hh_kappa']:.2f} kHM={b['all']['hm_kappa']:.2f} "
              f"| pass H={b['all']['human_pass_rate']:.2f} J={b['all']['judge_pass_rate']:.2f} "
              f"| tau_sys={res['system']['kendall_tau_score']:.2f}")
        print(f"{'':12s} AUC all={res['discrimination']['auc_all']:.3f} unan={res['discrimination']['auc_unanimous']:.3f} "
              f"split={res['discrimination']['auc_split']:.3f} | recal HM all={res['recalibrated']['hm_agreement_all']:.3f} "
              f"unan={res['recalibrated']['hm_agreement_unanimous']:.3f} split={res['recalibrated']['hm_agreement_split']:.3f} "
              f"k={res['recalibrated']['hm_kappa_all']:.2f} ksplit={res['recalibrated']['hm_kappa_split']:.2f} "
              f"| corr err raw={res['correction_check']['mean_abs_error_raw']:.3f} "
              f"cor={res['correction_check']['mean_abs_error_corrected']:.3f} "
              f"cov closed={res['correction_check']['closed_form_ci95_coverage']:.2f} w={res['correction_check']['closed_form_ci95_mean_width']:.3f} "
              f"| boot={res['correction_check']['cluster_bootstrap_ci95_coverage']:.2f} w={res['correction_check']['cluster_bootstrap_ci95_mean_width']:.3f}")
    OUT.write_text(json.dumps(clean(result), indent=2, allow_nan=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
