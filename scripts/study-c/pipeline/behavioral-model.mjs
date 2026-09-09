import { createHash } from 'node:crypto';
import { validateSemanticContract } from './semantic-contract.mjs';

export const MODEL_PROTOCOL = 'generated-behavior-v2';
export const BEHAVIOR_COMPILER_VERSION = 'semantic-evidence-v1';
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const operators = { add: '+', sub: '-', eq: '=', lt: '<', lte: '<=', gt: '>', gte: '>=', and: '/\\', or: '\\/', not: '~' };
const fail = (reason) => { throw new Error(reason); };
const evidenceKey = (id) => `__evidence_${id}`;
const evidenceSpecs = (contract) => contract.semantics?.evidence ?? [];
const stateFields = (contract) => [...contract.state, ...evidenceSpecs(contract).map((item) => ({ id: evidenceKey(item.id), initial: 0, exploreMax: 1 }))];

export function evaluate(expression, state) {
  if (typeof expression === 'boolean' || Number.isSafeInteger(expression)) return expression;
  if (expression?.evidence) return Object.hasOwn(state, evidenceKey(expression.evidence)) ? state[evidenceKey(expression.evidence)] === 1 : fail('unknown_evidence_reference');
  if (expression?.var) return Object.hasOwn(state, expression.var) ? state[expression.var] : fail('unknown_model_variable');
  const args = expression.args.map((argument) => evaluate(argument, state));
  if (['add', 'sub', 'lt', 'lte', 'gt', 'gte'].includes(expression.op) && args.some((argument) => !Number.isSafeInteger(argument))) fail('model_numeric_type_error');
  if (['and', 'or', 'not'].includes(expression.op) && args.some((argument) => typeof argument !== 'boolean')) fail('model_boolean_type_error');
  switch (expression.op) {
    case 'add': { const result = args[0] + args[1]; return Number.isSafeInteger(result) ? result : fail('model_overflow'); }
    case 'sub': { const result = args[0] - args[1]; return Number.isSafeInteger(result) ? result : fail('model_overflow'); }
    case 'eq': return args[0] === args[1];
    case 'lt': return args[0] < args[1];
    case 'lte': return args[0] <= args[1];
    case 'gt': return args[0] > args[1];
    case 'gte': return args[0] >= args[1];
    case 'and': return args[0] && args[1];
    case 'or': return args[0] || args[1];
    case 'not': return !args[0];
    default: return fail('unsupported_model_operator');
  }
}

function expressionValid(expression, names, depth = 0, evidenceIds = new Set()) {
  if (depth > 12) fail('expression_too_deep');
  if (typeof expression === 'boolean' || Number.isSafeInteger(expression)) return;
  if (!expression || typeof expression !== 'object') fail('invalid_model_expression');
  if (Object.keys(expression).length === 1 && evidenceIds.has(expression.evidence)) return;
  if (Object.keys(expression).length === 1 && names.has(expression.var)) return;
  if (!Object.hasOwn(operators, expression.op) || !Array.isArray(expression.args) ||
      expression.args.length !== (expression.op === 'not' ? 1 : 2) || Object.keys(expression).some((key) => !['op', 'args'].includes(key))) fail('invalid_model_expression');
  expression.args.forEach((argument) => expressionValid(argument, names, depth + 1, evidenceIds));
}

