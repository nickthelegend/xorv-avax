/**
 * BabyJubJub ElGamal and Poseidon encryption for eERC, ported from Ava Labs' EncryptedERC
 * (src/jub/jub.ts, src/poseidon/poseidon.ts, test/helpers.ts at 8dc98cd). That code is under the
 * Ava Labs Ecosystem License (contracts/lib/eerc/LICENSE.md), which also covers this port.
 */
import { Base8, Fr, addPoint, mulPointEscalar, subOrder, type Point } from '@zk-kit/baby-jubjub';
import { formatPrivKeyForBabyJub, genRandomBabyJubValue, poseidonDecrypt, poseidonEncrypt } from 'maci-crypto';
import { poseidon3 } from 'poseidon-lite';
import { keccak256, type Hex } from 'viem';

/** BabyJubJub base point order (same constant as the eERC repo's src/constants.ts). */
export const BASE_POINT_ORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;
const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface EercKey {
  privateKey: bigint;
  formattedPrivateKey: bigint;
  publicKey: [bigint, bigint];
}

/** The message an account signs to derive its eERC key. Same signature, same key, on any device. */
export const keyMessage = (address: string, chainId: number) =>
  `Xorv private credit (eERC)\nDerive my BabyJubJub key.\nAccount: ${address.toLowerCase()}\nChain: ${chainId}\nThis signature never leaves this device.`;

export function keyFromSignature(signature: Hex): EercKey {
  const privateKey = BigInt(keccak256(signature)) % SNARK_FIELD;
  const formattedPrivateKey = formatPrivKeyForBabyJub(privateKey) % subOrder;
  const pk = mulPointEscalar(Base8, formattedPrivateKey);
  return { privateKey, formattedPrivateKey, publicKey: [BigInt(pk[0]), BigInt(pk[1])] };
}

export const registrationHash = (k: EercKey, chainId: bigint, address: string) => poseidon3([chainId, k.formattedPrivateKey, BigInt(address)]);

function randomNonce(): bigint {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return BigInt(`0x${Buffer.from(b).toString('hex')}`) + 1n;
}

function encRandom(div: bigint) {
  let r = genRandomBabyJubValue();
  if (r >= BASE_POINT_ORDER) r = genRandomBabyJubValue() / div;
  return r;
}

export function encryptMessage(publicKey: bigint[], message: bigint) {
  const random = encRandom(100n);
  const p = mulPointEscalar(Base8, message);
  const c1 = mulPointEscalar(Base8, random);
  const c2 = addPoint(p, mulPointEscalar(publicKey as Point<bigint>, random));
  return { cipher: [c1, c2] as [bigint[], bigint[]], random };
}

export function decryptPoint(privateKey: bigint, c1: bigint[], c2: bigint[]): bigint[] {
  const c1x = mulPointEscalar(c1 as Point<bigint>, formatPrivKeyForBabyJub(privateKey));
  return addPoint(c2 as Point<bigint>, [Fr.e(c1x[0] * -1n), c1x[1]] as Point<bigint>);
}

export function poseidonEncryption(inputs: bigint[], publicKey: bigint[]) {
  const nonce = randomNonce();
  const r = encRandom(10n);
  const key = mulPointEscalar(publicKey as Point<bigint>, r);
  const authKey = mulPointEscalar(Base8, r);
  const ciphertext = poseidonEncrypt(inputs, key, nonce);
  return { ciphertext, nonce, encRandom: r, authKey };
}

/** pct = [ciphertext x4, authKey x2, nonce] */
export function decryptPCT(privateKey: bigint, pct: readonly bigint[], length = 1): bigint[] {
  if (pct.every((x) => x === 0n)) return [0n];
  const shared = mulPointEscalar([pct[4], pct[5]] as Point<bigint>, formatPrivKeyForBabyJub(privateKey));
  return poseidonDecrypt(pct.slice(0, 4), shared, pct[6], length).slice(0, length);
}

export const pctOf = (e: ReturnType<typeof poseidonEncryption>) => [...e.ciphertext, ...e.authKey, e.nonce] as bigint[];

export const pointOf = (amount: bigint) => mulPointEscalar(Base8, amount);
