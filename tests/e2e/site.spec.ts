import { expect, test, type Page } from '@playwright/test';

// SVG labels wrap into one tspan per line; textContent would join wrapped words without spaces.
const diagramText = (page: Page, id: string) =>
  page.locator(`#${id} svg`).evaluate((svg) =>
    [...svg.querySelectorAll('text, foreignObject')]
      .map((label) => {
        if (label.localName === 'foreignObject') return label.textContent;
        const lines = [...label.querySelectorAll('tspan')].filter((span) => !span.querySelector('tspan'));
        return lines.length ? lines.map((line) => line.textContent).join(' ') : label.textContent;
      })
      .join(' ')
      .replace(/\s+/g, ' ')
  );

const privateMarker = '7,000 containers';
const previewOnlyMarkers = [
  privateMarker,
  'corrupt reward signal',
  'RL reward',
  'PowerPoint Agent v1.1',
];

test('published content does not use em dashes', async ({ page, request }) => {
  for (const path of ['/', '/latest.html', '/method.html', '/studies/eval-pipeline.html']) {
    await page.goto(path);
    expect(await page.locator('body').innerText(), path).not.toContain('—');
  }

  const crawlerContext = await request.get('/llms.txt');
  expect(await crawlerContext.text(), '/llms.txt').not.toContain('—');
});

test('published page stays generic and exposes complete metadata', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Mrityunjay Kumar | Member of Technical Staff');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mrityunjay Kumar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  for (const marker of previewOnlyMarkers) {
    await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
  }

  const microsoftRole = page.locator('.work-entry').filter({ hasText: 'Microsoft' }).first();
  await expect(
    microsoftRole.getByText('4.6x reduction in evaluation time', { exact: false })
  ).toBeVisible();
  await expect(microsoftRole).toContainText('benchmark methodology is not public');
  const contact = page.getByRole('region', { name: 'Contact' });
  await expect(contact.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/mrkumar20/');
  await expect(contact.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/mrityunjaykumar911');
  const download = contact.getByRole('link', { name: 'Résumé' });
  await expect(download).toHaveAttribute('href', '/cv/MrityunjayKumar-CV.pdf');
  await expect(download).toHaveAttribute('download', '');
  const background = page.getByRole('region', { name: 'Background' });
  await expect(background).toContainText('Stony Brook');
  await expect(background.getByRole('link', { name: 'Detailed résumé' })).toHaveAttribute('href', '/latest.html');

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://mrityunjaykumar911.github.io/'
  );
  await expect(page.locator('link[rel="sitemap"]')).toHaveAttribute(
    'href',
    '/sitemap-index.xml'
  );
  await expect(page.locator('link[rel="alternate"][type="text/plain"]')).toHaveAttribute(
    'href',
    '/llms.txt'
  );
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
    'href',
    '/resume.md'
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    /\/images\/mrityunjay-portrait\.jpg$/
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image'
  );
  const structuredData = await page.locator('script[type="application/ld+json"]').textContent();
  expect(structuredData).toContain(
    'Maulana Azad National Institute of Technology, Bhopal'
  );
  expect(structuredData).toContain('LLM agent infrastructure');
  expect(structuredData).toContain('Azure Machine Learning');
  expect(structuredData).not.toContain('"email"');

  await expect(
    page.getByText('Graduate Research Assistant · Stony Brook University · 2020', {
      exact: false,
    })
  ).toBeVisible();
  const researchAssistantRole = page.locator('.feature-story');
  await expect(
    researchAssistantRole.getByText('Led early-stage development and evaluation', { exact: false })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Visit the research group' })).toHaveAttribute(
    'href',
    'https://mpaxos.com/'
  );
  await expect(page.locator('a[href*="sbu-musicx"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Email' })).toHaveAttribute(
    'href',
    'mailto:mjay.cse@gmail.com'
  );

  const portrait = page.getByRole('img', { name: 'Portrait of Mrityunjay Kumar' });
  await expect(portrait).toBeVisible();
  expect(
    await portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
  ).toBe(true);
});

test('email link degrades gracefully without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/');

  const emailLink = page.getByRole('link', { name: 'Email' });
  await expect(emailLink).toHaveAttribute('href', '#contact-email');
  await expect(emailLink).toHaveAttribute('id', 'contact-email');
  const noscriptText = await page.locator('.contact-links noscript').textContent();
  expect(noscriptText).toContain('Enable JavaScript to reveal my email address');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Engineering' })).toBeVisible();

  await context.close();
});

test('homepage leads with the author and a readable linked design proposal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const heroHeading = page.getByRole('heading', { level: 1 });
  await expect(heroHeading).toHaveText('Mrityunjay Kumar');
  await expect(page.getByText('Member of Technical Staff', { exact: false }).first()).toBeInViewport();
  const feature = page.getByRole('article', { name: 'Scaling out a distributed LLM evaluation pipeline' });
  await expect(feature.getByText('Proposed architecture')).toBeInViewport();
  await expect(feature).toContainText('reuse the answer');
  const study = feature.getByRole('link', { name: 'Scaling out a distributed LLM evaluation pipeline' });
  await expect(study).toHaveAttribute('href', '/studies/eval-pipeline.html');
  await expect(study).toBeInViewport({ ratio: 1 });
  expect(await heroHeading.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    'Bricolage Grotesque'
  );

  await expect(page.locator('.signal-strip')).toHaveCount(0);
  const workBox = await page.locator('#work').boundingBox();
  expect(workBox).not.toBeNull();
  expect(workBox!.y).toBeLessThan(900);
  await expect(page.locator('.work-entry')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Full experience' })).toHaveAttribute('href', '/latest.html');
  await study.click();
  await expect(page).toHaveURL(/\/studies\/eval-pipeline\.html$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('LLM evaluation pipeline');
});

test('ultrawide view preserves a bounded editorial reading width', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 1600 });
  await page.goto('/');

  const hero = await page.locator('.hero').boundingBox();
  const portrait = await page.locator('.hero-identity img').boundingBox();
  const headingSize = await page
    .getByRole('heading', { level: 1 })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

  expect(hero).not.toBeNull();
  expect(portrait).not.toBeNull();
  expect(hero!.width).toBeGreaterThanOrEqual(1120);
  expect(hero!.width).toBeLessThanOrEqual(1440);
  expect(portrait!.width).toBe(72);
  expect(headingSize).toBeGreaterThanOrEqual(76);

  for (const [selector, minimum] of [
    ['.site-nav', 14],
    ['.work-summary', 18],
    ['.lead-study div > p', 18],
    ['.research-note h3', 20],
    ['.backstory p', 18],
    ['.site-footer', 14],
  ] as const) {
    const fontSize = await page.locator(selector).first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    expect(fontSize, selector).toBeGreaterThanOrEqual(minimum);
  }
});

test('visual system stays readable and color-coherent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  expect(
    await page.locator('body').evaluate((element) => getComputedStyle(element, '::before').display)
  ).toBe('none');

  const engineering = page.locator('.selected-work');
  expect(await engineering.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe('solid');
  expect(
    await engineering.locator('.work-context').first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    )
  ).toBeGreaterThanOrEqual(13);

  const metadataSelectors = [
    '.wordmark',
    '.site-nav',
    '.study-label',
    '.contact-links a',
    '.site-footer',
  ];
  for (const selector of metadataSelectors) {
    const [baseSelector, pseudo] = selector.split('::');
    const fontSize = await page.locator(baseSelector).first().evaluate(
      (element, pseudoElement) =>
        Number.parseFloat(getComputedStyle(element, pseudoElement ? `::${pseudoElement}` : null).fontSize),
      pseudo
    );
    expect(fontSize, selector).toBeGreaterThanOrEqual(12);
  }

  const contact = page.locator('.contact-section');
  const footer = page.locator('.site-footer');
  for (const frame of [page.locator('.site-header'), contact, footer]) {
    expect(await frame.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)'
    );
  }
  expect(await contact.evaluate((element) => getComputedStyle(element, '::after').content)).toBe(
    'none'
  );

  const families = await page.locator('body').evaluate((body) => [
    ...new Set(
      [...body.querySelectorAll('*')]
        .filter((element) =>
          [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()) &&
          element.getClientRects().length > 0 &&
          !element.closest('script, style, noscript, code, pre')
        )
        .map((element) => getComputedStyle(element).fontFamily.split(',')[0].replace(/["']/g, '').trim())
    ),
  ].sort());
  expect(families).toEqual(['Bricolage Grotesque Variable', 'Source Sans 3 Variable']);
});

test('production accounts cite their sources and writing links to the studies and publications', async ({ page }) => {
  await page.goto('/');

  const microsoftRole = page.getByRole('article', { name: /PowerPoint agents/ });
  await expect(microsoftRole).toContainText('2022 to present');
  await expect(microsoftRole.getByRole('link')).toHaveAttribute('href', '/latest.html#work');
  const storage = page.getByRole('article', { name: /crash recovery in vSAN/ });
  await expect(storage.getByRole('link')).toHaveAttribute('href', 'https://patents.google.com/patent/US11573860B1');

  const writing = page.getByRole('list', { name: 'Research and writing index' });
  await expect(writing.getByRole('link', { name: /passing check/ })).toHaveAttribute('href', '/method.html#case-studies');
  await expect(writing.getByRole('link', { name: /^Rolis:/ })).toHaveAttribute('href', 'https://dl.acm.org/doi/10.1145/3492321.3519576');
  await expect(writing.getByRole('link', { name: /question articulation/ })).toHaveAttribute('href', 'https://ieeexplore.ieee.org/document/8614044');

  const researchLink = page.locator('.site-nav a[href="#research"]');
  await researchLink.click();
  await expect(researchLink).toHaveAttribute('aria-current', 'true');
  expect(await page.locator('.site-header').evaluate((element) =>
    getComputedStyle(element).backgroundColor
  )).toBe('rgba(0, 0, 0, 0)');
  await expect.poll(async () => (await page.locator('#research').boundingBox())!.y).toBeLessThanOrEqual(30);
});

test('fast navigation never leaves content hidden', async ({ page }) => {
  await page.goto('/');

  for (const id of ['work', 'research', 'about']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  }
  await page.locator('.contact-section').scrollIntoViewIfNeeded();

  await expect
    .poll(() =>
      page.locator('.reveal:not(.is-visible)').evaluateAll((elements) => elements.length)
    )
    .toBe(0);
});

test('published HTML protects contact details and retires the stale CV route', async ({ request }) => {
  const publishedResponse = await request.get('/');
  expect(publishedResponse.ok()).toBe(true);
  const publishedHtml = await publishedResponse.text();
  for (const marker of previewOnlyMarkers) expect(publishedHtml).not.toContain(marker);
  expect(publishedHtml).not.toContain('mjay.cse@gmail.com');
  expect(publishedHtml).not.toContain('cut sync-server load by <strong>200%</strong>');
  expect(publishedHtml).not.toContain('sbu-musicx.up.railway.app');

  const legacyResponse = await request.get('/cv/cv/MrityunjayKumarCV.pdf.html');
  expect(legacyResponse.ok()).toBe(true);
  const legacyHtml = await legacyResponse.text();
  expect(legacyHtml).toContain('noindex, nofollow');
  expect(legacyHtml).toContain('../MrityunjayKumar-CV.pdf');
  expect(legacyHtml).not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
});

test('crawler resources expose professional context without contact PII', async ({ request }) => {
  const robotsResponse = await request.get('/robots.txt');
  expect(robotsResponse.ok()).toBe(true);
  expect(robotsResponse.headers()['content-type']).toContain('text/plain');
  const robots = await robotsResponse.text();
  expect(robots).toContain('User-agent: *');
  expect(robots).toContain('Allow: /');
  expect(robots).not.toContain('Disallow: /latest.html');
  expect(robots).toContain(
    'Sitemap: https://mrityunjaykumar911.github.io/sitemap-index.xml'
  );

  const contextResponse = await request.get('/llms.txt');
  expect(contextResponse.ok()).toBe(true);
  expect(contextResponse.headers()['content-type']).toContain('text/plain');
  const context = await contextResponse.text();
  expect(context).toContain('# Mrityunjay Kumar');
  expect(context).toContain('Distributed infrastructure for reliable LLM agents');
  expect(context).toContain('Zero-to-one architecture');
  expect(context).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  expect(context).not.toMatch(/mailto:/i);
  const contextWithoutUrls = context.replace(/https?:\/\/\S+/g, '');
  expect(contextWithoutUrls).not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
  expect(context).not.toContain(privateMarker);

  const markdownResponse = await request.get('/resume.md');
  expect(markdownResponse.ok()).toBe(true);
  expect(markdownResponse.headers()['content-type']).toContain('text/markdown');
  const markdown = await markdownResponse.text();
  for (const heading of ['# Mrityunjay Kumar - Resume', '## Key Facts', '## Experience',
    '## Core Expertise', '## Research, Publications, and Intellectual Property', '## Education']) {
    expect(markdown).toContain(heading);
  }
  expect(markdown).toContain('### Member of Technical Staff - Microsoft');
  expect(markdown).toContain('### Member of Technical Staff III - VMware');
  expect(markdown).toContain('[Engineering method](https://mrityunjaykumar911.github.io/method.html)');
  expect(markdown).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  expect(markdown).not.toMatch(/mailto:/i);
  expect(markdown).not.toContain(privateMarker);
  expect(markdown).not.toContain('—');
});

test('normal URL does not load the detailed resume', async ({ page }) => {
  const detailedRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/latest.html')) {
      detailedRequests.push(request.url());
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(detailedRequests).toEqual([]);
  await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === '');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Mrityunjay Kumar'
  );
  for (const marker of previewOnlyMarkers) {
    await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
  }
});

test('normal URL prints the console greeting and preview link', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(messages.some((message) => message.includes('MRITYUNJAY KUMAR'))).toBe(true);
  const previewURL = new URL('/?preview', page.url()).href;
  expect(
    messages.some((message) =>
      message.includes(`→ ${previewURL}`)
    )
  ).toBe(true);

  const greetingsBeforeResize = messages.filter((message) =>
    message.includes('MRITYUNJAY KUMAR')
  ).length;
  await page.setViewportSize({ width: 900, height: 720 });
  await expect
    .poll(
      () => messages.filter((message) => message.includes('MRITYUNJAY KUMAR')).length
    )
    .toBeGreaterThan(greetingsBeforeResize);
});

for (const query of ['?flags=latest', '?preview']) {
  test(`${query} loads the detailed public resume`, async ({ page }) => {
    await page.goto(`/${query}`);

    await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === query);
    await expect(page.getByRole('status')).toContainText('Preview');
    await expect(page.getByText(privateMarker, { exact: false }).first()).toBeVisible();
    await expect(
      page.getByText('PowerPoint Agent v1.1', { exact: false }).first()
    ).toBeVisible();

    const microsoftRole = page.locator('.experience').filter({ hasText: 'Microsoft' }).first();
    await microsoftRole.getByText('Full detail').click();
    await expect(
      microsoftRole.getByText('100M+ documents', { exact: false })
    ).toBeVisible();

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Mrityunjay Kumar'
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, follow'
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://mrityunjaykumar911.github.io/latest.html'
    );
  });
}

test('detailed resume is a shareable and indexable document', async ({
  request,
  page,
}) => {
  const response = await request.get('/latest.html');
  expect(response.ok()).toBe(true);
  expect(response.headers()['x-robots-tag']).toBeUndefined();

  await page.goto('/latest.html');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://mrityunjaykumar911.github.io/latest.html'
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://mrityunjaykumar911.github.io/latest.html'
  );
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.getByText(privateMarker, { exact: false }).first()).toBeVisible();

  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toContain('https://mrityunjaykumar911.github.io/latest.html');

  const sitemapIndex = await (await request.get('/sitemap-index.xml')).text();
  const sitemapPath = sitemapIndex.match(/<loc>([^<]+)<\/loc>/)?.[1];
  expect(sitemapPath).toBeTruthy();
  const sitemap = await (await request.get(new URL(sitemapPath!).pathname)).text();
  expect(sitemap).toContain('https://mrityunjaykumar911.github.io/latest.html');
});

test('mobile navigation works without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');

  const menu = page.locator('[data-menu-button]');
  await expect(page.getByRole('link', { name: 'Scaling out a distributed LLM evaluation pipeline' })).toBeInViewport({ ratio: 1 });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAccessibleName('Open navigation');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toHaveAccessibleName('Close navigation');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
});

test('portrait and identity remain aligned without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?flags=latest');

  const frame = await page.locator('.hero-identity img').boundingBox();
  const caption = await page.locator('.hero-identity p').boundingBox();

  expect(frame).not.toBeNull();
  expect(caption).not.toBeNull();
  expect(caption!.x).toBeGreaterThanOrEqual(frame!.x + frame!.width);
  expect(Math.abs(caption!.y - frame!.y)).toBeLessThanOrEqual(2);
});

test('research notes read as one article with correctly scoped evidence', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Research notes' })).toHaveAttribute(
    'href',
    '/method.html'
  );

  await page.goto('/method.html');

  await expect(page).toHaveTitle('Engineering Evidence & Its Limits | Mrityunjay Kumar');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://mrityunjaykumar911.github.io/method.html'
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What does the evidence establish?');
  await expect(page.locator('.site-header .wordmark')).toHaveAttribute('href', '/');
  await expect(page.locator('main')).not.toContainText(/staff role I am growing toward|Staff lesson/);

  await expect(page.locator('#case-studies > article')).toHaveCount(3);
  const studyA = page.locator('#study-a');
  await expect(studyA).toContainText('Bounded positive result');
  await expect(studyA).toContainText('45.76% of 2,255 eligible flex containers');
  await expect(studyA.locator('figcaption')).toHaveText('Share of 2,255 eligible flex containers');
  await expect(studyA.locator('meter')).toHaveCount(2);
  await expect(studyA).toContainText('maximal on eight checked finite domains');
  const studyB = page.locator('#study-b');
  await expect(studyB).toContainText('Single-repository finding');
  await expect(studyB).toContainText('The case establishes existence, not prevalence.');
  const studyC = page.locator('#study-c');
  await expect(studyC).toContainText('Negative feasibility result');
  await expect(studyC).toContainText('349,968');
  await expect(studyC).toContainText('remained unscored');
  await expect(studyC).toContainText('Stop an expensive direction');

  const tlaSpec = page.getByRole('link', { name: 'Inspect the TLA+ model' });
  await expect(tlaSpec).toHaveAttribute('href', '/research/FlexFacets.tla');
  const tlaResponse = await request.get('/research/FlexFacets.tla');
  expect(tlaResponse.ok()).toBe(true);
  expect(await tlaResponse.text()).toContain('Immobile(cfg, i)');

  const sitemapIndex = await request.get('/sitemap-index.xml');
  const sitemapLocation = (await sitemapIndex.text()).match(/<loc>([^<]+)<\/loc>/)?.[1];
  expect(sitemapLocation).toBeTruthy();
  const sitemap = await request.get(new URL(sitemapLocation!).pathname);
  expect(await sitemap.text()).toContain('/method.html');

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBe(width);
  }
});

