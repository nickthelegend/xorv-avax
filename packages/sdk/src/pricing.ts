/** Models the Xorv provider nodes serve on Fuji. Ids carry the upstream provider prefix. */
export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  /** what the model is good at, one short line */
  blurb: string;
}

export const MODELS: ModelInfo[] = [
  { id: 'groq:openai/gpt-oss-20b', name: 'GPT-OSS 20B', vendor: 'OpenAI open weights on Groq', blurb: 'Fast open-weight reasoning model.' },
  { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', vendor: 'OpenAI open weights on Groq', blurb: 'The larger open-weight reasoning model.' },
];

export const modelInfo = (id: string): ModelInfo =>
  MODELS.find((m) => m.id === id) ?? { id, name: id.slice(id.indexOf(':') + 1), vendor: id.split(':')[0], blurb: '' };

/** Default ceiling a chat buyer accepts, in micro-dollars per 1k tokens ($2.00 per 1M tokens). */
export const DEFAULT_MAX_RATE = 2000n;
export const DEFAULT_MAX_TOKENS = 1200;
