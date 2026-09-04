import { chromium } from 'playwright';

// Design X-ray: overlays bounding boxes, alignment guides, and a reading-flow
// path on the live DOM, then reports misalignments and spacing-rhythm breaks.
const base = process.argv[2] ?? 'http://127.0.0.1:4173/';
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);
const band = 760;
const outDir = 'test-results';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  for (let y = 0; y < document.body.scrollHeight; y += 400) {
    document.documentElement.scrollTop = y;
    await new Promise((r) => setTimeout(r, 25));
  }
  document.documentElement.scrollTop = 0;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});

const report = await page.evaluate(() => {
  const groups = [
    { sel: 'h1, h2, h3, [class*="headline"], [class*="title"]', color: '#ff2d95', type: 'heading' },
    { sel: 'p, [class*="lede"], [class*="summary"], [class*="subhead"], [class*="body"]', color: '#00c2ff', type: 'body' },
    { sel: '.eyebrow, .evidence-label, .mono-label, .company, [class*="eyebrow"], [class*="label"]', color: '#ff9500', type: 'label' },
    { sel: 'a, button, [role="button"]', color: '#00e676', type: 'action' },
    { sel: 'img, picture, video, [class*="portrait"], [class*="image"]', color: '#ffd400', type: 'media' },
    { sel: 'li', color: '#b388ff', type: 'list' },
  ];

  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    if (el.closest('details:not([open])')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const docRect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height, right: r.right + scrollX, bottom: r.bottom + scrollY };
  };

  const layer = document.createElement('div');
  Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: document.body.scrollHeight + 'px', pointerEvents: 'none', zIndex: '2147483647' });
  document.body.appendChild(layer);

  // Section boundaries reveal whether each transition carries or resets attention.
  const sectionTransitions = [];
  for (const section of document.querySelectorAll('main > section')) {
    if (!vis(section)) continue;
    const r = docRect(section);
    const label = section.id || section.getAttribute('aria-label') || section.className.split(' ')[0];
    sectionTransitions.push({ label, top: Math.round(r.top), height: Math.round(r.height) });
    const boundary = document.createElement('div');
    Object.assign(boundary.style, {
      position: 'absolute', left: '0', top: r.top + 'px', width: '100%', height: '1px',
      background: 'rgba(255,45,149,0.38)'
    });
    const tag = document.createElement('span');
    tag.textContent = label;
    Object.assign(tag.style, {
      position: 'absolute', left: '4px', top: r.top + 4 + 'px', padding: '2px 5px',
      background: 'rgba(255,45,149,0.9)', color: '#fff', font: '10px/1.2 monospace'
    });
    layer.append(boundary, tag);
  }

  const boxed = [];
  for (const g of groups) {
    for (const el of document.querySelectorAll(g.sel)) {
      if (!vis(el)) continue;
      const r = docRect(el);
      boxed.push({ ...r, color: g.color, type: g.type });
      const b = document.createElement('div');
      Object.assign(b.style, { position: 'absolute', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', outline: '1.5px solid ' + g.color, boxSizing: 'border-box' });
      layer.appendChild(b);
    }
  }

  // Alignment guides: left edges shared by >= 3 boxes.
  const edgeCount = {};
  for (const b of boxed) { const x = Math.round(b.left); edgeCount[x] = (edgeCount[x] || 0) + 1; }
  const guides = Object.entries(edgeCount).filter(([, n]) => n >= 3).map(([x]) => Number(x));
  for (const x of guides) {
    const line = document.createElement('div');
    Object.assign(line.style, { position: 'absolute', left: x + 'px', top: '0', width: '1px', height: document.body.scrollHeight + 'px', background: 'rgba(255,0,0,0.5)' });
    layer.appendChild(line);
  }

  // Near-miss misalignments: left edges within 2..12px of a strong guide.
  const misaligns = [];
  for (const b of boxed) {
    for (const gx of guides) {
      const d = Math.round(b.left) - gx;
      if (Math.abs(d) >= 2 && Math.abs(d) <= 12) {
        misaligns.push({ type: b.type, off: d, atX: gx, top: Math.round(b.top) });
        break;
      }
    }
  }

  // Reading-flow path over semantic attention anchors, not every heading.
  const one = (selector) => document.querySelector(selector);
  const roleFlow = [...document.querySelectorAll('.experience')]
    .flatMap((experience) => [
      experience.querySelector('.experience-head'),
      experience.querySelector('.experience-summary')
    ]);
  const flowEls = [
    one('.hero .eyebrow'), one('.hero h1'), one('.hero-intro'),
    one('.hero-actions .button-primary'), one('.portrait-frame'), one('#work-title'),
    ...roleFlow, one('#research-title'), one('.feature-story h3'),
    one('.research-notes'), one('#about-title'), one('.about-copy'),
    one('.capabilities'), one('#contact-title'), one('#contact-email')
  ].filter((element) => element instanceof Element && vis(element));
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: document.body.scrollHeight + 'px' });
  svg.setAttribute('width', String(document.documentElement.clientWidth));
  svg.setAttribute('height', String(document.body.scrollHeight));
  const pts = flowEls.map((el) => {
    const r = docRect(el);
    return {
      x: r.left + Math.min(r.width / 2, 40),
      y: r.top + Math.min(r.height / 2, 40),
      label: el.id || el.className || el.tagName.toLowerCase()
    };
  });
  const poly = document.createElementNS(svgNS, 'polyline');
  poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', 'rgba(0,90,255,0.8)');
  poly.setAttribute('stroke-width', '2');
  poly.setAttribute('stroke-dasharray', '6 5');
  svg.appendChild(poly);
  pts.forEach((p, i) => {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', String(p.x)); c.setAttribute('cy', String(p.y)); c.setAttribute('r', '11');
    c.setAttribute('fill', 'rgba(0,90,255,0.9)');
    svg.appendChild(c);
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', String(p.x)); t.setAttribute('y', String(p.y + 4)); t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#fff'); t.setAttribute('font-size', '12'); t.setAttribute('font-family', 'monospace');
    t.textContent = String(i + 1);
    svg.appendChild(t);
  });
  layer.appendChild(svg);

  // Vertical spacing rhythm between stacked heading/body blocks.
  const blocks = boxed.filter((b) => b.type === 'heading' || b.type === 'body').sort((a, b) => a.top - b.top);
  const gaps = [];
  for (let i = 1; i < blocks.length; i++) {
    const g = Math.round(blocks[i].top - blocks[i - 1].bottom);
    if (g > 4 && g < 400) gaps.push(g);
  }
  const offGrid = gaps.filter((g) => g % 4 !== 0);

  const textFlowEls = flowEls.filter((element) =>
    element.matches('h1, h2, h3, p, .experience-head, .about-copy')
  );
  const centered = textFlowEls.filter((element) => getComputedStyle(element).textAlign === 'center').length;
  const centerPct = Math.round((centered / Math.max(1, textFlowEls.length)) * 100);

  const flowJumps = pts.slice(1).map((point, index) => ({
    from: pts[index].label,
    to: point.label,
    horizontal: Math.round(point.x - pts[index].x),
    vertical: Math.round(point.y - pts[index].y)
  }));
  const transitionGaps = sectionTransitions.slice(1).map((section, index) => ({
    from: sectionTransitions[index].label,
    to: section.label,
    gap: section.top - (sectionTransitions[index].top + sectionTransitions[index].height)
  }));
  const hero = document.querySelector('.hero');
  const portrait = document.querySelector('.portrait-frame');
  const primaryAction = document.querySelector('.hero-actions .button-primary');
  const fold = window.innerHeight;
  const foldCoverage = [
    ['hero', hero], ['primaryAction', primaryAction], ['portrait', portrait]
  ].map(([name, element]) => {
    if (!(element instanceof Element)) return { name, visibleAtFold: false };
    const r = element.getBoundingClientRect();
    return {
      name,
      visibleAtFold: r.top < fold && r.bottom > 0,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom)
    };
  });

  return {
    boxedCount: boxed.length,
    alignmentGuides: guides.sort((a, b) => a - b),
    misalignments: misaligns.slice(0, 25),
    readingFlowSteps: flowEls.length,
    readingFlow: pts.map(({ label, x, y }) => ({ label, x: Math.round(x), y: Math.round(y) })),
    flowJumps,
    centerAxisPct: centerPct,
    sectionTransitions,
    transitionGaps,
    foldCoverage,
    spacingGaps: gaps.slice(0, 40),
    offGridGaps: offGrid.slice(0, 40),
  };
});

const bands = Math.min(24, Math.ceil((await page.evaluate(() => document.body.scrollHeight)) / band));
for (let i = 0; i < bands; i++) {
  await page.evaluate((yy) => { document.documentElement.scrollTop = yy; }, i * band);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${outDir}/xray-${width}-band${String(i).padStart(2, '0')}.png` });
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
