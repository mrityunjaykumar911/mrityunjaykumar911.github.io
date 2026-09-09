import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

export async function inspectSavedPrerequisites({ artifactPath, samples }) {
  const artifactUrl = pathToFileURL(artifactPath).href;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC', serviceWorkers: 'block' });
  try {
    await context.route('**/*', (route) => route.request().isNavigationRequest() && route.request().url() === artifactUrl ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(4000);
    await page.clock.install({ time: new Date('2030-01-01T12:00:00Z') });
    await page.goto(artifactUrl, { waitUntil: 'load', timeout: 15000 });
    const initialLabels = await page.locator('#catList .cat-left > span:last-child, #list .title').allTextContents();
    await page.locator('#addTaskBtn').click();
    await page.clock.runFor(100);
    const categoryLabels = await page.locator('#category option').allTextContents();
    const offsetLabels = await page.locator('#offset option').allTextContents();
    const defaultOffset = await page.locator('#offset option:checked').textContent();
    const dateType = await page.locator('#due').getAttribute('type');
    const checks = [];
    for (const sample of samples) {
      for (const contract of sample.model.contracts) {
        for (const choice of contract.semantics?.scenarioChoices ?? []) {
          const item = { sampleId: sample.id, contractId: contract.id, choiceId: choice.id, kind: choice.kind, value: choice.value };
          if (choice.kind === 'fresh-name') checks.push({ ...item, check: 'initial-label-absence', matches: initialLabels.filter((label) => label.trim() === choice.value).length });
          else if (choice.kind === 'delivery-channel') checks.push({ ...item, check: 'executor-channel-token', supported: ['in-page', 'notification'].includes(choice.value) });
          else if (choice.kind === 'setting') {
            const nativeDate = await page.locator('#due').evaluate((element, value) => {
              const input = element.cloneNode();
              input.value = value;
              return { accepted: input.value === value && input.checkValidity(), storedValue: input.value };
            }, choice.value);
            checks.push({ ...item, check: 'literal-setting-compatibility', categoryOption: categoryLabels.includes(choice.value), offsetOption: offsetLabels.includes(choice.value),
              datetimeInput: nativeDate, caveat: 'Diagnostic compatibility with these inspected controls, not a generated binding or proof of all possible UI paths' });
          }
        }
      }
    }
    await page.locator('#offset').selectOption({ label: 'At due time' });
    const offsetReadback = await page.locator('#offset option:checked').textContent();
    await page.locator('#due').fill('2030-01-03T12:00');
    const dateReadback = await page.locator('#due').inputValue();
    return { phase: 'offline-prerequisite-inspection', initialLabels, categoryLabels, offsetLabels, defaultOffset, dateType, checks,
      positiveControl: { offsetReadback, dateReadback, taskSubmitted: false },
      limitations: ['Manual diagnostic selectors for the saved app; no generated bindings', 'No task saved, no reminder delivery or category-association workflow tested',
        'New browser context only; artifact bytes remain untouched', 'Display-format semantics and compound action correctness still require validation'] };
  } finally { await context.close(); await browser.close(); }
}