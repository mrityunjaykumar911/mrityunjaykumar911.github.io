import { access, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DEFAULT_OUTPUT = path.join(ROOT, '.tools', 'study-c', 'verification');
const JAR = path.join(ROOT, '.tools', 'tla2tools.jar');
// TLA+ tools release v1.7.4 identifies its embedded TLC as Version 2.19.
const TLC_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const TIMEOUT_MS = 120_000;
const FACT_NAMES = Object.freeze([
  'checksPassed', 'inventoryComplete', 'revisionMatches', 'policyMatches',
  'attemptMatches', 'notCancelled', 'notReleased', 'ticketMatches',
]);
const MODELS = [
  { name: 'catalog', module: 'GateCatalog', expectedInvariant: 'CatalogWellTyped', dump: true },
  { name: 'safe', module: 'ReleaseGate', expectedInvariant: 'ReleaseSafe', dump: true },
  ...['artifact', 'policy', 'attempt', 'inventory', 'cancellation', 'duplicate', 'ticket']
    .map((mutation) => ({
      name: `mutant-${mutation}`, module: 'ReleaseGate',
      expectedInvariant: 'ReleaseSafe', expectViolation: true,
    })),
];
const SOURCES = [
  'formal/agent/GateCatalog.tla', 'formal/agent/ReleaseGate.tla',
  ...MODELS.map(({ name }) => `formal/agent/${name}.cfg`),
  'scripts/study-c/tlc.mjs',
];

async function exists(filename) {
  try {
    await access(filename, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function sha256(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

async function hashSources() {
  const hashes = {};
  for (const source of SOURCES) hashes[source] = await sha256(path.join(ROOT, source));
  return hashes;
}

async function portableJava(directory) {
  if (!(await exists(directory))) return [];
  const results = [];
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await portableJava(filename));
    else if (entry.name === executable && path.basename(directory) === 'bin') {
      results.push(filename);
    }
  }
  return results;
}

// Intentionally serial, shell-free, bounded spawn commands. The public API is
// async for filesystem operations; TLC itself blocks this Node thread while
// spawnSync runs. No network, installation, workload, or site operations occur.
async function runProcess(command, args, outputDir, name) {
  const start = performance.now();
  const child = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 32 * 1024 * 1024,
  });
  const elapsedMs = Math.round(performance.now() - start);
  const execution = {
    command, args, status: child.status, signal: child.signal,
    error: child.error ? { code: child.error.code, message: child.error.message } : null,
    timeoutMs: TIMEOUT_MS, elapsedMs,
  };
  const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
  await writeFile(path.join(outputDir, `${name}.log`),
    `${JSON.stringify(execution, null, 2)}\n--- stdout ---\n${child.stdout ?? ''}` +
    `\n--- stderr ---\n${child.stderr ?? ''}`, 'utf8');
  return { ...execution, output };
}

async function resolveJava(outputDir) {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', executable));
  }
  candidates.push(...await portableJava(path.join(ROOT, '.tools', 'java')), 'java');
  let index = 0;
  for (const java of [...new Set(candidates)]) {
    const result = await runProcess(java, ['-version'], outputDir, `java-${index++}`);
    const version = result.output.split(/\r?\n/)
      .find((line) => /^(?:openjdk|java) (?:version |\d)/i.test(line.trim()));
    if (!result.error && !result.signal && result.status === 0 && version) {
      return { java, javaVersion: version.trim() };
    }
  }
  throw new Error('No working Java in JAVA_HOME, recursive .tools/java, or PATH; see java-*.log.');
}

function stateCount(output) {
  const matches = [...output.matchAll(/([\d,]+) distinct states found\b/g)];
  const count = Number(matches.at(-1)?.[1].replaceAll(',', ''));
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error('Missing or invalid TLC distinct-state count.');
  }
  return count;
}

