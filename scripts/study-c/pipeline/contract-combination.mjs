import { behaviorHash } from './behavioral-model.mjs';

export function chooseContractVersions({ selected, candidate, adjudication, report, trustedIds = [], provenance = {}, version }) {
  const adopted = new Set();
  const decisions = new Map();
  const byId = new Map(candidate.contracts.map((contract) => [contract.id, contract]));
  const reviews = new Map(adjudication.contracts.map((review) => [review.id, review]));
  for (const contract of selected.contracts) {
    const review = reviews.get(contract.id);
    const check = report.contracts.find((item) => item.id === contract.id);
    const proposed = byId.get(contract.id);
    const acceptable = review?.accepted && check?.eligible && check.validation.level === 'checked';
    if (acceptable && (!trustedIds.includes(contract.id) || behaviorHash(proposed) !== behaviorHash(contract))) adopted.add(contract.id);
    decisions.set(contract.id, { id: contract.id, selected: 'previous', reason: acceptable ? 'previous_version_already_validated' : 'candidate_not_adjudicated_and_checked' });
  }
  const chosen = (id) => adopted.has(id) ? byId.get(id) : selected.contracts.find((contract) => contract.id === id);
  const accepted = (id) => adopted.has(id) || trustedIds.includes(id);
  const dependencyHashes = (id) => adopted.has(id)
    ? Object.fromEntries(reviews.get(id).dependencies.map((dependency) => [dependency, behaviorHash(byId.get(dependency))]))
    : provenance[id]?.dependencyHashes ?? {};
  let changed;
  do {
    changed = false;
    for (const contract of selected.contracts) {
      if (!accepted(contract.id)) continue;
      for (const [dependency, expectedHash] of Object.entries(dependencyHashes(contract.id))) {
        if (accepted(dependency) && chosen(dependency) && behaviorHash(chosen(dependency)) === expectedHash) continue;
        const removed = adopted.has(contract.id) ? contract.id : dependency;
        if (adopted.delete(removed)) {
          decisions.set(removed, { id: removed, selected: 'previous', reason: 'incompatible_contract_dependency', dependent: contract.id, dependency });
          changed = true;
        }
      }
    }
  } while (changed);
  const nextProvenance = structuredClone(provenance);
  for (const id of adopted) {
    decisions.set(id, { id, selected: version, reason: 'task_adjudicated_and_model_checked' });
    nextProvenance[id] = { version, contractHash: behaviorHash(chosen(id)), dependencyHashes: dependencyHashes(id) };
  }
  return { model: { ...selected, contracts: selected.contracts.map((contract) => structuredClone(chosen(contract.id))) },
    adoptedIds: [...adopted], decisions: [...decisions.values()], provenance: nextProvenance };
}

export function dependencyConsistency(model, adjudication, admittedIds) {
  const ids = new Set(model.contracts.map((contract) => contract.id));
  const admitted = new Set(admittedIds);
  return adjudication.contracts.filter((review) => admitted.has(review.id)).flatMap((review) =>
    review.dependencies.filter((dependency) => !ids.has(dependency) || !admitted.has(dependency))
      .map((dependency) => ({ contractId: review.id, dependency, reason: 'unadmitted_contract_dependency' })));
}