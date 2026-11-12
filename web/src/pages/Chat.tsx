import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job } from '@xorv/sdk';
import { allModels, chain, hostName, modelName, near, queryParam, READ_ERROR, servesModel, short, txUrl, useMarket } from '../lib/data';
import { gateway, useGateway, GATEWAY_START, type GatewayError, type Receipts } from '../lib/gateway';
import { Link } from '../lib/router';
import { Art, Icon } from '../components/Ui';
import { Md } from '../components/MdLazy';
import { EscrowConfirmationError, useWallet } from '../lib/wallet';
import { walletError } from '../lib/wallet-errors';

type UserMsg = { role: 'user'; content: string };
type BotMsg = { role: 'assistant'; job?: number; tx?: string; model: string; content?: string; error?: string; setup?: string };
type Msg = UserMsg | BotMsg;
interface Room { id: string; title: string; model: string; messages: Msg[]; updated: number; payer?: string }

const STORE = 'xorv.chats.v1';
function isRoom(value: unknown): value is Room {
  if (!value || typeof value !== 'object') return false;
  const r = value as Room;
  return typeof r.id === 'string' && typeof r.title === 'string' && typeof r.model === 'string' && Number.isFinite(r.updated) && (r.payer === undefined || typeof r.payer === 'string')
    && Array.isArray(r.messages) && r.messages.every((m) => m && typeof m === 'object' && (m.role === 'user'
      ? typeof m.content === 'string'
      : m.role === 'assistant' && typeof m.model === 'string'
        && (m.content === undefined || typeof m.content === 'string') && (m.error === undefined || typeof m.error === 'string')
        && (m.job === undefined || (Number.isInteger(m.job) && m.job >= 0))));
}
const load = (): Room[] => {
  try { const value: unknown = JSON.parse(localStorage.getItem(STORE) ?? '[]'); return Array.isArray(value) ? value.filter(isRoom).slice(0, 40) : []; }
  catch { return []; }
};
const save = (rooms: Room[]) => { try { localStorage.setItem(STORE, JSON.stringify(rooms.slice(0, 40))); } catch { /* private mode: chats just don't persist */ } };
const newId = () => Math.random().toString(36).slice(2, 10);
const CLOSED = ['done', 'paid', 'faulted', 'expired', 'refunded', 'forfeited'];

const SUGGESTIONS = [
  ['Explain it simply', 'What is a sealed-bid auction, in two sentences?'],
  ['Write code', 'Write a JavaScript function that slugifies a title.'],
  ['Strawberry test', 'How many letters r are in the word strawberry?'],
  ['Summarise', 'Give me three tips for writing a clear bug report.'],
];

