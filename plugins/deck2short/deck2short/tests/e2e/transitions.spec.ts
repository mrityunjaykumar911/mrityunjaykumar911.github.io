import {test, expect, type Page} from '@playwright/test';

/**
 * These assertions exist because every one of them corresponds to a bug that
 * shipped and had to be caught by eye:
 *
 *   overlap           captions were laid over centred content
 *   transitionOverlap "transitions" were a 90ms opacity fade on one layer
 *   imagesReal        a portrait beat rendered a placeholder for three revisions
 *   motionPresent     frames sat completely static after content landed
 *
 * Reading the source proves none of these. They are properties of the laid-out
 * DOM at a specific instant, which is what the seek/probe hooks expose.
 */

const SAMPLE_HZ = 12;

type Rect = {x: number; y: number; w: number; h: number} | null;
type Probe = Awaited<ReturnType<typeof probe>>;

async function seek(page: Page, t: number) {
  await page.evaluate((tt) => (window as any).__d2s.seek(tt), t);
}
async function probe(page: Page) {
  return page.evaluate(() => (window as any).__d2s.probe());
}
async function meta(page: Page) {
  return page.evaluate(() => ({
    total: (window as any).__d2s.total,
    beats: (window as any).__d2s.beats,
    transitionS: (window as any).__d2s.transitionS,
  }));
}

function intersects(a: Rect, b: Rect, tolerance = 0.005): boolean {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w - tolerance &&
    b.x < a.x + a.w - tolerance &&
    a.y < b.y + b.h - tolerance &&
    b.y < a.y + a.h - tolerance
  );
}

function srgbToLin(c: number) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(rgb: string): number {
  const m = rgb.match(/\d+(\.\d+)?/g)!.map(Number);
  return 0.2126 * srgbToLin(m[0]) + 0.7152 * srgbToLin(m[1]) + 0.0722 * srgbToLin(m[2]);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test.beforeEach(async ({page}) => {
  await page.goto('/storyboard.html');
  await page.waitForFunction(() => (window as any).__d2s !== undefined);
});

test('captions never overlap beat content', async ({page}) => {
  const {total} = await meta(page);
  const failures: string[] = [];
  for (let t = 0; t < total; t += 1 / SAMPLE_HZ) {
    await seek(page, t);
    const p: Probe = await probe(page);
    if (p.caption.opacity < 0.05 || !p.caption.text) continue;
    const content = p.layers[p.front].content;
    if (intersects(content, p.caption.rect)) {
      failures.push(`t=${t.toFixed(2)}s beat=${p.beat}`);
    }
  }
  expect(failures, `caption band intersects content at:\n${failures.join('\n')}`).toEqual([]);
});

test('every cut is a genuine overlap, not a fade on one layer', async ({page}) => {
  const {beats, transitionS} = await meta(page);
  for (const b of beats.slice(1)) {
    if (b.transition === 'cut') continue;
    let overlapping = 0;
    const step = 1 / 30;
    for (let t = b.start; t < b.start + transitionS; t += step) {
      await seek(page, t);
      const p: Probe = await probe(page);
      const lit = p.layers.filter((l: any) => l.visible && l.opacity > 0.05);
      if (lit.length >= 2) overlapping += step;
    }
    // Both frames must be simultaneously visible for most of the declared
    // transition. A crossfade that only ever shows one layer is a cut.
    expect(overlapping, `beat ${b.id} (${b.transition}) overlapped only ${overlapping.toFixed(2)}s`)
      .toBeGreaterThan(transitionS * 0.6);
  }
});

test('the outgoing frame keeps moving through the transition', async ({page}) => {
  const {beats, transitionS} = await meta(page);
  const b = beats.find((x: any) => x.transition !== 'cut')!;
  const seen = new Set<string>();
  for (let t = b.start; t < b.start + transitionS * 0.8; t += transitionS / 8) {
    await seek(page, t);
    const p: Probe = await probe(page);
    seen.add(p.layers[1 - p.front].transform);
  }
  // A frozen outgoing layer is the difference between a dissolve and a
  // crossfade between two stills.
  expect(seen.size, 'outgoing layer transform never changed').toBeGreaterThan(3);
});

test('no frame is ever completely static', async ({page}) => {
  const {beats} = await meta(page);
  for (const b of beats) {
    const mid = b.start + b.dur / 2;
    await seek(page, mid);
    const a: Probe = await probe(page);
    await seek(page, mid + 0.25);
    const c: Probe = await probe(page);
    expect(
      a.layers[a.front].transform !== c.layers[c.front].transform ||
        a.layers[a.front].content?.y !== c.layers[c.front].content?.y,
      `beat ${b.id} is frozen at its midpoint`
    ).toBeTruthy();
  }
});

test('image beats render real pixels, not the placeholder', async ({page}) => {
  const {beats} = await meta(page);
  for (const b of beats.filter((x: any) => x.kind === 'image')) {
    await seek(page, b.start + b.dur / 2);
    const p: Probe = await probe(page);
    expect(p.images.length, `beat ${b.id} has no <img>`).toBeGreaterThan(0);
    for (const im of p.images) {
      expect(im.naturalWidth, `beat ${b.id}: image failed to decode`).toBeGreaterThan(0);
      expect(im.isPlaceholder, `beat ${b.id}: still showing the fallback card`).toBe(false);
    }
  }
});

test('captions stay legible: size and contrast', async ({page}) => {
  const {beats} = await meta(page);
  for (const b of beats) {
    await seek(page, b.start + b.dur / 2);
    const p: Probe = await probe(page);
    if (!p.caption.text) continue;
    // Normalised to the 1080px-wide composition.
    const px = (p.caption.fontSizePx / p.frame.w) * 1080;
    expect(px, `beat ${b.id}: caption ${px.toFixed(0)}px is too small at 1080 wide`)
      .toBeGreaterThan(38);
    expect(
      contrast(p.caption.color, p.ground),
      `beat ${b.id}: caption contrast too low`
    ).toBeGreaterThan(4.5);
  }
});

test('nothing crosses into the platform UI zone', async ({page}) => {
  const {beats} = await meta(page);
  for (const b of beats) {
    await seek(page, b.start + b.dur / 2);
    const p: Probe = await probe(page);
    for (const r of [p.layers[p.front].content, p.caption.rect]) {
      if (!r) continue;
      expect(r.y + r.h, `beat ${b.id}: content reaches into the bottom safe zone`)
        .toBeLessThan(0.80);
    }
  }
});

test('visual regression at each beat midpoint', async ({page}) => {
  const {beats} = await meta(page);
  for (const b of beats) {
    await seek(page, b.start + b.dur / 2);
    await expect(page.locator('#frame')).toHaveScreenshot(`${b.id}-${b.kind}.png`, {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  }
});
