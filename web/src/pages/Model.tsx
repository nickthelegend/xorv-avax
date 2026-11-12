import { priceIndex } from '@xorv/sdk';
import { hostName, modelName, secs, pct, useMarket, useNow } from '../lib/data';
import { Link, scrollToId } from '../lib/router';
import { CopyButton, Icon, State } from '../components/Ui';
import { Avatar, PageHead, Tile } from '../components/Shell';
import { Spark } from '../components/Bits';
import { Bars } from '../components/Charts';
import { ClearingsTable, JobsTable, ProvidersTable, fmt4, modelOverview } from '../components/Market';

const SECTIONS: [string, string, string][] = [['providers', 'Providers', 'server'], ['pricing', 'Pricing', 'coin'], ['performance', 'Performance', 'zap'], ['activity', 'Activity', 'list']];

/** OpenRouter model page: title and id, stat tiles, then Providers, Pricing, Performance and Activity. */
export function Model({ id }: { id: string }) {
  const m = useMarket();
  const now = useNow(5000);
  const d = m.data;
  if (!d) return <div className="wrap page">{m.error ? <State kind="error" title="Could not read the contract">{m.error}</State> : <><div className="skeleton sk-row" /><div className="tiles" style={{ marginTop: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton sk-tile" />)}</div></>}</div>;
  const o = modelOverview(id, d);
  if (!o.nodes.length && !o.jobs.length) return <div className="wrap page"><PageHead crumbs={[['/models', 'Models']]} title={modelName(id)} /><State kind="empty" title="No provider serves this model" action={<Link to="/models" className="btn btn-sm">All models</Link>}>Nobody has staked to serve <code>{id}</code> on this contract.</State></div>;
  const excluded = new Set(d.jobs.filter((j) => j.status === 'faulted').map((j) => j.id));
  const idx = priceIndex(o.clearings, excluded)[0];
  const chainNow = d.stats.now_ms + (now - m.at);
  return (
    <div className="wrap page">
      <PageHead crumbs={[['/models', 'Models']]}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}><Avatar name={modelName(id)} />{modelName(id)}</span>}
        sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span className="mono-c">{id}</span><CopyButton text={id} label="Copy id" className="btn btn-sm btn-ghost" /></span>}
        actions={<><Link to="/keys#quickstart" className="btn btn-sm"><Icon name="key" size={14} />API</Link><Link to={`/chat?model=${encodeURIComponent(id)}`} className="btn btn-w btn-sm"><Icon name="chat" size={14} />Chat with this model</Link></>} />
      <p className="dim" style={{ maxWidth: 820, marginBottom: 24 }}>{o.nodes.length ? <>Served through {hostName(id)} by {o.nodes.length} staked compute provider{o.nodes.length === 1 ? '' : 's'}; the lowest eligible sealed bid wins.</> : <>No staked compute provider serves this model now. Its past jobs remain below.</>}</p>
      <div className="tiles">
        <Tile label="Last clearing" value={idx ? fmt4(idx.last) : '—'} unit="NEAR / unit" note={idx ? 'clean auctions only' : 'no clean clearing yet'} />
        <Tile label="Unit" value="256" unit="output tokens" note="prompt ≤ 1,500 chars" />
        <Tile label="Providers" value={o.nodes.length} note={o.nodes.map((p) => p.label).join(', ')} />
        <Tile label="Delivery P50" value={secs(o.latencyMs)} note={`${o.deliveries.length} deliveries on-chain`} />
        <Tile label="Delivered" value={pct(o.deliveredRate)} note={`${o.delivered} of ${o.settled} settled jobs`} />
      </div>
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '32px 0' }} />
      <div className="with-side">
        <nav className="side" aria-label="On this page">
          {SECTIONS.map(([k, l, ic]) => <a key={k} href={`#${k}`} onClick={(e) => { e.preventDefault(); history.replaceState(null, '', `#${k}`); scrollToId(k); }}><Icon name={ic} size={15} />{l}</a>)}
        </nav>
        <div style={{ minWidth: 0 }}>
          <section id="providers">
            <div className="sec-h"><div><h2><Icon name="server" size={17} />Providers</h2><p>Kept stake is the share of jobs that ended without a slash.</p></div></div>
            <ProvidersTable providers={o.nodes} m={d} model={id} />
          </section>
          <section id="pricing" className="sec">
            <div className="sec-h"><div><h2><Icon name="coin" size={17} />Pricing</h2><p>NEAR per unit, from auctions whose winner delivered.</p></div></div>
            {idx ? (
              <div>
                <div className="tiles" style={{ marginBottom: 14 }}>
                  <Tile label="Low" value={fmt4(idx.low)} unit="NEAR" />
                  <Tile label="Median" value={fmt4(idx.median)} unit="NEAR" />
                  <Tile label="High" value={fmt4(idx.high)} unit="NEAR" />
                  <Tile label="Below buyer max" value={`${Math.round(idx.discount * 100)}%`} note="average discount" />
                </div>
                <Spark points={idx.series.map((x) => ({ x: x.ms, y: x.perUnit }))} height={150} />
                <p className="note">{idx.clearings} clean clearing{idx.clearings === 1 ? '' : 's'}, NEAR per unit.</p>
              </div>
            ) : <State kind="empty" title="No clean clearing yet">A price shows up after the first auction whose winner delivers.</State>}
            <div style={{ marginTop: 12 }}><ClearingsTable clearings={o.clearings} excluded={excluded} /></div>
          </section>
          <section id="performance" className="sec">
            <div className="sec-h"><div><h2><Icon name="zap" size={17} />Performance</h2><p>Seconds to the on-chain delivery, per job.</p></div></div>
            {o.deliveries.length ? <div className="card card-pad"><Bars groups={o.deliveries.map((x) => ({ label: `#${x.job} ${x.role === 'winner' ? '' : '✓'}`, values: [x.ms / 1000] }))} series={[{ name: 'seconds to deliver (✓ = spot-check re-run)', color: 'var(--chart)' }]} unit="s" /></div> : <State kind="empty" title="No deliveries yet">Delivery times appear after the first job is delivered on-chain.</State>}
          </section>
          <section id="activity" className="sec">
            <div className="sec-h"><div><h2><Icon name="list" size={17} />Activity</h2></div></div>
            <JobsTable jobs={o.jobs} m={d} now={chainNow} />
          </section>
        </div>
      </div>
    </div>
  );
}
