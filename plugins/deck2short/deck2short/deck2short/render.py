"""Render: Scene -> frames -> mux.

Remotion renders by frame index, so the output is deterministic and
reproducible. A realtime screencast (Playwright --save-video, headless capture)
drops frames under load, which is exactly why cheap HTML-to-video pipelines
look janky no matter how good the HTML is.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import shutil
import subprocess
import warnings
from pathlib import Path
from urllib.parse import urlparse

from .extract import Extraction
from .ir import TimedScene, dimensions


_PLACEHOLDER_MAX = 6_000_000


ASSET_ROOTS = (Path("/mnt/user-data/uploads"),)


def inline_image(entry: dict, base_dir: Path | None) -> str | None:
    """Resolve an image ref to something a renderer can actually draw.

    Local files become data URIs. Remote URLs are left alone and warned about:
    a published artifact's content-security policy blocks remote images, and a
    render that reaches the network is not reproducible. Fetch them into the
    project and re-run rather than hoping.
    """
    src = entry.get("src", "")
    if src.startswith("data:"):
        return src
    parsed = urlparse(src)
    if parsed.scheme in ("http", "https"):
        warnings.warn(
            f"remote image not inlined: {src} — download it next to the HTML "
            "so it can be embedded",
            stacklevel=2,
        )
        return None
    # Try the document's own folder, then any asset roots (chat uploads land in
    # one of these), then a basename match anywhere under them. The last case
    # is what makes "just attach the file" work when the HTML references
    # images/foo.jpg but the upload arrives flat.
    roots = [r for r in (base_dir, *ASSET_ROOTS) if r and r.is_dir()]
    rel = src.lstrip("/")
    name = Path(rel).name
    for root in roots:
        for cand in ((root / rel), *root.rglob(name)):
            if cand.is_file() and cand.stat().st_size <= _PLACEHOLDER_MAX:
                mime = mimetypes.guess_type(cand.name)[0] or "image/jpeg"
                return (
                    f"data:{mime};base64,"
                    + base64.b64encode(cand.read_bytes()).decode()
                )
    return None


def placeholder(ref: str, label: str, initials: str = "") -> str:
    """A visibly-provisional stand-in, so a missing asset is obvious in review
    rather than silently rendering an empty frame."""
    text = initials or ref[:2].upper()
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">'
        f'<rect width="1080" height="1350" fill="#151518"/>'
        f'<text x="540" y="660" font-family="Archivo,sans-serif" font-size="300" '
        f'font-weight="800" fill="#2BE08A" text-anchor="middle" '
        f'letter-spacing="-16">{text}</text>'
        f'<text x="540" y="780" font-family="Inter Tight,sans-serif" font-size="34" '
        f'fill="#6E736F" text-anchor="middle">{label}</text></svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def build_props(
    scene: TimedScene, ex: Extraction, out_path: Path, base_dir: Path | None = None
) -> Path:
    """Freeze everything the composition needs into one props file.

    The renderer performs no lookups. Fragments, CSS and chart data all travel
    with the scene, so a props.json is a complete, replayable render input.
    """
    needed_fragments: dict[str, str] = {}
    needed_charts = {}
    for b in scene.beats:
        v = b.visual
        if v.type == "html_fragment":
            for ref in filter(None, (v.ref, v.focus_ref)):
                if ref in ex.fragments:
                    needed_fragments[ref] = ex.fragments[ref]
        elif v.type == "chart_reveal" and v.src in ex.charts:
            needed_charts[v.src] = ex.charts[v.src]

    needed_images: dict[str, str] = {}
    for b in scene.beats:
        v = b.visual
        if v.type != "image":
            continue
        entry = ex.images.get(v.src)
        if entry is None:
            warnings.warn(f"image ref {v.src} not found in source", stacklevel=2)
            needed_images[v.src] = placeholder(v.src, "missing ref")
            continue
        uri = inline_image(entry, base_dir)
        needed_images[v.src] = uri or placeholder(
            v.src, entry.get("src", ""), _initials(entry.get("alt", ""))
        )

    scene = scene.model_copy(
        update={
            "fragments": needed_fragments,
            "charts": needed_charts,
            "images": needed_images,
            "frag_css": ex.css,
            "font_css": ex.font_css,
        }
    )
    out_path.write_text(scene.model_dump_json(indent=2), encoding="utf-8")
    return out_path


def _initials(alt: str) -> str:
    words = [w for w in alt.replace(",", " ").split() if w[:1].isalpha()]
    skip = {"portrait", "photo", "picture", "image", "of", "a", "the"}
    keep = [w for w in words if w.lower() not in skip][:2]
    return "".join(w[0].upper() for w in keep)


def render(
    props_path: Path,
    remotion_dir: Path,
    out_video: Path,
    aspect: str = "9:16",
    concurrency: int | None = None,
    crf: int = 18,
) -> Path:
    width, height = dimensions(aspect)
    out_video.parent.mkdir(parents=True, exist_ok=True)
    raw = out_video.with_name(out_video.stem + ".raw.mp4")

    cmd = [
        "npx", "remotion", "render", "src/index.ts", "Short", str(raw.resolve()),
        f"--props={props_path.resolve()}",
        f"--width={width}", f"--height={height}",
        f"--crf={crf}",
        "--pixel-format=yuv420p",
        "--codec=h264",
    ]
    if concurrency:
        cmd.append(f"--concurrency={concurrency}")

    subprocess.run(cmd, cwd=remotion_dir, check=True)
    return _normalise(raw, out_video)


def _normalise(src: Path, dst: Path) -> Path:
    """Two-pass loudness normalisation to broadcast target.

    Short-form platforms normalise on ingest; arriving already at -14 LUFS
    avoids their limiter squashing the transients that make cuts feel tight.
    """
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            str(dst),
        ],
        check=True,
        capture_output=True,
    )
    src.unlink(missing_ok=True)
    return dst


def ensure_remotion(remotion_dir: Path) -> None:
    if not (remotion_dir / "node_modules").exists():
        subprocess.run(["npm", "install"], cwd=remotion_dir, check=True)


def write_still(props_path: Path, remotion_dir: Path, out_png: Path, frame: int = 12) -> Path:
    """Render one frame. Use this for fast visual iteration and for the VLM
    judge — a still per beat is far cheaper to score than a video."""
    subprocess.run(
        [
            "npx", "remotion", "still", "src/index.ts", "Short", str(out_png.resolve()),
            f"--props={props_path.resolve()}", f"--frame={frame}",
        ],
        cwd=remotion_dir,
        check=True,
    )
    return out_png


def beat_stills(scene: TimedScene, props_path: Path, remotion_dir: Path, out_dir: Path) -> list[Path]:
    """One still from the middle of each beat."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for b in scene.beats:
        mid = round((b.start_s + b.dur_s / 2) * scene.fps)
        paths.append(write_still(props_path, remotion_dir, out_dir / f"{b.id}.png", frame=mid))
    return paths


def check_tooling() -> None:
    for exe in ("ffmpeg", "ffprobe", "npx"):
        if shutil.which(exe) is None:
            raise RuntimeError(f"{exe} not found on PATH")
