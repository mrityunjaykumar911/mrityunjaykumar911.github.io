"""End-to-end: HTML -> short.

    python -m deck2short.pipeline report.html -o out/short.mp4 --brief "lead with the churn number"

Stages, each independently runnable and each writing an artefact to --work:

    extract   HTML        -> facts.json      (what is addressable and true)
    author    facts       -> scene.json      (re-authored beats, not a summary)
    ground    scene+facts -> report          (hard gate; fails the build)
    voice     scene       -> timed.json      (real durations from real audio)
    render    timed       -> mp4

scene.json is the human edit point. Run with --scene to skip authoring and
render a hand-tuned version.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import author as author_mod
from . import ground, render
from .extract import Extraction, extract
from .ir import SceneIR, TimedScene
from .voice import Aligner, NullAligner, XaiTTS, voice_scene

ROOT = Path(__file__).resolve().parent.parent
REMOTION = ROOT / "remotion"


def _dump_facts(ex: Extraction, path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "facts": {k: vars(v) for k, v in ex.facts.items()},
                "charts": {k: v.model_dump() for k, v in ex.charts.items()},
                "fragment_refs": sorted(ex.fragments),
                "warnings": ex.warnings,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="deck2short")
    ap.add_argument("html", help="Generated HTML file")
    ap.add_argument("-o", "--out", default="out/short.mp4")
    ap.add_argument("--work", default=".d2s")
    ap.add_argument("--brief", default=None, help="Steer the hook and angle")
    ap.add_argument("--scene", default=None, help="Use this scene.json instead of authoring")
    ap.add_argument("--target", type=float, default=35.0, help="Target seconds")
    ap.add_argument("--aspect", default="9:16", choices=["9:16", "1:1", "16:9"])
    ap.add_argument("--voice", default="eve", help="eve | ara | rex | sal | leo")
    ap.add_argument("--align", action="store_true", help="WhisperX word timings (karaoke captions)")
    ap.add_argument("--no-gate", action="store_true", help="Warn instead of failing on grounding")
    ap.add_argument("--allow-unverified", action="store_true", help="Accept text-parsed facts")
    ap.add_argument("--annotate", action="store_true",
                    help="Auto-inject data-ref first (for HTML not authored for this)")
    ap.add_argument("--no-tts", action="store_true",
                    help="Estimate durations from word count; write a storyboard, no video")
    ap.add_argument("--assets", default=None,
                    help="Extra folder to resolve image src against (chat uploads are "
                         "searched automatically)")
    ap.add_argument("--stills", action="store_true", help="Also write one PNG per beat")
    args = ap.parse_args(argv)

    render.check_tooling()
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)

    # 1. extract -------------------------------------------------------------
    asset_dir = Path(args.assets) if args.assets else Path(args.html).resolve().parent
    source = Path(args.html).read_text(encoding="utf-8")
    if args.annotate:
        from .annotate import annotate

        ann = annotate(source)
        source = ann.html
        (work / "annotated.html").write_text(source, encoding="utf-8")
        (work / "annotations.txt").write_text(ann.manifest(), encoding="utf-8")
        print(f"annotate: {len(ann.annotations)} refs injected")
        for n in ann.notes:
            print(f"  note: {n}", file=sys.stderr)
    ex = extract(source)
    _dump_facts(ex, work / "facts.json")
    for w in ex.warnings:
        print(f"  warn: {w}", file=sys.stderr)
    print(f"extract: {len(ex.facts)} facts, {len(ex.charts)} charts, "
          f"{len(ex.fragments)} fragments")

    # 2. author --------------------------------------------------------------
    if args.scene:
        scene = author_mod.load(args.scene)
        print(f"author: loaded {args.scene} ({len(scene.beats)} beats)")
    else:
        scene = author_mod.author(
            ex, brief=args.brief, target_s=args.target, voice=args.voice, aspect=args.aspect
        )
        (work / "scene.json").write_text(scene.model_dump_json(indent=2), encoding="utf-8")
        print(f"author: {len(scene.beats)} beats, "
              f"~{sum(b.est_dur_s for b in scene.beats):.0f}s estimated")

    # 3. ground --------------------------------------------------------------
    report = ground.check(scene, ex, allow_unverified=args.allow_unverified)
    print(report)
    if not report.ok and not args.no_gate:
        print("\ngrounding gate failed — fix the scene or pass --no-gate", file=sys.stderr)
        return 2

    # 4. voice ---------------------------------------------------------------
    if args.no_tts:
        from .preview import build as build_storyboard
        from .voice import estimate_scene

        timed = estimate_scene(scene)
        (work / "timed.json").write_text(timed.model_dump_json(indent=2), encoding="utf-8")
        props = render.build_props(timed, ex, work / "props.json", base_dir=asset_dir)
        board = Path(args.out).with_suffix(".html")
        board.parent.mkdir(parents=True, exist_ok=True)
        board.write_text(build_storyboard(json.loads(props.read_text())), encoding="utf-8")
        print(f"no-tts: {timed.total_s:.1f}s estimated -> {board}")
        return 0

    aligner = Aligner() if args.align else NullAligner()
    timed: TimedScene = voice_scene(
        scene,
        public_dir=REMOTION / "public",
        cache_dir=work / "tts-cache",
        backend=XaiTTS(),
        aligner=aligner,
    )
    (work / "timed.json").write_text(timed.model_dump_json(indent=2), encoding="utf-8")
    drift = timed.total_s - sum(b.est_dur_s for b in scene.beats)
    print(f"voice: {timed.total_s:.1f}s actual ({drift:+.1f}s vs estimate), "
          f"{timed.total_frames} frames")

    # 5. render --------------------------------------------------------------
    props = render.build_props(timed, ex, work / "props.json", base_dir=asset_dir)
    render.ensure_remotion(REMOTION)
    out = render.render(props, REMOTION, Path(args.out), aspect=args.aspect)
    print(f"render: {out}")

    if args.stills:
        paths = render.beat_stills(timed, props, REMOTION, work / "stills")
        print(f"stills: {len(paths)} written to {work / 'stills'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
