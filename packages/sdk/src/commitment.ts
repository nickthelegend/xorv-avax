import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';

/** keccak256(abi.encode(chainid, market, jobId, node, rate, salt)), as XorvMarket.bidCommitment */
export function bidCommitment(chainId: number, market: Address, jobId: bigint | number, node: Address, rate: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint64' }, { type: 'bytes32' }],
      [BigInt(chainId), market, BigInt(jobId), node, rate, salt],
    ),
  );
}

export function newSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}
