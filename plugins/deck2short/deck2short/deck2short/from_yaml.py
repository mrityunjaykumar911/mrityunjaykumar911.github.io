"""Ingest a structured YAML résumé as the fact source.

Scraping a built page is a fallback. When the site is generated from structured
data, that data *is* the ground truth and should be read directly: every fact
gets an exact address (`experience.0.lead.2`), numbers come with their markup
intact, and nothing depends on heuristics guessing which `<div>` was a stat.

Refs are dotted YAML paths, so a claim's `source_ref` points at the precise
line a human can open and check:

    profile.signals.1.value        -> "100M+"
    experience.0.lead.2            -> the bullet containing **4.6x**
    experience.3.lead.1#0          -> first emphasised number inside that bullet

Emphasised spans (`**4.6x**`, `**+45%**`) are lifted into their own numeric
facts with a `#n` suffix, because in this document the author has already
marked exactly which figures matter.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from .extract import Extraction, Fact, parse_number

_EMPH = re.compile(r"\*\*(.+?)\*\*")

# Fields that hold dates, identifiers or handles. A digit in one of these is
# never a claim, and letting "2022-05" become the number 2022 would put a
# fabricated figure into the fact table wearing a verified badge.
_SKIP_KEYS = {
    "start", "end", "meta", "handle", "href", "icon", "email", "avatar",
    "resumePdf", "pronunciation", "id", "flag", "url", "doi",
}

# The number must essentially *be* the string. "4.6x" and "+45%" qualify;
# "EuroSys 2022" and "US11573860B1" do not.
_COVERAGE = 0.45
_MD = re.compile(r"\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\([^)]*\)")


def strip_markup(text: str) -> str:
    """Remove the inline markup the site's renderer understands."""
    def sub(m: re.Match[str]) -> str:
        return next(g for g in m.groups() if g is not None)

    return re.sub(r"\s+", " ", _MD.sub(sub, text)).strip()


def _numeric(text: str) -> tuple[float, str] | None:
    """Parse only when the string is a figure, not merely contains a digit."""
    core = text.strip().lstrip("+~≈").rstrip("+").strip()
    if not core or len(core) > 18 or not re.search(r"\d", core):
        return None
    parsed = parse_number(core)
    if not parsed:
        return None
    m = re.search(r"[$€£¥]?\s*\d[\d,]*(?:\.\d+)?\s*\S{0,4}", core)
    if not m or len(m.group().strip()) < _COVERAGE * len(core):
        return None
    return parsed


def _walk(node: Any, prefix: str = "") -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    if isinstance(node, dict):
        for k, v in node.items():
            out += _walk(v, f"{prefix}.{k}" if prefix else str(k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out += _walk(v, f"{prefix}.{i}")
    elif node is not None:
        out.append((prefix, node))
    return out


def load(path: str | Path, image_root: Path | None = None) -> Extraction:
    """Read a résumé YAML into an Extraction the rest of the pipeline accepts."""
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    ex = Extraction()

    for ref, value in _walk(data):
        if isinstance(value, bool) or ref.startswith("skills."):
            continue  # skills feed JSON-LD only; not spoken content
        text = str(value)
        clean = strip_markup(text)
        if not clean:
            continue

        if isinstance(value, (int, float)):
            ex.facts[ref] = Fact(ref=ref, kind="number", text=clean, value=float(value))
            continue

        # A short string that is essentially a number is a stat in its own right.
        parsed = _numeric(clean) if ref.rsplit(".", 1)[-1] not in _SKIP_KEYS else None
        if parsed:
            ex.facts[ref] = Fact(
                ref=ref, kind="number", text=clean, value=parsed[0], unit=parsed[1]
            )
        else:
            ex.facts[ref] = Fact(ref=ref, kind="text", text=clean)

        # The author has already marked the load-bearing figures with **bold**.
        # Lift each one into an addressable, verified numeric fact.
        for i, span in enumerate(_EMPH.findall(text)):
            span_clean = strip_markup(span)
            got = _numeric(span_clean)
            if got:
                sub = f"{ref}#{i}"
                ex.facts[sub] = Fact(
                    ref=sub, kind="number", text=span_clean, value=got[0], unit=got[1]
                )

    # Images referenced by the profile, resolved against the repo checkout.
    avatar = (data.get("profile") or {}).get("avatar")
    if avatar:
        ex.images["profile.avatar"] = {
            "src": avatar.lstrip("/"),
            "alt": f"Portrait of {(data.get('profile') or {}).get('name', '')}".strip(),
            "width": None,
            "height": None,
        }

    if not ex.facts:
        ex.warnings.append("no facts parsed — is this the résumé YAML?")
    return ex


def chart_from(ex: Extraction, refs: list[tuple[str, str]], title: str, unit: str = "percent"):
    """Assemble a chart from facts that already exist, rather than inventing one.

    `refs` is [(label, ref)]. Every value is looked up in the fact table, so a
    chart cannot drift from the source the way a hand-written data block can.
    """
    from .ir import ChartData

    cats, vals = [], []
    for label, ref in refs:
        fact = ex.facts.get(ref)
        if fact is None or fact.value is None:
            raise KeyError(f"chart source {ref} is not a numeric fact")
        cats.append(label)
        vals.append(fact.value)
    return ChartData(title=title, categories=cats, values=vals, unit=unit)  # type: ignore[arg-type]
