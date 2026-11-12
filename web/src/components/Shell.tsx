import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { C, addrUrl, allModels, jobTitle, modelName, modelUrl, short, useMarket } from '../lib/data';
import { Link, navigate } from '../lib/router';
import { useWallet } from '../lib/wallet';
import { Art, Icon, Wordmark, type ArtName } from './Ui';

export const NAV = [
  { key: 'models', to: '/models', label: 'Models' },
  { key: 'chat', to: '/chat', label: 'Chat' },
  { key: 'index', to: '/index', label: 'Index' },
  { key: 'rankings', to: '/rankings', label: 'Rankings' },
  { key: 'providers', to: '/providers', label: 'Providers' },
  { key: 'private', to: '/private', label: 'Private' },
];

/** Search over the live contracts: models, providers and jobs. ⌘K focuses it. */
export function Search({ onPick, big, placeholder = 'Search' }: { onPick?: () => void; big?: boolean; placeholder?: string }) {
  const m = useMarket();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (big) return;
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [big]);
  const hits = useMemo(() => {
    const d = m.data;
    if (!d || !q.trim()) return [];
    const t = q.trim().toLowerCase().replace(/^#/, '');
    return [
      ...allModels(d).filter((x) => (x + ' ' + modelName(x)).toLowerCase().includes(t)).map((x) => ({ to: modelUrl(x), kind: 'Model', label: modelName(x), sub: x })),
      ...d.providers.filter((p) => (p.label + ' ' + p.node + ' ' + p.owner).toLowerCase().includes(t)).map((p) => ({ to: `/providers/${p.label}`, kind: 'Provider', label: p.label, sub: short(p.node) })),
      ...d.jobs.filter((j) => (jobTitle(d, j) + ' job ' + j.id).toLowerCase().includes(t)).map((j) => ({ to: `/jobs/${j.id}`, kind: 'Job', label: jobTitle(d, j), sub: `#${j.id}` })),
    ].slice(0, 8);
  }, [q, m.data]);
  const go = (to: string) => { setQ(''); setOpen(false); ref.current?.blur(); navigate(to); onPick?.(); };
  return (
    <div className={`search ${big ? 'search-xl' : ''}`}>
      <Icon name="search" size={big ? 18 : 15} />
      <input ref={ref} value={q} placeholder={placeholder} aria-label="Search models, providers and jobs" role="combobox" aria-expanded={open && hits.length > 0} aria-controls={big ? 'sp-big' : 'sp-hdr'} aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setI(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, hits.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); } if (e.key === 'Enter') { if (hits[i]) go(hits[i].to); else if (q.trim()) go(`/models?q=${encodeURIComponent(q.trim())}`); } if (e.key === 'Escape') ref.current?.blur(); }} />
      {!big && <kbd>⌘K</kbd>}
      {open && q.trim() && (
        <ul className="search-pop" role="listbox" id={big ? 'sp-big' : 'sp-hdr'}>
          {hits.length ? hits.map((h, k) => (
            <li key={h.to} role="option" aria-selected={k === i}><button onMouseDown={(e) => e.preventDefault()} onClick={() => go(h.to)} className={k === i ? 'on' : ''}><span className="sp-kind">{h.kind}</span><b>{h.label}</b><small>{h.sub}</small></button></li>
          )) : <li className="sp-none">{m.data ? 'Nothing on the contracts matches.' : 'Reading Fuji…'}</li>}
        </ul>
      )}
    </div>
  );
}

function AccountButton({ onDone }: { onDone?: () => void }) {
  const wallet = useWallet();
  return (
    <Link to="/account" className="btn btn-w btn-sm acct-btn" title={wallet.address ? `${wallet.address} · Avalanche Fuji` : 'Connect a wallet on Avalanche Fuji'}
      onClick={(e) => { onDone?.(); if (!wallet.address) { e.preventDefault(); navigate('/account'); void wallet.connect(); } }}>
      {wallet.address ? short(wallet.address) : wallet.connecting ? 'Connecting…' : 'Connect'}
    </Link>
  );
}

