import { CLOSED, readJobDetail, useMarket, usePoll } from '../lib/data';
import { Link } from '../lib/router';
import { State } from '../components/Ui';
import { JobView } from '../components/JobView';

export function JobPage({ id }: { id: number }) {
  const m = useMarket();
  const total = m.data?.stats.jobs;
  const exists = total == null || id < total;
  const job = usePoll(() => (exists ? readJobDetail(id) : Promise.resolve(null)), 6000, [id, exists]);
  const live = job.data && !CLOSED.has(job.data.job.status);
  return (
    <div className="wrap page">
      {!exists && <State kind="empty" art="empty" title={`No job #${id}`} action={<Link to="/rankings#activity" className="btn btn-sm">All activity</Link>}>The market has {total} job{total === 1 ? '' : 's'} so far.</State>}
      {exists && job.error && !job.data && <State kind="error" art="warning" title="Could not read this job" action={<button className="btn btn-sm" onClick={job.reload}>Retry</button>}>{job.error}</State>}
      {exists && !job.data && !job.error && <><div className="skeleton sk-row" /><div className="skeleton sk-row" style={{ marginTop: 12 }} /></>}
      {job.data && <JobView d={job.data} m={m.data} />}
      {job.data && job.error && <p className="stale" role="status">Showing the last read. Refresh failed: {job.error}</p>}
      {live && <p className="stale" role="status">Live: this page re-reads the job every few seconds.</p>}
    </div>
  );
}
