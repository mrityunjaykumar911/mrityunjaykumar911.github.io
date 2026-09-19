import React from 'react';
import {Composition} from 'remotion';
import {Short, Props} from './Short';

const fallback: Props = {
  aspect: '9:16',
  fps: 30,
  total_frames: 90,
  beats: [],
  charts: {},
  fragments: {},
  frag_css: '',
  font_css: '',
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Short"
    component={Short}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={90}
    defaultProps={fallback}
    // Duration comes from the real audio, so it is only known at render time.
    calculateMetadata={({props}) => ({
      durationInFrames: Math.max(1, props.total_frames),
      fps: props.fps ?? 30,
    })}
  />
);
