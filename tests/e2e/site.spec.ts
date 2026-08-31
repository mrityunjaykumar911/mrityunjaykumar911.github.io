import { expect, test } from '@playwright/test';

const privateMarker = '7,000 containers';
const previewOnlyMarkers = [
  privateMarker,
  'corrupt reward signal',
  'RL reward',
  'PowerPoint Agent v1.1',
];

test('published page stays generic and exposes complete metadata', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Mrityunjay Kumar | Senior ML Engineer');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'I build ML systems that stay reliable'
  );
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
      name: 'I build distributed infrastructure that makes LLM agents reliable in production.',
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
  await expect(page.getByText('Co-authored Rolis', { exact: false })).toBeVisible();
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

test('landing viewport presents the reliability trace design system', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const deliveryPath = page.getByRole('list', { name: 'Delivery path' });
  await expect(deliveryPath).toBeVisible();
  await expect(deliveryPath.getByRole('listitem')).toHaveText([
    /01\s+Frame the problem/,
    /02\s+Build the system/,
    /03\s+Prove the signal/,
    /04\s+Operate at scale/,
  ]);

  const heroHeading = page.getByRole('heading', { level: 1 });
  expect(await heroHeading.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    'Bricolage Grotesque'
  );

  const signalStrip = page.getByRole('region', { name: 'At a glance' });
  const signalBox = await signalStrip.boundingBox();
  expect(signalBox).not.toBeNull();
  expect(signalBox!.y).toBeLessThan(900);

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
    ['.signal-strip p', 16],
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

  const signalStrip = page.getByRole('region', { name: 'At a glance' });
  expect(await signalStrip.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(232, 238, 235)'
  );
  expect(
    await signalStrip.locator('p').first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    )
  ).toBeGreaterThanOrEqual(14);

  const metadataSelectors = [
    '.wordmark-role',
    '.site-nav',
    '.delivery-path',
    '.evidence-label',
    '.research-section::before',
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
    'rgb(5, 91, 80)'
  );
  expect(await footer.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(5, 91, 80)'
  );
  expect(await contact.evaluate((element) => getComputedStyle(element, '::after').content)).toBe(
    'none'
  );
});

test('experience and research read as an evidence system', async ({ page }) => {
  await page.goto('/');

  const microsoftRole = page.locator('.experience').filter({ hasText: 'Microsoft' }).first();
  await expect(microsoftRole.getByText('Summary', { exact: true })).toBeVisible();
  await expect(microsoftRole.getByText('Accomplishments', { exact: true })).toBeVisible();

  const proofRegistry = page.getByRole('list', { name: 'Research proof registry' });
  await expect(proofRegistry).toBeVisible();
  await expect(proofRegistry.getByRole('listitem')).toHaveCount(9);

  const capabilityMatrix = page.getByRole('group', { name: 'Core capability matrix' });
  await expect(capabilityMatrix).toBeVisible();
  expect(
    await capabilityMatrix.evaluate((element) => getComputedStyle(element).borderLeftWidth)
  ).toBe('0px');
});

test('delivery trace motion communicates progress and respects reduced motion', async ({ page }) => {
  await page.goto('/');

  const traceLine = page.locator('[data-trace-line]');
  await expect(traceLine).toHaveAttribute('aria-hidden', 'true');
  expect(await traceLine.evaluate((element) => getComputedStyle(element).animationName)).toContain(
    'trace-draw'
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  expect(
    await traceLine.evaluate((element) => element.getAnimations()[0]?.effect?.getComputedTiming().duration)
  ).toBeLessThanOrEqual(0.01);
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
  expect(robots).toContain('Disallow: /latest.html');
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
    'I build ML systems that stay reliable'
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
      'https://mrityunjaykumar911.github.io/'
    );
  });
}

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

test('portrait badge remains inside the photo and clear of its caption', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?flags=latest');

  const frame = await page.locator('.portrait-frame').boundingBox();
  const badge = await page.locator('.systems-note').boundingBox();
  const caption = await page.locator('.portrait-note').boundingBox();

  expect(frame).not.toBeNull();
  expect(badge).not.toBeNull();
  expect(caption).not.toBeNull();
  expect(badge!.y).toBeGreaterThanOrEqual(frame!.y);
  expect(badge!.y + badge!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
  expect(badge!.y + badge!.height).toBeLessThan(caption!.y);
});