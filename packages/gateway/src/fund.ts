/**
 * POST /api/fund { address, deadline, signature }: one tap of test funds for a brand-new wallet.
 * GET  /api/fund                                   the station's address, amounts and what is left today.
 *
 * The gateway is only the relayer. It checks the request off-chain first (cheap, readable errors), then calls
 * XorvGasStation.drip, which checks everything again and enforces the caps on-chain: once per wallet, signed by
 * the wallet, 40 a day, 4 a day per requester tag (an HMAC of the requester's IP; the IP never goes on-chain).
 * Env: XORV_SPONSOR_KEY (the station's relayer), XORV_TAG_SECRET.
 */
import { createHmac } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { formatEther, isAddress, isHex, recoverMessageAddress, type Address, type Hex } from 'viem';
import { fundDigest, gasStationAbi, txUrl, type Deployment, type XorvReader } from '@xorv/sdk';
import { keyByName, readEnvFile, ROOT, walletFor, type Wallet } from '@xorv/sdk/node';
import path from 'node:path';
import { HttpError } from './x402.ts';

const WHY: Record<string, [number, string]> = {
  AlreadyDripped: [409, 'This wallet already got its test funds from Xorv. Draw more tUSD from the faucet on the Account page.'],
  NotWallet: [400, 'That address is a contract, not a wallet.'],
  BadSignature: [401, 'The signature is not from this wallet.'],
  Expired: [400, 'The request expired. Try again.'],
  DeadlineTooFar: [400, 'The request deadline is too far ahead (max 1 hour).'],
  DailyCapReached: [429, 'Xorv has given out today\'s test funds. Try again tomorrow (UTC), or use the Fuji faucet.'],
  TagCapReached: [429, 'This network already got 4 test-fund drips today. Try again tomorrow (UTC).'],
  Empty: [503, 'Setup required: XorvGasStation is out of AVAX. Top it up on Fuji.'],
  NoTusd: [503, 'The station\'s tUSD is used up until its faucet cooldown ends (within the hour). Try again soon.'],
};

/** Per-IP limiter in memory: a first line in front of the on-chain caps. */
class Limiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }
  take(key: string) {
    const now = Date.now();
    const h = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (h.length >= this.max) return { ok: false, retryS: Math.ceil((this.windowMs - (now - h[0])) / 1000) };
    h.push(now);
    this.hits.set(key, h);
    return { ok: true, retryS: 0 };
  }
}

/**
 * The requester's IP. Behind Vercel's rewrite, Traefik sees Vercel's address, so Vercel's own header comes first;
 * then the first X-Forwarded-For hop, X-Real-IP, the socket. A direct caller can forge these headers, which only
 * spreads it across per-tag caps: the station's daily cap and once-per-wallet rule hold on-chain regardless.
 */
export function clientIp(headers: IncomingHttpHeaders, socketIp = ''): string {
  const first = (h: string | string[] | undefined) => String(h ?? '').split(',')[0]?.trim();
  return first(headers['x-vercel-forwarded-for']) || first(headers['x-forwarded-for']) || first(headers['x-real-ip']) || socketIp;
}

export function ipSource(headers: IncomingHttpHeaders): string {
  return headers['x-vercel-forwarded-for'] ? 'x-vercel-forwarded-for' : headers['x-forwarded-for'] ? 'x-forwarded-for' : headers['x-real-ip'] ? 'x-real-ip' : 'socket';
}

export class FundDesk {
  private d: Deployment;
  private reader: XorvReader;
  private sponsor: Wallet | null = null;
  private secret: string | null = null;
  private limiter = new Limiter(6, 60 * 60_000);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(d: Deployment, reader: XorvReader, rpc?: string) {
    this.d = d;
    this.reader = reader;
    try {
      keyByName('XORV_SPONSOR_KEY');
      this.sponsor = walletFor(d, 'XORV_SPONSOR_KEY', rpc);
    } catch {
      this.sponsor = null;
    }
    this.secret = process.env.XORV_TAG_SECRET ?? readEnvFile(path.join(ROOT, '.env'), ['XORV_TAG_SECRET']).XORV_TAG_SECRET ?? null;
  }

  get station(): Address | null {
    return (this.d.contracts.gasStation as Address | undefined) ?? null;
  }

  setupNeeds(): string[] {
    const n: string[] = [];
    if (!this.station) n.push('XorvGasStation is not deployed (node scripts/gas-station.ts)');
    if (!this.sponsor) n.push('XORV_SPONSOR_KEY (the gas station relayer)');
    if (!this.secret) n.push('XORV_TAG_SECRET');
    return n;
  }

  tag(ip: string): Hex {
    return `0x${createHmac('sha256', this.secret ?? '').update(`xorv-gas:${ip}`).digest('hex')}`;
  }

