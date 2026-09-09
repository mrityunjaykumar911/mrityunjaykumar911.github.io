import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pLimit } from './rate-limit.mjs';

export const CONTRACT_SUITE_VERSION = 'concurrent-contracts-v1';

export async function runContractSuite({ contracts, runContract, outDir, concurrency = 2, onProgress = () => {} }) {
  if (!Array.isArray(contracts) || contracts.length === 0 ||
      contracts.some((contract) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(contract.id)) ||
      new Set(contracts.map((contract) => contract.id.toLowerCase())).size !== contracts.length) {
    throw new Error('invalid_contract_inventory');
  }
  const limit = pLimit(concurrency);
  const results = await Promise.all(contracts.map((contract) => limit(async () => {
    const evidenceDir = path.join(outDir, contract.id);
    await mkdir(evidenceDir, { recursive: true });
    onProgress(`contract ${contract.id}: start`);
    let result;
    try {
      result = await runContract({ contract, evidenceDir });
      if (!['passed', 'failed', 'blocked'].includes(result?.status) ||
          (contract.kind === 'tla' && result.status !== 'blocked' && result.validation?.level !== 'checked')) {
        result = { status: 'blocked', reason: 'invalid_contract_evidence' };
      }
    } catch {
      result = { status: 'blocked', reason: 'contract_execution_failed' };
    }
    result = { ...result, id: contract.id, kind: contract.kind, requirement: contract.requirement, evidenceDir };
    await writeFile(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    onProgress(`contract ${contract.id}: ${result.status}`);
    return result;
  })));
  const complete = results.every((result) => result.status !== 'blocked');
  const status = !complete ? 'blocked' : results.some((result) => result.status === 'failed') ? 'failed' : 'passed';
  const summary = { protocolVersion: CONTRACT_SUITE_VERSION, complete, status, contracts: results };
  await writeFile(path.join(outDir, 'suite.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}