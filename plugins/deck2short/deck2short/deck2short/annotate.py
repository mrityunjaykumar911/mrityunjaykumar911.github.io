"""Make un-annotated HTML addressable.

The extractor's contract assumes a cooperating generator. Most HTML in the wild
is not cooperating — it is an Astro or Next build with hashed class names and no
semantic hooks. This stage walks such a document and injects `data-ref`,
`data-value` and chart sidecars so the rest of the pipeline works unchanged.

It is deliberately conservative. A wrong `data-value` here becomes a "verified"
fact downstream that the grounding gate will happily wave through, so anything
the annotator is not sure about is left as text and picked up (marked
unverified) by the extractor's own fallback.

Run it once, commit the output, then hand-correct. Auto-annotation is a
bootstrap, not a permanent input.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from pathlib import Path

from lxml import html as lxml_html

from .extract import _PERIOD_RE, parse_number  # noqa: PLC2701

HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
CONTAINERS = {"section", "article", "figure", "aside", "table", "blockquote"}
LEAF = {"p", "li", "td", "th", "dd", "dt", "strong", "b", "em"}

# Class or id fragments that usually mark a number worth lifting.
STAT_HINT = re.compile(r"stat|metric|kpi|figure|number|count|value|highlight", re.I)

_SLUG_STOP = {
    "the", "a", "an", "of", "and", "or", "to", "for", "in", "on", "with", "at",
    "by", "from", "my", "i", "is", "that", "this",
}


def _slug(text: str, words: int = 4) -> str:
    toks = re.findall(r"[a-z0-9]+", text.lower())
    keep = [t for t in toks if t not in _SLUG_STOP][:words]
    return "-".join(keep) or "node"


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


@dataclass
class Annotation:
    ref: str
    tag: str
    kind: str  # "text" | "stat" | "container" | "chart"
    preview: str
    value: float | None = None
    unit: str | None = None


@dataclass
class AnnotateResult:
    html: str
    annotations: list[Annotation] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def manifest(self) -> str:
        by_kind: dict[str, list[Annotation]] = {}
        for a in self.annotations:
            by_kind.setdefault(a.kind, []).append(a)
        out = []
        for kind in ("stat", "image", "chart", "text", "container"):
            items = by_kind.get(kind, [])
            if not items:
                continue
            out.append(f"## {kind} ({len(items)})")
            for a in items:
                v = f" = {a.value:g} ({a.unit})" if a.value is not None else ""
                out.append(f"  {a.ref}{v}  <{a.tag}> {a.preview[:70]!r}")
        return "\n".join(out)


class _Refs:
    """Stable, human-readable, collision-free refs."""

    def __init__(self) -> None:
        self._seen: dict[str, int] = {}

    def make(self, base: str) -> str:
        n = self._seen.get(base, 0)
        self._seen[base] = n + 1
        return base if n == 0 else f"{base}-{n + 1}"


_STAT_COVERAGE = 0.55
_MAX_STAT_LEN = 28


def _stat_value(text: str) -> tuple[float, str] | None:
    """A node is a stat only when the number essentially *is* its text.

    'Q3 revenue' is not a stat. '4.6x' is. '100M+' is. The '+' and '~' prefixes
    that decorate marketing figures are stripped before the coverage test.
    """
    stripped = _PERIOD_RE.sub("", text).strip().lstrip("+~≈").strip()
    if not stripped or len(stripped) > _MAX_STAT_LEN:
        return None
    core = stripped.rstrip("+")
    parsed = parse_number(core)
    if not parsed:
        return None
    # Coverage: how much of the string did the number account for?
    m = re.search(r"[$€£¥]?\s*\d[\d,]*(?:\.\d+)?\s*\S{0,8}", core)
    if not m or len(m.group().strip()) < _STAT_COVERAGE * len(core):
        return None
    return parsed


def _table_sidecar(table, ref: str) -> dict | None:
    """Two-column label/value tables become chart data.

    Wider tables are skipped rather than guessed at — picking the wrong column
    would produce confident, wrong numbers.
    """
    rows = table.xpath(".//tr")
    cats: list[str] = []
    vals: list[float] = []
    unit = "absolute"
    for tr in rows:
        cells = tr.xpath("./td|./th")
        if len(cells) != 2:
            continue
        label = _clean(cells[0].text_content())
        parsed = parse_number(_clean(cells[1].text_content()))
        if parsed is None or not label:
            continue
        cats.append(label)
        vals.append(parsed[0])
        unit = parsed[1]
    if len(vals) < 2:
        return None
    return {"title": None, "categories": cats, "series": [{"values": vals, "unit": unit}]}


def annotate(source: str, max_text_refs: int = 200) -> AnnotateResult:
    doc = lxml_html.fromstring(source)
    refs = _Refs()
    res = AnnotateResult(html="")

    # 1. stats first — they are the highest-value refs and should win the
    #    nicest slugs before generic text nodes consume them.
    for node in doc.iter():
        if not isinstance(node.tag, str) or node.tag in ("script", "style"):
            continue
        if node.get("data-ref"):
            continue
        text = _clean(node.text_content())
        if not text:
            continue
        hinted = STAT_HINT.search(" ".join(filter(None, (node.get("class"), node.get("id")))) or "")
        if node.tag not in LEAF and node.tag not in HEADINGS and not hinted:
            continue
        sv = _stat_value(text)
        if sv is None:
            continue
        # Prefer a label from the following sibling, which is how stat blocks
        # are almost always marked up.
        sib = node.getnext()
        label = _clean(sib.text_content()) if sib is not None else ""
        base = _slug(label or text) if label else f"stat-{_slug(text)}"
        ref = refs.make(base)
        node.set("data-ref", ref)
        node.set("data-value", f"{sv[0]:g}")
        node.set("data-unit", sv[1])
        res.annotations.append(
            Annotation(ref, node.tag, "stat", text, value=sv[0], unit=sv[1])
        )

    # 2. images. Named from their alt text, which is usually the most
    #    descriptive string available and survives a rebuild.
    for img in doc.xpath("//img"):
        if img.get("data-ref"):
            continue
        src = img.get("src") or ""
        if not src or src.startswith("data:image/svg"):
            continue
        base = _slug(_clean(img.get("alt")) or Path(src).stem.replace("-", " "), 4)
        ref = refs.make("img-" + base)
        img.set("data-ref", ref)
        res.annotations.append(Annotation(ref, "img", "image", src))

    # 3. tables -> chart sidecars
    for table in doc.xpath("//table"):
        if table.get("data-ref"):
            continue
        prior = table.xpath("preceding::h1[1]|preceding::h2[1]|preceding::h3[1]")
        base = _slug(_clean(prior[-1].text_content()), 3) if prior else "data"
        ref = refs.make(base + "-table")
        sidecar = _table_sidecar(table, ref)
        if not sidecar:
            res.notes.append(f"table {ref}: not a 2-column label/value table, skipped")
            continue
        table.set("data-ref", ref)
        import json

        script = lxml_html.Element("script")
        script.set("type", "application/json")
        script.set("data-facts", ref)
        script.text = json.dumps(sidecar)
        table.addnext(script)
        res.annotations.append(
            Annotation(ref, "table", "chart", f"{len(sidecar['categories'])} rows")
        )

    # 4. headings and containers -> fragment + text refs
    count = 0
    for node in doc.iter():
        if not isinstance(node.tag, str) or node.get("data-ref"):
            continue
        if node.tag in HEADINGS:
            text = _clean(node.text_content())
            if not text:
                continue
            ref = refs.make(_slug(text))
            node.set("data-ref", ref)
            res.annotations.append(Annotation(ref, node.tag, "text", text))
            count += 1
        elif node.tag in CONTAINERS:
            text = _clean(node.text_content())
            if len(text) < 40:
                continue
            head = node.xpath(".//h1|.//h2|.//h3|.//h4")
            base = _slug(_clean(head[0].text_content())) if head else _slug(text, 3)
            ref = refs.make(base + "-block")
            node.set("data-ref", ref)
            res.annotations.append(Annotation(ref, node.tag, "container", text))
        if count >= max_text_refs:
            break

    if not res.annotations:
        res.notes.append("nothing addressable found — the document may be JS-rendered")
    res.html = lxml_html.tostring(doc, encoding="unicode", doctype="<!doctype html>")
    return res
