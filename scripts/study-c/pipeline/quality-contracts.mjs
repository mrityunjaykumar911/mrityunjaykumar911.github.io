import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_PROTOCOL, BEHAVIOR_COMPILER_VERSION, behaviorHash, deriveSchedules, validateBehaviorModel } from './behavioral-model.mjs';
import { BROWSER_BINDING_SYSTEM, validateGeneratedBinding } from './generated-browser.mjs';
import { SEMANTIC_PROTOCOL, assessSemanticContract } from './semantic-contract.mjs';
import { assessTaskAdjudication } from './task-adjudication.mjs';

export const QUALITY_PROTOCOL = 'quality-evidence-v7';
export const TEST_ENVIRONMENT = Object.freeze({
  clock: '2030-01-01T12:00:00Z', timezone: 'UTC', viewport: { width: 390, height: 844 },
  storage: 'empty at context creation', pageStateAtFirstObservation: 'already loaded, after setup',
  interpretation: 'test configuration, not a product requirement; empty storage does not guarantee an empty list',
});
export const MODEL_GENERATOR = `Generate a task-specific behavioral model as JSON only. Never select fixed task contracts. Schema:
{"version":"${MODEL_PROTOCOL}","contracts":[2 to 4 contracts]}.
Each contract: {id:identifier, requirements:[{id:identifier,statement:string,sourceQuote:exact task quotation}], assumptions:[{kind:"test-precondition|optional-behavior",statement:string}],
state:[{id:identifier,initial:nonnegative integer,exploreMax:integer up to 1000}],
actions:[{id:identifier,description:concrete browser operation and test input,requirementId,enabled:expression,updates:{stateId:expression}}],
observables:[{id:identifier,description:precise measurable nonnegative integer or boolean in DOM,requirementId,expression}],
invariants:[{id:identifier,description:behavioral safety obligation,requirementId,expression}],
completion:optional {when:boolean expression,requirementId,reason:string}}.
Each requirement also needs basis:string explaining entailment, not just quotation overlap, and evidenceMode:"state|latest-after-action". A latest-after-action requirement MUST have a matching semantics.evidence entry.
Each contract MUST include semantics:{version:"${SEMANTIC_PROTOCOL}",scenarioChoices:[{id,kind:"fresh-name|date-time|setting|delivery-channel|other",value:string,reason:string}],ambiguities:[{id,statement}],prerequisites:[{id,kind:"absent|setting|capability",choiceId,actionId:for setting,observableId:for capability}],evidence:[]}.
Exception to value:string: a setting choice MUST use value:{type:"text|option-label|date|datetime-local",value:string}. text is literal text input; option-label is an exact selectable label; date is YYYY-MM-DD; datetime-local is YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss without Z or timezone offset in the supplied UTC browser. Use real calendar dates. Do not put explanations like "category X applied at create" in the value: put them in reason. Delivery-channel values MUST be exactly "in-page" or "notification"; explain presentation separately in reason. These are scenario choices, not universal product mandates. Every action that relies on a selected setting needs its own prerequisite. Reminder offset/enable choices must be explicit settings when relevant, never implied by entering a due date. Unsupported UI must remain blocked, not silently converted to defaults. No hand-authored task-specific fallback.
All semantic IDs must be distinct from each other and requirement IDs. Required behavior belongs ONLY in requirements. Item names, selected dates/settings and observation channels are scenario choices, not mandatory product features. Every fresh-name needs an absent prerequisite; every setting needs an explicit setting prerequisite tied to its action; every delivery-channel needs a capability prerequisite tied to its observable. Use fresh diagnostic names, not common seeded names. Unsupported interpretations belong in ambiguities and block admission; never assert them as obligations. Optional assumptions do not license mandatory assertions. Do not add reload persistence or editing as mandatory unless entailed; a chosen scenario does not strengthen the task requirement.
Limits: 1..5 state variables, 1..8 actions, 1..5 observables and invariants, <=6 requirements and assumptions per contract. All identifiers ASCII letters followed by letters/digits/underscore; <=40 characters.
Expressions are JSON integer/boolean literals, {"var":"stateId"}, or {"op":"add|sub|eq|lt|lte|gt|gte|and|or|not","args":[expressions]}. not takes one argument, others two. All updates execute simultaneously from the prior state. enabled must be boolean. State values always nonnegative integers. Do not emit code, TLA, config, traces or judge scores: traces are derived by exploring this generated model; a tested compiler constructs the formal model.
Represent only obligations entailed by the task, not guesses about optional features. Explicitly separate assumptions (including initial empty states and defaults) from requirements. Optional assumptions must not become asserted obligations. Do not assume uncategorized defaults, particular seeded items, or removal-on-completion unless requested. Browser preconditions must be enabled before actions: completing/deleting a missing item is not executable. Test valid create/edit/reset/reload/reminder transitions and independent-action orderings where required. This is a bounded abstraction; no claim of complete application correctness.
Use small concrete examples and minimal finite state. ExploreMax limits SEARCH ONLY, never use it as a cap or requirement in transitions. Respect real required domain guards (e.g. cannot delete absent item). Cover each requirement with observables and invariants, not mere container visibility. Don't encode a tautological invariant as the only safety property. Use presence as 0/1 only if test actions avoid duplicates via an explicit precondition. Boolean observables are encoded as 0/1 by the executor.
If this is an intentionally finite scenario, declare completion.when explicitly for the successful end state and explain its requirement-linked reason. Completion is about the modeled test scenario, NOT the whole application stopping. Completion must be false while any modeled action is enabled, and true only when every modeled action is disabled after the intended work. Omit completion for continuously enabled workflows. Never equate lack of enabled actions with successful completion, and never use an exploration limit as the completion condition. The compiler preserves deadlock checking for undeclared stuck states and for impossible requested replay actions.
For an obligation that depends on observing a value after its latest change, fill semantics.evidence with {id,requirementId,invalidatedBy:[actionIds],establishedBy:actionId,observables:[observableIds]}. Each listed change clears the evidence; the establishing action sets it. Completion automatically requires all evidence fresh. Guards can read {"evidence":"evidenceId"} as a boolean. Do not write evidence state or use it as a DOM observable. For persistence, changes include create and edit, the establishing action is reload, and observables must measure the actual latest value after reload. Allow re-establishing evidence after any later change; a one-time reload flag is insufficient. Keep useful orderings, but never claim a stale observation establishes latest-value persistence. Evidence tracks action ordering only; actual browser observations must also match.
Environment: browser starts at 2030-01-01T12:00:00Z in UTC, empty storage, 390x844 viewport. Use relative times with concrete dates after that clock. Keep time advances <=300000ms per action. Initial empty storage does not prove an app has no seeded items; record and justify necessary setup. No final-evaluator checklist, scores or output artifacts are available to you.`;

