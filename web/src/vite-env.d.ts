/// <reference types="vite/client" />

// The SDK checks `typeof Buffer` to pick base64 helpers; in the browser it is undefined.
declare const Buffer: { from(data: string, encoding?: string): { toString(encoding?: string): string } };
declare module 'blake-hash' {
  const createBlakeHash: (algo: 'blake512' | 'blake256' | 'blake224' | 'blake384') => { update(data: Uint8Array): { digest(): Uint8Array } };
  export default createBlakeHash;
}
