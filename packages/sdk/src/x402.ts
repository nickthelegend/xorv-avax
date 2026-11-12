/**
 * x402 v1 "exact" scheme on Avalanche Fuji. The buyer signs an EIP-3009 TransferWithAuthorization
 * (tUSD -> X402Router) and sends it base64-encoded in the X-PAYMENT header. The gateway acts as the
 * facilitator: it checks the signature, then submits X402Router.payAndPost, which moves the money into
 * the job's escrow in the same transaction. The token rejects replays (nonce) and expiry (validBefore).
 */
import { hexToSignature, recoverTypedDataAddress, toHex, type Address, type Hex, type LocalAccount, type WalletClient } from 'viem';

export const X402_VERSION = 1;
export const NETWORK_FUJI = 'avalanche-fuji';

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: { name: string; version: string; chainId: number; job?: Record<string, unknown> };
}

export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: 'exact';
  network: string;
  payload: { signature: Hex; authorization: Authorization };
}

export const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export function domainOf(req: PaymentRequirements) {
  return { name: req.extra.name, version: req.extra.version, chainId: req.extra.chainId, verifyingContract: req.asset } as const;
}

const b64encode = (s: string) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s))));
const b64decode = (s: string) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : decodeURIComponent(escape(atob(s))));

export const encodePayment = (p: PaymentPayload) => b64encode(JSON.stringify(p));

export function decodePayment(header: string): PaymentPayload {
  let p: PaymentPayload;
  try {
    p = JSON.parse(b64decode(header.trim()));
  } catch {
    throw new X402Error('X-PAYMENT is not base64 JSON');
  }
  const a = p?.payload?.authorization;
  if (p?.x402Version !== X402_VERSION || p.scheme !== 'exact' || !a || typeof p.payload.signature !== 'string') throw new X402Error('X-PAYMENT is not an x402 v1 exact payment');
  for (const k of ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'] as const) if (typeof a[k] !== 'string') throw new X402Error(`authorization.${k} missing`);
  return p;
}

export class X402Error extends Error {}

/** Signs the payment for `req`. `validFor` seconds from now; validAfter is a minute back to tolerate clock skew. */
export async function signPayment(
  signer: LocalAccount | { account: Address; client: WalletClient },
  req: PaymentRequirements,
  opts: { validFor?: number; now?: number } = {},
): Promise<PaymentPayload> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const from = 'address' in signer ? signer.address : signer.account;
  const authorization: Authorization = {
    from,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + (opts.validFor ?? Math.min(req.maxTimeoutSeconds, 300))),
    nonce: toHex(nonceBytes),
  };
  const message = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };
  const typed = { domain: domainOf(req), types: transferWithAuthorizationTypes, primaryType: 'TransferWithAuthorization' as const, message };
  const signature = 'address' in signer
    ? await signer.signTypedData(typed)
    : await signer.client.signTypedData({ account: signer.account, ...typed });
  return { x402Version: X402_VERSION, scheme: 'exact', network: req.network, payload: { signature, authorization } };
}

/** Off-chain checks a facilitator makes before spending gas. Throws X402Error with a readable reason. */
export async function verifyPayment(p: PaymentPayload, req: PaymentRequirements, now = Math.floor(Date.now() / 1000)) {
  const a = p.payload.authorization;
  if (p.network !== req.network) throw new X402Error(`payment is for ${p.network}, this resource takes ${req.network}`);
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) throw new X402Error(`payment goes to ${a.to}, not the payTo ${req.payTo}`);
  if (BigInt(a.value) < BigInt(req.maxAmountRequired)) throw new X402Error(`payment of ${a.value} is below the ${req.maxAmountRequired} required`);
  if (Number(a.validBefore) <= now + 6) throw new X402Error('payment authorization has expired');
  if (Number(a.validAfter) >= now) throw new X402Error('payment authorization is not valid yet');
  const signer = await recoverTypedDataAddress({
    domain: domainOf(req),
    types: transferWithAuthorizationTypes,
    primaryType: 'TransferWithAuthorization',
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    signature: p.payload.signature,
  }).catch(() => null);
  if (!signer || signer.toLowerCase() !== a.from.toLowerCase()) throw new X402Error('payment signature does not match authorization.from');
  return a;
}

/** Struct the X402Router expects. */
export function routerAuthorization(p: PaymentPayload) {
  const a = p.payload.authorization;
  const sig = hexToSignature(p.payload.signature);
  return {
    from: a.from,
    value: BigInt(a.value),
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
    v: Number(sig.v ?? BigInt(27 + (sig.yParity ?? 0))),
    r: sig.r,
    s: sig.s,
  };
}
