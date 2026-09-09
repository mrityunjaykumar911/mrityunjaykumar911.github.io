import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BEHAVIOR_COMPILER_VERSION, behaviorHash } from './behavioral-model.mjs';
import { eligibleQualityRecord, bindQualityContract } from './quality-contracts.mjs';
import { evaluateQualityArtifact } from './quality-evidence.mjs';
import { validateSpec } from './tla-oracle.mjs';

export function mutateArtifact(html, mutation) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(mutation.id) || typeof mutation.before !== 'string' || !mutation.before ||
      typeof mutation.after !== 'string' || mutation.before === mutation.after || html.split(mutation.before).length !== 2) throw new Error('mutation_site_not_unique');
  return html.replace(mutation.before, () => mutation.after);
}

export function mutationVerdict(original, mutated, restored, targetIds) {
  const contracts = (suite) => targetIds.map((id) => suite.contracts.find((contract) => contract.id === id));
  if (!targetIds.length || contracts(original).some((contract) => contract?.status !== 'passed')) return 'blocked_control_not_passing';
  if (!mutated.complete || contracts(mutated).some((contract) => !['passed', 'failed'].includes(contract?.status))) return 'blocked_mutant_evidence';
  if (!contracts(mutated).some((contract) => contract.status === 'failed' && contract.failures?.some((failure) => failure.step > 0))) return 'not_detected';
  if (!restored.complete || contracts(restored).some((contract) => contract?.status !== 'passed')) return 'blocked_restoration';
  return 'detected_and_restored';
}

export async function runCompletionBrowser({ source, preflight, html, mutations, client, directory, onProgress = () => {},
  bind = bindQualityContract, evaluate = evaluateQualityArtifact, validate = validateSpec }) {
  if (source.modelHash !== behaviorHash(source.model) || preflight.sourceModelHash !== source.modelHash ||
      preflight.compilerVersion !== BEHAVIOR_COMPILER_VERSION) throw new Error('completion_preflight_identity_mismatch');
  if (!Array.isArray(mutations) || !mutations.length || new Set(mutations.map((mutation) => mutation.id)).size !== mutations.length) throw new Error('invalid_mutation_inventory');
  const scoped = eligibleQualityRecord(source);
  const checkedIds = preflight.contracts.filter((item) => item.validation.level === 'checked').map((item) => item.id);
  const model = { ...scoped.model, contracts: scoped.model.contracts.filter((contract) => checkedIds.includes(contract.id)) };
  if (!model.contracts.length) throw new Error('no_browser_eligible_contracts');
  const record = { ...scoped, model, modelHash: behaviorHash(model) };
  const variants = mutations.map((mutation) => {
    if (!Array.isArray(mutation.contractIds) || !mutation.contractIds.length ||
      mutation.contractIds.some((id) => !source.model.contracts.some((contract) => contract.id === id))) throw new Error('mutation_target_not_generated');
    return { mutation, html: mutateArtifact(html, mutation) };
  });
  await mkdir(directory, { recursive: true });
  const bindings = new Map();
  const frozenBind = (args) => {
    if (!bindings.has(args.contract.id)) bindings.set(args.contract.id, bind({ ...args, html,
      directory: path.join(directory, 'bindings', args.contract.id) }));
    return bindings.get(args.contract.id);
  };
  const validateEvidence = (args) => {
    if (path.basename(args.specDir) === 'model') {
      const id = path.basename(path.dirname(args.specDir));
      const cached = preflight.contracts.find((item) => item.id === id);
      if (!cached) throw new Error('missing_preflight_validation');
      return { ...cached.validation, reusedFrom: 'unchanged model preflight', compilerVersion: preflight.compilerVersion };
    }
    return validate(args);
  };
  const assess = (artifact, active, name) => evaluate({ record: active, html: artifact, client, formal: true,
    directory: path.join(directory, name), onProgress, bind: frozenBind, validate: validateEvidence });
  onProgress('browser control: replaying the saved unmodified HTML');
  const original = await assess(html, record, 'original');
  await writeFile(path.join(directory, 'original-evidence.json'), `${JSON.stringify(original, null, 2)}\n`, 'utf8');
  const results = [];
  for (const { mutation, html: changed } of variants) {
    if (mutation.contractIds.some((id) => original.contracts.find((contract) => contract.id === id)?.status !== 'passed')) {
      results.push({ ...mutation, status: 'blocked_control_not_passing' });
      continue;
    }
    const subset = { ...model, contracts: model.contracts.filter((contract) => mutation.contractIds.includes(contract.id)) };
    const active = { ...record, model: subset, modelHash: behaviorHash(subset) };
    onProgress(`browser mutation: ${mutation.id}; same contracts and bindings`);
    const mutated = await assess(changed, active, `${mutation.id}/mutated`);
    onProgress(`browser restoration: ${mutation.id}; original HTML restored`);
    const restored = await assess(html, active, `${mutation.id}/restored`);
    const status = mutationVerdict(original, mutated, restored, mutation.contractIds);
    results.push({ ...mutation, status, mutatedHash: behaviorHash(changed), mutated, restored });
    await writeFile(path.join(directory, 'mutations.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    onProgress(`browser mutation ${mutation.id}: ${status}`);
  }
  const full = scoped.coverage.full && model.contracts.length === source.model.contracts.length;
  const report = { protocol: 'completion-browser-v1', compilerVersion: BEHAVIOR_COMPILER_VERSION,
    sourceModelHash: source.modelHash, artifactHash: behaviorHash(html), coverage: scoped.coverage,
    executedContractIds: model.contracts.map((contract) => contract.id), original, mutations: results,
    browserGate: full && original.complete && original.contracts.every((contract) => contract.status === 'passed') &&
      results.every((result) => result.status === 'detected_and_restored') ? 'passed' : 'incomplete',
    benchmarkClaim: false, limitations: ['Saved artifact, not a fresh app generation', 'Manually seeded diagnostic defects',
      'Bindings generated against original HTML only', 'Grounding and binding reviews remain fallible'] };
  await writeFile(path.join(directory, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}