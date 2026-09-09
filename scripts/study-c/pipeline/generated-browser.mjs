import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sha256 } from './task-contracts.mjs';
import { resolvedPrerequisites, checkInitialPrerequisites, applyScenarioSetting, checkSettingsBeforeCommit } from './browser-prerequisites.mjs';

export const BROWSER_EXECUTOR_PROTOCOL = 'contextual-cross-action-replay-v3';

export const BROWSER_BINDING_SYSTEM = `Map the supplied generated contract's abstract actions and observables to this HTML. Do not invent tests or expectations. Return JSON only:
{"setup":[], "actions":{"actionId":[steps]}, "observables":{"observableId":{"op":"count|number|exists|checked|visible|textIncludes|notificationCount", "selector":"CSS selector", "text":"optional substring"}}, "contexts":{"actionId":[{"selector":"unique context selector", "state":"visible|hidden", "before":[steps], "after":[steps]}]}}. contexts is optional.
Steps: {"op":"click|fill|select|press|advance|reload", "selector":"CSS selector", "value":"string", "ms":1000}. select uses visible option label. advance uses ms and advances the browser clock (maximum 86400000); reload navigates the same artifact. No JavaScript. No assertions, expected values, transformations or constant-valued observations.
Every selector must target the specified actual DOM property, not a proxy for whether the test should pass. count returns matching element count. number reads a single element's numeric visible text or input value. exists/visible return 0 or 1. checked counts checked or aria-checked=true matched elements. textIncludes returns 0/1 for a single element. notificationCount observes notifications/alerts, optionally filtered by text. Use null for mappings that cannot be implemented. A missing element for number/textIncludes is blocked, not assumed zero. click/fill/select/press require one visible enabled element; use :has-text or :has for row-specific actions. setup is only permitted to establish the initial state required by the contract (e.g. select an All-items view). Do not erase defects through setup or silently change the contract. Each trace begins with a new empty browser context. Clock starts 2030-01-01T12:00:00Z in UTC; map date inputs accordingly if the action specifies relative time. Viewport is 390x844. Map every supplied action and observable.`;

export function validateGeneratedBinding(binding, contract) {
  if (!binding || !Array.isArray(binding.setup) || !binding.actions || !binding.observables) throw new Error('invalid_generated_binding');
  const selector = (value) => typeof value === 'string' && value.length > 0 && value.length < 400;
  const contextOperations = [];
  if (binding.contexts !== undefined) {
    if (!binding.contexts || typeof binding.contexts !== 'object' || Array.isArray(binding.contexts)) throw new Error('invalid_binding_contexts');
    for (const [actionId, contexts] of Object.entries(binding.contexts)) {
      if (!contract.actions.some((action) => action.id === actionId) || !Array.isArray(contexts) || contexts.length > 4) throw new Error('invalid_binding_contexts');
      for (const context of contexts) {
        if (!selector(context.selector) || !['visible', 'hidden'].includes(context.state) || !Array.isArray(context.before) || !Array.isArray(context.after)) throw new Error('invalid_binding_context');
        if ([...context.before, ...context.after].some((operation) => !['click', 'tap', 'fill', 'select', 'press'].includes(operation.op))) throw new Error('unsupported_context_operation');
        contextOperations.push(context.before, context.after);
      }
    }
  }
  for (const steps of [binding.setup, ...contract.actions.map(({ id }) => binding.actions[id]), ...contextOperations]) {
    if (!Array.isArray(steps) || steps.length > 20) throw new Error('unmapped_generated_action');
    for (const step of steps) {
      if (!['click', 'tap', 'fill', 'select', 'press', 'advance', 'reload'].includes(step.op)) throw new Error('unsupported_browser_operation');
      if (!['advance', 'reload'].includes(step.op) && !selector(step.selector)) throw new Error('invalid_browser_selector');
      if (step.op === 'advance' && (!Number.isSafeInteger(step.ms) || step.ms < 0 || step.ms > 86_400_000)) throw new Error('invalid_clock_advance');
      if (['fill', 'select', 'press'].includes(step.op) && (typeof step.value !== 'string' || step.value.length > 1000)) throw new Error('invalid_browser_input');
    }
  }
  for (const { id } of contract.actions) if (!binding.actions[id].length) throw new Error('empty_generated_action');
  for (const { id } of contract.observables) {
    const observation = binding.observables[id];
    if (!observation || !['count', 'number', 'exists', 'checked', 'visible', 'textIncludes', 'notificationCount'].includes(observation.op) ||
        (observation.op !== 'notificationCount' && !selector(observation.selector)) ||
        (observation.text != null && (typeof observation.text !== 'string' || observation.text.length > 1000))) throw new Error('unmapped_generated_observable');
  }
  resolvedPrerequisites(contract, binding);
  return binding;
}

