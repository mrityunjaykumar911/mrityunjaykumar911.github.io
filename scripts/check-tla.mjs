import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { enumerateAdmissible } from './visual-model.mjs';

const root = process.cwd();
const toolsDir = path.join(root, '.tools');
const jarPath = process.env.TLA_TOOLS_JAR || path.join(toolsDir, 'tla2tools.jar');
const tlaToolsUrl = 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar';
const tlaToolsSha256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findPortableJava(directory) {
  if (!(await exists(directory))) return null;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const result = await findPortableJava(entryPath);
      if (result) return result;
    } else if (entry.name === (process.platform === 'win32' ? 'java.exe' : 'java')) {
      if (path.basename(path.dirname(entryPath)) === 'bin') return entryPath;
    }
  }
  return null;
}

async function resolveJava() {
  if (process.env.JAVA_HOME) {
    const candidate = path.join(
      process.env.JAVA_HOME,
      'bin',
      process.platform === 'win32' ? 'java.exe' : 'java'
    );
    if (await exists(candidate)) return candidate;
  }

  const portable = await findPortableJava(path.join(toolsDir, 'java'));
  if (portable) return portable;

  const probe = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (!probe.error) return 'java';

  throw new Error('Java 17+ is required. Set JAVA_HOME or install a JRE.');
}

async function ensureTlaTools() {
  if (!(await exists(jarPath))) {
    await mkdir(path.dirname(jarPath), { recursive: true });
    const response = await fetch(tlaToolsUrl);
    if (!response.ok) {
      throw new Error(`Could not download TLC: ${response.status} ${response.statusText}`);
    }
    await writeFile(jarPath, Buffer.from(await response.arrayBuffer()));
  }

  const digest = createHash('sha256').update(await readFile(jarPath)).digest('hex');
  if (digest !== tlaToolsSha256) {
    throw new Error(`TLC checksum mismatch: expected ${tlaToolsSha256}, received ${digest}`);
  }
}

function runModel(java, module, config, expectedInvariant = null) {
  const modelName = `${module}-${path.basename(config, '.cfg')}`;
  const stateDir = path.join(toolsDir, 'tlc-states', modelName);
  const result = spawnSync(java, [
    '-XX:+UseParallelGC',
    '-cp',
    jarPath,
    'tlc2.TLC',
    '-workers',
    '1',
    '-nowarning',
    '-metadir',
    stateDir,
    '-config',
    path.join('formal', config),
    path.join('formal', `${module}.tla`),
  ], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const distinctStates = Number(output.match(/(\d+) distinct states found/)?.[1] ?? NaN);

  if (expectedInvariant === null) {
    if (result.status !== 0 || !output.includes('No error has been found')) {
      process.stderr.write(output);
      throw new Error(`Safe TLA+ model ${module}/${config} did not pass.`);
    }
    console.log(`[tla] ${module}/${config} passed (${distinctStates} distinct states)`);
    return distinctStates;
  }

  const expectedMessage = `Invariant ${expectedInvariant} is violated`;
  if (result.status === 0 || !output.includes(expectedMessage)) {
    process.stderr.write(output);
    throw new Error(`${module}/${config} did not expose ${expectedInvariant}.`);
  }
  console.log(`[tla] ${module}/${config} rejected by ${expectedInvariant}`);
  return distinctStates;
}

await ensureTlaTools();
const java = await resolveJava();

runModel(java, 'ResumePublication', 'safe.cfg');
runModel(java, 'ResumePublication', 'mutant-private.cfg', 'NoPrivateInProduction');
runModel(java, 'ResumePublication', 'mutant-index.cfg', 'PreviewIsNoIndex');
runModel(java, 'ResumePublication', 'mutant-deploy.cfg', 'DeployRequiresValidatedBuild');

const visualStates = runModel(java, 'VisualVariant', 'visual-safe.cfg');
runModel(java, 'VisualVariant', 'visual-mutant.cfg', 'Admissible');

const admissibleCount = enumerateAdmissible().length;
if (visualStates !== admissibleCount) {
  throw new Error(
    `Refinement mismatch: TLC reached ${visualStates} admissible states, ` +
      `optimizer enumerates ${admissibleCount}.`
  );
}
console.log(`[tla] optimizer feasible region agrees with TLC (${admissibleCount} states)`);
console.log('[tla] safe models and mutation checks passed');
