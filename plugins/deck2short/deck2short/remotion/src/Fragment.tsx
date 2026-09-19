import React, {useLayoutEffect, useRef, useState} from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {c, safe, spring_} from './tokens';

/**
 * Renders a subtree of the source document verbatim.
 *
 * The fragment goes into a shadow root with the page's own stylesheet, so it
 * looks exactly as it does in the browser and its CSS cannot collide with the
 * composition's. @font-face rules are hoisted to the document by the extractor,
 * because Chrome ignores them inside a shadow root.
 *
 * The generator needs to know nothing about video: animation is driven from
 * outside the shadow boundary, on the host element only.
 */

type Fit = 'contain' | 'crop_focus';
type Reveal = 'mask_up' | 'stagger_children' | 'fade_scale' | 'none';

export const Fragment: React.FC<{
  html: string;
  css: string;
  reveal: Reveal;
  fit: Fit;
  focusRef?: string | null;
}> = ({html, css, reveal, fit, focusRef}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const hostRef = useRef<HTMLDivElement>(null);
  const [handle] = useState(() => delayRender('mount fragment'));
  const [box, setBox] = useState<{scale: number; dx: number; dy: number} | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({mode: 'open'});
    root.innerHTML = `<style>
      :host { all: initial; display: block; }
      :host * { box-sizing: border-box; }
      ${css}
    </style>${html}`;

    // Measure after the shadow tree has laid out, then fit it to the frame.
    const inner = root.firstElementChild?.nextElementSibling as HTMLElement | null;
    const target = inner ?? (root.lastElementChild as HTMLElement | null);
    if (!target) {
      setBox({scale: 1, dx: 0, dy: 0});
      continueRender(handle);
      return;
    }

    const avail = {
      w: width - safe.side * 2,
      h: height - safe.top - safe.bottom,
    };
    const rect = target.getBoundingClientRect();
    const natural = {w: rect.width || avail.w, h: rect.height || avail.h};

    if (fit === 'contain') {
      const scale = Math.min(avail.w / natural.w, avail.h / natural.h, 1.6);
      setBox({scale, dx: 0, dy: 0});
    } else {
      // Fill the width, then pan so the focus element sits on the centre line.
      const scale = Math.min(avail.w / natural.w, 1.6);
      const focus = focusRef
        ? (root.querySelector(`[data-ref="${focusRef}"]`) as HTMLElement | null)
        : null;
      let dy = 0;
      if (focus) {
        const f = focus.getBoundingClientRect();
        const focusCentre = (f.top - rect.top + f.height / 2) * scale;
        dy = avail.h / 2 - focusCentre;
      }
      setBox({scale, dx: 0, dy});
    }
    continueRender(handle);
  }, [html, css, fit, focusRef, handle, width, height]);

  const p = spring({frame, fps, config: spring_});

  const revealStyle: React.CSSProperties =
    reveal === 'mask_up'
      ? {
          clipPath: `inset(${interpolate(p, [0, 1], [100, 0])}% 0 0 0)`,
          transform: `translateY(${interpolate(p, [0, 1], [28, 0])}px)`,
        }
      : reveal === 'fade_scale'
        ? {
            opacity: p,
            transform: `scale(${interpolate(p, [0, 1], [0.94, 1])})`,
          }
        : reveal === 'stagger_children'
          ? {opacity: p}
          : {};

  return (
    <AbsoluteFill style={{background: c.paper, justifyContent: 'center', alignItems: 'center'}}>
      <div
        style={{
          width: width - safe.side * 2,
          height: height - safe.top - safe.bottom,
          marginTop: safe.top - safe.bottom,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          ...revealStyle,
        }}
      >
        <div
          style={{
            transform: box
              ? `translate(${box.dx}px, ${box.dy}px) scale(${box.scale})`
              : 'scale(1)',
            transformOrigin: 'center center',
            visibility: box ? 'visible' : 'hidden',
          }}
        >
          <div ref={hostRef} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
