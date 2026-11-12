/**
 * One-tap test funds. A brand-new wallet signs a request (no gas); the Xorv gateway relays it to XorvGasStation on
 * Fuji, which checks the signature, sends tUSD (and a sip of AVAX if the wallet has none) once per wallet, and
 * keeps the daily and per-requester caps on-chain. The digest must match XorvGasStation.digest (tested on Anvil).
 */
import { encodePacked, keccak256, type Address, type Hex } from 'viem';

export function fundDigest(station: Address, to: Address, deadline: bigint, chainId = 43113n): Hex {
  return keccak256(encodePacked(['string', 'uint256', 'address', 'address', 'uint256'], ['Xorv test funds', chainId, station, to, deadline]));
}

export interface FundRequest { address: Address; deadline: string; signature: Hex }
export interface Funded { hash: Hex; avax: string; tusd: string; left: { today: number } }
