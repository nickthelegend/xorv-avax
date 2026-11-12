/**
 * A Node client for Ava Labs' EncryptedERC (converter mode over tUSD): register, deposit, private
 * transfer, withdraw, decrypt your balance, and (as the auditor) decrypt amounts. Proofs are made
 * locally with snarkjs from the official circuits (scripts/fetch-eerc-circuits.mjs) and verified on-chain
 * by the official contracts/prod verifiers.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import * as snarkjs from 'snarkjs';
import { parseEventLogs, type Hex } from 'viem';
import { encryptedErcAbi, registrarAbi, testDollarAbi, type Deployment } from '@xorv/sdk';
import { ROOT, type Wallet } from '@xorv/sdk/node';
import { decryptPCT, decryptPoint, encryptMessage, keyFromSignature, keyMessage, pctOf, pointOf, poseidonEncryption, registrationHash, type EercKey } from './crypto.ts';

export * from './crypto.ts';

const CIRCUITS = path.join(ROOT, '.eerc/circuits');
const FILES: Record<string, [string, string]> = {
  registration: ['registration.wasm', 'circuit_final.zkey'],
  transfer: ['transfer.wasm', 'transfer.zkey'],
  withdraw: ['withdraw.wasm', 'circuit_final.zkey'],
};

async function prove(circuit: keyof typeof FILES, input: Record<string, unknown>) {
  const [wasm, zkey] = FILES[circuit].map((f) => path.join(CIRCUITS, circuit, f));
  if (!existsSync(wasm) || !existsSync(zkey)) throw new Error('Setup required: eERC circuits (run pnpm circuits)');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input as any, wasm, zkey);
  return {
    proofPoints: {
      a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])] as [bigint, bigint],
      b: [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ] as [[bigint, bigint], [bigint, bigint]],
      c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])] as [bigint, bigint],
    },
    publicSignals: publicSignals.map((x: string) => BigInt(x)),
  };
}

/** snarkjs keeps worker threads alive; call this before a script exits. */
export async function shutdownProver() {
  const g = globalThis as any;
  if (g.curve_bn128) await g.curve_bn128.terminate();
}

export interface DecryptedBalance {
  amount: bigint;
  consistent: boolean;
  eGCT: { c1: [bigint, bigint]; c2: [bigint, bigint] };
}

export class Eerc {
  readonly d: Deployment;
  readonly w: Wallet;
  key!: EercKey;
  constructor(d: Deployment, w: Wallet) {
    if (!d.eerc) throw new Error('Setup required: this deployment has no eERC contracts');
    this.d = d;
    this.w = w;
  }

  get address() {
    return this.w.account.address;
  }
  private get e() {
    return { address: this.d.eerc!.encryptedERC, abi: encryptedErcAbi } as const;
  }

  /** Derives this account's eERC key from a signature (deterministic for a local key). */
  async init() {
    const sig = await this.w.account.signMessage!({ message: keyMessage(this.address, this.d.chainId) });
    this.key = keyFromSignature(sig);
    return this;
  }

  private async wait(hash: Hex, label: string) {
    const r = await this.w.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
    return r;
  }

  async isRegistered(who: Hex = this.address) {
    return (await this.w.readContract({ address: this.d.eerc!.registrar, abi: registrarAbi, functionName: 'isUserRegistered', args: [who] })) as boolean;
  }

  async register(): Promise<Hex | null> {
    if (await this.isRegistered()) return null;
    const chainId = BigInt(this.d.chainId);
    const proof = await prove('registration', {
      SenderPrivateKey: this.key.formattedPrivateKey,
      SenderPublicKey: this.key.publicKey,
      SenderAddress: BigInt(this.address),
      ChainID: chainId,
      RegistrationHash: registrationHash(this.key, chainId, this.address),
    });
    const hash = await this.w.writeContract({ address: this.d.eerc!.registrar, abi: registrarAbi, functionName: 'register', args: [proof as any], account: this.w.account, chain: this.w.chain });
    await this.wait(hash, 'register');
    return hash;
  }