// TLC v1.7.4 CLI help documents "-dump file" as the plain-text format.
// Do not assume JSON dump support. Parse complete states, then their top-level
// assignments; unknown syntax, duplicate variables, and partial dumps fail shut.
function parseTextDump(text) {
  const headers = [...text.matchAll(/^State (\d+):[^\r\n]*\r?$/gm)];
  if (!headers.length || text.slice(0, headers[0].index).trim()) {
    throw new Error('Unrecognized TLC text dump header.');
  }
  return headers.map((header, index) => {
    if (Number(header[1]) !== index + 1) throw new Error('Nonsequential TLC dump state IDs.');
    const body = text.slice(header.index + header[0].length,
      headers[index + 1]?.index ?? text.length).trim();
    const assignments = [...body.matchAll(/^\/\\ (\w+) = /gm)];
    if (!assignments.length || body.slice(0, assignments[0].index).trim()) {
      throw new Error('Unrecognized TLC state assignment.');
    }
    const values = {};
    for (let i = 0; i < assignments.length; i++) {
      const match = assignments[i];
      if (Object.hasOwn(values, match[1])) throw new Error('Duplicate TLC state variable.');
      values[match[1]] = body.slice(match.index + match[0].length,
        assignments[i + 1]?.index ?? body.length).trim();
    }
    return { id: index + 1, body, values };
  });
}

function catalogTable(states, distinctStates) {
  if (states.length !== 256 || distinctStates !== 256) {
    throw new Error(`Catalog must contain 256 states; dump=${states.length}, TLC=${distinctStates}.`);
  }
  const keys = new Set();
  const allowedKeys = [];
  for (const { values } of states) {
    if (Object.keys(values).length !== 9 ||
        [...FACT_NAMES, 'allowed'].some((name) => !/^(TRUE|FALSE)$/.test(values[name] ?? ''))) {
      throw new Error('Catalog state does not contain exactly the eight Boolean facts and allowed.');
    }
    const key = FACT_NAMES.map((name) => values[name] === 'TRUE' ? '1' : '0').join('');
    if (keys.has(key)) throw new Error(`Duplicate catalog valuation: ${key}.`);
    keys.add(key);
    const allowed = values.allowed === 'TRUE';
    // This assertion validates the catalog contract; decisions are extracted
    // from TLC's "allowed" variable, never generated by JavaScript enumeration.
    if (allowed !== [...key].every((bit) => bit === '1')) {
      throw new Error(`TLC catalog decision disagrees with conjunction for ${key}.`);
    }
    if (allowed) allowedKeys.push(key);
  }
  if (allowedKeys.length !== 1) throw new Error('Unexpected number of allowed gate keys.');
  return allowedKeys.sort();
}

async function checkModel(java, model, outputDir) {
  const dumpPath = path.join(outputDir, `${model.name}.dump`);
  const metadata = path.join(outputDir, 'states', model.name);
  await mkdir(metadata, { recursive: true });
  if (model.dump) await rm(dumpPath, { force: true });
  const args = [
    '-Xmx512m', '-XX:+UseParallelGC', '-cp', JAR, 'tlc2.TLC',
    '-workers', '1', '-fp', '0', '-fpmem', '0.1',
    '-metadir', metadata,
    '-config', path.join(ROOT, 'formal', 'agent', `${model.name}.cfg`),
    ...(model.dump ? ['-dump', dumpPath] : []),
    path.join(ROOT, 'formal', 'agent', `${model.module}.tla`),
  ];
  const result = await runProcess(java, args, outputDir, model.name);
  const errors = [...result.output.matchAll(/^Error: (.+)$/gm)].map((match) => match[1].trim());
  const violation = `Invariant ${model.expectedInvariant} is violated.`;
  const success = result.output.includes('Model checking completed. No error has been found.');
  // TLC EC.ExitStatus.VIOLATION_SAFETY = 12. A parse error, timeout, other
  // invariant violation, missing trace, or arbitrary nonzero status is NOT a
  // successful mutation test. All outcomes must be known and exact.
  const expected = model.expectViolation
    ? result.status === 12 && !success && errors.length === 2 &&
      errors[0] === violation && errors[1] === 'The behavior up to this point is:' &&
      /^State \d+: <Commit\b/m.test(result.output)
    : result.status === 0 && success && errors.length === 0 && /0 states left on queue\./.test(result.output);
  if (result.error || result.signal || !expected || !/^Finished in /m.test(result.output)) {
    throw new Error(`Unexpected TLC outcome for ${model.name} (status=${result.status}, ` +
      `signal=${result.signal}, error=${result.error?.message ?? 'none'}); see ${model.name}.log.`);
  }
  const distinctStates = stateCount(result.output);
  const states = model.dump ? parseTextDump(await readFile(dumpPath, 'utf8')) : null;
  if (states && states.length !== distinctStates) {
    throw new Error(`TLC dump/count mismatch for ${model.name}.`);
  }
  return {
    check: {
      name: model.name, expectedInvariant: model.expectedInvariant,
      passed: true, distinctStates, elapsedMs: result.elapsedMs,
    },
    states,
  };
}

