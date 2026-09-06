// Shared visual design-token model. The TLA+ spec (formal/VisualVariant.tla) and
// the optimizer (scripts/optimize-visual.mjs) must agree on this admissible set;
// scripts/check-tla.mjs verifies that agreement against TLC.

export const Bodies = [12, 13, 14, 15, 16];
export const Heads = [20, 25, 30, 35, 40, 45, 50]; // hierarchy ratio x10
export const Folds = [40, 60, 80, 100, 120, 140, 160, 180, 200];
export const Spaces = [4, 6, 8];

// Safety envelope. These are the invariants TLC checks in formal/VisualVariant.tla.
export function isAdmissible(v) {
  return (
    v.body >= 13 &&
    v.head >= 25 &&
    v.head <= 45 &&
    v.fold >= 40 &&
    v.fold <= 120 &&
    (v.space === 4 || v.space === 8)
  );
}

export const seed = { body: 15, head: 40, fold: 100, space: 8 };

export function enumerateFullSpace() {
  const all = [];
  for (const body of Bodies)
    for (const head of Heads)
      for (const fold of Folds)
        for (const space of Spaces) all.push({ body, head, fold, space });
  return all;
}

export function enumerateAdmissible() {
  return enumerateFullSpace().filter(isAdmissible);
}

// Declared design objective over tokens (not a measured perceptual outcome).
// Targets mirror the modern measured page: hierarchy ~3.8, focused fold, legible
// body, on-grid spacing. Weights sum to 1.
const weights = { head: 0.3, fold: 0.3, body: 0.25, space: 0.15 };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function score(v) {
  const head = clamp01(1 - Math.abs(v.head - 38) / 20);
  const fold = clamp01(1 - Math.abs(v.fold - 80) / 120);
  const body = clamp01((v.body - 12) / 4);
  const space = v.space === 8 ? 1 : 0.7;
  return Number(
    (weights.head * head + weights.fold * fold + weights.body * body + weights.space * space).toFixed(4)
  );
}

// One guarded move sets a single dimension to any admissible value, mirroring
// the SetBody/SetHead/SetFold/SetSpace actions in the TLA+ spec.
function admissibleNeighbors(current) {
  const dims = [
    ['body', Bodies],
    ['head', Heads],
    ['fold', Folds],
    ['space', Spaces],
  ];
  const neighbors = [];
  for (const [key, domain] of dims) {
    for (const value of domain) {
      if (value === current[key]) continue;
      const candidate = { ...current, [key]: value };
      if (isAdmissible(candidate)) neighbors.push(candidate);
    }
  }
  return neighbors;
}

export function exhaustiveSearch() {
  let best = seed;
  let bestScore = score(seed);
  let evaluations = 0;
  for (const v of enumerateAdmissible()) {
    evaluations += 1;
    const s = score(v);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return { best, bestScore, evaluations };
}

export function greedySearch() {
  let current = seed;
  let currentScore = score(current);
  let evaluations = 0;
  const path = [{ ...current, score: currentScore }];
  let unsafeVisited = 0; // guarded moves never leave the envelope

  for (;;) {
    let next = null;
    let nextScore = currentScore;
    for (const candidate of admissibleNeighbors(current)) {
      evaluations += 1;
      if (!isAdmissible(candidate)) unsafeVisited += 1;
      const s = score(candidate);
      if (s > nextScore) {
        next = candidate;
        nextScore = s;
      }
    }
    if (!next) break;
    current = next;
    currentScore = nextScore;
    path.push({ ...current, score: currentScore });
  }

  return { best: current, bestScore: currentScore, evaluations, unsafeVisited, path };
}
