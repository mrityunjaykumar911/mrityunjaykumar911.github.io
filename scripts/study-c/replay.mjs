// Deterministic, single-process simulation of ReleaseGate's finite action domain.
// No model inference, browser interaction, network, real release, or concurrency.
import { factKey } from './gate.mjs';

const EVIDENCE_FIELDS = ['revision', 'policy', 'attempt', 'status', 'inventory'];
const noEvidence = () => ({ revision: 0, policy: 0, attempt: 0, status: 'none', inventory: false });
const sameEvidence = (a, b) => EVIDENCE_FIELDS.every((key) => a[key] === b[key]);

export function extractFacts(state, requireTicket) {
  return {
    checksPassed: state.evidence.status === 'success',
    inventoryComplete: state.evidence.inventory,
    revisionMatches: state.evidence.revision === state.revision,
    policyMatches: state.evidence.policy === state.policy,
    attemptMatches: state.evidence.attempt === state.attempt,
    notCancelled: !state.cancelled,
    notReleased: state.publications.length === 0,
    ticketMatches: !requireTicket || sameEvidence(state.ticket, state.evidence),
  };
}

function validateAction(action) {
  const kind = action?.type;
  if (!['edit', 'policy', 'start', 'finish', 'cancel', 'prepare', 'commit'].includes(kind)) {
    throw new TypeError(`Unknown replay action: ${kind}.`);
  }
  const expected = kind === 'finish' ? ['type', 'attempt', 'status', 'inventory'] : ['type'];
  if (Object.keys(action).length !== expected.length || expected.some((key) => !Object.hasOwn(action, key))) {
    throw new TypeError('Unexpected or missing action fields.');
  }
  if (kind === 'finish' && (!Number.isInteger(action.attempt) || action.attempt < 1 || action.attempt > 2 ||
      !['success', 'fail', 'unknown'].includes(action.status) || typeof action.inventory !== 'boolean')) {
    throw new TypeError('Malformed completion: use a bounded attempt, known result, and Boolean inventory.');
  }
}

// Independent observation oracle: inspect frozen output plus commit context,
// not the gate decision, allowed bit, or live state after a later edit.
export function auditPublications(publications) {
  return publications.map((release, index) => {
    const failures = [];
    if (index > 0) failures.push('duplicate-release');
    if (release.artifact.status !== 'success') failures.push('checks-not-successful');
    if (release.artifact.inventory !== true) failures.push('inventory-incomplete');
    if (release.artifact.revision !== release.revision) failures.push('stale-artifact');
    if (release.artifact.policy !== release.policy) failures.push('stale-policy');
    if (release.artifact.attempt !== release.attempt) failures.push('superseded-attempt');
    if (release.cancelled !== false) failures.push('cancelled');
    return { publication: index + 1, safe: failures.length === 0, failures };
  });
}

export function replay(actions, decide) {
  const state = {
    revision: 1, policy: 1, attempt: 0, evidence: noEvidence(), pending: [],
    ticket: noEvidence(), cancelled: false, publications: [],
  };
  const events = [];
  for (const action of actions) {
    validateAction(action);
    const before = structuredClone(state);
    let outcome = 'applied';
    let facts = null;
    let enabled = true;
    if (action.type !== 'commit' && state.publications.length > 0) {
      outcome = 'disabled'; // Mirrors Live in the finite TLA+ model.
    } else {
      switch (action.type) {
        case 'edit':
          if (state.revision < 2) state.revision += 1;
          else outcome = 'disabled';
          break;
        case 'policy':
          if (state.policy < 2) state.policy += 1;
          else outcome = 'disabled';
          break;
        case 'start':
          if (state.attempt === 2) { outcome = 'disabled'; break; }
          state.attempt += 1;
          state.pending.push({ revision: state.revision, policy: state.policy, attempt: state.attempt });
          state.evidence = { ...state.pending.at(-1), status: 'pending', inventory: false };
          break;
        case 'finish': {
          const index = state.pending.findIndex((job) => job.attempt === action.attempt);
          if (index < 0) { outcome = 'disabled'; break; }
          const [job] = state.pending.splice(index, 1);
          state.evidence = { ...job, status: action.status, inventory: action.inventory };
          break;
        }
        case 'cancel':
          if (state.cancelled) outcome = 'disabled';
          else state.cancelled = true;
          break;
        case 'prepare':
        case 'commit': {
          const commit = action.type === 'commit';
          enabled = commit
            ? state.ticket.status !== 'none' && state.publications.length < 2
            : state.ticket.status === 'none';
          if (!enabled) { outcome = 'disabled'; break; }
          facts = extractFacts(state, commit);
          // Only a strict true authorizes. Null, timeout-like unknowns, and
          // non-Boolean outputs must never be mistaken for authorization.
          const decision = decide(structuredClone(facts));
          if (typeof decision !== 'boolean') throw new TypeError('Unknown gate decision; replay aborted.');
          if (!decision) { outcome = 'blocked'; break; }
          if (!commit) state.ticket = structuredClone(state.evidence);
          else {
            // Atomic only inside this synchronous simulator. A real adapter
            // requires a lock/CAS and authoritative hashes, not these counters.
            state.publications.push({
              artifact: structuredClone(state.ticket), revision: state.revision,
              policy: state.policy, attempt: state.attempt, cancelled: state.cancelled,
            });
          }
          break;
        }
      }
    }
    events.push({ action, outcome, factKey: facts ? factKey(facts) : null, before, after: structuredClone(state) });
  }
  return { events, publications: state.publications, audit: auditPublications(state.publications) };
}