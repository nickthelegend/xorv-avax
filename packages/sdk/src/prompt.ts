export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export class PromptError extends Error {}

export const MAX_PROMPT_BYTES = 4000;

/**
 * One job carries one prompt. A chat becomes a transcript with the newest turns kept, trimmed to the
 * contract's 4,000-byte limit. The last turn must be the user's.
 */
export function packPrompt(messages: ChatMessage[]): string {
  const ms = messages.filter((m) => m && typeof m.content === 'string' && m.content.trim());
  if (!ms.length || ms[ms.length - 1].role !== 'user') throw new PromptError('the last message must be from the user');
  const enc = new TextEncoder();
  if (ms.length === 1) {
    const only = ms[0].content.trim();
    if (enc.encode(only).length > MAX_PROMPT_BYTES) throw new PromptError(`the message is longer than ${MAX_PROMPT_BYTES} bytes`);
    return only;
  }
  const label = (r: string) => (r === 'assistant' ? 'Assistant' : r === 'system' ? 'System' : 'User');
  const lines: string[] = [];
  let size = 0;
  for (let i = ms.length - 1; i >= 0; i--) {
    const line = `${label(ms[i].role)}: ${ms[i].content.trim()}`;
    const n = enc.encode(line).length + 2;
    if (size + n > MAX_PROMPT_BYTES - 40) {
      if (i === ms.length - 1) throw new PromptError(`the message is longer than ${MAX_PROMPT_BYTES} bytes`);
      break;
    }
    lines.unshift(line);
    size += n;
  }
  return `${lines.join('\n\n')}\n\nAssistant:`;
}
