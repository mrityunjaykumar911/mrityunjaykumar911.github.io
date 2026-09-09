import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { behaviorHash, deriveSchedules, compareBehaviorTrace, compileBehaviorContract } from './pipeline/behavioral-model.mjs';
import { BROWSER_EXECUTOR_PROTOCOL, captureGeneratedTraces, validateGeneratedBinding } from './pipeline/generated-browser.mjs';
import { validateSpec } from './pipeline/tla-oracle.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = path.join(ROOT, '.tools/study-c/quality-runs/quality-v6-1267-T-first');

async function main() {
  const parent = path.join(ROOT, '.tools/study-c/offline-replay-closure');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'saved-1267-'));
  const log = createProgressLogger();
  log.setFile(path.join(directory, 'progress.log'));
  const save = (name, data) => writeFile(path.join(directory, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
  const paths = {
    model: 'task-1267/shared-specification-repair/selected-source.json',
    html: 'task-1267/initial/desktop/html_desktop.html',
    category: 'task-1267/shared-bindings/cRecordCategorizedTodo/binding.json',
    date: 'task-1267/shared-bindings/cRecordDatedTodo/mapping/response.json',
    summary: 'summary.json',
  };
  const bytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, filename]) => [key, await readFile(path.join(SOURCE, filename), 'utf8')])));
  const model = JSON.parse(bytes.model).model;
  const category = model.contracts.find((contract) => contract.id === 'cRecordCategorizedTodo');
  const date = model.contracts.find((contract) => contract.id === 'cRecordDatedTodo');
  const categoryBinding = JSON.parse(bytes.category).binding;
  const originalDateBinding = JSON.parse(JSON.parse(bytes.date).text);
  assert.throws(() => validateGeneratedBinding(originalDateBinding, date), /setting_commit_order_invalid/);
  const annotatedDate = structuredClone(originalDateBinding);
  annotatedDate.prerequisites.prDueDateSet.commitActionId = 'actSaveDated';
  const contextualDate = structuredClone(annotatedDate);
  contextualDate.contexts = { actPickDueDate: [{ selector: '#todoModal', state: 'hidden',
    before: [{ op: 'click', selector: 'article.todo:has(.todo-title:has-text("Jb2TodoHorizon")) button[data-edit]' }], after: [] }] };
  const contextualCategory = structuredClone(categoryBinding);
  contextualCategory.contexts = { actEnterCategory: [{ selector: '#todoModal', state: 'visible',
    before: [{ op: 'click', selector: '#cancelTodo' }], after: [{ op: 'click', selector: '#newTodoBtn' },
      { op: 'fill', selector: '#todoTitle', value: categoryBinding.actions.actTypeTitle.at(-1).value }] }] };
  await save('inputs.json', { source: path.relative(ROOT, SOURCE), paths,
    hashes: Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, behaviorHash(value)])),
    executor: BROWSER_EXECUTOR_PROTOCOL, providerCalls: 0, bindingOrigin: 'manual offline annotations of exact saved generated bindings',
    modelChanged: false, htmlChanged: false, candidatePromoted: false });
  const java = path.join(ROOT, '.tools/java/jdk-21.0.12.1+1-jre/bin/java.exe');
  const validations = {};
  const replay = async (name, contract, binding, formal = false) => log.withStage(name, async () => {
    const schedule = deriveSchedules(contract);
    await save(`${name}-binding.json`, binding);
    const outDir = path.join(directory, name);
    const captures = await captureGeneratedTraces({ contract: { ...contract, traces: schedule.traces }, binding, html: bytes.html, outDir });
    const traces = [];
    for (const capture of captures) {
      if (capture.status !== 'recorded') { traces.push(capture); continue; }
      const reference = compareBehaviorTrace(contract, capture, capture.snapshots);
      const pending = Object.keys(capture.pendingSettings ?? {});
      let tlc = null;
      let agrees = null;
      if (formal) {
        log.log(`TLC replay: ${contract.id}/${capture.id}`);
        tlc = await validateSpec({ java, specDir: path.join(outDir, capture.id), ...compileBehaviorContract(contract, capture, capture.snapshots) });
        agrees = reference.status === 'passed' ? tlc.level === 'checked' && tlc.distinctStates === capture.snapshots.length
          : tlc.violatedInvariant === 'SnapshotMatches' && tlc.counterexample?.step === reference.failures?.[0]?.step;
      }
      traces.push({ ...capture, reference, tlc, agrees,
        completionEligible: reference.completionSatisfied === true && pending.length === 0,
        completionBlock: reference.completionSatisfied && pending.length ? 'completion_has_uncommitted_settings' : null });
    }
    const result = { name, contractId: contract.id, coverage: schedule.coverage, traces };
    await save(`${name}.json`, result);
    log.log(`${name}: recorded=${traces.filter((trace) => trace.status === 'recorded').length}/${traces.length}; pending=${traces.filter((trace) => Object.keys(trace.pendingSettings ?? {}).length).length}`);
    return result;
  });
  await log.withTask(1267, async () => {
    for (const contract of [category, date]) {
      validations[contract.id] = await log.withStage(`model-${contract.id}`, () => validateSpec({ java,
        specDir: path.join(directory, 'models', contract.id), ...compileBehaviorContract(contract) }));
    }
    const originalCategory = await replay('original-category', category, categoryBinding);
    const routedCategory = await replay('manual-category-context', category, contextualCategory, true);
    const commitDate = await replay('manual-date-commit-reference', date, annotatedDate);
    const routedDate = await replay('manual-date-edit-context', date, contextualDate, true);
    const sourceUnchanged = (await Promise.all(Object.entries(paths).map(async ([key, filename]) => bytes[key] === await readFile(path.join(SOURCE, filename), 'utf8')))).every(Boolean);
    const blockedCategory = originalCategory.traces.find((trace) => trace.reason === 'control_intercepted');
    const passingReplay = (result) => result.traces.every((trace) => trace.status === 'recorded' && trace.reference.status === 'passed' && trace.agrees);
    const pendingCompletion = routedDate.traces.find((trace) => trace.completionBlock === 'completion_has_uncommitted_settings');
    const regressionPassed = sourceUnchanged && Object.values(validations).every((item) => item.level === 'checked') &&
      blockedCategory?.diagnostic.actionId === 'actEnterCategory' && passingReplay(routedCategory) &&
      commitDate.traces.some((trace) => trace.status === 'blocked') && passingReplay(routedDate) && Boolean(pendingCompletion);
    const summary = { protocol: 'saved-replay-closure-offline-v1', executor: BROWSER_EXECUTOR_PROTOCOL,
      regressionPassed, sourceUnchanged, providerCalls: 0, candidatePromoted: false, benchmarkOutcomeChanged: false,
      originalDateRejection: 'setting_commit_order_invalid', validations,
      results: [originalCategory, routedCategory, commitDate, routedDate],
      conclusion: 'Manual bindings diagnose and exercise harness boundaries only. Date completion still includes an unsaved edit. No live T score or efficacy result.',
      limitations: ['No generated repair or binding review was rerun', 'Original reminder obligation remains excluded',
        'Editor-value observation does not establish persisted or visibly displayed dates', 'Context checks cover only modeled observations, not all application state'] };
    await save('summary.json', summary);
    log.log(`offline regression passed=${regressionPassed}; sources unchanged=${sourceUnchanged}; API calls=0; output=${path.relative(ROOT, directory)}`);
    if (!regressionPassed) process.exitCode = 1;
  });
}

main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });