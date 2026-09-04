import { expect, test } from '@playwright/test';

const privateMarker = '7,000 containers';
const previewOnlyMarkers = [
  privateMarker,
  'corrupt reward signal',
  'RL reward',
  'PowerPoint Agent v1.1',
];

test('published content does not use em dashes', async ({ page, request }) => {
  for (const path of ['/', '/latest.html']) {
    await page.goto(path);
    expect(await page.locator('body').innerText(), path).not.toContain('—');
  }

  const crawlerContext = await request.get('/llms.txt');
  expect(await crawlerContext.text(), '/llms.txt').not.toContain('—');
});

test('published page stays generic and exposes complete metadata', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Mrityunjay Kumar | Senior ML Engineer');
  const thesis = 'I build distributed infrastructure that makes LLM agents reliable in production';
  await expect(page.getByRole('heading', { level: 1 })).toContainText(thesis);
  await expect(page.getByText(thesis, { exact: false })).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  for (const marker of previewOnlyMarkers) {
    await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
  }

  const microsoftRole = page.locator('.experience').filter({ hasText: 'Microsoft' }).first();
  await expect(
    microsoftRole.getByText('reduced evaluation time by 4.6x', { exact: false })
  ).toBeVisible();
  for (const tag of [
    'ML systems',
    'Inference & serving infrastructure',
    'Model evaluation',
    'Fine-tuning & MLOps',
  ]) {
    await expect(microsoftRole.getByText(tag, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole('heading', {
      name: "Let's talk about production AI infrastructure.",
    })
  ).toBeVisible();
  const focusAreas = page.getByRole('list', { name: 'Areas of focus' });
  for (const area of ['Inference engines', 'Rigorous evals', 'RL systems at scale']) {
    await expect(focusAreas.getByRole('listitem').filter({ hasText: area })).toBeVisible();
  }
  await expect(
    page.locator('p').filter({ hasText: 'I take complex systems from 0 → 1' })
  ).toBeVisible();

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
    page.getByText('Graduate Research Assistant · Stony Brook University · 2019–2020', {
      exact: false,
    })
  ).toBeVisible();
  const researchAssistantRole = page.locator('.experience').filter({
    hasText: 'Graduate Research Assistant',
  });
  await expect(
    researchAssistantRole.getByText('published at EuroSys 2022', { exact: false })
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
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');

  const emailLink = page.getByRole('link', { name: 'Email' });
  await expect(emailLink).toHaveAttribute('href', '#contact-email');
  await expect(emailLink).toHaveAttribute('id', 'contact-email');
  const noscriptText = await page.locator('.contact-links noscript').textContent();
  expect(noscriptText).toContain('Enable JavaScript to reveal my email address');

  await context.close();
});

test('landing viewport presents a clear thesis and proof', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const heroHeading = page.getByRole('heading', { level: 1 });
  await expect(heroHeading).toContainText(
    'distributed infrastructure that makes LLM agents reliable in production'
  );
  await expect(page.locator('.hero-intro')).toContainText(
    'latency, throughput, and fault recovery'
  );
  await expect(page.getByRole('list', { name: 'Delivery path' })).toHaveCount(0);
  expect(await heroHeading.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    'Inter'
  );

  const signalStrip = page.getByRole('region', { name: 'Selected evidence' });
  for (const [value, label] of [
    ['Millions-scale', 'request workloads'],
    ['100M+', 'documents generated'],
    ['100M DAU', 'product reach'],
    ['Applied science', 'evaluation · ML · systems'],
  ]) {
    const signal = signalStrip.locator('.signal').filter({ hasText: value });
    await expect(signal.locator('strong')).toHaveText(value);
    await expect(signal.locator('span')).toHaveText(label);
  }
  const signalBox = await signalStrip.boundingBox();
  expect(signalBox).not.toBeNull();
  expect(signalBox!.y).toBeLessThan(900);

  const [headlineBox, introBox, firstSignalBox] = await Promise.all([
    heroHeading.boundingBox(),
    page.locator('.hero-intro').boundingBox(),
    signalStrip.locator('.signal strong').first().boundingBox(),
  ]);
  expect(headlineBox).not.toBeNull();
  expect(introBox).not.toBeNull();
  expect(firstSignalBox).not.toBeNull();
  expect(introBox!.x).toBeCloseTo(headlineBox!.x, 0);
  expect(firstSignalBox!.x).toBeCloseTo(headlineBox!.x, 0);

  await expect(page.locator('.experience-number')).toHaveCount(0);
});