  async publicKeyOf(who: Hex): Promise<[bigint, bigint]> {
    const pk = (await this.w.readContract({ address: this.d.eerc!.registrar, abi: registrarAbi, functionName: 'getUserPublicKey', args: [who] })) as readonly bigint[];
    if (pk[0] === 0n && pk[1] === 0n) throw new Error(`${who} is not registered with eERC`);
    return [pk[0], pk[1]];
  }

  async auditorPublicKey(): Promise<[bigint, bigint]> {
    const p = (await this.w.readContract({ ...this.e, functionName: 'auditorPublicKey' })) as readonly [bigint, bigint];
    return [p[0], p[1]];
  }

  async tokenId(): Promise<bigint> {
    return (await this.w.readContract({ ...this.e, functionName: 'tokenIds', args: [this.d.contracts.testDollar] })) as bigint;
  }

  /** Decrypts this account's encrypted tUSD balance locally and checks it against the on-chain ElGamal ciphertext. */
  async balance(who: Hex = this.address): Promise<DecryptedBalance> {
    const tokenId = await this.tokenId();
    const [eGCT, , amountPCTs, balancePCT] = (await this.w.readContract({ ...this.e, functionName: 'balanceOf', args: [who, tokenId] })) as any;
    let amount = 0n;
    if (balancePCT.some((x: bigint) => x !== 0n)) amount += decryptPCT(this.key.privateKey, balancePCT)[0];
    for (const a of amountPCTs) if (a.pct.some((x: bigint) => x !== 0n)) amount += decryptPCT(this.key.privateKey, a.pct)[0];
    const c1 = [eGCT.c1.x, eGCT.c1.y] as [bigint, bigint];
    const c2 = [eGCT.c2.x, eGCT.c2.y] as [bigint, bigint];
    let consistent = true;
    if (amount !== 0n || c1[0] !== 0n) {
      const p = decryptPoint(this.key.privateKey, c1, c2);
      const want = pointOf(amount);
      consistent = p[0] === want[0] && p[1] === want[1];
    }
    return { amount, consistent, eGCT: { c1, c2 } };
  }

  /** Public tUSD in, encrypted balance out. The deposited amount is visible (it is an ERC-20 transfer). */
  async deposit(amount: bigint): Promise<Hex> {
    const allowance = (await this.w.readContract({ address: this.d.contracts.testDollar, abi: testDollarAbi, functionName: 'allowance', args: [this.address, this.d.eerc!.encryptedERC] })) as bigint;
    if (allowance < amount) await this.wait(await this.w.writeContract({ address: this.d.contracts.testDollar, abi: testDollarAbi, functionName: 'approve', args: [this.d.eerc!.encryptedERC, 2n ** 255n], account: this.w.account, chain: this.w.chain }), 'approve');
    const amountPCT = pctOf(poseidonEncryption([amount], this.key.publicKey));
    const hash = await this.w.writeContract({ ...this.e, functionName: 'deposit', args: [amount, this.d.contracts.testDollar, amountPCT as any], account: this.w.account, chain: this.w.chain });
    await this.wait(hash, 'deposit');
    return hash;
  }