/**
 * Check the bounded temporal model plus seven single-guard mutants and derive
 * the commit-time table from TLC's 256-state catalog. `passed` means the
 * EXPECTED outcome: catalog/safe hold; every mutant violates ReleaseSafe with
 * an actual Commit trace. `expectedInvariant` names the invariant being tested,
 * not a claim that it holds for a mutant. Timings are per TLC process in ms.
 *
 * Returns exactly {schemaVersion, factNames, allowedKeys, catalogStates,
 * modelChecks, sourceHashes, tools, generatedAt}. It never returns a partial
 * table: all unknown/error outcomes reject, remove a stale gate first, and
 * publish gate.json atomically only after checks and reachability inspection.
 * A lock prevents concurrent verification into the same output directory.
 *
 * Scope: the finite action/ID bounds in ReleaseGate, eight Boolean facts, and
 * TLC's fingerprint-based exploration. This is not an unbounded proof or a
 * verification of the host's fact extraction/atomic commit implementation.
 * Importing this module has no execution or filesystem side effects.
 */
export async function verifyModels({ outputDir = DEFAULT_OUTPUT } = {}) {
  if (typeof outputDir !== 'string' || !outputDir.trim()) {
    throw new TypeError('outputDir must be a nonempty filesystem path.');
  }
  outputDir = path.resolve(outputDir);
  await mkdir(outputDir, { recursive: true });
  const lockPath = path.join(outputDir, '.verification.lock');
  const lock = await open(lockPath, 'wx');
  const gatePath = path.join(outputDir, 'gate.json');
  const tempPath = path.join(outputDir, 'gate.json.tmp');
  try {
    await rm(gatePath, { force: true });
    await rm(tempPath, { force: true });
    const tlcSha256 = await sha256(JAR);
    if (tlcSha256 !== TLC_SHA256) {
      throw new Error(`Pinned TLC v1.7.4 SHA256 mismatch: expected ${TLC_SHA256}, got ${tlcSha256}.`);
    }
    const sourceHashes = await hashSources();
    const { java, javaVersion } = await resolveJava(outputDir);
    const modelChecks = [];
    let allowedKeys;
    let catalogStates;
    for (const model of MODELS) {
      const { check, states } = await checkModel(java, model, outputDir);
      modelChecks.push(check);
      if (model.name === 'catalog') {
        allowedKeys = catalogTable(states, check.distinctStates);
        catalogStates = states.length;
      }
      if (model.name === 'safe') {
        const witness = states.find(({ values }) => /^<<\s*\[/.test(values.publications ?? ''));
        if (!witness) throw new Error('Safe model has no reachable valid release; refusing vacuous safety.');
        await writeFile(path.join(outputDir, 'safe-release-witness.txt'),
          `Reachable safe dump state ${witness.id}; ReleaseSafe holds for every explored state.\n` +
          `${witness.body}\n`, 'utf8');
      }
    }
    if (modelChecks.length !== 9 || !allowedKeys || catalogStates !== 256) {
      throw new Error('Incomplete verification; no gate table may be published.');
    }
    if (JSON.stringify(await hashSources()) !== JSON.stringify(sourceHashes) ||
        await sha256(JAR) !== tlcSha256) {
      throw new Error('Model, config, helper, or TLC JAR changed during verification.');
    }
    const result = {
      schemaVersion: 1,
      factNames: [...FACT_NAMES],
      allowedKeys,
      catalogStates,
      modelChecks,
      sourceHashes,
      tools: { tlcSha256, javaVersion },
      generatedAt: new Date().toISOString(),
    };
    await writeFile(tempPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await rename(tempPath, gatePath);
    return result;
  } finally {
    await rm(tempPath, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let outputDir = DEFAULT_OUTPUT;
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--output-dir') {
        throw new Error('Usage: node scripts/study-c/tlc.mjs [--output-dir <directory>]');
      }
      outputDir = args[1];
    }
    const result = await verifyModels({ outputDir });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`[study-c/tlc] ${error.message}\n`);
    process.exitCode = 1;
  }
}