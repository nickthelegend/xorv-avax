# Xorv: slides (9)

1. **Xorv.** Every AI request goes to the lowest bidder. Pay per message; the price becomes an on-chain index. Live on Avalanche Fuji. (Landing screenshot.)

2. **The problem.** AI is bought at list prices from a few APIs, idle capacity earns nothing, and nobody can see what AI work really costs. A company's AI spend is also competitive information.

3. **Every answer is an auction.** Open the hosted app with nothing installed: one tap makes a test wallet and the gas station funds it. Ask in chat or over the OpenAI-compatible API. Four staked nodes seal a rate per 1k tokens, reveal, the lowest wins and answers. About 25–35 seconds end to end on Fuji. (Chat screenshot with the step list and Snowtrace links.)

4. **Pay per call with x402.** HTTP 402 → one EIP-3009 signature in tUSD → the x402 router moves it into the buyer's job escrow in the same Fuji transaction. Unused escrow comes back on-chain. Replays get 409; expired and tampered payments are refused. (Code: 402 body and the X-PAYMENT-RESPONSE.)

5. **Liars lose stake.** 30% of answers are re-run, the contract compares texts on-chain, a tiebreaker decides, 10% of the loser's stake moves. Live on Fuji: dune delivered junk, scored 1.85% against two honest re-runs, and was slashed in one transaction. (Job #8 page.)

6. **The Xorv Compute Index.** The cleared price per model per 1M tokens: latest, TWAP, VWAP with volume, read by any contract (`IXorvIndex.twap(model, 3600)`), a page and `GET /api/index`. Only paid, checked, competitive jobs count; one clearing moves it at most 25%; a wash bid that never delivers never touches it. Shown next to Groq's list price. (Index page.)

7. **Lock next week's compute price.** XorvForward: a buyer goes long, a provider goes short, settled against the index TWAP, payoff capped at margin. One forward live and settled on Fuji.

8. **Private AI spend with eERC.** Ava Labs' official encrypted ERC: the buyer tops up the Xorv desk with an encrypted transfer; amounts are ciphertext to everyone but the buyer, the desk and the auditor; the proofs are made in the buyer's browser with Ava Labs' eERC SDK; jobs are posted by the desk, so they don't name the buyer. The desk signs a receipt of its ledger and the browser checks every line on Fuji, down to each top-up amount against the buyer's own proof. Honest about what stays public. (Account → Private credit with the five green checks.)

9. **Built and tested.** 99 tests (79 Foundry incl. replay, expiry, front-run, wash-bid, slashing and gas-station abuse; 20 on a local chain with real Groth16 proofs and forged desk receipts), plus the judge path run in a fresh browser on the hosted app. Contracts and every run on Snowtrace, MIT. Next: mainnet USDC, more providers and models, a desk ledger others can audit without the buyer.
