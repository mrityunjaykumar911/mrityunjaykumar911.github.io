// Predeclared finite schedules; these are seeded protocol fixtures, NOT
// ArtifactsBench tasks, sampled agent traces, or estimates of field incidence.
const A = (type) => ({ type });
const finish = (attempt, status = 'success', inventory = true) => ({ type: 'finish', attempt, status, inventory });
const checked = [A('start'), finish(1)];
const prepared = [...checked, A('prepare')];
const end = [A('prepare'), A('commit')];
const scenario = (id, category, expectedSafePublications, actions) => ({ id, category, expectedSafePublications, actions });

export const SCHEDULES = [
  scenario('valid-release', 'valid', 1, [...checked, ...end]),
  scenario('edit-before-fresh-check', 'valid', 1, [A('edit'), ...checked, ...end]),
  scenario('policy-before-fresh-check', 'valid', 1, [A('policy'), ...checked, ...end]),
  scenario('old-result-then-latest-result', 'valid', 1, [A('start'), A('start'), finish(1), finish(2), ...end]),
  scenario('recovery-after-blocked-stale-prepare', 'recovery', 1,
    [...checked, A('edit'), A('prepare'), A('start'), finish(2), ...end]),
  scenario('stale-artifact-at-prepare', 'freshness', 0, [...checked, A('edit'), ...end]),
  scenario('stale-policy-at-prepare', 'freshness', 0, [...checked, A('policy'), ...end]),
  scenario('late-superseded-result', 'freshness', 0, [A('start'), A('start'), finish(2), finish(1), ...end]),
  scenario('missing-inventory', 'evidence', 0, [A('start'), finish(1, 'success', false), ...end]),
  scenario('failed-check', 'evidence', 0, [A('start'), finish(1, 'fail'), ...end]),
  scenario('unknown-check', 'evidence', 0, [A('start'), finish(1, 'unknown'), ...end]),
  scenario('pending-check', 'evidence', 0, [A('start'), ...end]),
  scenario('cancel-before-prepare', 'cancellation', 0, [...checked, A('cancel'), ...end]),
  scenario('cancel-after-prepare', 'cancellation', 0, [...prepared, A('cancel'), A('commit')]),
  scenario('edit-after-prepare', 'commit-race', 0, [...prepared, A('edit'), A('commit')]),
  scenario('policy-after-prepare', 'commit-race', 0, [...prepared, A('policy'), A('commit')]),
  scenario('attempt-after-prepare', 'commit-race', 0, [...prepared, A('start'), finish(2), A('commit')]),
  scenario('old-ticket-after-fresh-evidence', 'commit-race', 0,
    [...prepared, A('edit'), A('start'), finish(2), A('commit')]),
  scenario('failed-recheck-after-prepare', 'evidence', 0,
    [...prepared, A('start'), finish(2, 'fail'), A('commit')]),
  scenario('duplicate-commit', 'duplicate', 1, [...prepared, A('commit'), A('commit')]),
];