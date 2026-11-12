import { useEffect, type ReactElement } from 'react';
import { usePath, Link, navigate } from './lib/router';
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
import { Bounties } from './pages/Bounties';
import { JobPage } from './pages/JobPage';

type Route = { key: string; nav?: string; title: string; el: ReactElement; bare?: boolean };

function decodeSegment(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

/** Old URLs from the previous layout keep working. */
function alias(p: string): string | null {
  let x: RegExpMatchArray | null;
  if (p === '/app' || p === '/app/nodes') return '/providers';
  if ((x = p.match(/^\/app\/nodes\/([^/]+)$/))) return `/providers/${x[1]}`;
  if (p === '/app/bounties') return '/bounties';
  if (p === '/app/activity' || p === '/activity') return '/rankings#activity';
  if ((x = p.match(/^\/app\/jobs\/(\d+)$/))) return `/jobs/${x[1]}`;
  if (p === '/index') return '/models';
  return null;
}

function route(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/';
  let x: RegExpMatchArray | null;
  if (p === '/') return { key: 'home', title: "Xorv · One API for the AI nobody's using", el: <Landing /> };
  if (p === '/chat') return { key: 'chat', nav: 'chat', title: 'Xorv · Chat', el: <Chat />, bare: true };
  if (p === '/models') return { key: 'models', nav: 'models', title: 'Xorv · Models', el: <Models /> };
  if ((x = p.match(/^\/models\/(.+)$/))) { const id = decodeSegment(x[1]); return id === null ? route('/missing') : { key: `model-${id}`, nav: 'models', title: `Xorv · ${id}`, el: <Model id={id} /> }; }
  if (p === '/providers') return { key: 'providers', nav: 'providers', title: 'Xorv · Providers', el: <Providers /> };
  if (p === '/providers/join') return { key: 'join', nav: 'providers', title: 'Xorv · Become a provider', el: <Join /> };
  if ((x = p.match(/^\/providers\/([^/]+)$/))) { const label = decodeSegment(x[1]); return label === null ? route('/missing') : { key: `prov-${label}`, nav: 'providers', title: `Xorv · ${label}`, el: <Provider label={label} /> }; }
  if (p === '/rankings') return { key: 'rankings', nav: 'rankings', title: 'Xorv · Rankings', el: <Rankings /> };
  if (p === '/bounties') return { key: 'bounties', nav: 'bounties', title: 'Xorv · Bounties', el: <Bounties /> };
  if ((x = p.match(/^\/jobs\/(\d+)$/))) return { key: `job${x[1]}`, nav: 'rankings', title: `Xorv · Job #${x[1]}`, el: <JobPage id={Number(x[1])} /> };
  if (p === '/account') return { key: 'credits', nav: 'account', title: 'Xorv · Credits', el: <Account tab="credits" /> };
  if (p === '/account/usage') return { key: 'usage', nav: 'account', title: 'Xorv · Usage', el: <Account tab="usage" /> };
  if (p === '/keys/x402') return { key: 'x402', nav: 'account', title: 'Xorv · Pay with x402', el: <Account tab="x402" /> };
  if (p === '/keys' || p === '/account/keys') return { key: 'keys', nav: 'account', title: 'Xorv · API keys', el: <Account tab="keys" /> };
  return { key: 'missing', title: 'Xorv · Not found', el: <div className="wrap page"><State kind="empty" title="No page at this address" action={<Link to="/models" className="btn btn-sm">Browse models</Link>}>Xorv has chat, models, providers, rankings, bounties and your account.</State></div> };
}

export function App() {
  const path = usePath();
  const pathname = path.split('?')[0];
  const to = alias(pathname.replace(/\/+$/, ''));
  useEffect(() => { if (to) { history.replaceState(null, '', to); navigate(to); } }, [to]);
  const r = route(to ? to.split('#')[0] : pathname);
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
