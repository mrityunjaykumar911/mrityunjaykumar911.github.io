import { validatePrerequisiteValue } from './prerequisite-values.mjs';

export const SEMANTIC_PROTOCOL = 'semantic-contract-v2';
export const LEGACY_SEMANTIC_PROTOCOL = 'semantic-contract-v1';
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const reject = (reason) => { throw new Error(reason); };

export function validateSemanticContract(contract) {
  const semantics = contract.semantics;
  if (![SEMANTIC_PROTOCOL, LEGACY_SEMANTIC_PROTOCOL].includes(semantics?.version)) reject('semantic_declaration_missing');
  const ids = new Set(contract.requirements.map((item) => item.id));
  for (const field of ['scenarioChoices', 'ambiguities', 'prerequisites', 'evidence']) {
    if (!Array.isArray(semantics[field]) || semantics[field].length > 8) reject(`invalid_semantic_${field}`);
    for (const item of semantics[field]) {
      if (!identifier.test(item.id) || ids.has(item.id)) reject('semantic_identifier_collision');
      ids.add(item.id);
    }
  }
  if (contract.requirements.some((item) => !nonempty(item.basis))) reject('requirement_entailment_basis_missing');
  for (const requirement of contract.requirements) {
    if (!['state', 'latest-after-action'].includes(requirement.evidenceMode)) reject('requirement_evidence_mode_missing');
    if (requirement.evidenceMode === 'latest-after-action' && !semantics.evidence.some((item) => item.requirementId === requirement.id)) reject('temporal_evidence_missing');
  }
  for (const choice of semantics.scenarioChoices) {
    if (!['fresh-name', 'date-time', 'setting', 'delivery-channel', 'other'].includes(choice.kind) ||
        (choice.kind !== 'setting' && !nonempty(choice.value)) || !nonempty(choice.reason)) reject('invalid_scenario_choice');
    validatePrerequisiteValue(choice, { typed: semantics.version === SEMANTIC_PROTOCOL });
  }
  if (semantics.ambiguities.some((item) => !nonempty(item.statement))) reject('invalid_semantic_ambiguity');
  const requirements = new Set(contract.requirements.map((item) => item.id));
  const choices = new Map(semantics.scenarioChoices.map((item) => [item.id, item]));
  const actions = new Set(contract.actions.map((item) => item.id));
  const observables = new Set(contract.observables.map((item) => item.id));
  for (const item of [...contract.actions, ...contract.observables, ...contract.invariants, ...(contract.completion ? [contract.completion] : [])]) {
    if (!requirements.has(item.requirementId)) reject('scenario_choice_used_as_requirement');
  }
  for (const prerequisite of semantics.prerequisites) {
    if (!['absent', 'setting', 'capability'].includes(prerequisite.kind) || !choices.has(prerequisite.choiceId) ||
        prerequisite.kind === 'setting' && !actions.has(prerequisite.actionId) ||
        prerequisite.kind === 'capability' && !observables.has(prerequisite.observableId)) reject('invalid_semantic_prerequisite');
    const kind = choices.get(prerequisite.choiceId).kind;
    if (prerequisite.kind === 'absent' && kind !== 'fresh-name' || prerequisite.kind === 'setting' && kind !== 'setting' ||
        prerequisite.kind === 'capability' && kind !== 'delivery-channel') reject('prerequisite_choice_kind_mismatch');
  }
  for (const choice of choices.values()) {
    const kind = { 'fresh-name': 'absent', setting: 'setting', 'delivery-channel': 'capability' }[choice.kind];
    if (kind && !semantics.prerequisites.some((item) => item.kind === kind && item.choiceId === choice.id)) reject('scenario_prerequisite_missing');
  }
  for (const evidence of semantics.evidence) {
    if (!requirements.has(evidence.requirementId) || !actions.has(evidence.establishedBy) ||
        !Array.isArray(evidence.invalidatedBy) || !evidence.invalidatedBy.length || new Set(evidence.invalidatedBy).size !== evidence.invalidatedBy.length ||
        evidence.invalidatedBy.some((id) => !actions.has(id) || id === evidence.establishedBy) ||
        !Array.isArray(evidence.observables) || !evidence.observables.length || evidence.observables.some((id) => !observables.has(id))) reject('invalid_completion_evidence');
  }
  return semantics;
}

export function assessSemanticContract(contract) {
  try {
    const semantics = validateSemanticContract(contract);
    if (semantics.ambiguities.length) return { accepted: false, reason: 'unresolved_semantic_ambiguity', ambiguities: semantics.ambiguities };
    return { accepted: true, reason: 'structured_semantics_valid', claim: 'structure only; entailment and mappings still require review' };
  } catch (error) { return { accepted: false, reason: error.message }; }
}