import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { behaviorHash, BEHAVIOR_COMPILER_VERSION } from './behavioral-model.mjs';
import { reviewQualityModel } from './quality-contracts.mjs';
import { assessTaskAdjudication, TASK_ADJUDICATION_PROTOCOL } from './task-adjudication.mjs';
import { dependencyConsistency } from './contract-combination.mjs';
import { runCompletionPreflight } from './completion-preflight.mjs';
import { evaluateQualityArtifact } from './quality-evidence.mjs';
import { validateSpec } from './tla-oracle.mjs';
import { budgetClient } from './quality-loop.mjs';

export async function verifySelectedSpecification({ task, source, selection, html, client, directory, onProgress = () => {},
  validate = validateSpec, bind, capture }) {
  const modelHash = behaviorHash(source.model);
  if (typeof html !== 'string' || !html.trim() || source.modelHash !== modelHash || source.promptHash !== behaviorHash(task.prompt) ||
      selection.selectedModelHash !== modelHash || selection.adjudicationProtocol !== TASK_ADJUDICATION_PROTOCOL ||
      selection.compilerVersion !== BEHAVIOR_COMPILER_VERSION || !Array.isArray(selection.taskValidatedContractIds) ||
      new Set(selection.taskValidatedContractIds).size !== selection.taskValidatedContractIds.length) throw new Error('selected_specification_identity_mismatch');
  const adjudication = assessTaskAdjudication(task, source.model, source.taskAdjudication);
  const chosenIds = selection.taskValidatedContractIds;
  if (chosenIds.some((id) => !source.model.contracts.some((contract) => contract.id === id) ||
      selection.selectedContractVersions?.[id]?.contractHash !== behaviorHash(source.model.contracts.find((contract) => contract.id === id)))) throw new Error('selected_contract_version_mismatch');
  await mkdir(directory, { recursive: true });
  const identity = { modelHash, artifactHash: behaviorHash(html), taskHash: behaviorHash(task.prompt), compilerVersion: BEHAVIOR_COMPILER_VERSION,
    selectedContractVersions: selection.selectedContractVersions, taskValidatedContractIds: chosenIds };
  await writeFile(path.join(directory, 'verification-input.json'), `${JSON.stringify(identity, null, 2)}\n`, { flag: 'wx' });
  const record = await reviewQualityModel({ task: { id: task.id, prompt: task.prompt }, model: source.model, taskAdjudication: adjudication,
    directory: path.join(directory, 'record'), onProgress });
  const preflight = await runCompletionPreflight({ task, directory: path.join(directory, 'model-revalidation'), author: async () => record, validate, onProgress });
  const admittedIds = preflight.contracts.filter((contract) => contract.eligible && contract.validation.level === 'checked').map((contract) => contract.id);
  const blockers = chosenIds.filter((id) => !admittedIds.includes(id)).map((id) => ({ contractId: id, reason: 'selected_model_revalidation_failed' }));
  blockers.push(...dependencyConsistency(source.model, adjudication, chosenIds));
  for (const review of adjudication.contracts.filter((item) => chosenIds.includes(item.id))) {
    for (const dependency of review.dependencies) {
      if (selection.selectedContractVersions[review.id]?.dependencyHashes?.[dependency] !== behaviorHash(source.model.contracts.find((contract) => contract.id === dependency))) {
        blockers.push({ contractId: review.id, dependency, reason: 'selected_dependency_version_mismatch' });
      }
    }
    if (review.dependencies.length) blockers.push({ contractId: review.id, reason: 'joint_dependency_browser_replay_required' });
  }
  const executableIds = chosenIds.filter((id) => !blockers.some((blocker) => blocker.contractId === id));
  let evidence = { complete: false, status: 'blocked', contracts: [], reason: 'no_independently_executable_selected_contracts' };
  const bounded = executableIds.length ? budgetClient(client, { maxCalls: executableIds.length * 2, maxOutputTokens: executableIds.length * 7500 }) : null;
  try {
    if (executableIds.length) {
      const model = { ...source.model, contracts: source.model.contracts.filter((contract) => executableIds.includes(contract.id)) };
      const scoped = { ...record, model, modelHash: behaviorHash(model), grounding: { accepted: true,
        contracts: record.grounding.contracts.filter((review) => executableIds.includes(review.id)) } };
      evidence = await evaluateQualityArtifact({ record: scoped, html, client: bounded, directory: path.join(directory, 'browser-evidence'),
        formal: true, onProgress, validate, ...(bind ? { bind } : {}), ...(capture ? { capture } : {}) });
    }
    const verifiedIds = evidence.contracts.filter((contract) => ['passed', 'failed'].includes(contract.status)).map((contract) => contract.id);
    const repairableIds = evidence.contracts.filter((contract) => contract.status === 'failed' && contract.failures?.some((failure) => failure.step > 0)).map((contract) => contract.id);
    const full = chosenIds.length === source.model.contracts.length && !blockers.length && evidence.complete && verifiedIds.length === chosenIds.length;
    const result = { ...identity, protocol: 'selected-specification-browser-v1', originalContractCount: selection.originalContractCount,
      selectedContractCount: chosenIds.length, preflight, blockers, evidence, verifiedContractIds: verifiedIds, repairableContractIds: repairableIds,
      fullScopeVerified: full, browserGate: full ? 'verified' : 'incomplete',
      artifactRepairAuthorized: full && repairableIds.length > 0,
      scopedArtifactRepairAuthorized: repairableIds.length > 0,
      guidance: evidence.contracts.filter((contract) => repairableIds.includes(contract.id)).map((contract) => ({ contractId: contract.id, failures: contract.failures })),
      limitations: ['Guidance applies only to this model hash, artifact hash and verified contracts',
        'Cross-contract browser dependencies require a joint executor and remain blocked here', 'Task adjudication and DOM mapping remain fallible', 'No whole-app correctness or score claim'] };
    await writeFile(path.join(directory, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    return result;
  } finally {
    await writeFile(path.join(directory, 'accounting.json'), `${JSON.stringify(bounded?.accounting ?? { calls: 0 }, null, 2)}\n`, { flag: 'wx' });
  }
}