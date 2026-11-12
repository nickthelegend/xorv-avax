/// <reference types="vite/client" />

// The SDK checks `typeof Buffer` to pick base64 helpers; in the browser it is undefined.
declare const Buffer: { from(data: string, encoding?: string): { toString(encoding?: string): string } };
