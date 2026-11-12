// Sends test AVAX from an already-funded Fuji key in another local repo to this repo's deployer.
// The funder key is read by variable name from XORV_FUNDER_ENV (default var PRIVATE_KEY); it is
// never printed or copied.   XORV_FUNDER_ENV=/path/.env node scripts/fund-deployer.ts 0.08
import { createWalletClient, formatEther, http, parseEther, publicActions, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fuji, FUJI_RPC } from '../packages/sdk/src/chain.ts';
import { keyByName, readEnvFile } from '../packages/sdk/src/node.ts';
import { recordEvidence } from './lib.ts';

const file = process.env.XORV_FUNDER_ENV;
const name = process.env.XORV_FUNDER_VAR ?? 'PRIVATE_KEY';
if (!file) throw new Error('Setup required: XORV_FUNDER_ENV (path to an env file with a funded Fuji key)');
const raw = readEnvFile(file, [name])[name];
if (!raw) throw new Error(`Setup required: ${name} not found in XORV_FUNDER_ENV`);
const funder = createWalletClient({ account: privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as Hex), chain: fuji, transport: http(FUJI_RPC) }).extend(publicActions);
const to = privateKeyToAccount(keyByName('XORV_DEPLOYER_KEY')).address;
const amount = parseEther(process.argv[2] ?? '0.08');

const before = await funder.getBalance({ address: funder.account.address });
console.log(`funder ${funder.account.address} has ${formatEther(before)} AVAX`);
if (before < amount + parseEther('0.01')) throw new Error('funder balance too low');
const hash = await funder.sendTransaction({ to, value: amount });
await funder.waitForTransactionReceipt({ hash });
console.log(`sent ${formatEther(amount)} AVAX to deployer ${to}: https://testnet.snowtrace.io/tx/${hash}`);
recordEvidence('fuji', 'funding', { from: funder.account.address, to, avax: formatEther(amount), tx: hash });
