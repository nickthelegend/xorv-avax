import Anthropic from '@anthropic-ai/sdk';

/**
 * Where a node's compute comes from. Model ids carry the provider prefix:
 *   anthropic:claude-haiku-5-5  the operator's own Anthropic API key (ANTHROPIC_API_KEY), under their own Commercial Terms
 *   groq:openai/gpt-oss-20b     the operator's own Groq API key (GROQ_API_KEY)
 *   ollama:qwen2.5:0.5b         a local model (OLLAMA_HOST)
 * Keys stay on the node: buyers get answers, never the key, the account or API access.
 * Groq and Ollama runs are deterministic (temperature 0, fixed seed). Claude Haiku 5.5 accepts no sampling
 * parameters, so its runs are kept short and plain (thinking off, low effort) for the checker's word-overlap test.
 */
export type Vendor = 'anthropic' | 'groq' | 'ollama';

export const TERMS: Record<Vendor, { name: string; kind: 'api' | 'local'; links: string[] }> = {
  anthropic: { name: 'Anthropic API key (your own account, Commercial Terms + Usage Policy)', kind: 'api', links: ['https://www.anthropic.com/legal/commercial-terms', 'https://www.anthropic.com/legal/aup'] },
  groq: { name: 'Groq API key', kind: 'api', links: ['https://groq.com/terms-of-use/'] },
  ollama: { name: 'Ollama (local model)', kind: 'local', links: ['https://github.com/ollama/ollama/blob/main/LICENSE'] },
};

/** The variables a node may read for its provider (from the environment or XORV_ENV_FILE); nothing else is passed on. */
export const PROVIDER_VARS = ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'OLLAMA_HOST'];

export function vendorOf(model: string): Vendor {
  const v = model.split(':')[0] as Vendor;
  if (!(v in TERMS)) throw new Error(`unknown provider prefix in "${model}" (use anthropic:, groq: or ollama:)`);
  return v;
}
const nameOf = (model: string) => model.slice(model.indexOf(':') + 1);

export interface RunResult {
  text: string;
  /** prompt + completion tokens as the upstream provider counted them */
  tokens: number;
}

const MAX_OUTPUT_BYTES = 6000;

/** Trims to the contract's 6,000-byte output limit without splitting a UTF-8 character. */
export function clampOutput(s: string): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= MAX_OUTPUT_BYTES) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (enc.encode(s.slice(0, mid)).length <= MAX_OUTPUT_BYTES) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}

export async function runModel(model: string, prompt: string, opts: { maxTokens: number; timeoutMs?: number }): Promise<RunResult> {
  const vendor = vendorOf(model);
  const name = nameOf(model);
  const timeoutMs = opts.timeoutMs ?? 90_000;
  if (vendor === 'ollama') {
    const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
    const r = await fetch(`${host}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name, stream: false, messages: [{ role: 'user', content: prompt }], options: { temperature: 0, seed: 42, num_predict: opts.maxTokens } }),
    }).catch((e) => {
      throw new Error(`Ollama not reachable at ${host}: ${e.message}`);
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return { text: clampOutput(String(j.message?.content ?? '').trim()), tokens: Number(j.prompt_eval_count ?? 0) + Number(j.eval_count ?? 0) };
  }
  if (vendor === 'anthropic') return runClaude(name, prompt, opts.maxTokens, timeoutMs);
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('Setup required: GROQ_API_KEY');
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: name,
        temperature: 0,
        seed: 42,
        max_tokens: opts.maxTokens,
        messages: [{ role: 'user', content: prompt }],
        ...(/gpt-oss/.test(name) ? { reasoning_effort: 'low' } : {}),
      }),
    });
    const body = await r.json().catch(() => ({}));
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise((res) => setTimeout(res, 3000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`Groq HTTP ${r.status}: ${String(body?.error?.message ?? JSON.stringify(body)).slice(0, 200)}`);
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error(`empty completion from ${name}`);
    return { text: clampOutput(text.trim()), tokens: Number(body.usage?.total_tokens ?? 0) };
  }
}

let claude: Anthropic | null = null;
const CLAUDE_SYSTEM = 'Answer directly and plainly in the length the question asks for. No preamble, no headings, no lists unless asked.';

async function runClaude(name: string, prompt: string, maxTokens: number, timeoutMs: number): Promise<RunResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Setup required: ANTHROPIC_API_KEY');
  claude ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  let msg: Anthropic.Message;
  try {
    msg = await claude.messages.create(
      { model: name, max_tokens: maxTokens, system: CLAUDE_SYSTEM, thinking: { type: 'disabled' }, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] } as Anthropic.MessageCreateParamsNonStreaming,
      { timeout: timeoutMs },
    );
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new Error(`Anthropic HTTP ${e.status ?? '?'}: ${String(e.message).slice(0, 200)}`);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new Error(`${name} declined this request (refusal)`);
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  if (!text) throw new Error(`empty completion from ${name}`);
  return { text: clampOutput(text), tokens: msg.usage.input_tokens + msg.usage.output_tokens };
}

/** Vendors with no deterministic mode: a checker cannot reproduce their text word for word. */
export const NONDETERMINISTIC = new Set<Vendor>(['anthropic']);

const REVIEW = (prompt: string, answer: string) =>
  `You are a spot checker on a compute market. Another node was paid to answer the question below. Decide only whether its answer is honest work.\n\n<question>\n${prompt}\n</question>\n\n<answer>\n${answer}\n</answer>\n\n` +
  'Reply with exactly the word AGREE if the answer is a genuine, on-topic attempt that a careful expert would accept as reasonable, even if you would word it differently, ' +
  'emphasise other points, or it questions the premise of the question. ' +
  'Reject only junk, filler, off-topic text, a refusal to engage, or a clear factual error. If you reject it, reply with your own answer to the question and nothing else.';

/**
 * A spot check. Deterministic models are simply re-run (the contract then scores the word overlap). Claude
 * accepts no temperature or seed, so two honest runs rarely share half their words; a Claude checker instead
 * runs its own Claude on the question plus the delivered answer. If its model agrees, the check submits the
 * delivered text (the contract scores 100%); if not, it submits its model's own answer (junk scores ~0%).
 */
export async function checkModel(model: string, prompt: string, delivered: string, opts: { maxTokens: number }): Promise<RunResult & { reviewed: boolean; agreed?: boolean }> {
  if (!NONDETERMINISTIC.has(vendorOf(model))) return { ...(await runModel(model, prompt, opts)), reviewed: false };
  const r = await runModel(model, REVIEW(prompt, delivered), opts);
  const agreed = /^AGREE\.?$/i.test(r.text.trim());
  // the model's own answer, without a leading verdict word some replies start with
  const own = r.text.replace(/^\s*(DISAGREE|REJECT(ED)?)\b[.:]?\s*/i, '').trim() || r.text;
  return { text: agreed ? delivered : own, tokens: r.tokens, reviewed: true, agreed };
}
