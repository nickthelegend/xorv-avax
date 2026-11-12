# Submission: Team1 India "Build Anything on Avalanche"

Draft for Nick. Event: https://build.avax.network/events/3f8d455d-1eb5-425b-b859-4261a0ff8ad6 (deadline Nov 14, 2026, 22:59 UTC). Submit: repo, demo video (3 minutes or less), slides, AI tools used. Nothing here has been submitted.

**Name:** Xorv

**One-liner:** One API for the AI nobody's using, and the real price of compute: every request is a sealed-bid auction on Avalanche, paid per call with x402, and every clearing feeds an on-chain compute price index.

## Description

AI capacity is bought at list prices from a handful of APIs, while plenty of capacity sits idle, and nobody can see what AI work actually costs. Xorv turns each request into a market.

A buyer (an app or an agent) calls Xorv's OpenAI-compatible endpoint. It answers HTTP 402 with x402 payment requirements; the buyer signs one EIP-3009 authorization for test dollars and retries. The gateway submits it to an x402 router on Avalanche Fuji, which moves the payment straight into a job escrow the buyer owns. Four staked provider nodes commit sealed bids (a rate per 1k tokens), reveal them, and the lowest wins, runs the model through its own API key (Groq GPT-OSS 20B and 120B) and delivers the answer on-chain. Nodes start from Groq's published per-token prices and adjust their margin after every win or loss, so the clearing price is negotiated, not quoted.

Trust comes from staking. 30% of answers (all of them if the buyer asks to verify) are re-run by a second node drawn from the delivery block's hash, and the contract compares the two texts itself. On a mismatch a third node breaks the tie and whoever it contradicts loses 10% of stake. On Fuji, a node we configured to lie underbid, won, delivered junk and was slashed by the other two in a public transaction.

Every paid, checked, competitive clearing is written to the Xorv Compute Index: per model, the latest price, a TWAP and a VWAP with volume, readable by any contract. A bid that never delivers, a single-bidder job, a buyer winning its own job or a slashed delivery never reaches it, and one clearing can move it at most 25%. The index has a web page and a JSON API, and a compute forward contract settles against it: a buyer locks next week's price per 1M tokens against a provider, and the difference to the index TWAP is paid out in test dollars.

Spend is private when it needs to be. With Ava Labs' official eERC (encrypted ERC, converter mode over the test dollar), a buyer tops up the Xorv desk with an encrypted transfer that only the buyer, the desk and a compliance auditor can read. The desk credits the buyer and posts their chats under its own address, so competitors can't read a company's AI spend from the chain. Providers can sweep earnings into eERC and pay their treasury privately the same way.

## Why Avalanche

- x402 exact payments on Fuji settle in one sub-two-second transaction that also opens the job's escrow, with fees low enough that a sealed-bid auction per chat request (commit, reveal, deliver, check) is affordable.
- eERC is Avalanche's native confidential-token standard with an auditor key: exactly what a company needs to keep AI spend private and still be auditable.
- The index and forwards are plain C-Chain contracts any Avalanche app can read.

## Tech stack

- **Avalanche Fuji C-Chain:** XorvMarket, XorvRegistry, XorvIndex, X402Router, XorvForward, an on-chain Similarity library, a 6-decimal EIP-3009 test dollar. Solidity 0.8.27, Foundry, OpenZeppelin.
- **eERC (Avalanche):** Ava Labs' EncryptedERC, Registrar, BabyJubJub and production Groth16 verifiers, vendored unmodified at commit 8dc98cd; proofs from Ava Labs' published circuits with snarkjs.
- **x402:** v1 exact scheme on network `avalanche-fuji` (EIP-3009 `TransferWithAuthorization`), the gateway as facilitator.
- **Off-chain:** TypeScript on Node 22+ with viem: SDK, provider nodes, gateway (OpenAI-compatible), eERC client. Groq for model runs.
- **Web:** Vite + React, read straight from Fuji (public RPCs plus the Snowtrace indexer API for history).

## Links

- Repo: TBD (Nick publishes; this checkout has no remote and nothing is pushed).
- Demo video: TBD (3 minutes or less).
- Slides: [docs/SLIDES.md](docs/SLIDES.md). x402 wire format: [docs/X402.md](docs/X402.md).
- Live contracts (Snowtrace testnet): market [0x57fc…814b](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b), index [0x7a91…1abc](https://testnet.snowtrace.io/address/0x7a9192cb425c638bb6680033081c73eb0d841abc), x402 router [0xd255…9f74](https://testnet.snowtrace.io/address/0xd2555e5b231957f4810f78029341cf4936e89f74), registry [0x8fcd…bca2](https://testnet.snowtrace.io/address/0x8fcdb5bef522f5e1ee286bacf153ca2b19dcbca2), forward [0x67ee…9428](https://testnet.snowtrace.io/address/0x67eeb02e16629d784165f3613b53e8ed29089428), eERC [0xf0f1…3787](https://testnet.snowtrace.io/address/0xf0f1d107bbca6568e0ff0cec580cf053e1b73787). All other addresses and every recorded transaction: README "Live on Fuji" and `deployments/fuji.json`.
- The slash: [tiebreak tx](https://testnet.snowtrace.io/tx/0xbc9ff29c75ef4ca0a5a0889e067933170c3211eab0213ed76a3e4086455b42d6).
- A private (eERC) top-up: [tx](https://testnet.snowtrace.io/tx/0xfebe3b0161010135571554605b92e5afe3a16e13021b6a1cabc184d49ff36f34) (amount is ciphertext).
- Hosted app: none; the app and gateway run locally (`pnpm gateway`, `cd web && pnpm preview`).

## Bonus criteria

- **eERC used meaningfully:** yes, for private buyer credit and private provider payouts, with a live auditor, on Fuji. Browser-side eERC proving is not built (the Node client makes the proofs).
- **Mainnet / own L1 / ICM-ICTT:** not used.
- **Open-sourcing reusable work:** the x402 exact-scheme router and facilitator for Fuji, the on-chain text similarity library, the compute index with its manipulation rules, and the eERC Node client, MIT (eERC contracts under Ava Labs' license).

## AI tools used

Claude Code (Claude Opus) for code, tests and docs. ChatGPT images for the monochrome 3D object set, made earlier for Xorv on NEAR and reused. Codex was not used.

## Prior work

Xorv existed before this event on other chains (Hedera, Monad, Arc, Arbitrum, Solana, Robinhood Chain, NEAR). The web app's look and art and the node/gateway structure come from the NEAR version; everything on Avalanche (all Solidity, x402 on Fuji, the index, eERC lane, forwards, EVM node and gateway, tests, deployment) was built on Nov 12, 2026. Full disclosure in README "Prior work".
