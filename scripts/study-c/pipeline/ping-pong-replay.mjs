import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const TLA_PROTOCOL_VERSION = 'ping-pong-replay-v1';
const alternating = (count) => Array.from({ length: count }, () => ['A', 'B']).flat();
export const PING_PONG_TRACES = [
  { id: 'reset', actions: ['A', 'B', 'B', 'Reset', 'A'] },
  { id: 'regulation-A', actions: [...Array(11).fill('A'), 'B', 'A'] },
  { id: 'regulation-B', actions: [...Array(11).fill('B'), 'A', 'B'] },
  { id: 'deuce', actions: [...alternating(10), 'A', 'B', 'A', 'A', 'B'] },
  { id: 'extended-deuce', actions: [...alternating(100), 'A', 'A', 'B'] },
];

export async function loadPingPongContract() {
  const [tla, cfg] = await Promise.all([
    readFile(new URL('../../../formal/study-c/ping-pong/TaskSpec.tla', import.meta.url), 'utf8'),
    readFile(new URL('../../../formal/study-c/ping-pong/TaskSpec.cfg', import.meta.url), 'utf8'),
  ]);
  const contractSha256 = createHash('sha256').update(JSON.stringify({ tla, cfg, traces: PING_PONG_TRACES })).digest('hex');
  return { tla, cfg, contractSha256 };
}

export function validateBinding(binding) {
  const selector = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;
  if (!binding || !['scoreA', 'scoreB', 'pointA', 'pointB'].every((name) => selector(binding[name])) ||
      binding.scoreA === binding.scoreB || binding.pointA === binding.pointB ||
      !Array.isArray(binding.reset) || binding.reset.length < 1 || binding.reset.length > 3 || !binding.reset.every(selector)) {
    throw new Error('invalid_browser_binding');
  }
  return Object.fromEntries(['scoreA', 'scoreB', 'pointA', 'pointB', 'reset'].map((name) => [name, binding[name]]));
}

export function replaySpecification({ tla, cfg, actions, snapshots }) {
  if (!Array.isArray(actions) || actions.length > 1000 || actions.some((action) => !['A', 'B', 'Reset'].includes(action)) ||
      !Array.isArray(snapshots) || snapshots.length !== actions.length + 1 ||
      snapshots.some((snapshot) => !Number.isSafeInteger(snapshot.scoreA) || !Number.isSafeInteger(snapshot.scoreB))) {
    throw new Error('invalid_replay_trace');
  }
  const sequence = (values) => `<<${values.map((value) => JSON.stringify(value)).join(', ')}>>`;
  return {
    tla: tla.replace('ReplayActions == <<>>', `ReplayActions == ${sequence(actions)}`)
      .replace('ReplayObservedA == <<>>', `ReplayObservedA == ${sequence(snapshots.map((snapshot) => snapshot.scoreA))}`)
      .replace('ReplayObservedB == <<>>', `ReplayObservedB == ${sequence(snapshots.map((snapshot) => snapshot.scoreB))}`),
    cfg: cfg.replace('Replay = FALSE', 'Replay = TRUE'),
  };
}

async function uniqueVisible(page, selector) {
  const locator = page.locator(selector);
  if (await locator.count() !== 1 || !await locator.isVisible()) throw new Error('unresolved_browser_binding');
  return locator;
}

async function scores(page, binding) {
  const result = {};
  for (const name of ['scoreA', 'scoreB']) {
    const locator = await uniqueVisible(page, binding[name]);
    const text = (await locator.innerText()).trim();
    if (!/^-?\d{1,9}$/.test(text)) throw new Error('non_numeric_score_binding');
    result[name] = Number(text);
  }
  return result;
}

export async function capturePingPongTraces({ html, binding, outDir, traces = PING_PONG_TRACES }) {
  binding = validateBinding(binding);
  await mkdir(outDir, { recursive: true });
  const htmlPath = path.join(outDir, 'artifact.html');
  await writeFile(htmlPath, html, 'utf8');
  const artifactUrl = pathToFileURL(htmlPath).href;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const trace of traces) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
      const snapshots = [];
      try {
        await context.route('**/*', (route) => route.request().url() === artifactUrl && route.request().isNavigationRequest()
          ? route.continue() : route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(3000);
        page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
        await page.goto(artifactUrl, { waitUntil: 'load', timeout: 10_000 });
        await uniqueVisible(page, binding.pointA);
        await uniqueVisible(page, binding.pointB);
        snapshots.push(await scores(page, binding));
        for (const action of trace.actions) {
          const selectors = action === 'Reset' ? binding.reset : [binding[action === 'A' ? 'pointA' : 'pointB']];
          for (const selector of selectors) {
            const control = await uniqueVisible(page, selector);
            if (await control.isEnabled()) await control.tap();
          }
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          snapshots.push(await scores(page, binding));
        }
        results.push({ id: trace.id, actions: trace.actions, snapshots, status: 'recorded' });
      } catch {
        results.push({ id: trace.id, actions: trace.actions, snapshots, status: 'blocked', reason: 'browser_trace_incomplete' });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(outDir, 'observations.json'), `${JSON.stringify({ binding, traces: results }, null, 2)}\n`, 'utf8');
  return results;
}