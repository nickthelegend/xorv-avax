// Deploys Xorv (test dollar, index, registry, similarity library, market, x402 router) and Ava Labs'
// official eERC in converter mode over the test dollar. Writes deployments/<network>.json.
//   XORV_NETWORK=fuji node scripts/deploy.ts        (default; RPC https://api.avax-test.network/ext/bc/C/rpc)
//   XORV_NETWORK=local XORV_RPC=http://127.0.0.1:5545 node scripts/deploy.ts
import { FUJI_RPC } from '../packages/sdk/src/chain.ts';
import { walletFor } from '../packages/sdk/src/node.ts';
import type { Deployment } from '../packages/sdk/src/types.ts';
import { artifact, deploy, deploymentPath, send, writeJson } from './lib.ts';

const network = process.env.XORV_NETWORK ?? 'fuji';
const chainId = network === 'fuji' ? 43113 : 31337;
const rpc = process.env.XORV_RPC ?? (network === 'fuji' ? FUJI_RPC : 'http://127.0.0.1:5545');

const config = {
  minStake: 5_000_000n, // 5 tUSD
  slashBps: 1000, // 10% of stake per slash
  unbondSecs: 1800,
  spotCheckBps: 3000, // 30% of deliveries are re-run
  toleranceBps: Number(process.env.XORV_TOLERANCE_BPS ?? 5000),
  checkFee: 200n, // $0.0002 per check
  minWindowSecs: 3,
  maxWindowSecs: 600,
  indexMaxStepBps: 2500,
};

async function main() {
  const w = walletFor({ chainId, rpc } as Deployment, 'XORV_DEPLOYER_KEY', rpc);
  console.log(`deploying to ${network} (${chainId}) from ${w.account.address}`);
  const startBlock = Number(await w.getBlockNumber());
  const txs: Record<string, unknown> = {};

  const token = await deploy(w, artifact('TestDollar.sol', 'TestDollar'), [], {}, 'TestDollar (tUSD)');
  const index = await deploy(w, artifact('XorvIndex.sol', 'XorvIndex'), [config.indexMaxStepBps], {}, 'XorvIndex');
  const registry = await deploy(w, artifact('XorvRegistry.sol', 'XorvRegistry'), [token.address, config.minStake, config.slashBps, config.unbondSecs], {}, 'XorvRegistry');
  const similarity = await deploy(w, artifact('Similarity.sol', 'Similarity'), [], {}, 'Similarity (library)');
  const market = await deploy(
    w,
    artifact('XorvMarket.sol', 'XorvMarket'),
    [token.address, registry.address, index.address, { spotCheckBps: config.spotCheckBps, toleranceBps: config.toleranceBps, checkFee: config.checkFee, minWindowSecs: config.minWindowSecs, maxWindowSecs: config.maxWindowSecs }],
    { Similarity: similarity.address },
    'XorvMarket',
  );
  const router = await deploy(w, artifact('X402Router.sol', 'X402Router'), [market.address], {}, 'X402Router');
  const reg = artifact('XorvRegistry.sol', 'XorvRegistry');
  const idx = artifact('XorvIndex.sol', 'XorvIndex');
  const mkt = artifact('XorvMarket.sol', 'XorvMarket');
  txs.registrySetMarket = await send(w, { address: registry.address, abi: reg.abi, functionName: 'setMarket', args: [market.address] }, 'registry.setMarket');
  txs.indexSetMarket = await send(w, { address: index.address, abi: idx.abi, functionName: 'setMarket', args: [market.address] }, 'index.setMarket');
  txs.marketSetRouter = await send(w, { address: market.address, abi: mkt.abi, functionName: 'setRouter', args: [router.address] }, 'market.setRouter');

  console.log('eERC (Ava Labs EncryptedERC, converter mode over tUSD)');
  const v = {
    registration: await deploy(w, artifact('RegistrationVerifier.sol', 'RegistrationVerifier'), [], {}, 'RegistrationVerifier'),
    mint: await deploy(w, artifact('MintVerifier.sol', 'MintVerifier'), [], {}, 'MintVerifier'),
    withdraw: await deploy(w, artifact('WithdrawVerifier.sol', 'WithdrawVerifier'), [], {}, 'WithdrawVerifier'),
    transfer: await deploy(w, artifact('TransferVerifier.sol', 'TransferVerifier'), [], {}, 'TransferVerifier'),
    burn: await deploy(w, artifact('BurnVerifier.sol', 'BurnVerifier'), [], {}, 'BurnVerifier'),
  };
  const bjj = await deploy(w, artifact('BabyJubJub.sol', 'BabyJubJub'), [], {}, 'BabyJubJub (library)');
  const registrar = await deploy(w, artifact('Registrar.sol', 'Registrar'), [v.registration.address], {}, 'Registrar');
  const eerc = await deploy(
    w,
    artifact('EncryptedERC.sol', 'EncryptedERC'),
    [{ registrar: registrar.address, isConverter: true, name: '', symbol: '', decimals: 6, mintVerifier: v.mint.address, withdrawVerifier: v.withdraw.address, transferVerifier: v.transfer.address, burnVerifier: v.burn.address }],
    { BabyJubJub: bjj.address },
    'EncryptedERC (converter)',
  );

  const all = { token, index, registry, similarity, market, router, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [`${k}Verifier`, x])), babyJubJub: bjj, registrar, encryptedERC: eerc };
  const d: Deployment = {
    network: network === 'fuji' ? 'Avalanche Fuji C-Chain' : 'Anvil (local)',
    chainId,
    rpc,
    explorer: network === 'fuji' ? 'https://testnet.snowtrace.io' : '',
    deployedAt: new Date().toISOString(),
    deployer: w.account.address,
    startBlock,
    contracts: { testDollar: token.address, index: index.address, registry: registry.address, similarity: similarity.address, market: market.address, router: router.address },
    eerc: {
      encryptedERC: eerc.address,
      registrar: registrar.address,
      babyJubJub: bjj.address,
      verifiers: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.address])),
      decimals: 6,
    },
    config: { ...config, minStake: config.minStake.toString(), checkFee: config.checkFee.toString() },
    deployTxs: Object.fromEntries(Object.entries(all).map(([k, x]) => [k, { address: x.address, tx: x.tx, block: x.block, gasUsed: x.gasUsed }])),
    wiringTxs: txs,
    source: { eerc: 'https://github.com/ava-labs/EncryptedERC @ 8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1 (contracts/prod verifiers, unmodified)' },
  };
  writeJson(deploymentPath(network), d);
  const gas = Object.values(all).reduce((s, x) => s + x.gasUsed, 0);
  console.log(`wrote deployments/${network}.json · ${Object.keys(all).length} contracts · ${gas.toLocaleString()} gas`);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
