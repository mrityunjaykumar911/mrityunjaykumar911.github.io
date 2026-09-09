import { SEMANTIC_PROTOCOL } from '../semantic-contract.mjs';
import { behaviorHash } from '../behavioral-model.mjs';

export function saved1267TypedFixture(sourceModel) {
  const model = structuredClone(sourceModel);
  const changes = [];
  const change = (contractId, target, object, field, value, reason) => {
    changes.push({ contractId, target, field, before: structuredClone(object[field]), after: structuredClone(value), reason });
    object[field] = value;
  };
  for (const contract of model.contracts) {
    change(contract.id, 'semantics', contract.semantics, 'version', SEMANTIC_PROTOCOL, 'Diagnostic fixture uses typed prerequisite representation; archived model stays unchanged.');
  }
  const selected = (id) => {
    const contract = model.contracts.find((item) => item.id === id);
    if (!contract) throw new Error('saved_fixture_contract_missing');
    return contract;
  };
  const setChoice = (id, choiceId, value) => {
    const contract = selected(id);
    const choice = contract.semantics.scenarioChoices.find((item) => item.id === choiceId);
    if (!choice) throw new Error('saved_fixture_choice_missing');
    change(id, choiceId, choice, 'value', value, 'Explicit inspected native control value, not inferred from prose at runtime.');
  };
  setChoice('category_mgmt', 'sc_cat_setting', { type: 'option-label', value: 'CatZ9kLmQ' });
  setChoice('date_setting', 'sc_date_setting', { type: 'datetime-local', value: '2030-01-03T12:00' });
  setChoice('auto_reminder', 'sc_rem_setting', { type: 'datetime-local', value: '2030-01-01T12:02' });
  setChoice('auto_reminder', 'sc_rem_channel', 'in-page');
  const dates = selected('date_setting');
  const dateAction = dates.actions.find((item) => item.id === 'date_submit');
  change(dates.id, dateAction.id, dateAction, 'description', 'Record DateK4pLmX with local UTC date-time 2030-01-03T12:00, save it, then reopen its editor to observe the stored date value.',
    'Diagnostic readback uses the actual stored native field, not assumptions about the locale-formatted card text.');
  const dateObservable = dates.observables.find((item) => item.id === 'date_dom');
  change(dates.id, dateObservable.id, dateObservable, 'description', 'Whether the reopened DateK4pLmX date-time input shows the stored local UTC date-time 2030-01-03T12:00.',
    'This is a labeled fixture observation change, not a claim about generated date-display semantics.');
  const reminder = selected('auto_reminder');
  change(reminder.id, 'semantics', reminder.semantics, 'scenarioChoices', [...reminder.semantics.scenarioChoices,
    { id: 'sc_rem_offset', kind: 'setting', value: { type: 'option-label', value: 'At due time' }, reason: 'Explicit test configuration overrides the saved app default of 15 minutes before; not a universal product requirement.' }],
  'Declare the required timing setting explicitly.');
  change(reminder.id, 'semantics', reminder.semantics, 'prerequisites', [...reminder.semantics.prerequisites,
    { id: 'pr_rem_offset', kind: 'setting', choiceId: 'sc_rem_offset', actionId: 'rem_submit' }], 'Require setting and readback before submission.');
  const reminderAction = reminder.actions.find((item) => item.id === 'rem_submit');
  change(reminder.id, reminderAction.id, reminderAction, 'description', 'Record RemB8wQjN with local UTC due date-time 2030-01-01T12:02, select At due time in the reminder offset control, then save.',
    'Explicit saved-app reminder configuration for this offline fixture; no default assumption.');
  const item = (name) => `#list article.card:has(.title:text-is("${name}"))`;
  const open = { op: 'click', selector: '#addTaskBtn' };
  const save = { op: 'click', selector: '#taskForm button[type="submit"]' };
  const fill = (selector, value) => ({ op: 'fill', selector, value });
  const setting = (op, selector, value, commitStep) => ({ op, selector, value, commitStep });
  const bindings = {
    record_todo: { setup: [], actions: { rec_submit: [open, fill('#title', 'Qv7NxTodoAlpha'), save] },
      observables: { rec_dom: { op: 'count', selector: item('Qv7NxTodoAlpha') } }, prerequisites: { pr_rec_absent: { selector: '#list .title' } } },
    category_mgmt: { setup: [], actions: {
      cat_add: [{ op: 'click', selector: '#addCatBtn' }, fill('#catName', 'CatZ9kLmQ'), { op: 'click', selector: '#catForm button[type="submit"]' }],
      cat_todo_submit: [open, fill('#title', 'TodoW3mKpN'), { op: 'select', selector: '#category', value: 'CatZ9kLmQ' }, save],
    }, observables: {
      cat_dom: { op: 'count', selector: '#catList .cat-left > span:last-child:text-is("CatZ9kLmQ")' },
      cat_todo_dom: { op: 'count', selector: `${item('TodoW3mKpN')}:has(.tag:text-is("CatZ9kLmQ"))` },
    }, prerequisites: { pr_cat_absent: { selector: '#catList .cat-left > span:last-child' }, pr_cat_todo_absent: { selector: '#list .title' },
      pr_cat_setting: setting('select', '#category', 'CatZ9kLmQ', 3) } },
    date_setting: { setup: [], actions: {
      date_submit: [open, fill('#title', 'DateK4pLmX'), fill('#due', '2030-01-03T12:00'), save, { op: 'click', selector: `${item('DateK4pLmX')} [data-act="edit"]` }],
    }, observables: { date_dom: { op: 'textIncludes', selector: '#due', text: '2030-01-03T12:00' } },
    prerequisites: { pr_date_absent: { selector: '#list .title' }, pr_date_setting: setting('fill', '#due', '2030-01-03T12:00', 3) } },
    auto_reminder: { setup: [], actions: {
      rem_submit: [open, fill('#title', 'RemB8wQjN'), fill('#due', '2030-01-01T12:02'), { op: 'select', selector: '#offset', value: 'At due time' }, save],
      rem_advance: [{ op: 'advance', ms: 120000 }],
    }, observables: { rem_item_dom: { op: 'count', selector: item('RemB8wQjN') }, rem_alert_dom: { op: 'count', selector: '#toasts .toast:has(strong:has-text("RemB8wQjN"))' } },
    prerequisites: { pr_rem_absent: { selector: '#list .title' }, pr_rem_setting: setting('fill', '#due', '2030-01-01T12:02', 4),
      pr_rem_offset: setting('select', '#offset', 'At due time', 4), pr_rem_cap: { channel: 'in-page' } } },
  };
  return { model, bindings, changes, sourceModelHash: behaviorHash(sourceModel), diagnosticModelHash: behaviorHash(model),
    provenance: 'Manual offline regression fixture only; not a generative repair, adjudicated specification, selected candidate, or benchmark result.' };
}