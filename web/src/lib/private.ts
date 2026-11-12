/**
 * The eERC private credit lane in the browser, on Ava Labs' official SDK (@avalabs/eerc-sdk EERC class) and the
 * EncryptedERC (converter over tUSD) on Fuji. The eERC key comes from one wallet signature (the SDK's own scheme)
 * and stays in this tab's memory; registration and transfer proofs are made here with snarkjs and Ava Labs'
 * production circuit files (served from /eerc, sha256-checked at build time).
 */
import { EERC } from '@avalabs/eerc-sdk';
import createBlakeHash from 'blake-hash';
import { Buffer } from 'buffer';
import type { Address, Hex, WalletClient } from 'viem';
import { encryptedErcAbi, registrarAbi, senderCiphertext, testDollarAbi } from '@xorv/sdk';
import { C, D, reader } from './data';
import { keySessions, keysChanged } from './eerc-keys';

const E = D.eerc ?? null;
const at = (p: string) => `${location.origin}/eerc/${p}`;
// Converter mode never mints or burns, and Xorv never withdraws from the browser; the SDK still wants every slot.
const CIRCUITS = {
  register: { wasm: at('registration/registration.wasm'), zkey: at('registration/circuit_final.zkey') },
  transfer: { wasm: at('transfer/transfer.wasm'), zkey: at('transfer/transfer.zkey') },
  withdraw: { wasm: at('withdraw/withdraw.wasm'), zkey: at('withdraw/circuit_final.zkey') },
  mint: { wasm: at('mint/mint.wasm'), zkey: at('mint/mint.zkey') },
  burn: { wasm: at('burn/burn.wasm'), zkey: at('burn/burn.zkey') },
};
const ORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;

interface Session { eerc: EERC; secret: bigint }
const sessions = keySessions as Map<string, Session>;

/** The SDK's curve scalar for a decryption key (blake512, pruned, >> 3, mod the subgroup order). Checked below. */
function scalarOf(decryptionKey: string): bigint {
  const b = Buffer.from(createBlakeHash('blake512').update(Buffer.from(decryptionKey, 'hex')).digest().slice(0, 32));
  b[0] &= 248;
  b[31] = (b[31] & 127) | 64;
  return (BigInt(`0x${Buffer.from(b).reverse().toString('hex')}`) >> 3n) % ORDER;
}

function need() {
  if (!E) throw new Error('Setup required: this deployment has no eERC contracts.');
  return E;
}

/** Opens (or reuses) this wallet's eERC key: one signature of the SDK's fixed message. */
export async function openKey(me: Address, wallet: WalletClient): Promise<Session> {
  const hit = sessions.get(me.toLowerCase());
  if (hit) return hit;
  const e = need();
  const eerc = new EERC(reader.client as never, wallet as never, e.encryptedERC, e.registrar, true, CIRCUITS);
  const key = await eerc.generateDecryptionKey();
  const secret = scalarOf(key);
  const pk = eerc.curve.generatePublicKey(secret);
  if (pk[0] !== eerc.publicKey[0] || pk[1] !== eerc.publicKey[1]) throw new Error('The eERC key check failed (SDK key format changed). Nothing was sent.');
  const s = { eerc, secret };
  sessions.set(me.toLowerCase(), s);
  keysChanged();
  return s;
}

export async function isRegistered(who: Address) {
  return (await reader.client.readContract({ address: need().registrar, abi: registrarAbi, functionName: 'isUserRegistered', args: [who] })) as boolean;
}

async function rawBalance(me: Address) {
  const tokenId = (await reader.client.readContract({ address: need().encryptedERC, abi: encryptedErcAbi, functionName: 'tokenIds', args: [C.testDollar] })) as bigint;
  if (!tokenId) return null;
  const b = (await reader.client.readContract({ address: need().encryptedERC, abi: encryptedErcAbi, functionName: 'balanceOf', args: [me, tokenId] })) as any;
  return { eGCT: b[0], amountPCTs: b[2], balancePCT: b[3], encrypted: [b[0].c1.x, b[0].c1.y, b[0].c2.x, b[0].c2.y] as bigint[] };
}

