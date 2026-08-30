import { expect, test } from '@playwright/test';

const privateMarker = '7,000 containers';

test('published page stays generic and exposes complete metadata', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Mrityunjay Kumar | Senior ML Engineer');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'I build systems that stay reliable'
  );
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByText(privateMarker, { exact: false })).toHaveCount(0);

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://mrityunjaykumar911.github.io/'
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    /\/images\/mrityunjay-portrait\.jpg$/
  );

  const portrait = page.getByRole('img', { name: 'Portrait of Mrityunjay Kumar' });
  await expect(portrait).toBeVisible();
  expect(
    await portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
  ).toBe(true);
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
    'I build systems that stay reliable'
  );
  await expect(page.getByText(privateMarker, { exact: false })).toHaveCount(0);
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