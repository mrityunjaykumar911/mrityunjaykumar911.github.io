import { expect, test } from '@playwright/test';
import { deterministicVisualIssues, evaluateVisualVqa } from '../../scripts/visual-vqa.mjs';

const keyFile = process.env.METHOD_VQA_KEY_FILE;
const captureOnly = process.env.METHOD_VQA_CAPTURE_ONLY === '1';
if (!keyFile && !captureOnly) throw new Error('METHOD_VQA_KEY_FILE is required for the opt-in generative VQA test');

const views = [
  { id: 'ultrawide', width: 3440, height: 1440, selector: null },
  { id: 'wide-short', width: 1920, height: 768, selector: null },
  { id: 'desktop', width: 1440, height: 900, selector: null },
  { id: 'mobile', width: 390, height: 844, selector: null },
  { id: 'studies', width: 1440, height: 900, selector: '#case-studies' },
] as const;

test('captures required views and generative VQA rejects weak visual quality', async ({ browser }, testInfo) => {
  const images: Array<{ id: string; buffer: Buffer }> = [];
  const measurements: Record<string, unknown> = {};
  const baseURL = String(testInfo.project.use.baseURL);
  const allowedOrigin = new URL(baseURL).origin;
  for (const view of views) {
    const context = await browser.newContext({ baseURL, viewport: { width: view.width, height: view.height }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(allowedOrigin) || url.startsWith('data:') ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto('/method.html', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    if (view.selector) await page.locator(view.selector).scrollIntoViewIfNeeded();
    measurements[view.id] = await page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
          rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
      };
      const text = [...document.querySelectorAll('body *')].filter((element) => visible(element) &&
        [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()));
      const fontSizes = text.map((element) => parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
      const substantiveFontSizes = text.filter((element) => (element.textContent?.trim().length ?? 0) >= 24 &&
        !element.matches('.eyebrow, .mono-label, .study-verdict, dt') && !element.closest('.method-header, .method-nav, footer'))
        .map((element) => parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
      const hero = document.querySelector('.method-hero')?.getBoundingClientRect();
      const copy = document.querySelector('.hero-copy')?.getBoundingClientRect();
      const system = document.querySelector('.hero-system')?.getBoundingClientRect();
      const narrativeRight = Math.max(...[...document.querySelectorAll('.hero-copy > *')]
        .map((element) => element.getBoundingClientRect().right));
      const headerStyle = getComputedStyle(document.querySelector('.method-header')!);
      const titlePx = parseFloat(getComputedStyle(document.querySelector('#method-title')!).fontSize);
      const ledePx = parseFloat(getComputedStyle(document.querySelector('.hero-lede')!).fontSize);
      const systemCopyPx = parseFloat(getComputedStyle(document.querySelector('.hero-system small')!).fontSize);
      return { viewport: { width: innerWidth, height: innerHeight }, pageHeight: document.body.scrollHeight,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        minimumTextPx: Math.min(...fontSizes), textBelow14Px: fontSizes.filter((size) => size < 14).length,
        substantiveTextBelow14Px: substantiveFontSizes.filter((size) => size < 14).length,
        headerBorderBottomPx: parseFloat(headerStyle.borderBottomWidth),
        hero: hero ? { height: Math.round(hero.height), viewportShare: Number((hero.height / innerHeight).toFixed(2)),
          contentShare: copy && system ? Number(((system.right - copy.left) / innerWidth).toFixed(2)) : 0,
          columnGapShare: system ? Number(((system.left - narrativeRight) / innerWidth).toFixed(2)) : 0,
          titlePx, ledePx, systemCopyPx } : null };
    });
    expect((measurements[view.id] as { horizontalOverflow: number }).horizontalOverflow, `${view.id} horizontal overflow`).toBeLessThanOrEqual(1);
    const buffer = await page.screenshot({ fullPage: false, animations: 'disabled', caret: 'hide' });
    images.push({ id: view.id, buffer });
    await testInfo.attach(`${view.id}-${view.width}x${view.height}`, { body: buffer, contentType: 'image/png' });
    await context.close();
  }
  expect(images.map(({ id }) => id)).toEqual(['ultrawide', 'wide-short', 'desktop', 'mobile', 'studies']);
  const preflightIssues = deterministicVisualIssues(measurements);
  await testInfo.attach('deterministic-preflight', { body: Buffer.from(JSON.stringify(preflightIssues, null, 2)), contentType: 'application/json' });
  if (preflightIssues.length) {
    const findings = preflightIssues.map(({ severity, view, evidence }) => `- ${severity} [${view}]: ${evidence}`).join('\n');
    throw new Error(`Deterministic visual preflight failed before generative VQA.\nproviderCalls=0\n${findings}\nScreenshots and measurements are attached to the Playwright report.`);
  }
  if (captureOnly) {
    await testInfo.attach('capture-measurements', { body: Buffer.from(JSON.stringify(measurements, null, 2)), contentType: 'application/json' });
    return;
  }
  const report = await evaluateVisualVqa({ images, measurements, outputDir: testInfo.outputPath('generative-vqa'), keyFile: keyFile! });
  await testInfo.attach('generative-vqa-report', { body: Buffer.from(JSON.stringify(report, null, 2)), contentType: 'application/json' });
  expect(report.verdictConsistent, JSON.stringify(report, null, 2)).toBe(true);
  expect(report.passed, JSON.stringify(report, null, 2)).toBe(true);
});