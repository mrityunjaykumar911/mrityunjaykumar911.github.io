import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// Frame-indexed rendering: every run of the same props produces the same frames.
Config.setConcurrency(null); // null = auto, one Chrome tab per core
Config.setChromiumOpenGlRenderer('angle');