test('eval pipeline design study is linked from the method page and renders', async ({ page, request }) => {
  await page.goto('/method.html');
  const studyLink = page.locator('.related-study').getByRole('link', { name: /Scaling out an LLM evaluation pipeline/ });
  await expect(studyLink).toHaveAttribute('href', '/studies/eval-pipeline.html');
  await studyLink.click();

  await expect(page).toHaveTitle('Design Study: Scaling Out an LLM Evaluation Pipeline | Mrityunjay Kumar');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    /\/studies\/eval-pipeline\.html$/
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scaling out an LLM evaluation pipeline');
  const chapterIds = [
    'problem', 'evaluation', 'baseline', 'boundaries', 'scale-out', 'temporal', 'claims',
    'results', 'issues',
    'failure', 'metrics', 'decisions', 'validity', 'alignment', 'design-doc',
  ];
  expect(await page.locator('#reference > section[id]').evaluateAll(
    (sections) => sections.map((section) => section.id)
  )).toEqual(chapterIds);
  await expect(page.locator('#reference')).not.toHaveAttribute('open', '');
  await expect(page.locator('pre.mermaid svg')).toHaveCount(0);
  await page.locator('#reference > summary').click();
  await expect(page.locator('.arch-services > li')).toHaveCount(3);
  await expect(page.locator('#failure tbody tr')).toHaveCount(5);
  // Formulas are typeset by KaTeX at build time; the TeX source travels in the MathML annotation.
  await expect(page.locator('#metrics .formula-grid .katex')).toHaveCount(3);
  await expect(page.locator('#metrics annotation').last()).toHaveText(/\\text\{graded\} \+ \\text\{failed\} \+ \\text\{cancelled\} = \\text\{total\}/);

  // Whitespace guard: multi-line prose next to inline elements must keep its spaces
  // (Astro 7's default 'jsx' compression drops them: "must behonest").
  await expect(page.locator('#problem')).toContainText('the report must be honest under failure');
  await expect(page.locator('#evaluation')).toContainText('keyed by (generation_id, grader_version, grader_config_hash)');
  await expect(page.locator('#evaluation')).toContainText('simple and honest: accuracy');
  await expect(page.getByRole('contentinfo').getByRole('link')).toHaveText(['Home', 'Research notes', 'Source']);

  // All five design-doc diagrams render natively through Mermaid, without parse errors.
  await expect(page.locator('html')).toHaveAttribute('data-mermaid', 'rendered', { timeout: 30_000 });
  // Mermaid's HTML-label measurement once inflated layouts to ~16,000 units; labels must stay SVG text.
  const diagramSizes = await page.locator('pre.mermaid svg').evaluateAll((svgs) =>
    svgs.map((svg) => ({ box: svg.getAttribute('viewBox'), labels: svg.querySelectorAll('text, foreignObject').length }))
  );
  expect(diagramSizes).toHaveLength(15);
  for (const { box, labels } of diagramSizes) {
    const [, , width, height] = (box ?? '').split(/\s+/).map(Number);
    expect(width, box ?? '').toBeLessThan(10_000);
    expect(height, box ?? '').toBeLessThan(10_000);
    expect(labels).toBeGreaterThan(0);
  }
  for (const n of [1, 2, 3, 4, 5]) {
    await expect(page.locator(`#figure-${n} pre.mermaid svg`)).toHaveCount(1);
  }
  expect(await page.locator('pre.mermaid').evaluateAll(
    (blocks) => blocks.filter((block) => /Syntax error|Parse error/i.test(block.textContent ?? '')).length
  )).toBe(0);
  expect(await diagramText(page, 'figure-1')).toContain('Transactional Outbox');
  expect(await diagramText(page, 'figure-3')).toContain('GRADE_RETRY_WAIT');
  expect(await diagramText(page, 'figure-3')).toContain('ESCALATED');
  expect(await diagramText(page, 'figure-5')).toContain('Grader validation report');

  // Study diagrams: point-in-time binary eval, scaled data model, scale-out plane.
  for (const id of ['eval-identity', 'data-model', 'scale-plane']) {
    await expect(page.locator(`#${id} pre.mermaid svg`)).toHaveCount(1);
  }
  expect(await diagramText(page, 'eval-identity')).toContain('verdict = 0 or 1');
  expect(await diagramText(page, 'data-model')).toContain('GRADING_RESULT');
  expect(await diagramText(page, 'scale-plane')).toContain('Quota limiter');
  await expect(page.locator('#claims table.claims tbody tr')).toHaveCount(8);

  // Temporal mini workers: both diagrams render, each reason names what it replaces.
  for (const id of ['temporal-pools', 'temporal-flow']) {
    await expect(page.locator(`#${id} pre.mermaid svg`)).toHaveCount(1);
  }
  expect(await diagramText(page, 'temporal-pools')).toContain('Grade workers');
  expect(await diagramText(page, 'temporal-flow')).toContain('BatchWorkflow');
  await expect(page.locator('#temporal .reason-grid > li')).toHaveCount(7);
  await expect(page.locator('#temporal .reason-grid .replaces')).toHaveCount(7);
  await expect(page.locator('#temporal')).toContainText('51,200 events');

  // Sizing estimate and the main issues at that scale. The throughput and latency figures
  // are estimates from environment math and must never be presented as measured.
  await expect(page.locator('.hero-facts')).toContainText('1,000 evals/hour');
  await expect(page.locator('.hero-facts')).toContainText('Est. P99 latency');
  await expect(page.locator('#results')).toContainText('estimates from environment math, not measurements from a run');
  await expect(page.locator('main')).not.toContainText(/Measured on the running system|Measured at 1,000|Measured results|Measured latency/);
  await expect(page.locator('#results .status-split')).toContainText('Exists today');
  await expect(page.locator('#results .status-split')).toContainText('Prometheus metrics and Grafana dashboards');
  for (const id of ['latency', 'retry-state', 'observability']) {
    await expect(page.locator(`#${id} pre.mermaid svg`)).toHaveCount(1);
  }
  await expect(page.locator('#results')).toContainText('24 minutes at P50, 26 minutes at P95, and 60 minutes at P99');
  await expect(page.locator('#issues .issue-grid > li h3')).toHaveText([
    'Backed-up queue', 'Throttling', 'Retry and lineage tracking',
    'Retry from saved state', 'Analytics integration', 'Telemetry and observability',
  ]);
  expect(await diagramText(page, 'observability')).toContain('Prometheus');
  expect(await diagramText(page, 'retry-state')).toContain('same pins');
  await expect(page.locator('#claims .sizing annotation').first()).toHaveText('100 / 5 = 20');

  // Workload model: estimates are labeled, derived values are typeset, and the
  // first screen states problem, architecture, workload, and trade-offs.
  await expect(page.locator('.glance > div')).toHaveCount(4);
  await expect(page.locator('#results table.workload-table tbody tr')).toHaveCount(10);
  await expect(page.locator('#results .src-estimate')).toHaveCount(2);
  await expect(page.locator('#results .src-measured')).toHaveCount(0);
  await expect(page.locator('#results table.workload-table')).toContainText('Not published');
  await expect(page.locator('#temporal table.retry-table tbody tr')).toHaveCount(5);
  await expect(page.locator('#temporal')).toContainText('Two sources of truth, one each');
  expect(await diagramText(page, 'temporal-pools')).toContain('Quota limiter');
  await expect(page.locator('main')).not.toContainText(/interview|whiteboard/i);

  // Baseline (v0): architecture and schema render, API and states match it.
  for (const id of ['sketch-1', 'sketch-2']) {
    await expect(page.locator(`#${id} pre.mermaid svg`)).toHaveCount(1);
  }
  expect(await diagramText(page, 'sketch-1')).toContain('LLMGeneration Pipeline');
  expect(await diagramText(page, 'sketch-2')).toContain('ModelParameterJson');
  const sketch = page.locator('#baseline');
  await expect(sketch).toContainText('ArtifactLink, GraderIID, ttl');
  await expect(sketch).toContainText('Job_UUID_1 (same ID)');
  await expect(sketch.locator('.state-lists dd').first().locator('code'))
    .toHaveText(['Enqueue', 'InProcess', 'Cancelled', 'Finished']);
  await expect(sketch.locator('.state-lists dd').nth(1).locator('code'))
    .toHaveText(['NotProcessed', 'InProgress', 'Finished']);
  await expect(sketch.locator('table.evolution tbody tr')).toHaveCount(10);

  // The appendix carries the full doc and points its diagrams at those figures.
  const designDoc = page.locator('#design-doc .design-doc');
  await expect(designDoc).toContainText('Grader UUID safety');
  await expect(designDoc.locator('.doc-figure-ref a')).toHaveText(['Figure 1', 'Figure 2', 'Figure 3', 'Figure 4', 'Figure 5']);
  await expect(designDoc).toContainText('Evidence: a public judge against expert labels');
  expect(await designDoc.locator('.katex').count()).toBeGreaterThan(100);

  // Measurement validity and judge alignment: formulas, chart, and tables built from the analysis JSON.
  await expect(page.locator('#validity .formula-cards > li .katex-display')).toHaveCount(5);
  await expect(page.locator('#alignment .agreement-svg')).toHaveCount(2);
  await expect(page.locator('#alignment .agreement-svg .bar')).toHaveCount(24);
  await expect(page.locator('#alignment .chart-data tbody tr')).toHaveCount(8);
  await expect(page.locator('#alignment .finding-list > li')).toHaveCount(3);
  await expect(page.locator('#alignment table.alignment-table').last().locator('tbody tr')).toHaveCount(4);
  await expect(page.locator('#alignment')).toContainText('Rater equivalence');

  // Math is typeset, never written in Unicode or left as raw TeX.
  await expect(page.locator('.katex-error')).toHaveCount(0);
  const looseMath = await page.locator('main').evaluate((main) => {
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const hits: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || el.closest('.katex, pre.mermaid, svg, code, script, style')) continue;
      const text = node.textContent ?? '';
      if (/[≤≥±×−√ΣλμθκτΔ]|\$[^$\s][^$]*\$/.test(text)) hits.push(text.trim().slice(0, 80));
    }
    return hits;
  });
  expect(looseMath).toEqual([]);
  await expect(designDoc.locator('pre.mermaid, code.language-mermaid')).toHaveCount(0);

  const sitemapIndex = await request.get('/sitemap-index.xml');
  const sitemapLocation = (await sitemapIndex.text()).match(/<loc>([^<]+)<\/loc>/)?.[1];
  expect(sitemapLocation).toBeTruthy();
  const sitemap = await request.get(new URL(sitemapLocation!).pathname);
  expect(await sitemap.text()).toContain('/studies/eval-pipeline.html');

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBe(width);
  }
});