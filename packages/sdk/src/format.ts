/** tUSD has 6 decimals. Rates are micro-dollars per 1k tokens. */
export const MICRO = 1_000_000n;

export function usd(micro: bigint | number | string, digits = 4): string {
  const v = Number(BigInt(micro)) / 1e6;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** A rate in micro-dollars per 1k tokens, shown as dollars per 1M tokens (the unit model price lists use). */
export function perMillion(ratePer1k: bigint | number | string, digits = 2): string {
  const v = (Number(BigInt(ratePer1k)) * 1000) / 1e6;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const short = (a: string, n = 4) => (a && a.length > 2 + 2 * n ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : a);
