"""Scene IR: the single contract every stage reads and writes.

Authoring produces SceneIR. Voice turns it into TimedScene by replacing the
model's *estimated* beat durations with real audio durations. Grounding gates
SceneIR against Facts extracted from the source HTML. Render consumes
TimedScene only.

Refs address nodes in the source HTML by their `data-ref` attribute:
    hero-title              an element
    risk-list/p2            the 3rd block child of an element
    rev-chart/series0/pt2   a datum inside a chart's sidecar JSON
    experience.0.lead.2#0   the 1st emphasised figure in a YAML bullet
"""

from __future__ import annotations

import re
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, field_validator, model_validator

FPS = 30
MIN_BEAT_S = 0.8  # snap beats: rhythm variation is what stops it feeling like a narrated deck
MAX_BEAT_S = 6.0
MAX_TOTAL_S = 60.0  # but aim for under 25: completion rate falls off a cliff past that
BEAT_GAP_S = 0.0   # beats overlap during the transition instead of butting up

REF_RE = re.compile(r"^[A-Za-z0-9][\w.-]*(?:#\d+)?(?:/(?:p\d+|series\d+/pt\d+))?$")
NODE_REF_RE = re.compile(r"^[A-Za-z0-9][\w.-]*$")

Unit = Literal["absolute", "percent", "currency", "ratio", "multiple"]


def _check(pattern: re.Pattern[str], v: str) -> str:
    if not pattern.match(v):
        raise ValueError(f"malformed ref {v!r}")
    return v


class Claim(BaseModel):
    """One numeric assertion in a beat's voiceover, bound to a source fact.

    `text` must appear verbatim in the beat's `vo` so the grounding gate can
    prove every spoken number is accounted for.
    """

    text: str = Field(min_length=1, description="Verbatim span from vo, e.g. '3.2 million'")
    value: float
    unit: Unit
    source_ref: str

    @field_validator("source_ref")
    @classmethod
    def _v(cls, v: str) -> str:
        return _check(REF_RE, v)


# --- visuals -----------------------------------------------------------------


class HtmlFragment(BaseModel):
    """Lift a subtree of the generated HTML and animate it in place.

    The fragment renders inside a shadow root with the page's own CSS, so it
    looks exactly as it does in the browser. The generator needs to know
    nothing about video.
    """

    type: Literal["html_fragment"] = "html_fragment"
    ref: str
    reveal: Literal["mask_up", "stagger_children", "fade_scale", "none"] = "mask_up"
    fit: Literal["contain", "crop_focus"] = "contain"
    focus_ref: str | None = Field(
        default=None, description="Child ref to keep centred when cropping to vertical"
    )

    @field_validator("ref", "focus_ref")
    @classmethod
    def _v(cls, v: str | None) -> str | None:
        return None if v is None else _check(NODE_REF_RE, v)


class Stat(BaseModel):
    """One number, full bleed. The workhorse beat for short-form."""

    type: Literal["stat"] = "stat"
    display: str = Field(max_length=12, description="As rendered, e.g. '3.2M', '+18%'")
    label: str = Field(max_length=60)
    source_ref: str
    trend: Literal["up", "down", "flat"] | None = None

    @field_validator("source_ref")
    @classmethod
    def _v(cls, v: str) -> str:
        return _check(REF_RE, v)


class ChartReveal(BaseModel):
    """Re-plot a chart's real data at vertical aspect, one series at a time."""

    type: Literal["chart_reveal"] = "chart_reveal"
    src: str = Field(description="Chart ref carrying sidecar JSON, e.g. 'rev-chart'")
    series: int = 0
    highlight: list[int] = Field(default_factory=list, description="Category indices to accent")
    mode: Literal["bars", "line"] = "bars"

    @field_validator("src")
    @classmethod
    def _v(cls, v: str) -> str:
        return _check(NODE_REF_RE, v)


class TitleCard(BaseModel):
    type: Literal["title_card"] = "title_card"
    headline: str = Field(max_length=64)
    sub: str | None = Field(default=None, max_length=90)


class Hook(BaseModel):
    """Tension, then payoff. The first 1.5 seconds decide everything else.

    `tension` is written on screen and is NOT the same words as the voiceover —
    a caption that merely transcribes the audio wastes the only moment the
    viewer is guaranteed to be reading.
    """

    type: Literal["hook"] = "hook"
    tension: str = Field(max_length=44)
    payoff: str = Field(max_length=44)