/** This wallet's encrypted balance, decrypted in this tab and checked against the on-chain ElGamal ciphertext. */
export async function privateBalance(me: Address): Promise<bigint | null> {
  const s = sessions.get(me.toLowerCase());
  if (!s) return null;
  const b = await rawBalance(me);
  if (!b || b.encrypted.every((x) => x === 0n)) return 0n;
  const v = s.eerc.calculateTotalBalance(b.eGCT, b.amountPCTs, b.balancePCT);
  if (v < 0n) throw new Error('Your encrypted balance failed its consistency check (ciphertext and hints disagree).');
  return v;
}

const wait = async (hash: Hex, what: string) => {
  const r = await reader.client.waitForTransactionReceipt({ hash, pollingInterval: 1000, timeout: 120_000 });
  if (r.status !== 'success') throw new Error(`${what} reverted on Fuji: ${hash}`);
  return hash;
};

export type Step = (label: string, tx?: Hex) => void;

/**
 * Private top-up of the Xorv desk: register (proof here), approve and deposit public tUSD into eERC, then an
 * encrypted transfer to the desk (proof here). Only the deposit amount is public.
 */
export async function topUpDesk(me: Address, wallet: WalletClient, write: (req: { address: Address; abi: any; functionName: string; args?: unknown[] }) => Promise<Hex>, amount: bigint, step: Step) {
  const e = need();
  if (!e.desk) throw new Error('Setup required: the deployment names no desk.');
  step('Sign once to open your eERC key (no gas)');
  const s = await openKey(me, wallet);
  if (!(await isRegistered(me))) {
    step('Proving your eERC key in this browser');
    const r = await s.eerc.register();
    if (r.transactionHash) step('Registered on Fuji', await wait(r.transactionHash as Hex, 'Registration'));
  }
  const have = (await privateBalance(me)) ?? 0n;
  if (have < amount) {
    const need = amount - have;
    const allowance = (await reader.client.readContract({ address: C.testDollar, abi: testDollarAbi, functionName: 'allowance', args: [me, e.encryptedERC] })) as bigint;
    if (allowance < need) {
      step('Approving tUSD for eERC');
      step('Approved', await wait(await write({ address: C.testDollar, abi: testDollarAbi, functionName: 'approve', args: [e.encryptedERC, 2n ** 255n] }), 'Approve'));
    }
    step(`Depositing ${Number(need) / 1e6} tUSD into your encrypted balance (this amount is public)`);
    const dep = await s.eerc.deposit(need, C.testDollar, 6n);
    step('Deposited', await wait(dep.transactionHash as Hex, 'Deposit'));
  }
  const b = await rawBalance(me);
  const bal = await privateBalance(me);
  if (!b || bal == null || bal < amount) throw new Error('Your encrypted balance is below the top-up after the deposit. Try again in a few seconds.');
  const auditor = (await reader.client.readContract({ address: e.encryptedERC, abi: encryptedErcAbi, functionName: 'auditorPublicKey' })) as readonly [bigint, bigint];
  step('Proving the encrypted transfer to the desk in this browser');
  const t = await s.eerc.transfer(e.desk, amount, b.encrypted, bal, [auditor[0], auditor[1]], C.testDollar);
  const tx = await wait(t.transactionHash as Hex, 'Encrypted transfer');
  step('Sent to the desk; the amount is a ciphertext on Fuji', tx);
  return tx;
}

/** Whether `claimed` is what this wallet's own transfer proof moved (the sender ciphertext, decrypted here). */
export async function proofMoved(me: Address, tx: Hex, claimed: bigint): Promise<boolean | null> {
  const s = sessions.get(me.toLowerCase());
  if (!s) return null;
  const ct = await senderCiphertext(reader.client as never, tx);
  const p = s.eerc.curve.elGamalDecryption(s.secret, { c1: ct.c1, c2: ct.c2 });
  const want = s.eerc.curve.mulWithScalar(s.eerc.curve.Base8, claimed);
  return p[0] === want[0] && p[1] === want[1];
}
