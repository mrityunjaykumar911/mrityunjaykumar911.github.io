import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePingPongTraces, loadPingPongContract, replaySpecification, TLA_PROTOCOL_VERSION, validateBinding } from './ping-pong-replay.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const JAR = path.join(ROOT, '.tools', 'tla2tools.jar');
const TLA_DIR = path.join(ROOT, '.tools', 'study-c', 'tla-oracle');
const SANY_TIMEOUT_MS = 30_000;
const TLC_TIMEOUT_MS = 45_000;
const MODULE = 'TaskSpec';

export function validatorHeapMb(value = process.env.STUDY_C_JVM_HEAP_MB ?? 512) {
  const heapMb = Number(value);
  if (!Number.isSafeInteger(heapMb) || heapMb < 64 || heapMb > 8192) throw new Error('invalid_validator_heap_mb');
  return heapMb;
}

async function exists(file) {
  try { await access(file, constants.F_OK); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Resolve a working Java: JAVA_HOME, then a bundled JDK under .tools/java, then PATH.
async function resolveJava(onProbe = () => {}) {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  const bundled = path.join(ROOT, '.tools', 'java');
  if (await exists(bundled)) {
    const stack = [bundled];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === exe && path.basename(dir) === 'bin') candidates.push(full);
      }
    }
  }
  candidates.push(exe);
  for (const java of [...new Set(candidates)]) {
    const started = Date.now();
    const probe = await runJava(java, ['-Xmx64m', '-XX:+UseSerialGC', '-version'], 15_000, ROOT);
    onProbe({ java, ...probe, elapsedMs: Date.now() - started });
    if (probe.status === 0 && !probe.signal) return java;
  }
  return null;
}

