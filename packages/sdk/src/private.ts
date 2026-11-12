import { keccak256, toBytes, type Hex } from 'viem';

/** Messages a buyer signs to use the eERC private credit lane (EIP-191, no gas). */
export const creditMessage = (address: string, ts: number) => `Xorv private credit\nShow the credit of ${address.toLowerCase()}\nat ${ts}`;
export const chatMessage = (address: string, ts: number, bodyHash: Hex) =>
  `Xorv private chat\nSpend my private credit on this request.\nAccount: ${address.toLowerCase()}\nRequest: ${bodyHash}\nAt: ${ts}`;
export const requestHash = (request: unknown): Hex => keccak256(toBytes(JSON.stringify(request)));
