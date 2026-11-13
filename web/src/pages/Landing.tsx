import { useState, type ReactNode } from 'react';
import { C, D, addrUrl, allModels, int, money, rate1m, servedModels, short, useMarket, useNow } from '../lib/data';
import { Link } from '../lib/router';
import { Art, CopyButton, Icon, State, type ArtName } from '../components/Ui';
import { JobsTable, ModelCard } from '../components/Market';

const CONTRACTS: [string, string | undefined][] = [
  ['Market (auctions, checks)', C.market],
  ['Compute Index', C.index],
  ['x402 router', C.router],
  ['Registry (stake, slashing)', C.registry],
  ['Encrypted ERC (Ava Labs)', D.eerc?.encryptedERC],
];

/** A code line: the command or statement, and a quiet comment after it. */
type Line = [string, string?];
const PROVIDER: Line[] = [
  ['xorv-node init  --label you', 'an owner key and a node key'],
  ['xorv-node join  --label you --stake 5', 'faucet, approve, register'],
  ['xorv-node start --label you', 'bid, serve, get paid'],
];
const BUY: Record<string, { title: string; lines: Line[] }> = {
  SDK: {
    title: 'TypeScript · @xorv/sdk',
    lines: [
      ["import { Xorv } from '@xorv/sdk';"],
      ['const xorv = new Xorv({ account });', 'a Fuji wallet with test dollars'],
      ["const r = await xorv.chat('Summarise this contract', { verify: true });"],
      ['r.text, r.job, r.settlement', 'answer, job id, Fuji tx'],
    ],
  },
  CLI: {
    title: 'terminal · xorv',
    lines: [
      ['xorv wallet new && xorv fund', 'test wallet + 2 tUSD, gasless'],
      ['xorv quote "…" --verify', 'the most it can cost'],
      ['xorv chat  "…" --verify', 'bids → answer → check → settled, live'],
      ['xorv verify 58', 're-check any job from Fuji alone'],
    ],
  },
  API: {
    title: 'any OpenAI-style client · x402',
    lines: [
      ['POST https://xorv-avax.vercel.app/v1/chat/completions'],
      ['← 402 Payment Required', 'exact scheme, tUSD on avalanche-fuji'],
      ['X-PAYMENT: <one EIP-3009 signature>', 'no account, no API key'],
      ['← 200 + the answer + its Fuji settlement'],
    ],
  },
  MCP: {
    title: 'agents · xorv-mcp (stdio)',
    lines: [
      ['xorv_ask', 'pays the 402 itself, returns answer + tx'],
      ['xorv_index', 'what AI work cleared at, per model'],
      ['xorv_models · xorv_job', 'who serves what; one job and its txs'],
    ],
  },
};

