"""Re-author the source HTML as short-form beats.

This stage does not transcode. A document is one idea per section, dense text,
long dwell. Short-form is one idea per video, a cut every 1.5-3 seconds, and a
hook in the first second. Most of the source structure is discarded on purpose.

Output is forced through the SceneIR JSON schema via tool use, then validated
with pydantic. A validation failure is fed back once as a repair turn — models
fix their own schema errors reliably, and a retry is cheaper than a loose schema.
"""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING

from pydantic import ValidationError

if TYPE_CHECKING:
    import anthropic

from .extract import Extraction
from .ir import MAX_BEAT_S, MAX_TOTAL_S, MIN_BEAT_S, SceneIR

MODEL = os.environ.get("D2S_AUTHOR_MODEL", "claude-sonnet-4-6")

SYSTEM = f"""You turn a generated HTML document into a vertical short-form video script.

You are re-authoring, not summarising. Throw away the document's structure.

Hard rules:
- Beat 0 is the hook. It must land one concrete, surprising fact in under two
  seconds. No throat-clearing, no "in this video", no company name first.
- One idea per beat. If a beat's voiceover has two clauses joined by "and",
  split it into two beats.
- Every beat is {MIN_BEAT_S}-{MAX_BEAT_S} seconds. Estimate est_dur_s at roughly
  2.6 spoken words per second. Total must stay under {MAX_TOTAL_S} seconds.
- Spoken register. Contractions. No bullet-speak, no colons, no parentheticals.
- Every number you speak MUST have a matching entry in `claims`, with `text`
  copied verbatim from the voiceover and `source_ref` pointing at a ref from the
  fact table. If a number is not in the fact table, do not say it. Never round a
  figure into a different value; round the wording, not the number.
- Refs marked [unverified] were recovered by text parsing. Prefer verified refs.
- Close on a consequence, not a summary.

Visual selection:
- `stat` for a single number. This is the default and the strongest beat type.
- `chart_reveal` when the shape of a trend matters more than one value. Set
  `highlight` to the categories the voiceover actually names.
- `html_fragment` to lift a piece of the source document verbatim — use it when
  the original design carries meaning (a diagram, a table, a styled callout).
  Set fit to "crop_focus" and focus_ref to the child that must stay centred.
- `contrast` for before/after or us/them.
- `title_card` sparingly, and never more than once.

Alternate visual types across consecutive beats. Three `stat` beats in a row is
a failure."""

TOOL_NAME = "emit_scene"


def _tool_schema() -> dict:
    schema = SceneIR.model_json_schema()
    return {
        "name": TOOL_NAME,
        "description": "Emit the finished short-form scene.",
        "input_schema": schema,
    }


def _user_prompt(ex: Extraction, brief: str | None, target_s: float) -> str:
    parts = [
        "FACT TABLE — the only numbers you may speak. Cite by the ref on the left.",
        "```",
        ex.digest(),
        "```",
        "",
        f"Target length: about {target_s:.0f} seconds.",
    ]
    if brief:
        parts += ["", f"Brief from the author: {brief}"]
    if ex.warnings:
        parts += ["", "Extraction warnings: " + "; ".join(ex.warnings)]
    return "\n".join(parts)


def author(
    ex: Extraction,
    brief: str | None = None,
    target_s: float = 35.0,
    voice: str = "eve",
    aspect: str = "9:16",
    client: "anthropic.Anthropic | None" = None,
) -> SceneIR:
    if client is None:
        import anthropic  # imported here so downstream stages need no SDK

        client = anthropic.Anthropic()
    tool = _tool_schema()
    messages: list[dict] = [{"role": "user", "content": _user_prompt(ex, brief, target_s)}]

    last_error: str | None = None
    for attempt in range(2):
        resp = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM,
            tools=[tool],
            tool_choice={"type": "tool", "name": TOOL_NAME},
            messages=messages,
        )
        block = next((b for b in resp.content if b.type == "tool_use"), None)
        if block is None:
            raise RuntimeError("model returned no tool_use block")

        payload = dict(block.input)
        payload.setdefault("voice", voice)
        payload.setdefault("aspect", aspect)
        try:
            scene = SceneIR.model_validate(payload)
        except ValidationError as e:
            last_error = _format_errors(e)
            if attempt == 1:
                raise
            messages += [
                {"role": "assistant", "content": resp.content},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "is_error": True,
                            "content": f"Schema validation failed:\n{last_error}\n"
                            "Re-emit the whole scene with these fixed.",
                        }
                    ],
                },
            ]
            continue

        return _postcheck(scene)

    raise RuntimeError(f"authoring failed after repair: {last_error}")


def _format_errors(e: ValidationError) -> str:
    return "\n".join(
        f"- {'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors()[:12]
    )


def _postcheck(scene: SceneIR) -> SceneIR:
    """Soft quality rules — warn rather than reject, since they are taste."""
    kinds = [b.visual.type for b in scene.beats]
    for i in range(len(kinds) - 2):
        if kinds[i] == kinds[i + 1] == kinds[i + 2]:
            import warnings

            warnings.warn(f"three consecutive {kinds[i]} beats at index {i}", stacklevel=2)
            break
    return scene


def load(path: str) -> SceneIR:
    """Load a hand-edited scene.json — the human-in-the-loop path."""
    with open(path, encoding="utf-8") as fh:
        return SceneIR.model_validate(json.load(fh))
