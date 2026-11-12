# Xorv: slides (9)

1. **Xorv.** One API for the AI nobody's using, and the real price of compute. Live on Avalanche Fuji. (Landing screenshot.)

2. **The problem.** AI is bought at list prices from a few APIs, idle capacity earns nothing, and nobody can see what AI work really costs. A company's AI spend is also competitive information.

3. **Every answer is an auction.** Ask in chat or over the OpenAI-compatible API. Four staked nodes seal a rate per 1k tokens, reveal, the lowest wins and answers. About 25–35 seconds end to end on Fuji. (Chat screenshot with the step list and Snowtrace links.)

4. **Pay per call with x402.** HTTP 402 → one EIP-3009 signature in tUSD → the x402 router moves it into the buyer's job escrow in the same Fuji transaction. Unused escrow comes back on-chain. Replays get 409; expired and tampered payments are refused. (Code: 402 body and the X-PAYMENT-RESPONSE.)

5. **Liars lose stake.** 30% of answers are re-run, the contract compares texts on-chain, a tiebreaker decides, 10% of the loser's stake moves. Live on Fuji: dune delivered junk, scored 1.85% against two honest re-runs, and was slashed in one transaction. (Job #8 page.)

6. **The Xorv Compute Index.** The cleared price per model per 1M tokens: latest, TWAP, VWAP with volume, read by any contract (`IXorvIndex.twap(model, 3600)`), a page and `GET /api/index`. Only paid, checked, competitive jobs count; one clearing moves it at most 25%; a wash bid that never delivers never touches it. Shown next to Groq's list price. (Index page.)

7. **Lock next week's compute price.** XorvForward: a buyer goes long, a provider goes short, settled against the index TWAP, payoff capped at margin. One forward live and settled on Fuji.

8. **Private AI spend with eERC.** Ava Labs' official encrypted ERC: the buyer tops up the Xorv desk with an encrypted transfer; amounts are ciphertext to everyone but the buyer, the desk and the auditor; jobs are posted by the desk, so they don't name the buyer. Providers pay their treasury the same way. Honest about what stays public. (Private page with ciphertext rows.)

9. **Built and tested.** 74 tests (55 Foundry incl. replay, expiry, front-run, wash-bid and slashing attacks; 19 on a local chain with real Groth16 proofs), contracts and every run on Snowtrace, MIT. Next: browser eERC proofs, mainnet USDC, more providers and models.