export const GROUNDING_REVIEW = `Review the generated model against ONLY the supplied task and environment. Return JSON {"contracts":[{"id":"same id","accepted":true|false,"reason":"specific reasoning"}]} for EVERY contract. Reject unsupported assumptions asserted as requirements, impossible UI preconditions, arbitrary defaults (e.g. new items must be uncategorized), incorrect time start/due semantics, artificial model bounds used as product limits, observables not expressing the quoted obligation, and optional features treated as mandatory. Mere quotation overlap is not entailment. Test-precondition assumptions must be achievable through setup without hiding defects. The provided viewport, clock and storage configuration are authorized test conditions, not invented product obligations: do not reject them merely because they are not in the task. The page is already loaded before observation zero, so a pre-load state cannot be observed. Empty storage does not guarantee an empty list. Review completion separately: it may designate successful completion of a finite test scenario, not termination of the app. Reject premature completion, completion inferred merely from disabled actions, and model bounds disguised as completion. Do not modify the model or invent requirements. Accepted means this reviewer found no issue, not formal proof of semantic correctness.`;
export const MAPPING_REVIEW = `Audit whether a DOM binding faithfully targets the generated contract in the actual HTML. Return JSON {"accepted":true|false,"reason":"specific reasoning"}. Check each operation targets its intended existing control under model preconditions and explicitly configures required inputs. Acceptance judges mapping fidelity, not whether the application already works: do not reject a unique correct target solely because the app hides or disables it. Keep that selector; the real executor must determine reachability and may report an application failure. Never accept an unrelated target, invent a missing control, or remove CSS/force-click to make it pass. Reject unresolved/default category assumptions, hidden seeded rows, destructive setup that conceals a failure, time travel backwards, simulated clicks described as touch, unsupported observations and proxy measurements (container visibility is not event support). Check observable selectors measure the defined item/state, not a guessed expected result. Infer no absent numeric field as zero. Check commitActionId (default: setting action) and commitStep identify the true submission, not navigation; a setting may precede a separate save action. For every derived schedule, review modal state and context before/after steps: normal UI navigation must preserve drafts and modeled observations, without premature saving or domain changes. Observation equality alone does not prove that all application state was preserved. A pending setting at model completion remains incomplete evidence; never infer persistence from a hidden editor value. No code changes, scores or new requirements. Environment: UTC 2030-01-01T12:00:00Z, 390x844, empty storage. A passing review is fallible and must still be followed by execution.`;

