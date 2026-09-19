"""Storyboard player: the beats, animated, from props.json.

A static contact sheet is the wrong instrument for judging short-form. Cut
rhythm, caption pop, count-up and the continuous push are the whole design, and
none of them survive a still. This writes one self-contained HTML file that
plays the timeline at real speed, so pacing can be judged before Remotion and
before a single TTS call.

    python -m deck2short.preview .d2s/props.json -o out/storyboard.html

Still not checked here: audio sync, and the exact easing Remotion's spring()
produces. Close enough to catch every layout and pacing problem.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

# Mirrors remotion/src/tokens.ts.
TOK = {
    "ground": "#000000",
    "raised": "#1D1D1F",
    "type": "#F5F5F7",
    "mute": "#86868B",
    "signal": "#30D158",
    "hot": "#FF453A",
    "side": 110,
    "top": 210,
    "bottom": 400,
}

CSS = """
:root{color-scheme:dark;--bg:#0E0F11;--fg:#EDEFED;--muted:#797F7B;--line:#23262A}
:root[data-theme=light]{--bg:#EDEFED;--fg:#14181D;--muted:#6B7480;--line:#D5D9DD}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
 font-family:"Inter Tight",system-ui,-apple-system,"Segoe UI",sans-serif;
 padding:18px 14px 40px;display:flex;flex-direction:column;align-items:center;gap:14px}
header{width:100%;max-width:440px}
h1{font-size:17px;letter-spacing:-.01em;margin:0 0 3px}
.sub{color:var(--muted);font-size:12.5px;line-height:1.45}
.frame{width:100%;max-width:440px;aspect-ratio:9/16;position:relative;overflow:hidden;
 border-radius:10px;background:__GROUND__;container-type:size;
 box-shadow:0 10px 40px rgba(0,0,0,.45)}
.layer{position:absolute;inset:0;overflow:hidden}

/* Three bands, no overlap. Content 12-92cqw from the top, captions 98-124cqw,
   and the bottom ~30% left clear for the platform's own UI and the thumb. The
   first version centred content vertically AND put captions at 58% height,
   which put the caption band straight through the middle of every stat. */
/* Content occupies the upper two thirds and is centred; captions own a band
   below it; the bottom quarter stays empty. Generous margins throughout —
   crowding is the fastest way to look cheap. */
.pad{position:absolute;top:__TOP__cqw;left:__SIDE__cqw;right:__SIDE__cqw;bottom:78cqw;
 display:flex;flex-direction:column;justify-content:center;align-items:center;
 text-align:center}
.hero{font-size:27cqw;font-weight:660;letter-spacing:-.04em;line-height:.92;
 font-variant-numeric:tabular-nums;color:__SIGNAL__;white-space:nowrap;margin-left:-.055em}
.hero.tight{font-size:20cqw}
.statlabel{font-size:4cqw;color:__MUTE__;margin-top:4.2cqw;max-width:20ch;line-height:1.3;
 font-weight:440;letter-spacing:-.005em}
.kicker{display:none}
.charttitle{font-size:3cqw;color:__MUTE__;margin-bottom:4cqw;font-weight:560}
.row{display:flex;align-items:center;margin-bottom:3.4cqw;gap:2.4cqw;width:100%}
.cat{font-size:3cqw;width:22cqw;flex:0 0 auto;font-weight:440;text-align:left}
.bar{height:1.1cqw;border-radius:99px;flex:0 0 auto}
.bar.hot{height:1.1cqw}
.val{font-weight:620;font-variant-numeric:tabular-nums;font-size:4.2cqw;letter-spacing:-.03em}
.val.hot{font-size:5.4cqw}
.charttitle{font-size:3cqw;color:__MUTE__;margin-bottom:6cqw;font-weight:440}
.headline{font-size:8.6cqw;font-weight:640;line-height:1.1;letter-spacing:-.032em;color:__TYPE__}
.headline em{font-style:normal;color:__SIGNAL__}
.csplit{gap:9cqw}
.cfig{font-size:12cqw;font-weight:640;letter-spacing:-.04em;line-height:1}
.clabel{font-size:3cqw;color:__MUTE__;margin-top:1.6cqw;font-weight:440;letter-spacing:0}
/* Phrase-level, not word-level. A per-word colour pop is the loudest possible
   caption treatment; here the line simply fades as a unit and stays quiet. */
.caps{position:absolute;left:__SIDE__cqw;right:__SIDE__cqw;top:112cqw;height:22cqw;
 align-content:start;display:flex;flex-wrap:wrap;gap:.4cqw 1.2cqw;
 justify-content:center;font-size:4.4cqw;line-height:1.34;text-align:center;
 font-weight:440;letter-spacing:-.01em;color:__MUTE__}
.caps span{display:inline-block}
.caps span.on{color:__TYPE__}
.fragwrap{position:absolute;top:__TOP__cqw;left:__SIDE__cqw;right:__SIDE__cqw;bottom:78cqw;overflow:hidden;
 display:flex;align-items:center;justify-content:center}
.fraghost{transform-origin:center center;filter:invert(1) hue-rotate(180deg) contrast(.92)}
.tension{font-size:8.8cqw;font-weight:620;line-height:1.14;letter-spacing:-.032em;
 color:__MUTE__}
.payoff{font-size:8.8cqw;font-weight:660;line-height:1.14;letter-spacing:-.032em;
 color:__TYPE__;margin-top:1.4cqw}
.imgwrap{position:absolute;top:__TOP__cqw;left:__SIDE__cqw;right:__SIDE__cqw;bottom:78cqw;
 overflow:hidden;border-radius:2.2cqw}
.imgwrap img{width:100%;height:100%;object-fit:cover;display:block;
 transform-origin:56% 40%}
.imgcap{position:absolute;left:0;right:0;bottom:0;padding:5cqw 4cqw 4cqw;font-size:3cqw;
 color:__TYPE__;background:linear-gradient(transparent,rgba(0,0,0,.72));font-weight:440;
 text-align:center}
.progress{position:absolute;left:0;top:0;height:3px;background:__SIGNAL__;z-index:5}
.bar-strip{width:100%;max-width:440px;display:flex;gap:4px}
.chip{flex:1 1 0;height:26px;border:1px solid var(--line);border-radius:4px;background:transparent;
 color:var(--muted);font:600 10px/24px inherit;cursor:pointer;padding:0}
.chip.active{border-color:__SIGNAL__;color:__SIGNAL__}
.controls{width:100%;max-width:440px;display:flex;align-items:center;gap:10px;
 color:var(--muted);font-size:12.5px}
button.pp{background:__TYPE__;color:#000;border:0;border-radius:6px;padding:7px 15px;
 font:700 13px inherit;cursor:pointer}
.vo{width:100%;max-width:440px;font-size:13px;line-height:1.5;color:var(--fg);min-height:3.2em}
.vo b{color:var(--muted);font-weight:600;font-size:11px;letter-spacing:.08em;
 text-transform:uppercase;display:block;margin-bottom:3px}
"""


def build(props: dict) -> str:
    beats = props.get("beats", [])
    payload = json.dumps(
        {
            "beats": beats,
            "images": props.get("images", {}),
            "charts": props.get("charts", {}),
            "fragments": props.get("fragments", {}),
            "css": props.get("frag_css", ""),
            "tok": TOK,
        }
    )
    total = sum(b["dur_s"] for b in beats)
    css = (
        CSS.replace("__GROUND__", TOK["ground"])
        .replace("__SIGNAL__", TOK["signal"])
        .replace("__TYPE__", TOK["type"])
        .replace("__MUTE__", TOK["mute"])
        .replace("__SIDE__", f"{TOK['side']/10.8:.2f}")
        .replace("__BOTTOM__", f"{TOK['bottom']/10.8:.2f}")
        .replace("__TOP__", f"{TOK['top']/10.8:.2f}")
    )
    chips = "".join(
        f'<button class="chip" data-i="{i}">{b["id"]}</button>' for i, b in enumerate(beats)
    )

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Storyboard</title>
<style>{props.get('font_css','')}{css}</style></head><body>

<header>
<h1>Storyboard</h1>
<div class="sub">{len(beats)} beats &middot; {total:.1f}s &middot; 1080&times;1920 &middot; no audio.
Judging cut rhythm and caption legibility, not final easing.</div>
</header>

<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="d2s-duo" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="
      .2126 .7152 .0722 0 0
      .2126 .7152 .0722 0 0
      .2126 .7152 .0722 0 0
      0 0 0 1 0"/>
    <feComponentTransfer>
      <feFuncR type="table" tableValues="0.016 0.941"/>
      <feFuncG type="table" tableValues="0.078 0.973"/>
      <feFuncB type="table" tableValues="0.051 0.949"/>
    </feComponentTransfer>
  </filter>
</defs></svg>

<div class="frame" id="frame">
  <div class="progress" id="prog"></div>
  <div class="layer" id="layerA"></div>
  <div class="layer" id="layerB"></div>
  <div class="caps" id="caps"></div>
</div>

<div class="bar-strip">{chips}</div>
<div class="controls">
  <button class="pp" id="pp">Pause</button>
  <span id="clock">0.0s</span>
  <span style="margin-left:auto" id="kind"></span>
</div>
<div class="vo" id="vo"></div>

<script>
const D = {payload};
const BEATS = D.beats, TOK = D.tok;
const LAYERS = [document.getElementById('layerA'), document.getElementById('layerB')];
const caps = document.getElementById('caps');
const TRANS = 0.95;   // seconds of genuine overlap between beats
const prog = document.getElementById('prog'), clock = document.getElementById('clock');
const kindEl = document.getElementById('kind'), voEl = document.getElementById('vo');
const chips = [...document.querySelectorAll('.chip')];
const TOTAL = BEATS.reduce((a, b) => a + b.dur_s, 0);

// --- easing ----------------------------------------------------------------
// Approximates Remotion's spring(): fast rise with a small overshoot, which is
// what makes an entrance read as deliberate rather than as a CSS transition.
// One curve for everything: cubic-bezier(0.32, 0.72, 0, 1). A long, heavy
// decelerate with no overshoot. Using a single ease across content entry,
// transitions and the drift is what makes the piece read as one object rather
// than a sequence of separate effects.
function bezier(p1x, p1y, p2x, p2y) {{
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {{
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {{
      const e = fx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-5 || d === 0) break;
      t -= e / d;
    }}
    return ((ay * t + by) * t + cy) * t;
  }};
}}
const EASE = bezier(0.32, 0.72, 0, 1);
const spring = x => EASE(clamp01(x));
const easeOut = x => EASE(clamp01(x));
const clamp01 = x => Math.max(0, Math.min(1, x));

// --- visual builders --------------------------------------------------------
const splitNum = s => {{
  const m = String(s).match(/^([^\\d\\-]*)(-?[\\d.,]+)(.*)$/);
  return m ? {{pre: m[1], num: parseFloat(m[2].replace(/,/g,'')), post: m[3]}}
           : {{pre: '', num: null, post: String(s)}};
}};

function buildStat(v) {{
  const parts = splitNum(v.display);
  const tight = String(v.display).length > 4;
  return `<div class="pad">
    <div class="kicker">${{v.trend === 'down' ? 'Down' : 'Scale'}}</div>
    <div class="hero ${{tight ? 'tight' : ''}}" data-count="${{parts.num ?? ''}}"
         data-pre="${{parts.pre}}" data-post="${{parts.post}}"
         style="color:${{v.trend === 'down' ? TOK.hot : TOK.signal}}">${{v.display}}</div>
    <div class="statlabel">${{v.label}}</div></div>`;
}}

function buildChart(v) {{
  const d = D.charts[v.src]; if (!d) return '<div class="pad"></div>';
  const mx = Math.max(...d.values.map(Math.abs), 1);
  const rows = d.values.map((val, i) => {{
    const hot = (v.highlight || []).includes(i);
    return `<div class="row" data-i="${{i}}">
      <div class="cat" style="color:${{hot ? TOK.type : TOK.mute}}">${{d.categories[i] ?? ''}}</div>
      <div class="bar ${{hot ? 'hot' : ''}}" data-w="${{Math.abs(val)/mx*58}}"
           style="width:0;background:${{hot ? TOK.signal : TOK.raised}}"></div>
      <div class="val ${{hot ? 'hot' : ''}}" data-count="${{val}}" data-post=""
           style="color:${{hot ? TOK.signal : TOK.mute}}">0</div></div>`;
  }}).join('');
  return `<div class="pad" style="justify-content:center">
    ${{d.title ? `<div class="charttitle">${{d.title}}</div>` : ''}}${{rows}}</div>`;
}}

function buildTitle(v) {{
  const words = v.headline.split(' ');
  const lit = words.map((w,i) => i >= words.length - 3 ? `<em>${{w}}</em>` : w).join(' ');
  return `<div class="pad"><div class="headline">${{lit}}</div></div>`;
}}

function buildContrast(v) {{
  return `<div class="pad csplit">
    <div><div class="cfig" style="color:${{TOK.mute}}">${{v.left}}</div>
         <div class="clabel">${{v.left_label}}</div></div>
    <div><div class="cfig" style="color:${{TOK.signal}}">${{v.right}}</div>
         <div class="clabel">${{v.right_label}}</div></div></div>`;
}}

function buildFragment(v) {{
  return `<div class="fragwrap"><div class="fraghost"></div></div>`;
}}

function mountFragment(v, layer) {{
  const host = (layer || document).querySelector('.fraghost'); if (!host) return;
  const html = D.fragments[v.ref];
  if (!html) {{ host.textContent = 'missing: ' + v.ref; return; }}
  const root = host.attachShadow({{mode:'open'}});
  root.innerHTML = '<style>:host{{all:initial;display:block}}' + D.css + '</style>' + html;
  requestAnimationFrame(() => {{
    const target = root.lastElementChild; if (!target) return;
    const r = target.getBoundingClientRect();
    const avail = host.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const scale = v.fit === 'crop_focus'
      ? avail.width / r.width
      : Math.min(avail.width / r.width, avail.height / r.height);
    let dy = 0;
    if (v.fit === 'crop_focus' && v.focus_ref) {{
      const f = root.querySelector('[data-ref="' + v.focus_ref + '"]');
      if (f) {{ const fb = f.getBoundingClientRect();
        dy = avail.height/2 - (fb.top - r.top + fb.height/2) * scale; }}
    }}
    host.dataset.base = `translateY(${{dy}}px) scale(${{scale}})`;
  }});
}}

function buildHook(v) {{
  return `<div class="pad">
    <div class="tension">${{v.tension}}</div>
    <div class="payoff">${{v.payoff}}</div></div>`;
}}

function buildImage(v) {{
  const uri = (D.images || {{}})[v.src] || '';
  const cap = v.caption ? `<div class="imgcap">${{v.caption}}</div>` : '';
  return `<div class="imgwrap"><img src="${{uri}}" alt="">${{cap}}</div>`;
}}

const BUILD = {{hook: buildHook, image: buildImage, stat: buildStat, chart_reveal: buildChart, title_card: buildTitle,
                contrast: buildContrast, html_fragment: buildFragment}};

// --- playback ---------------------------------------------------------------
let cur = -1, front = 0, prevIdx = -1, t0 = performance.now(), playing = true, pausedAt = 0;
// When a test drives the clock, the rAF loop stops advancing time on its own.
// Wall-clock playback and screenshot assertions cannot share a timebase.
let testTime = null;

function mount(i) {{
  front = 1 - front;
  const layer = LAYERS[front], v = BEATS[i].visual;
  layer.innerHTML = (BUILD[v.type] || (() => '<div class="pad"></div>'))(v);
  if (v.type === 'html_fragment') mountFragment(v, layer);
  layer.style.zIndex = '2';
  LAYERS[1 - front].style.zIndex = '1';
  prevIdx = cur; cur = i;
  chips.forEach((c,j) => c.classList.toggle('active', j === i));
  kindEl.textContent = v.type + '  ·  ' + (BEATS[i].transition || 'push_up');
  voEl.innerHTML = '<b>' + BEATS[i].id + ' voiceover</b>' + BEATS[i].vo;
}}

/** Entry and exit pairs. A cut where nothing moves across the boundary reads as
 *  a slideshow; the outgoing frame has to acknowledge the incoming one. */
/**
 * Long overlapping dissolves. Every pair is built so the two frames are both
 * partly visible for most of a second — the outgoing one keeps drifting rather
 * than freezing and vanishing, which is what separates a dissolve from a
 * crossfade between two stills.
 *
 * Opacity is eased separately and more slowly than motion, so the incoming
 * frame is already moving before it is readable.
 */
function transform(kind, k, outgoing) {{
  const m = EASE(k);                       // motion progress
  const f = EASE(Math.min(1, k * 1.25));   // opacity progress, slightly ahead
  const e = outgoing ? m : 1 - m;          // 0 = settled, 1 = fully displaced
  const eo = outgoing ? f : 1 - f;
  switch (kind) {{
    case 'scale_through':
      // Outgoing continues toward the viewer; incoming rises from behind it.
      return {{t: `scale(${{outgoing ? 1 + e * .10 : 1 - e * .07}})`, f: 'none', o: 1 - eo}};
    case 'lift':
      return {{t: `translateY(${{(outgoing ? -1 : 1) * e * 7}}%) scale(${{1 - e * .015}})`,
              f: 'none', o: 1 - eo}};
    case 'linger':
      // Pure dissolve, no movement of its own; the per-beat drift carries it.
      return {{t: 'none', f: 'none', o: 1 - eo}};
    case 'cut':
      return {{t: 'none', f: 'none', o: outgoing ? 0 : 1}};
    default: // dissolve
      return {{t: `scale(${{outgoing ? 1 + e * .035 : 1 - e * .03}})`, f: 'none', o: 1 - eo}};
  }}
}}

function applyTrans(layer, kind, k, outgoing) {{
  const s = transform(kind, k, outgoing);
  layer.style.transform = s.t;
  layer.style.filter = s.f;
  layer.style.opacity = String(Math.max(0, s.o));
  layer.style.clipPath = s.c || 'none';
}}

/** Per-beat content animation, applied to whichever layer holds that beat. */
function animate(layer, b, local) {{
  const p = clamp01(local / b.dur_s), s = spring(local / 1.15);
  const v = b.visual;

  const hero = layer.querySelector('.hero');
  if (hero) {{
    hero.style.transform = `translateY(${{(1 - s) * 34}}px)`;
    hero.style.opacity = String(s);
    const n = parseFloat(hero.dataset.count);
    if (!isNaN(n)) {{
      const shown = n * easeOut(local / 1.35);
      const dec = Math.abs(n) < 100 && !Number.isInteger(n) ? 1 : 0;
      hero.textContent = hero.dataset.pre +
        (Math.abs(n) >= 1e6 ? (shown / 1e6).toFixed(0) : shown.toFixed(dec)) + hero.dataset.post;
    }}
  }}
  const tension = layer.querySelector('.tension'), payoff = layer.querySelector('.payoff');
  if (tension) {{
    const a = spring(local / 1.1);
    tension.style.opacity = String(a);
    tension.style.transform = `translateY(${{(1 - a) * 22}}px)`;
    const c = spring((local - 1.25) / 1.1);
    payoff.style.opacity = String(c);
    payoff.style.transform = `translateY(${{(1 - c) * 22}}px)`;
  }}
  // Ken Burns: a still photo in a moving edit is a dead frame. Slow push plus a
  // little drift, always in progress, never arriving.
  const img = layer.querySelector('.imgwrap img');
  if (img) {{
    const k = p;
    img.style.transform = `scale(${{1.04 + k * 0.055}}) translate(${{-k * 0.7}}%, ${{-k * 0.5}}%)`;
    img.style.filter = v.treatment === 'duotone'
      ? 'url(#d2s-duo) contrast(1.06)' : 'none';
  }}
  layer.querySelectorAll('.statlabel,.clabel,.kicker,.charttitle,.imgcap').forEach((el, i) => {{
    const q = spring((local - 0.45 - i * 0.14) / 1.1);
    el.style.opacity = String(clamp01(q));
    el.style.transform = `translateY(${{(1 - q) * 16}}px)`;
  }});
  layer.querySelectorAll('.cfig').forEach((el, i) => {{
    const q = spring((local - i * 0.55) / 1.2);
    el.style.opacity = String(clamp01(q));
    el.style.transform = `translateY(${{(1 - q) * 40}}px)`;
  }});
  layer.querySelectorAll('.row').forEach((row, i) => {{
    const q = easeOut((local - 0.3 - i * 0.22) / 1.35);
    const bar = row.querySelector('.bar'), val = row.querySelector('.val');
    bar.style.width = (parseFloat(bar.dataset.w) * q) + 'cqw';
    val.textContent = (parseFloat(val.dataset.count) * q).toFixed(0);
    row.style.opacity = String(clamp01((local - 0.3 - i * 0.22) / 0.6));
  }});
  const head = layer.querySelector('.headline');
  if (head) head.style.clipPath = `inset(${{(1 - s) * 100}}% 0 0 0)`;
  const frag = layer.querySelector('.fraghost');
  if (frag && frag.dataset.base) {{
    frag.style.transform = frag.dataset.base;
    frag.parentElement.style.clipPath = `inset(${{(1 - s) * 100}}% 0 0 0)`;
  }}
  // Continuous push on the content itself, so the frame keeps moving after
  // everything has landed.
  const pad = layer.querySelector('.pad, .imgwrap, .fragwrap');
  if (pad) pad.style.scale = String(1 + 0.028 * EASE(p));
}}

function renderAt(t) {{
  let acc = 0, idx = 0, local = 0;
  for (let i = 0; i < BEATS.length; i++) {{
    if (t < acc + BEATS[i].dur_s) {{ idx = i; local = t - acc; break; }}
    acc += BEATS[i].dur_s; idx = i; local = BEATS[i].dur_s;
  }}
  if (idx !== cur) mount(idx);

  const b = BEATS[idx];
  const k = clamp01(local / TRANS);          // 0 at the cut, 1 once settled
  const kind = b.transition || 'push_up';

  animate(LAYERS[front], b, local);
  applyTrans(LAYERS[front], kind, k, false);

  // The outgoing beat stays on screen and keeps moving through the overlap.
  const back = LAYERS[1 - front];
  if (prevIdx >= 0 && k < 1) {{
    const pb = BEATS[prevIdx];
    animate(back, pb, pb.dur_s);
    applyTrans(back, kind, k, true);
    back.style.visibility = 'visible';
  }} else {{
    back.style.visibility = 'hidden';
  }}

  // Phrases, not words. Each line fades in as a unit, holds, and fades out —
  // nothing pops, nothing changes colour mid-line.
  const words = b.words || [], chunk = 5, lines = [];
  for (let i = 0; i < words.length; i += chunk) lines.push(words.slice(i, i + chunk));
  const li = lines.findIndex(l => local >= l[0].start && local <= l[l.length - 1].end);
  const line = lines[li === -1 ? 0 : li] || [];
  caps.innerHTML = line.map(w => `<span class="on">${{w.word}}</span>`).join('');
  const lineStart = line.length ? line[0].start : 0;
  const lineEnd = line.length ? line[line.length - 1].end : b.dur_s;
  const fadeIn = EASE(clamp01((local - lineStart) / 0.45));
  const fadeOut = 1 - EASE(clamp01((local - lineEnd) / 0.4));
  caps.style.opacity = String(Math.min(fadeIn, fadeOut));

  prog.style.width = (t / TOTAL * 100) + '%';
  clock.textContent = t.toFixed(1) + 's / ' + TOTAL.toFixed(1) + 's';
  return {{idx, local, k, kind}};
}}

function frame(now) {{
  if (testTime === null) renderAt(((now - t0) / 1000) % TOTAL);
  requestAnimationFrame(frame);
}}

/**
 * Test surface.
 *
 * Transitions are the one part of this that cannot be verified by reading the
 * code: whether two layers are genuinely both on screen during a cut is an
 * observed property of the laid-out DOM at a given instant. seek() renders one
 * exact frame; probe() reports the geometry and compositing state that the
 * assertions care about, measured relative to the frame rather than the page.
 */
window.__d2s = {{
  total: TOTAL,
  beats: BEATS.map(b => ({{id: b.id, start: b.start_s, dur: b.dur_s,
                          kind: b.visual.type, transition: b.transition || 'dissolve'}})),
  transitionS: TRANS,
  async seek(t) {{
    testTime = t; playing = false;
    const r = renderAt(t);
    // Fragments measure themselves on the next frame; give them one.
    await new Promise(requestAnimationFrame);
    renderAt(t);
    return r;
  }},
  probe() {{
    const frameEl = document.getElementById('frame');
    const fr = frameEl.getBoundingClientRect();
    const rel = el => {{
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return {{x: (r.left - fr.left) / fr.width, y: (r.top - fr.top) / fr.height,
              w: r.width / fr.width, h: r.height / fr.height}};
    }};
    const layerState = el => {{
      const cs = getComputedStyle(el);
      return {{opacity: parseFloat(cs.opacity), transform: cs.transform,
              visible: cs.visibility !== 'hidden',
              content: rel(el.querySelector('.pad, .imgwrap, .fragwrap'))}};
    }};
    const capEl = document.getElementById('caps');
    const capCs = getComputedStyle(capEl);
    return {{
      beat: cur,
      frame: {{w: fr.width, h: fr.height}},
      layers: LAYERS.map(layerState),
      front,
      caption: {{
        rect: rel(capEl),
        opacity: parseFloat(capCs.opacity),
        fontSizePx: parseFloat(capCs.fontSize),
        color: capCs.color,
        text: capEl.textContent.trim(),
      }},
      images: [...document.querySelectorAll('.imgwrap img')].map(im => ({{
        complete: im.complete, naturalWidth: im.naturalWidth,
        isPlaceholder: (im.currentSrc || im.src).startsWith('data:image/svg+xml'),
      }})),
      ground: getComputedStyle(frameEl).backgroundColor,
    }};
  }},
}};

document.getElementById('pp').onclick = e => {{
  if (playing) {{ pausedAt = ((performance.now() - t0)/1000) % TOTAL; playing = false; e.target.textContent = 'Play'; }}
  else {{ t0 = performance.now() - pausedAt * 1000; playing = true; e.target.textContent = 'Pause'; }}
}};
chips.forEach(ch => ch.onclick = () => {{
  const i = +ch.dataset.i;
  let acc = 0; for (let j = 0; j < i; j++) acc += BEATS[j].dur_s;
  t0 = performance.now() - acc * 1000; pausedAt = acc; cur = -1;
}});
requestAnimationFrame(frame);
</script></body></html>"""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="deck2short.preview")
    ap.add_argument("props")
    ap.add_argument("-o", "--out", default="out/storyboard.html")
    args = ap.parse_args(argv)
    props = json.loads(Path(args.props).read_text(encoding="utf-8"))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(props), encoding="utf-8")
    print(f"storyboard: {out} ({out.stat().st_size/1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
