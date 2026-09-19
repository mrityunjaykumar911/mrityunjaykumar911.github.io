/**
 * Restrained product-launch register.
 *
 * Two rewrites ago this file chased retention mechanics — maximum contrast,
 * loud caption pops, a flash cut on the best number. That grammar works, but
 * it reads as someone selling. For an engineer's own work the more useful
 * register is the one hardware keynotes use: pure black, one near-white, very
 * large type at a *moderate* weight, and motion slow enough that it never
 * competes with the content.
 *
 * Colour is spent almost nowhere. A single system green marks one word per
 * beat at most; everything else is monochrome.
 */

export const c = {
  ground: '#000000',
  type: '#F5F5F7',
  mute: '#86868B',
  line: '#1D1D1F',
  accent: '#30D158',
} as const;

/**
 * Large, but not shouting. Weight 600-680 with tight tracking reads as
 * composed; 850+ reads as a sale. Line height stays generous.
 */
export const t = {
  hero: 300,
  headline: 96,
  body: 46,
  label: 34,
  caption: 54,
} as const;

/** Generous margins. Crowding is the fastest way to look cheap. */
export const safe = {
  top: 210,
  bottom: 400,
  side: 110,
} as const;

/**
 * The standard ease: a long, heavy decelerate. Everything uses it, which is
 * what makes the piece feel like one object rather than a sequence of effects.
 */
export const EASE = [0.32, 0.72, 0, 1] as const;

export const motion = {
  transitionS: 0.95,   // genuine overlap between beats
  entryS: 1.15,        // content settling in
  driftScale: 0.028,   // how far the slow push travels across a beat
} as const;
