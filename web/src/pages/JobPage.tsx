import { useEffect, useRef, useState } from 'react';
import { chain, short, txUrl, usePoll } from '../lib/data';
import { gateway, type Receipts } from '../lib/gateway';
import { recordedTxs } from '../lib/evidence';
import { Link, scrollToId } from '../lib/router';
import { Icon, State } from '../components/Ui';
import { JobView } from '../components/JobView';

export function JobPage({ id }: { id: number }) {
  const job = usePoll(() => chain.job(id), 4000, [id]);
  const stats = usePoll(() => chain.stats(), 4000);
  const jumped = useRef(false);
  const [rc, setRc] = useState<Receipts | null>(null);
  useEffect(() => { gateway.receipts(id).then(setRc).catch(() => setRc(null)); }, [id, job.data?.status]);
  // Real transaction hashes for this job: the recorded Nov 9 run, plus what the gateway and its nodes logged.
  const txs = [
    ...recordedTxs().filter((t) => t.job === id).map((t) => ({ who: t.who, what: t.what, hash: t.hash })),
    ...(rc?.post ? [{ who: short(job.data?.buyer ?? 'buyer'), what: 'post_compute (escrow)', hash: rc.post.tx }] : []),
    ...(rc?.nodes ?? []).map((n) => ({ who: n.node, what: n.event, hash: n.tx })),
  ].filter((t, i, a) => a.findIndex((x) => x.hash === t.hash) === i);
  useEffect(() => {
    // Cards link to #result / #check / #votes; jump once the record has rendered.
    if (job.data && !jumped.current && location.hash) { jumped.current = true; scrollToId(location.hash.slice(1)); }
  }, [job.data]);
  return (
    <div className="wrap page">
      {job.error && !job.data && <State kind="error" title="Could not read this job">{job.error}</State>}
      {job.loading && !job.data && !job.error && <><div className="skeleton sk-row" /><div className="skeleton sk-row" style={{ marginTop: 12 }} /></>}
      {!job.loading && !job.data && !job.error && <State kind="empty" title={`No job ${String(id).padStart(2, '0')}`} action={<Link to="/rankings#activity" className="btn btn-sm">All activity</Link>}>This contract has no job with that id yet.</State>}
      {job.data && <JobView job={job.data} chainNow={stats.data?.now_ms ?? Date.now()} readAt={stats.at || Date.now()} />}
      {job.data && txs.length > 0 && (
        <section className="jsec" aria-label="Transactions">
          <header className="jsec-h"><h2>Transactions</h2><span className="jsec-meta">{txs.length} on NEAR testnet</span></header>
          <div className="card card-pad txs">
            {txs.map((t) => <a key={t.hash} href={txUrl(t.hash)} target="_blank" rel="noreferrer"><span>{t.who}</span><b>{t.what}</b><em>{t.hash.slice(0, 10)}… <Icon name="external" size={11} /></em></a>)}
          </div>
        </section>
      )}
      {job.data && job.error && <p className="stale" role="status">Showing the last read. Refresh failed: {job.error}</p>}
    </div>
  );
}