test('ultrawide view uses the available canvas without shrinking the portfolio', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 1600 });
  await page.goto('/');

  const hero = await page.locator('.hero').boundingBox();
  const portrait = await page.locator('.hero-visual').boundingBox();
  const headingSize = await page
    .getByRole('heading', { level: 1 })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

  expect(hero).not.toBeNull();
  expect(portrait).not.toBeNull();
  expect(hero!.width).toBeGreaterThanOrEqual(2000);
  expect(portrait!.width).toBeGreaterThanOrEqual(440);
  expect(headingSize).toBeGreaterThanOrEqual(96);

  for (const [selector, minimum] of [
    ['.site-nav', 14],
    ['.signal strong', 32],
    ['.experience-summary', 20],
    ['.experience-lead li', 18],
    ['.research-note h3', 22],
    ['.capability dd', 18],
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

  const signalStrip = page.getByRole('region', { name: 'Selected evidence' });
  expect(await signalStrip.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(255, 255, 255)'
  );
  expect(
    await signalStrip.locator('.signal span').first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    )
  ).toBeGreaterThanOrEqual(13);

  const metadataSelectors = [
    '.wordmark-role',
    '.site-nav',
    '.evidence-label',
    '.contact-areas',
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
  expect(await contact.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(246, 247, 248)'
  );
  expect(await footer.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(11, 12, 14)'
  );
  expect(await contact.evaluate((element) => getComputedStyle(element, '::after').content)).toBe(
    'none'
  );
});

test('experience and research read as an evidence system', async ({ page }) => {
  await page.goto('/');

  const microsoftRole = page.locator('.experience').filter({ hasText: 'Microsoft' }).first();
  await expect(microsoftRole.getByText('Accomplishments', { exact: true })).toBeVisible();
  await expect(microsoftRole.locator('.experience-head .company')).toHaveText('Microsoft');
  await expect(microsoftRole.locator('.experience-head .role')).toHaveText('Senior ML Engineer');
  await expect(microsoftRole.locator('.experience-head .org')).toContainText(
    'May 2022 to Present · Mountain View, CA'
  );

  const proofRegistry = page.getByRole('list', { name: 'Research proof registry' });
  await expect(proofRegistry).toBeVisible();
  await expect(proofRegistry.getByRole('listitem')).toHaveCount(9);

  await proofRegistry.scrollIntoViewIfNeeded();
  const researchLink = page.locator('.site-nav a[href="#research"]');
  await expect(researchLink).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => page.locator('.site-header').evaluate((element) =>
    getComputedStyle(element).color
  )).toBe('rgb(255, 255, 255)');
  await expect.poll(() => page.locator('.site-header').evaluate((element) =>
    getComputedStyle(element).backgroundColor
  )).toBe('rgb(11, 12, 14)');

  await researchLink.click();
  await expect.poll(async () => {
    const [headerBox, researchBox] = await Promise.all([
      page.locator('.site-header').boundingBox(),
      page.locator('#research').boundingBox(),
    ]);
    return Math.abs(researchBox!.y - (headerBox!.y + headerBox!.height));
  }).toBeLessThanOrEqual(1);

  const capabilityMatrix = page.getByRole('group', { name: 'Core capability matrix' });
  await expect(capabilityMatrix).toBeVisible();
  expect(
    await capabilityMatrix.evaluate((element) => getComputedStyle(element).borderLeftWidth)
  ).toBe('0px');
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
    'I build distributed infrastructure that makes LLM agents reliable in production'
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
  expect(
    messages.some((message) =>
      message.includes('→ http://127.0.0.1:4173/?preview')
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
      'RL Infrastructure and Applied AI'
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

test('portrait sits above its caption without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?flags=latest');

  const frame = await page.locator('.portrait-frame').boundingBox();
  const caption = await page.locator('.portrait-note').boundingBox();

  expect(frame).not.toBeNull();
  expect(caption).not.toBeNull();
  expect(caption!.y).toBeGreaterThanOrEqual(frame!.y + frame!.height - 1);
});