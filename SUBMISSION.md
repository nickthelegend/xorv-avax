# Submission: Team1 India "Build Anything on Avalanche"

Draft for Nick. Event: https://build.avax.network/events/3f8d455d-1eb5-425b-b859-4261a0ff8ad6 (deadline Nov 14, 2026, 22:59 UTC). Submit: repo, demo video (3 minutes or less), slides, AI tools used. Nothing here has been submitted.

**Name:** Xorv

**One-liner:** Sell the AI you don't use; buy AI one request at a time. A two-sided market on Avalanche: people who already pay for AI run a Xorv node and sell idle capacity in sealed-bid auctions, buyers offload work from code (`@xorv/sdk`), a terminal (`xorv`), any OpenAI-style client or an agent (MCP) and pay per call with x402, and a node caught lying is slashed to the buyer.

## Description

AI capacity is bought at list prices from a handful of APIs, while plenty of capacity sits idle, and nobody can see what AI work actually costs. Xorv turns each request into a market.

A buyer (an app or an agent) calls Xorv's OpenAI-compatible endpoint. It answers HTTP 402 with x402 payment requirements; the buyer signs one EIP-3009 authorization for test dollars and retries. The gateway submits it to an x402 router on Avalanche Fuji, which moves the payment straight into a job escrow the buyer owns. Four staked provider nodes commit sealed bids (a rate per 1k tokens), reveal them, and the lowest wins, runs the model through its own API key (Groq GPT-OSS 20B and 120B) and delivers the answer on-chain. Nodes start from Groq's published per-token prices and adjust their margin after every win or loss, so the clearing price is negotiated, not quoted.

Trust comes from staking. 30% of answers (all of them if the buyer asks to verify) are re-run by a second node drawn from the delivery block's hash, and the contract compares the two texts itself. On a mismatch a third node breaks the tie and whoever it contradicts loses 10% of stake. On Fuji, a node we configured to lie underbid, won, delivered junk and was slashed by the other two in a public transaction.

Every paid, checked, competitive clearing is written to the Xorv Compute Index: per model, the latest price, a TWAP and a VWAP with volume, readable by any contract. A bid that never delivers, a single-bidder job, a buyer winning its own job or a slashed delivery never reaches it, and one clearing can move it at most 25%. The index has a web page and a JSON API, and a compute forward contract settles against it: a buyer locks next week's price per 1M tokens against a provider, and the difference to the index TWAP is paid out in test dollars.

Spend is private when it needs to be. With Ava Labs' official eERC (encrypted ERC, converter mode over the test dollar), a buyer tops up the Xorv desk with an encrypted transfer that only the buyer, the desk and a compliance auditor can read; the proofs are made in the buyer's browser with Ava Labs' eERC SDK. The desk credits the buyer and posts their chats under its own address, so competitors can't read a company's AI spend from the chain. The desk's ledger stays off-chain (the amounts are what eERC hides), but it signs a receipt of every line, and the buyer's browser checks each one against Fuji, down to matching each top-up amount against the buyer's own proof. Providers can sweep earnings into eERC and pay their treasury privately the same way.

Anyone can try it with nothing installed: on the hosted app, one tap makes a test wallet in the browser and a gas station contract funds it with test dollars and a little AVAX, with its limits enforced on-chain.

## Use it (buyers and providers)

- Buyers: `pnpm xorv wallet new && pnpm xorv fund`, then `pnpm xorv chat "…" --verify` (live auction steps from Fuji) and `pnpm xorv verify <job>` (re-check any job from the chain alone); or `new Xorv({ account }).chat(…)` from `@xorv/sdk` ([examples/offload.ts](examples/offload.ts)); or the MCP tools.
- Providers: `pnpm xorv-node init --label you`, `pnpm xorv-node join --label you --stake 5`, `pnpm xorv-node start --label you`. Today every node is ours (four reselling Groq, plus a liar we run for the slash demo); anyone can run one. Guide: README "Two sides" and https://xorv-avax.vercel.app/providers/join.

## Why Avalanche

- x402 exact payments on Fuji settle in one sub-two-second transaction that also opens the job's escrow, with fees low enough that a sealed-bid auction per chat request (commit, reveal, deliver, check) is affordable.
- eERC is Avalanche's native confidential-token standard with an auditor key: exactly what a company needs to keep AI spend private and still be auditable.
- The index and forwards are plain C-Chain contracts any Avalanche app can read.

## Tech stack

- **Avalanche Fuji C-Chain:** XorvMarket, XorvRegistry, XorvIndex, X402Router, XorvForward, XorvGasStation (one-tap test funds with on-chain caps), an on-chain Similarity library, a 6-decimal EIP-3009 test dollar. Solidity 0.8.27, Foundry, OpenZeppelin.
- **eERC (Avalanche):** Ava Labs' EncryptedERC, Registrar, BabyJubJub and production Groth16 verifiers, vendored unmodified at commit 8dc98cd; proofs from Ava Labs' published circuits, made in the browser with Ava Labs' `@avalabs/eerc-sdk` and in Node with snarkjs.
- **x402:** v1 exact scheme on network `avalanche-fuji` (EIP-3009 `TransferWithAuthorization`), the gateway as facilitator.
- **Off-chain:** TypeScript on Node 22+ with viem: SDK, provider nodes, gateway (OpenAI-compatible), eERC client. Groq for model runs.
- **Web:** Vite + React, read straight from Fuji (public RPCs plus the Snowtrace indexer API for history).

