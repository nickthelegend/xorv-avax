import { useEffect, useState } from 'react';
import { formatEther, type Hex } from 'viem';
import { creditMessage, encryptedErcAbi, registrarAbi, testDollarAbi } from '@xorv/sdk';
import { C, D, addrUrl, jobTitle, jobsOf, modelName, money, rate1m, reader, txUrl, useMarket, useNow, usePoll, utc } from '../lib/data';
import { gateway, type Credit, GatewayError, GATEWAY_START } from '../lib/gateway';
import { Link } from '../lib/router';
import { CopyButton, Icon, State } from '../components/Ui';
import { PageHead, Tile } from '../components/Shell';
import { StatusTag } from '../components/Market';
import { QA, useWallet, walletMessage } from '../lib/wallet';
import { STATION, useDripped, useFunds, useStartFresh } from '../lib/funds';
import { keyOpen, loadPrivate, onKeys } from '../lib/eerc-keys';
import { verifyReceipt, type DeskReceipt, type ReceiptCheck } from '@xorv/sdk';

type Tab = 'wallet' | 'private';

function Connect() {
  const wallet = useWallet();
  const fresh = useStartFresh();
  const busy = wallet.connecting || fresh.busy;
  return (
    <State kind="setup" art="key" title="Start paying per message"
      action={<div className="ph-actions" style={{ justifyContent: 'center' }}>
        <button className="btn btn-w btn-sm" onClick={() => void (wallet.hasLocal ? wallet.connect('local') : fresh.start())} disabled={busy}>{fresh.busy ? 'Getting test funds…' : wallet.hasLocal ? 'Use my test wallet' : 'Start with a test wallet'}</button>
        {wallet.hasInjected || wallet.qaAvailable
          ? <button className="btn btn-sm" onClick={() => void wallet.connect()} disabled={busy}>{wallet.connecting ? 'Connecting…' : 'Connect Core or MetaMask'}</button>
          : <a className="btn btn-sm" href="https://core.app/" target="_blank" rel="noreferrer">Get Core wallet <Icon name="external" size={13} /></a>}
      </div>}>
      A test wallet lives in this browser and gets free tUSD in one tap. {(wallet.error || fresh.error) && <span className="bad-c"> {wallet.error ?? fresh.error}</span>}
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
  const dripped = useDripped(address);
  const funds = useFunds(() => { bal.reload(); dripped.reload(); });
  const canDrip = !!STATION && dripped.data === false;
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
      {canDrip && (
        <section className="sec">
          <div className="sec-h"><div><h2>Test funds</h2><p>One tap, no gas: 2 tUSD, plus a little AVAX if this wallet has none.</p></div><a href={addrUrl(STATION!)} target="_blank" rel="noreferrer">Gas station <Icon name="external" size={13} /></a></div>
          <div className="ph-actions">
            <button className="btn btn-w btn-sm" onClick={() => void funds.get()} disabled={funds.busy}>{funds.busy ? 'Sending…' : 'Get test funds'}</button>
          </div>
          {funds.error && <p className="note bad-c" style={{ marginTop: 10 }}>{funds.error}</p>}
        </section>
      )}
      {funds.tx && <p className="note" style={{ marginTop: 12 }}>Funded: {money(funds.tusd ?? '0', 2)} tUSD{funds.avax && funds.avax !== '0' ? ` and ${funds.avax} AVAX` : ''} · <a className="link" href={txUrl(funds.tx)} target="_blank" rel="noreferrer">{funds.tx.slice(0, 12)}…</a></p>}
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

type Flow = { busy: boolean; steps: { label: string; tx?: string }[]; error?: string; done?: string };

function PrivateTab({ address }: { address: Hex }) {
  const wallet = useWallet();
  const e = D.eerc;
  const [, bump] = useState(0);
  useEffect(() => onKeys(() => bump((n) => n + 1)), []);
  const open = keyOpen(address);
  const chain = usePoll(async () => {
    if (!e) return null;
    const [registered, tokenId, tusd] = await Promise.all([
      reader.client.readContract({ address: e.registrar, abi: registrarAbi, functionName: 'isUserRegistered', args: [address] }) as Promise<boolean>,
      reader.client.readContract({ address: e.encryptedERC, abi: encryptedErcAbi, functionName: 'tokenIds', args: [C.testDollar] }) as Promise<bigint>,
      reader.tokenBalance(address),
    ]);
    const b = registered && tokenId ? ((await reader.client.readContract({ address: e.encryptedERC, abi: encryptedErcAbi, functionName: 'balanceOf', args: [address, tokenId] })) as any) : null;
    const mine = open ? await (await loadPrivate()).privateBalance(address).catch(() => null) : null;
    return { registered, tokenId, tusd, mine, balance: b ? { c1: [b[0].c1.x, b[0].c1.y], c2: [b[0].c2.x, b[0].c2.y], pending: b[2].length as number, txIndex: Number(b[4]) } : null };
  }, 20_000, [address, open]);
  const [credit, setCredit] = useState<{ busy: boolean; data?: Credit; error?: string; checks?: ReceiptCheck[]; ok?: boolean }>({ busy: false });
  const [amount, setAmount] = useState('0.5');
  const [flow, setFlow] = useState<Flow>({ busy: false, steps: [] });
  const micro = /^\d{0,6}(\.\d{0,6})?$/.test(amount.trim()) && Number(amount) > 0 ? BigInt(Math.round(Number(amount) * 1e6)) : 0n;

  async function show() {
    setCredit({ busy: true });
    try {
      const ts = Math.floor(Date.now() / 1000);
      const signature = await wallet.signMessage(creditMessage(address, ts));
      const data = await gateway.credit({ address, ts, signature });
      setCredit({ busy: false, data });
      if (data.receipt && data.signature) {
        const v = await verifyReceipt(D, reader, data.receipt as DeskReceipt, data.signature as Hex, address, async (tx, claimed) => (await loadPrivate()).proofMoved(address, tx, claimed));
        setCredit({ busy: false, data, checks: v.checks, ok: v.ok });
      }
    } catch (err) {
      setCredit({ busy: false, error: err instanceof GatewayError ? (err.offline ? `The gateway is not running. Start it with ${GATEWAY_START}` : err.message) : walletMessage(err) });
    }
  }
  async function unlock() {
    if (!wallet.client) return;
    try { await (await loadPrivate()).openKey(address, wallet.client); chain.reload(); } catch (err) { setFlow({ busy: false, steps: [], error: walletMessage(err) }); }
  }
  async function topUp() {
    if (!wallet.client || !micro) return;
    setFlow({ busy: true, steps: [] });
    const step = (label: string, tx?: string) => setFlow((f) => ({ ...f, steps: [...f.steps, { label, tx }] }));
    try {
      const tx = await (await loadPrivate()).topUpDesk(address, wallet.client, wallet.write, micro, step);
      setFlow((f) => ({ ...f, busy: false, done: tx }));
      chain.reload();
    } catch (err) {
      setFlow((f) => ({ ...f, busy: false, error: walletMessage(err) }));
    }
  }
  if (!e) return <State kind="setup" art="shield" title="eERC is not deployed here">This deployment has no EncryptedERC contracts.</State>;
  const c = chain.data;
  const lowTusd = !!c && c.tusd < micro && (c.mine ?? 0n) < micro;
  return (
    <>
      <div className="tiles">
        <Tile label="eERC registration" value={c ? (c.registered ? 'Registered' : 'Not registered') : '…'} note={<a className="link" href={addrUrl(e.registrar)} target="_blank" rel="noreferrer">Registrar ↗</a>} />
        <Tile label="Encrypted balance" value={c?.mine != null ? money(c.mine, 2) : c?.balance ? 'Ciphertext' : c ? '—' : '…'} note={c?.mine != null ? 'decrypted in this tab' : c?.balance ? `${c.balance.pending} pending amount${c.balance.pending === 1 ? '' : 's'} · ${c.balance.txIndex} changes` : 'register to hold one'} />
        <Tile label="Desk credit" value={credit.data ? money(credit.data.credit) : 'Hidden'} note={credit.data ? `${credit.data.topups.length} top-ups · ${credit.data.jobs.length} private jobs` : 'only you can ask, with a signature'} />
      </div>
      <section className="sec">
        <div className="sec-h"><div><h2>Top up privately</h2><p>Proofs are made in this browser with Ava Labs' eERC SDK. The deposit amount is public; the transfer to the desk is not.</p></div>{!open && <button className="btn btn-sm" onClick={() => void unlock()} disabled={!wallet.client}>Open my eERC key</button>}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
          <div className="ph-actions" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="topup">Amount (tUSD)</label>
              <input id="topup" className="input" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} disabled={flow.busy} />
            </div>
            <button className="btn btn-w btn-sm" style={{ height: 44 }} onClick={() => void topUp()} disabled={flow.busy || !micro || lowTusd || !wallet.client}>{flow.busy ? 'Working…' : 'Top up privately'}</button>
          </div>
          {lowTusd && <p className="note">Not enough tUSD for this top-up. <Link to="/account" className="link">Get test funds</Link>.</p>}
          {flow.steps.length > 0 && <ol className="steps">{flow.steps.map((s, i) => <li key={i} className={`step ${i === flow.steps.length - 1 && flow.busy ? 'now' : 'done'}`}><i /><span>{s.label}{s.tx && <a href={txUrl(s.tx)} target="_blank" rel="noreferrer">{s.tx.slice(0, 10)}… ↗</a>}</span></li>)}</ol>}
          {flow.error && <p className="note bad-c">{flow.error}</p>}
          {flow.done && <p className="note">Done. The desk credits it within 30 seconds. <Link to="/chat" className="link">Chat with private credit</Link>.</p>}
        </div>
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2>Your credit at the Xorv desk</h2><p>The desk signs a receipt of every line it holds for you. This tab checks each line against Fuji.</p></div></div>
        <div className="ph-actions"><button className="btn btn-w btn-sm" onClick={() => void show()} disabled={credit.busy}>{credit.busy ? 'Checking…' : 'Sign to see and check my credit'}</button><Link to="/chat" className="btn btn-sm">Chat with private credit</Link></div>
        {credit.error && <p className="note bad-c" style={{ marginTop: 10 }}>{credit.error}</p>}
        {credit.checks && (
          <>
            <ol className="steps" style={{ marginTop: 14 }}>
              {credit.checks.map((k, i) => <li key={i} className={`step ${k.ok === false ? 'bad' : k.ok ? 'good' : ''}`}><i /><span><b>{k.label}</b>{k.detail && <span className="faint"> · {k.detail}</span>}{k.tx && <a href={txUrl(k.tx)} target="_blank" rel="noreferrer">{k.tx.slice(0, 10)}… ↗</a>}</span></li>)}
            </ol>
            <p className="note">{credit.ok ? 'Every line checks out on Fuji.' : 'Some lines do not check out. The signed receipt is your evidence.'}{!open && ' Open your eERC key to check the amounts too.'}</p>
          </>
        )}
      </section>
      {c?.balance && (
        <section className="sec">
          <div className="sec-h"><div><h2>What the chain shows</h2><p>Your eERC balance on Fuji is an ElGamal ciphertext on BabyJubJub. Only your key turns it into an amount.</p></div></div>
          <div className="codebox"><div className="codebox-h"><span>EncryptedERC.balanceOf({address.slice(0, 8)}…, {String(c.tokenId)})</span></div>
            <pre>{`c1 = (${String(c.balance.c1[0]).slice(0, 24)}…, ${String(c.balance.c1[1]).slice(0, 24)}…)\nc2 = (${String(c.balance.c2[0]).slice(0, 24)}…, ${String(c.balance.c2[1]).slice(0, 24)}…)`}</pre></div>
        </section>
      )}
    </>
  );
}

export function Account({ tab }: { tab: Tab }) {
  const wallet = useWallet();
  const tabs: [Tab, string, string][] = [['wallet', '/account', 'Wallet'], ['private', '/account/private', 'Private credit']];
  return (
    <div className="wrap page">
      <PageHead title="Account" art={tab === 'private' ? 'shield' : 'coin'} sub={wallet.address ? <>{QA && wallet.kind === 'qa' ? 'QA signer' : wallet.kind === 'local' ? 'Test wallet in this browser' : 'Connected'} · <span className="mono-c">{wallet.address}</span></> : 'Your tUSD, your jobs and your private credit on Avalanche Fuji.'}
        actions={wallet.address ? <button className="btn btn-sm" onClick={wallet.disconnect}>Disconnect</button> : undefined} />
      <div className="seg" role="tablist" aria-label="Account" style={{ marginBottom: 20 }}>
        {tabs.map(([k, to, l]) => <Link key={k} to={to} role="tab" aria-selected={tab === k} className={`seg-link ${tab === k ? 'on' : ''}`}>{l}</Link>)}
      </div>
      {!wallet.address ? <Connect /> : tab === 'wallet' ? <WalletTab address={wallet.address} /> : <PrivateTab address={wallet.address} />}
    </div>
  );
}
