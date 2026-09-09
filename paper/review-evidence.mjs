// Read-only review accounting. No browser collection, re-scoring, or secret values.
// Run from any working directory: node paper/review-evidence.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const inputs = [
  'formal/research/sln/score_immobile.json',
  'formal/policy/policy.json',
  'formal/research/sln/FlexFacets.tla',
];
const texts = await Promise.all(inputs.map((path) => readFile(new URL(path, root), 'utf8')));
const [score, policy] = texts.slice(0, 2).map((text) => JSON.parse(text));
const entries = (object) => Object.entries(object).filter(([key]) => !key.startsWith('_'));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const pct = (part, total) => Number((100 * part / total).toFixed(2));
const lines = (text) => text.trimEnd().split(/\r?\n/).length;

// Validate the source accounting before deriving the paper's percentages.
assert.equal(score.admitted, score.true_admits + score.false_admits);
assert.equal(sum(Object.values(score.admits_by_facet)), score.admitted);
const missed = score.browser_independent - score.true_admits;
assert.equal(sum(Object.values(score.missed_shapes)), missed);
assert.equal(score.false_admits, 0, 'The nested container accounting requires zero false admits.');
assert.ok(score.containers_all_certified <= score.containers_all_independent);
assert.ok(score.containers_all_independent <= score.containers);
const sources = entries(policy.sources);
const sinks = entries(policy.sinks);
const sourceNames = new Set(sources.map(([name]) => name));
const sinkNames = new Set(sinks.map(([name]) => name));
for (const [, sink] of sinks) {
  assert.equal(new Set(sink.flows).size, sink.flows.length);
  for (const source of sink.flows) assert.ok(sourceNames.has(source));
}
for (const variant of ['current', 'fixed']) {
  for (const name of policy.audited[variant]) assert.ok(sinkNames.has(name));
}
const predicate = texts[2].match(/^CannotGrow\(cfg, i\)\s+==[\s\S]*?^Immobile\(cfg, i\)\s+==[^\r\n]*/m)?.[0];
assert.ok(predicate, 'Cannot locate the canonical collapsed predicate.');
const predicateLines = predicate.split(/\r?\n/).filter((line) => line.trim()).length;

console.log(JSON.stringify({
  scope: 'Derived accounting from the saved v3 score and study policy, not new experiments.',
  provenance: inputs.map((path, index) => ({
    path,
    sha256: createHash('sha256').update(texts[index]).digest('hex'),
  })),
  geometry: {
    containers: score.containers,
    observed_oracle: {
      count: score.containers_all_independent,
      pct: pct(score.containers_all_independent, score.containers),
      meaning: 'No coupling detected by the saved finite probes; not universal independence.',
    },
    item_local: {
      count: score.containers_all_certified,
      pct: pct(score.containers_all_certified, score.containers),
    },
    oracle_not_admitted: {
      count: score.containers_all_independent - score.containers_all_certified,
      percentage_points: pct(score.containers_all_independent - score.containers_all_certified, score.containers),
    },
    observed_coupled: {
      count: score.containers - score.containers_all_independent,
      pct: pct(score.containers - score.containers_all_independent, score.containers),
    },
    missed_items: missed,
    missed_shapes_at_first_width: entries(score.missed_shapes).map(([shape, count]) => ({
      shape, count, pct_of_misses: pct(count, missed),
    })),
    miss_category_limit: 'Raw-basis comparisons at 320px; not v3 Hyp facets or causal attribution across widths.',
    shrink_floor_pct_of_admits: pct(score.admits_by_facet['F3 ShrinkFloor'], score.admitted),
    fidelity: {
      observations: score.fidelity.observations,
      mismatches: score.fidelity.mismatch,
      tolerance_px: score.fidelity.tolerance_px,
      worst_px: score.fidelity.worst_px,
    },
    predicate_nonblank_lines: predicateLines,
  },
  disclosure_inventory: {
    source_labels: sources.length,
    pii_source_labels: sources.filter(([, source]) => source.pii).length,
    sinks: sinks.length,
    flow_edges: sum(sinks.map(([, sink]) => sink.flows.length)),
    current_audited_sinks: policy.audited.current.length,
    fixed_audited_sinks: policy.audited.fixed.length,
    detector_rules: entries(policy.detectors).length,
    configured_encodings: sum(entries(policy.detectors).map(([, rule]) => rule.encodings.length)),
    fixed_declassification_edges: sum(entries(policy.declassified.fixed).map(([, labels]) => labels.length)),
    fixed_clearance_overrides: entries(policy.overrides.fixed).length,
    policy_physical_lines_including_comments: lines(texts[1]),
    policy_compact_lines_excluding_comments: lines(JSON.stringify(policy, (key, value) => key.startsWith('_') ? undefined : value, 2)),
    caveat: 'Study snapshot; configuration size is not elapsed authoring or maintenance time.',
  },
  not_measured: [
    'Sound richer-vocabulary coverage on the same perturbation contract',
    'Transition-only affected-page count and paired error magnitude',
    'External-site disclosure prevalence and secret-scanner baselines',
    'Human authoring/maintenance time for either contract class',
    'Asset-preserving image ablation and independent replication',
  ],
}, null, 2));