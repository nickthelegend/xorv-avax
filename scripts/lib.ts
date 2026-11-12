import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Abi, Hex } from 'viem';
import { ROOT, type Wallet } from '../packages/sdk/src/node.ts';

export interface Artifact { abi: Abi; bytecode: Hex; links: Record<string, Record<string, { start: number; length: number }[]>> }

export function artifact(file: string, name: string): Artifact {
  const j = JSON.parse(readFileSync(path.join(ROOT, 'contracts/out', file, `${name}.json`), 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object, links: j.bytecode.linkReferences ?? {} };
}

/** Fills each library placeholder with its deployed address. */
export function link(a: Artifact, libs: Record<string, Hex>): Hex {
  let code = a.bytecode.slice(2);
  for (const [, byName] of Object.entries(a.links)) {
    for (const [lib, refs] of Object.entries(byName)) {
      const addr = libs[lib];
      if (!addr) throw new Error(`missing library address for ${lib}`);
      for (const r of refs) code = code.slice(0, r.start * 2) + addr.slice(2).toLowerCase() + code.slice((r.start + r.length) * 2);
    }
  }
  if (code.includes('__$')) throw new Error('unlinked library placeholder left in bytecode');
  return `0x${code}`;
}

export async function deploy(w: Wallet, a: Artifact, args: unknown[] = [], libs: Record<string, Hex> = {}, label = '') {
  const hash = await w.deployContract({ abi: a.abi, bytecode: link(a, libs), args } as any);
  const r = await w.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`${label} deploy failed: ${hash}`);
  console.log(`  ${label.padEnd(22)} ${r.contractAddress}  tx ${hash}`);
  return { address: r.contractAddress as Hex, tx: hash, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed) };
}

export async function send(w: Wallet, req: any, label: string) {
  const hash = await w.writeContract(req);
  const r = await w.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ${label.padEnd(34)} tx ${hash}`);
  return { tx: hash, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed) };
}

export const deploymentPath = (network: string) => path.join(ROOT, 'deployments', `${network}.json`);

export function readJson(file: string, fallback: any = {}) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}

export function writeJson(file: string, v: unknown) {
  writeFileSync(file, `${JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2)}\n`);
}

/** Records evidence under deployments/<network>.json -> evidence[section] (append). */
export function recordEvidence(network: string, section: string, entry: Record<string, unknown>) {
  const f = deploymentPath(network);
  const d = readJson(f);
  d.evidence ??= {};
  d.evidence[section] ??= [];
  d.evidence[section].push({ at: new Date().toISOString(), ...entry });
  writeJson(f, d);
}