export function validateBehaviorModel(model, prompt, { minimumContracts = 2 } = {}) {
  if (![1, 2].includes(minimumContracts) || !model || model.version !== MODEL_PROTOCOL || !Array.isArray(model.contracts) || model.contracts.length < minimumContracts || model.contracts.length > 4) fail('invalid_behavior_inventory');
  const contractIds = new Set();
  for (const contract of model.contracts) {
    if (!identifier.test(contract.id) || contractIds.has(contract.id.toLowerCase())) fail('invalid_behavior_id');
    contractIds.add(contract.id.toLowerCase());
    if (!Array.isArray(contract.requirements) || !contract.requirements.length || contract.requirements.length > 6 ||
        contract.requirements.some((requirement) => !identifier.test(requirement.id) || !requirement.statement ||
          typeof requirement.sourceQuote !== 'string' || requirement.sourceQuote.length < 3 || !prompt.includes(requirement.sourceQuote)) ||
        new Set(contract.requirements.map((requirement) => requirement.id)).size !== contract.requirements.length) fail('ungrounded_behavior_requirement');
    if (!Array.isArray(contract.assumptions) || contract.assumptions.length > 6 || contract.assumptions.some((assumption) =>
      !['test-precondition', 'optional-behavior'].includes(assumption.kind) || typeof assumption.statement !== 'string')) fail('invalid_assumption_inventory');
    if (!Array.isArray(contract.state) || !contract.state.length || contract.state.length > 5 ||
        contract.state.some((field) => !identifier.test(field.id) || !Number.isSafeInteger(field.initial) || field.initial < 0 ||
          !Number.isSafeInteger(field.exploreMax) || field.exploreMax < field.initial || field.exploreMax > 1000) ||
        new Set(contract.state.map((field) => field.id)).size !== contract.state.length) fail('invalid_behavior_state');
    const names = new Set(contract.state.map((field) => field.id));
    const evidenceIds = new Set(evidenceSpecs(contract).map((item) => item.id));
    const requirements = new Set(contract.requirements.map((requirement) => requirement.id));
    if (contract.completion !== undefined) {
      if (!contract.completion || !requirements.has(contract.completion.requirementId) ||
          typeof contract.completion.reason !== 'string' || !contract.completion.reason.trim()) fail('invalid_completion_declaration');
      expressionValid(contract.completion.when, names, 0, evidenceIds);
      if (typeof evaluate(contract.completion.when, initialState(contract)) !== 'boolean') fail('nonboolean_completion_predicate');
    }
    if (!Array.isArray(contract.actions) || !contract.actions.length || contract.actions.length > 8 || new Set(contract.actions.map((action) => action.id)).size !== contract.actions.length) fail('invalid_behavior_actions');
    for (const action of contract.actions) {
      if (!identifier.test(action.id) || !action.description || !requirements.has(action.requirementId) || !action.updates ||
          Object.keys(action.updates).some((name) => !names.has(name))) fail('invalid_behavior_action');
      expressionValid(action.enabled, names, 0, evidenceIds);
      Object.values(action.updates).forEach((expression) => expressionValid(expression, names, 0, evidenceIds));
    }
    for (const [field, max] of [['observables', 5], ['invariants', 5]]) {
      if (!Array.isArray(contract[field]) || !contract[field].length || contract[field].length > max ||
          new Set(contract[field].map((item) => item.id)).size !== contract[field].length) fail('invalid_behavior_assertions');
      for (const item of contract[field]) {
        if (!identifier.test(item.id) || !item.description || !requirements.has(item.requirementId)) fail('invalid_behavior_assertion');
        expressionValid(item.expression, names, 0, field === 'observables' ? new Set() : evidenceIds);
      }
    }
    if (contract.semantics) validateSemanticContract(contract);
  }
  return model;
}

export const initialState = (contract) => Object.fromEntries(stateFields(contract).map((field) => [field.id, field.initial]));
export function completionState(contract, state) {
  const complete = contract.completion ? evaluate(contract.completion.when, state) : false;
  if (typeof complete !== 'boolean') fail('nonboolean_completion_predicate');
  return complete && evidenceSpecs(contract).every((item) => state[evidenceKey(item.id)] === 1);
}
export function transition(contract, state, actionId) {
  const action = contract.actions.find((item) => item.id === actionId);
  if (!action) fail('unknown_behavior_action');
  const enabled = evaluate(action.enabled, state);
  if (typeof enabled !== 'boolean') fail('nonboolean_action_precondition');
  if (!enabled) return null;
  const next = { ...state };
  for (const [name, expression] of Object.entries(action.updates)) {
    const value = evaluate(expression, state);
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid_behavior_transition');
    next[name] = value;
  }
  for (const evidence of evidenceSpecs(contract)) {
    if (evidence.invalidatedBy.includes(actionId)) next[evidenceKey(evidence.id)] = 0;
    else if (evidence.establishedBy === actionId) next[evidenceKey(evidence.id)] = 1;
  }
  return next;
}
export function observeModel(contract, state) {
  return Object.fromEntries(contract.observables.map((observable) => {
    const value = evaluate(observable.expression, state);
    if (typeof value !== 'boolean' && (!Number.isSafeInteger(value) || value < 0)) fail('invalid_model_observation');
    return [observable.id, typeof value === 'boolean' ? Number(value) : value];
  }));
}

