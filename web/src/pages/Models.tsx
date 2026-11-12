import { useMemo, useState } from 'react';
import { allModels, hostName, modelName, queryParam, servedModels, useMarket } from '../lib/data';
import { Icon, State } from '../components/Ui';
import { PageHead } from '../components/Shell';
import { ModelRow, modelOverview } from '../components/Market';

type Sort = 'served' | 'price' | 'jobs';

export function Models() {
  const m = useMarket();
  const [q, setQ] = useState(queryParam('q') ?? '');
  const [sort, setSort] = useState<Sort>('served');
  const d = m.data;
  const all = d ? allModels(d) : [];
  const hosts = [...new Set(all.map((x) => x.split(':')[0]))];
  const [only, setOnly] = useState<string[]>([]);
  const list = useMemo(() => {
    if (!d) return [];
    const t = q.trim().toLowerCase();
    const served = servedModels(d);
    const rows = all.filter((x) => (!t || (x + ' ' + modelName(x)).toLowerCase().includes(t)) && (!only.length || only.includes(x.split(':')[0]))).map((x) => ({ x, o: modelOverview(x, d) }));
    const key = (r: (typeof rows)[number]) => (sort === 'price' ? Number(r.o.index?.rate ?? 1e12) : sort === 'jobs' ? -r.o.jobs.length : -(served.get(r.x)?.length ?? 0));
    return rows.sort((a, b) => key(a) - key(b)).map((r) => r.x);
  }, [d, q, only, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="wrap page">
      <div className="with-side">
        <aside className="side" aria-label="Filters">
          <div className="side-h">Served through</div>
          {hosts.map((h) => (
            <label className="chk" key={h}><input type="checkbox" checked={only.includes(h)} onChange={(e) => setOnly(e.target.checked ? [...only, h] : only.filter((x) => x !== h))} />{hostName(h + ':')}<small>{all.filter((x) => x.startsWith(h + ':')).length}</small></label>
          ))}
          {!hosts.length && <p className="note" style={{ padding: '0 12px' }}>{d ? 'No providers yet.' : 'Reading…'}</p>}
        </aside>
        <div style={{ minWidth: 0 }}>
          <PageHead title="Models" sub="Priced by what sealed-bid auctions actually cleared at, not a list price." />
          <div className="toolbar">
            <div className="search"><Icon name="search" size={15} /><input aria-label="Search models" placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <label className="sr" htmlFor="sort">Sort</label>
            <select id="sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="served">Most providers</option>
              <option value="price">Lowest index price</option>
              <option value="jobs">Most recent jobs</option>
            </select>
          </div>
          {m.error && !d && <State kind="error" art="warning" title="Could not read Fuji" action={<button className="btn btn-sm" onClick={m.reload}>Retry</button>}>{m.error}</State>}
          {!d && !m.error && <div className="mlist"><div className="skeleton sk-row" /><div className="skeleton sk-row" /></div>}
          {d && !list.length && <State kind="empty" art="empty" title={all.length ? 'No model matches' : 'No models yet'}>{all.length ? 'Clear the filters to see every model.' : 'A model appears once a staked provider registers to serve it.'}</State>}
          <div className="mlist">{d && list.map((x) => <ModelRow key={x} model={x} m={d} />)}</div>
        </div>
      </div>
    </div>
  );
}
