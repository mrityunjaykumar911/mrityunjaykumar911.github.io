# deck2short

Turns this site's own résumé data into a grounded vertical short-form video.
Lives inside the site repo; reads `../src/data/resume.yaml` as its source of truth.

## Run it

```bash
pip install -r requirements.txt
python build_site.py                 # extract -> ground -> storyboard, no TTS
start out/storyboard.html            # Windows; `open` on macOS
```

With voice and a real render (needs `XAI_API_KEY`, ffmpeg, node):

```bash
python -m deck2short.pipeline --yaml ../src/data/resume.yaml \
    --scene scene.json --assets ../public -o out/mk.mp4
```

## Tests

```bash
python -m pytest tests -q          # grounding + YAML parser, fast, no network
npx playwright install chromium
npm run test:e2e                   # transition/layout assertions on the storyboard
```

## The one invariant

**Every number spoken in the video must resolve to a line in `resume.yaml`.**

`ground.py` enforces this in both directions and fails the build:

- forward — each declared claim resolves to a fact and the values agree
- reverse — every numeral in the voiceover is covered by some claim

The reverse check is the one that matters. Forward-only is trivially passed by
declaring fewer claims; reverse is what catches a fabricated number.

If a figure is not in `resume.yaml`, it does not get spoken. Do not work around
this by hardcoding a value into `scene.json` — add it to the YAML, wrap it in
`**bold**` so it becomes an addressable fact, and cite the ref.

## Source refs

Dotted YAML paths. `#n` addresses the nth `**emphasised**` span inside a string,
because the author already marked which figures matter.

```
profile.signals.1.value     -> "100M+"
experience.0.lead.2#0       -> the 4.6x in that bullet
profile.avatar              -> the portrait
```

Two parser traps, both covered by tests in `tests/test_yaml_source.py`: a date
(`2022-05`) must never become the figure 2022, and an identifier
(`US11573860B1`) must never become a number. Either would enter the fact table
marked verified and then be cited as truth.

## Architecture

```
from_yaml.py   resume.yaml -> facts (preferred source)
annotate.py    inject data-ref into arbitrary HTML (fallback path)
extract.py     HTML -> facts, charts, fragments
ir.py          Scene IR — the contract every stage reads and writes
author.py      facts -> SceneIR via constrained tool use, one repair retry
ground.py      the gate
voice.py       TTS backends, ffprobe durations, WhisperX alignment, hash cache
render.py      props assembly, Remotion, loudnorm
preview.py     animated storyboard from props.json, no Remotion needed
remotion/      the actual frame renderer
```

`scene.json` is the human edit point. Edit it directly; it is not generated on
every run.

## House style

Black ground, one near-white, system green used almost nowhere. Display weight
640–680 with tight tracking — heavier reads as a sale. One easing curve
everywhere, `cubic-bezier(0.32, 0.72, 0, 1)`. Transitions overlap for 0.95 s and
the outgoing frame keeps moving through them. Captions are phrase-level fades,
never per-word pops. No grain, no vignette, no flash cuts.

Beats are 2.4 s minimum (schema-enforced) because short beats fight slow
transitions.

## Gotchas

- Per-beat TTS, never per-video: durations come from `ffprobe` on real audio, not
  from the model's estimate. Audio is cached by content hash so a re-render is
  reproducible.
- `estimate_scene()` (`--no-tts`) is for iterating on pacing only. Real audio
  lands 10–20% off any word-rate estimate; never ship a render built from it.
- Strip `[pause]` / `<whisper>` before alignment, keep them for synthesis.
- Remotion renders by frame index. Do not swap it for a screencast — realtime
  capture drops frames under load.
- Remote images are never fetched at render time. `inline_image` embeds local
  files as data URIs and searches the doc folder, `--assets`, and
  `/mnt/user-data/uploads` by basename.
