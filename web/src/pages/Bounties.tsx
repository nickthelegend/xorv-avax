import { useEffect, useRef, useState } from 'react';
import { ago, CONTRACT, hhmm, longDay, near, short, useMarket, useNow } from '../lib/data';
import { dryQuotes } from '../lib/evidence';
import { Link } from '../lib/router';
import { CopyButton, Icon, State } from '../components/Ui';
import { PageHead, Tag } from '../components/Shell';
import { StatusTag } from '../components/Market';

const CMD = `export XORV_CONTRACT=${CONTRACT}
node packages/node/dist/cli.js post bounty \\
  --buyer .near-credentials/you.json \\
  --repo <git url> --commit <sha> \\
  --issue "what is broken" --tests ./hidden-tests \\
  --test-cmd "node --test" --reward 0.2 --bond 0.05 --auto-reveal`;

function PostSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', key); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="sheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="post-h" tabIndex={-1} ref={ref}>
        <div className="sheet-head"><span className="lbl">Post a bounty · NEAR testnet</span><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button></div>
        <h2 className="sheet-q" id="post-h">Post a bug bounty</h2>
        <p className="sheet-sub">You commit to a hidden test by hash, solvers commit sealed patches, three staked verifiers drawn by block seed run the test, and the earliest patch with a pass majority is paid. The page is read-only, so posting happens from your terminal with a funded buyer key.</p>
        <div className="sheet-cmd">
          <div className="sheet-cmd-h"><span className="lbl">Command</span><CopyButton text={CMD.replace(/\\\n\s+/g, '')} /></div>
          <pre className="cmd">{CMD}</pre>
        </div>
      </div>
    </div>
  );
}

/** Jobs-board style list of bug bounties, with the Agent Market and NEAR Intents funding beside it. */
export function Bounties() {
  const m = useMarket();
  const now = useNow(5000);
  const [post, setPost] = useState(false);
  const d = m.data;
  const list = (d?.jobs ?? []).filter((j) => j.kind === 'bounty').sort((a, b) => b.id - a.id);
  const chainNow = d ? d.stats.now_ms + (now - m.at) : now;
  return (
    <div className="wrap page">
      <PageHead title="Bounties" sub="Bug bounties checked by a staked swarm: hidden tests, sealed patches, verifiers drawn by block seed. Agent Market assignments land here too once the bridge is listed." actions={<button className="btn btn-w" onClick={() => setPost(true)}>Post a bounty</button>} />
      <div className="rail-layout">
        <section aria-label="Open and settled bounties">
          {m.error && !d && <State kind="error" art="warning" title="Could not read the contract" action={<button className="btn btn-sm" onClick={m.reload}>Retry</button>}>{m.error}</State>}
          {!d && !m.error && <div className="bounty skeleton" />}
          {d && !list.length && <State kind="empty" art="empty" title="No bounties posted yet" action={<button className="btn btn-sm" onClick={() => setPost(true)}>Post the first one</button>}>Bounties appear here as soon as one is posted on the contract.</State>}
          <div className="bounties">
            {list.map((j) => {
              const f = d!.full.get(j.id);
              return (
                <article className="bounty" key={j.id}>
                  <div className="bounty-top">
                    <span className="bounty-ic" aria-hidden="true"><Icon name="bug" size={20} /></span>
                    <div className="bounty-h">
                      <Link to={`/jobs/${j.id}`} className="bounty-title">{j.title}</Link>
                      <p>Posted by {short(j.buyer)} · {longDay(j.created_ms)} {hhmm(j.created_ms)} UTC · {ago(j.created_ms, chainNow)}</p>
                    </div>
                    <div className="bounty-pay"><b>{near(j.reward, 3)}</b><small>NEAR reward</small></div>
                  </div>
                  {f && <p className="bounty-issue">{f.issue}</p>}
                  <div className="bounty-tags">
                    <StatusTag j={j} m={d!} />
                    <Tag tone="dim">{j.patches} sealed patch{j.patches === 1 ? '' : 'es'}</Tag>
                    {f && <Tag tone="dim">{f.verifiers.length} verifiers</Tag>}
                    {f && <Tag tone={f.test_files ? 'ok' : 'dim'}>{f.test_files ? 'Hidden test revealed · hash matched' : 'Hidden test sealed'}</Tag>}
                    {f && <Tag tone="dim">bond {near(f.bond, 3)} NEAR</Tag>}
                    {j.slashes > 0 && <Tag tone="bad">{j.slashes} verifier slashed</Tag>}
                  </div>
                  <div className="bounty-foot">
                    {f && <span className="mono-c dim-c">$ {f.test_cmd} · {f.repo_commit.slice(0, 10)}</span>}
                    <Link to={`/jobs/${j.id}`} className="btn btn-sm">View patches and votes <Icon name="arrow" size={14} /></Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <aside className="rail" aria-label="Sources">
          <section className="card">
            <header className="card-h"><h2>Agent Market</h2><Tag tone="bad">Setup required</Tag></header>
            <p className="note">A bridge turns each market.near.ai assignment into a Xorv job and submits the checked result. Listing needs Nick's market account: <code>XORV_MARKET_TOKEN</code>. Until then no assignments are shown, and none are invented.</p>
          </section>
          <section className="card">
            <header className="card-h"><h2>Fund from any chain</h2><Tag tone="info">NEAR Intents · 1Click</Tag></header>
            <p className="note">Buyers can price a bounty in USDC on Base. Intents has no testnet, so these are recorded <code>dry: true</code> quotes; no deposit address, nothing moved.</p>
            <ul className="kvlist">
              {dryQuotes.map((q) => <li key={q.correlationId}><span>{q.from}</span><b className="mono-c">{q.to.replace(/\.(\d{2})\d+/, '.$1')}</b></li>)}
              {dryQuotes[0] && <li><span>Quoted</span><b className="mono-c">{dryQuotes[0].timestamp.slice(0, 16).replace('T', ' ')} UTC</b></li>}
            </ul>
          </section>
        </aside>
      </div>
      {post && <PostSheet onClose={() => setPost(false)} />}
    </div>
  );
}
