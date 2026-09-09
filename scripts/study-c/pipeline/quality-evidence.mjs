import path from 'node:path';
import { bindQualityContract } from './quality-contracts.mjs';
import { BEHAVIOR_COMPILER_VERSION, compileBehaviorContract, compareBehaviorTrace, deriveSchedules, behaviorHash } from './behavioral-model.mjs';
import { captureGeneratedTraces } from './generated-browser.mjs';
import { runContractSuite } from './contract-suite.mjs';
import { validateSpec } from './tla-oracle.mjs';

export async function evaluateQualityArtifact({ record, html, client, directory, formal, onProgress = () => {},
  bind = bindQualityContract, capture = captureGeneratedTraces, validate = validateSpec }) {
  if (!record.grounding?.accepted || record.modelHash !== behaviorHash(record.model)) {
    return { complete: false, status: 'blocked', reason: 'unaccepted_or_changed_model', contracts: [] };
  }
  return runContractSuite({ contracts: record.model.contracts.map((contract) => ({ ...contract, kind: formal ? 'tla' : 'executable',
    requirement: contract.requirements.map((requirement) => requirement.statement).join('\n') })),
  concurrency: 2, outDir: directory, onProgress, runContract: async ({ contract, evidenceDir }) => {
    const schedule = deriveSchedules(contract);
    if (formal) onProgress(`TLC model check: ${contract.id}; compiler=${BEHAVIOR_COMPILER_VERSION}; completion=${contract.completion ? 'declared' : 'not-declared'}`);
    const validation = formal ? await validate({ specDir: path.join(evidenceDir, 'model'), ...compileBehaviorContract(contract) }) : null;
    if (formal && validation.level !== 'checked') {
      onProgress(`TLC model check: ${contract.id}; blocked (${validation.detail})`);
      return { status: 'blocked', reason: 'formal_model_not_checked', compilerVersion: BEHAVIOR_COMPILER_VERSION, validation, coverage: schedule.coverage };
    }
    let mapping;
    try { mapping = await bind({ contract, schedule, html, client, directory: evidenceDir, onProgress }); }
    catch (error) { return { status: 'blocked', reason: error.prerequisite?.reason ?? 'binding_generation_or_review_failed',
      diagnostic: { errorName: error.name, message: error.message }, prerequisite: error.prerequisite, validation, stage: 'binding' }; }
    if (mapping.failure) return { status: 'blocked', reason: mapping.failure.reason, prerequisite: mapping.failure.prerequisite, validation, stage: 'binding' };
    if (!mapping.review.accepted) return { status: 'blocked', reason: 'mapping_review_rejected', validation, mappingReview: mapping.review };
    let traces;
    try { traces = await capture({ contract: mapping.interfaceContract, binding: mapping.binding, html, outDir: path.join(evidenceDir, 'browser') }); }
    catch (error) { return { status: 'blocked', reason: error.prerequisite?.reason ?? 'browser_execution_failed',
      diagnostic: { errorName: error.name, message: error.message }, prerequisite: error.prerequisite, validation, stage: 'browser' }; }
    const checks = [];
    if (traces.length !== schedule.traces.length) return { status: 'blocked', reason: 'incomplete_model_schedule', validation };
    for (let index = 0; index < traces.length; index++) {
      const trace = traces[index];
      if (trace.id !== schedule.traces[index].id || JSON.stringify(trace.actions) !== JSON.stringify(schedule.traces[index].actions)) {
        return { status: 'blocked', reason: 'unexecuted_model_schedule', validation, checks };
      }
      if (trace.status !== 'recorded' && trace.failedAction) {
        const failure = trace.failedAction;
        const operation = mapping.binding.actions[failure.actionId]?.[failure.operationIndex];
        if (!trace.snapshots?.length || failure.step !== trace.snapshots.length || failure.step > trace.actions.length ||
            trace.actions[failure.step - 1] !== failure.actionId || failure.matchedElements !== 1 ||
            !['control_hidden', 'control_disabled'].includes(failure.reason) || operation?.selector !== failure.selector || operation?.op !== failure.op ||
            failure.reason === 'control_hidden' && failure.visible !== false || failure.reason === 'control_disabled' && failure.enabled !== false) {
          return { status: 'blocked', reason: 'unverified_action_failure', validation, checks };
        }
        const prefix = { actions: trace.actions.slice(0, failure.step - 1) };
        const prefixReference = compareBehaviorTrace(contract, prefix, trace.snapshots);
        if (prefixReference.status !== 'passed') return { status: 'blocked', reason: 'unverified_action_preceding_state', validation, checks, prefixReference };
        let prefixTlc = null;
        if (formal) {
          prefixTlc = await validate({ specDir: path.join(evidenceDir, `${trace.id}-prefix`), ...compileBehaviorContract(contract, prefix, trace.snapshots) });
          if (prefixTlc.level !== 'checked' || prefixTlc.distinctStates !== trace.snapshots.length) return { status: 'blocked', reason: 'formal_action_prefix_not_checked', validation, checks, prefixTlc };
        }
        checks.push({ id: trace.id, actions: trace.actions, status: 'failed', observations: trace.snapshots, prerequisiteChecks: trace.prerequisiteChecks,
          failures: [{ step: failure.step, observable: `action:${failure.actionId}`, expected: 1, observed: 0, kind: 'action_unavailable', browserEvidence: failure }],
          tlc: prefixTlc, formalScope: 'Model and preceding observations checked; unavailable control is browser evidence, not a TLC counterexample' });
        continue;
      }
      if (trace.status !== 'recorded') {
        return { status: 'blocked', reason: trace.reason ?? 'unexecuted_model_schedule', diagnostic: trace.diagnostic,
          diagnosticScreenshot: trace.diagnosticScreenshot, prerequisite: trace.prerequisite, prerequisiteChecks: trace.prerequisiteChecks, validation, checks };
      }
      const reference = compareBehaviorTrace(contract, trace, trace.snapshots);
      if (reference.status === 'blocked') return { status: 'blocked', reason: reference.reason, validation, checks };
      let tlc = null;
      if (formal) {
        onProgress(`TLC replay: ${contract.id}/${trace.id}`);
        tlc = await validate({ specDir: path.join(evidenceDir, trace.id), ...compileBehaviorContract(contract, trace, trace.snapshots) });
        const agrees = reference.status === 'passed' ? tlc.level === 'checked' && tlc.distinctStates === trace.actions.length + 1
          : tlc.violatedInvariant === 'SnapshotMatches' && tlc.counterexample?.step === reference.failures[0].step;
        if (!agrees) return { status: 'blocked', reason: 'formal_reference_disagreement', validation, checks, tlc };
      }
      checks.push({ id: trace.id, actions: trace.actions, observations: trace.snapshots, prerequisiteChecks: trace.prerequisiteChecks,
        contextChecks: trace.contextChecks, pendingSettings: trace.pendingSettings, ...reference,
        modelCompletionSatisfied: reference.completionSatisfied,
        completionSatisfied: reference.completionSatisfied && !Object.keys(trace.pendingSettings ?? {}).length, tlc });
      if (reference.completionSatisfied && Object.keys(trace.pendingSettings ?? {}).length) {
        return { status: 'blocked', reason: 'completion_has_uncommitted_settings', checks, validation, coverage: schedule.coverage };
      }
    }
    const failures = checks.flatMap((check) => check.failures.map((failure) => ({ trace: check.id, actions: check.actions.slice(0, failure.step), ...failure })));
    if (!failures.length && contract.completion && contract.semantics?.evidence?.length && !checks.some((check) => check.completionSatisfied)) {
      return { status: 'blocked', reason: 'completion_evidence_not_observed', checks, validation, coverage: schedule.coverage };
    }
    return { status: failures.length ? 'failed' : 'passed', compilerVersion: BEHAVIOR_COMPILER_VERSION, validation, checks, failures, coverage: schedule.coverage,
      mappingReview: mapping.review, limitations: ['bounded model coverage', 'model and mapping reviewers are fallible', 'notifications are instrumented in-tab, not closed-app tests'] };
  } });
}

export function selectQualityCandidate({ initial, candidate, initialCritic, candidateCritic }) {
  if (!initial.complete || !candidate.complete) return { selected: 'initial', reason: 'incomplete_behavior_evidence' };
  if (!initialCritic?.ok || !candidateCritic?.ok) return { selected: 'initial', reason: 'invalid_development_critic' };
  const after = new Map(candidate.contracts.map((contract) => [contract.id, contract]));
  if (after.size !== initial.contracts.length || candidate.contracts.length !== initial.contracts.length) return { selected: 'initial', reason: 'changed_contract_inventory' };
  for (const before of initial.contracts) {
    const next = after.get(before.id);
    if (!next || !['passed', 'failed'].includes(next.status)) return { selected: 'initial', reason: 'missing_contract_replay' };
    const checks = new Map(next.checks?.map((check) => [check.id, check]) ?? []);
    if (checks.size !== before.checks?.length) return { selected: 'initial', reason: 'changed_trace_inventory' };
    for (const check of before.checks) {
      const replayed = checks.get(check.id);
      if (!replayed || JSON.stringify(check.actions) !== JSON.stringify(replayed.actions)) return { selected: 'initial', reason: 'changed_trace_inventory' };
      if (check.failures.some((failure) => failure.kind === 'action_unavailable') && check.observations?.some((snapshot, index) =>
        JSON.stringify(snapshot) !== JSON.stringify(replayed.observations?.[index]))) return { selected: 'initial', reason: 'action_prefix_observation_regression' };
      if (check.status === 'passed' && replayed.status !== 'passed') return { selected: 'initial', reason: 'behavior_regression' };
      const priorFailures = new Set(check.failures.map((failure) => `${failure.step}:${failure.observable}`));
      if (replayed.failures.some((failure) => !priorFailures.has(`${failure.step}:${failure.observable}`))) return { selected: 'initial', reason: 'new_failure_in_existing_trace' };
    }
  }
  const failureCount = (suite) => suite.contracts.reduce((sum, contract) => sum + (contract.failures?.length ?? 0), 0);
  const behaviorImproved = failureCount(candidate) < failureCount(initial);
  const visualImproved = candidateCritic.score > initialCritic.score;
  if (candidateCritic.score < initialCritic.score) return { selected: 'initial', reason: 'development_quality_regression' };
  return behaviorImproved || visualImproved ? { selected: 'candidate', reason: behaviorImproved ? 'fewer_behavior_failures' : 'development_quality_improved' }
    : { selected: 'initial', reason: 'no_measured_improvement' };
}