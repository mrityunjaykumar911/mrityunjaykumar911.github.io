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

test('contact section remains visually stable', async ({ page }) => {
  const contact = page.locator('.contact-section');
  await contact.scrollIntoViewIfNeeded();

  await expect(contact).toHaveScreenshot('contact-section-1440.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.003,
  });
});