  private read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    return this.reader.client.readContract({ address: this.station!, abi: gasStationAbi, functionName: functionName as any, args: args as any }) as Promise<T>;
  }

  async status(ip: string) {
    const needs = this.setupNeeds();
    if (!this.station) return { enabled: false, setup: needs };
    const [room, avax, tusd, relayer] = await Promise.all([
      this.read<readonly [bigint, bigint, bigint]>('room', [this.tag(ip)]),
      this.read<bigint>('dripAmount'),
      this.read<bigint>('tusdAmount'),
      this.read<Address>('relayer'),
    ]);
    return { enabled: needs.length === 0, setup: needs, station: this.station, relayer, avax: formatEther(avax), tusd: tusd.toString(), left: { today: Number(room[0]), you: Number(room[1]), funded: Number(room[2]) } };
  }

  async fund(body: any, ip: string) {
    const needs = this.setupNeeds();
    if (needs.length) throw new HttpError(503, `Setup required: ${needs.join('; ')}`, { setup: needs });
    const station = this.station!;
    const sponsor = this.sponsor!;
    const address = body?.address;
    const signature = body?.signature;
    let deadline: bigint;
    try {
      deadline = BigInt(body?.deadline);
    } catch {
      throw new HttpError(400, 'deadline must be a unix time in seconds');
    }
    if (typeof address !== 'string' || !isAddress(address)) throw new HttpError(400, 'address must be a Fuji (EVM) address');
    if (typeof signature !== 'string' || !isHex(signature) || signature.length !== 132) throw new HttpError(400, 'signature must be a 65-byte hex signature');
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (deadline < now) throw new HttpError(...WHY.Expired);
    if (deadline > now + 3600n) throw new HttpError(...WHY.DeadlineTooFar);
    const signer = await recoverMessageAddress({ message: { raw: fundDigest(station, address as Address, deadline, BigInt(this.d.chainId)) }, signature: signature as Hex }).catch(() => null);
    if (!signer || signer.toLowerCase() !== address.toLowerCase()) throw new HttpError(...WHY.BadSignature);
    const lim = this.limiter.take(ip);
    if (!lim.ok) throw new HttpError(429, `Too many requests for test funds from this network. Try again in ${Math.ceil(lim.retryS / 60)} min.`);

    const tag = this.tag(ip);
    const [dripped, code, room, relayer, relayerBal, avax, tusdAmount, before] = await Promise.all([
      this.read<boolean>('dripped', [address]),
      this.reader.client.getCode({ address: address as Address }),
      this.read<readonly [bigint, bigint, bigint]>('room', [tag]),
      this.read<Address>('relayer'),
      this.reader.client.getBalance({ address: sponsor.account.address }),
      this.reader.client.getBalance({ address: address as Address }),
      this.read<bigint>('tusdAmount'),
      this.read<bigint>('dripAmount'),
    ]);
    if (relayer.toLowerCase() !== sponsor.account.address.toLowerCase()) throw new HttpError(503, 'Setup required: XORV_SPONSOR_KEY is not the gas station\'s relayer');
    if (dripped) throw new HttpError(...WHY.AlreadyDripped);
    if (code && code !== '0x') throw new HttpError(...WHY.NotWallet);
    if (room[0] === 0n) throw new HttpError(...WHY.DailyCapReached);
    if (room[1] === 0n) throw new HttpError(...WHY.TagCapReached);
    if (avax === 0n && room[2] === 0n) throw new HttpError(...WHY.Empty);
    if (relayerBal < 10n ** 13n) throw new HttpError(503, 'Setup required: the gas station relayer has no AVAX left for its own gas');

    const run = async () => {
      try {
        const args = [address as Address, deadline, signature as Hex, tag] as const;
        const { request } = await sponsor.simulateContract({ account: sponsor.account, address: station, abi: gasStationAbi, functionName: 'drip', args });
        const hash = await sponsor.writeContract(request as any);
        const r = await sponsor.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 60_000 });
        if (r.status !== 'success') throw new HttpError(502, `The drip reverted on Fuji: ${hash}`);
        return { hash, explorer: txUrl(hash, this.d.chainId), avax: avax === 0n ? formatEther(before) : '0', tusd: tusdAmount.toString(), left: { today: Number(room[0]) - 1 } };
      } catch (e) {
        if (e instanceof HttpError) throw e;
        const named = (e as any)?.walk?.((x: any) => !!x?.data?.errorName)?.data?.errorName as string | undefined;
        if (named && WHY[named]) throw new HttpError(...WHY[named]);
        throw new HttpError(502, `Fuji refused the drip: ${String((e as any)?.shortMessage ?? (e as Error).message).split('\n')[0]}`);
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
