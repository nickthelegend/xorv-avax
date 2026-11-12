// eERC flows on a local Anvil chain with Ava Labs' official contracts and circuits (real Groth16
// proofs, no mocks). Started by scripts/test-local.sh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { encryptedErcAbi } from '@xorv/sdk';
import { loadDeployment, walletFor } from '@xorv/sdk/node';
import { Eerc, decryptPCT, keyFromSignature, shutdownProver } from '../src/index.ts';

const d = loadDeployment();
const rpc = process.env.XORV_RPC;
after(shutdownProver);

let auditor: Eerc, buyer: Eerc, desk: Eerc, stranger: Eerc;

test('registration with a real proof, then the owner sets the auditor', async () => {
  auditor = await new Eerc(d, walletFor(d, 'XORV_AUDITOR_KEY', rpc)).init();
  buyer = await new Eerc(d, walletFor(d, 'XORV_BUYER_KEY', rpc)).init();
  desk = await new Eerc(d, walletFor(d, 'XORV_DESK_KEY', rpc)).init();
  stranger = await new Eerc(d, walletFor(d, 'XORV_QA_KEY', rpc)).init();
  for (const u of [auditor, buyer, desk]) assert.ok(await u.register());
  assert.equal(await buyer.register(), null, 'registering twice is a no-op');
  const owner = walletFor(d, 'XORV_DEPLOYER_KEY', rpc);
  const h = await owner.writeContract({ address: d.eerc!.encryptedERC, abi: encryptedErcAbi, functionName: 'setAuditorPublicKey', args: [auditor.address] });
  await owner.waitForTransactionReceipt({ hash: h });
  assert.deepEqual(await buyer.auditorPublicKey(), auditor.key.publicKey);
});

test('the same account signature always derives the same eERC key', async () => {
  const again = await new Eerc(d, walletFor(d, 'XORV_BUYER_KEY', rpc)).init();
  assert.deepEqual(again.key.publicKey, buyer.key.publicKey);
  assert.deepEqual(await buyer.publicKeyOf(buyer.address), buyer.key.publicKey);
});

test('deposit, private transfer, decrypt as receiver and as auditor', async () => {
  await buyer.deposit(3_000_000n);
  assert.equal((await buyer.balance()).amount, 3_000_000n);
  const hash = await buyer.transfer(desk.address, 1_250_000n);
  const b = await buyer.balance();
  const k = await desk.balance();
  assert.equal(b.amount, 1_750_000n);
  assert.equal(k.amount, 1_250_000n);
  assert.ok(b.consistent && k.consistent, 'decrypted plaintext matches the on-chain ElGamal ciphertext');
  const rc = await buyer.w.getTransactionReceipt({ hash });
  const ev = Eerc.receiptEvents(rc.logs).find((e: any) => e.eventName === 'PrivateTransfer') as any;
  assert.equal(auditor.auditorAmount(ev.args.auditorPCT), 1_250_000n, 'auditor reads the amount');
  let readByDesk: bigint | null = null;
  try {
    readByDesk = decryptPCT(desk.key.privateKey, ev.args.auditorPCT)[0];
  } catch {
    readByDesk = null; // Poseidon decryption authenticates: a wrong key fails outright
  }
  assert.notEqual(readByDesk, 1_250_000n, 'a non-auditor key cannot read the auditor copy');
  assert.ok(!rc.logs.some((l) => l.data.includes((1_250_000).toString(16).padStart(64, '0'))), 'the amount never appears in plaintext in the logs');
});

test('overspending is impossible: the circuit refuses to prove it', async () => {
  await assert.rejects(buyer.transfer(desk.address, 9_000_000n), /below/);
  // bypass the client check and ask the circuit directly with a false balance claim
  const fake = Object.create(buyer) as Eerc;
  fake.balance = async () => ({ ...(await buyer.balance()), amount: 9_000_000n });
  await assert.rejects(fake.transfer(desk.address, 5_000_000n), /Assert Failed|Error in template|constraint/i);
});

test('a tampered proof is rejected on-chain by the official verifier', async () => {
  const bal = await buyer.balance();
  let captured: any;
  const w = buyer.w as any;
  const original = w.writeContract;
  w.writeContract = async (req: any) => {
    captured = req;
    throw new Error('captured');
  };
  await assert.rejects(buyer.transfer(desk.address, 100_000n), /captured/);
  w.writeContract = original;
  const proof = structuredClone(captured.args[2]);
  proof.publicSignals[0] = proof.publicSignals[0] + 1n; // claim a different sender key / signal
  await assert.rejects(
    buyer.w.simulateContract({ ...captured, args: [captured.args[0], captured.args[1], proof, captured.args[3]], account: buyer.w.account }),
    /revert|InvalidProof|Invalid/i,
  );
  proof.publicSignals[0] = captured.args[2].publicSignals[0];
  proof.proofPoints.a[0] = proof.proofPoints.a[0] + 1n;
  await assert.rejects(buyer.w.simulateContract({ ...captured, args: [captured.args[0], captured.args[1], proof, captured.args[3]], account: buyer.w.account }), /revert|Invalid/i);
  assert.equal((await buyer.balance()).amount, bal.amount, 'nothing moved');
});

test('transfers to or from unregistered accounts revert', async () => {
  assert.equal(await stranger.isRegistered(), false);
  await assert.rejects(buyer.transfer(stranger.address, 1n), /not registered/);
  await assert.rejects(stranger.deposit(1n), /revert|UserNotRegistered|reverted/i);
});

test('withdraw returns public tUSD and updates the encrypted balance', async () => {
  const before = await desk.w.readContract({ address: d.contracts.testDollar, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [desk.address] });
  await desk.withdraw(250_000n);
  const afterBal = await desk.w.readContract({ address: d.contracts.testDollar, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [desk.address] });
  assert.equal((afterBal as bigint) - (before as bigint), 250_000n);
  assert.equal((await desk.balance()).amount, 1_000_000n);
});

test('a key derived from a different signature cannot decrypt the balance', async () => {
  const wrong = keyFromSignature(`0x${'11'.repeat(65)}`);
  const real = await desk.balance();
  const clone = Object.create(desk) as Eerc;
  clone.key = wrong;
  const b = await clone.balance(desk.address).catch(() => null);
  assert.ok(!b || b.amount !== real.amount || !b.consistent);
});
