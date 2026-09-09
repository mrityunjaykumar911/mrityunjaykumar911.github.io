import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { behaviorHash } from './behavioral-model.mjs';
import { requestOnce, parseObject, TEST_ENVIRONMENT } from './quality-contracts.mjs';
import { TASK_ADJUDICATION_SYSTEM, TASK_ADJUDICATION_PROTOCOL, assessTaskAdjudication } from './task-adjudication.mjs';
import { budgetClient } from './quality-loop.mjs';

export function removeAssociationForDiagnostic(model, { contractId, actionId, observableId, actionDescription, observableDescription }) {
  const copy = structuredClone(model);
  const contract = copy.contracts.find((item) => item.id === contractId);
  const action = contract?.actions.find((item) => item.id === actionId);
  const observable = contract?.observables.find((item) => item.id === observableId);
  if (!action || !observable || !actionDescription || !observableDescription) throw new Error('diagnostic_target_missing');
  action.description = actionDescription;
  observable.description = observableDescription;
  return copy;
}

export async function adjudicateSavedSamples({ task, samples, client, directory, onProgress = () => {} }) {
  if (samples.length !== 3 || new Set(samples.map((item) => item.id)).size !== 3 || samples.some((item) => !/^[a-z0-9-]+$/.test(item.id))) throw new Error('expected_three_unique_saved_samples');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'session.json'), JSON.stringify({ protocol: 'saved-adjudication-v1', adjudicationProtocol: TASK_ADJUDICATION_PROTOCOL,
    systemHash: behaviorHash(TASK_ADJUDICATION_SYSTEM), taskHash: behaviorHash(task.prompt), startedAt: new Date().toISOString(), pid: process.pid,
    samples: samples.map((item) => ({ id: item.id, modelHash: behaviorHash(item.model) })), maxCalls: 3 }), { flag: 'wx' });
  const bounded = budgetClient(client, { maxCalls: 3, maxOutputTokens: 12000 });
  const results = [];
  try {
    for (const sample of samples) {
      const outDir = path.join(directory, sample.id);
      await mkdir(outDir);
      const prompt = JSON.stringify({ task: task.prompt, environment: TEST_ENVIRONMENT, model: sample.model, phase: 'candidate' });
      await writeFile(path.join(outDir, 'input.json'), prompt, { flag: 'wx' });
      onProgress(`saved adjudication ${results.length + 1}/3: ${sample.id}`);
      let result;
      try {
        const response = await requestOnce({ client: bounded, directory: path.join(outDir, 'request'), system: TASK_ADJUDICATION_SYSTEM, prompt,
          purpose: 'saved-model-adjudication', maxOutputTokens: 4000, onProgress });
        if (!response.ok || !['stop', 'end-turn'].includes(response.finishReason)) throw new Error('adjudication_response_incomplete');
        const adjudication = assessTaskAdjudication({ id: task.id, prompt: task.prompt }, sample.model, parseObject(response.text));
        result = { id: sample.id, modelHash: behaviorHash(sample.model), status: 'reviewed', adjudication };
      } catch (error) { result = { id: sample.id, modelHash: behaviorHash(sample.model), status: 'blocked', reason: error.message }; }
      results.push(result);
      await writeFile(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
      onProgress(`${sample.id}: ${result.status}; accepted=${result.adjudication?.contracts.filter((item) => item.accepted).length ?? 'unknown'}/${sample.model.contracts.length}`);
    }
    const summary = { protocol: 'saved-adjudication-v1', adjudicationProtocol: TASK_ADJUDICATION_PROTOCOL, results,
      accounting: bounded.accounting, artifactRepairAuthorized: false, benchmarkClaim: false,
      limitations: ['One judgment per sample does not establish reliability', 'No binding generation or full browser replay',
        'Sample labels and expected negative-control verdict were not supplied to adjudication'] };
    await writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
    return summary;
  } finally {
    await writeFile(path.join(directory, 'accounting.json'), `${JSON.stringify(bounded.accounting, null, 2)}\n`, { flag: 'wx' });
  }
}