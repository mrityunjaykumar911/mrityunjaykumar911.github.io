import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {c, safe, t} from './tokens';
import {body} from './fonts';

type Word = {word: string; start: number; end: number};

/**
 * Word-level captions driven by forced-alignment timings.
 *
 * The active word darkens and thickens rather than changing colour. Colour pops
 * on every word are the default treatment in this format and they fight the one
 * accent the frame is allowed to spend on data.
 *
 * Words are chunked into short lines so the eye never tracks more than a
 * glance's worth at a time.
 */
export const Captions: React.FC<{words: Word[]; chunk?: number}> = ({words, chunk = 4}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const tNow = frame / fps;

  if (!words.length) return null;

  const lines: Word[][] = [];
  for (let i = 0; i < words.length; i += chunk) lines.push(words.slice(i, i + chunk));

  const active = lines.findIndex((l) => tNow >= l[0].start && tNow <= l[l.length - 1].end);
  const line = lines[active === -1 ? Math.max(0, lines.length - 1) : active];

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: safe.bottom - 170,
        paddingLeft: safe.side,
        paddingRight: safe.side,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0 16px',
          justifyContent: 'center',
          fontFamily: body,
          fontSize: t.caption,
          lineHeight: 1.18,
          textAlign: 'center',
        }}
      >
        {line.map((w, i) => {
          const on = tNow >= w.start && tNow <= w.end;
          return (
            <span
              key={i}
              style={{
                color: on ? c.ink : c.dim,
                fontWeight: on ? 650 : 480,
                transition: 'none',
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