class ImageBeat(BaseModel):
    """A picture from the source document.

    `src` is a ref, not a URL. Remote images are inlined as data URIs at
    build_props time — a published page cannot fetch them at render, and a
    render that depends on the network is not reproducible.
    """

    type: Literal["image"] = "image"
    src: str
    caption: str | None = Field(default=None, max_length=70)
    treatment: Literal["kenburns", "static", "duotone"] = "kenburns"

    @field_validator("src")
    @classmethod
    def _v(cls, v: str) -> str:
        return _check(NODE_REF_RE, v)


class Contrast(BaseModel):
    """Two things, side by side. Before/after, us/them, was/is."""

    type: Literal["contrast"] = "contrast"
    left: str = Field(max_length=28)
    left_label: str = Field(max_length=40)
    right: str = Field(max_length=28)
    right_label: str = Field(max_length=40)


Visual = Annotated[
    Union[HtmlFragment, Stat, ChartReveal, TitleCard, Contrast, Hook, ImageBeat],
    Field(discriminator="type"),
]

# How a beat enters.
#
# The earlier vocabulary (whip, flash, punch) is the grammar of performance
# marketing: fast, loud, attention-grabbing by force. The restrained house
# style is the opposite — long dissolves, slow scale, nothing that draws
# attention to the edit itself. Confidence is communicated by *not* hurrying.
Transition = Literal["dissolve", "scale_through", "lift", "linger", "cut"]


# --- beats -------------------------------------------------------------------


class Beat(BaseModel):
    id: str = Field(pattern=r"^b\d+$")
    vo: str = Field(min_length=1, max_length=220)
    visual: Visual
    claims: list[Claim] = Field(default_factory=list)
    est_dur_s: float = Field(ge=MIN_BEAT_S, le=MAX_BEAT_S)
    transition: Transition = "dissolve"

    @model_validator(mode="after")
    def _claims_in_vo(self) -> Beat:
        for c in self.claims:
            if c.text not in self.vo:
                raise ValueError(f"{self.id}: claim text {c.text!r} not found in vo")
        return self


class SceneIR(BaseModel):
    aspect: Literal["9:16", "1:1", "16:9"] = "9:16"
    voice: str = "eve"
    beats: list[Beat] = Field(min_length=4, max_length=24)

    @model_validator(mode="after")
    def _shape(self) -> SceneIR:
        ids = [b.id for b in self.beats]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate beat ids")
        if self.beats[0].visual.type not in ("hook", "stat", "title_card", "contrast"):
            raise ValueError("beat 0 must open cold: hook, stat, title_card or contrast")
        if any(b.est_dur_s < 2.4 for b in self.beats):
            raise ValueError("beats under 2.4s fight the slow transitions; lengthen or merge")
        total = sum(b.est_dur_s for b in self.beats)
        if total > MAX_TOTAL_S:
            raise ValueError(f"estimated total {total:.1f}s exceeds {MAX_TOTAL_S}s")
        return self


# --- timed (post-TTS) --------------------------------------------------------


class TimedWord(BaseModel):
    word: str
    start: float
    end: float


class TimedBeat(BaseModel):
    id: str
    vo: str
    visual: Visual
    audio: str = Field(description="Path relative to the Remotion public/ dir")
    dur_s: float
    start_s: float
    words: list[TimedWord] = Field(default_factory=list)
    transition: Transition = "dissolve"


class ChartData(BaseModel):
    title: str | None = None
    categories: list[str]
    values: list[float]
    unit: Unit = "absolute"


class TimedScene(BaseModel):
    """Everything the renderer needs. No further lookups."""

    aspect: Literal["9:16", "1:1", "16:9"]
    fps: int = FPS
    total_frames: int
    beats: list[TimedBeat]
    charts: dict[str, ChartData] = Field(default_factory=dict)
    fragments: dict[str, str] = Field(default_factory=dict, description="ref -> outerHTML")
    images: dict[str, str] = Field(default_factory=dict, description="ref -> data URI or URL")
    frag_css: str = Field(default="", description="Page CSS, minus @font-face")
    font_css: str = Field(default="", description="@font-face rules, hoisted to document")

    @property
    def total_s(self) -> float:
        return self.total_frames / self.fps


def dimensions(aspect: str) -> tuple[int, int]:
    return {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}[aspect]