export function parseObject(text) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'));
}

export async function requestOnce({ client, directory, system, prompt, purpose, maxOutputTokens, method = 'generate', images, onProgress = () => {} }) {
  const requestHash = behaviorHash({ system, prompt, maxOutputTokens, method, imageHashes: images?.map((image) => behaviorHash([...image])) });
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'response.json');
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    if (cached.requestHash !== requestHash) throw new Error('request_cache_mismatch');
    return cached;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(path.join(directory, 'attempt.json'), JSON.stringify({ requestHash, startedAt: new Date().toISOString(), purpose }), { flag: 'wx' });
  const result = await client[method]({ system, prompt, images, purpose, maxOutputTokens,
    onProgress: ({ chars, ms }) => onProgress(`${purpose}: chars=${chars} elapsedMs=${ms}`) });
  const record = { ...result, requestHash };
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function assessGrounding(model, review) {
  if (!Array.isArray(review?.contracts) || review.contracts.length !== model.contracts.length ||
      new Set(review.contracts.map((item) => item.id)).size !== model.contracts.length ||
      model.contracts.some((contract) => !review.contracts.some((item) => item.id === contract.id && typeof item.accepted === 'boolean' && typeof item.reason === 'string'))) {
    throw new Error('incomplete_grounding_review');
  }
  return { accepted: review.contracts.every((item) => item.accepted), contracts: review.contracts };
}

export async function authorQualityModel({ task, client, directory, onProgress }) {
  const generated = await requestOnce({ client, directory: path.join(directory, 'generation'), system: MODEL_GENERATOR,
    prompt: JSON.stringify({ task: task.prompt, environment: TEST_ENVIRONMENT }), purpose: `quality-model-${task.id}`, maxOutputTokens: 12000, onProgress });
  if (!generated.ok) throw new Error('behavior_generation_failed');
  const model = parseObject(generated.text);
  return reviewQualityModel({ task, model, client, directory, onProgress, requiredSemanticVersion: SEMANTIC_PROTOCOL });
}

