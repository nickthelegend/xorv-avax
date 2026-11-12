import { modelInfo } from '@xorv/sdk';
import { hostName, modelName, money, rate1m, useMarket, useNow } from '../lib/data';
import { Link } from '../lib/router';
import { CopyButton, Icon, State } from '../components/Ui';
import { Avatar, PageHead, Tile } from '../components/Shell';
import { Spark } from '../components/Bits';
import { JobsTable, ProvidersTable, modelOverview, pct } from '../components/Market';

/** OpenRouter model page: title and id, stat tiles, then providers, price and activity. */
export function Model({ id }: { id: string }) {
  const m = useMarket();
  const now = useNow(5000);
  const d = m.data;
  if (!d) return <div className="wrap page">{m.error ? <State kind="error" art="warning" title="Could not read Fuji">{m.error}</State> : <><div className="skeleton sk-row" /><div className="tiles" style={{ marginTop: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton sk-tile" />)}</div></>}</div>;
  const o = modelOverview(id, d);
  if (!o.nodes.length && !o.jobs.length && !o.index) return <div className="wrap page"><PageHead crumbs={[['/models', 'Models']]} title={modelName(id)} /><State kind="empty" art="empty" title="No provider serves this model" action={<Link to="/models" className="btn btn-sm">All models</Link>}>Nobody has staked to serve <code>{id}</code>.</State></div>;
  const paid = [...o.paid].reverse();
  return (
    <div className="wrap page">
      <PageHead crumbs={[['/models', 'Models']]}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}><Avatar name={modelName(id)} />{modelName(id)}</span>}
        sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span className="mono-c">{id}</span><CopyButton text={id} label="Copy id" className="btn btn-sm btn-ghost" /></span>}
        actions={<><Link to="/index" className="btn btn-sm"><Icon name="index" size={14} />Index</Link><Link to={`/chat?model=${encodeURIComponent(id)}`} className="btn btn-w btn-sm"><Icon name="chat" size={14} />Chat with this model</Link></>} />
      <p className="dim" style={{ maxWidth: 820, marginBottom: 24 }}>{modelInfo(id).blurb} {o.nodes.length ? <>Served through {hostName(id)} by {o.nodes.length} staked node{o.nodes.length === 1 ? '' : 's'}; the lowest sealed rate wins each request.</> : <>No staked node serves it now.</>}</p>
      <div className="tiles">
        <Tile label="Index" value={o.index ? rate1m(o.index.rate) : '—'} unit="/ 1M tokens" note={o.index ? `${o.index.observations} paid clearings` : 'no paid clearing yet'} />
        <Tile label="TWAP 1h" value={o.index?.twap1h != null ? rate1m(o.index.twap1h) : '—'} unit="/ 1M" />
        <Tile label="Providers" value={o.nodes.length} note={o.nodes.map((p) => p.label).join(', ') || 'none'} />
        <Tile label="Delivered" value={pct(o.deliveredRate)} note={`${o.paid.length} paid of ${o.settled.length} settled recent jobs`} />
        <Tile label="Context" value="4,000" unit="bytes" note="prompt per job; up to 8,192 tokens" />
      </div>
      <section className="sec">
        <div className="sec-h"><div><h2><Icon name="server" size={17} />Providers</h2><p>Each bid is a rate per 1k tokens from the node's own cost and load.</p></div></div>
        <ProvidersTable providers={o.nodes} />
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2><Icon name="coin" size={17} />Recent paid clearings</h2><p>$ per 1M tokens, newest last.</p></div></div>
        {paid.length ? <div className="card card-pad"><Spark points={paid.map((j) => ({ x: j.createdAt, y: (Number(j.clearedRate) * 1000) / 1e6 }))} height={150} /><p className="note">{paid.length} paid jobs in the latest reads · last paid {money(paid[paid.length - 1].charge)} for {paid[paid.length - 1].tokens} tokens.</p></div>
          : <State kind="empty" art="empty" title="No paid clearing yet">A price shows up after the first auction whose winner delivers.</State>}
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2><Icon name="list" size={17} />Activity</h2></div></div>
        <JobsTable jobs={o.jobs} m={d} now={now} />
      </section>
    </div>
  );
}
