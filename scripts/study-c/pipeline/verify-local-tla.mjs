import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tlaArm } from './tla-oracle.mjs';

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`missing_${name.slice(2)}`);
    return path.resolve(args[index + 1]);
  };
  const artifactPath = option('--artifact');
  const bindingPath = option('--binding');
  const evidenceDir = option('--output');
  const html = await readFile(artifactPath, 'utf8');
  const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
  const report = await tlaArm({
    task: { id: 1097, prompt: 'Create a ping pong score counter in HTML that can run on mobile devices.' },
    artifact: { extracted: { content: html } },
    client: { generate: () => { throw new Error('network_calls_disabled'); } },
    repairPrompt: ({ findings }) => findings,
    evidenceDir, binding,
    onProgress: (message) => process.stderr.write(`[${new Date().toISOString()}] ${message}\n`),
  });
  await writeFile(path.join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: report.ok, reason: report.reason, validation: report.validation,
    traces: report.replay?.traces, failures: report.replay?.failures,
    reportPath: path.join(evidenceDir, 'report.json'),
  }, null, 2));
  process.exitCode = !report.ok ? 1 : report.replay.failures.length ? 2 : 0;
}

main().catch(() => {
  console.error(`[${new Date().toISOString()}] local_verification_failed`);
  process.exitCode = 1;
});