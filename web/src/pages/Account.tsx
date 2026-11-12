import { useState } from 'react';
import { formatEther, type Hex } from 'viem';
import { creditMessage, encryptedErcAbi, registrarAbi, testDollarAbi } from '@xorv/sdk';
import { C, D, addrUrl, jobTitle, jobsOf, modelName, money, rate1m, reader, txUrl, useMarket, useNow, usePoll, utc } from '../lib/data';
import { gateway, type Credit, GatewayError, GATEWAY_START } from '../lib/gateway';
import { Link } from '../lib/router';
import { CopyButton, Icon, State } from '../components/Ui';
import { PageHead, Tile } from '../components/Shell';
import { StatusTag } from '../components/Market';
import { QA, useWallet, walletMessage } from '../lib/wallet';

type Tab = 'wallet' | 'private';

function Connect() {
  const wallet = useWallet();
  return (
    <State kind="setup" art="coin" title="Connect a wallet on Avalanche Fuji" action={wallet.hasInjected || wallet.qaAvailable ? <button className="btn btn-w btn-sm" onClick={() => void wallet.connect()} disabled={wallet.connecting}>{wallet.connecting ? 'Connecting…' : 'Connect wallet'}</button> : <a className="btn btn-sm" href="https://core.app/" target="_blank" rel="noreferrer">Get Core wallet <Icon name="external" size={13} /></a>}>
      Your wallet signs x402 payments in tUSD, the test dollar Xorv uses on Fuji. {wallet.error && <span className="bad-c"> {wallet.error}</span>}
    </State>
  );
}

