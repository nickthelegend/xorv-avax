import { C, D, addrUrl, allModels, int, money, rate1m, servedModels, short, useMarket, useNow } from '../lib/data';
import { Link } from '../lib/router';
import { Art, Icon, State, type ArtName } from '../components/Ui';
import { JobsTable, ModelCard } from '../components/Market';

const CONTRACTS: [string, string | undefined][] = [
  ['Market (auctions, checks)', C.market],
  ['Compute Index', C.index],
  ['x402 router', C.router],
  ['Registry (stake, slashing)', C.registry],
  ['Encrypted ERC (Ava Labs)', D.eerc?.encryptedERC],
];

export function Landing() {
  const m = useMarket();
  const now = useNow(5000);
  const d = m.data;
  const cfg = d?.config;
  const steps: [ArtName, string, string][] = [
    ['pay', 'Ask, pay per message', 'No account or plan. Each request carries its own payment, a fraction of a cent.'],
    ['bids', 'Providers bid blind', 'Staked nodes with spare capacity bid in a sealed auction. Lowest price answers.'],
    ['magnifier', 'Checked, then priced', cfg ? `${cfg.spotCheckBps / 100}% of answers are re-run; a node caught lying loses ${D.config.slashBps / 100}% of its stake.` : 'A share of answers is re-run, and a node caught lying loses stake.'],
  ];
  const served = d ? servedModels(d) : new Map();
  const models = d ? allModels(d).filter((x) => served.has(x)) : [];
  const lead = d?.index.find((i) => i.name === 'groq:openai/gpt-oss-20b') ?? d?.index[0] ?? null;
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <Art name="hero" size={176} className="hero-art" label />
          <h1>Every AI request goes<br className="br-lg" /> to the lowest bidder</h1>
          <p>Pay per message, no account. Providers with idle capacity bid for each request in a sealed auction, and every winning price joins a public index on Avalanche.</p>
          <div className="hero-cta">
            <Link to="/chat" className="btn btn-w">Start chatting <Icon name="arrow" size={16} /></Link>
            <Link to="/index" className="btn">See the price index</Link>
          </div>
          <div className="stats" aria-live="polite">
            {[
              [d ? int(d.stats.clearings) : '—', 'Auctions cleared'],
              [d ? String(d.providers.length) : '—', 'Staked providers'],
              [lead ? rate1m(lead.rate) : '—', lead ? 'GPT-OSS 20B, per 1M tokens' : 'Index rate'],
              [d ? String(d.stats.slashCount) : '—', 'Liars slashed'],
            ].map(([v, l]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}
          </div>
          {m.error && !d && <p className="note" style={{ marginTop: 16 }} role="alert">{m.error}</p>}
        </div>
      </section>

      <div className="wrap" style={{ paddingBottom: 80 }}>
        <section className="sec" aria-labelledby="h-how">
          <div className="sec-h"><div><h2 id="h-how">How it works</h2></div></div>
          <ol className="how how3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {steps.map(([art, t, b]) => <li key={t}><Art name={art} size={72} /><div><h3>{t}</h3><p>{b}</p></div></li>)}
          </ol>
        </section>

        <section className="sec feature-split" aria-labelledby="h-index">
          <div>
            <Art name="index" size={88} />
            <h2 id="h-index" style={{ marginTop: 12 }}>A price for AI that nobody can fake</h2>
            <p>Only paid, checked answers count, and one auction moves the index at most {D.config.indexMaxStepBps / 100}%. Any contract can read it. Need your spend hidden? Pay from an encrypted eERC balance instead.</p>
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

        <section className="sec" aria-labelledby="h-app">
          <div className="card app-band">
            <div>
              <h2 id="h-app">Use it from chat, code or an agent</h2>
              <p>Open the chat with a test wallet made in your browser, and one tap funds it. Or point any OpenAI client at the API, or give an agent the MCP tools.</p>
              <div className="codebox" style={{ marginTop: 16 }}>
                <div className="codebox-h"><span>OpenAI-compatible, paid with x402</span></div>
                <pre>POST https://xorv-avax.vercel.app/v1/chat/completions{'\n'}<span className="c">→ 402 Payment Required, sign once, get the answer</span></pre>
              </div>
              <div className="hero-cta" style={{ justifyContent: 'flex-start' }}>
                <Link to="/chat" className="btn btn-w btn-sm">Start chatting <Icon name="arrow" size={14} /></Link>
                <Link to="/models" className="btn btn-sm">Models</Link>
              </div>
            </div>
            <Art name="app" size={240} className="app-art" label />
          </div>
          {!d && !m.error && <div className="cards3" style={{ marginTop: 12 }}><div className="skeleton sk-row" /><div className="skeleton sk-row" /></div>}
          {d && !models.length && <State kind="empty" art="empty" title="No models yet">A model appears once a staked provider registers to serve it.</State>}
          {d && models.length > 0 && <div className={`cards3${models.length === 2 ? ' n2' : ''}`} style={{ marginTop: 12 }}>{models.slice(0, 3).map((x) => <ModelCard key={x} model={x} m={d} />)}</div>}
        </section>

        <section className="sec" aria-labelledby="h-proof">
          <div className="sec-h">
            <div><h2 id="h-proof">Check it yourself</h2><p>Every job is a Fuji transaction. Latest auctions, then the contracts on Snowtrace.</p></div>
            <Link to="/rankings#activity">All activity <Icon name="arrow" size={14} /></Link>
          </div>
          {d ? <JobsTable jobs={d.jobs.slice(0, 4)} m={d} now={now} /> : !m.error && <div className="skeleton sk-row" />}
          <div className="contracts">
            {CONTRACTS.filter(([, a]) => a).map(([k, a]) => (
              <a key={k} href={addrUrl(a!)} target="_blank" rel="noreferrer"><span>{k}</span><b className="mono-c">{short(a!)}</b><Icon name="external" size={13} /></a>
            ))}
          </div>
        </section>

        <p className="quiet-line">Have API credits or a GPU you don't use? <Link to="/providers/join" className="link">Sell the idle capacity</Link>{d && <> · {money(d.stats.staked, 2)} staked so far</>}</p>
      </div>
    </>
  );
}
