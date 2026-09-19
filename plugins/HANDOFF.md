# Handoff

State at the end of the chat session that produced this. Read `CLAUDE.md` first
for how to run it; this file is why it looks the way it does.

## Where it stands

Working: YAML fact extraction, the grounding gate, scene authoring (schema +
repair retry), the no-TTS timeline estimate, and the animated storyboard.
14 pytest tests pass. 8 Playwright tests are written but have never been
executed — see Open items.

Never run end to end: TTS, forced alignment, and the Remotion MP4 render. All
three need either a vendor key or a browser binary, neither available in the
sandbox where this was built.

Current cut: 7 beats, 26.2 s, grounded in `resume.yaml`.

## Decisions worth not relitigating

**Grounded, not viral.** The opening brief was viral short-form. The gate makes
"every number traces to a source line" enforceable, which is something a
script-first tool (HeyGen, Descript, anything starting from prose) structurally
cannot do — by the time it sees text, provenance is gone. That is the defensible
property. Chasing virality means discarding it.

**Structured source over scraped DOM.** The first three revisions scraped a
hand-rebuilt HTML reconstruction. That was wrong: the site is generated from
`resume.yaml`, so the YAML is ground truth and everything else is a lossy
derivative. `annotate.py` + `extract.py` remain for arbitrary HTML, but for this
repo always use `from_yaml.py`.

**Per-beat TTS.** Beat duration comes from `ffprobe` on real audio. This is the
single decision that keeps the timeline honest; an estimate-driven timeline
drifts 10–20% and every downstream cut moves with it.

**Remotion over screencast.** Frame-indexed rendering is deterministic.
Playwright `--save-video` and other realtime captures drop frames under load,
which is why cheap HTML-to-video pipelines look janky regardless of the HTML.

**No avatars, no stock b-roll, no music.** Licensed TTS voice only. This deletes
the rights problem rather than managing it.

## Rejected, with reasons

- **Transcoding document structure into slides.** Produces a narrated document.
  Authoring re-writes; it does not convert.
- **Parsing chart values out of rendered SVG geometry.** Use the sidecar JSON or
  the YAML. Geometry parsing produces confident wrong numbers.
- **Loud transition grammar** (whip, flash, punch) and per-word caption pops.
  They work, but read as performance marketing. Replaced with long dissolves and
  phrase-level fades.
- **Claiming "12+ years."** It is in `profile.intro` as unmarked prose, so the
  parser will not file it as a fact, so it does not get spoken. Working around
  this would defeat the gate.

## Bugs found by eye that now have tests

Each of these shipped and was caught by a human looking at it. The Playwright
suite exists so that does not happen again.

| bug | test |
|---|---|
| caption band laid over centred content | captions never overlap content |
| "transitions" were a 90 ms fade on one layer | every cut is a genuine overlap |
| frames froze after content landed | no frame is ever static |
| portrait rendered a placeholder for 3 revisions | image beats render real pixels |
| grey-on-grey captions at ~55% contrast | captions stay legible |
| `Q3` in a label parsed as the number 3 | `test_ground.py` coverage rule |
| `2022-05` parsed as the figure 2022 | `test_yaml_source.py` |

## Open items

1. **Run the Playwright suite.** Written, never executed. Expect fixture churn
   on first run; `npm run test:e2e:update` to seed screenshots.
2. **Run a real TTS pass.** `XaiTTS` uses the OpenAI-compatible `audio.speech`
   shape against `api.x.ai`. Verify field names against docs.x.ai — it is the
   one vendor-specific surface, isolated behind the `TTSBackend` protocol.
3. **Render an actual MP4.** Never done. `remotion/src/visuals.tsx` has not been
   updated for the `hook` and `image` visual types, or for the current token set
   — the storyboard is ahead of it. Reconcile before rendering.
4. **Decide on the portrait treatment.** Currently `static`. `duotone` exists
   (SVG `feComponentTransfer`, not a CSS filter chain) but read as an effect
   against pure black.
5. **Transition reference unresolved.** An Instagram reel was cited as the
   target style; it could not be viewed. The candidate worth considering is a
   continuous-canvas camera move — all beats on one large canvas with a single
   virtual camera, so there are no cuts at all. That is a timeline-model
   rewrite, not an easing change.
6. **Length.** 26.2 s. Completion rate falls off past ~25 s; the strongest
   subset is probably the hook, 100M, 4.6x, and the close.

## If you change `resume.yaml`

The chart refs in `build_site.py` (`CHARTS`) are positional —
`experience.3.lead.1#1` means the second emphasised figure in the second lead
bullet of the fourth role. Reordering roles or bullets silently repoints them.
`chart_from` raises on a missing ref, and `build_site.py` exits with a message
pointing here, but a ref that still resolves to a *different* number will not be
caught. Re-read the gate output after any YAML edit.
