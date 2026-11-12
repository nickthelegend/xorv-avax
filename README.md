# Xorv on Avalanche

**One API for the AI nobody's using, and the real price of compute.**

Xorv sells AI answers from idle capacity. Every request is a sealed-bid auction among staked provider nodes on Avalanche Fuji. The buyer pays per call with **x402** (HTTP 402, one EIP-3009 signature, settled in the same Fuji transaction that funds the job's escrow). A random sample of answers is re-run by a second node, and the contract itself compares the texts; a node that lies loses stake. Every paid, checked clearing feeds the **Xorv Compute Index**, an on-chain price per model per 1M tokens that any contract can read. Buyers who don't want competitors reading their AI spend can pay from an **eERC** encrypted balance instead, with an auditor key for compliance. A **compute forward** lets a buyer lock next week's price against a provider, settled against the index.

Everything below is live on Fuji with real Groq model runs.

## What is live

- **The market.** Four staked provider nodes (atlas, birch, cobalt, dune) serve `groq:openai/gpt-oss-20b` and `groq:openai/gpt-oss-120b`. They commit sealed bids, reveal, the lowest rate wins, the winner runs the model through Groq and delivers the answer on-chain. Nodes price from Groq's published per-token rates and move their margin after each win or loss, so the clearing price is a real negotiated price.
- **x402 on Fuji.** `POST /v1/chat/completions` (OpenAI-compatible) answers `402 Payment Required` with exact-scheme requirements. The client signs `TransferWithAuthorization` for test dollars (tUSD); the gateway, acting as facilitator, submits it to `X402Router.payAndPost`, which moves the money into the buyer's job escrow and posts the job in one transaction. Unused escrow is refunded on-chain at settlement. Replays and expired signatures are rejected by the token.
- **Spot checks and slashing.** 30% of deliveries (100% when the buyer asks to verify) are re-run by a drawn node. The contract computes word-set similarity on-chain. On a mismatch a third node breaks the tie and whoever it contradicts loses 10% of stake. A real lying node was slashed on Fuji ([job #8](#a-real-slash-on-fuji)).
- **The Xorv Compute Index.** Only delivered, unslashed jobs with at least two revealed bids and a buyer who is not the winner are recorded. Each clearing moves the index at most 25%. It exposes `latest`, `twap(model, window)` and `vwap(model, window)` to any contract, a web page and `GET /api/index`.
- **eERC private credit.** Ava Labs' official EncryptedERC (converter mode over tUSD) with its production verifiers. A buyer tops up the Xorv desk with an encrypted transfer; only the buyer, the desk and the auditor can read the amount. The desk credits the buyer and posts the buyer's chats under its own address, so the public job record does not name the buyer.
- **Agents.** An MCP server (`node packages/mcp/src/main.ts`) gives agents `xorv_index`, `xorv_models`, `xorv_job` and `xorv_ask`, which pays the 402 itself and returns the answer with its Fuji settlement ([job #11](https://testnet.snowtrace.io/tx/0x26b608b595097456741a057ade9807f345f18602d1cd87325867e631bdb9009c)).
- **Compute forwards (stretch).** `XorvForward` pays the difference between a strike and the index TWAP over the forward's life, capped at margin. One forward is live on Fuji.

## Live on Fuji

Avalanche Fuji C-Chain (43113). All contracts are this repo's, deployed by `0xDDb9a3bB6666eb92901D3836ccB2919BBDd8752E` ([funding tx](https://testnet.snowtrace.io/tx/0xc35077c1060acb56ec80ab496a4cf5ef55c0cc20f85e61358908bca17612ba4b), 0.08 test AVAX in total).

| Contract | Address |
| --- | --- |
| XorvMarket (auctions, checks) | [`0x57fc4ab7de82ea555d957d88ff27bf4ff463814b`](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) |
| XorvRegistry (stake, earnings, slashing) | [`0x8fcdb5bef522f5e1ee286bacf153ca2b19dcbca2`](https://testnet.snowtrace.io/address/0x8fcdb5bef522f5e1ee286bacf153ca2b19dcbca2) |
| XorvIndex (Compute Index) | [`0x7a9192cb425c638bb6680033081c73eb0d841abc`](https://testnet.snowtrace.io/address/0x7a9192cb425c638bb6680033081c73eb0d841abc) |
| X402Router (x402 payTo) | [`0xd2555e5b231957f4810f78029341cf4936e89f74`](https://testnet.snowtrace.io/address/0xd2555e5b231957f4810f78029341cf4936e89f74) |
| XorvForward | [`0x67eeb02e16629d784165f3613b53e8ed29089428`](https://testnet.snowtrace.io/address/0x67eeb02e16629d784165f3613b53e8ed29089428) |
| Similarity (linked library) | [`0x10720460b0130a6c7cc7d21b2e7b6e6d240b618b`](https://testnet.snowtrace.io/address/0x10720460b0130a6c7cc7d21b2e7b6e6d240b618b) |
| TestDollar tUSD (6 decimals, EIP-3009, faucet) | [`0x2210a2161b13a1a2375951577b506707867f9739`](https://testnet.snowtrace.io/address/0x2210a2161b13a1a2375951577b506707867f9739) |
| EncryptedERC (Ava Labs, converter) | [`0xf0f1d107bbca6568e0ff0cec580cf053e1b73787`](https://testnet.snowtrace.io/address/0xf0f1d107bbca6568e0ff0cec580cf053e1b73787) |
| Registrar (Ava Labs) | [`0x335d199e8442ddad556c874a065801ba0ac63350`](https://testnet.snowtrace.io/address/0x335d199e8442ddad556c874a065801ba0ac63350) |
| eERC verifiers (registration, mint, withdraw, transfer, burn) | [`0xc209…bca7`](https://testnet.snowtrace.io/address/0xc209d4402a2e1c12b7e91155d71cefe42df1bca7), [`0x0503…31d3`](https://testnet.snowtrace.io/address/0x050323ac0c920effb5bcfeed4feb4b7a035b31d3), [`0xe9df…c1c4`](https://testnet.snowtrace.io/address/0xe9df883c6758acc8058db196a73841cb7f5eb1c4), [`0x9e7b…5cf0`](https://testnet.snowtrace.io/address/0x9e7bf355f92d35e7e9f372b1737aa83bcad55cf0), [`0x3834…3b92`](https://testnet.snowtrace.io/address/0x3834ebc73323f24eb8ddc83a348095854c953b92) |

Every address, deployment transaction and recorded run is in [deployments/fuji.json](deployments/fuji.json). An earlier market deployment (same tUSD and eERC, market `0x3130…a07c`) was replaced after Fuji testing showed the spot-check draw waited for a later block that a quiet Avalanche chain may not produce; its jobs stay on-chain but are not counted here.

<!-- EVIDENCE:START -->
<!-- EVIDENCE:END -->

### A real slash on Fuji

Job #8: dune ran with `--fault deliver`. It underbid at 1 micro-tUSD per 1k tokens, won, skipped the model and delivered lorem ipsum. The buyer had asked to verify. atlas re-ran the model ([check](https://testnet.snowtrace.io/tx/0x36fa0b0c2d25e8574f950b72d16da8ac62435e595597cd3b272d7494d977fe12), 1.85% similarity), birch broke the tie ([tiebreak](https://testnet.snowtrace.io/tx/0xbc9ff29c75ef4ca0a5a0889e067933170c3211eab0213ed76a3e4086455b42d6): 1.85% with the delivery, 100% with atlas), and in that same transaction dune lost 1 tUSD of stake to the buyer, the buyer got the escrow back minus two check fees, and the index did not move.

### eERC on Fuji

| Step | Transaction |
| --- | --- |
| Auditor registers its eERC key (Groth16 proof) | [`0x212db76e…`](https://testnet.snowtrace.io/tx/0x212db76ed8bdb05f0dfff060170e50ce62efccca734b2664285c758771d0b6a3) |
| Deployer sets the auditor | [`0x1091ae3a…`](https://testnet.snowtrace.io/tx/0x1091ae3a7ac242a76b6dc3151fb3e5b5e3a92029915796280c998dd9be2e1f42) |
| Buyer, desk, provider owner, provider treasury register | [`0xad55107c…`](https://testnet.snowtrace.io/tx/0xad55107c39ed157b7a645523c0e2763f7954b47106683cf42a06c8b991d684bc), [`0x0bb661fd…`](https://testnet.snowtrace.io/tx/0x0bb661fd2085f411c4d0afcc5deab3747bb87181de00765567e484230ecbed85), [`0x7cb69c7b…`](https://testnet.snowtrace.io/tx/0x7cb69c7b3755a505ebc35a3d616963f2178b2a5bb9b0612d75408604d4273c3e), [`0x328139f4…`](https://testnet.snowtrace.io/tx/0x328139f4c7a6df114f4b4d8f2ea7c4a81fd03eef349f47161e8150a71e959a2b) |
| Buyer deposits 5 tUSD (public amount) | [`0x7a995671…`](https://testnet.snowtrace.io/tx/0x7a995671c1156e02459e9abd40d35bf7c79f08d31d1cf7e52b39964f8fca2aef) |
| Buyer to desk, encrypted transfers (amounts hidden) | [`0x042b0cdc…`](https://testnet.snowtrace.io/tx/0x042b0cdca4adf41b9572a4762c65396dcc37edc93020860062df2980dad74500), [`0xfce79007…`](https://testnet.snowtrace.io/tx/0xfce79007bbd84647c70d18e64d25bfc2884d423a2cf2ef1cd6ef7762b77a54e8), [`0xfebe3b01…`](https://testnet.snowtrace.io/tx/0xfebe3b0161010135571554605b92e5afe3a16e13021b6a1cabc184d49ff36f34) |
| Provider owner sweeps 0.5 tUSD of earnings in, pays its treasury privately | [`0x47981d09…`](https://testnet.snowtrace.io/tx/0x47981d09be61442e6c75892e3b8072a40a6e45da540d0db6c957136539e74e1c), [`0x6677525c…`](https://testnet.snowtrace.io/tx/0x6677525cda90264ca262a56fba1d6e8ab262329fe05f4bbe181f9f682a981d11) |
| Desk withdraws 1 tUSD to fund public escrows | [`0x91a07f7e…`](https://testnet.snowtrace.io/tx/0x91a07f7ef38751bc1513bb7db3ac5004c285b95f9298b5ebb6139fb0239f55f3) |
| Private chat: job #7 posted by the desk, paid from the buyer's credit | [`0x2a4e644a…`](https://testnet.snowtrace.io/tx/0x2a4e644a6d6dc790d6846a4c457388fecaedebbc64b21cb4b9532a2dfd307903) |

The desk decrypted 1.75 tUSD from the second top-up, the auditor read the same 1.75 from the transfer event, and every decrypted balance matched its on-chain ElGamal ciphertext. On Snowtrace those transfers show sender and receiver but only ciphertext for the amount. The first two top-ups were spent by the script's desk withdrawal before the gateway's ledger had seen them, so they were never credited; the gateway now re-reads top-ups every 30 seconds and must record them before the desk spends (spending clears eERC's pending amounts).

## How it works

```
buyer ──POST /v1/chat/completions──▶ gateway ──402 + requirements──▶ buyer signs EIP-3009 (tUSD → X402Router)
      ──retry with X-PAYMENT───────▶ gateway (facilitator) ──X402Router.payAndPost──▶ XorvMarket: job + escrow (buyer owns it)
nodes: commitBid(hash) ─▶ revealBid(rate, salt) ─▶ lowest rate wins ─▶ deliver(answer, tokens) ─▶ resolveDraw (30%: check)
checker: deliverCheck(rerun) ─▶ on-chain Jaccard ≥ 50%? pay : tiebreaker ─▶ slash whoever it contradicts
settle: winner paid rate × tokens, unused escrow refunded, XorvIndex.record(model, rate, tokens) if competitive and clean
```

- **Bids are rates.** A bid is micro-tUSD per 1k tokens; the buyer sets a ceiling and a maximum token count; escrow is ceiling × max tokens plus two check fees; the charge is the cleared rate × tokens used.
- **Randomness.** The spot-check draw and the checker pick come from the hash of the delivery block, known only after it is produced. Avalanche makes blocks on demand, so waiting for a later block could stall a job on a quiet chain; an aged-out hash forces a check.
- **Keys.** A provider's owner key stakes and withdraws; its node key only bids, delivers and checks.
- **Index rules.** See above. The job record always keeps the true clearing; only the index input is clamped.
- **x402 details.** Network `avalanche-fuji`, scheme `exact`, asset tUSD (EIP-712 domain "Xorv Test Dollar", version 1), `payTo` the router. The gateway checks the signature, expiry, payee, amount and balance before spending gas, then settles. If someone front-runs the facilitator by submitting the signature straight to the token, the job is not created, the call fails loudly, and `X402Router.refundStray` returns that exact payment (the token records which signed transfer consumed each nonce).

## eERC: what is hidden and what is not

- **Hidden:** the amount of each buyer top-up to the desk and of each provider payout to its treasury; encrypted balances. Only the holder, the receiver and the auditor can read them.
- **Not hidden:** sender and receiver addresses of eERC transfers (that is how eERC works), deposit and withdrawal amounts (they are ERC-20 transfers), and every job's cleared price (that is the index's whole point). Jobs posted from private credit are public, but they name the desk, not the buyer.
- **Trust:** the desk is an operator. It sees which buyer spent what, keeps the credit ledger in the gateway (not on-chain) and posts on their behalf. The auditor (`0x6aAf…84F4`) can decrypt every amount.
- **What is official:** the EncryptedERC, Registrar, BabyJubJub and production verifier contracts are Ava Labs' code at commit [`8dc98cd`](https://github.com/ava-labs/EncryptedERC/tree/8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1), vendored unmodified in `contracts/lib/eerc` under the Ava Labs Ecosystem License. Proofs use Ava Labs' published circuits and proving keys. The Node client in `packages/eerc` ports their encryption helpers; the official browser SDK (`@avalabs/ac-eerc-sdk`) is not used, and the web app does not generate eERC proofs (top-ups run with `node scripts/private-topup.ts`).

## Run it

Requirements: Node 22.18+ (TypeScript runs natively), pnpm 10, Foundry. Fuji test AVAX for the accounts.

```bash
pnpm install
pnpm circuits                                   # Ava Labs eERC circuits into .eerc/circuits (~57 MB, not committed)
cd contracts && forge test && cd ..             # 55 contract tests
bash scripts/test-local.sh                      # 19 tests on a fresh local chain with the full deployment
```

Use the live Fuji deployment:

```bash
node scripts/keys.ts                             # test accounts into the gitignored .env (addresses printed, keys never)
XORV_ENV_FILE=/path/to/.env.with.GROQ_API_KEY pnpm gateway     # gateway on :5421 + four provider nodes
node scripts/x402-client.ts "your question" [--verify]          # a buyer agent paying with x402
cd web && pnpm build && pnpm preview             # the app; /api and /v1 proxy to the gateway
node packages/mcp/src/main.ts                    # MCP server (stdio) for agents
```

Provider nodes need `GROQ_API_KEY` (read by name only, passed to node processes and nothing else). A fresh deployment: `node scripts/fund-deployer.ts`, `node scripts/deploy.ts`, `node scripts/setup-providers.ts`, then `node scripts/private-lane.ts` for the eERC auditor and registrations. Slashing demo: start the gateway with `XORV_GATEWAY_NODES=atlas:1.2,birch:1.08,cobalt:1.35,dune:1.15:deliver` and send a `--verify` chat.

Repository: `contracts/` (Foundry; eERC vendored in `contracts/lib/eerc`), `packages/sdk` (reads, x402, similarity), `packages/node` (provider node), `packages/gateway` (OpenAI-compatible API, x402 facilitator, private desk), `packages/eerc` (eERC client), `packages/mcp` (agent tools), `web/` (Vite + React), `scripts/`, `deployments/`.

## Limits

- tUSD is this repo's test dollar, not USDC, and has no value. Groq costs are real (a few hundred tokens per answer).
- Similarity is word-set Jaccard with a 50% tolerance: it catches junk, not subtle errors. Token counts are reported by the winner and capped by the buyer's maximum.
- A chat takes about 25–35 seconds: two 10-second auction windows plus model time and Fuji confirmations. The answer is returned at delivery; checks continue after.
- Gas: on Fuji a transaction is charged at least half its gas limit, so the nodes' fixed limits overpay slightly; at Fuji's fee level that is negligible.
- The public Fuji RPC rate-limited this machine during testing; the apps fall back across publicnode, drpc and the official endpoint, and read history from the Snowtrace indexer API.
- Forwards settle within a day after expiry at the TWAP from start to the settle time; the live one runs 25 minutes so it can settle during judging.

## Prior work

Xorv is an existing project of the author, now built for Avalanche. Earlier versions, all disclosed:

- xorv-near (NEAR testnet, Nov 9–12, 2026; not yet public): the approved black-and-white OpenRouter-style UI and its 3D monochrome art set, the chat playground where each answer is a sealed-bid job, provider nodes with a pre-bid self-check, random spot checks and slashing, an OpenAI-compatible gateway and x402-style payments. **Reused here:** the web app's layout, styles, components and art (`web/`, `docs/ART-3D.md`), the node and gateway structure, the similarity rule and prompt packing.
- [xorv](https://github.com/nickthelegend/xorv) (Hedera), [xorv-monad](https://github.com/nickthelegend/xorv-monad) (Monad), [xorv-arc](https://github.com/nickthelegend/xorv-arc) (Arc), [xorv-arbitrum](https://github.com/nickthelegend/xorv-arbitrum) (Arbitrum, private), [xorv-clockin](https://github.com/nickthelegend/xorv-clockin) (Solana), [xorv-wif](https://github.com/nickthelegend/xorv-wif) (Robinhood Chain, private): earlier explorations of paid idle AI capacity, x402 and escrow. No Solidity was copied from them.
- [xorr-zk-avax](https://github.com/nickthelegend/xorr-zk-avax): an earlier eERC project by the author; its funded Fuji key paid this repo's 0.08 AVAX.

**Built new for this Avalanche build (Nov 12, 2026):** all Solidity (market, registry, router, index, forwards, test dollar, on-chain similarity), the EVM SDK, x402 exact scheme on Fuji with a settlement router, the provider node and gateway for EVM, the Compute Index and its page, the eERC private credit lane and client, the forward, the tests and the Fuji deployment.

## AI tools used

Claude Code (Claude Opus) wrote the code, tests and docs. The 3D object art was generated earlier with ChatGPT images for xorv-near and is reused. No Codex.

## License

MIT, Copyright (c) 2026 Nivesh Gajengi. `contracts/lib/eerc` is Ava Labs' code under the Ava Labs Ecosystem License.