function Code({ title, lines, prompt = false, copy }: { title: ReactNode; lines: Line[]; prompt?: boolean; copy?: string }) {
  return (
    <div className="codebox codebox-lg">
      <div className="codebox-h"><span>{title}</span>{copy && <CopyButton text={copy} className="btn btn-sm btn-ghost" />}</div>
      <pre>{lines.map(([code, note], i) => (
        <span key={i} className="cl">{prompt && <span className="c">$ </span>}{code}{note && <span className="c">{'  '}# {note}</span>}{'\n'}</span>
      ))}</pre>
    </div>
  );
}

function BuyTabs() {
  const [tab, setTab] = useState<keyof typeof BUY>('SDK');
  const t = BUY[tab];
  return (
    <div>
      <div className="seg buy-tabs" role="tablist" aria-label="Ways to buy">
        {Object.keys(BUY).map((k) => <button key={k} type="button" role="tab" aria-selected={k === tab} aria-pressed={k === tab} onClick={() => setTab(k)}>{k}</button>)}
      </div>
      <Code title={t.title} lines={t.lines} prompt={tab === 'CLI'} copy={t.lines.map(([c]) => c).join('\n')} />
    </div>
  );
}

const COMPARE: { name: string; account: string; price: string; sellers: string; checked: string; us?: boolean }[] = [
  { name: 'One vendor’s API key', account: 'Account and card first', price: 'The vendor’s list price', sellers: 'One company', checked: 'No' },
  { name: 'An AI router', account: 'Account and prepaid credits', price: 'Each provider’s listed price', sellers: 'Providers it signs up', checked: 'No' },
  { name: 'A GPU marketplace', account: 'Account, then rent a machine by the hour', price: 'Bids on hourly leases', sellers: 'Anyone with a GPU', checked: 'You run the model yourself' },
  { name: 'Xorv', account: 'None: one x402 signature per request', price: 'A sealed-bid auction for each request', sellers: 'Anyone who stakes and runs xorv-node', checked: 'Re-run by another node; a liar pays you', us: true },
];

export function Landing() {
  const m = useMarket();
  const now = useNow(5000);
  const d = m.data;
  const cfg = d?.config;
  const steps: [ArtName, string, string][] = [
    ['pay', 'A buyer asks, pays per request', 'No account or plan. Each request carries its own x402 payment, a fraction of a cent, into escrow on Fuji.'],
    ['bids', 'Providers bid blind', 'Staked nodes with idle capacity commit sealed prices, then reveal. The lowest price answers.'],
    ['magnifier', 'Checked, then settled', cfg ? `${cfg.spotCheckBps / 100}% of answers (all, with Verify) are re-run by another node; a node caught lying loses ${D.config.slashBps / 100}% of its stake to the buyer.` : 'A share of answers is re-run, and a node caught lying loses stake.'],
  ];
  const served = d ? servedModels(d) : new Map();
  const models = d ? allModels(d).filter((x) => served.has(x)) : [];
  const lead = d?.index.find((i) => i.name === 'groq:openai/gpt-oss-20b') ?? d?.index[0] ?? null;
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <Art name="hero" size={176} className="hero-art" label />
          <h1>Sell the AI you don’t use.<span className="soft">Buy AI one request at a time.</span></h1>
          <p>A two-sided market on Avalanche. People who already pay for AI run a Xorv node and sell their idle capacity. Buyers offload AI work from code, a terminal or an agent, and every request goes to the lowest sealed bid.</p>
          <div className="hero-cta">
            <Link to="/#sides" className="btn btn-w">Offload AI work <Icon name="arrow" size={16} /></Link>
            <Link to="/providers/join" className="btn">Become a provider</Link>
            <Link to="/chat" className="btn btn-ghost">Try the chat</Link>
          </div>
          <div className="stats" aria-live="polite">
            {[
              [d ? int(d.stats.clearings) : '—', 'Auctions cleared'],
              [d ? String(d.providers.filter((p) => p.stake >= BigInt(D.config.minStake)).length) : '—', 'Staked providers'],
              [lead ? rate1m(lead.rate) : '—', lead ? 'GPT-OSS 20B, per 1M tokens' : 'Index rate'],
              [d ? String(d.stats.slashCount) : '—', 'Slashes on Fuji'],
            ].map(([v, l]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}
          </div>
          {m.error && !d && <p className="note" style={{ marginTop: 16 }} role="alert">{m.error}</p>}
        </div>
      </section>

      <div className="wrap" style={{ paddingBottom: 80 }}>
        <section className="sec sides" id="sides" aria-labelledby="h-sides">
          <div className="sec-h"><div><h2 id="h-sides">One market, two sides</h2><p>Providers sell capacity they already pay for. Buyers offload work and pay only for what they use.</p></div></div>
          <div className="sides-grid">
            <article className="card side-card">
              <div className="side-top">
                <Art name="gpu" size={84} />
                <div>
                  <span className="kicker">Providers</span>
                  <h3>Sell AI you already pay for</h3>
                </div>
              </div>
              <p>An API plan you don’t use all day, or a GPU that sits idle: run a Xorv node. It bids a sealed price for each request it can serve, answers, and is paid on Fuji. Its stake keeps it honest: a node caught lying loses {D.config.slashBps / 100}% to the buyer.</p>
              <ul className="side-flow" aria-label="What a node does">
                <li><b>Bid</b><span>sealed, from its own cost</span></li>
                <li><b>Serve</b><span>runs the model, delivers on-chain</span></li>
                <li><b>Get paid</b><span>cleared rate × tokens</span></li>
                <li className="bad"><b>Lie, get slashed</b><span>stake goes to the buyer</span></li>
              </ul>
              <Code title="terminal · become a provider" prompt lines={PROVIDER} copy={PROVIDER.map(([c]) => c).join('\n')} />
              <Link to="/providers/join" className="link side-more">Provider guide: keys, stake, models, payouts <Icon name="arrow" size={14} /></Link>
            </article>
            <article className="card side-card">
              <div className="side-top">
                <Art name="app" size={84} />
                <div>
                  <span className="kicker">Buyers</span>
                  <h3>Offload AI work, pay per request</h3>
                </div>
              </div>
              <p>No account, plan or API key. Send a request from your code, a terminal or an agent; the cheapest staked node answers, and you pay its price for the tokens used. Payment and refund settle with x402 on Fuji.</p>
              <BuyTabs />
              <Link to="/chat" className="link side-more">Or try it in the browser with a test wallet <Icon name="arrow" size={14} /></Link>
            </article>
          </div>
          <p className="honest-line"><Icon name="shield" size={14} /><span>Today every node is ours: four nodes that resell Groq at its list price plus their own margin. The node software is in the repo, so anyone can run one. From a clone: <code>pnpm install</code>, then <code>pnpm xorv …</code> and <code>pnpm xorv-node …</code>.</span></p>
        </section>

        <section className="sec" aria-labelledby="h-how">
          <div className="sec-h"><div><h2 id="h-how">How one request clears</h2></div></div>
          <ol className="how how3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {steps.map(([art, t, b]) => <li key={t}><Art name={art} size={72} /><div><h3>{t}</h3><p>{b}</p></div></li>)}
          </ol>
        </section>

        <section className="sec" aria-labelledby="h-vs">
          <div className="sec-h"><div><h2 id="h-vs">Why not just buy an API key?</h2><p>How Xorv differs from the usual ways to buy AI. It does not claim to be cheaper: today its price sits at Groq’s list price.</p></div></div>
          <div className="card vs-wrap">
            <table className="vs">
              <thead><tr><th scope="col">Way to buy AI</th><th scope="col">To start</th><th scope="col">Price set by</th><th scope="col">Who can sell</th><th scope="col">Answer checked</th></tr></thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.name} className={r.us ? 'us' : undefined}>
                    <th scope="row">{r.us ? <span className="vs-us"><img src="/art/3d/xorv-3d-mark.webp" width={22} height={22} alt="" /> {r.name}</span> : r.name}</th>
                    <td data-l="To start">{r.account}</td><td data-l="Price set by">{r.price}</td><td data-l="Who can sell">{r.sellers}</td><td data-l="Answer checked">{r.checked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sec feature-split" aria-labelledby="h-index">
          <div>
            <Art name="index" size={88} />
            <h2 id="h-index" style={{ marginTop: 12 }}>A price for AI that nobody can fake</h2>
            <p>Every paid, checked auction feeds the Xorv Compute Index, and one auction moves it at most {D.config.indexMaxStepBps / 100}%. Any contract can read it. Need your spend hidden? Pay from an encrypted eERC balance instead.</p>
            <div className="row-btns">
              <Link to="/index" className="btn btn-sm">Open the index <Icon name="arrow" size={14} /></Link>
              <Link to="/private" className="btn btn-sm btn-ghost">Private credit</Link>
            </div>
          </div>
          <div className="card card-pad idx-teaser">
            {d && d.index.length ? d.index.map((i) => (
              <div key={i.id} className="idx-teaser-row">
                <span>{i.name.split(':').slice(1).join(':')}</span>
                <b className="num">{rate1m(i.rate)}</b>
                <small className="faint num">{i.observations} clearing{i.observations === 1 ? '' : 's'} · TWAP 1h {i.twap1h != null ? rate1m(i.twap1h) : '—'}</small>
              </div>
            )) : <p className="note">{d ? 'No paid clearing yet. The first checked auction with two revealed bids sets the first price.' : m.error ? 'The index could not be read.' : 'Reading the index…'}</p>}
          </div>
        </section>

        <section className="sec" aria-labelledby="h-models">
          <div className="sec-h"><div><h2 id="h-models">Models on the market</h2><p>What staked nodes serve right now.</p></div><Link to="/models">All models <Icon name="arrow" size={14} /></Link></div>
          {!d && !m.error && <div className="cards3"><div className="skeleton sk-row" /><div className="skeleton sk-row" /></div>}
          {d && !models.length && <State kind="empty" art="empty" title="No models yet">A model appears once a staked provider registers to serve it.</State>}
          {d && models.length > 0 && <div className={`cards3${models.length === 2 ? ' n2' : ''}`}>{models.slice(0, 3).map((x) => <ModelCard key={x} model={x} m={d} />)}</div>}
        </section>

        <section className="sec" aria-labelledby="h-proof">
          <div className="sec-h">
            <div><h2 id="h-proof">Check it yourself</h2><p>Every job is a Fuji transaction, and <code>xorv verify</code> re-checks any of them from the chain alone.</p></div>
            <Link to="/rankings#activity">All activity <Icon name="arrow" size={14} /></Link>
          </div>
          {d ? <JobsTable jobs={d.jobs.slice(0, 4)} m={d} now={now} /> : !m.error && <div className="skeleton sk-row" />}
          <div className="contracts">
            {CONTRACTS.filter(([, a]) => a).map(([k, a]) => (
              <a key={k} href={addrUrl(a!)} target="_blank" rel="noreferrer"><span>{k}</span><b className="mono-c">{short(a!)}</b><Icon name="external" size={13} /></a>
            ))}
          </div>
        </section>

        <p className="quiet-line">Have API credits or a GPU you don’t use? <Link to="/providers/join" className="link">Run a node and sell the idle capacity</Link>{d && <> · {money(d.stats.staked, 2)} staked so far</>}</p>
      </div>
    </>
  );
}
