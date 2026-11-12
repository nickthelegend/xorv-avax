// Fetches Ava Labs' official eERC circuit artifacts (wasm + proving keys from their trusted setup,
// circom/build in github.com/ava-labs/EncryptedERC) into .eerc/circuits. These match the
// contracts/prod verifiers deployed on Fuji. ~57 MB, so they are not committed.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.eerc/circuits');
const FILES = {
  registration: ['registration.wasm', 'circuit_final.zkey'],
  transfer: ['transfer.wasm', 'transfer.zkey'],
  withdraw: ['withdraw.wasm', 'circuit_final.zkey'],
  mint: ['mint.wasm', 'mint.zkey'],
  burn: ['burn.wasm', 'burn.zkey'],
};
const local = process.env.EERC_REPO; // optional: a local clone at the same commit

const manifest = {};
for (const [circuit, files] of Object.entries(FILES)) {
  mkdirSync(path.join(out, circuit), { recursive: true });
  for (const f of files) {
    const dest = path.join(out, circuit, f);
    if (!existsSync(dest)) {
      let buf;
      const src = local && path.join(local, 'circom/build', circuit, f);
      if (src && existsSync(src)) buf = readFileSync(src);
      else {
        const url = `https://raw.githubusercontent.com/ava-labs/EncryptedERC/${COMMIT}/circom/build/${circuit}/${f}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`download failed ${r.status}: ${url}`);
        buf = Buffer.from(await r.arrayBuffer());
      }
      writeFileSync(dest, buf);
      console.log(`  ${circuit}/${f} ${(buf.length / 1e6).toFixed(1)} MB`);
    }
    manifest[`${circuit}/${f}`] = createHash('sha256').update(readFileSync(dest)).digest('hex');
  }
}
writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ source: `github.com/ava-labs/EncryptedERC@${COMMIT}/circom/build`, sha256: manifest }, null, 2)}\n`);
console.log(`eERC circuits ready in .eerc/circuits (${Object.keys(manifest).length} files)`);
