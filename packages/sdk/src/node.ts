/**
 * Node-only helpers: deployment file, keys read from the repo's gitignored .env by NAME, wallet clients.
 * Key values are never printed or returned.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, publicActions, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainFor, rpcTransport } from './chain.ts';
import type { Deployment } from './types.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function loadDeployment(file = process.env.XORV_DEPLOYMENT ?? path.join(ROOT, 'deployments/fuji.json')): Deployment {
  if (!existsSync(file)) throw new Error(`Setup required: no deployment at ${path.relative(ROOT, file)}; run node scripts/deploy.ts first`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Reads KEY=value lines; only the names asked for are returned. */
export function readEnvFile(file: string, names: readonly string[]): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || !names.includes(m[1])) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2').trim();
    if (v) out[m[1]] = v;
  }
  return out;
}

const repoEnv = () => path.join(ROOT, '.env');

/** Where the xorv and xorv-node CLIs keep their keys: $XORV_HOME (default ~/.xorv), file keys.env, mode 600. */
export const xorvHome = () => process.env.XORV_HOME ?? path.join(homedir(), '.xorv');
export const keysFile = () => path.join(xorvHome(), 'keys.env');

/** Appends NAME=value lines to the keys file (created 600 in a 700 folder). Values are never printed. */
export function saveKeys(entries: Record<string, string>, file = keysFile()) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, Object.entries(entries).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** A key by variable name if one is set anywhere (process env, the repo's .env, the keys file), else null. */
export function maybeKey(name: string): Hex | null {
  const v = process.env[name] ?? readEnvFile(repoEnv(), [name])[name] ?? readEnvFile(keysFile(), [name])[name];
  return v ? ((v.startsWith('0x') ? v : `0x${v}`) as Hex) : null;
}

/** A private key by variable name: process env first, then the repo's gitignored .env, then $XORV_HOME/keys.env. */
export function keyByName(name: string): Hex {
  const v = maybeKey(name);
  if (!v) throw new Error(`Setup required: ${name} (a Fuji test key in the gitignored .env or ${keysFile()}; xorv-node init / xorv wallet new make one)`);
  return v;
}

export function walletFor(d: Deployment, keyName: string, rpc?: string) {
  const account = privateKeyToAccount(keyByName(keyName));
  const url = rpc ?? process.env.XORV_RPC ?? d.rpc;
  return createWalletClient({ account, chain: chainFor(d.chainId, url.split(',')[0]), transport: rpcTransport(d, rpc ?? process.env.XORV_RPC) }).extend(publicActions);
}

export type Wallet = ReturnType<typeof walletFor>;
export * from './term.ts';
