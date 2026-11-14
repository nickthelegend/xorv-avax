import { D, money } from '../lib/data';
import { CopyButton } from '../components/Ui';
import { PageHead, Tile } from '../components/Shell';

const STEPS: { title: string; body: string; cmd: string }[] = [
  { title: 'Get the node software', body: 'Clone the repo and install. The CLIs run on Node 22.18+ with pnpm 10 (TypeScript runs natively, nothing to build).', cmd: 'git clone https://github.com/nickthelegend/xorv-avax && cd xorv-avax && pnpm install' },
  { title: 'Make an owner key and a node key', body: 'The owner key stakes, withdraws and receives earnings. The node key only bids, delivers and checks. Both go into ~/.xorv/keys.env (mode 600); only the addresses are printed. Send each a little Fuji test AVAX for gas.', cmd: 'pnpm xorv-node init --label you' },
  { title: 'Stake and register', body: `Draws tUSD from the test faucet if needed, approves the registry and registers your node with ${money(D.config.minStake, 0)} or more of stake and the models it serves. Run it again to top up stake or change models.`, cmd: 'pnpm xorv-node join --label you --stake 5 --models anthropic:claude-haiku-5-5,groq:openai/gpt-oss-20b' },
  { title: 'Add your own model key and start selling', body: 'Put your own ANTHROPIC_API_KEY or GROQ_API_KEY (or OLLAMA_HOST for a local model) in an env file on your machine; the node reads it by name and sends it only to that provider. It runs each model once as a self-check, then bids a sealed rate per 1k tokens from its own cost, margin and load. Win, deliver, get paid; get caught lying, lose stake.', cmd: 'XORV_ENV_FILE=~/anthropic.env XORV_LOG=pretty pnpm xorv-node start --label you --margin 1.2' },
  { title: 'Leave when you want', body: `Unbond the stake (it can still be slashed while unbonding, and the node stops bidding), then withdraw after ${Math.round(D.config.unbondSecs / 60)} minutes.`, cmd: 'pnpm xorv-node leave --label you && pnpm xorv-node withdraw --label you' },
];

/** Become a provider: the real CLI path, with the live rules from the deployment. */
export function Join() {
  const c = D.config;
  return (
    <div className="wrap page" style={{ maxWidth: 920 }}>
      <PageHead crumbs={[['/providers', 'Providers']]} title="Become a provider" art="gpu" sub="Sell AI API capacity you already pay for (Claude, Groq) or a GPU, one sealed bid at a time, with xorv-node and your own keys. Today the market’s nodes are ours; this is how anyone adds one." />
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
          <div><span style={{ color: 'var(--ink)' }}>API key (Anthropic, Claude Haiku 5.5)<div className="faint" style={{ fontSize: 13 }}>Your key, your account, billed to you. Spot checks: a checker’s own Claude reviews the answer (Claude has no temperature 0).</div></span><a className="link" href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noreferrer">Terms</a></div>
          <div><span style={{ color: 'var(--ink)' }}>API key (Groq, GPT-OSS 20B / 120B)<div className="faint" style={{ fontSize: 13 }}>Your key, your account, billed to you. Spot checks re-run at temperature 0.</div></span><a className="link" href="https://console.groq.com/docs/legal/services-agreement" target="_blank" rel="noreferrer">Terms</a></div>
          <div><span style={{ color: 'var(--ink)' }}>Local model (Ollama)<div className="faint" style={{ fontSize: 13 }}>Runs on your machine. Check each model's licence.</div></span><a className="link" href="https://ollama.com/library" target="_blank" rel="noreferrer">Library</a></div>
          <div><span style={{ color: 'var(--ink)' }}>Chat subscriptions (Claude Pro/Max, ChatGPT Plus)<div className="faint" style={{ fontSize: 13 }}>Not supported. Their terms forbid sharing the account and reselling it.</div></span><a className="link" href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noreferrer">Terms</a></div>
        </div>
      </section>
      <section className="sec" id="terms">
        <div className="sec-h"><div><h2>What the terms allow</h2><p>Our reading of the published terms on Nov 14, 2026, not legal advice. You run a node under your own agreement with your provider.</p></div></div>
        <div className="card card-pad terms-card">
          <p><b>Allowed:</b> Anthropic’s Commercial Terms, OpenAI’s Services Agreement and Groq’s Services Agreement all let a customer use the API to power its own product for its own end users, and make the customer responsible for what happens on its account. A Xorv node is that: your key, on your machine, answering one request at a time and delivering the answer on-chain.</p>
          <p><b>Not allowed:</b> sharing or selling your API key or account, and selling a consumer chat subscription. Xorv never takes your key; buyers get answers, not access.</p>
          <p><b>Ask first:</b> Anthropic and Groq forbid reselling their service except as they expressly approve, and Anthropic’s Usage Policy forbids reselling or proxying access through unauthorized means. Whether a paid node counts as resale is their call, so get their approval before running a Claude or Groq node for real money. Today every node is ours, on Fuji, paid in test dollars.</p>
          <p className="faint" style={{ fontSize: 13 }}><a className="link" href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noreferrer">Anthropic Commercial Terms</a> · <a className="link" href="https://www.anthropic.com/legal/aup" target="_blank" rel="noreferrer">Usage Policy</a> · <a className="link" href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noreferrer">Consumer Terms</a> · <a className="link" href="https://openai.com/policies/services-agreement/" target="_blank" rel="noreferrer">OpenAI Services Agreement</a> · <a className="link" href="https://console.groq.com/docs/legal/services-agreement" target="_blank" rel="noreferrer">Groq Services Agreement</a></p>
        </div>
      </section>
    </div>
  );
}
