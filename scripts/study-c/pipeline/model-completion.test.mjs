import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_PROTOCOL, validateBehaviorModel, deriveSchedules, compileBehaviorContract } from './behavioral-model.mjs';
import { validateSpec } from './tla-oracle.mjs';

const equals = (value) => ({ op: 'eq', args: [{ var: 'saved' }, value] });
const contract = { id: 'Save', requirements: [{ id: 'save', statement: 'Save an item', sourceQuote: 'Save an item' }], assumptions: [],
  state: [{ id: 'saved', initial: 0, exploreMax: 1 }],
  actions: [{ id: 'SaveItem', description: 'Save one item', requirementId: 'save', enabled: equals(0), updates: { saved: 1 } }],
  observables: [{ id: 'saved', description: 'Item saved', requirementId: 'save', expression: { var: 'saved' } }],
  invariants: [{ id: 'boundedFlag', description: 'Boolean flag', requirementId: 'save', expression: { op: 'lte', args: [{ var: 'saved' }, 1] } }],
};
const completed = { ...contract, completion: { when: equals(1), requirementId: 'save', reason: 'The finite save scenario is complete after the item is saved.' } };

async function directory(context) {
  const result = await mkdtemp(path.join(tmpdir(), 'study-c-completion-'));
  context.after(() => rm(result, { recursive: true, force: true }));
  return result;
}

test('completion must be explicit, boolean and requirement-linked', () => {
  const model = { version: MODEL_PROTOCOL, contracts: [completed, { ...contract, id: 'Other' }] };
  assert.equal(validateBehaviorModel(model, 'Save an item'), model);
  for (const completion of [{ when: 1, requirementId: 'save', reason: 'bad' }, { when: true, requirementId: 'invented', reason: 'bad' }]) {
    assert.throws(() => validateBehaviorModel({ ...model, contracts: [{ ...contract, completion }, model.contracts[1]] }, 'Save an item'));
  }
  assert.equal(deriveSchedules(contract).coverage.undeclaredDeadEnds, 1);
  assert.equal(deriveSchedules(completed).coverage.completedStates, 1);
  assert.equal(deriveSchedules(completed).coverage.undeclaredDeadEnds, 0);
  assert.throws(() => deriveSchedules({ ...completed, completion: { ...completed.completion, when: true } }), /completion_has_enabled_actions/);
});

test('real TLC distinguishes declared completion, undeclared deadlock, and invalid replay', async (context) => {
  const root = await directory(context);
  const check = (name, spec) => validateSpec({ specDir: path.join(root, name), ...spec });
  const undeclared = await check('undeclared', compileBehaviorContract(contract));
  assert.equal(undeclared.detail, 'model_deadlock', JSON.stringify(undeclared));
  assert.equal(undeclared.artifactFailure, false);
  const declared = await check('declared', compileBehaviorContract(completed));
  assert.equal(declared.level, 'checked', JSON.stringify(declared));
  assert.equal(declared.distinctStates, 2);
  const trace = { actions: ['SaveItem'] };
  const correct = await check('correct', compileBehaviorContract(completed, trace, [{ saved: 0 }, { saved: 1 }]));
  assert.equal(correct.level, 'checked', JSON.stringify(correct));
  const wrong = await check('wrong', compileBehaviorContract(completed, trace, [{ saved: 0 }, { saved: 0 }]));
  assert.equal(wrong.violatedInvariant, 'SnapshotMatches', JSON.stringify(wrong));
  const impossible = await check('impossible', compileBehaviorContract(completed, { actions: ['SaveItem', 'SaveItem'] }, [{ saved: 0 }, { saved: 1 }, { saved: 1 }]));
  assert.equal(impossible.detail, 'model_deadlock', JSON.stringify(impossible));
});

test('completion does not hide a safety violation or an incorrectly enabled action', async (context) => {
  const root = await directory(context);
  const inconsistent = { ...completed, completion: { ...completed.completion, when: true } };
  const early = await validateSpec({ specDir: path.join(root, 'early'), ...compileBehaviorContract(inconsistent) });
  assert.equal(early.violatedInvariant, 'CompletionConsistent', JSON.stringify(early));
  const unsafe = { ...completed, invariants: [{ ...completed.invariants[0], expression: equals(0) }] };
  const violation = await validateSpec({ specDir: path.join(root, 'unsafe'), ...compileBehaviorContract(unsafe) });
  assert.equal(violation.violatedInvariant, 'DomainInvariant0', JSON.stringify(violation));
});

test('archived 1267 scenarios terminate only with explicit completion annotations on copies', async (context) => {
  const sourceFile = new URL('../../../.tools/study-c/quality-runs/quality-v3-1267-T-1gb-first/task-1267/shared-model/model.json', import.meta.url);
  let source;
  try { source = await readFile(sourceFile, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('archived paid run unavailable'); return; } throw error; }
  const root = await directory(context);
  const model = JSON.parse(source).model;
  const equal = (name, value) => ({ op: 'eq', args: [{ var: name }, value] });
  const both = (first, second) => ({ op: 'and', args: [first, second] });
  const completions = {
    category_management: { requirementId: 'req_category_mgmt', reason: 'Diagnostic annotation: finite create-and-assign scenario completed; not application termination.',
      when: both(equal('catExists', 1), both(equal('todoExists', 1), equal('todoTagged', 1))) },
    date_setting: { requirementId: 'req_date_setting', reason: 'Diagnostic annotation: finite set-and-edit scenario completed after the final requested edit.',
      when: both(equal('dateTodo', 1), equal('dueDay', 3)) },
  };
  for (const [id, completion] of Object.entries(completions)) {
    const saved = model.contracts.find((item) => item.id === id);
    assert.ok(saved);
    const original = await validateSpec({ specDir: path.join(root, `${id}-original`), ...compileBehaviorContract(saved) });
    assert.equal(original.detail, 'model_deadlock', JSON.stringify(original));
    const annotated = { ...saved, completion };
    assert.equal(deriveSchedules(annotated).coverage.completedStates, 1);
    const fixed = await validateSpec({ specDir: path.join(root, `${id}-declared`), ...compileBehaviorContract(annotated) });
    assert.equal(fixed.level, 'checked', JSON.stringify(fixed));
    assert.equal(fixed.distinctStates, id === 'category_management' ? 5 : 4);
  }
  assert.equal(await readFile(sourceFile, 'utf8'), source);
});