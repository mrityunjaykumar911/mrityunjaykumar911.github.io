export const PREREQUISITE_VALUE_PROTOCOL = 'typed-prerequisite-values-v1';

export function settingOperation(setting) {
  if (!setting || typeof setting !== 'object' || Array.isArray(setting) ||
      Object.keys(setting).some((key) => !['type', 'value'].includes(key)) ||
      typeof setting.value !== 'string' || !setting.value.trim() || setting.value.length > 1000 ||
      !['text', 'option-label', 'date', 'datetime-local'].includes(setting.type)) throw new Error('invalid_typed_setting');
  if (setting.type === 'date' || setting.type === 'datetime-local') {
    const pattern = setting.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
    if (!pattern.test(setting.value)) throw new Error('invalid_native_date_setting');
    const instant = new Date(`${setting.value.slice(0, 10)}T${setting.type === 'date' ? '00:00:00' : setting.value.slice(11).padEnd(8, ':00')}Z`);
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== setting.value.slice(0, 10) ||
        setting.type === 'datetime-local' && instant.toISOString().slice(11, 19) !== setting.value.slice(11).padEnd(8, ':00')) throw new Error('invalid_native_date_setting');
  }
  return { op: setting.type === 'option-label' ? 'select' : 'fill', value: setting.value, controlType: setting.type };
}

export function validatePrerequisiteValue(choice, { typed = true } = {}) {
  if (choice.kind === 'setting') {
    if (typed) return settingOperation(choice.value);
    if (typeof choice.value !== 'string' || !choice.value.trim()) throw new Error('invalid_legacy_setting');
  }
  if (choice.kind === 'delivery-channel' && typed && !['in-page', 'notification'].includes(choice.value)) throw new Error('unsupported_delivery_channel');
  return null;
}