export function deriveSchedules(contract, { maxStates = 128, maxDepth = 8, maxTraces = 16 } = {}) {
  if (![maxStates, maxDepth, maxTraces].every((value) => Number.isInteger(value) && value > 0)) fail('invalid_exploration_budget');
  const key = (state) => JSON.stringify(stateFields(contract).map((field) => state[field.id]));
  const initial = initialState(contract);
  const queue = [{ state: initial, actions: [] }];
  const seen = new Set([key(initial)]);
  const edges = [];
  let frontier = 0;
  let completedStates = 0;
  let undeclaredDeadEnds = 0;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    const complete = completionState(contract, current.state);
    let enabledCount = 0;
    for (const action of contract.actions) {
      const next = transition(contract, current.state, action.id);
      if (!next) continue;
      enabledCount++;
      if (complete) fail('completion_has_enabled_actions');
      if (contract.state.some((field) => next[field.id] > field.exploreMax) || current.actions.length >= maxDepth) { frontier++; continue; }
      const actions = [...current.actions, action.id];
      edges.push({ from: key(current.state), action: action.id, to: key(next), actions });
      if (!seen.has(key(next))) {
        if (seen.size >= maxStates) { frontier++; continue; }
        seen.add(key(next)); queue.push({ state: next, actions });
      }
    }
    if (enabledCount === 0) {
      if (complete) completedStates++;
      else undeclaredDeadEnds++;
    }
  }
  const selected = [];
  const covered = new Set();
  const edgeId = (from, action, to) => JSON.stringify([from, action, to]);
  const coverage = (actions) => {
    let state = initial;
    return actions.map((action) => { const next = transition(contract, state, action); const id = edgeId(key(state), action, key(next)); state = next; return id; });
  };
  while (selected.length < maxTraces) {
    const best = edges.map((edge) => ({ edge, ids: coverage(edge.actions) }))
      .map((candidate) => ({ ...candidate, gain: candidate.ids.filter((id) => !covered.has(id)).length }))
      .sort((first, second) => second.gain - first.gain || first.edge.actions.length - second.edge.actions.length)[0];
    if (!best || best.gain === 0) break;
    selected.push({ id: `path-${selected.length + 1}`, actions: best.edge.actions });
    best.ids.forEach((id) => covered.add(id));
  }
  if (!selected.length) fail('no_executable_model_transitions');
  return { traces: selected, coverage: { discoveredStates: seen.size, discoveredTransitions: edges.length,
    coveredTransitions: covered.size, frontier, completedStates, undeclaredDeadEnds,
    exhaustive: frontier === 0 && covered.size === edges.length, maxStates, maxDepth, maxTraces } };
}

function tlaExpression(expression) {
  if (typeof expression === 'boolean') return expression ? 'TRUE' : 'FALSE';
  if (Number.isSafeInteger(expression)) return String(expression);
  if (expression.evidence) return `(v_${evidenceKey(expression.evidence)} = 1)`;
  if (expression.var) return `v_${expression.var}`;
  if (expression.op === 'not') return `~(${tlaExpression(expression.args[0])})`;
  return `(${tlaExpression(expression.args[0])} ${operators[expression.op]} ${tlaExpression(expression.args[1])})`;
}

