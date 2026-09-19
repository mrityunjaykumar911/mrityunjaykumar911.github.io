"""The grounding gate.

This is the check a script-first pipeline structurally cannot run. Because the
voiceover was authored *from* the fact table rather than from a human's script,
every number it speaks can be resolved back to the node it came from.

Two directions, and the second one matters more:

  forward  — each declared claim resolves to a fact, and the values agree
  reverse  — every numeral spoken in the voiceover is covered by some claim

Forward-only checking is easy to pass by simply declaring fewer claims. The
reverse check is what catches a fabricated number.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .extract import Extraction, parse_number, resolve
from .ir import SceneIR

# Numerals that are never data: ordinals, small counting words, years, clock times.
_IGNORE_SPANS = re.compile(
    r"\b(?:19|20)\d{2}\b"            # years
    r"|\b(?:q[1-4]|h[12]|fy\d{2,4})\b"  # fiscal periods
    r"|\b(?:one|two|three|first|second|third|half|twice|double)\b"
    r"|\b\d{1,2}:\d{2}\b",           # times
    re.I,
)

_NUMERAL = re.compile(r"[$€£¥]?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|percent|bps|[KMB]\b|x\b|million|billion|thousand|trillion)?", re.I)

# Relative tolerance by unit. Percentages are compared absolutely, in points.
_REL_TOL = 0.005
_PCT_ABS_TOL = 0.05


@dataclass
class Failure:
    beat: str
    kind: str  # "unresolved" | "mismatch" | "uncovered" | "unverified"
    detail: str


@dataclass
class Report:
    failures: list[Failure] = field(default_factory=list)
    checked: int = 0

    @property
    def ok(self) -> bool:
        return not any(f.kind != "unverified" for f in self.failures)

    def __str__(self) -> str:
        if not self.failures:
            return f"grounding: {self.checked} claims, all resolved"
        lines = [f"grounding: {self.checked} claims, {len(self.failures)} issue(s)"]
        lines += [f"  [{f.kind}] {f.beat}: {f.detail}" for f in self.failures]
        return "\n".join(lines)


def _agrees(spoken: float, actual: float, unit: str) -> bool:
    if unit == "percent":
        return abs(spoken - actual) <= _PCT_ABS_TOL
    if actual == 0:
        return abs(spoken) <= 1e-9
    return abs(spoken - actual) / abs(actual) <= _REL_TOL


def check(scene: SceneIR, ex: Extraction, allow_unverified: bool = False) -> Report:
    report = Report()

    for beat in scene.beats:
        # --- forward -------------------------------------------------------
        for claim in beat.claims:
            report.checked += 1
            found = resolve(ex, claim.source_ref)
            if found is None:
                report.failures.append(
                    Failure(beat.id, "unresolved", f"{claim.source_ref} is not in the fact table")
                )
                continue
            actual, unit = found
            if not _agrees(claim.value, actual, claim.unit):
                report.failures.append(
                    Failure(
                        beat.id,
                        "mismatch",
                        f"says {claim.text!r} ({claim.value:g}) but "
                        f"{claim.source_ref} = {actual:g} ({unit})",
                    )
                )
            fact = ex.facts.get(claim.source_ref)
            if fact is not None and not fact.verified:
                kind = "mismatch" if not allow_unverified else "unverified"
                report.failures.append(
                    Failure(
                        beat.id, kind,
                        f"{claim.source_ref} was recovered by text parsing, not a sidecar value",
                    )
                )

        # --- reverse -------------------------------------------------------
        for span in _uncovered_numerals(beat.vo, [c.text for c in beat.claims]):
            report.failures.append(
                Failure(beat.id, "uncovered", f"spoken number {span!r} has no claim")
            )

        # visuals that assert a value carry their own ref
        v = beat.visual
        if v.type == "stat":
            report.checked += 1
            found = resolve(ex, v.source_ref)
            if found is None:
                report.failures.append(
                    Failure(beat.id, "unresolved", f"stat source_ref {v.source_ref} not found")
                )
            else:
                shown = parse_number(v.display)
                if shown and not _agrees(shown[0], found[0], found[1]):
                    report.failures.append(
                        Failure(
                            beat.id, "mismatch",
                            f"stat shows {v.display!r} but {v.source_ref} = {found[0]:g}",
                        )
                    )
        elif v.type == "chart_reveal":
            if v.src not in ex.charts:
                report.failures.append(
                    Failure(beat.id, "unresolved", f"chart {v.src} has no sidecar data")
                )
            else:
                n = len(ex.charts[v.src].values)
                bad = [i for i in v.highlight if i >= n]
                if bad:
                    report.failures.append(
                        Failure(beat.id, "unresolved", f"highlight index out of range: {bad}")
                    )
        elif v.type == "html_fragment":
            if v.ref not in ex.fragments:
                report.failures.append(
                    Failure(beat.id, "unresolved", f"no element with data-ref={v.ref!r}")
                )
            if v.focus_ref and v.focus_ref not in ex.fragments:
                report.failures.append(
                    Failure(beat.id, "unresolved", f"focus_ref {v.focus_ref!r} not found")
                )

    return report


def _uncovered_numerals(vo: str, claim_texts: list[str]) -> list[str]:
    """Numerals in the voiceover not accounted for by any claim."""
    masked = vo
    for t in claim_texts:
        masked = masked.replace(t, " " * len(t))
    masked = _IGNORE_SPANS.sub(lambda m: " " * len(m.group()), masked)
    return [m.group().strip() for m in _NUMERAL.finditer(masked) if m.group().strip()]


def enforce(scene: SceneIR, ex: Extraction, strict: bool = True) -> Report:
    report = check(scene, ex, allow_unverified=not strict)
    if strict and not report.ok:
        raise ValueError(str(report))
    return report
