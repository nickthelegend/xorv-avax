/**
 * Where a node's compute comes from. Model ids carry the provider prefix:
 *   groq:openai/gpt-oss-20b     an API key the operator holds (GROQ_API_KEY)
 *   ollama:qwen2.5:0.5b         a local model (OLLAMA_HOST)
 * Settings are deterministic (temperature 0, fixed seed) so a checker can reproduce a run.
 */
export type Vendor = 'groq' | 'ollama';

export const TERMS: Record<Vendor, { name: string; kind: 'api' | 'local'; links: string[] }> = {
  groq: { name: 'Groq API key', kind: 'api', links: ['https://groq.com/terms-of-use/'] },
  ollama: { name: 'Ollama (local model)', kind: 'local', links: ['https://github.com/ollama/ollama/blob/main/LICENSE'] },
};

export function vendorOf(model: string): Vendor {
  const v = model.split(':')[0] as Vendor;
  if (!(v in TERMS)) throw new Error(`unknown provider prefix in "${model}" (use groq: or ollama:)`);
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
