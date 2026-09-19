#!/usr/bin/env python3
"""Build the storyboard from this site's own résumé data.

Assumes this package sits inside the site repo:

    mrityunjaykumar911.github.io/
      src/data/resume.yaml     <- source of truth
      public/images/           <- portrait
      deck2short/              <- here

Falls back to the frozen fixture in examples/site/ so the build still works
standalone (and so tests never depend on repo layout).

    python build_site.py                  storyboard only, no TTS
    python build_site.py --check          grounding gate only, exit 2 on failure
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from deck2short.author import load as load_scene
from deck2short.from_yaml import chart_from, load
from deck2short.ground import check
from deck2short.preview import build as build_storyboard
from deck2short.render import build_props
from deck2short.voice import estimate_scene

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

CANDIDATES = [
    (REPO / "src/data/resume.yaml", REPO / "public"),
    (HERE / "examples/site/resume.yaml", HERE / "examples/site"),
]

# Charts are assembled from facts that already exist, so they cannot drift from
# the YAML the way a literal data block would.
CHARTS = {
    "talentica": (
        "Talentica · measured improvements",
        [
            ("Search relevancy", "experience.3.lead.1#1"),
            ("Deployment frequency", "experience.3.lead.2#1"),
            ("Site calibration", "experience.3.lead.3#1"),
            ("Sync frequency", "experience.3.lead.0#1"),
        ],
    ),
}


def resolve_source() -> tuple[Path, Path]:
    for yaml_path, assets in CANDIDATES:
        if yaml_path.is_file():
            return yaml_path, assets
    sys.exit(
        "No résumé YAML found. Expected ../src/data/resume.yaml (running inside "
        "the site repo) or examples/site/resume.yaml."
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="build_site")
    ap.add_argument("--scene", default=str(HERE / "scene.json"))
    ap.add_argument("--out", default=str(HERE / "out/storyboard.html"))
    ap.add_argument("--check", action="store_true", help="Run the gate and stop")
    args = ap.parse_args(argv)

    yaml_path, assets = resolve_source()
    print(f"source: {yaml_path}")

    ex = load(yaml_path)
    for name, (title, refs) in CHARTS.items():
        try:
            ex.charts[name] = chart_from(ex, refs, title=title)
        except KeyError as e:
            sys.exit(f"chart {name!r}: {e}\nThe YAML changed — update CHARTS in build_site.py.")
    print(f"facts: {len(ex.facts)} · charts: {len(ex.charts)} · images: {len(ex.images)}")

    scene = load_scene(args.scene)
    report = check(scene, ex)
    print(report)
    if not report.ok:
        print("\nGate failed. Every spoken number must resolve to a YAML ref.", file=sys.stderr)
        return 2
    if args.check:
        return 0

    timed = estimate_scene(scene)
    work = HERE / ".d2s"
    work.mkdir(exist_ok=True)
    props = build_props(timed, ex, work / "props.json", base_dir=assets)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_storyboard(json.loads(props.read_text())), encoding="utf-8")

    print(f"\n{timed.total_s:.1f}s · {len(timed.beats)} beats")
    print(f"storyboard: {out}  ({out.stat().st_size / 1024:.0f} KB)")
    print("NOTE: durations are word-rate estimates, not real audio. Pacing only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
