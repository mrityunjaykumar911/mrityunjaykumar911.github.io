import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {c, safe, spring_, t} from './tokens';
import {display, body} from './fonts';

/** One number, full bleed. The strongest beat type in short-form. */
export const Stat: React.FC<{display: string; label: string; trend?: string | null}> = ({
  display: value,
  label,
  trend,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({frame, fps, config: spring_});
  const tone = trend === 'down' ? c.warn : c.signal;

  return (
    <AbsoluteFill
      style={{
        background: c.paper,
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: `0 ${safe.side}px ${safe.bottom}px`,
      }}
    >
      <div
        style={{
          fontFamily: display,
          fontSize: t.hero,
          fontWeight: 800,
          letterSpacing: '-0.045em',
          lineHeight: 0.86,
          color: tone,
          fontVariantNumeric: 'tabular-nums',
          transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px)`,
          opacity: p,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: body,
          fontSize: t.label,
          color: c.ink,
          marginTop: 28,
          maxWidth: 820,
          lineHeight: 1.22,
          opacity: interpolate(p, [0.35, 1], [0, 1], {extrapolateLeft: 'clamp'}),
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};

/** Re-plot real values at vertical aspect. Horizontal bars, because category
 *  labels read far better on a narrow frame than rotated axis text. */
export const ChartReveal: React.FC<{
  categories: string[];
  values: number[];
  highlight: number[];
  title?: string | null;
}> = ({categories, values, highlight, title}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();
  const max = Math.max(...values.map(Math.abs), 1);
  const trackW = width - safe.side * 2 - 240;

  return (
    <AbsoluteFill
      style={{
        background: c.paper,
        padding: `${safe.top}px ${safe.side}px ${safe.bottom}px`,
        justifyContent: 'center',
      }}
    >
      {title ? (
        <div
          style={{
            fontFamily: body,
            fontSize: t.micro,
            color: c.dim,
            marginBottom: 40,
          }}
        >
          {title}
        </div>
      ) : null}

      {values.map((v, i) => {
        const p = spring({frame, fps, config: spring_, delay: i * 4});
        const hot = highlight.includes(i);
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', marginBottom: 26}}>
            <div
              style={{
                fontFamily: body,
                fontSize: t.micro,
                color: hot ? c.ink : c.dim,
                width: 160,
                flexShrink: 0,
              }}
            >
              {categories[i] ?? ''}
            </div>
            <div
              style={{
                height: hot ? 78 : 58,
                width: (Math.abs(v) / max) * trackW * p,
                background: hot ? c.signal : c.panel,
                borderRadius: 2,
              }}
            />
            <div
              style={{
                fontFamily: display,
                fontWeight: 700,
                fontSize: hot ? 62 : 44,
                color: hot ? c.signal : c.dim,
                marginLeft: 20,
                fontVariantNumeric: 'tabular-nums',
                opacity: p,
              }}
            >
              {(v * p).toLocaleString(undefined, {maximumFractionDigits: 1})}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const TitleCard: React.FC<{headline: string; sub?: string | null}> = ({headline, sub}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({frame, fps, config: spring_});
  return (
    <AbsoluteFill
      style={{
        background: c.ink,
        justifyContent: 'center',
        padding: `0 ${safe.side}px ${safe.bottom}px`,
      }}
    >
      <div
        style={{
          fontFamily: display,
          fontWeight: 800,
          fontSize: t.headline,
          lineHeight: 1.02,
          letterSpacing: '-0.03em',
          color: c.paper,
          clipPath: `inset(${interpolate(p, [0, 1], [100, 0])}% 0 0 0)`,
        }}
      >
        {headline}
      </div>
      {sub ? (
        <div
          style={{
            fontFamily: body,
            fontSize: t.label,
            color: c.dim,
            marginTop: 26,
            opacity: interpolate(p, [0.4, 1], [0, 1], {extrapolateLeft: 'clamp'}),
          }}
        >
          {sub}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const Contrast: React.FC<{
  left: string;
  leftLabel: string;
  right: string;
  rightLabel: string;
}> = ({left, leftLabel, right, rightLabel}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const a = spring({frame, fps, config: spring_});
  const b = spring({frame, fps, config: spring_, delay: 7});

  const cell = (value: string, label: string, p: number, tone: string) => (
    <div style={{opacity: p, transform: `translateY(${interpolate(p, [0, 1], [30, 0])}px)`}}>
      <div
        style={{
          fontFamily: display,
          fontWeight: 800,
          fontSize: 150,
          letterSpacing: '-0.04em',
          color: tone,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 0.9,
        }}
      >
        {value}
      </div>
      <div style={{fontFamily: body, fontSize: t.micro, color: c.dim, marginTop: 14}}>{label}</div>
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        background: c.paper,
        justifyContent: 'center',
        gap: 90,
        padding: `0 ${safe.side}px ${safe.bottom}px`,
      }}
    >
      {cell(left, leftLabel, a, c.dim)}
      {cell(right, rightLabel, b, c.signal)}
    </AbsoluteFill>
  );
};
