import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { saved1267TypedFixture } from './pipeline/fixtures/saved-1267-typed-prerequisites.mjs';
import { behaviorHash, validateBehaviorModel, deriveSchedules, compareBehaviorTrace, compileBehaviorContract } from './pipeline/behavioral-model.mjs';
import { validateGeneratedBinding, captureGeneratedTraces } from './pipeline/generated-browser.mjs';
import { validateSpec } from './pipeline/tla-oracle.mjs';
import { mutateArtifact } from './pipeline/completion-browser.mjs';
import { createProgressLogger } from './pipeline/progress.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export async function verifyTypedPrerequisites({ directory, scenario = 'mobile' }) {
  if (!['mobile', 'category-desktop'].includes(scenario)) throw new Error('invalid_offline_scenario');
  const viewport = scenario === 'category-desktop' ? { width: 1280, height: 720 } : { width: 390, height: 844 };
  const proposalPath = path.join(ROOT, '.tools/study-c/specification-repairs/semantic-1267-repair-v1/task-1267/loop/round-2/proposal.json');
  const artifactPath = path.join(ROOT, '.tools/study-c/quality-runs/quality-v3-1267-T-1gb-first/task-1267/initial/desktop/html_desktop.html');
  const proposalBytes = await readFile(proposalPath, 'utf8');
  const originalHtml = await readFile(artifactPath, 'utf8');
  const prompt = await readFile(path.join(ROOT, '.tools/study-c/five-tasks/task-1267.prompt.txt'), 'utf8');
  const originalModel = JSON.parse(proposalBytes).model;
  const fixture = saved1267TypedFixture(originalModel);
  const activeContracts = fixture.model.contracts.filter((contract) => scenario === 'mobile' || contract.id === 'category_mgmt');
  validateBehaviorModel(fixture.model, prompt);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory);
  const log = createProgressLogger();
  log.setFile(path.join(directory, 'progress.log'));
  const save = (name, data) => writeFile(path.join(directory, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
  await save('fixture.json', fixture);
  await save('inputs.json', { proposalPath, artifactPath, proposalHash: behaviorHash(proposalBytes), artifactHash: behaviorHash(originalHtml), promptHash: behaviorHash(prompt), scenario, viewport });
  const java = path.join(ROOT, '.tools/java/jdk-21.0.12.1+1-jre/bin/java.exe');
  const controls = [];
  const mutations = [];
  const blocked = [];
  const check = async (contract, html, name) => {
    const outDir = path.join(directory, name, contract.id);
    const schedule = deriveSchedules(contract);
    const binding = fixture.bindings[contract.id];
    validateGeneratedBinding(binding, { ...contract, traces: schedule.traces });
    const captures = await captureGeneratedTraces({ contract: { ...contract, traces: schedule.traces }, binding, html, outDir, viewport });
    const traces = [];
    for (const capture of captures) {
      if (capture.status !== 'recorded') { traces.push({ ...capture, reference: { status: 'blocked', reason: capture.reason } }); continue; }
      const reference = compareBehaviorTrace(contract, capture, capture.snapshots);
      const tlc = await validateSpec({ java, specDir: path.join(outDir, capture.id), ...compileBehaviorContract(contract, capture, capture.snapshots) });
      const agrees = reference.status === 'passed' ? tlc.level === 'checked' : reference.status === 'failed' && tlc.violatedInvariant === 'SnapshotMatches' && tlc.counterexample?.step === reference.failures[0].step;
      traces.push({ ...capture, reference, tlc, agrees });
    }
    return { contractId: contract.id, artifactHash: behaviorHash(html), traces,
      status: traces.some((trace) => !trace.agrees) ? 'blocked' : traces.some((trace) => trace.reference.status === 'failed') ? 'failed' : 'passed' };
  };
  await log.withTask(1267, () => log.withStage('offline-typed-prerequisite-validation', async () => {
    for (const contract of activeContracts) {
      log.log(`control: ${contract.id}; manual diagnostic binding; no API calls`);
      const result = await check(contract, originalHtml, 'controls');
      controls.push(result);
      await save(`control-${contract.id}.json`, result);
      log.log(`control ${contract.id}: ${result.status}`);
    }
    const definitions = [
      { id: 'category-loss', contractId: 'category_mgmt', before: 'categoryId: $("category").value,', after: 'categoryId: "",' },
      { id: 'date-loss', contractId: 'date_setting', before: 'due: dueVal ? new Date(dueVal).toISOString() : "",', after: 'due: "",' },
      { id: 'reminder-loss', contractId: 'auto_reminder', before: 'fireReminder(t, now > due + 60000 ? "overdue" : "soon");', after: 'void 0;' },
    ];
    for (const mutation of definitions) {
      if (!activeContracts.some((contract) => contract.id === mutation.contractId)) continue;
      if (controls.find((item) => item.contractId === mutation.contractId).status !== 'passed') {
        mutations.push({ id: mutation.id, status: 'blocked-control-not-passing' }); continue;
      }
      log.log(`mutation: ${mutation.id}; frozen fixture binding`);
      const result = await check(fixture.model.contracts.find((item) => item.id === mutation.contractId), mutateArtifact(originalHtml, mutation), mutation.id);
      const detected = result.status === 'failed' && result.traces.some((trace) => trace.reference.failures?.some((failure) => failure.step > 0));
      mutations.push({ ...mutation, result, detected });
      await save(`${mutation.id}.json`, mutations.at(-1));
      log.log(`mutation ${mutation.id}: detected=${detected}`);
    }
    for (const contract of originalModel.contracts.filter((item) => ['category_mgmt', 'date_setting', 'auto_reminder'].includes(item.id))) {
      try { validateGeneratedBinding(fixture.bindings[contract.id], contract); blocked.push({ contractId: contract.id, rejected: false }); }
      catch (error) { blocked.push({ contractId: contract.id, rejected: true, reason: error.message }); }
    }
  }));
  const unchanged = proposalBytes === await readFile(proposalPath, 'utf8') && originalHtml === await readFile(artifactPath, 'utf8');
  const passed = unchanged && controls.length === activeContracts.length && controls.every((item) => item.status === 'passed') && mutations.every((item) => item.detected) && blocked.every((item) => item.rejected);
  const summary = { protocol: 'typed-prerequisites-offline-v1', scenario, viewport, originalContractCount: fixture.model.contracts.length, testedContractIds: activeContracts.map((item) => item.id), status: passed ? 'passed' : 'incomplete', sourceUnchanged: unchanged,
    controls, mutations, legacyBindings: blocked, sourceModelHash: fixture.sourceModelHash, diagnosticModelHash: fixture.diagnosticModelHash,
    bindingOrigin: fixture.provenance, providerCalls: 0, candidatePromoted: false, artifactRepairAuthorized: false,
    limitations: ['No live generated specification or binding was tested', 'Diagnostic dates use stored editor-value readback, not arbitrary display-format parsing',
      'Reminder delivery is only in-tab at the explicitly configured offset', 'Native control types only; unsupported/custom controls still block'] };
  await save('summary.json', summary);
  log.log(`offline typed prerequisites: ${summary.status}; sources unchanged=${unchanged}; API calls=0`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, output, scenarioFlag, scenario] = process.argv.slice(2);
  if (flag !== '--output' || !output || ![4, 6].includes(process.argv.length) || scenarioFlag && scenarioFlag !== '--scenario') throw new Error('offline_output_required');
  verifyTypedPrerequisites({ directory: path.resolve(ROOT, output), scenario }).then((result) => { if (result.status !== 'passed') process.exitCode = 2; })
    .catch(() => { process.stderr.write('typed_prerequisites_offline_failed; inspect saved evidence\n'); process.exitCode = 1; });
}