export async function resolveGeneratedBinding({ contract, html, client, outDir, onProgress = () => {} }) {
  await mkdir(outDir, { recursive: true });
  const prompt = JSON.stringify({ requirement: contract.requirement, actions: contract.actions, observables: contract.observables, html });
  const requestHash = sha256(BROWSER_BINDING_SYSTEM + prompt);
  let record;
  try {
    record = JSON.parse(await readFile(path.join(outDir, 'binding-response.json'), 'utf8'));
    if (record.requestHash !== requestHash) throw new Error('binding_cache_mismatch');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(path.join(outDir, 'binding-attempt.json'), JSON.stringify({ requestHash, startedAt: new Date().toISOString() }), { flag: 'wx' });
    onProgress(`contract ${contract.id}: generating DOM binding`);
    const result = await client.generate({ system: BROWSER_BINDING_SYSTEM, prompt, maxOutputTokens: 4000,
      purpose: `binding-${contract.id}`, onProgress: ({ chars }) => onProgress(`contract ${contract.id}: binding ${chars} chars`) });
    record = { ...result, requestHash };
    await writeFile(path.join(outDir, 'binding-response.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }
  if (!record.ok) throw new Error('binding_generation_failed');
  const binding = validateGeneratedBinding(JSON.parse(record.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')), contract);
  await writeFile(path.join(outDir, 'binding.json'), `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
  return binding;
}

async function interceptionEvidence(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const point = { x: Math.max(0, rect.left) + (Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) / 2,
      y: Math.max(0, rect.top) + (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) / 2 };
    if (rect.width <= 0 || rect.height <= 0 || point.x < 0 || point.y < 0 || point.x >= innerWidth || point.y >= innerHeight) return null;
    const hit = document.elementFromPoint(point.x, point.y);
    if (!hit || hit === element || element.contains(hit)) return null;
    const describe = (node) => ({ tag: node.tagName, id: node.id || null, className: node.getAttribute('class'), role: node.getAttribute('role') });
    return { point, target: describe(element), interceptor: describe(hit),
      ancestors: [...(function* () { let node = hit.parentElement; for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) yield describe(node); })()] };
  });
}

async function steps(page, operations, prerequisites = [], actionId, checks = [], pending = new Map(), diagnosticContext = {}) {
  for (const [stepIndex, operation] of operations.entries()) {
    try {
    const verified = await checkSettingsBeforeCommit(page, prerequisites, actionId, stepIndex, checks, pending);
    if (operation.op === 'advance') { await page.clock.runFor(operation.ms); continue; }
    if (operation.op === 'reload') {
      for (const [id, receipt] of pending) pending.set(id, { ...receipt, status: 'invalidated-by-reload' });
      await page.reload({ waitUntil: 'load' }); continue;
    }
    if (await applyScenarioSetting(page, operation, prerequisites, actionId, checks, pending)) continue;
    const locator = page.locator(operation.selector);
    if (await locator.count() !== 1) throw new Error('unresolved_generated_control');
    const visible = await locator.isVisible();
    const enabled = await locator.isEnabled();
    if (!visible || !enabled) {
      const error = new Error('generated_control_unavailable');
      if (actionId) error.actionFailure = { actionId, operationIndex: stepIndex, selector: operation.selector, op: operation.op,
        matchedElements: 1, visible, enabled, reason: !visible ? 'control_hidden' : 'control_disabled' };
      throw error;
    }
    if (operation.op === 'click') await locator.click();
    if (operation.op === 'tap') await locator.tap();
    if (operation.op === 'fill') await locator.fill(operation.value);
    if (operation.op === 'select') await locator.selectOption({ label: operation.value });
    if (operation.op === 'press') await locator.press(operation.value);
    for (const id of verified) {
      pending.delete(id);
      checks.push({ id, actionId, stepIndex, status: 'commit-operation-executed' });
    }
    } catch (error) {
      let interception = null;
      if (['click', 'tap'].includes(operation.op) && /intercepts pointer events|subtree intercepts pointer events/.test(error.message ?? '')) {
        try {
          const target = page.locator(operation.selector);
          if (await target.count() === 1) interception = await interceptionEvidence(target);
        } catch {}
      }
      error.replayDiagnostic = { actionId: diagnosticContext.actionId ?? actionId ?? null,
        phase: diagnosticContext.phase ?? (actionId ? 'action' : 'setup'), operationIndex: stepIndex,
        operation, reason: interception ? 'control_intercepted' : error.prerequisite?.reason ?? error.message,
        errorName: error.name, message: String(error.message ?? error).slice(0, 8000), interception };
      throw error;
    }
  }
  await page.clock.runFor(100);
}

async function snapshot(page, contract, binding) {
  const values = {};
  for (const { id } of contract.observables) {
    const observation = binding.observables[id];
    const locator = observation.selector ? page.locator(observation.selector) : null;
    const count = locator ? await locator.count() : 0;
    if (observation.op === 'count') values[id] = count;
    else if (observation.op === 'exists') values[id] = Number(count > 0);
    else if (observation.op === 'visible') values[id] = Number(count > 0 && await locator.first().isVisible());
    else if (observation.op === 'checked') values[id] = await locator.evaluateAll((elements) => elements.filter((element) => element.checked === true || element.getAttribute('aria-checked') === 'true').length);
    else if (observation.op === 'notificationCount') values[id] = await page.evaluate((filter) => window.__studyCNotifications.filter((item) => !filter || item.includes(filter)).length, observation.text ?? '');
    else {
      if (count !== 1) throw new Error('ambiguous_generated_observation');
      const raw = await locator.evaluate((element) => 'value' in element ? element.value : element.textContent);
      if (observation.op === 'textIncludes') values[id] = Number(String(raw).includes(observation.text ?? ''));
      else {
        if (!/^\s*\d{1,9}\s*$/.test(raw)) throw new Error('non_numeric_generated_observation');
        values[id] = Number(raw);
      }
    }
  }
  return values;
}

export async function captureGeneratedTraces({ contract, html, binding, outDir, viewport = { width: 390, height: 844 } }) {
  if (!viewport || !['width', 'height'].every((key) => Number.isInteger(viewport[key]) && viewport[key] >= 240 && viewport[key] <= 4096)) throw new Error('invalid_browser_viewport');
  validateGeneratedBinding(binding, contract);
  const prerequisites = resolvedPrerequisites(contract, binding);
  await mkdir(outDir, { recursive: true });
  const artifactPath = path.join(outDir, 'artifact.html');
  await writeFile(artifactPath, html, 'utf8');
  const artifactUrl = pathToFileURL(artifactPath).href;
  const browser = await chromium.launch({ headless: true });
  const traces = [];
  try {
    for (const trace of contract.traces) {
      const context = await browser.newContext({ viewport, hasTouch: true, timezoneId: 'UTC', serviceWorkers: 'block' });
      const snapshots = [];
      const prerequisiteChecks = [];
      const pendingSettings = new Map();
      let page;
      try {
        await context.route('**/*', (route) => route.request().url() === artifactUrl && route.request().isNavigationRequest() ? route.continue() : route.abort());
        await context.addInitScript(() => {
          const events = [];
          Object.defineProperty(window, '__studyCNotifications', { get: () => events.slice() });
          window.alert = (message) => events.push(String(message));
          window.Notification = class {
            static permission = 'granted';
            static requestPermission() { return Promise.resolve('granted'); }
            constructor(title, options) { events.push(`${title} ${options?.body ?? ''}`); }
            close() {}
          };
        });
        page = await context.newPage();
        page.setDefaultTimeout(4000);
        page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
        await page.clock.install({ time: new Date('2030-01-01T12:00:00Z') });
        await page.goto(artifactUrl, { waitUntil: 'load', timeout: 10_000 });
        await checkInitialPrerequisites(page, prerequisites, prerequisiteChecks, 'before-setup');
        await steps(page, binding.setup);
        await checkInitialPrerequisites(page, prerequisites, prerequisiteChecks, 'after-setup');
        snapshots.push(await snapshot(page, contract, binding));
        const sameObservation = (first, second) => contract.observables.every((item) => first[item.id] === second[item.id]);
        const contextChecks = [];
        for (const action of trace.actions) {
          const activeContexts = [];
          for (const candidate of binding.contexts?.[action] ?? []) {
            const target = page.locator(candidate.selector);
            if (await target.count() !== 1) throw new Error('unresolved_context_selector');
            const visible = await target.isVisible();
            if (visible === (candidate.state === 'visible')) activeContexts.push(candidate);
          }
          for (const candidate of activeContexts) await steps(page, candidate.before, [], null, [], new Map(), { actionId: action, phase: 'context-before' });
          if (activeContexts.length) {
            const afterContext = await snapshot(page, contract, binding);
            if (!sameObservation(snapshots.at(-1), afterContext)) throw new Error('context_changed_model_observation');
            contextChecks.push({ actionId: action, phase: 'before', contexts: activeContexts, observations: afterContext });
          }
          await steps(page, binding.actions[action], prerequisites, action, prerequisiteChecks, pendingSettings);
          const afterAction = await snapshot(page, contract, binding);
          for (const candidate of [...activeContexts].reverse()) await steps(page, candidate.after, [], null, [], new Map(), { actionId: action, phase: 'context-after' });
          const finalObservation = await snapshot(page, contract, binding);
          if (!sameObservation(afterAction, finalObservation)) throw new Error('context_changed_model_observation');
          if (activeContexts.length) contextChecks.push({ actionId: action, phase: 'after', observations: finalObservation });
          snapshots.push(finalObservation);
        }
        traces.push({ ...trace, snapshots, prerequisiteChecks, contextChecks, pendingSettings: Object.fromEntries(pendingSettings), viewport, status: 'recorded' });
      } catch (error) {
        let diagnosticScreenshot = null;
        if (page && error.replayDiagnostic) {
          try {
            const filename = `blocked-${traces.length + 1}.png`;
            await page.screenshot({ path: path.join(outDir, filename) });
            diagnosticScreenshot = filename;
          } catch {}
        }
        traces.push({ ...trace, snapshots, prerequisiteChecks, pendingSettings: Object.fromEntries(pendingSettings), viewport, status: 'blocked',
          reason: error.prerequisite?.reason ?? (error.replayDiagnostic?.interception ? 'control_intercepted' : 'generated_browser_trace_incomplete'),
          diagnostic: error.replayDiagnostic ?? { errorName: error.name, message: String(error.message ?? error).slice(0, 8000) }, diagnosticScreenshot, prerequisite: error.prerequisite,
          ...(error.actionFailure ? { failedAction: { ...error.actionFailure, step: snapshots.length } } : {}) });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  await writeFile(path.join(outDir, 'observations.json'), `${JSON.stringify({ viewport, traces }, null, 2)}\n`, 'utf8');
  return traces;
}