// Which wallets have their eERC key open in this tab. Kept apart from lib/private.ts so pages can ask without
// loading the eERC SDK and snarkjs (they load on first use).
export const keySessions = new Map<string, unknown>();
const subs = new Set<() => void>();
export const keyOpen = (a?: string | null) => !!a && keySessions.has(a.toLowerCase());
export const onKeys = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const keysChanged = () => subs.forEach((f) => f());
export const loadPrivate = () => import('./private');