/** One assistant turn: follows its job on-chain (bids, reveal, run, spot check, settlement) and shows the delivered answer. */
function Turn({ msg, onDelivered, onFinished }: { msg: BotMsg; onDelivered: (content: string) => void; onFinished: (error: string) => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [rc, setRc] = useState<Receipts | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const done = job ? CLOSED.includes(job.status) && (!job.checks.length || job.checks.every((c) => c.output)) : false;
  const output = job?.result?.output ?? msg.content;
  useEffect(() => {
    if (msg.job == null) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await chain.job(msg.job!);
        if (!alive) return;
        setJob(j); setReadErr(null);
        gateway.receipts(msg.job!).then((r) => alive && setRc(r)).catch(() => {});
        if (j && CLOSED.includes(j.status)) return;
      } catch { if (alive) setReadErr(READ_ERROR); }
      if (alive) t = setTimeout(tick, 2500);
    };
    tick();
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearTimeout(t); clearInterval(c); };
  }, [msg.job]);
  useEffect(() => { if (job?.result?.output && msg.content !== job.result.output) onDelivered(job.result.output); }, [job?.result?.output]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (job && CLOSED.includes(job.status) && !job.result?.output && !msg.error) onFinished('No answer was delivered. See this job record for its settlement and refund.'); }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const tx = (event: string, node?: string) => rc?.nodes.find((r) => r.event.startsWith(event) && (!node || r.node === node))?.tx;
  const TxL = ({ h }: { h?: string }) => (h ? <a href={txUrl(h)} target="_blank" rel="noreferrer" title={h}>{h.slice(0, 6)}… ↗</a> : null);
  const left = (ms: number) => Math.max(0, Math.ceil((ms - now) / 1000));

  const steps: { k: string; state: 'done' | 'now' | 'bad' | 'good' | ''; body: React.ReactNode }[] = [];
  if (msg.job != null) {
    steps.push({ k: 'post', state: 'done', body: <>Posted <b>job #{msg.job}</b> with a max price, escrowed on NEAR <TxL h={msg.tx} /></> });
    if (job) {
      const committing = job.status === 'bidding' && now < job.commit_end_ms;
      steps.push({ k: 'bids', state: committing ? 'now' : 'done', body: committing ? <>Waiting for sealed bids · <b>{job.bids.length}</b> in · closes in {left(job.commit_end_ms)} s</> : <><b>{job.bids.length}</b> sealed bid{job.bids.length === 1 ? '' : 's'} from staked providers</> });
      if (!committing) {
        const revealed = job.bids.filter((b) => b.price);
        const revealing = job.status === 'bidding';
        if (job.bids.length) steps.push({ k: 'reveal', state: revealing ? 'now' : 'done', body: revealed.length ? <>Revealed: {revealed.map((b, i) => <span key={b.node}>{i ? ' · ' : ''}{short(b.owner)} {near(b.price, 4)}</span>)} NEAR</> : <>Revealing prices · {left(job.reveal_end_ms)} s</> });
      }
      if (job.winner) {
        steps.push({ k: 'win', state: 'done', body: <><b>{short(job.winner)}</b> won at <b>{near(job.clearing_price, 4)} NEAR</b> and is running {modelName(job.model)} <TxL h={tx('advance')} /></> });
        if (job.result?.output) steps.push({ k: 'deliv', state: 'done', body: <>Answer delivered on-chain in {((job.result.delivered_ms - (job.result.drawn_ms || job.reveal_end_ms)) / 1000).toFixed(1)} s <TxL h={tx('deliver', short(job.winner))} /></> });
        else if (job.status === 'running') steps.push({ k: 'run', state: 'now', body: <>Running · due in {left(job.deliver_end_ms)} s</> });
      }
      const spot = job.draws.find((d) => d.purpose === 'spot-check');
      if (spot && job.result?.output) {
        if (!spot.selected) steps.push({ k: 'spot', state: 'done', body: <>Spot check not drawn this time (roll {spot.roll_bps} ≥ {spot.threshold_bps})</> });
        else job.checks.forEach((c, i) => steps.push({ k: `chk${i}`, state: c.similarity_bps == null ? 'now' : c.similarity_bps >= 3500 ? 'good' : 'bad', body: c.similarity_bps == null ? <>{i ? 'Tiebreaker' : 'Spot check'}: <b>{short(c.owner)}</b> is re-running the prompt</> : <>{i ? 'Tiebreaker' : 'Spot check'} by <b>{short(c.owner)}</b>: {(c.similarity_bps / 100).toFixed(0)}% overlap <TxL h={tx('deliver_check', short(c.owner))} /></> }));
      }
      if (CLOSED.includes(job.status)) {
        const bad = job.status === 'faulted';
        steps.push({ k: 'end', state: bad ? 'bad' : job.status === 'expired' ? '' : 'good', body: bad ? <><b>Slashed.</b> {job.outcome}</> : job.status === 'expired' ? <><b>No delivery.</b> {job.outcome || 'Nobody bid; the escrow went back to the buyer.'}</> : <><b>Paid.</b> The provider got the clearing price; the rest of the escrow went back to the buyer.</> });
      }
    }
  }

  return (
    <div className="msg-a">
      <span className="mark-av" aria-hidden="true"><img src="/brand/xorv-mark-white.png" alt="" /></span>
      <div style={{ minWidth: 0 }}>
        <div className="msg-meta"><b>{modelName(msg.model)}</b><span>via {hostName(msg.model)}</span>{job?.winner && <span>· served by <Link to={`/providers/${short(job.winner)}`} className="link">{short(job.winner)}</Link></span>}</div>
        {msg.error && <div className="err-box" role="alert"><b>{msg.tx || msg.job != null ? 'Job update' : msg.setup ? 'Setup required' : 'Not sent'}.</b> {msg.error}</div>}
        {msg.job == null && !msg.error && <ol className="steps"><li className="step now"><i /><span>Signing the job on NEAR…</span></li></ol>}
        {steps.length > 0 && !(done && job?.result?.output) && <ol className="steps" aria-live="polite">{steps.map((s) => <li key={s.k} className={`step ${s.state}`}><i /><span>{s.body}</span></li>)}</ol>}
        {output && <div className="answer"><Md text={output} /></div>}
        {done && job?.result?.output && <details className="prompt"><summary>How this answer was bought ({steps.length} steps on NEAR)</summary><ol className="steps">{steps.map((s) => <li key={s.k} className={`step ${s.state}`}><i /><span>{s.body}</span></li>)}</ol></details>}
        {readErr && !job && <p className="note">Could not read job #{msg.job}: {readErr}</p>}
        {(msg.job != null && (output || (job && CLOSED.includes(job.status))) || (msg.tx && msg.error)) && (
          <div className="receipt-bar">
            {job && BigInt(job.clearing_price) > 0n && <span className="money">{near(job.clearing_price, 4)} NEAR</span>}
            {msg.tx && <a href={txUrl(msg.tx)} target="_blank" rel="noreferrer">Post tx <Icon name="external" size={11} /></a>}
            {tx('deliver') && <a href={txUrl(tx('deliver')!)} target="_blank" rel="noreferrer">Delivery tx <Icon name="external" size={11} /></a>}
            {msg.job != null && <Link to={`/jobs/${msg.job}`}>Job #{msg.job} record <Icon name="arrow" size={12} /></Link>}
          </div>
        )}
      </div>
    </div>
  );
}

export function Chat() {
  const wallet = useWallet();
  const m = useMarket();
  const g = useGateway(6000);
  const [rooms, setRooms] = useState<Room[]>(load);
  const [cur, setCur] = useState<string | null>(() => { if (queryParam('model')) return null; try { return localStorage.getItem(STORE + '.cur'); } catch { return null; } });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [side, setSide] = useState(false);
  // Only models a staked compute provider serves right now can be bought.
  const models = m.data ? allModels(m.data).filter((x) => m.data!.providers.some((p) => servesModel(p, x))) : [];
  const [model, setModel] = useState<string>(queryParam('model') ?? '');
  const payer = wallet.account || `demo:${g.data?.buyer ?? 'gateway'}`;
  const visibleRooms = rooms.filter((r) => r.payer ? r.payer === payer : !wallet.account);
  const room = visibleRooms.find((r) => r.id === cur) ?? null;
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!model && models.length) setModel(models[0]); }, [models.join(), model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { save(rooms); }, [rooms]);
  useEffect(() => { try { if (cur) localStorage.setItem(STORE + '.cur', cur); else localStorage.removeItem(STORE + '.cur'); } catch { /* ignore */ } }, [cur]);
  useEffect(() => { if (!room) return; scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [room?.messages.length, cur]);
  useEffect(() => { if (room) setModel(room.model); }, [cur, room?.id, wallet.account]); // eslint-disable-line react-hooks/exhaustive-deps

  const offline = g.error?.offline;
  const needs = (wallet.account ? g.data?.provider_setup_required : g.data?.setup_required) ?? [];
  const selected = g.data?.models.find((x) => x.id === model);
  const ready = wallet.ready && !!g.data && needs.length === 0 && !!(wallet.account ? selected?.ready : selected?.demo_ready ?? selected?.ready);
  const pending = room?.messages.some((x) => x.role === 'assistant' && !x.content && !x.error) ?? false;

  const update = (id: string, f: (r: Room) => Room) => setRooms((rs) => rs.map((r) => (r.id === id ? f(r) : r)).sort((a, b) => b.updated - a.updated));

  async function send(content: string) {
    const c = content.trim();
    if (!c || busy || pending || wallet.connecting || !ready || !models.includes(model)) return;
    setBusy(true);
    let id = cur;
    if (!id || !room) {
      id = newId();
      const r: Room = { id, title: c.slice(0, 60), model, messages: [], updated: Date.now(), payer };
      setRooms((rs) => [r, ...rs]);
      setCur(id);
    }
    const history = (room && room.id === id ? room.messages : []).flatMap((x) => (x.role === 'user' ? [{ role: 'user', content: x.content }] : x.content ? [{ role: 'assistant', content: x.content }] : []));
    const bot: BotMsg = { role: 'assistant', model };
    update(id, (r) => ({ ...r, model, updated: Date.now(), messages: [...r.messages, { role: 'user', content: c }, bot] }));
    setText('');
    try {
      const messages = [...history, { role: 'user', content: c }];
      const p = wallet.account ? await wallet.postChat(model, messages) : await gateway.chat(model, messages);
      if (wallet.account) void gateway.recordWalletPost(p.job, p.tx).catch(() => {});
      update(id, (r) => ({ ...r, messages: r.messages.map((x) => (x === bot ? { ...bot, job: p.job, tx: p.tx } : x)) }));
      setTimeout(() => m.reload(), 4000);
    } catch (e) {
      const err = e as GatewayError;
      const error = err instanceof EscrowConfirmationError ? err.message : wallet.account ? walletError(err) : err.offline ? `The Xorv gateway is not running. Start it with ${GATEWAY_START}` : err.message;
      update(id, (r) => ({ ...r, messages: r.messages.map((x) => (x === bot ? { ...bot, ...(err instanceof EscrowConfirmationError ? { tx: err.tx } : {}), error, setup: err.setup } : x)) }));
    } finally { setBusy(false); ta.current?.focus(); }
  }

  const setContent = (id: string, msgIdx: number, content: string) => update(id, (r) => ({ ...r, messages: r.messages.map((x, i) => (i === msgIdx && x.role === 'assistant' ? { ...x, content } : x)) }));
  const setFailure = (id: string, msgIdx: number, error: string) => update(id, (r) => ({ ...r, messages: r.messages.map((x, i) => (i === msgIdx && x.role === 'assistant' ? { ...x, error } : x)) }));
  const readyLabel = useMemo(() => (offline ? 'Gateway offline' : !g.data ? 'Checking…' : ready ? `${g.data.nodes.filter((n) => n.up).length || 'External'} providers online` : 'Setup required'), [offline, g.data, ready]);

  return (
    <div className="chat">
      <aside className={`chat-side ${side ? 'open' : ''}`} aria-label="Chats">
        <div className="chat-side-h">
          <button className="btn btn-sm" onClick={() => { setCur(null); setSide(false); setTimeout(() => ta.current?.focus(), 0); }}><Icon name="plus" size={15} />New chat</button>
        </div>
        <div className="rooms">
          <div className="rooms-h"><span>{visibleRooms.length} chat{visibleRooms.length === 1 ? '' : 's'}</span><span>this browser</span></div>
          {!visibleRooms.length && <p className="rooms-empty">No chats yet. Each message you send becomes a job on NEAR.</p>}
          {visibleRooms.map((r) => (
            <div key={r.id} className={`room ${r.id === cur ? 'on' : ''}`}>
              <button onClick={() => { setCur(r.id); setSide(false); }} aria-current={r.id === cur}>{r.title}</button>
              <button className="del" aria-label={`Delete chat ${r.title}`} onClick={() => { setRooms((rs) => rs.filter((x) => x.id !== r.id)); if (cur === r.id) setCur(null); }}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
        <div className="chat-side-f">
          <span><i className={`live-dot ${ready ? '' : 'off'}`} style={{ display: 'inline-block', marginRight: 6 }} />{readyLabel}</span>
          <span>{wallet.account ? <>Wallet-paid · <b>{wallet.account}</b></> : <>Gateway-paid demo{g.data?.buyer && <> · <b>{short(g.data.buyer)}</b></>}</>} · <Link to="/account" className="link">credits</Link></span>
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
                    const h = g.data?.models.find((y) => y.id === x);
                    return <button key={x} role="option" aria-selected={x === model} onClick={() => { setModel(x); setPick(false); if (room) update(room.id, (r) => ({ ...r, model: x })); }}><span>{modelName(x)}</span><small>via {hostName(x)} · {m.data!.providers.filter((p) => servesModel(p, x)).length} providers · {h ? (h.ready ? 'ready' : 'setup required') : 'gateway offline'}</small></button>;
                  })}
                </div>
              )}
            </div>
          </div>
          <Link to="/keys" className="btn btn-sm btn-ghost">API</Link>
        </div>

        <div className="chat-scroll" ref={scroller}>
          {!room ? (
            <div className="chat-empty">
              <Art name="chat" size={112} />
              <h1>Ask anything</h1>
              <p>Each message is a sealed-bid job on NEAR. You see who answered and what it cost.</p>
              <div className="sugg">
                {SUGGESTIONS.map(([t, q]) => <button key={t} onClick={() => send(q)} disabled={!ready || busy}><b>{t}</b><small>{q}</small></button>)}
              </div>
            </div>
          ) : (
            <div className="thread">
              {room.messages.map((x, i) => x.role === 'user'
                ? <div key={i} className="msg-u">{x.content}</div>
                : <Turn key={i} msg={x} onDelivered={(c) => setContent(room.id, i, c)} onFinished={(e) => setFailure(room.id, i, e)} />)}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {offline && (
            <p className="setup" role="status"><b>Setup required:</b> start the gateway, <code>{GATEWAY_START}</code></p>
          )}
          {!offline && g.data && needs.length > 0 && (
            <p className="setup" role="status"><b>Setup required:</b> {needs.map((n) => n.split(' ')[0]).join(', ')}. Start providers with <code>{GATEWAY_START}</code>.</p>
          )}
          {!offline && g.data && needs.length === 0 && !ready && <p className="setup" role="status"><b>Model unavailable:</b> choose a served model, or check its provider setup in the gateway.</p>}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <label htmlFor="chat-in" className="sr">Message</label>
            <textarea id="chat-in" ref={ta} rows={1} value={text} maxLength={1400} placeholder={ready ? 'Ask anything…' : 'Chat is read-only until setup is done'}
              onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
            <div className="composer-row">
              <small>{pending ? 'Waiting for the auction to settle…' : `${wallet.account ? 'Wallet-paid' : 'Gateway-paid demo'} · Up to 0.05 NEAR to the provider + 0.03 NEAR job storage · ${text.length}/1400`}</small>
              <button className="send" type="submit" aria-label="Send" disabled={!ready || busy || pending || wallet.connecting || !text.trim()}><Icon name="up" size={18} /></button>
            </div>
          </form>
          <p className="composer-note">Answers come from whichever staked provider wins the auction. A random 30% are re-checked by a second node.</p>
        </div>
      </section>
    </div>
  );
}
