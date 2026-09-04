import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4173/';
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);
const outDir = 'test-results';
const prefix = `${outDir}/vqa-${width}x${height}`;
const captures = [
  { name: 'work', selector: '#work .section-heading' },
  { name: 'work-entry', selector: '#work .experience:first-child' },
  { name: 'research', selector: '#research .section-heading' },
  { name: 'research-grid', selector: '#research .research-grid' },
  { name: 'about', selector: '#about .section-heading' },
  { name: 'about-grid', selector: '#about .about-grid' },
  { name: 'contact', selector: '.contact-section' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

// Top of page (hero)
await page.screenshot({ path: `${prefix}-hero.png` });

for (const capture of captures) {
  const el = page.locator(capture.selector);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${prefix}-${capture.name}.png` });
}

await browser.close();
console.log(`captured ${width}x${height}: hero,`, captures.map(({ name }) => name).join(', '));
