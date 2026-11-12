import { useMemo, useState } from 'react';
import { allModels, hostName, indexInputs, modelHost, modelName, queryParam, useMarket } from '../lib/data';
import { Icon, State } from '../components/Ui';
import { PageHead } from '../components/Shell';
import { ClearingsTable, ModelRow, modelOverview } from '../components/Market';
import { usePoll } from '../lib/data';

type Sort = 'jobs' | 'price' | 'latency';

export function Models() {
  const m = useMarket();
  const idx = usePoll(indexInputs, 20000);
  const [q, setQ] = useState(queryParam('q') ?? '');
  const [hosts, setHosts] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('jobs');
  const d = m.data;
  const all = d ? allModels(d) : [];
  const hostList = [...new Set(all.map(modelHost))];
  const list = useMemo(() => {
    if (!d) return [];
    const t = q.trim().toLowerCase();
    const rows = all.filter((x) => (!t || (x + ' ' + modelName(x)).toLowerCase().includes(t)) && (!hosts.length || hosts.includes(modelHost(x)))).map((x) => ({ x, o: modelOverview(x, d) }));
    const key = (r: (typeof rows)[number]) => (r.o.nodes.length ? 0 : 1e13) + (sort === 'jobs' ? -r.o.jobs.length : sort === 'price' ? r.o.last ?? 1e9 : r.o.latencyMs ?? 1e12);
    return rows.sort((a, b) => key(a) - key(b)).map((r) => r.x);
  }, [d, q, hosts, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="wrap page">
      <div className="with-side">
        <aside className="side" aria-label="Filters">
          <div className="side-h">Served through</div>
          {hostList.map((h) => (
            <label className="chk" key={h}><input type="checkbox" checked={hosts.includes(h)} onChange={(e) => setHosts(e.target.checked ? [...hosts, h] : hosts.filter((x) => x !== h))} />{hostName(h + ':')}<small>{all.filter((x) => modelHost(x) === h).length}</small></label>
          ))}
          {!hostList.length && <p className="note" style={{ padding: '0 12px' }}>{d ? 'No providers yet.' : 'Reading…'}</p>}
        </aside>
        <div style={{ minWidth: 0 }}>
          <PageHead title="Models" sub="Priced by what sealed-bid auctions actually cleared at." />
          <div className="toolbar">
            <div className="search"><Icon name="search" size={15} /><input aria-label="Search models" placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <label className="sr" htmlFor="sort">Sort</label>
            <select id="sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="jobs">Most jobs</option>
              <option value="price">Lowest price</option>
              <option value="latency">Fastest delivery</option>
            </select>
          </div>
          {m.error && !d && <State kind="error" art="warning" title="Could not read the contract" action={<button className="btn btn-sm" onClick={m.reload}>Retry</button>}>{m.error}</State>}
          {!d && !m.error && <div className="mlist"><div className="skeleton sk-row" /><div className="skeleton sk-row" /></div>}
          {d && !list.length && <State kind="empty" art="empty" title={all.length ? 'No model matches' : 'No models yet'}>{all.length ? 'Clear the filters to see every model.' : 'A model appears once a staked provider registers to serve it.'}</State>}
          <div className="mlist">{d && list.map((x) => <ModelRow key={x} model={x} m={d} />)}</div>
          <section className="sec" aria-labelledby="h-clear">
            <div className="sec-h"><div><h2 id="h-clear">Every cleared auction</h2><p>A clearing whose winner was slashed doesn't count toward the price.</p></div></div>
            {idx.data ? <ClearingsTable clearings={idx.data.clearings} excluded={idx.data.excluded} /> : idx.error ? <State kind="error" title="Could not read clearings">{idx.error}</State> : <div className="skeleton sk-row" />}
          </section>
        </div>
      </div>
    </div>
  );
}
