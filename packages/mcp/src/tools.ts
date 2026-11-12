/**
 * Xorv tools for agents: read the Compute Index and the market, and buy one answer with x402 on Fuji.
 * The buyer key is read by name (XORV_MCP_KEY_NAME, default XORV_BUYER_KEY) and never returned.
 */
import { privateKeyToAccount } from 'viem/accounts';
import { OUTCOME_TEXT, XorvReader, encodePayment, modelInfo, perMillion, signPayment, usd, type PaymentRequirements } from '@xorv/sdk';
import { keyByName, loadDeployment } from '@xorv/sdk/node';

export const TOOLS = [
  {
    name: 'xorv_index',
    description: 'The Xorv Compute Index on Avalanche Fuji: what AI work actually cleared at, per model, in $ per 1M tokens (latest, 1h and 24h TWAP, 24h VWAP with volume). Only paid, checked, competitive auctions count.',
    inputSchema: { type: 'object', properties: {} },
  },
  { name: 'xorv_models', description: 'Models staked provider nodes serve, with the number of nodes and the index price.', inputSchema: { type: 'object', properties: {} } },
  { name: 'xorv_job', description: 'One job on Fuji: status, outcome, bids, winner, cleared rate, tokens, charge, and every transaction.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  {
    name: 'xorv_ask',
    description: 'Buy one answer: pays the Xorv gateway with x402 (an EIP-3009 tUSD signature on Fuji), runs a sealed-bid auction among staked nodes and returns the answer with the settlement transaction. verify=true forces a spot check.',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, model: { type: 'string', description: 'default groq:openai/gpt-oss-20b' }, verify: { type: 'boolean' }, max_tokens: { type: 'number' } }, required: ['prompt'] },
  },
] as const;

export async function runTool(name: string, a: any): Promise<unknown> {
  const d = loadDeployment();
  const r = new XorvReader(d, process.env.XORV_RPC);
  switch (name) {
    case 'xorv_index': {
      const ms = await r.indexModels();
      if (!ms.length) return { empty: true, note: 'No paid, checked clearings yet.' };
      return ms.map((m) => ({ model: m.name, name: modelInfo(m.name).name, index_per_1m: perMillion(m.rate, 4), twap_1h_per_1m: m.twap1h !== null ? perMillion(m.twap1h, 4) : null, twap_24h_per_1m: m.twap24h !== null ? perMillion(m.twap24h, 4) : null, vwap_24h_per_1m: perMillion(m.vwap24h.rate, 4), volume_24h_tokens: m.vwap24h.tokens.toString(), clearings: m.observations, updated: new Date(m.updatedAt * 1000).toISOString(), contract: d.contracts.index }));
    }
    case 'xorv_models': {
      const [ps, idx] = await Promise.all([r.providers(), r.indexModels()]);
      const count = new Map<string, number>();
      for (const p of ps) if (p.unbonding === 0n) for (const m of p.models) count.set(m, (count.get(m) ?? 0) + 1);
      return [...count].map(([id, nodes]) => ({ id, name: modelInfo(id).name, nodes, index_per_1m: (() => { const m = idx.find((x) => x.name === id); return m ? perMillion(m.rate, 4) : null; })() }));
    }
    case 'xorv_job': {
      const id = Number(a.id);
      const [j, ev] = await Promise.all([r.job(id), r.jobEvents(id)]);
      return { ...j, outcome_text: OUTCOME_TEXT[j.outcome], charge_usd: usd(j.charge, 6), cleared_per_1m: perMillion(j.clearedRate, 4), transactions: ev.map((e: any) => ({ event: e.eventName, tx: `https://testnet.snowtrace.io/tx/${e.transactionHash}` })) };
    }
    case 'xorv_ask': {
      const gateway = process.env.XORV_GATEWAY ?? 'http://127.0.0.1:5421';
      const buyer = privateKeyToAccount(keyByName(process.env.XORV_MCP_KEY_NAME ?? 'XORV_BUYER_KEY'));
      const body = { model: a.model ?? 'groq:openai/gpt-oss-20b', messages: [{ role: 'user', content: String(a.prompt) }], max_tokens: Math.min(Number(a.max_tokens ?? 1200), 4096), xorv: { verify: !!a.verify } };
      const url = `${gateway}/v1/chat/completions`;
      const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {
        throw new Error(`Setup required: the Xorv gateway is not running at ${gateway} (pnpm gateway)`);
      });
      const challenge = await first.json();
      if (first.status !== 402) throw new Error(`expected HTTP 402, got ${first.status}: ${JSON.stringify(challenge).slice(0, 300)}`);
      const req: PaymentRequirements = challenge.accepts[0];
      const pay = await signPayment(buyer, req);
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment': encodePayment(pay) }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(out).slice(0, 300)}`);
      return { answer: out.choices?.[0]?.message?.content, job: out.xorv.job, bids: out.xorv.bids, cleared_per_1m: perMillion(out.xorv.cleared_rate_per_1k, 4), tokens: out.usage.total_tokens, paid_max: usd(req.maxAmountRequired, 6), settlement: out.xorv.explorer, payer: buyer.address };
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
