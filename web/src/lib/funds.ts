/**
 * One tap of test funds: the wallet signs a request (no gas), the Xorv gateway relays it to XorvGasStation on Fuji,
 * which sends tUSD, plus a sip of AVAX when the wallet has none. Limits are on-chain: once per wallet, daily caps.
 */
import { useCallback, useState } from 'react';
import { fundDigest, gasStationAbi } from '@xorv/sdk';
import type { Address, Hex } from 'viem';
import { C, D, reader, usePoll } from './data';
import { GatewayError } from './gateway';
import { localAccount, useWallet, walletMessage } from './wallet';

export const STATION = (C.gasStation ?? null) as Address | null;

export function useDripped(address: Address | null) {
  return usePoll(async () => (STATION && address ? ((await reader.client.readContract({ address: STATION, abi: gasStationAbi, functionName: 'dripped', args: [address] })) as boolean) : null), 30_000, [address]);
}

export interface FundState { busy: boolean; tx?: string; tusd?: string; avax?: string; error?: string }

export function useFunds(onDone?: () => void) {
  const wallet = useWallet();
  const [state, setState] = useState<FundState>({ busy: false });
  const get = useCallback(async (address?: Address, sign?: (hash: Hex) => Promise<Hex>) => {
    const me = address ?? wallet.address;
    if (!STATION) return setState({ busy: false, error: 'Setup required: no XorvGasStation in deployments/fuji.json.' });
    if (!me) return setState({ busy: false, error: 'Connect a wallet first.' });
    setState({ busy: true });
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const signature: Hex = await (sign ?? wallet.signRaw)(fundDigest(STATION, me, deadline, BigInt(D.chainId)));
      let res: Response;
      try {
        res = await fetch('/api/fund', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: me, deadline: deadline.toString(), signature }) });
      } catch {
        throw new GatewayError('The Xorv gateway could not be reached.', 0, true);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new GatewayError(body?.error?.message ?? `HTTP ${res.status}`, res.status);
      await reader.client.waitForTransactionReceipt({ hash: body.hash }).catch(() => undefined);
      setState({ busy: false, tx: body.hash, tusd: body.tusd, avax: body.avax });
      onDone?.();
    } catch (e) {
      setState({ busy: false, error: e instanceof GatewayError ? e.message : walletMessage(e) });
    }
  }, [wallet, onDone]);
  return { ...state, get };
}

/** One tap for a judge with nothing: make a test wallet in this browser, connect it and ask for test funds. */
export function useStartFresh(onDone?: () => void) {
  const wallet = useWallet();
  const funds = useFunds(onDone);
  const start = useCallback(async () => {
    await wallet.connect('local');
    const acct = localAccount();
    if (acct) await funds.get(acct.address, (h) => acct.signMessage({ message: { raw: h } }));
  }, [wallet, funds]);
  return { ...funds, start };
}
