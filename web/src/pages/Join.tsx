import { D, money } from '../lib/data';
import { CopyButton } from '../components/Ui';
import { PageHead, Tile } from '../components/Shell';

const STEPS: { title: string; body: string; cmd: string }[] = [
  { title: 'Create an owner and a node key', body: 'The owner key stakes and withdraws. The node key only bids, delivers and checks. Keys go into the gitignored .env by name; nothing prints them.', cmd: 'pnpm install && node scripts/keys.ts' },
  { title: 'Stake and register', body: `Draws tUSD from the faucet if needed, approves the registry and registers your node with ${money(D.config.minStake, 0)} or more of stake and the models it serves.`, cmd: 'XORV_NETWORK=fuji node scripts/setup-providers.ts' },
  { title: 'Add your model key', body: 'Put GROQ_API_KEY (or OLLAMA_HOST for a local model) in an env file. The node runs each model once as a self-check and never bids on one that fails.', cmd: 'export XORV_ENV_FILE=/path/to/.env' },
  { title: 'Start selling', body: 'Your node bids a sealed rate per 1k tokens from its own cost, margin and load. Win, deliver, get paid; get caught lying, lose stake.', cmd: 'node packages/node/src/cli.ts start --label atlas --margin 1.2' },
];

/** Become a provider: the real CLI path, with the live rules from the deployment. */
export function Join() {
  const c = D.config;
  return (
    <div className="wrap page" style={{ maxWidth: 920 }}>
      <PageHead crumbs={[['/providers', 'Providers']]} title="Become a provider" art="gpu" sub="Sell AI capacity you already pay for, one sealed bid at a time. You register from your terminal with your own keys." />
      <div className="tiles" style={{ marginBottom: 24 }}>
        <Tile label="Minimum stake" value={money(c.minStake, 0)} note="tUSD on Fuji" />
        <Tile label="Slash" value={`${c.slashBps / 100}%`} note="of stake, when a tiebreaker contradicts you" />
        <Tile label="Spot checks" value={`${c.spotCheckBps / 100}%`} note="of deliveries, from the delivery block hash" />
        <Tile label="Unbonding" value={`${Math.round(c.unbondSecs / 60)} min`} note="before stake can be withdrawn" />
      </div>
      <ol className="steps-join" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {STEPS.map((s, i) => (
          <li key={s.title} className="jstep">
            <i>{i + 1}</i>
            <div style={{ minWidth: 0 }}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <div className="codebox">
                <div className="codebox-h"><span>terminal</span><CopyButton text={s.cmd} className="btn btn-sm btn-ghost" /></div>
                <pre>{s.cmd}</pre>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <section className="sec">
        <div className="sec-h"><div><h2>What you can sell</h2></div></div>
        <div className="card card-pad kv">
          <div><span style={{ color: 'var(--ink)' }}>API key (Groq)<div className="faint" style={{ fontSize: 13 }}>Your key, billed to you.</div></span><a className="link" href="https://groq.com/terms-of-use/" target="_blank" rel="noreferrer">Terms</a></div>
          <div><span style={{ color: 'var(--ink)' }}>Local model (Ollama)<div className="faint" style={{ fontSize: 13 }}>Runs on your machine. Check each model's licence.</div></span><a className="link" href="https://ollama.com/library" target="_blank" rel="noreferrer">Library</a></div>
        </div>
      </section>
    </div>
  );
}
