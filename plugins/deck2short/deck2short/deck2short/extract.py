"""Turn generated HTML into a fact table, chart data, and liftable fragments.

The contract with your HTML generator is one attribute and one optional tag:

    <h1 data-ref="hero-title">Revenue grew 18% in Q3</h1>

    <section data-ref="rev-chart">
      <svg>...</svg>
      <script type="application/json" data-facts="rev-chart">
        {"title":"Revenue by quarter",
         "categories":["Q1","Q2","Q3"],
         "series":[{"values":[2.7,2.9,3.2],"unit":"currency"}]}
      </script>
    </section>

The sidecar JSON is the only reliable way to get chart numbers — do not parse
them back out of SVG path geometry. If your generator already builds charts
from a spec (Vega-Lite, Chart.js config), emit that spec as the sidecar and
you are done.

Fallbacks, in order: sidecar JSON -> data-value attributes -> text parse.
The text-parse path records a warning on every fact it produces; the grounding
gate treats those as unverified.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from lxml import html as lxml_html

from .ir import ChartData, Unit

BLOCK_TAGS = {"p", "li", "div", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "dd", "dt"}

_NUM_RE = re.compile(
    r"""(?P<cur>[$€£¥])?\s*
        (?<![A-Za-z])
        (?P<num>-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)
        \s*(?P<suffix>%|percent|bps|[KMB]\b|thousand|million|billion|trillion|x\b)?""",
    re.VERBOSE | re.IGNORECASE,
)

_SCALE = {
    "k": 1e3, "thousand": 1e3,
    "m": 1e6, "million": 1e6,
    "b": 1e9, "billion": 1e9,
    "trillion": 1e12,
}


def parse_number(s: str) -> tuple[float, Unit] | None:
    """Parse the first number in a string into (value, unit).

    Handles '3.2 million', '$4.5B', '18%', '2.4x', '1,204'.
    """
    m = _NUM_RE.search(s)
    if not m:
        return None
    raw = m.group("num").replace(",", "")
    try:
        val = float(raw)
    except ValueError:
        return None
    suf = (m.group("suffix") or "").strip().lower()
    unit: Unit = "absolute"
    if m.group("cur"):
        unit = "currency"
    if suf in ("%", "percent"):
        unit = "percent"
    elif suf == "bps":
        val, unit = val / 100.0, "percent"
    elif suf == "x":
        unit = "multiple"
    elif suf in _SCALE:
        val *= _SCALE[suf]
    return val, unit


@dataclass
class Fact:
    ref: str
    kind: str  # "text" | "number"
    text: str
    value: float | None = None
    unit: Unit = "absolute"
    verified: bool = True  # False when recovered by text parsing


@dataclass
class Extraction:
    facts: dict[str, Fact] = field(default_factory=dict)
    charts: dict[str, ChartData] = field(default_factory=dict)
    fragments: dict[str, str] = field(default_factory=dict)
    images: dict[str, dict] = field(default_factory=dict)
    css: str = ""
    font_css: str = ""
    warnings: list[str] = field(default_factory=list)

    def digest(self, max_chars: int = 12000) -> str:
        """Compact, ref-annotated view of the deck for the authoring model."""
        lines: list[str] = []
        for ref, f in self.facts.items():
            if f.kind == "number":
                mark = "" if f.verified else "  [unverified]"
                lines.append(f"{ref} = {f.value:g} ({f.unit}) :: {f.text!r}{mark}")
            else:
                lines.append(f"{ref} :: {f.text!r}")
        for ref, c in self.charts.items():
            pts = ", ".join(
                f"pt{i}={v:g} [{c.categories[i] if i < len(c.categories) else '?'}]"
                for i, v in enumerate(c.values)
            )
            lines.append(f"{ref}/series0 ({c.title or 'chart'}, {c.unit}): {pts}")
        out = "\n".join(lines)
        return out[:max_chars]


# --- CSS ---------------------------------------------------------------------

_FONT_FACE_RE = re.compile(r"@font-face\s*\{[^}]*\}", re.IGNORECASE)


def split_css(css: str) -> tuple[str, str]:
    """Split @font-face rules out of a stylesheet.

    Chrome ignores @font-face declared inside a shadow root, so those rules are
    hoisted to the document while everything else stays scoped to the fragment.
    """
    faces = _FONT_FACE_RE.findall(css)
    rest = _FONT_FACE_RE.sub("", css)
    return "\n".join(faces), rest


# --- extraction --------------------------------------------------------------


def _block_children(node) -> list:
    return [c for c in node.iterchildren() if isinstance(c.tag, str) and c.tag in BLOCK_TAGS]


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


# A fiscal period is not a measurement. "Q3" must not become the number 3.
_PERIOD_RE = re.compile(r"\b(?:q[1-4]|h[12]|fy\s?\d{2,4}|(?:19|20)\d{2})\b", re.I)

_COVERAGE = 0.6


def _numeric_fact(ref: str, text: str) -> Fact:
    """Text-parse fallback.

    Only treat a string as a measurement when the number *is* the string. A
    label that merely contains a digit ("Gross churn, Q3") is text. The
    coverage test is what separates the two, and it is deliberately strict:
    a wrong fact here would be silently cited as truth downstream.
    """
    stripped = _PERIOD_RE.sub("", text).strip()
    m = _NUM_RE.search(stripped)
    if m and len(m.group().strip()) >= _COVERAGE * max(len(stripped), 1):
        parsed = parse_number(m.group())
        if parsed:
            val, unit = parsed
            return Fact(ref=ref, kind="number", text=text, value=val,
                        unit=unit, verified=False)
    return Fact(ref=ref, kind="text", text=text)


def _chart_from_sidecar(ref: str, payload: dict, series_idx: int = 0) -> ChartData | None:
    series = payload.get("series") or []
    if not series:
        return None
    s = series[min(series_idx, len(series) - 1)]
    values = [float(v) for v in s.get("values", [])]
    if not values:
        return None
    return ChartData(
        title=payload.get("title"),
        categories=[str(c) for c in payload.get("categories", [])],
        values=values,
        unit=s.get("unit", payload.get("unit", "absolute")),
    )


def extract(source: str | Path) -> Extraction:
    """Parse an HTML string or file path into an Extraction."""
    raw = Path(source).read_text(encoding="utf-8") if _looks_like_path(source) else str(source)
    doc = lxml_html.fromstring(raw)
    ex = Extraction()

    # 1. stylesheets, inline only. External <link> hrefs must be inlined by the
    #    generator; a network fetch at render time makes the render irreproducible.
    css_parts = [st.text_content() for st in doc.xpath("//style") if st.text_content()]
    if doc.xpath("//link[@rel='stylesheet']"):
        ex.warnings.append(
            "external stylesheet <link> found and ignored — inline it before rendering"
        )
    ex.font_css, ex.css = split_css("\n".join(css_parts))

    # 2. sidecar chart JSON
    for sc in doc.xpath("//script[@type='application/json'][@data-facts]"):
        ref = sc.get("data-facts")
        try:
            payload = json.loads(sc.text_content())
        except json.JSONDecodeError as e:
            ex.warnings.append(f"{ref}: bad sidecar JSON ({e})")
            continue
        cd = _chart_from_sidecar(ref, payload)
        if cd:
            ex.charts[ref] = cd
        for k, v in (payload.get("scalars") or {}).items():
            ex.facts[f"{ref}.{k}"] = Fact(
                ref=f"{ref}.{k}", kind="number", text=str(v), value=float(v)
            )

    # 3. images. Kept separate from fragments: an <img> is a beat in its own
    #    right, and its src has to be resolved and inlined before render.
    for img in doc.xpath("//img[@data-ref]"):
        ref = img.get("data-ref")
        src = img.get("src") or ""
        if not src:
            ex.warnings.append(f"{ref}: <img> with no src")
            continue
        ex.images[ref] = {
            "src": src,
            "alt": _clean(img.get("alt")),
            "width": img.get("width"),
            "height": img.get("height"),
        }

    # 4. every data-ref node: fragment + facts
    for node in doc.xpath("//*[@data-ref]"):
        ref = node.get("data-ref")
        if not ref:
            continue
        ex.fragments[ref] = lxml_html.tostring(node, encoding="unicode", pretty_print=False)

        text = _clean(node.text_content())
        if node.get("data-value") is not None:
            try:
                ex.facts[ref] = Fact(
                    ref=ref,
                    kind="number",
                    text=text,
                    value=float(node.get("data-value")),
                    unit=node.get("data-unit", "absolute"),  # type: ignore[arg-type]
                )
                continue
            except ValueError:
                ex.warnings.append(f"{ref}: non-numeric data-value")

        if ref not in ex.charts and text:
            ex.facts[ref] = _numeric_fact(ref, text)

        # block children get /pN sub-refs so a beat can cite one bullet
        for i, child in enumerate(_block_children(node)):
            ctext = _clean(child.text_content())
            if not ctext:
                continue
            sub = f"{ref}/p{i}"
            ex.facts[sub] = _numeric_fact(sub, ctext)

    if not ex.facts and not ex.charts:
        ex.warnings.append("no data-ref attributes found — nothing is addressable or groundable")
    return ex


def _looks_like_path(source: str | Path) -> bool:
    if isinstance(source, Path):
        return True
    s = source.strip()
    return len(s) < 4096 and "\n" not in s and not s.startswith("<") and Path(s).exists()


def resolve(ex: Extraction, ref: str) -> tuple[float, Unit] | None:
    """Resolve a claim's source_ref to a numeric value."""
    m = re.match(r"^([\w.-]+)/series(\d+)/pt(\d+)$", ref)
    if m:
        chart = ex.charts.get(m.group(1))
        idx = int(m.group(3))
        if chart and idx < len(chart.values):
            return chart.values[idx], chart.unit
        return None
    fact = ex.facts.get(ref)
    if fact and fact.kind == "number" and fact.value is not None:
        return fact.value, fact.unit
    return None
