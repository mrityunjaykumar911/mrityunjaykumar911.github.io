"""deck2short — turn generated HTML into grounded short-form video."""

from .extract import Extraction, Fact, extract
from .ground import Report, check, enforce
from .ir import Beat, Claim, SceneIR, TimedScene
from .voice import NullAligner, XaiTTS, voice_scene

__all__ = [
    "extract", "Extraction", "Fact",
    "SceneIR", "Beat", "Claim", "TimedScene",
    "check", "enforce", "Report",
    "voice_scene", "XaiTTS", "NullAligner",
]
__version__ = "0.1.0"
