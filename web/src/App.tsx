import { useEffect, type ReactElement } from 'react';
import { usePath, Link } from './lib/router';
import { State } from './components/Ui';
import { Footer, Header } from './components/Shell';
import { Landing } from './pages/Landing';
import { Chat } from './pages/Chat';
import { Models } from './pages/Models';
import { Model } from './pages/Model';
import { Providers, Provider } from './pages/Providers';
import { Join } from './pages/Join';
import { Rankings } from './pages/Rankings';
import { Account } from './pages/Account';
import { JobPage } from './pages/JobPage';
import { IndexPage } from './pages/IndexPage';
import { Private } from './pages/Private';

type Route = { key: string; nav?: string; title: string; el: ReactElement; bare?: boolean };

function decodeSegment(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

function route(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/';
  let x: RegExpMatchArray | null;
  if (p === '/') return { key: 'home', title: "Xorv · One API for the AI nobody's using", el: <Landing /> };
  if (p === '/chat') return { key: 'chat', nav: 'chat', title: 'Xorv · Chat', el: <Chat />, bare: true };
  if (p === '/index') return { key: 'index', nav: 'index', title: 'Xorv · Compute Index', el: <IndexPage /> };
  if (p === '/models') return { key: 'models', nav: 'models', title: 'Xorv · Models', el: <Models /> };
  if ((x = p.match(/^\/models\/(.+)$/))) { const id = decodeSegment(x[1]); return id === null ? route('/missing') : { key: `model-${id}`, nav: 'models', title: `Xorv · ${id}`, el: <Model id={id} /> }; }
  if (p === '/providers') return { key: 'providers', nav: 'providers', title: 'Xorv · Providers', el: <Providers /> };
  if (p === '/providers/join') return { key: 'join', nav: 'providers', title: 'Xorv · Become a provider', el: <Join /> };
  if ((x = p.match(/^\/providers\/([^/]+)$/))) { const label = decodeSegment(x[1]); return label === null ? route('/missing') : { key: `prov-${label}`, nav: 'providers', title: `Xorv · ${label}`, el: <Provider label={label} /> }; }
  if (p === '/rankings') return { key: 'rankings', nav: 'rankings', title: 'Xorv · Rankings', el: <Rankings /> };
  if ((x = p.match(/^\/jobs\/(\d+)$/))) return { key: `job${x[1]}`, nav: 'rankings', title: `Xorv · Job #${x[1]}`, el: <JobPage id={Number(x[1])} /> };
  if (p === '/private') return { key: 'private', nav: 'private', title: 'Xorv · Private credit', el: <Private /> };
  if (p === '/account') return { key: 'account', nav: 'account', title: 'Xorv · Account', el: <Account tab="wallet" /> };
  if (p === '/account/private') return { key: 'account-private', nav: 'account', title: 'Xorv · Private credit', el: <Account tab="private" /> };
  return { key: 'missing', title: 'Xorv · Not found', el: <div className="wrap page"><State kind="empty" art="empty" title="No page at this address" action={<Link to="/models" className="btn btn-sm">Browse models</Link>}>Xorv has chat, models, the compute index, providers, rankings and your account.</State></div> };
}

export function App() {
  const path = usePath();
  const pathname = path.split('?')[0];
  const r = route(pathname);
  useEffect(() => { document.title = r.title; }, [r.title]);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header active={r.nav} />
      <main id="main" className={r.bare ? '' : 'app-main'} key={`${r.key}:${location.search}`}>{r.el}</main>
      {!r.bare && <Footer />}
    </>
  );
}
