// Deploys XorvGasStation (one-tap test funds for brand-new wallets), funds it and its relayer from the deployer,
// fills its tUSD from the test dollar's faucet, and records it in deployments/<network>.json.
// The relayer is XORV_SPONSOR_KEY (node scripts/keys.ts); the gateway also needs XORV_TAG_SECRET, which this script
// creates in the gitignored .env if it is missing (value never printed).
//   XORV_NETWORK=fuji node scripts/gas-station.ts
// Env: XORV_STATION_AVAX (AVAX sent to the station, default 0.02 on Fuji), XORV_SPONSOR_AVAX (relayer gas, 0.003).
import { appendFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { formatEther, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROOT, keyByName, loadDeployment, readEnvFile, walletFor } from '../packages/sdk/src/node.ts';
import { artifact, deploy, deploymentPath, readJson, send, writeJson } from './lib.ts';

const network = process.env.XORV_NETWORK ?? 'fuji';
const file = process.env.XORV_DEPLOYMENT ? path.resolve(ROOT, process.env.XORV_DEPLOYMENT) : deploymentPath(network);
const d = loadDeployment(file);
const fuji = d.chainId === 43113;

const envFile = path.join(ROOT, '.env');
if (!readEnvFile(envFile, ['XORV_TAG_SECRET']).XORV_TAG_SECRET && !process.env.XORV_TAG_SECRET) {
  appendFileSync(envFile, `${existsSync(envFile) ? '\n' : ''}# HMAC secret for the gas station's per-requester tag (never commit)\nXORV_TAG_SECRET=0x${randomBytes(32).toString('hex')}\n`);
  console.log('XORV_TAG_SECRET written to .env (value not shown)');
}

const cfg = { dripAvax: '0.001', tusd: 2_000_000n, dailyCap: fuji ? 40 : 10, perTagDaily: fuji ? 4 : 3 };
const stationAvax = process.env.XORV_STATION_AVAX ?? (fuji ? '0.02' : '0.05');
const sponsorAvax = process.env.XORV_SPONSOR_AVAX ?? '0.003';

const w = walletFor(d, 'XORV_DEPLOYER_KEY');
const sponsor = privateKeyToAccount(keyByName('XORV_SPONSOR_KEY')).address;
console.log(`gas station on ${network} from ${w.account.address} (${formatEther(await w.getBalance({ address: w.account.address }))} AVAX), relayer ${sponsor}`);
const a = artifact('XorvGasStation.sol', 'XorvGasStation');
const st = await deploy(w, a, [d.contracts.testDollar, sponsor, parseEther(cfg.dripAvax), cfg.tusd, cfg.dailyCap, cfg.perTagDaily], {}, 'XorvGasStation');
const fundStation = await w.sendTransaction({ to: st.address, value: parseEther(stationAvax) });
await w.waitForTransactionReceipt({ hash: fundStation });
console.log(`  station funded ${stationAvax} AVAX          tx ${fundStation}`);
let fundSponsor: string | null = null;
if ((await w.getBalance({ address: sponsor })) < parseEther(sponsorAvax) / 2n) {
  fundSponsor = await w.sendTransaction({ to: sponsor, value: parseEther(sponsorAvax) });
  await w.waitForTransactionReceipt({ hash: fundSponsor as `0x${string}` });
  console.log(`  relayer funded ${sponsorAvax} AVAX          tx ${fundSponsor}`);
}
const refill = await send(w, { address: st.address, abi: a.abi, functionName: 'refill', args: [] }, 'station.refill (100 tUSD)');

const out = readJson(file);
out.contracts.gasStation = st.address;
out.deployTxs ??= {};
out.deployTxs.gasStation = st;
out.gasStation = { relayer: sponsor, dripAvax: cfg.dripAvax, tusd: cfg.tusd.toString(), dailyCap: cfg.dailyCap, perTagDaily: cfg.perTagDaily, funded: { stationAvax, stationTx: fundStation, sponsorAvax: fundSponsor ? sponsorAvax : null, sponsorTx: fundSponsor, refillTx: refill.tx } };
writeJson(file, out);
console.log(`recorded ${path.relative(ROOT, file)} contracts.gasStation = ${st.address}`);
