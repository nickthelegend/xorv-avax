// Creates this repo's Fuji test accounts in the gitignored .env (only names that are missing) and
// writes their public addresses to deployments/accounts.json. Prints addresses, never keys.
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ROOT, readEnvFile } from '../packages/sdk/src/node.ts';
import { writeJson } from './lib.ts';

import { ACCOUNTS } from './accounts.ts';

const envFile = path.join(ROOT, '.env');
const have = readEnvFile(envFile, Object.values(ACCOUNTS));
const lines: string[] = [];
for (const name of Object.values(ACCOUNTS)) if (!have[name]) { const k = generatePrivateKey(); have[name] = k; lines.push(`${name}=${k}`); }
if (lines.length) appendFileSync(envFile, `${existsSync(envFile) ? '\n' : ''}# Fuji test accounts for xorv-avax (testnet only, never commit)\n${lines.join('\n')}\n`);
const addresses = Object.fromEntries(Object.entries(ACCOUNTS).map(([label, name]) => [label, privateKeyToAccount(have[name] as `0x${string}`).address]));
writeJson(path.join(ROOT, 'deployments/accounts.json'), { note: 'Test accounts generated for this repo. Keys live only in the gitignored .env.', addresses });
console.log(`${lines.length} new keys written to .env (values not shown)`);
for (const [l, a] of Object.entries(addresses)) console.log(`  ${l.padEnd(14)} ${a}`);
