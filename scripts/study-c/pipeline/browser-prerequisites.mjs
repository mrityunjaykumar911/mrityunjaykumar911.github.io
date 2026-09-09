import { SEMANTIC_PROTOCOL } from './semantic-contract.mjs';
import { settingOperation, validatePrerequisiteValue } from './prerequisite-values.mjs';

const selectorValid = (value) => typeof value === 'string' && value.length > 0 && value.length < 400;
const fail = (reason, id) => {
  const error = new Error(reason);
  error.prerequisite = { id, reason };
  throw error;
};

export function resolvedPrerequisites(contract, binding) {
  return (contract.semantics?.prerequisites ?? []).map((item) => {
    const choice = contract.semantics.scenarioChoices.find((candidate) => candidate.id === item.choiceId);
    const mapping = binding.prerequisites?.[item.id];
    if (!choice || !mapping) fail('unmapped_scenario_prerequisite', item.id);
    const typed = contract.semantics.version === SEMANTIC_PROTOCOL;
    try { validatePrerequisiteValue(choice, { typed }); }
    catch (error) { fail(error.message, item.id); }
    if (item.kind === 'absent' && !selectorValid(mapping.selector)) fail('invalid_absence_selector', item.id);
    if (item.kind === 'setting') {
      const expected = typed ? settingOperation(choice.value) : { value: choice.value };
      if (!selectorValid(mapping.selector) || !['select', 'fill'].includes(mapping.op) || mapping.value !== expected.value || typed && mapping.op !== expected.op) fail('unsupported_scenario_setting', item.id);
      const steps = binding.actions[item.actionId];
      const settingStep = steps?.findIndex((operation) => operation.op === mapping.op && operation.selector === mapping.selector && operation.value === mapping.value) ?? -1;
      if (settingStep < 0) fail('scenario_setting_not_explicit', item.id);
        const commitActionId = mapping.commitActionId ?? item.actionId;
        const commitSteps = binding.actions[commitActionId];
        if (typed && (!contract.actions.some((action) => action.id === commitActionId) || !Array.isArray(commitSteps) ||
          !Number.isInteger(mapping.commitStep) || mapping.commitStep < 0 || mapping.commitStep >= commitSteps.length ||
          commitActionId === item.actionId && mapping.commitStep <= settingStep ||
          !['click', 'tap', 'press'].includes(commitSteps[mapping.commitStep]?.op))) fail('setting_commit_order_invalid', item.id);
    }
    if (item.kind === 'capability') {
      const observable = binding.observables[item.observableId];
      if (!['in-page', 'notification'].includes(mapping.channel) || mapping.channel !== choice.value ||
          mapping.channel === 'notification' && observable?.op !== 'notificationCount' ||
          mapping.channel === 'in-page' && !['visible', 'exists', 'count', 'textIncludes'].includes(observable?.op)) fail('unsupported_delivery_channel', item.id);
    }
    return { ...item, choice, mapping, typed };
  });
}

export async function checkInitialPrerequisites(page, prerequisites, checks, phase) {
  for (const item of prerequisites) {
    if (item.kind === 'absent') {
      const labels = await page.locator(item.mapping.selector).allTextContents();
      const matches = labels.filter((label) => label.trim() === item.choice.value).length;
      checks.push({ id: item.id, phase, kind: item.kind, value: item.choice.value, matches });
      if (matches) fail('scenario_name_conflict', item.id);
    }
    if (item.kind === 'capability' && phase === 'before-setup') checks.push({ id: item.id, phase, channel: item.mapping.channel, status: 'bound_not_yet_observed' });
  }
}

export async function applyScenarioSetting(page, operation, prerequisites, actionId, checks, pending = new Map()) {
  const items = prerequisites.filter((item) => item.kind === 'setting' && item.actionId === actionId &&
    item.mapping.selector === operation.selector && item.mapping.op === operation.op && item.mapping.value === operation.value);
  if (!items.length) return false;
  for (const item of items) {
    const locator = page.locator(operation.selector);
    if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) fail('unsupported_scenario_setting', item.id);
    try {
      if (item.typed) {
        const actual = await locator.evaluate((element) => ({ tag: element.tagName, type: element.type }));
        const expected = item.choice.value.type;
        if (expected === 'option-label' && actual.tag !== 'SELECT' ||
            ['date', 'datetime-local'].includes(expected) && (actual.tag !== 'INPUT' || actual.type !== expected) ||
            expected === 'text' && !(actual.tag === 'TEXTAREA' || actual.tag === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password'].includes(actual.type))) fail('scenario_setting_control_type_mismatch', item.id);
      }
      if (operation.op === 'select') {
        const options = await locator.locator('option').allTextContents();
        if (!options.includes(operation.value)) fail('unsupported_scenario_setting', item.id);
        await locator.selectOption({ label: operation.value });
      } else {
        const value = item.typed && item.choice.value.type === 'datetime-local' && operation.value.length === 19 && operation.value.endsWith(':00')
          ? operation.value.slice(0, 16) : operation.value;
        await locator.fill(value);
      }
      const observed = operation.op === 'select' ? await locator.locator('option:checked').textContent() : await locator.inputValue();
      if (!sameSettingValue(item, observed)) fail('scenario_setting_not_applied', item.id);
      checks.push({ id: item.id, actionId, status: 'configured', value: observed });
      if (item.typed) pending.set(item.id, { status: 'pending', actionId, value: observed });
    } catch (error) { if (error.prerequisite) throw error; fail('unsupported_scenario_setting', item.id); }
  }
  return true;
}

function sameSettingValue(item, observed) {
  const expected = item.mapping.value;
  if (item.typed && item.choice.value.type === 'datetime-local') {
    const seconds = (value) => value.length === 16 ? `${value}:00` : value;
    return seconds(observed) === seconds(expected);
  }
  return observed === expected;
}

export async function checkSettingsBeforeCommit(page, prerequisites, actionId, stepIndex, checks, pending = new Map()) {
  const verified = [];
  for (const item of prerequisites.filter((candidate) => candidate.typed && candidate.kind === 'setting' && (candidate.mapping.commitActionId ?? candidate.actionId) === actionId && candidate.mapping.commitStep === stepIndex)) {
    const receipt = pending.get(item.id);
    if (!receipt && item.actionId !== actionId) continue;
    if (receipt?.status !== 'pending') fail('scenario_setting_not_configured_for_commit', item.id);
    const locator = page.locator(item.mapping.selector);
    if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) fail('scenario_setting_not_applied_at_commit', item.id);
    const observed = item.mapping.op === 'select' ? await locator.locator('option:checked').textContent() : await locator.inputValue();
    if (!sameSettingValue(item, observed) || !await locator.evaluate((element) => element.checkValidity())) fail('scenario_setting_not_applied_at_commit', item.id);
    checks.push({ id: item.id, actionId, settingActionId: item.actionId, stepIndex, status: 'verified-before-commit', value: observed });
    verified.push(item.id);
  }
  return verified;
}