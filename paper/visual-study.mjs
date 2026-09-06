import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('paper', 'figures');
const legacyUrl = process.env.LEGACY_URL;
const modernUrl = process.env.MODERN_URL;
if (!legacyUrl || !modernUrl) {
  throw new Error('Set LEGACY_URL and MODERN_URL before running the visual study.');
}
const targets = [
  { id: 'legacy', url: legacyUrl },
  { id: 'modern', url: modernUrl },
];
const viewports = [
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'mobile', width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const observations = [];

for (const target of targets) {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(target.url, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.evaluate(() => document.fonts?.ready);

    const metrics = await page.evaluate(({ targetId, viewportId }) => {
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity) !== 0
          && rect.width > 0
          && rect.height > 0;
      };
      const hasOwnText = (element) => [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
      );
      const accessibleName = (element) => {
        const imageAlt = [...element.querySelectorAll('img')]
          .map((image) => image.getAttribute('alt') ?? '')
          .join(' ');
        return [
          element.getAttribute('aria-label') ?? '',
          element.getAttribute('title') ?? '',
          element.textContent ?? '',
          imageAlt,
        ].join(' ').trim();
      };

      const visibleElements = [...document.querySelectorAll('body *')].filter(isVisible);
      const textElements = visibleElements.filter(hasOwnText);
      const aboveFoldText = textElements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      });
      const fontSizes = textElements
        .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
      const headings = [...document.querySelectorAll('h1, h2, h3, h4')].filter(isVisible);
      const aboveFoldHeadings = headings.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      });
      const interactive = [...document.querySelectorAll('a[href], button')].filter(isVisible);
      const aboveFoldActions = interactive.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      });
      const textArea = aboveFoldText.reduce((sum, element) => {
        const rect = element.getBoundingClientRect();
        const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
        const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
        return sum + width * height;
      }, 0);
      const largestHeading = headings.reduce((maximum, element) => (
        Math.max(maximum, Number.parseFloat(getComputedStyle(element).fontSize))
      ), 0);
      const medianFont = fontSizes[Math.floor(fontSizes.length / 2)] ?? 0;
      const landmarks = {
        header: document.querySelectorAll('header').length,
        nav: document.querySelectorAll('nav').length,
        main: document.querySelectorAll('main').length,
        footer: document.querySelectorAll('footer').length,
      };
      const landmarkCompleteness = Object.values(landmarks).filter((count) => count > 0).length;
      const overflow = visibleElements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      });
      const imageCount = [...document.images].filter(isVisible).length;
      const missingAlt = [...document.images].filter(
        (image) => isVisible(image) && !image.hasAttribute('alt')
      ).length;
      const unnamedInteractive = interactive.filter((element) => !accessibleName(element)).length;

      const overlapCandidates = aboveFoldText.map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }));
      let significantOverlapCount = 0;
      for (let left = 0; left < overlapCandidates.length; left += 1) {
        for (let right = left + 1; right < overlapCandidates.length; right += 1) {
          const first = overlapCandidates[left];
          const second = overlapCandidates[right];
          if (first.element.contains(second.element) || second.element.contains(first.element)) continue;
          const sameInlineFlow = first.element.parentElement === second.element.parentElement
            && getComputedStyle(first.element).display === 'inline'
            && getComputedStyle(second.element).display === 'inline';
          if (sameInlineFlow) continue;
          const intersectionWidth = Math.max(
            0,
            Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          );
          const intersectionHeight = Math.max(
            0,
            Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          );
          const smallerArea = Math.min(
            first.rect.width * first.rect.height,
            second.rect.width * second.rect.height
          );
          if (smallerArea > 0 && intersectionWidth * intersectionHeight / smallerArea > 0.25) {
            significantOverlapCount += 1;
          }
        }
      }

      const xrayElements = [...document.querySelectorAll('h1, h2, h3, h4, p, a, button, li, img')]
        .filter(isVisible);
      const leftEdgeCounts = new Map();
      for (const element of xrayElements) {
        const edge = Math.round(element.getBoundingClientRect().left);
        leftEdgeCounts.set(edge, (leftEdgeCounts.get(edge) ?? 0) + 1);
      }
      const alignmentGuides = [...leftEdgeCounts.entries()]
        .filter(([, count]) => count >= 3)
        .map(([edge]) => edge);
      const nearMissCount = xrayElements.filter((element) => {
        const edge = Math.round(element.getBoundingClientRect().left);
        return alignmentGuides.some((guide) => {
          const distance = Math.abs(edge - guide);
          return distance >= 2 && distance <= 12;
        });
      }).length;

      const attentionAnchors = [...document.querySelectorAll('h1, h2, h3, h4, a, button')]
        .filter(isVisible)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top < innerHeight && rect.bottom > 0;
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
        })
        .slice(0, 12);
      const attentionPoints = attentionAnchors.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + Math.min(rect.width / 2, 40), y: rect.top + rect.height / 2 };
      });
      const horizontalAttentionTravel = attentionPoints.slice(1).reduce(
        (sum, point, index) => sum + Math.abs(point.x - attentionPoints[index].x),
        0
      );

      return {
        target: targetId,
        viewport: viewportId,
        width: innerWidth,
        height: innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        viewportLengths: Number((document.documentElement.scrollHeight / innerHeight).toFixed(2)),
        domElements: visibleElements.length,
        textElements: textElements.length,
        aboveFoldTextElements: aboveFoldText.length,
        aboveFoldWords: aboveFoldText.reduce(
          (sum, element) => sum + element.textContent.trim().split(/\s+/).length,
          0
        ),
        aboveFoldTextAreaRatio: Number((textArea / (innerWidth * innerHeight)).toFixed(3)),
        headingCount: headings.length,
        aboveFoldHeadingCount: aboveFoldHeadings.length,
        h1Count: document.querySelectorAll('h1').length,
        largestHeadingPx: Number(largestHeading.toFixed(1)),
        medianFontPx: Number(medianFont.toFixed(1)),
        hierarchyRatio: medianFont ? Number((largestHeading / medianFont).toFixed(2)) : 0,
        smallTextCount: textElements.filter(
          (element) => Number.parseFloat(getComputedStyle(element).fontSize) < 13
        ).length,
        landmarkCompleteness,
        landmarks,
        aboveFoldActionCount: aboveFoldActions.length,
        horizontalOverflowCount: overflow.length,
        significantOverlapCount,
        alignmentGuideCount: alignmentGuides.length,
        alignmentNearMissCount: nearMissCount,
        attentionAnchorCount: attentionPoints.length,
        normalizedHorizontalAttentionTravel: Number(
          (horizontalAttentionTravel / innerWidth).toFixed(2)
        ),
        unnamedInteractiveCount: unnamedInteractive,
        imageCount,
        missingAltCount: missingAlt,
      };
    }, { targetId: target.id, viewportId: viewport.id });

    observations.push(metrics);

    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || node.parentElement?.closest('script, style, noscript')) continue;
        nodes.push(node);
      }
      for (const node of nodes) {
        const span = document.createElement('span');
        const color = getComputedStyle(node.parentElement).color;
        span.textContent = node.textContent;
        span.style.color = 'transparent';
        span.style.backgroundColor = color;
        span.style.borderRadius = '2px';
        span.style.opacity = '0.38';
        span.style.userSelect = 'none';
        node.replaceWith(span);
      }
      for (const image of document.images) {
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        const replacement = document.createElement('div');
        replacement.dataset.redactedMedia = 'true';
        Object.assign(replacement.style, {
          display: 'block',
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          background: '#cfd4d1',
          borderRadius: style.borderRadius,
        });
        image.replaceWith(replacement);
      }
    });

    await page.screenshot({
      path: path.join(outputDir, `${target.id}-${viewport.id}.png`),
      fullPage: false,
      animations: 'disabled',
    });

    await page.evaluate(() => {
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity) !== 0
          && rect.width > 0
          && rect.height > 0
          && rect.top < innerHeight
          && rect.bottom > 0;
      };
      const layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '2147483647',
      });
      const groups = [
        { selector: 'h1, h2, h3, h4', color: '#e11d70' },
        { selector: 'p, li', color: '#0284c7' },
        { selector: 'a, button', color: '#087a55' },
        { selector: '[data-redacted-media]', color: '#d97706' },
      ];
      for (const group of groups) {
        for (const element of document.querySelectorAll(group.selector)) {
          if (!isVisible(element)) continue;
          const rect = element.getBoundingClientRect();
          const box = document.createElement('div');
          Object.assign(box.style, {
            position: 'absolute',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            border: `2px solid ${group.color}`,
            boxSizing: 'border-box',
          });
          layer.appendChild(box);
        }
      }

      const anchors = [...document.querySelectorAll('h1, h2, h3, h4, a, button')]
        .filter(isVisible)
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
        })
        .slice(0, 12);
      const points = anchors.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + Math.min(rect.width / 2, 40), y: rect.top + rect.height / 2 };
      });
      const namespace = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(namespace, 'svg');
      svg.setAttribute('width', String(innerWidth));
      svg.setAttribute('height', String(innerHeight));
      Object.assign(svg.style, { position: 'absolute', inset: '0' });
      const path = document.createElementNS(namespace, 'polyline');
      path.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#7c3aed');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-dasharray', '7 6');
      svg.appendChild(path);
      points.forEach((point, index) => {
        const circle = document.createElementNS(namespace, 'circle');
        circle.setAttribute('cx', String(point.x));
        circle.setAttribute('cy', String(point.y));
        circle.setAttribute('r', '12');
        circle.setAttribute('fill', '#7c3aed');
        svg.appendChild(circle);
        const label = document.createElementNS(namespace, 'text');
        label.setAttribute('x', String(point.x));
        label.setAttribute('y', String(point.y + 4));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', '#fff');
        label.setAttribute('font-size', '11');
        label.textContent = String(index + 1);
        svg.appendChild(label);
      });
      layer.appendChild(svg);
      document.body.appendChild(layer);
    });

    await page.screenshot({
      path: path.join(outputDir, `${target.id}-${viewport.id}-xray.png`),
      fullPage: false,
      animations: 'disabled',
    });
    await context.close();
  }
}

await browser.close();
await writeFile(
  path.join(outputDir, 'metrics.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), observations }, null, 2)}\n`,
  'utf8'
);
console.log(JSON.stringify(observations, null, 2));
