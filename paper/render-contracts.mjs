import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 560 }, deviceScaleFactor: 2 });
await page.setContent(`<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #111827; font-family: Arial, sans-serif; }
  main { width: 1800px; height: 560px; padding: 42px 54px 38px; }
  h1 { margin: 0 0 30px; font-size: 30px; line-height: 1.1; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); border-block: 2px solid #d1d5db; }
  section { min-height: 390px; padding: 26px 30px 22px; border-left: 1px solid #d1d5db; }
  section:first-child { border-left: 0; }
  .label { margin: 0 0 18px; color: #087a55; font-size: 15px; font-weight: 700; letter-spacing: 1.2px; }
  h2 { margin: 0 0 18px; font-size: 22px; line-height: 1.2; }
  pre { min-height: 152px; margin: 0 0 18px; padding: 18px; background: #f3f4f6; color: #111827; font: 16px/1.45 Consolas, monospace; white-space: pre-wrap; }
  p:last-child { margin: 0; color: #4b5563; font-size: 17px; line-height: 1.45; }
</style></head><body><main>
  <h1>Three executable contracts from the implementation</h1>
  <div class="grid">
    <section>
      <p class="label">GEOMETRY</p>
      <h2>Preserve the reading spine</h2>
      <pre>expect(intro.x)
  .toBeCloseTo(headline.x, 0);
expect(proof.x)
  .toBeCloseTo(headline.x, 0);</pre>
      <p>Intent is relational, so the contract survives container and viewport changes.</p>
    </section>
    <section>
      <p class="label">VISUAL REGRESSION</p>
      <h2>Detect unexplained pixel drift</h2>
      <pre>toHaveScreenshot('landing.png', {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixelRatio: 0.003
});</pre>
      <p>The image oracle is narrow and calibrated; semantic tests explain failures.</p>
    </section>
    <section>
      <p class="label">RELEASE GATE</p>
      <h2>Make evidence precede deployment</h2>
      <pre>build:
  needs: test
  steps:
    - run: npm run build
deploy:
  needs: build</pre>
      <p>The public artifact cannot advance unless browser evidence and the static build pass.</p>
    </section>
  </div>
</main></body></html>`);
await page.screenshot({ path: path.resolve('paper', 'figures', 'executable-contracts.png') });
await browser.close();
console.log('Rendered executable-contracts.png');
