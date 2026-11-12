import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MAX_RATE, DEFAULT_MAX_TOKENS, chatMessage, encodePayment, requestHash, xorvMarketAbi } from '@xorv/sdk';
import { C, CLOSED, ev, ev1, hostName, modelName, money, nameOf, queryParam, rate1m, readJobDetail, reader, servedModels, txUrl, useMarket, usePoll, type JobDetail } from '../lib/data';
import { gateway, useGateway, GATEWAY_START, GatewayError } from '../lib/gateway';
import { Link } from '../lib/router';
import { Art, Icon } from '../components/Ui';
import { Md } from '../components/MdLazy';
import { QA, useWallet, walletMessage } from '../lib/wallet';
import { STATION, useDripped, useFunds, useStartFresh } from '../lib/funds';

type Pay = 'x402' | 'private';
type UserMsg = { role: 'user'; content: string };
type BotMsg = { role: 'assistant'; model: string; pay: Pay; verify: boolean; job?: number; tx?: string; value?: string; content?: string; error?: string; stage?: string };
type Msg = UserMsg | BotMsg;
interface Room { id: string; title: string; model: string; messages: Msg[]; updated: number; payer: string }

const STORE = 'xorv.fuji.chats.v1';
const load = (): Room[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(v) ? (v as Room[]).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.messages) && typeof r.payer === 'string').slice(0, 40) : [];
  } catch {
    return [];
  }
};
const save = (rooms: Room[]) => { try { localStorage.setItem(STORE, JSON.stringify(rooms.slice(0, 40))); } catch { /* private mode */ } };
const newId = () => Math.random().toString(36).slice(2, 10);

const SUGGESTIONS = [
  ['Explain it simply', 'What is a sealed-bid auction, in two sentences?'],
  ['Write code', 'Write a JavaScript function that slugifies a title.'],
  ['Price check', 'In one paragraph, what drives the cost of running an LLM?'],
  ['Summarise', 'Give me three tips for writing a clear bug report.'],
];