export function compileBehaviorContract(contract, trace, snapshots) {
  const allFields = stateFields(contract);
  const fields = allFields.map((field) => `v_${field.id}`);
  const natural = (value) => { if (!Number.isSafeInteger(value) || value < 0) fail('invalid_replay_integer'); return String(value); };
  if (trace && (!Array.isArray(snapshots) || snapshots.length !== trace.actions.length + 1 || trace.actions.some((action) => !contract.actions.some((item) => item.id === action)))) fail('invalid_behavior_replay');
  const records = snapshots?.map((snapshot) => `[${contract.observables.map((observable) => `o_${observable.id} |-> ${natural(snapshot[observable.id])}`).join(', ')}]`) ?? [];
  const actions = contract.actions.map((action, index) => `Action${index} ==\n  /\\ ${tlaExpression(action.enabled)}\n` +
    allFields.map((field) => {
      const evidence = evidenceSpecs(contract).find((item) => evidenceKey(item.id) === field.id);
      const update = evidence ? evidence.invalidatedBy.includes(action.id) ? 0 : evidence.establishedBy === action.id ? 1 : { var: field.id }
        : action.updates[field.id] ?? { var: field.id };
      return `  /\\ v_${field.id}' = ${tlaExpression(update)}`;
    }).join('\n'));
  const observed = contract.observables.map((observable) => {
    const expr = tlaExpression(observable.expression);
    const boolean = typeof evaluate(observable.expression, initialState(contract)) === 'boolean';
    return `    /\\ InputObserved[step + 1].o_${observable.id} = ${boolean ? `(IF ${expr} THEN 1 ELSE 0)` : expr}`;
  });
  const tla = [
    '---- MODULE TaskSpec ----', 'EXTENDS Integers, Sequences', 'CONSTANTS ReplayMode, InputActions, InputObserved',
    `VARIABLES step, ${fields.join(', ')}`, `vars == <<step, ${fields.join(', ')}>>`,
    `ReplayActions == <<${trace ? trace.actions.map((action) => JSON.stringify(action)).join(', ') : ''}>>`,
    `ReplayObserved == <<${records.join(', ')}>>`,
    `Init == step = 0 /\\ ${allFields.map((field) => `v_${field.id} = ${natural(field.initial)}`).join(' /\\ ')}`,
    ...actions,
    `Dispatch(name) == CASE ${contract.actions.map((action, index) => `name = "${action.id}" -> Action${index}`).join('\n  [] ')}\n  [] OTHER -> FALSE`,
    `AnyActionEnabled == ${contract.actions.map((action) => `(${tlaExpression(action.enabled)})`).join(' \\/ ')}`,
    `EvidenceFresh == ${evidenceSpecs(contract).map((item) => `v_${evidenceKey(item.id)} = 1`).join(' /\\ ') || 'TRUE'}`,
    `DeclaredCompletion == (${contract.completion ? tlaExpression(contract.completion.when) : 'FALSE'}) /\\ EvidenceFresh`,
    `CompletionConsistent == DeclaredCompletion => ~AnyActionEnabled`,
    `DomainNext == (${contract.actions.map((_action, index) => `Action${index}`).join(' \\/ ')}) /\\ UNCHANGED step`,
    'CompletedIdle == DeclaredCompletion /\\ ~AnyActionEnabled /\\ UNCHANGED vars',
    `Next == IF ReplayMode THEN\n  IF step < Len(InputActions) THEN Dispatch(InputActions[step + 1]) /\\ step' = step + 1\n  ELSE UNCHANGED vars\n  ELSE DomainNext \\/ CompletedIdle`,
    `TypeOK == step \\in Nat /\\ ${fields.map((field) => `${field} \\in Nat`).join(' /\\ ')}`,
    ...contract.invariants.map((invariant, index) => `DomainInvariant${index} == ${tlaExpression(invariant.expression)}`),
    `SnapshotMatches == IF ReplayMode THEN\n${observed.join('\n')}\n  ELSE TRUE`,
    `ExplorationBound == IF ReplayMode THEN TRUE ELSE ${contract.state.map((field) => `v_${field.id} <= ${field.exploreMax}`).join(' /\\ ')}`, '====',
  ].join('\n');
  const cfg = ['INIT Init', 'NEXT Next', 'CONSTANTS', `ReplayMode = ${trace ? 'TRUE' : 'FALSE'}`,
    'InputActions <- ReplayActions', 'InputObserved <- ReplayObserved', 'CONSTRAINT ExplorationBound', 'INVARIANTS',
    'TypeOK', 'CompletionConsistent', ...contract.invariants.map((_invariant, index) => `DomainInvariant${index}`), 'SnapshotMatches'].join('\n');
  return { tla, cfg };
}

export function compareBehaviorTrace(contract, trace, snapshots) {
  if (!snapshots || snapshots.length !== trace.actions.length + 1) return { status: 'blocked', reason: 'incomplete_observation_trace' };
  const failures = [];
  let state = initialState(contract);
  for (let step = 0; step < snapshots.length; step++) {
    if (step) { state = transition(contract, state, trace.actions[step - 1]); if (!state) return { status: 'blocked', reason: 'action_precondition_not_satisfied' }; }
    const expected = observeModel(contract, state);
    for (const [observable, value] of Object.entries(expected)) {
      if (!Number.isSafeInteger(snapshots[step][observable])) return { status: 'blocked', reason: 'invalid_browser_observation' };
      if (snapshots[step][observable] !== value) failures.push({ step, observable, expected: value, observed: snapshots[step][observable] });
    }
  }
  if (failures.some((failure) => failure.step === 0)) return { status: 'blocked', reason: 'initial_state_mapping_mismatch', failures };
  return { status: failures.length ? 'failed' : 'passed', failures,
    ...(contract.semantics ? { completionSatisfied: failures.length === 0 && completionState(contract, state) } : {}) };
}

export const behaviorHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');