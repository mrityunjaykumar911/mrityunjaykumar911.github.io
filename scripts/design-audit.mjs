import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4173/';
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);
const band = 720;
const outDir = 'test-results';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(base, { waitUntil: 'networkidle' });
// Ensure reveal content is shown and lazy content settled.
await page.evaluate(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  for (let y = 0; y < document.body.scrollHeight; y += 400) {
    document.documentElement.scrollTop = y;
    await new Promise((r) => setTimeout(r, 30));
  }
  document.documentElement.scrollTop = 0;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
await page.waitForTimeout(200);

const audit = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const isVisible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    if (el.closest('details:not([open])')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const hasOwnText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
  const label = (el) =>
    el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');

  const textEls = [...document.querySelectorAll('body *')].filter(
    (el) => isVisible(el) && hasOwnText(el)
  );

  const smallText = textEls
    .map((el) => ({ sel: label(el), size: Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10, text: el.textContent.trim().slice(0, 50) }))
    .filter((x) => x.size < 13)
    .slice(0, 40);

  const overflowX = [...document.querySelectorAll('body *')]
    .filter(isVisible)
    .map((el) => { const r = el.getBoundingClientRect(); return { sel: label(el), right: Math.round(r.right), left: Math.round(r.left) }; })
    .filter((x) => x.right > vw + 1 || x.left < -1)
    .slice(0, 20);

  // Overlap detection among visible text elements (leaf-ish), significant intersection.
  const boxes = textEls.map((el) => ({ el, sel: label(el), r: el.getBoundingClientRect(), text: el.textContent.trim().slice(0, 30) }));
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
      const sameInlineFlow = boxes[i].el.parentElement === boxes[j].el.parentElement
        && getComputedStyle(boxes[i].el).display === 'inline'
        && getComputedStyle(boxes[j].el).display === 'inline';
      if (sameInlineFlow) continue;
      const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const area = ix * iy;
      const minArea = Math.min(a.width * a.height, b.width * b.height);
      if (area > 0 && minArea > 0 && area / minArea > 0.25) {
        overlaps.push({ a: boxes[i].sel, at: boxes[i].text, b: boxes[j].sel, bt: boxes[j].text, ratio: Math.round((area / minArea) * 100) / 100 });
      }
    }
  }

  return { vw, pageHeight: document.body.scrollHeight, smallText, overflowX, overlaps: overlaps.slice(0, 20) };
});

const bands = Math.min(24, Math.ceil(audit.pageHeight / band));
for (let i = 0; i < bands; i++) {
  const y = i * band;
  await page.evaluate((yy) => { document.documentElement.scrollTop = yy; }, y);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${outDir}/audit-${width}-band${String(i).padStart(2, '0')}.png` });
}

await browser.close();
console.log(JSON.stringify({ ...audit, bands }, null, 2));
