// Ava Labs' eERC SDK and snarkjs expect Node's Buffer in the browser.
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
