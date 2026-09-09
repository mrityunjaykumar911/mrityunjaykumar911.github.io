import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const GENERATIVE_PROTOCOL = 'generative-contracts-v1';
export const CONTRACT_SYSTEM = `Generate 2 to 4 independent, requirement-grounded TLA+ contracts for the supplied task. Return JSON only: {"contracts":[...]}. Do not assume a particular application domain. Each contract has:
id: lowercase kebab-case; requirement: one observable behavioral obligation; sourceQuote: an exact quotation from the task grounding that obligation;
observables: [{"id":"identifier","description":"what the browser must measure as a nonnegative integer"}] (1 to 5 fields; booleans encoded as 0/1);
actions: [{"id":"identifier","description":"precise browser operation including concrete test input, or advancing a specified duration of time"}] (1 to 10);
traces: [{"id":"kebab-case","actions":["actionIdentifier",...]}] (1 to 3, each 1 to 40 actions). Each trace starts from a freshly loaded browser with empty storage. Use realistic concrete inputs; name identities explicitly so the adapter can map them. Do not require arbitrary optional features.
tla: a complete module named TaskSpec; cfg: a complete TLC config.
The TLA+ model must be executable and finite under exploration. EXTENDS may include only Naturals, Integers, Sequences, FiniteSets, TLC. No INSTANCE, custom imports, external calls, Java overrides or evaluation hooks.
Required interface (interface only, NOT supplied domain logic): CONSTANTS ReplayMode, InputActions, InputObserved. Define ReplayActions == <<>> and ReplayObserved == <<>> as separate one-line operators. VARIABLES must include step and domain state. Init sets step=0. Next when ReplayMode=TRUE executes the domain transition named by InputActions[step+1], increments step, and stutters after Len(InputActions). When ReplayMode=FALSE explore finite domain transitions with step unchanged. All listed actions must be enabled at their replay step (invalid input may explicitly stutter domain state). Include TypeOK and at least one meaningful named domain invariant, plus SnapshotMatches. SnapshotMatches when ReplayMode=TRUE compares EVERY observable against InputObserved[step+1].observableId using the actual domain state; otherwise TRUE. Use finite exploration CONSTRAINTs, NEVER turn exploration bounds into product limits or task invariants.
The config must include INIT Init, NEXT Next, CONSTANTS ReplayMode = FALSE, InputActions <- ReplayActions, InputObserved <- ReplayObserved, and INVARIANTS listing TypeOK, the domain invariants, SnapshotMatches. Define sequence values in TLA operators with <- overrides, not sequence literals in cfg. Prefer literal constants in TLA to avoid extra config assignments.
Do not supply expected browser verdicts or repair advice. Avoid aesthetic preferences or obligations unsupported by the quoted task. Specs and traces must be generated for this task, not selected from a task-ID catalog.`;

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const slug = /^[a-z][a-z0-9-]{0,59}$/;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function parseContractResponse(response, prompt) {
  const json = response.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
  const value = JSON.parse(json);
  if (!Array.isArray(value?.contracts) || value.contracts.length < 2 || value.contracts.length > 4) throw new Error('invalid_contract_count');
  const ids = new Set();
  for (const contract of value.contracts) {
    if (!slug.test(contract.id) || ids.has(contract.id) || !text(contract.requirement, 2000) ||
        !text(contract.sourceQuote, 1500) || !prompt.includes(contract.sourceQuote)) throw new Error('ungrounded_contract');
    ids.add(contract.id);
    for (const [field, max] of [['observables', 5], ['actions', 10]]) {
      const items = contract[field];
      if (!Array.isArray(items) || items.length === 0 || items.length > max || new Set(items.map((item) => item.id)).size !== items.length ||
          items.some((item) => !identifier.test(item.id) || !text(item.description, 2000))) throw new Error('invalid_contract_interface');
    }
    if (!Array.isArray(contract.traces) || !contract.traces.length || contract.traces.length > 3 ||
        new Set(contract.traces.map((trace) => trace.id)).size !== contract.traces.length || contract.traces.some((trace) =>
          !slug.test(trace.id) || !Array.isArray(trace.actions) || !trace.actions.length || trace.actions.length > 40 ||
          trace.actions.some((action) => !contract.actions.some((candidate) => candidate.id === action)))) throw new Error('invalid_generated_traces');
    if (!text(contract.tla, 40_000) || !text(contract.cfg, 8000) ||
        !/^-+ MODULE TaskSpec -+/m.test(contract.tla) || !/^ReplayActions == <<>>\s*$/m.test(contract.tla) ||
        !/^ReplayObserved == <<>>\s*$/m.test(contract.tla) || !/\bSnapshotMatches\s*==/.test(contract.tla)) throw new Error('invalid_generated_model_interface');
    if (/\b(?:INSTANCE|LOCAL|Print|PrintT|Assert|JavaTime|IOUtils|Json|Randomization|_TLCTrace)\b/.test(contract.tla)) throw new Error('unsupported_model_extension');
    for (const match of contract.tla.matchAll(/^\s*EXTENDS\s+([^\n]+)/gm)) {
      if (match[1].split(',').some((name) => !['Naturals', 'Integers', 'Sequences', 'FiniteSets', 'TLC'].includes(name.trim()))) throw new Error('unsupported_model_extension');
    }
    if (!/\bReplayMode\s*=\s*FALSE\b/.test(contract.cfg) || !/\bInputActions\s*<-\s*ReplayActions\b/.test(contract.cfg) ||
        !/\bInputObserved\s*<-\s*ReplayObserved\b/.test(contract.cfg) || !/\bSnapshotMatches\b/.test(contract.cfg)) throw new Error('invalid_generated_config');
    contract.kind = 'tla';
  }
  return value.contracts;
}

