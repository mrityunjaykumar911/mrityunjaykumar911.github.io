// Deterministic rendering + screenshot capture, matching the pinned
// ArtifactsBench src/utils.py convention: headless Chromium, file:// load,
// wait for networkidle, then N full-page screenshots at a fixed interval.
// Additionally records console/page errors so the browser arm has real
// runtime feedback. Executes only the model-produced artifact locally.
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function renderAndCapture({ html, outDir, index, count = 3, interval = 1000, viewport, offline = false }) {
  await mkdir(outDir, { recursive: true });
  const htmlPath = path.join(outDir, `html_${index}.html`);
  await writeFile(htmlPath, html, 'utf8');

  const observations = { consoleErrors: [], pageErrors: [], requestFailures: [], rendered: false };
  const imagePaths = [];
  const imageBuffers = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...(viewport ? { viewport } : {}), ...(offline ? { serviceWorkers: 'block' } : {}) });
    if (offline) await context.route('**/*', (route) => /^file:/.test(route.request().url()) && route.request().isNavigationRequest() ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.on('console', (msg) => { if (msg.type() === 'error') observations.consoleErrors.push(msg.text().slice(0, 500)); });
    page.on('pageerror', (err) => observations.pageErrors.push(String(err?.message ?? err).slice(0, 500)));
    page.on('requestfailed', (req) => observations.requestFailures.push(`${req.method()} ${req.url()}`.slice(0, 300)));
    try {
      await page.goto(`file://${htmlPath.replace(/\\/g, '/')}`, { timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      observations.rendered = true;
      observations.domStats = await page.evaluate(() => ({
        buttons: document.querySelectorAll('button').length,
        inputs: document.querySelectorAll('input,textarea,select').length,
        elements: document.querySelectorAll('*').length,
        bodyText: (document.body?.innerText || '').slice(0, 400),
      })).catch(() => null);
      for (let i = 0; i < count; i++) {
        const p = path.join(outDir, `screenshot_${index}_${i + 1}.png`);
        const buffer = await page.screenshot({ path: p, fullPage: true, timeout: 60_000 });
        imagePaths.push(p);
        imageBuffers.push(buffer);
        if (i < count - 1) await page.waitForTimeout(interval);
      }
    } finally {
      await context.close();
    }
  } catch (error) {
    observations.captureError = String(error?.message ?? error).slice(0, 500);
  } finally {
    await browser.close();
  }
  return { htmlPath, imagePaths, imageBuffers, observations };
}
