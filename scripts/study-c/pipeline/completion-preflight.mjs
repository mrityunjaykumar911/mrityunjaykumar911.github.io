import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorQualityModel, eligibleQualityRecord } from './quality-contracts.mjs';
import { BEHAVIOR_COMPILER_VERSION, compileBehaviorContract, deriveSchedules } from './behavioral-model.mjs';
import { validateSpec } from './tla-oracle.mjs';

export async function runCompletionPreflight({ task, client, directory, onProgress = () => {},
  author = authorQualityModel, validate = validateSpec }) {
  await mkdir(directory, { recursive: true });
  const source = await author({ task, client, directory: path.join(directory, 'shared-model'), onProgress });
  const scoped = eligibleQualityRecord(source);
  const contracts = [];
  for (const contract of source.model.contracts) {
    let schedule;
    try { schedule = { status: 'derived', ...deriveSchedules(contract) }; }
    catch (error) { schedule = { status: 'blocked', reason: error.message }; }
    onProgress(`preflight TLC: ${contract.id}; completion=${contract.completion ? 'declared' : 'absent'}`);
    const structural = source.structuralReviews?.find((item) => item.id === contract.id);
    let validation;
    try {
      validation = structural?.accepted === false ? { level: 'unvalidated', detail: structural.reason, failureKind: 'invalid_specification' }
        : await validate({ specDir: path.join(directory, 'models', contract.id), ...compileBehaviorContract(contract) });
    } catch (error) { validation = { level: 'unvalidated', detail: 'model_validation_exception', failureKind: 'invalid_specification' }; }
    const result = { id: contract.id, completion: contract.completion ?? null,
      structural, semantic: source.semanticReviews?.find((item) => item.id === contract.id),
      grounding: source.grounding.contracts.find((review) => review.id === contract.id),
      eligible: scoped.coverage.eligibleIds.includes(contract.id), schedule, validation };
    contracts.push(result);
    await writeFile(path.join(directory, 'model-checks.json'), `${JSON.stringify(contracts, null, 2)}\n`, 'utf8');
    onProgress(`preflight TLC: ${contract.id}; ${validation.level}/${validation.detail}; states=${validation.distinctStates ?? 0}`);
  }
  const checked = contracts.filter((contract) => contract.validation.level === 'checked');
  const completed = checked.filter((contract) => contract.schedule.coverage?.completedStates > 0);
  const report = { protocol: 'completion-preflight-v1', compilerVersion: BEHAVIOR_COMPILER_VERSION,
    taskId: task.id, sourceModelHash: source.modelHash, coverage: scoped.coverage, contracts,
    generatedContracts: contracts.length, checkedContracts: checked.length, checkedFiniteContracts: completed.length,
    modelGate: scoped.coverage.full && checked.length === contracts.length && completed.length > 0 ? 'passed' : 'incomplete',
    browserGate: 'not-run', semanticInspection: 'pending', benchmarkClaim: false,
    limitations: ['One generated sample, not reliability across tasks', 'Grounding review is fallible',
      'Checked model completion is not browser correctness', 'No manually supplied completion predicates'] };
  await writeFile(path.join(directory, 'model-preflight.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}