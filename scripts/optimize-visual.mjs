import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  enumerateFullSpace,
  enumerateAdmissible,
  exhaustiveSearch,
  greedySearch,
  score,
  seed,
} from './visual-model.mjs';

const fullSpace = enumerateFullSpace();
const admissible = enumerateAdmissible();
const prunedUnsafe = fullSpace.length - admissible.length;

const exhaustive = exhaustiveSearch();
const greedy = greedySearch();

const seedScore = score(seed);
const improvement = Number((((exhaustive.bestScore - seedScore) / seedScore) * 100).toFixed(1));
const greedyMatchesGlobal = greedy.bestScore === exhaustive.bestScore;

const result = {
  generatedAt: new Date().toISOString(),
  designSpace: {
    fullStates: fullSpace.length,
    admissibleStates: admissible.length,
    prunedUnsafeStates: prunedUnsafe,
    prunedFraction: Number((prunedUnsafe / fullSpace.length).toFixed(3)),
  },
  objective: 'declared weighted score over design tokens; not a measured perceptual outcome',
  seed: { ...seed, score: seedScore },
  algorithms: {
    exhaustive: {
      best: exhaustive.best,
      score: exhaustive.bestScore,
      evaluations: exhaustive.evaluations,
    },
    greedy: {
      best: greedy.best,
      score: greedy.bestScore,
      evaluations: greedy.evaluations,
      unsafeVisited: greedy.unsafeVisited,
      steps: greedy.path.length - 1,
    },
  },
  outcome: {
    scoreImprovementPercent: improvement,
    greedyMatchesGlobalOptimum: greedyMatchesGlobal,
    unsafeVariantsSelected: 0,
  },
};

const outPath = path.resolve('formal', 'visual-optimization.json');
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

console.log('[visual] design space:');
console.log(`  full=${fullSpace.length} admissible=${admissible.length} pruned-unsafe=${prunedUnsafe}`);
console.log(`[visual] seed score ${seedScore} -> best ${exhaustive.bestScore} (+${improvement}%)`);
console.log(`[visual] exhaustive best ${JSON.stringify(exhaustive.best)}`);
console.log(
  `[visual] greedy best ${JSON.stringify(greedy.best)} in ${greedy.path.length - 1} steps` +
    ` (matches global: ${greedyMatchesGlobal})`
);
console.log(`[visual] unsafe variants selected: 0; unsafe variants visited by guarded search: ${greedy.unsafeVisited}`);
console.log(`[visual] wrote ${path.relative(process.cwd(), outPath)}`);

if (greedy.unsafeVisited !== 0 || !admissible.every((v) => v.body >= 13)) {
  throw new Error('Search escaped the safety envelope.');
}
