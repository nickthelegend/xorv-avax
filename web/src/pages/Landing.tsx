import { D, allModels, int, money, rate1m, servedModels, useMarket, useNow } from '../lib/data';
import { Link } from '../lib/router';
import { Art, Icon, State, type ArtName } from '../components/Ui';
import { Search } from '../components/Shell';
import { JobsTable, ModelCard } from '../components/Market';

export function Landing() {
  const m = useMarket();
  const now = useNow(5000);
  const d = m.data;
  const cfg = d?.config;
  const how: [ArtName, string, string][] = [
    ['envelope', 'Sealed bids', 'Staked nodes commit a hash of their price per 1k tokens, then reveal it.'],
    ['gavel', 'Lowest rate wins', 'The market clears on Avalanche and the winner runs your request.'],
    ['magnifier', 'Random re-runs', cfg ? `${cfg.spotCheckBps / 100}% of answers are re-run by another node, drawn from the delivery block hash.` : 'A share of answers is re-run by another node.'],
    ['shield', 'Liars get slashed', `A node a tiebreaker contradicts loses ${D.config.slashBps / 100}% of its stake.`],
  ];
  const served = d ? servedModels(d) : new Map();
  const models = d ? allModels(d).filter((x) => served.has(x)) : [];
  const lead = d?.index.find((i) => i.name === 'groq:openai/gpt-oss-20b') ?? d?.index[0] ?? null;
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>One API for the AI<br />nobody's using<span className="soft">and the real price of compute</span></h1>
          <p>Every request is a sealed-bid auction among staked nodes on Avalanche. You pay per call over x402, liars lose stake, and what each auction cleared at becomes an on-chain price index.</p>
          <div className="hero-search"><Search big placeholder="Search models, providers, jobs" /></div>
          <div className="hero-cta">
            <Link to="/chat" className="btn btn-w">Start chatting <Icon name="arrow" size={16} /></Link>
            <Link to="/index" className="btn">See the index</Link>
          </div>
          <div className="stats" aria-live="polite">
            {[
              [d ? int(d.stats.clearings) : '—', 'Auctions cleared'],
              [d ? String(d.providers.length) : '—', 'Staked providers'],
              [lead ? rate1m(lead.rate) : '—', lead ? 'Index, GPT-OSS 20B / 1M tokens' : 'Index rate'],
              [d ? String(d.stats.slashCount) : '—', 'Slashes'],
            ].map(([v, l]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}
          </div>
          {m.error && !d && <p className="note" style={{ marginTop: 16 }} role="alert">{m.error}</p>}
        </div>
      </section>

      <div className="wrap" style={{ paddingBottom: 80 }}>
        <section className="sec" aria-labelledby="h-models">
          <div className="sec-h">
            <div><h2 id="h-models">Models</h2><p>{d ? `${models.length} models from ${d.providers.length} staked providers` : 'Reading Fuji…'}</p></div>
            <Link to="/models">View all <Icon name="arrow" size={14} /></Link>
          </div>
          {!d && !m.error && <div className="cards3"><div className="skeleton sk-row" /><div className="skeleton sk-row" /><div className="skeleton sk-row" /></div>}
          {d && !models.length && <State kind="empty" art="empty" title="No models yet">A model appears once a staked provider registers to serve it.</State>}
          {d && models.length > 0 && <div className="cards3">{models.slice(0, 6).map((x) => <ModelCard key={x} model={x} m={d} />)}</div>}
        </section>

        <section className="sec" aria-labelledby="h-how">
          <div className="sec-h"><div><h2 id="h-how">How every answer clears</h2></div></div>
          <ol className="how" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {how.map(([art, t, b]) => <li key={t}><Art name={art} size={64} /><div><h3>{t}</h3><p>{b}</p></div></li>)}
          </ol>
        </section>

        <section className="sec feature-split" aria-labelledby="h-index">
          <div>
            <h2 id="h-index">The price list nobody can fake</h2>
            <p>The Xorv Compute Index records the rate each paid, checked auction cleared at, per model. Any contract can read its TWAP. A wash bid that never delivers never reaches it, and one clearing moves it at most {D.config.indexMaxStepBps / 100}%.</p>
            <Link to="/index" className="btn btn-sm" style={{ marginTop: 16 }}>Open the index <Icon name="arrow" size={14} /></Link>
          </div>
          <div className="card card-pad idx-teaser">
            {d && d.index.length ? d.index.map((i) => (
              <div key={i.id} className="idx-teaser-row">
                <span>{i.name.split(':').slice(1).join(':')}</span>
                <b className="num">{rate1m(i.rate)}</b>
                <small className="faint num">{i.observations} clearing{i.observations === 1 ? '' : 's'} · TWAP 1h {i.twap1h != null ? rate1m(i.twap1h) : '—'}</small>
              </div>
            )) : <p className="note">{d ? 'No paid clearing yet. The first checked auction with two revealed bids sets the first price.' : 'Reading the index…'}</p>}
          </div>
        </section>

        <section className="sec feature-pair" aria-label="Payments and privacy">
          <div className="card card-pad">
            <h3>Pay per call with x402</h3>
            <p>An unpaid request gets HTTP 402. Sign one EIP-3009 authorization in tUSD and the same Fuji transaction funds the job's escrow. Unused escrow comes back on-chain. Replays and expired signatures are rejected.</p>
          </div>
          <div className="card card-pad">
            <h3>Keep your AI spend private</h3>
            <p>Top up the Xorv desk with an encrypted transfer on Ava Labs' eERC. The amount is a ciphertext only you, the desk and the auditor can read, and your chats are posted under the desk's address.</p>
            <Link to="/private" className="link" style={{ display: 'inline-block', marginTop: 10 }}>How private credit works</Link>
          </div>
        </section>

        <section className="sec" aria-labelledby="h-jobs">
          <div className="sec-h">
            <div><h2 id="h-jobs">Latest jobs</h2></div>
            <Link to="/rankings#activity">All activity <Icon name="arrow" size={14} /></Link>
          </div>
          {d ? <JobsTable jobs={d.jobs.slice(0, 6)} m={d} now={now} /> : !m.error && <div className="skeleton sk-row" />}
        </section>

        <p className="quiet-line">Have API credits or a GPU you don't use? <Link to="/providers/join" className="link">Sell the idle capacity</Link>{d && <> · {money(d.stats.staked, 2)} staked so far</>}</p>
      </div>
    </>
  );
}