## Links

- Repo: https://github.com/nickthelegend/xorv-avax
- Demo video: (link to be added after upload). Film: `grokbot/videos/xorv-avax/xorv-avax-film.mp4` (under 3:00, 1080p, captions in a band under the picture) and `xorv-avax-film-share.mp4` (720p, under 10 MB). One live take on the hosted app on Nov 13 from a fresh browser, with a test wallet funded off camera (0x0Df6…0744: 2 tUSD and a little test AVAX): a verified x402 chat (job #57, spot check 100% match on-chain, charge + check fee = total shown in the app; the check and settlement tx opened on Snowtrace); a fifth node that lies on purpose (`liar`, our own node run with `--fault deliver`, staked at the 5 tUSD minimum) bids $0.001, wins job #58, sends junk, fails the spot check (0%) and the tiebreak, and is slashed live: 0.50 tUSD of its stake goes to the buyer's wallet ($2.00 -> $2.50 in the app, and on Snowtrace); the Compute Index; an eERC top-up proved in the browser (PrivateTransfer on Snowtrace); a chat paid from private credit (job #59, desk post on Snowtrace); x402 from a terminal (job #60, replay refused) and the MCP tools. Every version and its independent judge notes: `grokbot/videos/xorv-avax/versions/` and `grokbot/videos/xorv-avax/film/JUDGE-v*.md`.
- Slides: [docs/SLIDES.md](docs/SLIDES.md). x402 wire format: [docs/X402.md](docs/X402.md).
- Live contracts (Snowtrace testnet): market [0x57fc…814b](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b), index [0x7a91…1abc](https://testnet.snowtrace.io/address/0x7a9192cb425c638bb6680033081c73eb0d841abc), x402 router [0xd255…9f74](https://testnet.snowtrace.io/address/0xd2555e5b231957f4810f78029341cf4936e89f74), registry [0x8fcd…bca2](https://testnet.snowtrace.io/address/0x8fcdb5bef522f5e1ee286bacf153ca2b19dcbca2), forward [0x67ee…9428](https://testnet.snowtrace.io/address/0x67eeb02e16629d784165f3613b53e8ed29089428), eERC [0xf0f1…3787](https://testnet.snowtrace.io/address/0xf0f1d107bbca6568e0ff0cec580cf053e1b73787). All other addresses and every recorded transaction: README "Live on Fuji" and `deployments/fuji.json`.
- The slash: [tiebreak tx](https://testnet.snowtrace.io/tx/0xbc9ff29c75ef4ca0a5a0889e067933170c3211eab0213ed76a3e4086455b42d6).
- A private (eERC) top-up: [tx](https://testnet.snowtrace.io/tx/0xfebe3b0161010135571554605b92e5afe3a16e13021b6a1cabc184d49ff36f34) (amount is ciphertext).
- Hosted app: https://xorv-avax.vercel.app. No wallet needed: "Start with a test wallet" funds a browser wallet in one tap. Hosted gateway and four provider nodes: https://xorv-api.201-18-198-162.sslip.io. From a fresh, empty browser on the hosted app: job #21 paid with x402 ([settlement](https://testnet.snowtrace.io/tx/0x3b6ad2dd7792dae146c400b3e94021363a3658fdc77fb27c1e6fbddec2f29141)), a private top-up proved in the browser ([encrypted transfer](https://testnet.snowtrace.io/tx/0x6ef07a1352ce0dca948b906518ca9a4f48849ffd531a2688fc520ab3c4f01efb)) and job #22 paid from private credit ([desk post](https://testnet.snowtrace.io/tx/0xa9bb56e2cf20e7474794d8a46a2fb5300c772fcc1c0402b07a5af75594a35382)).

## Bonus criteria

- **eERC used meaningfully:** yes, for private buyer credit and private provider payouts, with a live auditor, on Fuji. Buyers' registration and transfer proofs are made in the browser with Ava Labs' official SDK; the desk's off-chain credit ledger is checkable through signed receipts (not trustless).
- **Mainnet / own L1 / ICM-ICTT:** not used.
- **Open-sourcing reusable work:** the x402 exact-scheme router and facilitator for Fuji, the on-chain text similarity library, the compute index with its manipulation rules, the eERC Node client, signed-receipt checks for an eERC desk, and the gas station, MIT (eERC contracts under Ava Labs' license).

## AI tools used

Claude Code (Claude Opus) for code, tests and docs. ChatGPT images for the monochrome 3D object set, made earlier for Xorv on NEAR and reused. Codex was not used.

## Prior work

Xorv existed before this event on other chains (Hedera, Monad, Arc, Arbitrum, Solana, Robinhood Chain, NEAR). The web app's look and art and the node/gateway structure come from the NEAR version; everything on Avalanche (all Solidity, x402 on Fuji, the index, eERC lane, forwards, EVM node and gateway, tests, deployment) was built on Nov 12, 2026. Full disclosure in README "Prior work".
