// Copies Ava Labs' eERC circuit files the browser proves with (registration, transfer) from .eerc/circuits
// (fetched and hash-checked by `pnpm circuits`) into web/public/eerc. Checks each file's sha256 again.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = join(root, '.eerc/circuits');
const out = join(root, 'web/public/eerc');
const files = ['registration/registration.wasm', 'registration/circuit_final.zkey', 'transfer/transfer.wasm', 'transfer/transfer.zkey'];
if (!existsSync(join(src, 'manifest.json'))) {
  console.error('Setup required: eERC circuits are missing. Run `pnpm circuits` at the repo root first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
for (const f of files) {
  const sha = createHash('sha256').update(readFileSync(join(src, f))).digest('hex');
  if (sha !== manifest.sha256[f]) throw new Error(`${f}: sha256 ${sha} does not match the manifest`);
  mkdirSync(dirname(join(out, f)), { recursive: true });
  const dst = join(out, f);
  if (!existsSync(dst) || createHash('sha256').update(readFileSync(dst)).digest('hex') !== sha) copyFileSync(join(src, f), dst);
}
console.log(`eERC circuits in web/public/eerc (${files.length} files, sha256 checked against ${manifest.source})`);
