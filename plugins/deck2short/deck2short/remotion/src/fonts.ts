import {loadFont as loadDisplay} from '@remotion/google-fonts/Archivo';
import {loadFont as loadBody} from '@remotion/google-fonts/InterTight';

/**
 * Two families, clearly distinct in width and purpose: a tight grotesk with
 * real tabular figures for numerals, and a narrower text face for captions.
 * Loaded through Remotion so the renderer blocks until the glyphs are ready —
 * a font that arrives one frame late is a visible pop in the output.
 */
export const display = loadDisplay().fontFamily;
export const body = loadBody().fontFamily;
