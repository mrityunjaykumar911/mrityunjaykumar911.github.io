# deck2short

Generated HTML in, grounded vertical video out.

```
HTML ──extract──> facts + fragments ──author──> scene.json
                       │                            │
                       └────────ground (gate)───────┤
                                                    ▼
                                    voice ──> timed.json ──render──> mp4
```

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=... XAI_API_KEY=...
python -m deck2short.pipeline examples/report.html -o out/short.mp4 \
    --brief "lead with the churn number" --stills
```

## The one thing that makes this different

Everything in the voiceover resolves back to a node in the source HTML. A
script-first tool (HeyGen, Descript, anything that starts from prose) cannot do
this, because by the time it sees text the provenance is gone.

`ground.py` checks both directions:

- **forward** — each declared claim resolves to a fact, and the values agree
- **reverse** — every numeral spoken has a claim covering it

Forward-only is trivially gamed by declaring fewer claims. The reverse check is
what catches a fabricated number, and it is the gate that fails the build.

```
grounding: 4 claims, 2 issue(s)
  [uncovered] b3: spoken number '62 percent' has no claim
  [mismatch]  b5: says '4.1 million' (4.1) but arr-chart/series0/pt3 = 9.3 (currency)
```

## Structured source beats scraped DOM

Scraping a built page is the fallback. When a site is generated from structured
data, that data *is* the ground truth — read it directly:

```python
from deck2short.from_yaml import load, chart_from
ex = load("src/data/resume.yaml")
ex.charts["talentica"] = chart_from(ex, [
    ("Search relevancy", "experience.3.lead.1#1"),
    ("Deployment frequency", "experience.3.lead.2#1"),
], title="Measured improvements")
```

Refs are dotted YAML paths, so `source_ref: experience.0.lead.2#0` points at a
line a human can open and check. The `#n` suffix addresses an emphasised span
inside a bullet — in a document where the author already marked the
load-bearing figures with `**bold**`, that markup *is* the annotation, and no
heuristic has to guess which numbers matter.

Two failure modes the parser is built to avoid, both covered by tests: a date
(`2022-05`) becoming the figure 2022, and an identifier (`US11573860B1`)
becoming a number. Either would enter the fact table wearing a verified badge
and then be cited as truth.

`chart_from` assembles a chart out of facts that already exist rather than
taking a literal data block, so a chart cannot drift from its source.

## HTML that was not authored for this

Most pages have no hooks — an Astro or Next build with hashed class names and
nothing semantic to point at. `annotate.py` walks such a document and injects
the refs, then everything downstream runs unchanged:

```bash
python -c "from deck2short.annotate import annotate; \
  print(annotate(open('site.html').read()).manifest())"
```

It is deliberately conservative. A wrong `data-value` becomes a *verified* fact
that the gate will wave through, so anything ambiguous is left as text and
picked up as unverified instead. A node becomes a stat only when the number
essentially *is* its text: `4.6x` yes, `Q3 revenue` no. Two-column tables become
chart sidecars; wider tables are skipped rather than guessed at. Run it once,
commit the output, hand-correct. Bootstrap, not a permanent input.

## Contract with your HTML generator

One attribute, one optional tag. Nothing about video.

```html
<div data-ref="churn-rate" data-value="7.4" data-unit="percent">7.4%</div>

<section data-ref="arr-chart">
  <svg>...</svg>
  <script type="application/json" data-facts="arr-chart">
    {"title":"Net new ARR","categories":["Q1","Q2","Q3"],
     "series":[{"values":[16.8,15.1,9.3],"unit":"currency"}]}
  </script>
</section>
```

The sidecar JSON is the only reliable source of chart numbers — never parse them
back out of rendered SVG geometry. If the generator already builds charts from a
spec (Vega-Lite, Chart.js config), emit that spec verbatim and you are done.

Facts recovered by text parsing are marked `[unverified]` and rejected by the
gate unless you pass `--allow-unverified`. Inline your stylesheets; an external
`<link>` makes the render depend on the network and therefore irreproducible.

Ref grammar: `hero-title`, `drivers/p2`, `arr-chart/series0/pt3`.

## Why each stage is built the way it is

**Authoring re-writes rather than transcodes.** A document is one idea per
section with long dwell. Short-form is one idea per video, a cut every 1.5–3
seconds, a hook in the first second, roughly 5× lower text density. Rendering the
document's own structure produces a narrated document, which is exactly the thing
nobody watches. Output is forced through the `SceneIR` JSON schema via tool use
and validated with pydantic; a validation failure is fed back once as a repair
turn.

**Per-beat TTS, not per-video.** Beat duration comes from `ffprobe` on the
returned audio, so the timeline never depends on the model's guess or on ASR.
Forced alignment is needed only for word-level caption highlighting.

**Audio is cached by hash of (text, voice, model, format).** TTS is not
guaranteed deterministic; an 80 ms drift on one beat shifts everything
downstream. The cache is what makes a re-render reproducible.

**WhisperX, not raw Whisper.** You already know the script, so you want forced
alignment against known text, not open-vocabulary ASR that can hallucinate a word
you never spoke. Whisper's native `word_timestamps` are cross-attention
heuristics and drift on longer audio. Alignment failure degrades to an even split
rather than failing the render. `--align` is opt-in; without it you get static
per-beat captions and no torch dependency.

**Delivery tags are stripped before alignment.** `[pause]` and `<whisper>`
produce audio with no matching script token. Two versions of each beat's text:
tagged for synthesis, clean for alignment.

