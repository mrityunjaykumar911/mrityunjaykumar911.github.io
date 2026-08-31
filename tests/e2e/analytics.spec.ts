import { expect, test } from '@playwright/test';

const MEASUREMENT_ID = 'G-EEGFTXJWGJ';

/**
 * The first two checks are network-independent — they only look at the page
 * itself, so they never flake. The third makes a real request to Google and
 * asserts a measurement hit leaves the browser; it depends on the CI runner
 * reaching *.google-analytics.com (GitHub-hosted runners can). `retries: 2`
 * in playwright.config absorbs transient blips.
 */

test('gtag.js snippet is present and initialised on every page', async ({ page }) => {
  for (const path of ['/', '/latest.html', '/does-not-exist']) {
    const response = await page.goto(path);
    // /does-not-exist should serve the 404 page (status 404) but still have GA.
    expect(response, `no response for ${path}`).not.toBeNull();

    const loaderSrc = await page
      .locator(`script[src*="googletagmanager.com/gtag/js"]`)
      .getAttribute('src');
    expect(loaderSrc, `loader missing on ${path}`).toContain(`id=${MEASUREMENT_ID}`);

    const dataLayer = await page.evaluate(() =>
      (window as unknown as { dataLayer?: unknown[] }).dataLayer?.map((entry) =>
        Array.from(entry as ArrayLike<unknown>)
      )
    );
    expect(dataLayer, `dataLayer not populated on ${path}`).toEqual(
      expect.arrayContaining([
        ['js', expect.anything()],
        ['config', MEASUREMENT_ID],
      ])
    );

    expect(await page.evaluate(() => typeof (window as { gtag?: unknown }).gtag)).toBe(
      'function'
    );
  }
});

test('a page_view measurement hit is actually sent to Google', async ({ page }) => {
  const collectHits: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/google-analytics\.com$/.test(url.hostname) && url.pathname.endsWith('/collect')) {
      collectHits.push(url);
    }
  });

  // Keep the promise pending across navigation, then assert the loader
  // actually came back from Google's CDN.
  const loaderPromise = page.waitForResponse(
    (r) => r.url().includes('googletagmanager.com/gtag/js'),
    { timeout: 20_000 }
  );
  await page.goto('/');
  const loader = await loaderPromise;
  expect(loader.ok(), 'gtag.js did not load 2xx').toBe(true);

  await expect
    .poll(() => collectHits.length, { timeout: 20_000, message: 'no /collect hit fired' })
    .toBeGreaterThan(0);

  const pageView = collectHits.find(
    (u) =>
      u.searchParams.get('tid') === MEASUREMENT_ID &&
      u.searchParams.get('en') === 'page_view'
  );
  expect(pageView, 'no page_view hit for the right measurement id').toBeTruthy();
  // `dl` is the page the hit is attributed to (Chrome may drop the port).
  expect(pageView!.searchParams.get('dl')).toContain('127.0.0.1');
  expect(pageView!.searchParams.get('v')).toBe('2'); // GA4 protocol
});