function runJava(java, args, timeout, cwd) {
  return new Promise((resolve) => {
    execFile(java, args, {
      cwd, encoding: 'utf8', windowsHide: true, timeout,
      killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => resolve({
      status: error ? error.code : 0,
      signal: error?.signal ?? null,
      output: `${stdout ?? ''}\n${stderr ?? ''}`,
      timedOut: error?.killed === true && error?.signal === 'SIGKILL',
    }));
  });
}

export function invariantNames(cfg) {
  const names = [];
  let collecting = false;
  for (const rawLine of String(cfg || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\\\*.*$/, '').trim();
    if (!line) continue;
    const header = /^INVARIANTS?\b\s*(.*)$/.exec(line);
    if (header) collecting = true;
    else if (/^[A-Z_]+\b/.test(line)) collecting = false;
    if (!collecting) continue;
    for (const name of (header ? header[1] : line).split(/\s+/).filter(Boolean)) {
      if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw new Error('invalid_invariant_name');
      names.push(name);
    }
  }
  return [...new Set(names)];
}

export async function validateSpec({ specDir, tla, cfg, java, runProcess = runJava, heapMb = validatorHeapMb() }) {
  heapMb = validatorHeapMb(heapMb);
  if (!tla) return { level: 'none', detail: 'no_tla_block' };
  try {
    if (!cfg || invariantNames(cfg).length === 0) return { level: 'none', detail: 'no_configured_invariants', failureKind: 'invalid_specification' };
  } catch {
    return { level: 'unparseable', detail: 'invalid_invariant_configuration', failureKind: 'invalid_specification' };
  }
  if (!(await exists(JAR))) return { level: 'unvalidated', detail: 'tla2tools_jar_missing' };
  await mkdir(specDir, { recursive: true });
  if (!java) {
    const probes = [];
    java = await resolveJava((probe) => probes.push(probe));
    await writeFile(path.join(specDir, 'java-probes.json'), `${JSON.stringify(probes, null, 2)}\n`, 'utf8');
    if (!java) return { level: 'unvalidated', detail: 'java_unavailable', failureKind: 'infrastructure', probes };
  }
  await writeFile(path.join(specDir, `${MODULE}.tla`), tla, 'utf8');
  if (cfg) await writeFile(path.join(specDir, `${MODULE}.cfg`), cfg, 'utf8');

  const sanyScratch = await mkdtemp(path.join(tmpdir(), 'study-c-sany-'));
  const tlcScratch = await mkdtemp(path.join(tmpdir(), 'study-c-tlc-'));
  const jvmArgs = (scratch) => [`-Djava.io.tmpdir=${scratch}`, `-Xmx${heapMb}m`, '-XX:+UseParallelGC'];
  await writeFile(path.join(specDir, 'execution.json'), `${JSON.stringify({
    startedAt: new Date().toISOString(), runnerPid: process.pid, sanyScratch, tlcScratch,
    sanyTimeoutMs: SANY_TIMEOUT_MS, tlcTimeoutMs: TLC_TIMEOUT_MS, heapMb,
  }, null, 2)}\n`, 'utf8');
  const crashed = (result) => Boolean(result.signal || (result.status !== 0 && typeof result.status !== 'number') ||
    /(?:java\.lang\.[\w$]*(?:Exception|Error)|Exception in thread|TLC threw an unexpected exception|Could not find or load main class)/.test(result.output));
  const sany = await runProcess(java, [...jvmArgs(sanyScratch), '-cp', JAR, 'tla2sany.SANY', `${MODULE}.tla`], SANY_TIMEOUT_MS, specDir);
  await writeFile(path.join(specDir, 'sany.log'), sany.output, 'utf8');
  if (sany.timedOut || crashed(sany)) return { level: 'unvalidated', detail: sany.timedOut ? 'sany_timeout' : 'sany_tool_failure', failureKind: 'infrastructure' };
  const parsed = sany.status === 0 && !sany.signal && !sany.timedOut &&
    /Semantic processing of module TaskSpec\b/.test(sany.output) && !/\b(?:error|errors|fatal)\b/i.test(sany.output);
  if (!parsed) return { level: 'unparseable', detail: 'sany_parse_error', failureKind: 'invalid_specification' };

  const tlc = await runProcess(java, [...jvmArgs(tlcScratch), '-cp', JAR, 'tlc2.TLC', '-config', `${MODULE}.cfg`,
    '-workers', '1', '-metadir', path.join(tlcScratch, 'states'), MODULE], TLC_TIMEOUT_MS, specDir);
  await writeFile(path.join(specDir, 'tlc.log'), tlc.output, 'utf8');
  if (tlc.timedOut) return { level: 'parsed', detail: 'tlc_timeout', failureKind: 'infrastructure' };
  if (/ConfigFileException|error in the configuration file/.test(tlc.output)) return { level: 'parsed', detail: 'tlc_configuration_error', failureKind: 'invalid_specification' };
  if (crashed(tlc)) return { level: 'parsed', detail: 'tlc_tool_failure', failureKind: 'infrastructure' };
  const violated = /Invariant\s+\S+\s+is violated/i.test(tlc.output);
  const distinctStates = Number([...tlc.output.matchAll(/([\d,]+) distinct states found/g)].at(-1)?.[1].replaceAll(',', ''));
  if (/Error:\s*Deadlock reached\./.test(tlc.output)) {
    return { level: 'parsed', detail: 'model_deadlock', failureKind: 'model_behavior', distinctStates,
      artifactFailure: false, diagnosticFile: path.join(specDir, 'tlc.log') };
  }
  const noError = tlc.status === 0 && !tlc.signal &&
    /Model checking completed\. No error has been found\./.test(tlc.output) && distinctStates > 0;
  if (violated) {
    const violatedInvariant = /Invariant\s+(\S+)\s+is violated/i.exec(tlc.output)?.[1];
    const counterexample = {};
    for (const name of ['scoreA', 'scoreB', 'step']) {
      const matches = [...tlc.output.matchAll(new RegExp(String.raw`/\\ ${name} = (-?\d+)`, 'g'))];
      const value = matches.at(-1)?.[1];
      if (value !== undefined) counterexample[name] = Number(value);
    }
    return { level: 'parsed', detail: 'invariant_violation', violatedInvariant, counterexample };
  }
  if (noError) return { level: 'checked', detail: 'invariants_hold_on_bounded_model', distinctStates };
  return { level: 'parsed', detail: 'tlc_inconclusive' };
}

export async function tlaCacheIdentity(html) {
  const { contractSha256 } = await loadPingPongContract();
  const sourceSha256 = createHash('sha256').update(html).digest('hex');
  return { protocolVersion: TLA_PROTOCOL_VERSION, contractSha256, sourceSha256,
    key: `${TLA_PROTOCOL_VERSION}-${contractSha256.slice(0, 16)}-${sourceSha256.slice(0, 16)}` };
}

export function verifiedTFeedback(feedback, identity) {
  return feedback?.ok === true && feedback.protocolVersion === identity.protocolVersion &&
    feedback.contractSha256 === identity.contractSha256 && feedback.sourceSha256 === identity.sourceSha256 &&
    feedback.validation?.level === 'checked' && feedback.replay?.complete === true;
}

export async function tlaArm({ task, artifact, client, repairPrompt, evidenceDir, binding, onProgress = () => {},
  validate = validateSpec, capture = capturePingPongTraces }) {
  const blocked = (reason, evidence = {}) => ({
    ...evidence, kind: 'tla', protocolVersion: TLA_PROTOCOL_VERSION, ok: false, reason, findings: '', repairPrompt: null,
  });
  if (String(task.id) !== '1097') return blocked('unsupported_formal_contract');
  const html = artifact.extracted.content;
  const identity = await tlaCacheIdentity(html);
  const contract = await loadPingPongContract();
  await mkdir(TLA_DIR, { recursive: true });
  evidenceDir ??= await mkdtemp(path.join(TLA_DIR, 'replay-1097-'));
  await mkdir(evidenceDir, { recursive: true });
  const evidence = { ...identity, evidenceDir };
  try {
    onProgress('T: validating the bounded scoring model');
    evidence.validation = await validate({ specDir: path.join(evidenceDir, 'model'), ...contract });
    if (evidence.validation.level !== 'checked') return blocked('formal_validation_failed', evidence);

    if (!binding) {
      onProgress('T: resolving browser selectors (not generating test verdicts)');
      const result = await client.generate({
        system: 'Return only JSON with CSS selectors scoreA, scoreB, pointA, pointB, and reset (an array of selectors to tap in order, including any reset confirmation). Map the two displayed numeric scores and their scoring controls. Selectors must match unique visible elements at the relevant step. Do not generate code, invariants, or advice. If a mapping is impossible return null.',
        prompt: html, maxOutputTokens: 1500, purpose: `tla-binding-${task.id}`,
      });
      if (!result.ok) return blocked('browser_binding_unavailable', evidence);
      const text = result.text.trim().replace(/^```json\s*\n([\s\S]*?)\n```$/, '$1');
      binding = JSON.parse(text);
    }
    binding = validateBinding(binding);
    await writeFile(path.join(evidenceDir, 'binding.json'), `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
    onProgress('T: executing mobile scoring traces, including extended deuce beyond 99');
    const traces = await capture({ html, binding, outDir: path.join(evidenceDir, 'browser') });
    if (traces.length === 0 || traces.some((trace) => trace.status !== 'recorded')) {
      return blocked('browser_replay_incomplete', { ...evidence, replay: { complete: false } });
    }
    const checkedTraces = [];
    const failures = [];
    for (const trace of traces) {
      onProgress(`T: checking observed trace ${trace.id} with TLC`);
      const check = await validate({ specDir: path.join(evidenceDir, `trace-${trace.id}`),
        ...replaySpecification({ ...contract, ...trace }) });
      checkedTraces.push({ id: trace.id, check });
      if (check.level === 'checked') continue;
      const expected = check.counterexample;
      if (check.violatedInvariant !== 'SnapshotMatches' || !Number.isInteger(expected?.step) ||
          !trace.snapshots[expected.step] || !Number.isInteger(expected.scoreA) || !Number.isInteger(expected.scoreB)) {
        return blocked('formal_replay_inconclusive', { ...evidence, replay: { complete: false, traces: checkedTraces } });
      }
      failures.push({ trace: trace.id, step: expected.step, actions: trace.actions.slice(0, expected.step),
        expected: { scoreA: expected.scoreA, scoreB: expected.scoreB }, observed: trace.snapshots[expected.step] });
    }
    const replay = { complete: true, traces: checkedTraces, failures };
    await writeFile(path.join(evidenceDir, 'replay.json'), `${JSON.stringify(replay, null, 2)}\n`, 'utf8');
    const findings = failures.length ? [
      'Executed mobile interactions disagreed with the TLC-checked scoring contract at these steps:',
      JSON.stringify(failures, null, 2),
      'A/B mean a point for the corresponding player. Reset means clear the match.',
      'Correct only the observed scoring failures. Exploration bounds are not application score limits; deuce has no fixed score cap.',
      'Preserve styling, layout, and unrelated behavior. Do not add speculative features or fixes.',
    ].join('\n') : 'No scoring violations were observed in the executed traces. This is bounded test evidence, not proof of the HTML implementation.';
    return { ...evidence, kind: 'tla', ok: true, replay, findings,
      repairPrompt: failures.length ? repairPrompt({ task, html, findings }) : null };
  } catch {
    return blocked('formal_or_browser_execution_failed', evidence);
  }
}
