import { D, money } from '../lib/data';
import { CopyButton } from '../components/Ui';
import { PageHead, Tile } from '../components/Shell';

const STEPS: { title: string; body: string; cmd: string }[] = [
  { title: 'Get the node software', body: 'Clone the repo and install. The CLIs run on Node 22.18+ with pnpm 10 (TypeScript runs natively, nothing to build).', cmd: 'git clone https://github.com/nickthelegend/xorv-avax && cd xorv-avax && pnpm install' },
  { title: 'Make an owner key and a node key', body: 'The owner key stakes, withdraws and receives earnings. The node key only bids, delivers and checks. Both go into ~/.xorv/keys.env (mode 600); only the addresses are printed. Send each a little Fuji test AVAX for gas.', cmd: 'pnpm xorv-node init --label you' },
  { title: 'Stake and register', body: `Draws tUSD from the test faucet if needed, approves the registry and registers your node with ${money(D.config.minStake, 0)} or more of stake and the models it serves. Run it again to top up stake or change models.`, cmd: 'pnpm xorv-node join --label you --stake 5 --models groq:openai/gpt-oss-20b' },
  { title: 'Add your model key and start selling', body: 'Put GROQ_API_KEY (or OLLAMA_HOST for a local model) in an env file. The node runs each model once as a self-check, then bids a sealed rate per 1k tokens from its own cost, margin and load. Win, deliver, get paid; get caught lying, lose stake.', cmd: 'XORV_ENV_FILE=/path/to/.env XORV_LOG=pretty pnpm xorv-node start --label you --margin 1.2' },
  { title: 'Leave when you want', body: `Unbond the stake (it can still be slashed while unbonding, and the node stops bidding), then withdraw after ${Math.round(D.config.unbondSecs / 60)} minutes.`, cmd: 'pnpm xorv-node leave --label you && pnpm xorv-node withdraw --label you' },
];

/** Become a provider: the real CLI path, with the live rules from the deployment. */
export function Join() {
  const c = D.config;
  return (
    <div className="wrap page" style={{ maxWidth: 920 }}>
      <PageHead crumbs={[['/providers', 'Providers']]} title="Become a provider" art="gpu" sub="Sell AI capacity you already pay for (an API plan or a GPU), one sealed bid at a time, with xorv-node and your own keys. Today the market’s nodes are ours; this is how anyone adds one." />
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
