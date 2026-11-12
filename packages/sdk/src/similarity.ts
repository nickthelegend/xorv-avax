/**
 * Word-set Jaccard similarity in basis points, the same computation as contracts/src/Similarity.sol:
 * words are runs of ASCII letters/digits or non-ASCII UTF-8 bytes, ASCII letters lowercased, hashed
 * with 64-bit FNV-1a. Nodes use it to predict what the contract will compute.
 */
const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export function wordHashes(text: string): Set<bigint> {
  const bytes = new TextEncoder().encode(text);
  const out = new Set<bigint>();
  let h = OFFSET;
  let inWord = false;
  for (let c of bytes) {
    const upper = c >= 0x41 && c <= 0x5a;
    const word = (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a) || upper || c >= 0x80;
    if (word) {
      if (upper) c += 32;
      if (!inWord) {
        h = OFFSET;
        inWord = true;
      }
      h = ((h ^ BigInt(c)) * PRIME) & MASK;
    } else if (inWord) {
      out.add(h);
      inWord = false;
    }
  }
  if (inWord) out.add(h);
  return out;
}

export function similarityBps(a: string, b: string): number {
  const wa = wordHashes(a);
  const wb = wordHashes(b);
  if (wa.size === 0 && wb.size === 0) return 10_000;
  let inter = 0;
  for (const h of wa) if (wb.has(h)) inter++;
  return Math.floor((inter * 10_000) / (wa.size + wb.size - inter));
}
