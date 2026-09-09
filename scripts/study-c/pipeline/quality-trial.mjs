import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorQualityModel, bindQualityContract, eligibleQualityRecord, QUALITY_PROTOCOL } from './quality-contracts.mjs';
import { BEHAVIOR_COMPILER_VERSION, behaviorHash, deriveSchedules } from './behavioral-model.mjs';
import { BROWSER_EXECUTOR_PROTOCOL, captureGeneratedTraces } from './generated-browser.mjs';
import { budgetClient, QUALITY_LIMITS, produceQualityArtifact, critiqueArtifact, runImprovementArm } from './quality-loop.mjs';
import { evaluateQualityArtifact } from './quality-evidence.mjs';
import { runSpecificationRepair, repairLimits, SPECIFICATION_REPAIR_PROTOCOL } from './specification-repair.mjs';
import { assessTaskAdjudication, TASK_ADJUDICATION_PROTOCOL } from './task-adjudication.mjs';
import { validateSpec } from './tla-oracle.mjs';

async function savedCapture({ contract, html, binding, outDir }) {
  const identity = behaviorHash({ executor: BROWSER_EXECUTOR_PROTOCOL, contract, html, binding });
  const file = path.join(outDir, 'saved-traces.json');
  try {
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record.identity !== identity) throw new Error('trace_cache_mismatch');
    return record.traces;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const traces = await captureGeneratedTraces({ contract, html, binding, outDir });
  await writeFile(file, `${JSON.stringify({ identity, traces }, null, 2)}\n`, 'utf8');
  return traces;
}

