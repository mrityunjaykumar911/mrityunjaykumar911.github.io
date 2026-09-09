// Freezes the five-task feasibility subset from the already-pinned ArtifactsBench
// smoke inputs. Reuses the immutable dataset/repository revisions recorded by
// prepare-smoke.mjs. Never executes downloaded scripts or candidate code.
// Purposeful small related-task subset, NOT representative benchmark coverage.
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const smokeDir = path.join(root, '.tools/study-c/smoke-inputs');
const out = path.join(root, '.tools/study-c/five-tasks');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const getPrompt = (r) => r.original_question || r.question || r.input || r.prompt;

// Same eligibility predicate as the smoke selector.
function eligible(prompt) {
  if (typeof prompt !== 'string' || prompt.length > 1600) return false;
  const stateful = /\b(to[ -]?do|task list|counter)\b/i.test(prompt);
  const local = !/https?:\/\/|backend|back-end|database|websocket|authentication|login|log in|API|server|React|Vue|Angular|image|photo|upload|multiplayer/i.test(prompt);
  return stateful && local;
}

// Stricter exclusions layered on top: drop the keyword false positives that the
// smoke predicate admits. "counter" matches "Counter-Strike"; "HTTP website"
// needs a real server. These are recorded with reasons, not silently dropped.
function exclusion(row, prompt) {
  if (typeof row.class === 'string' && /^Game/i.test(row.class)) return 'game_category_not_local_utility';
  if (/counter[- ]?strike|shooting|first[- ]?person|multiplayer/i.test(prompt)) return 'action_game_keyword_false_positive';
  if (/http\s*website|web\s*server|save\b.*\bserver|edit and save text/i.test(prompt)) return 'requires_http_server_backend';
  return null;
}

async function main() {
  const plan = JSON.parse(await readFile(path.join(root, 'scripts/study-c/experiment.plan.json'), 'utf8'));
  if (plan.providerSwitch?.provider !== 'xAI') throw new Error('provider_switch_not_configured');
  if (plan.fiveTaskRun?.userAuthorized !== true) throw new Error('five_task_run_not_authorized');

  const smoke = JSON.parse(await readFile(path.join(smokeDir, 'manifest.json'), 'utf8'));
  const raw = await readFile(path.join(smokeDir, 'artifacts_bench.json'), 'utf8');
  let rows;
  try { rows = JSON.parse(raw); } catch { rows = raw.trim().split(/\r?\n/).map((l) => JSON.parse(l)); }

  await mkdir(out, { recursive: true });
  try {
    await access(path.join(out, 'manifest.json'));
    console.log('Existing five-task manifest retained; selection is frozen.');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const selected = [];
  const excluded = [];
  for (const cand of smoke.selection.orderedCandidateIds) {
    const row = rows[cand.rowIndex];
    const prompt = getPrompt(row);
    if (!eligible(prompt)) { excluded.push({ ...cand, reason: 'not_eligible_under_smoke_predicate' }); continue; }
    const reason = exclusion(row, prompt);
    if (reason) { excluded.push({ ...cand, class: row.class, reason }); continue; }
    if (selected.length >= 5) { excluded.push({ ...cand, reason: 'beyond_five_task_limit' }); continue; }
    const checklist = typeof row.checklist === 'string' ? row.checklist : JSON.stringify(row.checklist, null, 2);
    if (!row.checklist || (Array.isArray(row.checklist) && row.checklist.length !== 10)) {
      throw new Error(`Task ${cand.id} has an unsupported checklist; stop rather than substitute.`);
    }
    selected.push({
      order: selected.length + 1, rowIndex: cand.rowIndex, id: cand.id,
      category: row.class, difficulty: row.difficulty, prompt, checklist,
      promptSha256: hash(prompt), checklistSha256: hash(checklist),
      promptBytes: Buffer.byteLength(prompt), checklistBytes: Buffer.byteLength(checklist),
    });
  }
  if (selected.length !== 5) {
    throw new Error(`Expected exactly five eligible tasks, found ${selected.length}. Do not proceed with a partial frozen set.`);
  }

  // Cross-check against the smoke-selected task to catch any drift.
  const smokeTask = selected.find((t) => t.id === smoke.selectedTask.id);
  if (!smokeTask || smokeTask.promptSha256 !== smoke.selectedTask.promptSha256 ||
      smokeTask.checklistSha256 !== smoke.selectedTask.checklistSha256) {
    throw new Error('Five-task hashes do not match the frozen smoke task; dataset drift suspected.');
  }

  for (const t of selected) {
    await writeFile(path.join(out, `task-${t.id}.prompt.txt`), t.prompt, { flag: 'wx' });
    await writeFile(path.join(out, `task-${t.id}.checklist.txt`), t.checklist, { flag: 'wx' });
  }

  const tasks = selected.map(({ prompt, checklist, ...meta }) => meta);
  const manifestSha256 = hash(tasks.map((t) => `${t.id}:${t.promptSha256}:${t.checklistSha256}`).join('\n'));
  const manifest = {
    schemaVersion: 1, studyId: 'C1-five-task-smoke', status: 'selected_before_generation',
    frozenAt: new Date().toISOString(),
    datasetRevision: smoke.datasetRevision, repositoryCommit: smoke.repositoryCommit,
    sourceFiles: smoke.sourceFiles,
    provenance: 'Subset of the smoke orderedCandidateIds; same immutable dataset/repository revisions.',
    selection: {
      purpose: 'Five related local-utility tasks for a feasibility comparison; NOT representative benchmark coverage.',
      predicate: smoke.selection.criteria,
      exclusions: 'Drop Game category and action-game/HTTP-server keyword false positives admitted by the smoke predicate.',
      orderedFromCandidates: smoke.selection.orderedCandidateIds.map((c) => c.id),
      excluded,
    },
    tasks, manifestSha256, codingOutputsInspected: false, generationRequests: 0,
  };
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({
    frozen: true, count: tasks.length, manifestSha256,
    tasks: tasks.map((t) => ({ order: t.order, id: t.id, difficulty: t.difficulty, category: t.category, promptBytes: t.promptBytes })),
    excluded: excluded.map((e) => ({ id: e.id, reason: e.reason })),
  }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
