import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GENERATIVE_PROTOCOL, generatedReplaySpecification, sha256 } from './task-contracts.mjs';
import { validateSpec } from './tla-oracle.mjs';
import { runContractSuite } from './contract-suite.mjs';
import { captureGeneratedTraces, resolveGeneratedBinding } from './generated-browser.mjs';

export function generatedCacheIdentity(html, generated) {
  if (generated?.protocolVersion !== GENERATIVE_PROTOCOL || !generated.contractSha256) throw new Error('generated_contracts_required');
  const sourceSha256 = sha256(html);
  return { protocolVersion: GENERATIVE_PROTOCOL, contractSha256: generated.contractSha256, sourceSha256,
    key: `${GENERATIVE_PROTOCOL}-${generated.contractSha256.slice(0, 16)}-${sourceSha256.slice(0, 16)}` };
}

export function verifiedGeneratedFeedback(feedback, identity) {
  return feedback?.ok === true && feedback.protocolVersion === identity.protocolVersion &&
    feedback.contractSha256 === identity.contractSha256 && feedback.sourceSha256 === identity.sourceSha256 &&
    feedback.validation?.level === 'checked' && feedback.replay?.complete === true &&
    feedback.suite?.complete === true && feedback.suite.contracts.length >= 2 &&
    feedback.suite.contracts.every((contract) => ['passed', 'failed'].includes(contract.status) && contract.validation?.level === 'checked');
}

export async function evaluateGeneratedContract({ contract, html, client, evidenceDir, onProgress = () => {},
  validate = validateSpec, bind = resolveGeneratedBinding, capture = captureGeneratedTraces }) {
  const validation = await validate({ ...contract, specDir: path.join(evidenceDir, 'model') });
  if (validation.level !== 'checked') return { status: 'blocked', reason: 'generated_model_not_checked', validation };
  const binding = await bind({ contract, html, client, outDir: evidenceDir, onProgress });
  const traces = await capture({ contract, html, binding, outDir: path.join(evidenceDir, 'browser') });
  if (traces.length !== contract.traces.length || traces.some((trace, index) => trace.id !== contract.traces[index].id ||
      JSON.stringify(trace.actions) !== JSON.stringify(contract.traces[index].actions) || trace.status !== 'recorded')) {
    return { status: 'blocked', reason: 'generated_trace_incomplete', validation };
  }
  const failures = [];
  const checks = [];
  for (const trace of traces) {
    onProgress(`contract ${contract.id}: TLC replay ${trace.id}`);
    const check = await validate({ ...generatedReplaySpecification(contract, trace, trace.snapshots), specDir: path.join(evidenceDir, `trace-${trace.id}`) });
    checks.push({ id: trace.id, check });
    if (check.level === 'checked') {
      if (check.distinctStates !== trace.actions.length + 1) return { status: 'blocked', reason: 'incomplete_replay_state_coverage', validation, checks };
    } else if (check.violatedInvariant === 'SnapshotMatches' && Number.isInteger(check.counterexample?.step) && trace.snapshots[check.counterexample.step]) {
      const step = check.counterexample.step;
      if (step === 0) return { status: 'blocked', reason: 'initial_state_mapping_mismatch', validation, checks };
      failures.push({ trace: trace.id, step, actions: trace.actions.slice(0, step), observed: trace.snapshots[step], invariant: 'SnapshotMatches' });
    } else return { status: 'blocked', reason: 'generated_replay_inconclusive', validation, checks };
  }
  const first = traces[0];
  const probes = [];
  for (const { id } of contract.observables) {
    const snapshots = structuredClone(first.snapshots);
    snapshots[0][id] += 1;
    const check = await validate({ ...generatedReplaySpecification(contract, first, snapshots), specDir: path.join(evidenceDir, `probe-${id}`) });
    probes.push({ observable: id, check });
    if (check.violatedInvariant !== 'SnapshotMatches' || check.counterexample?.step !== 0) {
      return { status: 'blocked', reason: 'unobserved_or_vacuous_generated_invariant', validation, checks, probes };
    }
  }
  return { status: failures.length ? 'failed' : 'passed', validation, checks, probes, failures };
}

export async function generativeTlaArm({ task, artifact, client, repairPrompt, generatedContracts, evidenceDir,
  onProgress = () => {}, evaluate = evaluateGeneratedContract }) {
  const html = artifact.extracted.content;
  const identity = generatedCacheIdentity(html, generatedContracts);
  await mkdir(evidenceDir, { recursive: true });
  const suite = await runContractSuite({ contracts: generatedContracts.contracts, outDir: evidenceDir,
    concurrency: 2, onProgress, runContract: ({ contract, evidenceDir: contractDir }) =>
      evaluate({ contract, html, client, evidenceDir: contractDir, onProgress }) });
  const failures = suite.contracts.flatMap((contract) => (contract.failures ?? []).map((failure) => ({
    contract: contract.id, requirement: contract.requirement, ...failure,
    actions: failure.actions.map((action) => ({ id: action, description: generatedContracts.contracts.find((item) => item.id === contract.id).actions.find((item) => item.id === action).description })),
  })));
  const evidence = { ...identity, suite, evidenceDir, validation: { level: suite.complete ? 'checked' : 'incomplete' },
    replay: { complete: suite.complete, failures } };
  if (!suite.complete) return { ...evidence, kind: 'tla', ok: false, reason: 'generated_contract_suite_blocked', findings: '', repairPrompt: null };
  const findings = failures.length ? [
    'These browser-observed traces violated task-specific generated contracts that passed SANY/TLC and observation corruption checks.',
    JSON.stringify(failures, null, 2),
    'Repair only the observed requirement violations. Preserve styling, unrelated behavior, and existing features.',
    'Finite model-checking exploration bounds are not application requirements; do not introduce artificial limits.',
    'The contracts are bounded test oracles, not proof of the HTML implementation.',
  ].join('\n') : 'No violations observed in the generated contract suite. No speculative repair requested; bounded test evidence only.';
  const result = { ...evidence, kind: 'tla', ok: true, findings, repairPrompt: failures.length ? repairPrompt({ task, html, findings }) : null };
  await writeFile(path.join(evidenceDir, 'feedback.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}