export async function runQualityTrial({ task, client, directory, finalJudge, armLimits = QUALITY_LIMITS, onProgress = () => {},
  author = authorQualityModel, produce = produceQualityArtifact, critique = critiqueArtifact, improve = runImprovementArm,
  bind = bindQualityContract, capture = savedCapture, modes = ['executable', 'formal'], specificationRepairRounds = 0, repair = runSpecificationRepair, validate = validateSpec }) {
  repairLimits(specificationRepairRounds);
  if (!Array.isArray(modes) || !modes.length || new Set(modes).size !== modes.length || modes.some((mode) => !['executable', 'formal'].includes(mode))) throw new Error('invalid_quality_modes');
  await mkdir(directory, { recursive: true });
  const summaryPath = path.join(directory, 'summary.json');
  const trialIdentity = behaviorHash({ protocol: QUALITY_PROTOCOL, compilerVersion: BEHAVIOR_COMPILER_VERSION,
    specificationRepairRounds, repairProtocol: SPECIFICATION_REPAIR_PROTOCOL, task: { id: task.id, prompt: task.prompt }, armLimits, modes });
  try {
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    if (summary.trialIdentity !== trialIdentity) throw new Error('trial_identity_changed');
    return summary;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const shared = budgetClient(client, { maxCalls: 16, maxOutputTokens: 100000 });
  onProgress('generating and reviewing shared behavioral model before app generation');
  let record;
  let modelPreparation = { enabled: specificationRepairRounds > 0, rounds: specificationRepairRounds, status: 'not-run' };
  try {
    const source = await author({ task: { id: task.id, prompt: task.prompt }, client: shared, directory: path.join(directory, 'shared-model'), onProgress });
    record = eligibleQualityRecord(source);
    if (specificationRepairRounds) {
      const repairDirectory = path.join(directory, 'shared-specification-repair');
      onProgress('shared model preparation: bounded generative repair and task adjudication before app generation');
      try {
        const result = await repair({ task: { id: task.id, prompt: task.prompt }, source, client, directory: repairDirectory,
          maxRounds: specificationRepairRounds, onProgress, validate });
        modelPreparation = { ...modelPreparation, status: result.status, stopReason: result.stopReason, accounting: result.accounting,
          originalModelHash: source.modelHash, selectedModelHash: result.selectedModelHash, taskValidatedContractIds: result.taskValidatedContractIds };
        const selected = JSON.parse(await readFile(path.join(repairDirectory, 'selected-source.json'), 'utf8'));
        if (result.originalModelHash !== source.modelHash || result.compilerVersion !== BEHAVIOR_COMPILER_VERSION ||
            result.adjudicationProtocol !== TASK_ADJUDICATION_PROTOCOL || selected.modelHash !== behaviorHash(selected.model) ||
            result.selectedModelHash !== selected.modelHash || selected.promptHash !== behaviorHash(task.prompt) ||
            selected.model.contracts.length !== source.model.contracts.length || new Set(selected.model.contracts.map((item) => item.id)).size !== source.model.contracts.length ||
            selected.model.contracts.some((item) => !source.model.contracts.some((prior) => prior.id === item.id))) throw new Error('selected_specification_identity_mismatch');
        const trusted = result.taskValidatedContractIds;
        if (!Array.isArray(trusted) || new Set(trusted).size !== trusted.length || trusted.some((id) => !selected.model.contracts.some((item) => item.id === id))) throw new Error('invalid_selected_contract_inventory');
        if (trusted.length) {
          const adjudication = assessTaskAdjudication({ prompt: task.prompt }, selected.model, selected.taskAdjudication);
          for (const id of trusted) {
            const contract = selected.model.contracts.find((item) => item.id === id);
            const verdict = adjudication.contracts.find((item) => item.id === id);
            if (!verdict.accepted || result.selectedContractVersions?.[id]?.contractHash !== behaviorHash(contract)) throw new Error('selected_contract_version_mismatch');
          }
          record = eligibleQualityRecord(selected);
          const unsupported = record.model.contracts.filter((contract) => !trusted.includes(contract.id) ||
            adjudication.contracts.find((item) => item.id === contract.id).dependencies.length > 0);
          const model = { ...record.model, contracts: record.model.contracts.filter((contract) => !unsupported.includes(contract)) };
          record = { ...record, sourceModelHash: source.modelHash, model, modelHash: behaviorHash(model),
            coverage: { ...record.coverage, eligible: model.contracts.length, eligibleIds: model.contracts.map((item) => item.id),
              full: record.coverage.full && !unsupported.length, excluded: [...record.coverage.excluded, ...unsupported.map((item) => ({ id: item.id,
                stage: 'selected-execution', reason: trusted.includes(item.id) ? 'joint_dependency_browser_replay_required' : 'contract_not_task_validated' }))] } };
        } else {
          record = { model: { contracts: [] }, modelHash: null, grounding: { accepted: false }, sourceModelHash: source.modelHash,
            coverage: { generated: source.model.contracts.length, eligible: 0, eligibleIds: [], full: false,
              excluded: source.model.contracts.map((item) => ({ id: item.id, stage: 'specification-repair', reason: 'contract_not_task_validated' })) } };
        }
      } catch (error) {
        modelPreparation = { ...modelPreparation, status: 'blocked', reason: error.message };
        record = { model: { contracts: [] }, modelHash: null, grounding: { accepted: false }, sourceModelHash: source.modelHash,
          coverage: { generated: source.model.contracts.length, eligible: 0, eligibleIds: [], full: false,
            excluded: source.model.contracts.map((item) => ({ id: item.id, stage: 'specification-repair', reason: 'selected_specification_unavailable_or_invalid' })) } };
      }
    }
  } catch {
    record = { model: { contracts: [] }, modelHash: null, grounding: { accepted: false },
      coverage: { generated: null, eligible: 0, eligibleIds: [], excluded: [], full: false, reason: 'model_generation_or_review_unavailable' } };
  }
  await writeFile(path.join(directory, 'model-preparation.json'), `${JSON.stringify(modelPreparation, null, 2)}\n`, 'utf8');
  await writeFile(path.join(directory, 'contract-coverage.json'), `${JSON.stringify(record.coverage, null, 2)}\n`, 'utf8');
  onProgress(`contract coverage: eligible=${record.coverage.eligible} generated=${record.coverage.generated ?? 'unknown'}; baseline generation will proceed`);
  const base = { trialIdentity, modes, protocol: QUALITY_PROTOCOL, compilerVersion: BEHAVIOR_COMPILER_VERSION, taskId: task.id, modelHash: record.modelHash, sourceModelHash: record.sourceModelHash,
    contractCoverage: record.coverage, modelPreparation,
    limits: armLimits, sharedAccounting: shared.accounting,
    comparison: modes.length === 2 ? 'same generated executable model, browser executor and development critic; formal mode adds TLC'
      : `single ${modes[0]} arm against a fresh initial artifact; not a cross-arm comparison`,
    caveats: ['exploratory generated models; semantic reviews are fallible', 'API ceilings matched, not equal realized cost or total compute',
      'bounded model-derived schedules, not exhaustive coverage of the HTML event loop',
      ...(specificationRepairRounds ? ['Both arms share task-adjudicated specification repair using TLC; this is not a no-TLA end-to-end ablation', 'Specification repair has its own explicit call budget; totals include it'] : [])] };
  const initial = await produce({ task, client: shared, directory: path.join(directory, 'initial'), onProgress });
  if (!record.model.contracts.length) {
    const decision = { selected: 'initial', reason: 'no_eligible_behavioral_contracts' };
    const reports = Object.fromEntries(modes.map((mode) => [mode, { status: 'blocked', decision, formalClaim: false }]));
    await writeFile(path.join(directory, 'selections-locked.json'), `${JSON.stringify({ protocol: QUALITY_PROTOCOL, compilerVersion: BEHAVIOR_COMPILER_VERSION, reports,
      contractCoverage: record.coverage, selectedHashes: { initial: initial.htmlHash } }, null, 2)}\n`, 'utf8');
    const rating = await finalJudge({ task, artifact: initial, directory: path.join(directory, 'final-judge', initial.htmlHash) });
    const summary = { ...base, status: 'incomplete', evaluationStatus: 'baseline-only', reason: 'no_eligible_behavioral_contracts',
      reports, initialHash: initial.htmlHash, blockedArmRate: 1, scores: {
        initial: { ...rating, artifactHash: initial.htmlHash, scoreSource: 'initial' },
        ...Object.fromEntries(modes.map((mode) => [mode, { score: null, status: 'blocked' }])),
      } };
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return summary;
  }
  const sharedBindings = new Map();
  for (const contract of record.model.contracts) {
    let mapping;
    try { mapping = await bind({ contract, schedule: deriveSchedules(contract), html: initial.html, client: shared,
      directory: path.join(directory, 'shared-bindings', contract.id), onProgress }); }
    catch (error) { mapping = { review: { accepted: false, reason: 'binding_generation_or_review_unavailable' },
      failure: { reason: error.prerequisite?.reason ?? error.message, prerequisite: error.prerequisite } }; }
    sharedBindings.set(contract.id, mapping);
  }
  const initialCritic = await critique({ task, artifact: initial, client: shared, directory: path.join(directory, 'shared-critic'), onProgress });
  const selected = new Map([['initial', initial]]);
  const reports = {};
  for (const mode of modes) {
    const started = Date.now();
    const arm = budgetClient(client, armLimits);
    onProgress(`${mode}: starting evidence-guided candidate selection`);
    try {
      const result = await improve({ task, record, initial, client: arm, formal: mode === 'formal', directory: path.join(directory, mode), onProgress,
        produce,
        critique: (args) => args.artifact.htmlHash === initial.htmlHash ? Promise.resolve(initialCritic) : critique(args),
        evaluate: (args) => evaluateQualityArtifact({ ...args, validate,
          bind: (bindingArgs) => args.html === initial.html ? Promise.resolve(sharedBindings.get(bindingArgs.contract.id)) : bind(bindingArgs),
          capture: (captureArgs) => capture({ ...captureArgs, outDir: path.join(directory, 'observations',
            behaviorHash({ html: args.html, contract: captureArgs.contract })) }),
        }),
      });
      selected.set(mode, result.selectedArtifact);
      reports[mode] = { ...result.report, contractCoverage: record.coverage,
        formalCoverageComplete: mode === 'formal' && record.coverage.full && result.report.status !== 'blocked',
        accounting: arm.accounting, elapsedMs: Date.now() - started };
    } catch {
      reports[mode] = { status: 'blocked', reason: 'arm_execution_or_budget_failure', accounting: arm.accounting, elapsedMs: Date.now() - started };
    }
    await writeFile(path.join(directory, `${mode}-selection.json`), `${JSON.stringify(reports[mode], null, 2)}\n`, 'utf8');
  }
  await writeFile(path.join(directory, 'selections-locked.json'), `${JSON.stringify({ protocol: QUALITY_PROTOCOL, compilerVersion: BEHAVIOR_COMPILER_VERSION,
    modelHash: record.modelHash, contractCoverage: record.coverage, reports, selectedHashes: Object.fromEntries([...selected].map(([mode, artifact]) => [mode, artifact.htmlHash])) }, null, 2)}\n`, 'utf8');
  const scores = {};
  const uniqueRatings = new Map();
  for (const [mode, artifact] of selected) {
    if (mode !== 'initial' && reports[mode].status === 'blocked') { scores[mode] = { score: null, status: 'blocked' }; continue; }
    if (!uniqueRatings.has(artifact.htmlHash)) {
      onProgress(`final evaluator: ${mode} (selections already locked)`);
      uniqueRatings.set(artifact.htmlHash, await finalJudge({ task, artifact, directory: path.join(directory, 'final-judge', artifact.htmlHash) }));
    }
    scores[mode] = { ...uniqueRatings.get(artifact.htmlHash), artifactHash: artifact.htmlHash,
      scoreSource: mode !== 'initial' && artifact.htmlHash === initial.htmlHash ? 'initial' : mode };
  }
  for (const mode of modes) scores[mode] ??= { score: null, status: 'blocked' };
  const blockedArms = Object.values(reports).filter((report) => report.status === 'blocked').length;
  const summary = { ...base, status: blockedArms || !record.coverage.full || Object.values(scores).some((score) => score.ok === false || score.score == null) ? 'incomplete' : 'complete',
    evaluationStatus: record.coverage.full ? 'full-contract-coverage' : 'partial-contract-coverage',
    blockedArmRate: blockedArms / modes.length, reports, scores, initialHash: initial.htmlHash };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}