export async function reviewQualityModel({ task, model, client, directory, onProgress, taskAdjudication, requiredSemanticVersion }) {
  await mkdir(directory, { recursive: true });
  if (model.version !== MODEL_PROTOCOL || !Array.isArray(model.contracts) || model.contracts.length < 2 || model.contracts.length > 4) throw new Error('invalid_behavior_inventory');
  const structuralReviews = model.contracts.map((contract, index) => {
    try {
      if (model.contracts.filter((item) => String(item?.id).toLowerCase() === String(contract?.id).toLowerCase()).length !== 1) throw new Error('duplicate_behavior_id');
      if (requiredSemanticVersion && contract?.semantics?.version !== requiredSemanticVersion) throw new Error('new_generation_semantic_version_mismatch');
      validateBehaviorModel({ ...model, contracts: [contract] }, task.prompt, { minimumContracts: 1 });
      return { id: contract.id, index, accepted: true };
    } catch (error) { return { id: contract?.id, index, accepted: false, reason: error.message }; }
  });
  await writeFile(path.join(directory, 'structural-reviews.json'), `${JSON.stringify(structuralReviews, null, 2)}\n`, 'utf8');
  let grounding;
  let adjudication;
  if (taskAdjudication) {
    adjudication = assessTaskAdjudication(task, model, taskAdjudication);
    grounding = { accepted: adjudication.accepted, contracts: adjudication.contracts.map((item) => ({ id: item.id, accepted: item.accepted, reason: item.reason })) };
    await writeFile(path.join(directory, 'task-adjudication.json'), `${JSON.stringify(adjudication, null, 2)}\n`, 'utf8');
  } else {
    const reviewed = await requestOnce({ client, directory: path.join(directory, 'grounding'), system: GROUNDING_REVIEW,
    prompt: JSON.stringify({ task: task.prompt, environment: TEST_ENVIRONMENT, model,
      semanticReview: 'Distinguish required behavior and its entailment basis from scenario choices. Choices never strengthen an obligation. Unresolved ambiguities block admission. Check evidence action ordering, observable meaning, and achievable prerequisites. A fresh-name absence check is an explicit runtime prerequisite, not a claim about empty storage. Do not treat a configured offset or channel as a universal product requirement.' }),
    purpose: `quality-grounding-${task.id}`, maxOutputTokens: 4000, onProgress });
    if (!reviewed.ok) throw new Error('grounding_review_failed');
    grounding = assessGrounding(model, parseObject(reviewed.text));
  }
  const record = { protocol: QUALITY_PROTOCOL, compilerVersion: BEHAVIOR_COMPILER_VERSION, promptHash: behaviorHash(task.prompt), model, grounding,
    ...(adjudication ? { taskAdjudication: adjudication } : {}),
    structuralReviews, semanticProtocol: SEMANTIC_PROTOCOL, semanticReviews: model.contracts.map((contract) => ({ id: contract?.id, ...assessSemanticContract(contract) })),
    environment: TEST_ENVIRONMENT,
    modelHash: behaviorHash(model), schedules: model.contracts.map((contract) => {
      try { return { contractId: contract.id, status: 'derived', ...deriveSchedules(contract) }; }
      catch { return { contractId: contract.id, status: 'blocked', reason: 'invalid_or_unexecutable_model' }; }
    }) };
  await writeFile(path.join(directory, 'model.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function eligibleQualityRecord(record) {
  if (!record?.model?.contracts?.length || record.modelHash !== behaviorHash(record.model)) throw new Error('invalid_source_model');
  assessGrounding(record.model, record.grounding);
  const eligible = [];
  const excluded = [];
  for (const contract of record.model.contracts) {
    const structural = record.structuralReviews?.find((item) => item.id === contract?.id);
    if (structural && !structural.accepted) { excluded.push({ id: contract?.id, stage: 'structural-preflight', reason: structural.reason }); continue; }
    if (record.semanticProtocol || contract.semantics) {
      const semantic = assessSemanticContract(contract);
      if (!semantic.accepted) { excluded.push({ id: contract.id, stage: 'semantic-preflight', ...semantic }); continue; }
    }
    const review = record.grounding.contracts.find((item) => item.id === contract.id);
    if (!review.accepted) { excluded.push({ id: contract.id, stage: 'grounding', reason: review.reason }); continue; }
    try {
      const schedule = deriveSchedules(contract);
      if (schedule.coverage.undeclaredDeadEnds > 0) {
        excluded.push({ id: contract.id, stage: 'deterministic-schedule', reason: 'undeclared_model_dead_end', coverage: schedule.coverage });
        continue;
      }
    }
    catch { excluded.push({ id: contract.id, stage: 'deterministic-schedule', reason: 'invalid_or_unexecutable_model' }); continue; }
    eligible.push(contract);
  }
  const model = { ...record.model, contracts: eligible };
  const coverage = { generated: record.model.contracts.length, eligible: eligible.length, excluded,
    eligibleIds: eligible.map((contract) => contract.id), full: excluded.length === 0,
    meaning: 'eligibility only; executed/formal coverage is reported separately in each arm' };
  return { ...record, sourceModelHash: record.modelHash, model, modelHash: behaviorHash(model), coverage,
    grounding: { accepted: eligible.length > 0, contracts: record.grounding.contracts.filter((review) => coverage.eligibleIds.includes(review.id)) } };
}

export async function bindQualityContract({ contract, schedule, html, client, directory, onProgress }) {
  const interfaceContract = { id: contract.id, requirement: contract.requirements.map((item) => item.statement).join('\n'),
    actions: contract.actions, observables: contract.observables, semantics: contract.semantics, traces: schedule.traces };
  const mapping = await requestOnce({ client, directory: path.join(directory, 'mapping'),
    system: `${BROWSER_BINDING_SYSTEM}\nThe executor ALSO supports op=\"tap\" for actual touch events. Use tap for actions described as touch. advance executes timer callbacks with runFor, not clock skipping. Each action's enabled predicate defines its precondition; bind that action only for states where it is enabled.`,
    prompt: JSON.stringify({ contract, html, environment: TEST_ENVIRONMENT,
      reachabilityRule: 'Map a unique existing intended action control even when CSS hides it or the app disables it. Do not force-click, change CSS, or fabricate an alternative target; the executor records reachability separately. A missing or unrelated control remains unmappable. Mapping fidelity is not an assertion that the app already passes.',
      contextualReplay: 'If a setting and save are separate modeled actions, set prerequisite mapping commitActionId to the save action and commitStep to its zero-based submit operation. Omit commitActionId only for a same-action commit. The executor carries pending settings across actions, checks actual readback before committing, and invalidates pending evidence on reload. Never move save into the setting action to satisfy the schema. For modal-dependent routing, optional contexts:{actionId:[{selector:unique existing element,state:visible|hidden,before:[normal UI steps],after:[normal UI steps]}]} is evaluated once at action entry. Context steps may navigate/dismiss/reopen and restore draft fields using normal controls only; they must preserve all modeled observations before and after the action. Do not discard drafts, save prematurely, or change domain state as context. Review every generated schedule, including alternate action orderings. Unavailable safe context remains blocked with its diagnostics.',
      prerequisiteMappingRules: 'Return prerequisites:{prerequisiteId:mapping}. For absent: {selector:CSS for ALL name-label elements, including seeded names}; check exact names before/after setup. Never hide collisions, delete or rename seeds. For semantic-contract-v2 setting: {selector,op:select|fill,value:choice.value.value,commitActionId:optional modeled save action ID,commitStep:zero-based save/submit operation index within commitActionId or the setting action when omitted}. type option-label requires select on a native select; text/date/datetime-local require fill on the corresponding native control. Include the exact setting operation in its declared action. For same-action commits it must precede commitStep; separate actions retain pending readback evidence until the commit action executes. Save-before-setting prefixes do not prove the later value was committed. Never paraphrase prose into input values, silently convert timezones, or rely on defaults. Legacy v1 uses its original string literally and is not auto-upgraded. For capability: {channel:in-page|notification}, exactly matching the choice token and actual observable channel. notification uses notificationCount (instrumented in-tab only); in-page observes the actual message, not a proxy. Binding is not proof of delivery; execution must observe it. Return null for unsupported controls or prerequisites. Review must verify commitStep identifies the true submission, not an earlier navigation click.' }),
    purpose: `quality-binding-${contract.id}`, maxOutputTokens: 5000, onProgress });
  if (!mapping.ok) throw new Error('quality_binding_failed');
  const binding = validateGeneratedBinding(parseObject(mapping.text), interfaceContract);
  const audit = await requestOnce({ client, directory: path.join(directory, 'mapping-review'), system: MAPPING_REVIEW,
    prompt: JSON.stringify({ contract, binding, html, environment: TEST_ENVIRONMENT }), purpose: `quality-binding-review-${contract.id}`, maxOutputTokens: 2500, onProgress });
  if (!audit.ok) throw new Error('quality_binding_review_failed');
  const review = parseObject(audit.text);
  if (typeof review.accepted !== 'boolean' || typeof review.reason !== 'string') throw new Error('invalid_mapping_review');
  await writeFile(path.join(directory, 'binding.json'), `${JSON.stringify({ binding, review }, null, 2)}\n`, 'utf8');
  return { interfaceContract, binding, review };
}