function WalletTab({ address }: { address: Hex }) {
  const wallet = useWallet();
  const m = useMarket();
  const now = useNow(10_000);
  const bal = usePoll(async () => {
    const [tusd, avax, last] = await Promise.all([
      reader.tokenBalance(address),
      reader.client.getBalance({ address }),
      reader.client.readContract({ address: C.testDollar, abi: testDollarAbi, functionName: 'lastDrip', args: [address] }) as Promise<bigint>,
    ]);
    return { tusd, avax, last: Number(last) };
  }, 15_000, [address]);
  const jobs = usePoll(() => jobsOf(address), 20_000, [address]);
  const [faucet, setFaucet] = useState<{ busy: boolean; tx?: string; error?: string }>({ busy: false });
  const nextDrip = bal.data && bal.data.last ? bal.data.last + 3600 : 0;
  const spent = (jobs.data ?? []).reduce((a, j) => a + j.charge, 0n);
  async function drip() {
    setFaucet({ busy: true });
    try {
      const tx = await wallet.write({ address: C.testDollar, abi: testDollarAbi, functionName: 'faucet' });
      await reader.client.waitForTransactionReceipt({ hash: tx });
      setFaucet({ busy: false, tx });
      bal.reload();
    } catch (e) {
      setFaucet({ busy: false, error: walletMessage(e) });
    }
  }
  return (
    <>
      {bal.error && !bal.data && <State kind="error" art="warning" title="Could not read your balances">{bal.error}</State>}
      {!bal.data && !bal.error && <div className="skeleton sk-row" />}
      {bal.data && (
        <div className="tiles">
          <Tile label="tUSD" value={money(bal.data.tusd, 2)} note="test dollars for x402 payments" />
          <Tile label="AVAX" value={Number(formatEther(bal.data.avax)).toFixed(4)} note="gas, only for the faucet and eERC" />
          <Tile label="Spent on AI" value={money(spent)} note={`${jobs.data?.length ?? '…'} jobs posted from this address`} />
          <Tile label="Network" value="Fuji" note={<a className="link" href={addrUrl(address)} target="_blank" rel="noreferrer">Snowtrace ↗</a>} />
        </div>
      )}
      <section className="sec">
        <div className="sec-h"><div><h2>Add tUSD</h2><p>The test dollar's faucet gives 100 tUSD per address per hour. x402 payments need no AVAX; the facilitator pays the gas.</p></div></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
          <div className="copyline"><span>{address}</span><CopyButton text={address} className="btn btn-sm" /></div>
          <div className="ph-actions">
            <button className="btn btn-w btn-sm" onClick={() => void drip()} disabled={faucet.busy || (nextDrip > now)}>{faucet.busy ? 'Confirm in your wallet…' : nextDrip > now ? `Faucet again in ${Math.ceil((nextDrip - now) / 60)} min` : 'Draw 100 tUSD'}</button>
            <a className="btn btn-sm" href={addrUrl(C.testDollar)} target="_blank" rel="noreferrer">tUSD contract <Icon name="external" size={13} /></a>
          </div>
          {faucet.tx && <p className="note">Drawn: <a className="link" href={txUrl(faucet.tx)} target="_blank" rel="noreferrer">{faucet.tx.slice(0, 12)}…</a></p>}
          {faucet.error && <p className="note bad-c">{faucet.error}</p>}
          {bal.data && bal.data.avax === 0n && <p className="note">The faucet is a transaction, so it needs a little Fuji AVAX for gas. Chat over x402 does not.</p>}
        </div>
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2>Your jobs</h2><p>Every job this address paid for, read from JobPosted events.</p></div><Link to="/chat">Chat <Icon name="arrow" size={14} /></Link></div>
        {jobs.error && !jobs.data && <State kind="error" art="warning" title="Could not read your jobs">{jobs.error}</State>}
        {!jobs.data && !jobs.error && <div className="skeleton sk-row" />}
        {jobs.data && !jobs.data.length && <State kind="empty" art="empty" title="No jobs yet" action={<Link to="/chat" className="btn btn-sm">Start a chat</Link>}>Your first paid message shows up here with its cost and record.</State>}
        {jobs.data && jobs.data.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Job</th><th>Model</th><th className="r">Rate</th><th className="r">Tokens</th><th className="r">Paid</th><th>Status</th><th className="r">When</th></tr></thead>
              <tbody>{jobs.data.map((j) => <tr key={j.id}><td className="wrap-c"><Link to={`/jobs/${j.id}`} className="row-link"><span className="faint mono-c">#{j.id}</span> {jobTitle(m.data, j)}</Link></td><td>{modelName(j.model)}</td><td className="r num">{j.clearedRate ? rate1m(j.clearedRate) : '—'}</td><td className="r num">{j.tokens}</td><td className="r num">{j.charge ? money(j.charge) : '—'}</td><td><StatusTag j={j} /></td><td className="r faint">{utc(j.createdAt).slice(5)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function PrivateTab({ address }: { address: Hex }) {
  const wallet = useWallet();
  const e = D.eerc;
  const chain = usePoll(async () => {
    if (!e) return null;
    const [registered, tokenId] = await Promise.all([
      reader.client.readContract({ address: e.registrar, abi: registrarAbi, functionName: 'isUserRegistered', args: [address] }) as Promise<boolean>,
      reader.client.readContract({ address: e.encryptedERC, abi: encryptedErcAbi, functionName: 'tokenIds', args: [C.testDollar] }) as Promise<bigint>,
    ]);
    const b = registered && tokenId ? ((await reader.client.readContract({ address: e.encryptedERC, abi: encryptedErcAbi, functionName: 'balanceOf', args: [address, tokenId] })) as any) : null;
    return { registered, tokenId, balance: b ? { c1: [b[0].c1.x, b[0].c1.y], c2: [b[0].c2.x, b[0].c2.y], pending: b[2].length as number, txIndex: Number(b[4]) } : null };
  }, 20_000, [address]);
  const [credit, setCredit] = useState<{ busy: boolean; data?: Credit; error?: string }>({ busy: false });
  async function show() {
    setCredit({ busy: true });
    try {
      const ts = Math.floor(Date.now() / 1000);
      const signature = await wallet.signMessage(creditMessage(address, ts));
      setCredit({ busy: false, data: await gateway.credit({ address, ts, signature }) });
    } catch (err) {
      setCredit({ busy: false, error: err instanceof GatewayError ? (err.offline ? `The gateway is not running. Start it with ${GATEWAY_START}` : err.message) : walletMessage(err) });
    }
  }
  if (!e) return <State kind="setup" art="shield" title="eERC is not deployed here">This deployment has no EncryptedERC contracts.</State>;
  const c = chain.data;
  const cmd = 'XORV_NETWORK=fuji XORV_PAY_AS=<YOUR_KEY_NAME> node scripts/private-topup.ts 0.5';
  return (
    <>
      <div className="tiles">
        <Tile label="eERC registration" value={c ? (c.registered ? 'Registered' : 'Not registered') : '…'} note={<a className="link" href={addrUrl(e.registrar)} target="_blank" rel="noreferrer">Registrar ↗</a>} />
        <Tile label="Encrypted balance" value={c?.balance ? 'Ciphertext' : c ? '—' : '…'} note={c?.balance ? `${c.balance.pending} pending amount${c.balance.pending === 1 ? '' : 's'} · ${c.balance.txIndex} changes` : 'register to hold one'} />
        <Tile label="Desk credit" value={credit.data ? money(credit.data.credit) : 'Hidden'} note={credit.data ? `${credit.data.topups.length} top-ups · ${credit.data.jobs.length} private jobs` : 'only you can ask, with a signature'} />
      </div>
      {c?.balance && (
        <section className="sec">
          <div className="sec-h"><div><h2>What the chain shows</h2><p>Your eERC balance on Fuji is an ElGamal ciphertext on BabyJubJub. Anyone can read these numbers; only your key turns them into an amount.</p></div></div>
          <div className="codebox"><div className="codebox-h"><span>EncryptedERC.balanceOf({address.slice(0, 8)}…, {String(c.tokenId)})</span></div>
            <pre>{`c1 = (${String(c.balance.c1[0]).slice(0, 24)}…, ${String(c.balance.c1[1]).slice(0, 24)}…)\nc2 = (${String(c.balance.c2[0]).slice(0, 24)}…, ${String(c.balance.c2[1]).slice(0, 24)}…)`}</pre></div>
        </section>
      )}
      <section className="sec">
        <div className="sec-h"><div><h2>Your credit at the Xorv desk</h2><p>The desk decrypts each top-up it receives and keeps a ledger. It answers only a signed request from your address.</p></div></div>
        <div className="ph-actions"><button className="btn btn-w btn-sm" onClick={() => void show()} disabled={credit.busy}>{credit.busy ? 'Sign in your wallet…' : 'Sign to see my credit'}</button><Link to="/chat" className="btn btn-sm">Chat with private credit</Link></div>
        {credit.error && <p className="note bad-c" style={{ marginTop: 10 }}>{credit.error}</p>}
        {credit.data && credit.data.topups.length > 0 && (
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table className="tbl"><thead><tr><th>Encrypted top-up</th><th className="r">Amount (decrypted by the desk)</th></tr></thead>
              <tbody>{credit.data.topups.map((t) => <tr key={t.tx}><td><a className="link mono-c" href={txUrl(t.tx)} target="_blank" rel="noreferrer">{t.tx.slice(0, 14)}…</a></td><td className="r num">{money(t.amount)}</td></tr>)}</tbody></table>
          </div>
        )}
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2>Top up privately</h2><p>Proofs for eERC transfers are made by the Node client in this repo (snarkjs with Ava Labs' official circuits), not in the browser. It deposits tUSD if needed, then sends the desk an encrypted transfer.</p></div></div>
        <div className="codebox"><div className="codebox-h"><span>terminal</span><CopyButton text={cmd} className="btn btn-sm btn-ghost" /></div><pre>{cmd}</pre></div>
        <p className="note" style={{ marginTop: 8 }}>The deposit amount is public (it is an ERC-20 transfer). The transfer to the desk is not: Snowtrace shows sender and receiver, and the amount only as ciphertext. <Link to="/private" className="link">See every encrypted transfer</Link>.</p>
      </section>
    </>
  );
}

export function Account({ tab }: { tab: Tab }) {
  const wallet = useWallet();
  const tabs: [Tab, string, string][] = [['wallet', '/account', 'Wallet'], ['private', '/account/private', 'Private credit']];
  return (
    <div className="wrap page">
      <PageHead title="Account" art={tab === 'private' ? 'shield' : 'coin'} sub={wallet.address ? <>{QA && wallet.kind === 'qa' ? 'QA signer' : 'Connected'} · <span className="mono-c">{wallet.address}</span></> : 'Your tUSD, your jobs and your private credit on Avalanche Fuji.'}
        actions={wallet.address ? <button className="btn btn-sm" onClick={wallet.disconnect}>Disconnect</button> : undefined} />
      <div className="seg" role="tablist" aria-label="Account" style={{ marginBottom: 20 }}>
        {tabs.map(([k, to, l]) => <Link key={k} to={to} role="tab" aria-selected={tab === k} className={`seg-link ${tab === k ? 'on' : ''}`}>{l}</Link>)}
      </div>
      {!wallet.address ? <Connect /> : tab === 'wallet' ? <WalletTab address={wallet.address} /> : <PrivateTab address={wallet.address} />}
    </div>
  );
}
