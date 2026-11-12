import { Buffer } from 'buffer';
const browser = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown; process?: { env: Record<string, string | undefined> } };
browser.Buffer ??= Buffer;
browser.global ??= globalThis;
// Only an empty browser environment, never the gateway's provider credentials.
browser.process ??= { env: {} };
