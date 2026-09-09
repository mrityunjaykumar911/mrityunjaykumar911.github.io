// Public data acquisition only. Never execute downloaded scripts or candidate code.
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, '.tools/study-c/smoke-inputs');
const datasetRevision = '40e5597429a127963ebd03130851e898fb8ba982';
const repositoryCommit = '88c968b87e150e63de7660937e6dcfb8e7d643cf';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const publicFiles = {
  'artifacts_bench.json': `https://huggingface.co/datasets/tencent/ArtifactsBenchmark/resolve/${datasetRevision}/artifacts_bench.json`,
  'dataset-license.txt': `https://huggingface.co/datasets/tencent/ArtifactsBenchmark/resolve/${datasetRevision}/License.txt`,
  'dataset-readme.md': `https://huggingface.co/datasets/tencent/ArtifactsBenchmark/resolve/${datasetRevision}/README.md`,
  'repository-license.txt': `https://raw.githubusercontent.com/Tencent-Hunyuan/ArtifactsBenchmark/${repositoryCommit}/LICENSE`,
  'prompt_mllm_check.py': `https://raw.githubusercontent.com/Tencent-Hunyuan/ArtifactsBenchmark/${repositoryCommit}/src/prompts/prompt_mllm_check.py`,
  'utils.py': `https://raw.githubusercontent.com/Tencent-Hunyuan/ArtifactsBenchmark/${repositoryCommit}/src/utils.py`,
  'extract_ans.py': `https://raw.githubusercontent.com/Tencent-Hunyuan/ArtifactsBenchmark/${repositoryCommit}/src/extract_ans.py`,
};

async function main() {
  const plan = JSON.parse(await readFile(path.join(root, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (!plan.userAuthorization.downloadsAllowed || plan.userAuthorization.use !== 'noncommercial_research') {
    throw new Error('This acquisition is restricted to the recorded noncommercial research authorization.');
  }
  await mkdir(out, { recursive: true });
  // Do not replace a selected task on rerun. Acquisition may resume from cached
  // immutable URLs, but selection needs to remain stable once recorded.
  try {
    await access(path.join(out, 'manifest.json'));
    console.log('Existing smoke manifest retained; no new task selected.');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const inputs = {};
  for (const [name, url] of Object.entries(publicFiles)) {
    const filename = path.join(out, name);
    let bytes;
    try { bytes = await readFile(filename); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`Public acquisition failed: ${name}, HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 15_000_000) throw new Error(`Unexpected source size: ${name}`);
      await writeFile(filename, bytes, { flag: 'wx' });
    }
    inputs[name] = { url, sha256: hash(bytes), bytes: bytes.length };
  }
  const raw = await readFile(path.join(out, 'artifacts_bench.json'), 'utf8');
  let rows;
  try { rows = JSON.parse(raw); }
  catch { rows = raw.trim().split(/\r?\n/).map((line) => JSON.parse(line)); }
  if (!Array.isArray(rows)) throw new Error('Unsupported dataset structure; no task selected.');
  const getPrompt = (r) => r.original_question || r.question || r.input || r.prompt;
  const eligible = [];
  for (const [index, row] of rows.entries()) {
    const prompt = getPrompt(row);
    if (typeof prompt !== 'string') continue;
    // Purposeful small-task feasibility subset, NOT random benchmark coverage.
    // Fixed criteria before generation; official checklist not used for eligibility.
    const stateful = /\b(to[ -]?do|task list|counter)\b/i.test(prompt);
    const local = !/https?:\/\/|backend|back-end|database|websocket|authentication|login|log in|API|server|React|Vue|Angular|image|photo|upload|multiplayer/i.test(prompt);
    if (!stateful || !local || prompt.length > 1600) continue;
    eligible.push({ rowIndex: index, id: row.index ?? row.id ?? index,
      prompt, order: hash(`study-c1-smoke-task-v1:${hash(prompt)}`) });
  }
  eligible.sort((a, b) => a.order.localeCompare(b.order) || a.rowIndex - b.rowIndex);
  if (!eligible.length) {
    console.log(JSON.stringify({ status: 'no_task_matches_predeclared_smoke_criteria',
      rowCount: rows.length, firstRowFields: Object.keys(rows[0] ?? {}) }));
    throw new Error('No eligible local smoke task. Criteria must be amended before selection.');
  }
  const selected = eligible[0];
  const row = rows[selected.rowIndex];
  const checklist = typeof row.checklist === 'string' ? row.checklist : JSON.stringify(row.checklist, null, 2);
  if (!checklist || !row.checklist || (Array.isArray(row.checklist) && row.checklist.length !== 10)) {
    throw new Error('Selected task has an unsupported checklist; stop rather than replace it silently.');
  }
  await writeFile(path.join(out, 'task.prompt.txt'), selected.prompt, { flag: 'wx' });
  // The scoring checklist stays separate from all coding/contract inputs.
  await writeFile(path.join(out, 'judge.checklist.txt'), checklist, { flag: 'wx' });
  const manifest = {
    schemaVersion: 1, status: 'selected_before_generation', acquiredAt: new Date().toISOString(),
    datasetRevision, repositoryCommit, sourceFiles: inputs,
    licenseDisposition: 'Noncommercial research as authorized; preserve dataset and repository notices; no public redistribution of source rows.',
    selection: {
      purpose: 'One-task feasibility smoke, not representative sampling',
      criteria: 'Prompt contains todo/to-do/task list/counter; <=1600 characters; no remote URL, backend, database, auth, API/server, listed framework, image/upload or multiplayer requirement.',
      ordering: 'Ascending SHA256(study-c1-smoke-task-v1:SHA256(prompt)), tie row index',
      totalRows: rows.length, eligibleRows: eligible.length,
      orderedCandidateIds: eligible.map(({ rowIndex, id }) => ({ rowIndex, id })),
    },
    selectedTask: { rowIndex: selected.rowIndex, id: selected.id,
      promptSha256: hash(selected.prompt), checklistSha256: hash(checklist),
      checklistSerialization: 'String unchanged; otherwise complete JSON pretty-print preserving array order',
      category: row.class, difficulty: row.difficulty,
      promptBytes: Buffer.byteLength(selected.prompt), checklistBytes: Buffer.byteLength(checklist) },
    codingOutputsInspected: false, generationRequests: 0,
  };
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ selectedTask: manifest.selectedTask, eligibleRows: eligible.length,
    totalRows: rows.length, prompt: selected.prompt, generationRequests: 0 }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });