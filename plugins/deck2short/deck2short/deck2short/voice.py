"""Voice: synthesise per beat, measure, align.

Per-beat synthesis is the whole trick. Beat duration falls out of `ffprobe` on
the returned file, so the timeline never depends on the model's guess or on ASR.
Forced alignment is only needed for word-level caption highlighting, and it
aligns against the known script rather than transcribing blind — it cannot
invent a word that was never spoken.

Audio is cached by hash of (text, voice, model, format). TTS is not guaranteed
deterministic across runs, and if a beat's audio length shifts by 80ms on a
re-render the entire downstream timeline moves. The cache is what makes the
render reproducible.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .ir import (
    BEAT_GAP_S,
    FPS,
    MAX_BEAT_S,
    MIN_BEAT_S,
    SceneIR,
    TimedBeat,
    TimedScene,
    TimedWord,
)

# xAI inline delivery tags. They produce audio with no matching script token,
# so they are stripped before alignment but kept for synthesis.
_INLINE_TAG = re.compile(r"\[(?:long-)?pause\]|\[laugh\]|\[sigh\]|\[breath\]", re.I)
_WRAP_TAG = re.compile(r"</?(?:whisper|shout|excited|sad)>", re.I)


def strip_tags(text: str) -> str:
    return re.sub(r"\s{2,}", " ", _WRAP_TAG.sub("", _INLINE_TAG.sub("", text))).strip()


class TTSBackend(Protocol):
    def synth(self, text: str, voice: str, out: Path) -> None: ...


@dataclass
class XaiTTS:
    """xAI Grok TTS.

    Uses the OpenAI-compatible audio.speech shape against xAI's base URL. Voices
    are eve, ara, rex, sal, leo. Verify field names against docs.x.ai before a
    production run — this is the one place the wire format is vendor-specific,
    which is why it lives behind the TTSBackend protocol.
    """

    model: str = "grok-tts"
    fmt: str = "wav"
    sample_rate: int = 48000
    api_key: str | None = None
    base_url: str = "https://api.x.ai/v1"

    def __post_init__(self) -> None:
        from openai import OpenAI

        self._client = OpenAI(
            api_key=self.api_key or os.environ["XAI_API_KEY"], base_url=self.base_url
        )

    def synth(self, text: str, voice: str, out: Path) -> None:
        resp = self._client.audio.speech.create(
            model=self.model,
            voice=voice,
            input=text,
            response_format=self.fmt,
            extra_body={"output_format": {"sample_rate": self.sample_rate}},
        )
        out.write_bytes(resp.read())


@dataclass
class ElevenTTS:
    """Drop-in alternative. Same protocol, different vendor."""

    model: str = "eleven_turbo_v2_5"
    api_key: str | None = None

    def synth(self, text: str, voice: str, out: Path) -> None:
        from elevenlabs.client import ElevenLabs

        client = ElevenLabs(api_key=self.api_key or os.environ["ELEVEN_API_KEY"])
        audio = client.text_to_speech.convert(
            voice_id=voice, model_id=self.model, text=text, output_format="pcm_48000"
        )
        _pcm_to_wav(b"".join(audio), out, sample_rate=48000)


def _pcm_to_wav(pcm: bytes, out: Path, sample_rate: int) -> None:
    import wave

    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)


# --- measurement -------------------------------------------------------------


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


# --- alignment ---------------------------------------------------------------


class Aligner:
    """WhisperX forced alignment against known text.

    Preferred over Whisper's native word_timestamps, which are cross-attention
    heuristics and drift on longer audio. Forced alignment is constrained to the
    script we actually synthesised.
    """

    def __init__(self, language: str = "en", device: str | None = None) -> None:
        import torch
        import whisperx

        self._wx = whisperx
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model, self.meta = whisperx.load_align_model(
            language_code=language, device=self.device
        )

    def align(self, audio_path: Path, text: str, duration: float) -> list[TimedWord]:
        clean = strip_tags(text)
        if not clean:
            return []
        audio = self._wx.load_audio(str(audio_path))
        segments = [{"text": clean, "start": 0.0, "end": duration}]
        try:
            result = self._wx.align(
                segments, self.model, self.meta, audio, self.device,
                return_char_alignments=False,
            )
        except Exception as e:  # alignment is best-effort; captions degrade, video still ships
            warnings.warn(f"alignment failed for {audio_path.name}: {e}", stacklevel=2)
            return _even_split(clean, duration)
        words = []
        for w in result.get("word_segments", []):
            if w.get("start") is None or w.get("end") is None:
                continue
            words.append(TimedWord(word=w["word"], start=float(w["start"]), end=float(w["end"])))
        return words or _even_split(clean, duration)


def _even_split(text: str, duration: float) -> list[TimedWord]:
    toks = text.split()
    if not toks:
        return []
    step = duration / len(toks)
    return [
        TimedWord(word=t, start=i * step, end=(i + 1) * step) for i, t in enumerate(toks)
    ]


class NullAligner:
    """No ASR dependency. Captions land on an even split — fine for static
    per-beat captions, wrong for karaoke highlighting."""

    def align(self, audio_path: Path, text: str, duration: float) -> list[TimedWord]:
        return _even_split(strip_tags(text), duration)


# --- driver ------------------------------------------------------------------


def _cache_key(text: str, voice: str, backend: TTSBackend) -> str:
    sig = json.dumps(
        {
            "text": text,
            "voice": voice,
            "backend": type(backend).__name__,
            "model": getattr(backend, "model", ""),
            "fmt": getattr(backend, "fmt", ""),
            "sr": getattr(backend, "sample_rate", ""),
        },
        sort_keys=True,
    )
    return hashlib.sha256(sig.encode()).hexdigest()[:16]


def voice_scene(
    scene: SceneIR,
    public_dir: Path,
    cache_dir: Path,
    backend: TTSBackend | None = None,
    aligner: Aligner | NullAligner | None = None,
    gap_s: float = BEAT_GAP_S,
) -> TimedScene:
    """Synthesise every beat, measure it, align it, and lay out the timeline."""
    backend = backend or XaiTTS()
    aligner = aligner or NullAligner()
    cache_dir.mkdir(parents=True, exist_ok=True)
    audio_dir = public_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    timed: list[TimedBeat] = []
    cursor = 0.0
    for beat in scene.beats:
        key = _cache_key(beat.vo, scene.voice, backend)
        cached = cache_dir / f"{key}.wav"
        if not cached.exists():
            backend.synth(beat.vo, scene.voice, cached)
        dur = probe_duration(cached)

        dest = audio_dir / f"{beat.id}-{key}.wav"
        if not dest.exists():
            shutil.copy2(cached, dest)

        words = aligner.align(cached, beat.vo, dur)
        timed.append(
            TimedBeat(
                id=beat.id,
                vo=beat.vo,
                visual=beat.visual,
                audio=f"audio/{dest.name}",
                dur_s=dur,
                start_s=cursor,
                words=words,
                transition=beat.transition,
            )
        )
        cursor += dur + gap_s

    total_s = max(cursor - gap_s, 0.0)
    return TimedScene(
        aspect=scene.aspect,
        fps=FPS,
        total_frames=max(1, round(total_s * FPS)),
        beats=timed,
    )


def estimate_scene(
    scene: SceneIR,
    gap_s: float = BEAT_GAP_S,
    wps: float = 2.6,
) -> TimedScene:
    """Lay out the timeline without synthesising anything.

    Durations come from the authored estimate, refined by word count at `wps`
    words per second. Useful for iterating on pacing, visuals and the grounding
    gate before spending TTS calls — and for CI, which should never hit a
    vendor API.

    The result is NOT frame-accurate. Real audio routinely lands 10-20% away
    from any word-rate estimate, so never ship a render built from this; run
    voice_scene() once the beats are settled.
    """
    timed: list[TimedBeat] = []
    cursor = 0.0
    for beat in scene.beats:
        clean = strip_tags(beat.vo)
        spoken = len(clean.split()) / wps
        dur = max(MIN_BEAT_S, min(MAX_BEAT_S, (spoken + beat.est_dur_s) / 2))
        timed.append(
            TimedBeat(
                id=beat.id,
                vo=beat.vo,
                visual=beat.visual,
                audio="",  # nothing to mount; <Audio> is skipped when empty
                dur_s=dur,
                start_s=cursor,
                words=_even_split(clean, dur),
                transition=beat.transition,
            )
        )
        cursor += dur + gap_s

    total_s = max(cursor - gap_s, 0.0)
    return TimedScene(
        aspect=scene.aspect,
        fps=FPS,
        total_frames=max(1, round(total_s * FPS)),
        beats=timed,
    )
