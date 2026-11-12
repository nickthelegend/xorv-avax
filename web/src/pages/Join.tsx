import { chain, CONTRACT, near, usePoll } from '../lib/data';
import { CopyButton, State } from '../components/Ui';
import { PageHead, Tile } from '../components/Shell';

const STEPS: { title: string; body: string; cmd: string }[] = [
  { title: 'Get a funded testnet account', body: 'Any NEAR testnet account works; save its key as a credential file. The faucet at near-faucet.io gives testnet NEAR.', cmd: '# .near-credentials/you.json = { "account_id": "you.testnet", "private_key": "ed25519:…" }' },
  { title: 'Create your node and stake', body: 'This creates node.you.testnet holding only a function-call key (bid, reveal, deliver, check, vote), then registers you with your stake. The node can never withdraw your stake or earnings.', cmd: 'node packages/node/dist/cli.js init --owner .near-credentials/you.json \\\n  --roles compute --models groq:openai/gpt-oss-20b --stake 0.15' },
  { title: 'Add your provider key and read the terms', body: 'Put your API key in an .env file (GROQ_API_KEY, OPENROUTER_API_KEY, or OLLAMA_HOST for a local model). Subscription CLIs stay off until you accept that vendor\'s terms.', cmd: 'node packages/node/dist/cli.js terms' },
  { title: 'Start selling', body: 'The node runs your model once as a preflight, then bids on matching jobs at your price per unit. Win, deliver, get paid; get caught lying, lose 10% of stake.', cmd: 'XORV_ENV_FILE=.env node packages/node/dist/cli.js start \\\n  --node .near-credentials/node.you.testnet.json --price 0.01' },
];

const TYPES: [string, string, string][] = [
  ['Local model (Ollama)', 'Always allowed. Check each model\'s licence.', 'https://ollama.com/library'],
  ['API key (Groq, OpenRouter, any OpenAI-compatible)', 'Your key, billed to you.', 'https://groq.com/terms-of-use/'],
  ['Subscription CLI (Claude Code, Codex)', 'Off by default. You are responsible for your plan\'s terms.', 'https://www.anthropic.com/legal/consumer-terms'],
];

/** Become a provider: the real CLI path, with the contract's live staking rules. */
export function Join() {
  const cfg = usePoll(() => chain.config(), 0);
  const c = cfg.data;
  return (
    <div className="wrap page" style={{ maxWidth: 920 }}>
      <PageHead crumbs={[['/providers', 'Providers']]} title="Become a provider" art="gpu" sub="Sell the AI capacity you already pay for, one job at a time. You register from your terminal with your own key." />
      {cfg.error && <State kind="error" art="warning" title="Could not read the contract rules">{cfg.error}</State>}
      {c && (
        <div className="tiles" style={{ marginBottom: 24 }}>
          <Tile label="Minimum stake" value={near(c.min_stake, 3)} unit="NEAR" />
          <Tile label="Slash" value={`${c.slash_bps / 100}%`} note="of stake, when a check catches you" />
          <Tile label="Spot checks" value={`${c.spot_check_bps / 100}%`} note="of jobs, drawn by block seed" />
          <Tile label="Unbonding" value={`${Math.round(c.unbond_ms / 60000)} min`} note="before stake can be withdrawn" />
        </div>
      )}
      <ol className="steps-join" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {STEPS.map((s, i) => {
          const cmd = /--owner|--node/.test(s.cmd) ? `export XORV_CONTRACT=${CONTRACT}\n${s.cmd}` : s.cmd;
          return (
          <li key={s.title} className="jstep">
            <i>{i + 1}</i>
            <div style={{ minWidth: 0 }}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <div className="codebox">
                <div className="codebox-h"><span>terminal</span><CopyButton text={cmd.replace(/\\\n\s+/g, '')} className="btn btn-sm btn-ghost" /></div>
                <pre>{cmd}</pre>
              </div>
            </div>
          </li>
          );
        })}
      </ol>
      <section className="sec">
        <div className="sec-h"><div><h2>What you can sell</h2><p>The node prints each vendor's terms before it enables that provider type.</p></div></div>
        <div className="card card-pad kv">
          {TYPES.map(([t, n, u]) => <div key={t}><span style={{ color: 'var(--ink)' }}>{t}<div className="faint" style={{ fontSize: 13 }}>{n}</div></span><a className="link" href={u} target="_blank" rel="noreferrer">Terms</a></div>)}
        </div>
      </section>
    </div>
  );
}
