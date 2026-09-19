import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {Captions} from './Captions';
import {Fragment} from './Fragment';
import {ChartReveal, Contrast, Stat, TitleCard} from './visuals';
import {c} from './tokens';

export type Visual =
  | {type: 'html_fragment'; ref: string; reveal: any; fit: any; focus_ref?: string | null}
  | {type: 'stat'; display: string; label: string; source_ref: string; trend?: string | null}
  | {type: 'chart_reveal'; src: string; series: number; highlight: number[]; mode: string}
  | {type: 'title_card'; headline: string; sub?: string | null}
  | {type: 'contrast'; left: string; left_label: string; right: string; right_label: string};

export type TimedBeat = {
  id: string;
  vo: string;
  visual: Visual;
  audio: string;
  dur_s: number;
  start_s: number;
  words: {word: string; start: number; end: number}[];
};

export type Props = {
  aspect: string;
  fps: number;
  total_frames: number;
  beats: TimedBeat[];
  charts: Record<string, {title?: string | null; categories: string[]; values: number[]}>;
  fragments: Record<string, string>;
  frag_css: string;
  font_css: string;
};

const renderVisual = (v: Visual, props: Props) => {
  switch (v.type) {
    case 'stat':
      return <Stat display={v.display} label={v.label} trend={v.trend} />;
    case 'chart_reveal': {
      const data = props.charts[v.src];
      if (!data) return <AbsoluteFill style={{background: c.paper}} />;
      return (
        <ChartReveal
          categories={data.categories}
          values={data.values}
          highlight={v.highlight}
          title={data.title}
        />
      );
    }
    case 'title_card':
      return <TitleCard headline={v.headline} sub={v.sub} />;
    case 'contrast':
      return (
        <Contrast
          left={v.left}
          leftLabel={v.left_label}
          right={v.right}
          rightLabel={v.right_label}
        />
      );
    case 'html_fragment':
      return (
        <Fragment
          html={props.fragments[v.ref] ?? ''}
          css={props.frag_css}
          reveal={v.reveal}
          fit={v.fit}
          focusRef={v.focus_ref}
        />
      );
  }
};

export const Short: React.FC<Props> = (props) => {
  const {beats, fps, font_css} = props;

  return (
    <AbsoluteFill style={{background: c.paper}}>
      {/* @font-face must live at document level: Chrome ignores it inside a
          shadow root, so fragment typography would silently fall back. */}
      {font_css ? <style dangerouslySetInnerHTML={{__html: font_css}} /> : null}

      {beats.map((b) => {
        const from = Math.round(b.start_s * fps);
        const durationInFrames = Math.max(1, Math.round(b.dur_s * fps));
        return (
          <Sequence key={b.id} from={from} durationInFrames={durationInFrames} name={b.id}>
            {renderVisual(b.visual, props)}
            <Captions words={b.words} />
            {b.audio ? <Audio src={staticFile(b.audio)} /> : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