export function Header({ active }: { active?: string }) {
  const [menu, setMenu] = useState(false);
  useEffect(() => { document.body.style.overflow = menu ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [menu]);
  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link to="/" aria-label="Xorv home"><Wordmark /></Link>
        <div className="hdr-search"><Search /></div>
        <nav className="hdr-nav" aria-label="Main">
          {NAV.map((n) => <Link key={n.key} to={n.to} aria-current={active === n.key ? 'page' : undefined}>{n.label}</Link>)}
        </nav>
        <div className="hdr-end">
          <a className="net" href={addrUrl(C.market)} target="_blank" rel="noreferrer" title={`Market ${C.market}`}><i className="live-dot" />Fuji</a>
          <AccountButton />
          <button className="icon-btn hdr-menu" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" size={18} /></button>
        </div>
      </div>
      {menu && (
        <div className="drawer-wrap" onClick={(e) => { if (e.target === e.currentTarget) setMenu(false); }}>
          <div className="drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="drawer-h"><Wordmark /><button className="icon-btn" onClick={() => setMenu(false)} aria-label="Close menu" autoFocus><Icon name="x" size={16} /></button></div>
            <Search onPick={() => setMenu(false)} />
            <nav aria-label="Main">
              {NAV.map((n) => <Link key={n.key} to={n.to} aria-current={active === n.key ? 'page' : undefined} onClick={() => setMenu(false)}>{n.label}<Icon name="chevR" size={16} /></Link>)}
              <Link to="/account" aria-current={active === 'account' ? 'page' : undefined} onClick={() => setMenu(false)}>Account<Icon name="chevR" size={16} /></Link>
            </nav>
            <a className="net" style={{ display: 'inline-flex', alignSelf: 'flex-start' }} href={addrUrl(C.market)} target="_blank" rel="noreferrer"><i className="live-dot" />Avalanche Fuji · {short(C.market)}</a>
          </div>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <span>Xorv on Avalanche Fuji · every number is a read of <a href={addrUrl(C.market)} target="_blank" rel="noreferrer">the market</a>, <a href={addrUrl(C.index)} target="_blank" rel="noreferrer">the index</a> or a recorded transaction. Prices in tUSD test dollars.</span>
        <nav aria-label="Footer">
          <Link to="/providers/join">Become a provider</Link>
          <Link to="/index#api">API</Link>
          <span>MIT · © 2026 Nivesh Gajengi</span>
        </nav>
      </div>
    </footer>
  );
}

/** Page title row: crumbs, title, subtitle, actions on the right. */
export function PageHead({ crumbs, title, sub, actions, art }: { crumbs?: [string, string][]; title: ReactNode; sub?: ReactNode; actions?: ReactNode; art?: ArtName }) {
  return (
    <div className={`ph${art ? ' ph-with-art' : ''}`}>
      <div style={{ minWidth: 0 }}>
        {crumbs && <nav className="crumbs" aria-label="Breadcrumb">{crumbs.map(([to, l]) => <span key={to}><Link to={to}>{l}</Link><Icon name="chevR" size={13} /></span>)}</nav>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {(actions || art) && <div className="ph-actions">{actions}{art && <Art name={art} size={104} className="ph-art" />}</div>}
    </div>
  );
}

/** Stat tile (label, value, caption). Used by the job record. */
export function Kpi({ label, icon, value, unit, note, to }: { label: string; icon: string; value: ReactNode; unit?: string; note?: ReactNode; to?: string }) {
  const body = <><div className="kpi-top"><span>{label}</span><i><Icon name={icon} size={15} /></i></div><b className="kpi-v">{value}{unit && <small> {unit}</small>}</b>{note && <span className="kpi-note">{note}</span>}</>;
  return to ? <Link to={to} className="kpi kpi-link">{body}</Link> : <div className="kpi">{body}</div>;
}

export function Tile({ label, value, unit, note }: { label: string; value: ReactNode; unit?: string; note?: ReactNode }) {
  return <div className="tile"><span>{label}</span><b>{value}{unit && <small> {unit}</small>}</b>{note && <em>{note}</em>}</div>;
}

export function Tag({ tone = 'dim', children }: { tone?: 'ok' | 'bad' | 'live' | 'dim' | 'info'; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function Avatar({ name, big, bad }: { name: string; big?: boolean; bad?: boolean }) {
  return <span className={`avatar ${big ? 'lg' : ''} ${bad ? 'bad' : ''}`} aria-hidden="true">{name.slice(0, 1)}</span>;
}