/** One assistant turn: follows its job on Fuji (bids, reveals, run, spot check, settlement) and shows the delivered answer. */
function Turn({ msg, onDelivered }: { msg: BotMsg; onDelivered: (content: string) => void }) {
  const m = useMarket();
  const det = usePoll(() => (msg.job == null ? Promise.resolve(null) : readJobDetail(msg.job)), 5000, [msg.job]);
  const d = det.data as JobDetail | null;
  const j = d?.job;
  const [fallback, setFallback] = useState<{ output: string; tx: string } | null>(null);
  const delivered = ev1(d, 'Delivered');
  const output = delivered?.args.output ?? fallback?.output ?? msg.content;
  // The explorer indexer can trail the chain by a few seconds; read the Delivered log from the RPC meanwhile.
  useEffect(() => {
    if (!j || delivered || fallback || /^0x0+$/.test(j.resultHash)) return;
    reader.recentLogs({ address: C.market, abi: xorvMarketAbi, eventName: 'Delivered', args: { id: BigInt(j.id) } }, 300n)
      .then((l) => l[0] && setFallback({ output: l[0].args.output, tx: l[0].transactionHash }))
      .catch(() => {});
  }, [j?.resultHash, !!delivered]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (output && output !== msg.content) onDelivered(output); }, [output]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = Date.now() / 1000;
  const left = (t: number) => Math.max(0, Math.ceil(t - now));
  const T = ({ h }: { h?: string }) => (h ? <a href={txUrl(h)} target="_blank" rel="noreferrer" title={h}>{h.slice(0, 6)}… ↗</a> : null);

  const steps: { k: string; state: 'done' | 'now' | 'bad' | 'good' | ''; body: React.ReactNode }[] = [];
  if (msg.job != null) {
    steps.push({ k: 'pay', state: 'done', body: msg.pay === 'x402'
      ? <>Paid <b>{money(msg.value ?? '0')}</b> with x402. One EIP-3009 signature funded job #{msg.job}'s escrow <T h={msg.tx} /></>
      : <>Posted by the <b>Xorv desk</b> from your private credit, not by your address <T h={msg.tx} /></> });
    if (j && d) {
      const committing = j.status === 'Bidding' && now < j.commitEnd;
      steps.push({ k: 'bids', state: committing ? 'now' : 'done', body: committing ? <>Waiting for sealed bids · <b>{j.bidCount}</b> in · closes in {left(j.commitEnd)} s</> : <><b>{j.bidCount}</b> sealed bid{j.bidCount === 1 ? '' : 's'} from staked nodes</> });
      if (!committing && j.bidCount) {
        const rev = d.bids.filter((b) => b.revealed);
        steps.push({ k: 'reveal', state: j.status === 'Bidding' ? 'now' : 'done', body: rev.length ? <>Revealed: {rev.map((b, i) => <span key={b.node}>{i ? ' · ' : ''}{nameOf(m.data, b.owner)} {rate1m(b.rate)}</span>)} <span className="faint">per 1M tokens</span></> : <>Revealing rates · {left(j.revealEnd)} s</> });
      }
      if (j.winner && !/^0x0+$/.test(j.winner)) {
        steps.push({ k: 'win', state: 'done', body: <><b>{nameOf(m.data, j.winner)}</b> won at <b>{rate1m(j.clearedRate)}</b> / 1M and is running {modelName(j.model)} <T h={ev1(d, 'AuctionCleared')?.transactionHash} /></> });
        if (output) steps.push({ k: 'deliv', state: 'done', body: <>Answer delivered on-chain{j.tokens ? <> · {j.tokens} tokens</> : null} <T h={delivered?.transactionHash ?? fallback?.tx} /></> });
        else if (j.status === 'Running') steps.push({ k: 'run', state: 'now', body: <>Running · due in {left(j.deliverEnd)} s</> });
      }
      const spot = ev(d, 'DrawResolved').find((e) => Number(e.args.purpose) === 0);
      if (j.status === 'Delivered') steps.push({ k: 'draw', state: 'now', body: <>Drawing the spot check from the delivery block hash…</> });
      if (spot) {
        if (!spot.args.selected) steps.push({ k: 'spot', state: 'done', body: <>Not sampled for a spot check this time (roll {String(spot.args.rollBps)} ≥ {String(spot.args.thresholdBps)}) <T h={spot.transactionHash} /></> });
        else d.checks.forEach((c, i) => steps.push({ k: `chk${i}`, state: !c.delivered ? 'now' : c.similarityBps >= (m.data?.config.toleranceBps ?? 5000) ? 'good' : 'bad', body: !c.delivered ? <>{i ? 'Tiebreaker' : 'Spot check'}: <b>{nameOf(m.data, c.owner)}</b> is re-running the prompt</> : <>{i ? 'Tiebreaker' : 'Spot check'} by <b>{nameOf(m.data, c.owner)}</b>: {c.similarityBps % 100 === 0 ? c.similarityBps / 100 : (c.similarityBps / 100).toFixed(2)}% match, computed on-chain <T h={ev(d, 'CheckDelivered').find((e) => Number(e.args.round) === i)?.transactionHash} /></> }));
      }
      if (CLOSED.has(j.status)) {
        const closed = ev1(d, 'JobClosed');
        const bad = j.status === 'Faulted';
        steps.push({ k: 'end', state: bad ? 'bad' : j.status === 'Expired' ? '' : 'good', body: bad ? <><b>Slashed.</b> The tiebreaker sided against the provider; your escrow came back plus its slashed stake <T h={closed?.transactionHash} /></> : j.status === 'Expired' ? <><b>No delivery.</b> Nobody revealed a bid; the escrow went back in full <T h={closed?.transactionHash} /></> : <><b>Settled.</b> Charged {money(j.charge)} for {j.tokens} tokens; the rest of the escrow went back <T h={closed?.transactionHash} /></> });
      }
    }
  }
  const done = j ? CLOSED.has(j.status) : false;
  return (
    <div className="msg-a">
      <span className="mark-av" aria-hidden="true"><img src="/brand/xorv-mark-white.png" alt="" /></span>
      <div style={{ minWidth: 0 }}>
        <div className="msg-meta"><b>{modelName(msg.model)}</b><span>via {hostName(msg.model)}</span>{j?.winner && !/^0x0+$/.test(j.winner) && <span>· served by <Link to={`/providers/${nameOf(m.data, j.winner)}`} className="link">{nameOf(m.data, j.winner)}</Link></span>}{msg.verify && <span>· verified</span>}</div>
        {msg.error && <div className="err-box" role="alert"><b>{msg.job != null ? 'Job update' : 'Not sent'}.</b> {msg.error}</div>}
        {msg.job == null && !msg.error && <ol className="steps"><li className="step now"><i /><span>{msg.stage ?? 'Preparing the payment…'}</span></li></ol>}
        {steps.length > 0 && !(done && output) && <ol className="steps" aria-live="polite">{steps.map((s) => <li key={s.k} className={`step ${s.state}`}><i /><span>{s.body}</span></li>)}</ol>}
        {output && <div className="answer"><Md text={output} /></div>}
        {done && output && <details className="prompt"><summary>How this answer was bought ({steps.length} steps on Avalanche)</summary><ol className="steps">{steps.map((s) => <li key={s.k} className={`step ${s.state}`}><i /><span>{s.body}</span></li>)}</ol></details>}
        {det.error && !d && <p className="note">Could not read job #{msg.job}: {det.error}</p>}
        {msg.job != null && (output || done) && (
          <div className="receipt-bar">
            {j && j.charge > 0n && <span className="money">{money(j.charge)}</span>}
            {msg.tx && <a href={txUrl(msg.tx)} target="_blank" rel="noreferrer">{msg.pay === 'x402' ? 'x402 settlement' : 'Desk post'} <Icon name="external" size={11} /></a>}
            {delivered && <a href={txUrl(delivered.transactionHash)} target="_blank" rel="noreferrer">Delivery tx <Icon name="external" size={11} /></a>}
            <Link to={`/jobs/${msg.job}`}>Job #{msg.job} record <Icon name="arrow" size={12} /></Link>
          </div>
        )}
      </div>
    </div>
  );
}

export function Chat() {
  const wallet = useWallet();
  const m = useMarket();
  const g = useGateway(15_000);
  const gm = usePoll(() => gateway.models().catch(() => null), 30_000);
  const bal = usePoll(() => (wallet.address ? reader.tokenBalance(wallet.address) : Promise.resolve(null)), 15_000, [wallet.address]);
  const dripped = useDripped(wallet.address);
  const fresh = useStartFresh(() => { bal.reload(); dripped.reload(); });
  const funds = useFunds(() => { bal.reload(); dripped.reload(); });
  const [rooms, setRooms] = useState<Room[]>(load);
  const [cur, setCur] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [side, setSide] = useState(false);
  const [pay, setPay] = useState<Pay>('x402');
  const [verify, setVerify] = useState(false);
  const served = m.data ? servedModels(m.data) : new Map();
  const models = [...served.keys()];
  const [model, setModel] = useState<string>(queryParam('model') ?? '');
  const payer = wallet.address ?? '';
  const visible = rooms.filter((r) => r.payer === payer);
  const room = visible.find((r) => r.id === cur) ?? null;
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!model && models.length) setModel(models[0]); }, [models.join(), model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { save(rooms); }, [rooms]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [room?.messages.length, cur]);
  useEffect(() => { if (room) setModel(room.model); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  const health = g.data?.ok ? g.data.health : null;
  const offline = g.data && !g.data.ok && g.data.error.offline;
  const needs = health?.setup_required ?? [];
  const escrow = (DEFAULT_MAX_RATE * BigInt(DEFAULT_MAX_TOKENS)) / 1000n + 2n * (m.data?.config.checkFee ?? 200n);
  const lowFunds = pay === 'x402' && bal.data != null && bal.data < escrow;
  // x402 needs a known tUSD balance: right after a test wallet is made, its funds are still on the way.
  const ready = !!health && needs.length === 0 && models.includes(model) && !!wallet.address && !lowFunds && (pay !== 'x402' || bal.data != null) && !fresh.busy && !funds.busy;
  const pending = room?.messages.some((x) => x.role === 'assistant' && !x.content && !x.error) ?? false;
  const update = (id: string, f: (r: Room) => Room) => setRooms((rs) => rs.map((r) => (r.id === id ? f(r) : r)).sort((a, b) => b.updated - a.updated));

  async function send(content: string) {
    const c = content.trim();
    if (!c || busy || pending || !ready || !wallet.address) return;
    setBusy(true);
    let id = cur;
    if (!id || !room) {
      id = newId();
      setRooms((rs) => [{ id: id!, title: c.slice(0, 60), model, messages: [], updated: Date.now(), payer }, ...rs]);
      setCur(id);
    }
    const history = (room && room.id === id ? room.messages : []).flatMap((x) => (x.role === 'user' ? [{ role: 'user', content: x.content }] : x.content ? [{ role: 'assistant', content: x.content }] : []));
    const bot: BotMsg = { role: 'assistant', model, pay, verify, stage: pay === 'x402' ? 'Reading the payment requirements (HTTP 402)…' : 'Sign the request with your wallet (no gas)…' };
    const patch = (p: Partial<BotMsg>) => update(id!, (r) => ({ ...r, messages: r.messages.map((x) => (x.role === 'assistant' && (x as BotMsg & { _k?: string })._k === k ? { ...x, ...p } : x)) }));
    const k = newId();
    update(id, (r) => ({ ...r, model, updated: Date.now(), messages: [...r.messages, { role: 'user', content: c }, { ...bot, _k: k } as BotMsg] }));
    setText('');
    const body = { model, messages: [...history, { role: 'user', content: c }], max_tokens: DEFAULT_MAX_TOKENS, xorv: { verify } };
    try {
      if (pay === 'x402') {
        const req = await gateway.requirements(body);
        patch({ stage: `Sign ${money(req.maxAmountRequired)} in tUSD (EIP-3009, no gas)…` });
        const payload = await wallet.signPayment(req);
        patch({ stage: 'Settling the payment on Fuji and opening the auction…' });
        const p = await gateway.chat(body, encodePayment(payload));
        patch({ job: p.job, tx: p.receipt?.transaction ?? p.tx, value: p.value, stage: undefined });
      } else {
        const ts = Math.floor(Date.now() / 1000);
        const signature = await wallet.signMessage(chatMessage(wallet.address, ts, requestHash(body)));
        patch({ stage: 'The desk is posting your job…' });
        const p = await gateway.privateChat({ address: wallet.address, ts, signature, request: body });
        patch({ job: p.job, tx: p.tx, stage: undefined });
      }
      setTimeout(() => m.reload(), 4000);
    } catch (e) {
      const err = e as GatewayError;
      patch({ error: err instanceof GatewayError ? (err.offline ? `The Xorv gateway is not running. Start it with ${GATEWAY_START}` : err.message) : walletMessage(e), stage: undefined });
    } finally {
      setBusy(false);
      ta.current?.focus();
    }
  }

  const setContent = (id: string, i: number, content: string) => update(id, (r) => ({ ...r, messages: r.messages.map((x, k) => (k === i && x.role === 'assistant' ? { ...x, content } : x)) }));
  const label = useMemo(() => (offline ? 'Gateway offline' : !g.data ? 'Checking…' : health ? `${health.nodes.filter((n) => n.ready).length} provider nodes online` : 'Gateway error'), [offline, g.data, health]);

  return (
    <div className="chat">
      <aside className={`chat-side ${side ? 'open' : ''}`} aria-label="Chats">
        <div className="chat-side-h">
          <button className="btn btn-sm" onClick={() => { setCur(null); setSide(false); setTimeout(() => ta.current?.focus(), 0); }}><Icon name="plus" size={15} />New chat</button>
        </div>
        <div className="rooms">
          <div className="rooms-h"><span>{visible.length} chat{visible.length === 1 ? '' : 's'}</span><span>this browser</span></div>
          {!visible.length && <p className="rooms-empty">No chats yet.</p>}
          {visible.map((r) => (
            <div key={r.id} className={`room ${r.id === cur ? 'on' : ''}`}>
              <button onClick={() => { setCur(r.id); setSide(false); }} aria-current={r.id === cur}>{r.title}</button>
              <button className="del" aria-label={`Delete chat ${r.title}`} onClick={() => { setRooms((rs) => rs.filter((x) => x.id !== r.id)); if (cur === r.id) setCur(null); }}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
        <div className="chat-side-f">
          <span><i className={`live-dot ${health && !needs.length ? '' : 'off'}`} style={{ display: 'inline-block', marginRight: 6 }} />{label}</span>
          <span>{wallet.address ? <>{QA && wallet.kind === 'qa' ? 'QA signer' : wallet.kind === 'local' ? 'Test wallet' : 'Wallet'} · <b>{wallet.address.slice(0, 8)}…</b> · {bal.data != null ? money(bal.data, 2) : '—'} tUSD</> : 'No wallet connected'} · <Link to="/account" className="link">account</Link></span>
        </div>
      </aside>

      <section className="chat-main" aria-label="Conversation">
        <div className="chat-bar">
          <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
            <button className="icon-btn rooms-toggle" onClick={() => setSide(!side)} aria-label="Show chats" aria-expanded={side}><Icon name="side" size={17} /></button>
            <div className="model-pick">
              <button onClick={() => setPick(!pick)} aria-haspopup="listbox" aria-expanded={pick} disabled={!models.length}>
                <span>{model ? modelName(model) : m.data ? 'No models' : 'Loading models…'}</span><Icon name="chevD" size={14} />
              </button>
              {pick && (
                <div className="model-pop" role="listbox" aria-label="Model">
                  {models.map((x) => {
                    const info = gm.data?.find((y) => y.id === x);
                    return <button key={x} role="option" aria-selected={x === model} onClick={() => { setModel(x); setPick(false); if (room) update(room.id, (r) => ({ ...r, model: x })); }}><span>{modelName(x)}</span><small>via {hostName(x)} · {served.get(x)?.length ?? 0} nodes · index {info?.index_rate_per_1k ? rate1m(BigInt(info.index_rate_per_1k)) : '—'} / 1M</small></button>;
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="seg" role="group" aria-label="Pay with">
            <button aria-pressed={pay === 'x402'} onClick={() => setPay('x402')}>x402</button>
            <button aria-pressed={pay === 'private'} onClick={() => setPay('private')}>Private credit</button>
          </div>
        </div>

        <div className="chat-scroll" ref={scroller}>
          {!room ? (
            <div className="chat-empty">
              <Art name="chat" size={112} />
              <h1>Ask anything</h1>
              <p>Providers bid for every message. The lowest bid answers.</p>
              <div className="sugg">
                {SUGGESTIONS.map(([t, q]) => <button key={t} onClick={() => send(q)} disabled={!ready || busy}><b>{t}</b><small>{q}</small></button>)}
              </div>
            </div>
          ) : (
            <div className="thread">
              {room.messages.map((x, i) => (x.role === 'user' ? <div key={i} className="msg-u">{x.content}</div> : <Turn key={i} msg={x} onDelivered={(c) => setContent(room.id, i, c)} />))}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {offline && <p className="setup" role="status"><b>Setup required:</b> start the gateway, <code>{GATEWAY_START}</code></p>}
          {!offline && health && needs.length > 0 && <p className="setup" role="status"><b>Setup required:</b> {needs.join('; ')}</p>}
          {!offline && health && !needs.length && !wallet.address && (
            <div className="setup" role="status"><b>Pay per message, no account.</b> <span className="dim">A test wallet gets free test funds in one tap.</span>
              <p className="ph-actions" style={{ marginTop: 10 }}>
                <button className="btn btn-sm btn-w" onClick={() => void (wallet.hasLocal ? wallet.connect('local') : fresh.start())} disabled={fresh.busy || wallet.connecting}>{fresh.busy ? 'Getting test funds…' : wallet.hasLocal ? 'Use my test wallet' : 'Start with a test wallet'}</button>
                {(wallet.hasInjected || wallet.qaAvailable) && <button className="btn btn-sm" onClick={() => void wallet.connect()} disabled={wallet.connecting}>{wallet.connecting ? 'Connecting…' : 'Connect Core or MetaMask'}</button>}
              </p>
              {(wallet.error || fresh.error) && <p className="bad-c">{wallet.error ?? fresh.error}</p>}</div>
          )}
          {!offline && wallet.address && lowFunds && (
            <div className="setup" role="status"><b>Not enough tUSD.</b> This message escrows up to {money(escrow)}.{' '}
              {STATION && dripped.data === false
                ? <button className="btn btn-sm btn-w" style={{ marginLeft: 8 }} onClick={() => void funds.get()} disabled={funds.busy || fresh.busy}>{funds.busy || fresh.busy ? 'Sending…' : 'Get test funds'}</button>
                : <Link to="/account" className="link">Draw 100 tUSD from the faucet</Link>}
              {(funds.error || fresh.error) && <p className="bad-c">{funds.error ?? fresh.error}</p>}</div>
          )}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <label htmlFor="chat-in" className="sr">Message</label>
            <textarea id="chat-in" ref={ta} rows={1} value={text} maxLength={3000} placeholder={ready ? 'Ask anything…' : 'Connect a wallet to chat'}
              onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
            <div className="composer-row">
              <label className="verify"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />Verify this answer</label>
              <small>{pending ? 'Waiting for the auction to settle…' : pay === 'x402' ? `x402 · escrow up to ${money(escrow)}, unused part refunded` : 'Private credit · posted by the desk'}</small>
              <button className="send" type="submit" aria-label="Send" disabled={!ready || busy || pending || !text.trim()}><Icon name="up" size={18} /></button>
            </div>
          </form>
          <p className="composer-note">{verify ? 'Verified: a second staked node always re-runs this answer, and the market compares them on-chain.' : `${(m.data?.config.spotCheckBps ?? 3000) / 100}% of answers are re-run by a second node; liars lose stake.`}</p>
        </div>
      </section>
    </div>
  );
}
