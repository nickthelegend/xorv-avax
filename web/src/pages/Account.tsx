import { useEffect, useState } from 'react';
import { acctUrl, ago, chain, modelName, near, paidForWork, READ_ERROR, short, useNow, usePoll } from '../lib/data';
import type { JobSummary } from '@xorv/sdk';
import { deployment } from '../lib/evidence';
import { gateway, useGateway, GATEWAY_START, type Account as Acct, type ApiKey, type GatewayError } from '../lib/gateway';
import { Link } from '../lib/router';
import { Art, CopyButton, Icon, State } from '../components/Ui';
import { PageHead, Tile } from '../components/Shell';
import { StatusTag } from '../components/Market';
import { readAccount, useWallet } from '../lib/wallet';
import { walletError } from '../lib/wallet-errors';
import { PaymentTabs, X402 } from './X402';

type Tab = 'credits' | 'keys' | 'usage' | 'x402';
const TABS: [Tab, string, string, string][] = [['credits', '/account', 'Credits', 'wallet'], ['usage', '/account/usage', 'Usage', 'list'], ['keys', '/keys', 'API keys', 'key']];

function GatewayDown({ err }: { err: GatewayError }) {
  return (
    <State kind="setup" art="rack" title={err.offline ? 'Setup required: start the Xorv gateway' : 'Setup required'}>
      {err.offline ? <>The gateway holds the testnet buyer key that pays for chats and API calls. Start it from the repo: <code>{GATEWAY_START}</code></> : err.message}
    </State>
  );
}

