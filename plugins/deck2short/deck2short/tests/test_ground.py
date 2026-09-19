"""The gate is the product. These tests are the ones that matter."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from deck2short.extract import extract
from deck2short.ground import check
from deck2short.ir import SceneIR

HTML = Path(__file__).parent.parent / "examples" / "report.html"


def _scene(beats):
    return SceneIR.model_validate({"aspect": "9:16", "voice": "eve", "beats": beats})


HOOK = {
    "id": "b0",
    "vo": "Enterprise churn just hit 7.4 percent.",
    "visual": {"type": "stat", "display": "7.4%", "label": "Gross logo churn, Q3",
               "source_ref": "churn-rate", "trend": "up"},
    "claims": [{"text": "7.4 percent", "value": 7.4, "unit": "percent",
                "source_ref": "churn-rate"}],
    "est_dur_s": 2.8,
}
FILLER = [
    {"id": f"b{i}", "vo": "Three drivers explain most of it.",
     "visual": {"type": "title_card", "headline": "What moved"}, "est_dur_s": 2.8}
    for i in (1, 2, 3)
]


def run(extra_beats):
    ex = extract(HTML)
    return check(_scene([HOOK] + FILLER[:2] + extra_beats), ex)


def test_clean_scene_passes():
    r = run([{
        "id": "b9", "vo": "Net new ARR fell to 9.3 million dollars.",
        "visual": {"type": "chart_reveal", "src": "arr-chart", "series": 0,
                   "highlight": [3], "mode": "bars"},
        "claims": [{"text": "9.3 million", "value": 9.3, "unit": "currency",
                    "source_ref": "arr-chart/series0/pt3"}],
        "est_dur_s": 2.8,
    }])
    assert r.ok, r


def test_fabricated_number_is_caught():
    """No claim declared. The reverse check must still catch it."""
    r = run([{
        "id": "b9", "vo": "Support tickets climbed 62 percent that quarter.",
        "visual": {"type": "title_card", "headline": "Support"},
        "est_dur_s": 2.8,
    }])
    assert not r.ok
    assert any(f.kind == "uncovered" for f in r.failures), r


def test_wrong_value_is_caught():
    r = run([{
        "id": "b9", "vo": "Net new ARR fell to 4.1 million dollars.",
        "visual": {"type": "chart_reveal", "src": "arr-chart", "series": 0,
                   "highlight": [3], "mode": "bars"},
        "claims": [{"text": "4.1 million", "value": 4.1, "unit": "currency",
                    "source_ref": "arr-chart/series0/pt3"}],
        "est_dur_s": 2.8,
    }])
    assert not r.ok
    assert any(f.kind == "mismatch" for f in r.failures), r


def test_stat_display_must_match_its_source():
    ex = extract(HTML)
    bad_hook = dict(HOOK)
    bad_hook["visual"] = {"type": "stat", "display": "11.2%", "label": "Churn",
                          "source_ref": "churn-rate"}
    r = check(_scene([bad_hook] + FILLER), ex)
    assert any(f.kind == "mismatch" for f in r.failures), r


def test_missing_fragment_is_caught():
    r = run([{
        "id": "b9", "vo": "Here is the breakdown.",
        "visual": {"type": "html_fragment", "ref": "does-not-exist",
                   "reveal": "mask_up", "fit": "contain"},
        "est_dur_s": 2.8,
    }])
    assert any(f.kind == "unresolved" for f in r.failures), r


def test_years_and_periods_are_not_data():
    r = run([{
        "id": "b9", "vo": "That was the worst result since 2019 in Q4.",
        "visual": {"type": "title_card", "headline": "Context"},
        "est_dur_s": 2.8,
    }])
    assert r.ok, r
