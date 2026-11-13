// Offload one AI request to the Xorv market on Avalanche Fuji, paid per call with x402.
// Run: node --env-file ~/.xorv/keys.env examples/offload.ts   (xorv wallet new && xorv fund make the wallet)
import { Xorv } from '@xorv/sdk';
import { privateKeyToAccount } from 'viem/accounts';

const xorv = new Xorv({ account: privateKeyToAccount(process.env.XORV_WALLET_KEY as `0x${string}`) });

const r = await xorv.chat('In two sentences: what makes a sealed-bid auction fair?', { verify: true });

console.log(r.text);
console.log(`job #${r.job} · ${r.bids} sealed bids · ${r.tokens} tokens · ${r.settlement}`);
