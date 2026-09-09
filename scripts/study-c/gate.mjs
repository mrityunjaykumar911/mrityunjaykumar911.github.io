import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FACT_NAMES = Object.freeze([
  'checksPassed', 'inventoryComplete', 'revisionMatches', 'policyMatches',
  'attemptMatches', 'notCancelled', 'notReleased', 'ticketMatches',
]);
export const MODEL_NAMES = Object.freeze([
  'catalog', 'safe', 'mutant-artifact', 'mutant-policy', 'mutant-attempt',
  'mutant-inventory', 'mutant-cancellation', 'mutant-duplicate', 'mutant-ticket',
]);
const SOURCE_PATHS = [
  'formal/agent/GateCatalog.tla', 'formal/agent/ReleaseGate.tla',
  ...MODEL_NAMES.map((name) => `formal/agent/${name}.cfg`),
  'scripts/study-c/tlc.mjs',
];
export const DEFAULT_CATALOG = path.join(ROOT, '.tools/study-c/verification/gate.json');
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || catalog.catalogStates !== 256 ||
      JSON.stringify(catalog.factNames) !== JSON.stringify(FACT_NAMES) ||
      JSON.stringify(catalog.allowedKeys) !== JSON.stringify(['11111111']) ||
      !Array.isArray(catalog.modelChecks) || catalog.modelChecks.length !== MODEL_NAMES.length ||
      !Number.isFinite(Date.parse(catalog.generatedAt))) {
    throw new Error('Invalid or incomplete TLC catalog. Run npm run study:c:verify.');
  }
  for (const [index, name] of MODEL_NAMES.entries()) {
    const check = catalog.modelChecks[index];
    if (check?.name !== name || check.passed !== true ||
        check.expectedInvariant !== (name === 'catalog' ? 'CatalogWellTyped' : 'ReleaseSafe') ||
        !Number.isSafeInteger(check.distinctStates) || check.distinctStates <= 0 ||
        !Number.isFinite(check.elapsedMs) || check.elapsedMs < 0 ||
        (name === 'catalog' && check.distinctStates !== 256)) {
      throw new Error(`Missing or unsuccessful TLC check: ${name}.`);
    }
  }
  const hashes = catalog.sourceHashes;
  if (!hashes || JSON.stringify(Object.keys(hashes).sort()) !== JSON.stringify([...SOURCE_PATHS].sort()) ||
      Object.values(hashes).some((hash) => !/^[a-f0-9]{64}$/.test(hash)) ||
      catalog.tools?.tlcSha256 !== '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88' ||
      typeof catalog.tools.javaVersion !== 'string') {
    throw new Error('Invalid TLC provenance. Run npm run study:c:verify.');
  }
  return catalog;
}

// This detects stale generated evidence, not malicious forgery of both files
// and hashes. The local verifier and its output directory are trusted inputs.
export async function loadCatalog({ filename = DEFAULT_CATALOG, root = ROOT } = {}) {
  const bytes = await readFile(filename);
  const catalog = validateCatalog(JSON.parse(bytes));
  for (const source of SOURCE_PATHS) {
    if (digest(await readFile(path.join(root, source))) !== catalog.sourceHashes[source]) {
      throw new Error(`Stale TLC catalog: ${source} changed. Run npm run study:c:verify.`);
    }
  }
  if (digest(await readFile(path.join(root, '.tools/tla2tools.jar'))) !== catalog.tools.tlcSha256) {
    throw new Error('TLC JAR differs from the verified catalog.');
  }
  return { catalog, sha256: digest(bytes) };
}

export function factKey(facts) {
  if (!facts || Object.keys(facts).length !== FACT_NAMES.length ||
      FACT_NAMES.some((name) => typeof facts[name] !== 'boolean')) {
    throw new TypeError('Gate requires exactly eight known Boolean facts.');
  }
  return FACT_NAMES.map((name) => facts[name] ? '1' : '0').join('');
}

export function resultOnly(facts) {
  factKey(facts);
  return facts.checksPassed;
}

export function statefulGuard(facts) {
  factKey(facts);
  return facts.checksPassed && facts.inventoryComplete && facts.revisionMatches &&
    facts.policyMatches && facts.attemptMatches && facts.notCancelled &&
    facts.notReleased && facts.ticketMatches;
}

export function catalogGuard(catalog) {
  validateCatalog(catalog);
  const allowed = new Set(catalog.allowedKeys);
  return (facts) => allowed.has(factKey(facts));
}