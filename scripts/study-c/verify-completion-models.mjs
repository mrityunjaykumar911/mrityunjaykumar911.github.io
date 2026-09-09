import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCompletionPreflight } from './pipeline/completion-preflight.mjs';
import { validateSpec } from './pipeline/tla-oracle.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';
import { behaviorHash } from './pipeline/behavioral-model.mjs';

export async function verifySavedCompletionModels({ sourceFile, directory, java, taskId, validate = validateSpec }) {
  sourceFile = path.resolve(sourceFile);
  directory = path.resolve(directory);
  java = path.resolve(java);
  const sourceBytes = await readFile(sourceFile, 'utf8');
  const source = JSON.parse(sourceBytes);
  await mkdir(directory, { recursive: true });
  const log = createProgressLogger();
  log.setFile(path.join(directory, 'progress.log'));
  await writeFile(path.join(directory, 'source.json'), `${JSON.stringify({ sourceFile, sourceHash: behaviorHash(sourceBytes),
    sourceModelHash: source.modelHash, reason: 'Explicit offline recheck; original preflight is not overwritten', java }, null, 2)}\n`, { flag: 'wx' });
  const report = await log.withTask(taskId, () => log.withStage('offline-model-recheck', () => runCompletionPreflight({
    task: { id: taskId }, directory, author: async () => source, onProgress: log.log,
    validate: (args) => validate({ ...args, java }),
  })));
  if (await readFile(sourceFile, 'utf8') !== sourceBytes) throw new Error('source_model_changed');
  log.log(`offline recheck: ${report.checkedContracts}/${report.generatedContracts} models checked; modelGate=${report.modelGate}; no API calls`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceFile, directory, java, taskId] = process.argv.slice(2);
  if (!sourceFile || !directory || !java || !taskId) throw new Error('source_output_java_task_required');
  verifySavedCompletionModels({ sourceFile, directory, java, taskId }).catch(() => {
    process.stderr.write('offline_completion_recheck_failed; inspect saved diagnostics\n'); process.exitCode = 1;
  });
}