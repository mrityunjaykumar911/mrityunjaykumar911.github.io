import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileBehaviorContract, initialState, transition } from './behavioral-model.mjs';
import { validateSpec } from './tla-oracle.mjs';

export function compileCoverageGoal(contract, goal) {
  const field = contract.state.find((candidate) => candidate.id === goal.field);
  if (!field || !Number.isSafeInteger(goal.value) || goal.value <= field.initial || goal.value > field.exploreMax) throw new Error('invalid_coverage_goal');
  const compiled = compileBehaviorContract(contract);
  let tla = compiled.tla.replace(/^VARIABLES (.+)$/m, 'VARIABLES $1, lastAction')
    .replace(/^vars == <<(.+)>>$/m, 'vars == <<$1, lastAction>>')
    .replace(/^Init == (.+)$/m, 'Init == $1 /\\ lastAction = "Initial"');
  for (let index = 0; index < contract.actions.length; index++) {
    tla = tla.replace(`Action${index} ==\n`, `Action${index} ==\n  /\\ lastAction' = "${contract.actions[index].id}"\n`);
  }
  tla = tla.replace(/====\s*$/, `CoverageTargetNotReached == v_${field.id} < ${goal.value}\n====`);
  return { tla, cfg: `${compiled.cfg}\nCoverageTargetNotReached\n` };
}

export async function findCoverageWitness({ contract, goal, directory, maxActions = 128, validate = validateSpec }) {
  const compiled = compileCoverageGoal(contract, goal);
  const result = await validate({ specDir: directory, ...compiled });
  if (result.violatedInvariant !== 'CoverageTargetNotReached') {
    return { status: result.level === 'checked' ? 'unreached' : 'blocked', reason: result.detail,
      origin: 'tlc-reachability', goal, validation: result, artifactFailure: false };
  }
  const output = await readFile(path.join(directory, 'tlc.log'), 'utf8');
  const actions = [...output.matchAll(/\/\\ lastAction = "([A-Za-z][A-Za-z0-9_]*)"/g)].map((match) => match[1]).slice(1);
  if (!actions.length || actions.length > maxActions) return { status: 'blocked', reason: 'witness_action_budget', goal, artifactFailure: false };
  let state = initialState(contract);
  for (const action of actions) {
    state = transition(contract, state, action);
    if (!state) return { status: 'blocked', reason: 'witness_precondition_mismatch', goal, artifactFailure: false };
  }
  if (state[goal.field] < goal.value) return { status: 'blocked', reason: 'witness_did_not_reach_goal', goal, artifactFailure: false };
  const evidence = { status: 'reached', origin: 'tlc-reachability', goal, artifactFailure: false,
    trace: { id: `tlc-${goal.field}-${goal.value}`, actions }, reachedState: state, validation: result,
    meaning: 'Intentional coverage-target violation yields a schedule, not an application defect. Replay against the browser is required.' };
  await writeFile(path.join(directory, 'witness.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}