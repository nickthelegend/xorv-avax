/** Models the Xorv provider nodes serve on Fuji. Ids carry the upstream provider prefix (anthropic:, groq:, ollama:). */
export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  /** what the model is good at, one short line */
  blurb: string;
  /** the upstream list price per 1M tokens, as published (USD) */
  list?: { input: number; output: number; source: string; checked: string };
}

export const MODELS: ModelInfo[] = [
  { id: 'anthropic:claude-haiku-5-5', name: 'Claude Haiku 5.5', vendor: 'Anthropic API', blurb: "Anthropic's fast Claude model, served by nodes that bring their own Anthropic API key.", list: { input: 0.1, output: 0.5, source: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: '2026-11-14' } },
  { id: 'groq:openai/gpt-oss-20b', name: 'GPT-OSS 20B', vendor: 'OpenAI open weights on Groq', blurb: 'Fast open-weight reasoning model.', list: { input: 0.075, output: 0.3, source: 'https://console.groq.com/docs/model/openai/gpt-oss-20b', checked: '2026-11-12' } },
  { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', vendor: 'OpenAI open weights on Groq', blurb: 'The larger open-weight reasoning model.', list: { input: 0.15, output: 0.6, source: 'https://console.groq.com/docs/model/openai/gpt-oss-120b', checked: '2026-11-12' } },
];

/**
 * Claude has no temperature 0, so a Claude spot check is a review: the checker's own Claude reads the question and the
 * delivered answer and either agrees (the delivered text is submitted) or writes its own answer. Other models are re-run.
 */
export const reviewedCheck = (id: string) => id.startsWith('anthropic:');

export const modelInfo = (id: string): ModelInfo =>
  MODELS.find((m) => m.id === id) ?? { id, name: id.slice(id.indexOf(':') + 1), vendor: id.split(':')[0], blurb: '' };

/** Default ceiling a chat buyer accepts, in micro-dollars per 1k tokens ($2.00 per 1M tokens). */
export const DEFAULT_MAX_RATE = 2000n;
export const DEFAULT_MAX_TOKENS = 1200;