  /** Encrypted transfer: the amount is hidden on-chain; only the receiver and the auditor can read it. */
  async transfer(to: Hex, amount: bigint): Promise<Hex> {
    const [bal, receiverPk, auditorPk, tokenId] = await Promise.all([this.balance(), this.publicKeyOf(to), this.auditorPublicKey(), this.tokenId()]);
    if (bal.amount < amount) throw new Error(`encrypted balance ${bal.amount} is below ${amount}`);
    const sender = encryptMessage(this.key.publicKey, amount);
    const receiver = encryptMessage(receiverPk, amount);
    const rPct = poseidonEncryption([amount], receiverPk);
    const aPct = poseidonEncryption([amount], auditorPk);
    const newBal = poseidonEncryption([bal.amount - amount], this.key.publicKey);
    const proof = await prove('transfer', {
      ValueToTransfer: amount,
      SenderPrivateKey: this.key.formattedPrivateKey,
      SenderPublicKey: this.key.publicKey,
      SenderBalance: bal.amount,
      SenderBalanceC1: bal.eGCT.c1,
      SenderBalanceC2: bal.eGCT.c2,
      SenderVTTC1: sender.cipher[0],
      SenderVTTC2: sender.cipher[1],
      ReceiverPublicKey: receiverPk,
      ReceiverVTTC1: receiver.cipher[0],
      ReceiverVTTC2: receiver.cipher[1],
      ReceiverVTTRandom: receiver.random,
      ReceiverPCT: rPct.ciphertext,
      ReceiverPCTAuthKey: rPct.authKey,
      ReceiverPCTNonce: rPct.nonce,
      ReceiverPCTRandom: rPct.encRandom,
      AuditorPublicKey: auditorPk,
      AuditorPCT: aPct.ciphertext,
      AuditorPCTAuthKey: aPct.authKey,
      AuditorPCTNonce: aPct.nonce,
      AuditorPCTRandom: aPct.encRandom,
    });
    const hash = await this.w.writeContract({ ...this.e, functionName: 'transfer', args: [to, tokenId, proof as any, pctOf(newBal) as any], account: this.w.account, chain: this.w.chain });
    await this.wait(hash, 'private transfer');
    return hash;
  }

  /** Encrypted balance back to public tUSD. The withdrawn amount is public. */
  async withdraw(amount: bigint): Promise<Hex> {
    const [bal, auditorPk, tokenId] = await Promise.all([this.balance(), this.auditorPublicKey(), this.tokenId()]);
    if (bal.amount < amount) throw new Error(`encrypted balance ${bal.amount} is below ${amount}`);
    const newBal = poseidonEncryption([bal.amount - amount], this.key.publicKey);
    const aPct = poseidonEncryption([amount], auditorPk);
    const proof = await prove('withdraw', {
      ValueToWithdraw: amount,
      SenderPrivateKey: this.key.formattedPrivateKey,
      SenderPublicKey: this.key.publicKey,
      SenderBalance: bal.amount,
      SenderBalanceC1: bal.eGCT.c1,
      SenderBalanceC2: bal.eGCT.c2,
      AuditorPublicKey: auditorPk,
      AuditorPCT: aPct.ciphertext,
      AuditorPCTAuthKey: aPct.authKey,
      AuditorPCTNonce: aPct.nonce,
      AuditorPCTRandom: aPct.encRandom,
    });
    const hash = await this.w.writeContract({ ...this.e, functionName: 'withdraw', args: [tokenId, proof as any, pctOf(newBal) as any], account: this.w.account, chain: this.w.chain });
    await this.wait(hash, 'withdraw');
    return hash;
  }

  /** Incoming encrypted transfers to this account, decrypted with this account's key (as the receiver). */
  async incomingTransfers(fromBlock: bigint) {
    const logs = await this.privateTransferLogs(fromBlock, { to: this.address });
    return logs;
  }

  async privateTransferLogs(fromBlock: bigint, args: { from?: Hex; to?: Hex } = {}) {
    const latest = await this.w.getBlockNumber();
    const out: any[] = [];
    for (let a = fromBlock; a <= latest; a += 2048n) {
      const b = a + 2047n > latest ? latest : a + 2047n;
      out.push(...(await this.w.getContractEvents({ ...this.e, eventName: 'PrivateTransfer', args, fromBlock: a, toBlock: b })));
    }
    return out;
  }

  /** As the auditor: decrypts the amount of a PrivateTransfer or Withdraw event. */
  auditorAmount(auditorPCT: readonly bigint[]): bigint {
    return decryptPCT(this.key.privateKey, auditorPCT)[0];
  }

  static receiptEvents(logs: any[]) {
    return parseEventLogs({ abi: encryptedErcAbi, logs });
  }
}
