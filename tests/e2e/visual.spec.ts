import { expect, test } from '@playwright/test';

test.skip(process.platform !== 'win32', 'Pixel baselines are calibrated for Windows rendering.');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
});

test('first viewport remains visually stable', async ({ page }) => {
  await expect(page).toHaveScreenshot('landing-1440x900.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.003,
  });
});

test('contact transition and focus rail remain visually stable', async ({ page }) => {
  const contact = page.locator('.contact-section');
  await contact.scrollIntoViewIfNeeded();

  const rail = page.locator('.contact-areas');
  const [contactBox, railBox] = await Promise.all([
    contact.boundingBox(),
    rail.boundingBox(),
  ]);

  expect(contactBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(railBox!.x).toBeCloseTo(contactBox!.x + 160, 0);
  expect(railBox!.x + railBox!.width).toBeCloseTo(contactBox!.x + contactBox!.width - 160, 0);

  await expect(contact).toHaveScreenshot('contact-section-1440.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.003,
  });
});