**Remotion, not a screencast.** Remotion renders by frame index, so output is
deterministic. Playwright `--save-video` and other realtime captures drop frames
under load — that is why cheap HTML-to-video pipelines look janky regardless of
how good the HTML is.

**Fragments render in a shadow root** with the page's own CSS, so lifted HTML
looks exactly as it does in the browser and cannot collide with the composition's
styles. `@font-face` is hoisted to the document, because Chrome ignores it inside
a shadow root. Animation is driven on the host element only, outside the shadow
boundary.

**16:9 → 9:16 is a re-layout, not a scale.** `fit: "crop_focus"` fills the width
and pans so `focus_ref` lands on the centre line, measured from the real laid-out
DOM. This is the concrete advantage of an HTML source over a slide source: same
DOM, different container.

## Design

Ground is a cool light grey, not the dark-with-neon-accent look short-form
defaults to. On a feed of dark clips a light panel reads as a different kind of
object — an instrument readout rather than an ad — which is the association we
want for numbers that came from a real document. Boldness is spent in exactly one
place, the numeral. Active caption words darken and thicken rather than changing
colour; a colour pop on every word fights the single accent the frame is allowed
to spend on data. Tokens live in `remotion/src/tokens.ts`.

## Iterating without TTS

`estimate_scene()` lays out the timeline from word count alone — no vendor call,
no audio. Use it to settle pacing, visuals and the gate before spending
anything, and in CI, which should never hit an API. It is not frame-accurate;
real audio routinely lands 10-20% off any word-rate estimate, so never ship a
render built from it.

`preview.py` writes a static contact sheet of every beat from the same
`props.json` the renderer consumes, using the same tokens and the same
shadow-root fragment mechanism — so it genuinely checks layout, safe areas and
legibility rather than mocking them up. It does not check motion, timing feel or
audio sync.

```bash
python -m deck2short.preview .d2s/props.json -o out/storyboard.html
```

## Verifying transitions (Playwright)

Reading the code proves nothing about whether two frames are genuinely both on
screen during a cut — that is a property of the laid-out DOM at an instant. The
player exposes a test surface for exactly this:

```js
await window.__d2s.seek(4.2);   // render one exact frame, no wall clock
window.__d2s.probe();           // layer opacity/transform, rects, caption, images
```

```bash
npx playwright install chromium   # needs a machine with browser access
npm run test:e2e
```

Every assertion in `tests/e2e/transitions.spec.ts` maps to a bug that actually
shipped here and had to be caught by eye:

| test | the bug it would have caught |
|---|---|
| captions never overlap content | caption band laid over centred stats |
| every cut is a genuine overlap | "transitions" were a 90 ms fade on one layer |
| outgoing frame keeps moving | a dissolve between two frozen stills |
| no frame is ever static | content landed, then nothing moved for 2 s |
| image beats render real pixels | a placeholder card shipped for three revisions |
| captions stay legible | 55%-contrast grey-on-grey captions |
| nothing enters the UI zone | content under the platform chrome |

Seeks are deterministic, so screenshots are stable and `--update-snapshots`
gives real visual regression per beat.

**This cannot run in Claude's sandbox.** Playwright's browser CDN is off the
network allowlist, Ubuntu's `chromium-browser` package is a snap shim with no
binary, and snapd cannot be fetched. Same root cause as Remotion not rendering
here. Run it locally, or through Claude Code, which executes on your machine.

## Evaluation

No watch-through signal exists in-tenant, so there are two offline gates:

1. **Grounding** (`ground.py`) — mechanical, cheap, pass/fail, already wired into
   the pipeline.
2. **A VLM judge** on `--stills` output: hook clarity, legibility at 9:16, cut
   density, safe-area violations. One still per beat is far cheaper to score than
   a video. Not included — the scoring rubric is yours to write.

## Swapping vendors

`TTSBackend` is a two-method protocol. `XaiTTS` uses the OpenAI-compatible
`audio.speech` shape against `https://api.x.ai/v1` with voices eve, ara, rex,
sal, leo. Verify the exact field names against docs.x.ai before a production
run — that request body is the one vendor-specific surface in the codebase, which
is why it is isolated behind the protocol. `ElevenTTS` is included as a
same-protocol alternative.

## Layout

```
deck2short/
  ir.py          Scene IR — the contract every stage reads and writes
  annotate.py    inject data-ref into HTML that was not authored for this
  extract.py     HTML -> facts, chart data, fragments, CSS split
  preview.py     static storyboard from props.json, no Remotion needed
  author.py      facts -> SceneIR, tool-use constrained, one repair retry
  ground.py      the gate
  voice.py       TTS backends, ffprobe, WhisperX alignment, hash cache
  render.py      props assembly, Remotion invocation, loudnorm pass
  pipeline.py    CLI
remotion/
  src/Short.tsx      sequences beats, mounts audio and captions
  src/Fragment.tsx   shadow-root HTML lifting with measured fit
  src/visuals.tsx    stat, chart reveal, title card, contrast
  src/Captions.tsx   word-level captions from alignment timings
  src/tokens.ts      design tokens
tests/test_ground.py
examples/report.html
```

## Known gaps

- `stagger_children` reveal currently fades the whole fragment; per-child stagger
  needs a walk of the shadow tree.
- `mode: "line"` on `chart_reveal` falls through to bars.
- Multi-series charts extract only `series[0]`.
- No B-roll, no avatars, no music. Licensed TTS voice only — this deletes the
  rights problem rather than managing it.