export async function generateTaskContracts({ task, client, outDir, onProgress = () => {} }) {
  const promptSha256 = sha256(task.prompt);
  const generatorSha256 = sha256(CONTRACT_SYSTEM);
  await mkdir(outDir, { recursive: true });
  const cachedFile = path.join(outDir, 'contracts.json');
  try {
    const cached = JSON.parse(await readFile(cachedFile, 'utf8'));
    if (cached.protocolVersion !== GENERATIVE_PROTOCOL || cached.promptSha256 !== promptSha256 || cached.generatorSha256 !== generatorSha256 ||
        cached.contractSha256 !== sha256(JSON.stringify(cached.contracts))) throw new Error('generated_contract_cache_mismatch');
    parseContractResponse(JSON.stringify({ contracts: cached.contracts }), task.prompt);
    return { ...cached, cached: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let response;
  try {
    response = JSON.parse(await readFile(path.join(outDir, 'generation.json'), 'utf8'));
    if (response.promptSha256 !== promptSha256 || response.generatorSha256 !== generatorSha256) throw new Error('generation_cache_mismatch');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(path.join(outDir, 'attempt.json'), JSON.stringify({ startedAt: new Date().toISOString(), promptSha256, generatorSha256 }), { flag: 'wx' });
    onProgress('T: generating task-specific contracts and traces from prompt only');
    const result = await client.generate({ system: CONTRACT_SYSTEM, prompt: task.prompt, maxOutputTokens: 12_000,
      purpose: `contracts-${task.id}`, onProgress: ({ chars, ms }) => onProgress(`T: contract generation ${chars} chars, ${Math.round(ms / 1000)}s`) });
    response = { ...result, promptSha256, generatorSha256 };
    await writeFile(path.join(outDir, 'generation.json'), `${JSON.stringify(response, null, 2)}\n`, 'utf8');
  }
  if (!response.ok) throw new Error('contract_generation_failed');
  const contracts = parseContractResponse(response.text, task.prompt);
  const record = { protocolVersion: GENERATIVE_PROTOCOL, promptSha256, generatorSha256,
    contractSha256: sha256(JSON.stringify(contracts)), generatedAt: new Date().toISOString(), contracts };
  await writeFile(cachedFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { ...record, cached: false };
}

export function generatedReplaySpecification(contract, trace, snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length !== trace.actions.length + 1 || snapshots.some((snapshot) =>
    contract.observables.some(({ id }) => !Number.isSafeInteger(snapshot[id])))) throw new Error('invalid_generated_observations');
  const records = snapshots.map((snapshot) => `[${contract.observables.map(({ id }) => `${id} |-> ${snapshot[id]}`).join(', ')}]`);
  return { tla: contract.tla.replace(/^ReplayActions == <<>>\s*$/m, `ReplayActions == <<${trace.actions.map((action) => JSON.stringify(action)).join(', ')}>>`)
    .replace(/^ReplayObserved == <<>>\s*$/m, `ReplayObserved == <<${records.join(', ')}>>`),
  cfg: contract.cfg.replace(/\bReplayMode\s*=\s*FALSE\b/, 'ReplayMode = TRUE') };
}