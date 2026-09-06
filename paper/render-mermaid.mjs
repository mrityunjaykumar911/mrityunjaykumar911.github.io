import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const diagrams = ['llm-tdd-loop', 'visual-study-protocol', 'selective-optimization'];
const sourceDir = path.resolve('paper', 'diagrams');
const outputDir = path.resolve('paper', 'figures');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1800, height: 1000 },
  deviceScaleFactor: 2,
});

for (const name of diagrams) {
  const source = await readFile(path.join(sourceDir, `${name}.mmd`), 'utf8');
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; background: #fff; }
    body { display: inline-block; padding: 24px; }
    #diagram { display: inline-block; }
    #diagram svg { display: block; max-width: none !important; }
  </style></head><body><div id="diagram"></div></body></html>`);
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js' });
  await page.evaluate(async ({ diagramName, definition }) => {
    window.mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'strict',
      fontFamily: 'Arial, sans-serif',
      flowchart: { curve: 'basis', htmlLabels: true, nodeSpacing: 28, rankSpacing: 38 },
      themeVariables: {
        primaryColor: '#ffffff',
        primaryTextColor: '#111827',
        primaryBorderColor: '#087a55',
        lineColor: '#4b5563',
        fontSize: '18px',
      },
    });
    const { svg } = await window.mermaid.render(`mermaid-${diagramName}`, definition);
    document.querySelector('#diagram').innerHTML = svg;
  }, { diagramName: name, definition: source });
  await page.locator('#diagram').screenshot({
    path: path.join(outputDir, `${name}.png`),
    animations: 'disabled',
  });
  await page.close();
}

await browser.close();
console.log(`Rendered ${diagrams.length} Mermaid diagrams.`);