function Credits() {
  const wallet = useWallet();
  const g = useGateway(10000);
  const [a, setA] = useState<Acct | null>(null);
  const [err, setErr] = useState<GatewayError | null>(null);
  useEffect(() => {
    let alive = true;
    setA(null); setErr(null);
    if (!wallet.ready) return () => { alive = false; };
    const tick = () => (wallet.account ? readAccount(wallet.account) : gateway.account()).then((x) => { if (alive) { setA(x); setErr(null); } }).catch((e) => alive && setErr(e));
    tick();
    const t = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [wallet.account, wallet.ready]);
  return (
    <>
      <PageHead title="Credits" art="coin" sub={wallet.account ? `Connected to ${wallet.account}. Your wallet pays for chat escrow on NEAR testnet.` : 'Gateway-paid demo. Choose Account to connect Meteor Wallet and pay for your own chats.'} actions={wallet.account ? <button className="btn btn-sm" onClick={() => void wallet.disconnect()}>Disconnect</button> : undefined} />
      {wallet.error && <State kind="error" title="Meteor Wallet">{wallet.error}</State>}
      {wallet.connecting && <State kind="loading" title="Complete sign-in in Meteor Wallet">Use a NEAR testnet account. Closing the window leaves the gateway-paid demo available.</State>}
      {err && !a && (wallet.account ? <State kind="error" title="Could not read your testnet account">{walletError(err)}</State> : <GatewayDown err={err} />)}
      {!err && !a && <div className="skeleton sk-row" />}
      {a && (
        <>
          <div className="tiles">
            <Tile label="Balance" value={near(a.balance, 4)} unit="NEAR" note="testnet, live" />
            <Tile label="Per message" value="≤ 0.05" unit="NEAR" note="to the provider, plus 0.03 NEAR job storage the contract keeps; check fees refunded if unused" />
            <Tile label="Account" value={short(a.account)} note={<a className="link" href={a.explorer} target="_blank" rel="noreferrer">nearblocks ↗</a>} />
          </div>
          <section className="sec">
            <div className="sec-h"><div><h2>Add credits</h2><p>Send testnet NEAR to this account.</p></div></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
              <div className="copyline"><span>{a.account}</span><CopyButton text={a.account} className="btn btn-sm" /></div>
              <div className="ph-actions"><a className="btn btn-w btn-sm" href="https://near-faucet.io/" target="_blank" rel="noreferrer">Open the testnet faucet <Icon name="external" size={13} /></a><a className="btn btn-sm" href={a.explorer} target="_blank" rel="noreferrer">See transactions</a></div>
            </div>
          </section>
        </>
      )}
      {g.data && (wallet.account ? g.data.provider_setup_required : g.data.setup_required).length > 0 && <div style={{ marginTop: 16 }}><State kind="setup" title="Chat is read-only until setup is done">{(wallet.account ? g.data.provider_setup_required : g.data.setup_required).join('; ')}. Start providers: <code>{GATEWAY_START}</code>.</State></div>}
    </>
  );
}

function Usage() {
  const wallet = useWallet();
  const g = useGateway(15000);
  const now = useNow(5000);
  const buyer = wallet.ready ? wallet.account || g.data?.buyer || (deployment?.accounts?.buyer as string | undefined) || null : null;
  const owned = usePoll(async () => {
    if (!buyer) return { account: buyer, jobs: [] as JobSummary[], full: new Map() };
    const jobs: JobSummary[] = [];
    for (let from = 0; ; from += 100) {
      const page = await chain.jobs(from, 100);
      jobs.push(...page.filter((j) => j.buyer === buyer));
      if (page.length < 100) break;
    }
    const full = await Promise.all(jobs.map((j) => chain.job(j.id)));
    return { account: buyer, jobs, full: new Map(full.filter(Boolean).map((j) => [j!.id, j!])) };
  }, 10000, [buyer]);
  // Never paint the previous account's cached data while a wallet switch is loading.
  const d = owned.data?.account === buyer ? owned.data : null;
  const mine = d?.jobs ?? [];
  // Work payments exclude refunds and provider stake redistributed after a slash.
  const spent = (id: number) => {
    const f = d?.full.get(id);
    if (!f || !['done', 'paid', 'faulted', 'expired', 'refunded'].includes(f.status)) return null;
    return paidForWork(f);
  };
  const cfg = usePoll(() => chain.config(), 0);
  const total = mine.reduce((s, j) => s + (spent(j.id) ?? 0), 0);
  const chainNow = now;
  return (
    <>
      <PageHead title="Usage" sub={buyer ? <>Every job the buyer account <a className="link mono-c" href={acctUrl(buyer)} target="_blank" rel="noreferrer">{buyer}</a> posted, read from the contract.</> : 'Jobs posted by the gateway account.'} />
      {!buyer && g.error && <GatewayDown err={g.error} />}
      {owned.error && !d && <State kind="error" art="warning" title="Could not read the contract">{READ_ERROR}</State>}
      {buyer && !d && !owned.error && <div className="skeleton sk-row" />}
      {d && buyer && (
        <>
          <div className="tiles" style={{ marginBottom: 16 }}>
            <Tile label="Jobs posted" value={mine.length} />
            <Tile label="Paid to providers" value={total.toFixed(4)} unit="NEAR" note={cfg.data ? `plus a ${near(cfg.data.storage_compute, 3)} NEAR storage reserve per job` : 'settled jobs in the latest read'} />
            <Tile label="Answers delivered" value={mine.filter((j) => ['done', 'paid'].includes(j.status)).length} />
          </div>
          {!mine.length ? <State kind="empty" art="empty" title="No usage yet" action={<Link to="/chat" className="btn btn-w btn-sm">Start a chat</Link>}>Send a chat message or an API call and it shows up here as a job.</State> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Job</th><th>Model</th><th>Provider</th><th className="r">Paid to providers</th><th>Status</th><th className="r">When</th></tr></thead>
                <tbody>
                  {mine.map((j) => {
                    const s = spent(j.id);
                    return (
                      <tr key={j.id}>
                        <td className="wrap-c"><Link to={`/jobs/${j.id}`} className="row-link"><span className="faint mono-c">#{j.id}</span> {j.title}</Link></td>
                        <td>{j.kind === 'bounty' ? <span className="faint">bug bounty</span> : modelName(j.model)}</td>
                        <td>{j.winner ? short(j.winner) : <span className="faint">—</span>}</td>
                        <td className="r num">{s == null ? <span className="faint">in escrow</span> : `${s.toFixed(4)} NEAR`}</td>
                        <td><StatusTag j={j} m={d} /></td>
                        <td className="r faint">{ago(j.created_ms, chainNow)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Keys() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [err, setErr] = useState<GatewayError | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => gateway.keys().then((k) => { setKeys(k); setErr(null); }).catch(setErr);
  useEffect(() => { load(); }, []);
  const origin = typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:5200';
  const curl = `curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer ${fresh ?? '$XORV_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "groq:openai/gpt-oss-20b",
       "messages": [{"role": "user", "content": "What is NEAR?"}]}'`;
  return (
    <>
      <PageHead title="API keys" art="key" sub="OpenAI-compatible gateway-paid demo. API calls use the gateway buyer; wallet-paid chats are signed in the browser. Each response carries its job, provider, price and tx hashes." />
      <PaymentTabs />
      {err && !keys && <GatewayDown err={err} />}
      {keys && (
        <>
          <form className="row-form" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; setBusy(true); try { const r = await gateway.createKey(name); setFresh(r.key); setName(''); load(); } catch (x) { setErr(x as GatewayError); } finally { setBusy(false); } }}>
            <label className="sr" htmlFor="kname">Key name</label>
            <input id="kname" className="input" placeholder="Name this key, e.g. laptop" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-w" disabled={busy || !name.trim()}><Icon name="plus" size={15} />Create key</button>
          </form>
          {err && <p className="note bad-c" role="alert" style={{ marginTop: 8 }}>{err.message}</p>}
          {fresh && (
            <div className="newkey newkey-row" style={{ marginTop: 14 }} role="status">
              <Art name="success" size={64} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p><b style={{ color: 'var(--ink)' }}>Copy your key now.</b> Only its hash is stored, so it won't be shown again.</p>
                <div className="copyline"><span>{fresh}</span><CopyButton text={fresh} className="btn btn-sm btn-w" /></div>
              </div>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            {!keys.length ? <State kind="empty" art="key" title="No keys yet">Create one to call Xorv from code.</State> : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Name</th><th>Key</th><th className="r">Requests</th><th>Last used</th><th>Created</th><th className="r" /></tr></thead>
                  <tbody>
                    {[...keys].reverse().map((k) => (
                      <tr key={k.id} style={k.revoked ? { opacity: 0.5 } : undefined}>
                        <td>{k.name}</td>
                        <td className="mono-c">{k.prefix}…</td>
                        <td className="r num">{k.requests}{k.jobs.length > 0 && <> · <Link className="link" to={`/jobs/${k.jobs[k.jobs.length - 1]}`}>last job #{k.jobs[k.jobs.length - 1]}</Link></>}</td>
                        <td className="faint">{k.last_used_ms ? ago(k.last_used_ms) : 'never'}</td>
                        <td className="faint">{ago(k.created_ms)}</td>
                        <td className="r">{k.revoked ? <span className="faint">revoked</span> : <button className="btn btn-sm btn-ghost" onClick={() => gateway.revokeKey(k.id).then(load).catch(setErr)}>Revoke</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      <section className="sec" id="quickstart">
        <div className="sec-h"><div><h2>Quickstart</h2><p>Any OpenAI client works: point its base URL at <code>{origin}/v1</code>. The call waits for the on-chain delivery (about 40 seconds: 15 s of sealed bids, 15 s of reveals, then the run).</p></div></div>
        <div className="codebox">
          <div className="codebox-h"><span>curl</span><CopyButton text={curl.replace(/\\\n\s+/g, ' ')} className="btn btn-sm btn-ghost" /></div>
          <pre>{curl}</pre>
        </div>
        <div className="codebox" style={{ marginTop: 10 }}>
          <div className="codebox-h"><span>response (trimmed)</span></div>
          <pre>{`{ "id": "xorv-job-4",
  "choices": [{ "message": { "role": "assistant", "content": "…" } }],
  "xorv": { "job": 4, "status": "done", "provider": "birch.xorv-ikic2.testnet",
            "price_near": "0.016", "bids": 3, "post_tx": "F6W6vHoi…",
            "receipts": [{ "node": "birch", "event": "deliver", "tx": "…" }] } }`}</pre>
        </div>
        <p className="note" style={{ marginTop: 8 }}><code>GET /v1/models</code> lists the models staked providers serve. Agents can use the MCP server in <code>packages/mcp</code> instead.</p>
      </section>
    </>
  );
}

export function Account({ tab }: { tab: Tab }) {
  return (
    <div className="wrap page">
      <div className="with-side">
        <nav className="side" aria-label="Account">
          {TABS.map(([k, to, l, ic]) => <Link key={k} to={to} aria-current={(tab === k || tab === 'x402' && k === 'keys') ? 'true' : undefined}><Icon name={ic} size={15} />{l}</Link>)}
        </nav>
        <div style={{ minWidth: 0 }}>{tab === 'credits' ? <Credits /> : tab === 'usage' ? <Usage /> : tab === 'x402' ? <X402 /> : <Keys />}</div>
      </div>
    </div>
  );
}
