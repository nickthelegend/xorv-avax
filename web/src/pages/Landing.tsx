import { allModels, chain, nearNum, servesModel, useMarket, useNow, usePoll } from '../lib/data';
import { Link } from '../lib/router';
import { Art, Icon, State, type ArtName } from '../components/Ui';
import { Search } from '../components/Shell';
import { JobsTable, ModelCard } from '../components/Market';

const fmt = (n: number, d = 3) => n.toLocaleString('en-US', { maximumFractionDigits: d });

export function Landing() {
  const m = useMarket();
  const cfg = usePoll(() => chain.config(), 0).data;
  const how: [ArtName, string, string][] = [
    ['envelope', 'Sealed bids', 'Staked providers commit a hash of their price, then reveal it.'],
    ['gavel', 'Lowest bid wins', 'The contract clears the auction and the winner runs your request.'],
    ['magnifier', 'Random re-runs', cfg ? `${cfg.spot_check_bps / 100}% of jobs are re-run by a verifier, drawn by block seed.` : 'A share of jobs is re-run by a verifier, drawn by block seed.'],
    ['shield', 'Liars get slashed', cfg ? `A provider caught lying loses ${cfg.slash_bps / 100}% of its stake.` : 'A provider caught lying loses part of its stake.'],
  ];
  const now = useNow(5000);
  const d = m.data;
  const chainNow = d ? d.stats.now_ms + (now - m.at) : now;
  // Most-used first, so the featured cards show where the jobs actually went.
  const models = d ? allModels(d).filter((x) => d.providers.some((p) => servesModel(p, x))).sort((a, b) => d.jobs.filter((j) => j.model === b).length - d.jobs.filter((j) => j.model === a).length) : [];
  const servingProviders = d?.providers.filter((p) => models.some((model) => servesModel(p, model))).length ?? 0;
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>One API for the AI<br />nobody's using</h1>
          <p>Idle AI plans and API credits, sold per request in sealed-bid auctions on NEAR. Random re-runs catch liars, who lose their stake.</p>
          <div className="hero-search"><Search big placeholder="Search models, providers, jobs" /></div>
          <div className="hero-cta">
            <Link to="/chat" className="btn btn-w">Start chatting <Icon name="arrow" size={16} /></Link>
            <Link to="/keys" className="btn">Get an API key</Link>
          </div>
          <div className="stats" aria-live="polite">
            {[
              [d ? fmt(d.stats.jobs, 0) : '—', 'Jobs run on-chain'],
              [d ? String(d.stats.providers) : '—', 'Staked providers'],
              [d ? fmt(nearNum(d.stats.paid_to_providers)) : '—', 'NEAR paid to providers'],
              [d ? String(d.stats.slash_count) : '—', 'Slashes'],
            ].map(([v, l]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}
          </div>
          {m.error && !d && <p className="note" style={{ marginTop: 16 }} role="alert">Could not read the contract: {m.error}</p>}
        </div>
      </section>

      <div className="wrap" style={{ paddingBottom: 80 }}>
        <section className="sec" aria-labelledby="h-models">
          <div className="sec-h">
            <div><h2 id="h-models">Featured models</h2><p>{d ? `${models.length} models from ${servingProviders} staked compute providers` : 'Reading the contract…'}</p></div>
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

        <section className="sec" aria-labelledby="h-jobs">
          <div className="sec-h">
            <div><h2 id="h-jobs">Latest jobs</h2></div>
            <Link to="/rankings#activity">All activity <Icon name="arrow" size={14} /></Link>
          </div>
          {d ? <JobsTable jobs={d.jobs.slice(0, 6)} m={d} now={chainNow} /> : !m.error && <div className="skeleton sk-row" />}
        </section>

        <p className="quiet-line">Have an AI plan or API credits you don't use? <Link to="/providers/join" className="link">Sell the idle capacity</Link></p>
      </div>
    </>
  );
}
