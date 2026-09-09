import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

async function testFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await testFiles(filename));
    else if (entry.name.endsWith('.test.mjs')) files.push(filename);
  }
  return files;
}

const root = fileURLToPath(new URL('.', import.meta.url));
const files = (await testFiles(root)).sort();
if (!files.length) throw new Error('study_c_tests_not_found');

const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...files], {
  stdio: 'inherit',
  env: { ...process.env, STUDY_C_JVM_HEAP_MB: process.env.STUDY_C_JVM_HEAP_MB ?? '1024' },
});
child.on('error', (error) => { throw error; });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});