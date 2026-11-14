# Xorv on Avalanche

**Sell the AI you don't use. Buy AI one request at a time.** A two-sided market on Avalanche: people who already pay
for AI run a Xorv node and sell their idle capacity; buyers offload AI work from code, a terminal or an agent, and every
request goes to the lowest sealed bid, paid per call with x402.

Xorv sells AI answers from idle capacity. Every request is a sealed-bid auction among staked provider nodes on Avalanche Fuji. The buyer pays per call with **x402** (HTTP 402, one EIP-3009 signature, settled in the same Fuji transaction that funds the job's escrow). A random sample of answers is re-run by a second node, and the contract itself compares the texts; a node that lies loses stake. Every paid, checked clearing feeds the **Xorv Compute Index**, an on-chain price per model per 1M tokens that any contract can read. Buyers who don't want competitors reading their AI spend can pay from an **eERC** encrypted balance instead, with an auditor key for compliance. A **compute forward** lets a buyer lock next week's price against a provider, settled against the index.

Everything below is live on Fuji with real Claude (Anthropic API) and Groq model runs.

## Two sides: providers and buyers

Xorv is a two-sided market. **Providers** are people who already pay for AI API capacity (a Claude or Groq API plan with headroom, or a local model on a GPU that sits idle) and run a Xorv node with their own key to sell the capacity they don't use: the node bids a sealed price for each request on a model it serves, answers, gets paid, and loses stake if it lies. Each model has its own auction. **Buyers** offload AI work to the network from code, a terminal, an OpenAI-style client or an agent, and pay per request with x402. Consumer chat subscriptions (Claude Pro/Max, ChatGPT Plus) are not supported and cannot be sold here: see [Providers and terms](#providers-and-terms).

Today every node is ours: four nodes (atlas, birch, cobalt, dune) on the hackathon VPS, three of which also serve Claude Haiku 5.5 with our own Anthropic API key, a provider node (ember) we start from a laptop with that key to show the provider side, and a fifth Groq node (liar) that we start with `--fault deliver` to show a slash. The node software is in this repo, so anyone can run one; no third-party providers exist yet.

From a clone (Node 22.18+, pnpm 10; TypeScript runs natively, nothing to build): `pnpm install`, then the two CLIs run as `pnpm xorv …` and `pnpm xorv-node …` (or link `packages/cli/src/main.ts` and `packages/node/src/cli.ts` onto your PATH as `xorv` and `xorv-node`). Both read keys by name from the environment, the repo's gitignored `.env` or `~/.xorv/keys.env` (mode 600; `XORV_HOME` moves it) and never print them.

### Buy: the SDK (`@xorv/sdk`)

```ts
import { Xorv } from '@xorv/sdk';
import { privateKeyToAccount } from 'viem/accounts';

const xorv = new Xorv({ account: privateKeyToAccount(process.env.XORV_WALLET_KEY) }); // gateway defaults to https://xorv-avax.vercel.app
const r = await xorv.chat('In two sentences: what makes a sealed-bid auction fair?', { verify: true });
console.log(r.text, r.job, r.settlement); // the answer, the job id, the Fuji settlement tx
```

`chat()` does the whole x402 round trip (POST → `402` → one EIP-3009 signature → paid retry) and waits for the answer. `quote()` returns the most a request can cost (the escrow you sign for), the ceiling and the last index price without paying. `submit()` pays and returns as soon as the job is on Fuji; `followJob(reader, id, onStep)` then streams the auction from the contracts (sealed bids, reveal, winner, answer, spot check, settlement). `verifyJob(reader, id)` re-checks any job from the chain alone. [`examples/offload.ts`](examples/offload.ts) is the snippet above (job #62 on Fuji: `node --env-file ~/.xorv/keys.env examples/offload.ts`).

### Buy: the CLI (`xorv`)

```bash
pnpm xorv wallet new          # a Fuji test wallet in ~/.xorv/keys.env (address printed, key never)
pnpm xorv fund                # 2 tUSD (+ a sip of AVAX) from XorvGasStation, gasless, once per wallet
pnpm xorv quote "…" --verify  # the most it can cost: ceiling x max tokens + two check fees, and the last clearing price
pnpm xorv chat  "…" --verify  # 402 → signature → sealed bids → reveal → winner → answer → spot check → settlement, live
pnpm xorv jobs --mine         # your jobs, from the market contract
pnpm xorv verify 58           # re-check a job from Fuji alone (below)
pnpm xorv models · pnpm xorv index
```

`xorv chat` prints each step as it happens on Fuji (read from the contracts, not the gateway). The first real run was job #61 ([payment](https://testnet.snowtrace.io/tx/0x8137db9b02c08234f4fce693bdbd94690bf73787a2986ad3d84e26187a6f35eb), [settlement](https://testnet.snowtrace.io/tx/0x02efde97c157b4320a46d56215ab9ee0f8b07db1e8005fafb11cd3f0641e10cd)).

`xorv verify <job>` trusts nothing but the chain: it recomputes the prompt and answer hashes against the stored ones, checks that the cleared rate is the lowest revealed sealed bid, recomputes every spot check's word-overlap score locally and compares it with the score the contract stored, checks that the outcome follows from those scores, that escrow = charge + check fees + refund, and where a slash went. On job #58 (the liar): 8 of 8 pass, including "liar slashed $0.50 of stake, paid to the buyer".

### Buy: any OpenAI-style client, or an agent

`POST https://xorv-avax.vercel.app/v1/chat/completions` answers `402 Payment Required` with x402 exact-scheme requirements; retry with `X-PAYMENT` (wire format in [docs/X402.md](docs/X402.md); a plain-fetch client is [scripts/x402-client.ts](scripts/x402-client.ts)). Agents get the MCP server `xorv-mcp` (`node packages/mcp/src/main.ts`, stdio): `xorv_ask` pays the 402 itself and returns the answer with its settlement, plus `xorv_index`, `xorv_models` and `xorv_job`.

### Sell: run a node (`xorv-node`)

```bash
pnpm xorv-node init  --label you                    # owner key (stakes, withdraws, is paid) + node key (bids, delivers, checks)
#   send each address a little Fuji test AVAX for gas (https://core.app/tools/testnet-faucet)
pnpm xorv-node join  --label you --stake 5 --models anthropic:claude-haiku-5-5
#   tUSD from the test faucet if needed, approve the registry, register (run again to top up stake or change models)
XORV_ENV_FILE=/path/to/anthropic.env XORV_LOG=pretty pnpm xorv-node start --label you --margin 1.2
#   ANTHROPIC_API_KEY / GROQ_API_KEY (or OLLAMA_HOST) from that file, read by name and never sent anywhere but the
#   provider's own API; self-check each model, then bid, serve, get paid
pnpm xorv-node status --label you · pnpm xorv-node leave --label you · pnpm xorv-node withdraw --label you
```

What a node does: for every job on a model it serves it commits a sealed rate (micro-tUSD per 1k tokens) priced from its own cost (the provider's published per-token price, blended 40/60 input/output: Groq GPT-OSS 20B $0.21, GPT-OSS 120B $0.42, Claude Haiku 5.5 $0.34 per 1M tokens), its margin and its load, then reveals it. If it wins it runs the model and delivers the answer on-chain, and is paid the cleared rate × tokens when the job settles; it also earns a check fee whenever it is drawn to re-run someone else's job. After each auction it moves its margin a little toward the price that cleared. Stake rules: at least 5 tUSD; a winner whose answer a tiebreaker contradicts loses 10% to the buyer, and a checker whose re-run a tiebreaker contradicts loses 10% to the provider (job #61 shows the second case: an honest checker's short re-run overlapped only 45%, below the 50% tolerance, so word-overlap checks can punish a checker on short answers). The provider guide is also on the hosted app at [/providers/join](https://xorv-avax.vercel.app/providers/join).

### Providers and terms

Checked on Nov 14, 2026 against the providers' published terms. In short: bring your own API key under your own account; never share or sell the key or the account; consumer chat subscriptions are out; and plain resale of a provider's service needs that provider's approval, which nobody running a node on Xorv has today. This is our reading, not legal advice; every operator
runs a node under their own agreement with their provider and is responsible for following it.

| | What the terms say | What Xorv does |
|---|---|---|
| **Anthropic API** ([Commercial Terms](https://www.anthropic.com/legal/commercial-terms), effective Jun 17, 2025; [Usage Policy](https://www.anthropic.com/legal/aup), effective Nov 12, 2026) | A customer may use the API to power products and services it makes available to its own customers and end users (A.1), is responsible for all activity under its account (D.5), and may not "resell the Services except as expressly approved by Anthropic" (D.4(a)). The Usage Policy forbids reselling or proxying access "through unauthorized means", including services that route requests through consumer subscriptions, covers the end users of products that integrate Claude, and asks consumer-facing chat products to say users are talking to AI. | A Claude node uses its operator's own API key, on the operator's own account, held only on the operator's machine. Buyers never get the key, the account or API access: they send a question and get one answer that the operator's node produced and delivered on-chain. Whether running such a node for paying buyers counts as resale under D.4(a) is Anthropic's call, so an operator who wants to run a Claude node beyond testnet should get Anthropic's approval first. Our three Claude nodes and ember are ours, on Fuji, paid in test dollars. The app labels every answer with the model and the node that produced it. |
| **Anthropic consumer plans** (Claude Free/Pro/Max, [Consumer Terms](https://www.anthropic.com/legal/consumer-terms), effective Oct 8, 2025) | You may not share your login, API key or credentials or "make your Account available to anyone else", may not resell the Services, and may not access them by automated means except through an API key. | Not supported. A Xorv node only speaks to the Anthropic API with an API key; there is no way to plug in a Claude.ai subscription, and we don't suggest one. |
| **OpenAI API** ([Services Agreement](https://openai.com/policies/services-agreement/), v.010126) | A customer may integrate the API into its own applications and make them available to end users (2.2), may not share credentials or "resell or lease access to its Account" (3.1), and may not "buy, sell, or transfer API keys" (3.3(g)). | No OpenAI node runs today (we hold no OpenAI key). The same rule would apply: the operator's own key, never shared or sold; buyers buy answers, not access. ChatGPT consumer plans are not supported. |
| **Groq API** ([Services Agreement](https://console.groq.com/docs/legal/services-agreement), last modified Jun 22, 2026) | A customer may integrate the services into its own Customer Application for End Users (3.1), is responsible for its users (3.2), may not "resell or lease access to its Account" (3.2) and may not "sell, resell, sublicense … any of the Cloud Services except as expressly approved by Groq" (6.3(c)). | Same pattern and the same caveat as Anthropic: the four house nodes run Groq's GPT-OSS models with our own Groq key, on Fuji for test dollars; an operator going beyond testnet should get Groq's approval. |

How a Claude spot check works: Claude Haiku 5.5 accepts no temperature or seed, so two honest runs of the same open
question rarely share half their words (we measured 21–57% word overlap on two-sentence answers), which the 50%
tolerance would punish. A Claude checker therefore runs its own Claude on the question and the delivered answer: if its
model judges the answer genuine and correct, the check submits the delivered text (the contract scores 100%); if not,
it submits its model's own answer (junk scores about 0%). The contract still computes the overlap itself. Groq and
Ollama checks are plain re-runs at temperature 0.

## What is live

- **The market.** Staked provider nodes serve `anthropic:claude-haiku-5-5` (atlas, birch, cobalt, plus ember when it runs), `groq:openai/gpt-oss-20b` and `groq:openai/gpt-oss-120b` (atlas, birch, cobalt, dune); every model has its own sealed-bid auction and its own index. Nodes commit sealed bids, reveal, the lowest rate wins, the winner runs the model with its operator's own key and delivers the answer on-chain. Nodes price from the provider's published per-token rates and move their margin after each win or loss, so the clearing price is a real negotiated price.
- **x402 on Fuji.** `POST /v1/chat/completions` (OpenAI-compatible) answers `402 Payment Required` with exact-scheme requirements. The client signs `TransferWithAuthorization` for test dollars (tUSD); the gateway, acting as facilitator, submits it to `X402Router.payAndPost`, which moves the money into the buyer's job escrow and posts the job in one transaction. Unused escrow is refunded on-chain at settlement. Replays and expired signatures are rejected by the token.
- **Spot checks and slashing.** 30% of deliveries (100% when the buyer asks to verify) are re-run by a drawn node. The contract computes word-set similarity on-chain. On a mismatch a third node breaks the tie and whoever it contradicts loses 10% of stake. A real lying node was slashed on Fuji ([job #8](#a-real-slash-on-fuji)).
- **The Xorv Compute Index.** Only delivered, unslashed jobs with at least two revealed bids and a buyer who is not the winner are recorded. Each clearing moves the index at most 25%. It exposes `latest`, `twap(model, window)` and `vwap(model, window)` to any contract, a web page and `GET /api/index`.
- **Zero-setup start.** Open the hosted app with nothing: **Start with a test wallet** makes a key in the browser and, in the same tap, `XorvGasStation` sends it 2 tUSD and 0.001 AVAX on Fuji (the gateway relays a gasless signed request; once per wallet, 40 a day, limits on-chain). Then chat, sealed-bid auction, answer, Snowtrace link. An empty Core or MetaMask wallet gets the same one-tap **Get test funds**.
- **eERC private credit, proved in the browser.** Ava Labs' official EncryptedERC (converter mode over tUSD) with its production verifiers, driven from the page by Ava Labs' `@avalabs/eerc-sdk`: registration and the encrypted transfer to the Xorv desk are Groth16 proofs made in the browser. Only the buyer, the desk and the auditor can read the amount. The desk credits the buyer and posts the buyer's chats under its own address, so the public job record does not name the buyer. The desk signs a receipt of its ledger, and the page checks every line against Fuji, including each top-up amount against the buyer's own proof.
- **Agents.** An MCP server (`node packages/mcp/src/main.ts`) gives agents `xorv_index`, `xorv_models`, `xorv_job` and `xorv_ask`, which pays the 402 itself and returns the answer with its Fuji settlement ([job #11](https://testnet.snowtrace.io/tx/0x26b608b595097456741a057ade9807f345f18602d1cd87325867e631bdb9009c)).
- **Compute forwards (stretch).** `XorvForward` pays the difference between a strike and the index TWAP over the forward's life, capped at margin. One forward ran and settled on Fuji.

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
| XorvGasStation (one-tap test funds, on-chain caps) | [`0xfc23826ad39591f10fed2397ce5c87278806cfb1`](https://testnet.snowtrace.io/address/0xfc23826ad39591f10fed2397ce5c87278806cfb1) |
| TestDollar tUSD (6 decimals, EIP-3009, faucet) | [`0x2210a2161b13a1a2375951577b506707867f9739`](https://testnet.snowtrace.io/address/0x2210a2161b13a1a2375951577b506707867f9739) |
| EncryptedERC (Ava Labs, converter) | [`0xf0f1d107bbca6568e0ff0cec580cf053e1b73787`](https://testnet.snowtrace.io/address/0xf0f1d107bbca6568e0ff0cec580cf053e1b73787) |
| Registrar (Ava Labs) | [`0x335d199e8442ddad556c874a065801ba0ac63350`](https://testnet.snowtrace.io/address/0x335d199e8442ddad556c874a065801ba0ac63350) |
| eERC verifiers (registration, mint, withdraw, transfer, burn) | [`0xc209…bca7`](https://testnet.snowtrace.io/address/0xc209d4402a2e1c12b7e91155d71cefe42df1bca7), [`0x0503…31d3`](https://testnet.snowtrace.io/address/0x050323ac0c920effb5bcfeed4feb4b7a035b31d3), [`0xe9df…c1c4`](https://testnet.snowtrace.io/address/0xe9df883c6758acc8058db196a73841cb7f5eb1c4), [`0x9e7b…5cf0`](https://testnet.snowtrace.io/address/0x9e7bf355f92d35e7e9f372b1737aa83bcad55cf0), [`0x3834…3b92`](https://testnet.snowtrace.io/address/0x3834ebc73323f24eb8ddc83a348095854c953b92) |

Every address, deployment transaction and recorded run is in [deployments/fuji.json](deployments/fuji.json). An earlier market deployment (same tUSD and eERC, market `0x3130…a07c`) was replaced after Fuji testing showed the spot-check draw waited for a later block that a quiet Avalanche chain may not produce; its jobs stay on-chain but are not counted here.

<!-- EVIDENCE:START -->
#### Jobs on the current market (23)

| Job | Paid with | Model | Bids (revealed) | Cleared, $/1M tokens | Tokens | Charged | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#0](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x7d65ee05…`](https://testnet.snowtrace.io/tx/0x7d65ee05f15fd5a03005909e69a0f308d1a140194d1da4cd255ec17537b4cd27) | GPT-OSS 20B | 4 (4) | $0.316 | 185 | $0.000059 | Paid. Not sampled for a spot check. |
| [#1](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 from the web app (QA signer) [`0x8ebdb9da…`](https://testnet.snowtrace.io/tx/0x8ebdb9dad18270bdb267cfbbd8928526df848bac26d4f72ace3e37f2a3e14099) | GPT-OSS 20B | 4 (4) | $0.321 | 180 | $0.000058 | Paid. Not sampled for a spot check. |
| [#2](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0xb8dd954b…`](https://testnet.snowtrace.io/tx/0xb8dd954bfba4adcfddd3b5f72309248e716d8154a0b326161ba7a4d7f6bb93cc) | GPT-OSS 20B | 4 (4) | $0.220 | 141 | $0.000032 | Paid. Not sampled for a spot check. |
| [#3](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x9281ba11…`](https://testnet.snowtrace.io/tx/0x9281ba11259dceeea471794b07fc6ec4f7f253dc17b57cafd983b949a6fc927a) | GPT-OSS 120B | 3 (3) | $0.529 | 194 | $0.000103 | Paid. A second node re-ran it and matched. |
| [#4](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0xdc7e464b…`](https://testnet.snowtrace.io/tx/0xdc7e464b66b807bf28d9f0d7bb0a0938c4c1b1385e9426f204aa3cb9f4474d82) | GPT-OSS 20B (verify) | 4 (3) | $0.232 | 157 | $0.000037 | Paid. A second node re-ran it and matched. |
| [#5](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x56f444a6…`](https://testnet.snowtrace.io/tx/0x56f444a6ec552b2d4d7cecce2c9f43e7a94a5a62cfa945019e9520c90241ee6a) | GPT-OSS 20B | 3 (3) | $0.265 | 163 | $0.000044 | Paid. Not sampled for a spot check. |
| [#6](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x5de4dd62…`](https://testnet.snowtrace.io/tx/0x5de4dd62d27c331427311948009757a04ea6aded544bae3989b3d79cf5b912f2) | GPT-OSS 20B | 4 (4) | $0.222 | 116 | $0.000026 | Paid. Not sampled for a spot check. |
| [#7](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | private credit (desk) [`0x2a4e644a…`](https://testnet.snowtrace.io/tx/0x2a4e644a6d6dc790d6846a4c457388fecaedebbc64b21cb4b9532a2dfd307903) | GPT-OSS 20B | 4 (4) | $0.240 | 141 | $0.000034 | Paid. Not sampled for a spot check. |
| [#8](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0xade14313…`](https://testnet.snowtrace.io/tx/0xade14313780bb9d9981d6456507158467d73954491b21c20243eb2f2397925c7) | GPT-OSS 20B (verify) | 4 (4) | $0.001 | 1200 | $0.000000 | Faulted. The tiebreaker sided with the checker and the provider was slashed. |
| [#9](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0xd4854b90…`](https://testnet.snowtrace.io/tx/0xd4854b905b74d4a03ae35e15c34489c308c099ae929c1dcc7667e1b10d1cf783) | GPT-OSS 20B | 4 (4) | $0.242 | 150 | $0.000037 | Paid. Not sampled for a spot check. |
| [#10](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x9948428d…`](https://testnet.snowtrace.io/tx/0x9948428dde354c683c58b8e8ec7bc15f8ef77258db86bde86fe45b25ee3f9631) | GPT-OSS 120B | 4 (4) | $0.464 | 174 | $0.000081 | Paid. A second node re-ran it and matched. |
| [#11](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 from the MCP tool [`0x26b608b5…`](https://testnet.snowtrace.io/tx/0x26b608b595097456741a057ade9807f345f18602d1cd87325867e631bdb9009c) | GPT-OSS 20B | 4 (4) | $0.237 | 126 | $0.000030 | Paid. A second node re-ran it and matched. |
| [#12](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x178c8309…`](https://testnet.snowtrace.io/tx/0x178c8309dc12826b7a49ef216befefa51e0f5ee8994347c74fcc48de5d1a0d4e) | GPT-OSS 20B (verify) | 4 (4) | $0.239 | 182 | $0.000044 | Paid. A second node re-ran it and matched. |
| [#13](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0xeb86c8ff…`](https://testnet.snowtrace.io/tx/0xeb86c8fff87545f16787d9b245287364c4066123c8d7fb7c77a87ea4404cbab9) | GPT-OSS 20B | 4 (4) | $0.229 | 129 | $0.000030 | Paid. A second node re-ran it and matched. |
| [#14](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x4372d1a3…`](https://testnet.snowtrace.io/tx/0x4372d1a37ec4f3ed27e289b2052f5397e1e44d69ca72703bfcbd52f43b395ed9) | GPT-OSS 120B (verify) | 4 (4) | $0.464 | 149 | $0.000070 | Paid. A second node re-ran it and matched. |
| [#15](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x2efd52ea…`](https://testnet.snowtrace.io/tx/0x2efd52ead65235cd37e6f9b8e992fc4fde4d14dde2adc97ef30acc71f3c17c3c) | GPT-OSS 20B | 4 (4) | $0.226 | 145 | $0.000033 | Paid. Not sampled for a spot check. |
| [#16](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0xd8edea71…`](https://testnet.snowtrace.io/tx/0xd8edea716f9e3a9e6a997d871e72ba25a06a62a71b210e942660b85cc272cf18) | GPT-OSS 20B | 4 (4) | $0.233 | 132 | $0.000031 | Paid. A second node re-ran it and matched. |
| [#17](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 [`0x212ee852…`](https://testnet.snowtrace.io/tx/0x212ee8529e3a5de8984f08c52c8917ec12f2e5ba45d6db1c260bac8c6df2b6ec) | GPT-OSS 20B | 4 (4) | $0.062 | 136 | $0.000009 | Paid. Not sampled for a spot check. |
| [#18](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 from the web app (QA signer) [`0xbe1efe7f…`](https://testnet.snowtrace.io/tx/0xbe1efe7f989ff06393e0d35eccd019ed8e926a7fab870ac5f256347c8797ef8a) | GPT-OSS 20B | 4 (4) | $0.219 | 186 | $0.000041 | Paid. Not sampled for a spot check. |
| [#19](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 from a fresh test wallet (web build) [`0x33128459…`](https://testnet.snowtrace.io/tx/0x331284593c88b466f9e6407b5f7a8facc6aa2d78e7238d729e27b5d8c82cbd6e) | GPT-OSS 20B | 4 (4) | $0.220 | 182 | $0.000041 | Paid. Not sampled for a spot check. |
| [#20](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | private credit, top-up proved in the browser [`0x39cfc2ef…`](https://testnet.snowtrace.io/tx/0x39cfc2efdeda833030834d1a1c3e06621b18ac69ab71746727179770b0a270c3) | GPT-OSS 20B | 4 (4) | $0.217 | 187 | $0.000041 | Paid. Not sampled for a spot check. |
| [#21](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | x402 from a fresh test wallet (hosted app) [`0x3b6ad2dd…`](https://testnet.snowtrace.io/tx/0x3b6ad2dd7792dae146c400b3e94021363a3658fdc77fb27c1e6fbddec2f29141) | GPT-OSS 20B | 4 (4) | $0.208 | 184 | $0.000039 | Paid. Not sampled for a spot check. |
| [#22](https://testnet.snowtrace.io/address/0x57fc4ab7de82ea555d957d88ff27bf4ff463814b) | private credit, top-up proved in the browser [`0xa9bb56e2…`](https://testnet.snowtrace.io/tx/0xa9bb56e2cf20e7474794d8a46a2fb5300c772fcc1c0402b07a5af75594a35382) | GPT-OSS 20B | 4 (4) | $0.216 | 187 | $0.000041 | Paid. A second node re-ran it and matched. |

#### Index

- GPT-OSS 20B: index $0.216 per 1M tokens, TWAP 1h $0.216, VWAP 24h $0.234 over 3009 tokens, 19 clearings.
- GPT-OSS 120B: index $0.464 per 1M tokens, TWAP 1h $0.464, VWAP 24h $0.491 over 517 tokens, 3 clearings.

#### Totals

jobs 23, clearings 23, staked $39.00, paid to providers $0.003161, slashed $1.00 in 1 slash(es)

#### The index under a dumping seller (job #17)

dune's margin was set to 0.3, so it bid about 70% under everyone else. It won at $0.062 per 1M tokens and delivered a real answer, so the clearing is real and the job record keeps it. The index moved only the allowed 25%, from $0.233 to $0.174 ([settlement](https://testnet.snowtrace.io/tx/0x212ee8529e3a5de8984f08c52c8917ec12f2e5ba45d6db1c260bac8c6df2b6ec) posted the job; the clamp is visible in `XorvIndex.observations`: `rate` 62, `indexRate` 174). dune's margin learned its way back up after the win. The clamp also fired on its own at job #2, when the nodes switched from a flat cost to Groq's published per-token prices and the clearing fell from $0.321 to $0.220: the index stepped to $0.240 and converged over the next clearings.

#### A compute forward, settled (forward #0)

The buyer went long 10M tokens of GPT-OSS 20B at a strike of $0.240 per 1M against provider atlas for 25 minutes, 2 tUSD margin each ([offer](https://testnet.snowtrace.io/tx/0xd2c079f836f217ab8a9c360e25aed51ef58982f437d5ca6276f40c7e8fabdb87), [take](https://testnet.snowtrace.io/tx/0x7577caa3b3ce12b1abca2f48e8f7aca572877788d13f9da03637ec6d46b1ecd0)). Seven auctions cleared during its life. At expiry the index TWAP over the forward's life was $0.234, so compute got cheaper and the long paid the short 0.06 tUSD ([settle](https://testnet.snowtrace.io/tx/0x7479dddceedacfc3b44b1ba127a2656a3c0ab85304650e3c3f9d4d295f7e4463)).
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

## Hosted

- **App:** https://xorv-avax.vercel.app (Vercel, production build, no QA signer). `/api/*` and `/v1/*` are rewritten
  to the hosted gateway. Nothing to install: **Start with a test wallet** on the chat page (or Account) makes a key in
  the browser and funds it in the same tap; Core or MetaMask work too, and an empty one gets **Get test funds**.
- **Test funds:** `XorvGasStation` ([`0xfc23…cfb1`](https://testnet.snowtrace.io/address/0xfc23826ad39591f10fed2397ce5c87278806cfb1))
  sends a wallet that signed a request 2 tUSD, plus 0.001 AVAX if it holds none. Once per wallet, 40 a day, 4 a day per
  requester (an HMAC of the IP, never the IP), all enforced on-chain; it refills its tUSD from the test dollar's faucet.
  The gateway's `POST /api/fund` is only the relayer (`XORV_SPONSOR_KEY`). Funded from the Avalanche funding hub.
  The test wallet's key sits in the browser's local storage: it is for Fuji test funds only.
- **Gateway + four provider nodes:** https://xorv-api.201-18-198-162.sslip.io (`/api/health`, `/v1/models`,
  `POST /v1/chat/completions` → 402, `/api/fund`) on the hackathon VPS, one container, `deploy/docker-compose.yml`. The
  nodes run Groq with the provider key; the server holds only the desk (facilitator) key, the four node keys, the gas
  station relayer key, the tag secret and `GROQ_API_KEY`.
- **Checked from the hosted app with a fresh, empty browser** (no wallet extension, empty storage;
  `web/scripts/judge-flow.mjs --private`, Nov 12, 0 console errors): one tap funded test wallet `0xAA2f…E7e6`
  ([drip](https://testnet.snowtrace.io/tx/0xa083e7e4482968570f3c9e51f16323b97dee6caef14492eb325bccc5bddfcccc)); a paid chat
  became job #21 ([x402 settlement](https://testnet.snowtrace.io/tx/0x3b6ad2dd7792dae146c400b3e94021363a3658fdc77fb27c1e6fbddec2f29141)),
  four sealed bids, answered in 39 s; then a private top-up proved in the page with Ava Labs' eERC SDK
  ([register](https://testnet.snowtrace.io/tx/0xaa69efc2a996ebea36d59dd599bc979a0bb5569ba06637fb6fa4e5c958bcadbd),
  [approve](https://testnet.snowtrace.io/tx/0x5a3fd95713378a7a703388a6d90b417c8ac2945318afcdedd97423af84308ec9),
  [deposit](https://testnet.snowtrace.io/tx/0xaf34324a88f11fbecfffcbe9e43af9b81d9a33f4e9dec150ef5a767909c6fd19),
  [encrypted transfer to the desk](https://testnet.snowtrace.io/tx/0x6ef07a1352ce0dca948b906518ca9a4f48849ffd531a2688fc520ab3c4f01efb),
  22 s for all four), the desk's receipt passed all five checks, and a chat paid from private credit became job #22
  ([desk post](https://testnet.snowtrace.io/tx/0xa9bb56e2cf20e7474794d8a46a2fb5300c772fcc1c0402b07a5af75594a35382)), which
  names the desk, not the wallet. The same run against the production build on a laptop: jobs #19 and #20.
- Agents: `XORV_GATEWAY=https://xorv-api.201-18-198-162.sslip.io node scripts/x402-client.ts "question"`.

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
- **x402 details** (wire format in [docs/X402.md](docs/X402.md)). Network `avalanche-fuji`, scheme `exact`, asset tUSD (EIP-712 domain "Xorv Test Dollar", version 1), `payTo` the router. The gateway checks the signature, expiry, payee, amount and balance before spending gas, then settles. If someone front-runs the facilitator by submitting the signature straight to the token, the job is not created, the call fails loudly, and `X402Router.refundStray` returns that exact payment (the token records which signed transfer consumed each nonce).

## eERC: what is hidden and what is not

- **Hidden:** the amount of each buyer top-up to the desk and of each provider payout to its treasury; encrypted balances. Only the holder, the receiver and the auditor can read them.
- **Not hidden:** sender and receiver addresses of eERC transfers (that is how eERC works), deposit and withdrawal amounts (they are ERC-20 transfers), and every job's cleared price (that is the index's whole point). Jobs posted from private credit are public, but they name the desk, not the buyer.
- **Trust:** the desk is an operator. It sees which buyer spent what, keeps the credit ledger in the gateway (a file, not on-chain: the amounts are exactly what eERC hides, so they cannot sit in a public contract) and posts on their behalf. The auditor (`0x6aAf…84F4`) can decrypt every amount.
- **The ledger is checkable, not trustless.** On every credit request and private chat the desk signs a receipt of all its lines for that buyer (`receiptMessage` in `packages/sdk/src/receipt.ts`). The Account page checks it against Fuji: signed by the desk address in the deployment; each top-up is a real `PrivateTransfer` from the buyer to the desk **and its amount equals what the buyer's own proof moved** (the sender ciphertext in the proof's public signals, decrypted with the buyer's eERC key in the tab); every transfer from the buyer to the desk on-chain is listed; every private job was posted by the desk in that transaction; and credit = top-ups − escrows + (escrow − charge) of settled jobs, with the charge read from the market. A desk that under-credits, drops a top-up or invents a charge is caught, with its own signature as evidence; nothing stops it from refusing service. Tested on a local chain, including a receipt edited after signing and one the desk really signed with an inflated amount.
- **What is official:** the EncryptedERC, Registrar, BabyJubJub and production verifier contracts are Ava Labs' code at commit [`8dc98cd`](https://github.com/ava-labs/EncryptedERC/tree/8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1), vendored unmodified in `contracts/lib/eerc` under the Ava Labs Ecosystem License. Proofs use Ava Labs' published circuits and proving keys (the browser's copies are sha256-checked at build). The web app uses Ava Labs' official SDK, `@avalabs/eerc-sdk` 1.0.2 (its `EERC` class with viem clients; its wagmi hooks are not used and are stubbed out of the bundle), for the key, registration, deposit, the encrypted transfer and balance decryption; it loads only on the private-credit page. The Node client in `packages/eerc` (a port of Ava Labs' encryption helpers) runs the desk, the scripts and the local-chain tests.

## Run it

Requirements: Node 22.18+ (TypeScript runs natively), pnpm 10, Foundry. Fuji test AVAX for the accounts.

```bash
pnpm install
pnpm circuits                                   # Ava Labs eERC circuits into .eerc/circuits (~57 MB, not committed)
cd contracts && forge test && cd ..             # 79 contract tests
bash scripts/test-local.sh                      # 20 tests on a fresh local chain with the full deployment
```

Use the live Fuji deployment:

```bash
node scripts/keys.ts                             # test accounts into the gitignored .env (addresses printed, keys never)
XORV_ENV_FILE=/path/to/.env.with.GROQ_API_KEY pnpm gateway     # gateway on :5421 + four provider nodes
node scripts/x402-client.ts "your question" [--verify]          # a buyer agent paying with x402
cd web && pnpm build && pnpm preview             # the app; /api and /v1 proxy to the gateway
node packages/mcp/src/main.ts                    # MCP server (stdio) for agents
```

Provider nodes need `GROQ_API_KEY` and, for Claude, `ANTHROPIC_API_KEY` (read by name only, passed to node processes and nothing else). A fresh deployment: `node scripts/fund-deployer.ts`, `node scripts/deploy.ts`, `node scripts/setup-providers.ts`, then `node scripts/private-lane.ts` for the eERC auditor and registrations, and `node scripts/gas-station.ts` for the test-funds station (its relayer is `XORV_SPONSOR_KEY`; the gateway also needs `XORV_TAG_SECRET`, which the script creates). Slashing demo: start the gateway with `XORV_GATEWAY_NODES=atlas:1.2,birch:1.08,cobalt:1.35,dune:1.15:deliver` and send a `--verify` chat.

Repository: `contracts/` (Foundry; eERC vendored in `contracts/lib/eerc`), `packages/sdk` (the `Xorv` client, reads, x402, similarity, `followJob`, `verifyJob`), `packages/cli` (the `xorv` buyer CLI), `packages/node` (provider node and the `xorv-node` CLI), `examples/`, `packages/gateway` (OpenAI-compatible API, x402 facilitator, private desk), `packages/eerc` (eERC client), `packages/mcp` (agent tools), `web/` (Vite + React), `scripts/`, `deployments/`.

## Limits

- tUSD is this repo's test dollar, not USDC, and has no value. Groq and Anthropic costs are real (a few hundred tokens per answer).
- Similarity is word-set Jaccard with a 50% tolerance: it catches junk, not subtle errors. Token counts are reported by the winner and capped by the buyer's maximum.
- A chat takes about 25–35 seconds: two 10-second auction windows plus model time and Fuji confirmations. The answer is returned at delivery; checks continue after.
- Gas: on Fuji a transaction is charged at least half its gas limit, so the nodes' fixed limits overpay slightly; at Fuji's fee level that is negligible.
- The public Fuji RPC rate-limited this machine during testing; the apps fall back across publicnode, drpc and the official endpoint, and read history from the Snowtrace indexer API. drpc's free plan refuses JSON-RPC batches of more than 3 calls (HTTP 400), so batches to it are capped at 3 (they were not before Nov 12, which made the fallback fail whenever publicnode dropped a request). A browser still logs a network error when a public RPC drops a connection, even though the next endpoint answers.
- Forwards settle within a day after expiry at the TWAP from start to the settle time. The Fuji forward ran 25 minutes (a week is the intended term).

## Prior work

Xorv is an existing project of the author, now built for Avalanche. Earlier versions, all disclosed:

- xorv-near (NEAR testnet, Nov 9–12, 2026; not yet public): the approved black-and-white OpenRouter-style UI and its 3D monochrome art set, the chat playground where each answer is a sealed-bid job, provider nodes with a pre-bid self-check, random spot checks and slashing, an OpenAI-compatible gateway and x402-style payments. **Reused here:** the web app's layout, styles, components and art (`web/`, `docs/ART-3D.md`), the node and gateway structure, the similarity rule and prompt packing.
- [xorv](https://github.com/nickthelegend/xorv) (Hedera), [xorv-monad](https://github.com/nickthelegend/xorv-monad) (Monad), [xorv-arc](https://github.com/nickthelegend/xorv-arc) (Arc), [xorv-arbitrum](https://github.com/nickthelegend/xorv-arbitrum) (Arbitrum, private), [xorv-clockin](https://github.com/nickthelegend/xorv-clockin) (Solana), [xorv-wif](https://github.com/nickthelegend/xorv-wif) (Robinhood Chain, private): earlier explorations of paid idle AI capacity, x402 and escrow. No Solidity was copied from them.
- [xorr-zk-avax](https://github.com/nickthelegend/xorr-zk-avax): an earlier eERC project by the author; its funded Fuji key paid this repo's 0.08 AVAX.

**Built new for this Avalanche build (Nov 12, 2026):** all Solidity (market, registry, router, index, forwards, test dollar, on-chain similarity, gas station; the gas station follows Kumi on Avalanche's `KumiGasStation`, by the same author), the EVM SDK, x402 exact scheme on Fuji with a settlement router, the provider node and gateway for EVM, the Compute Index and its page, the eERC private credit lane and client, the forward, the tests and the Fuji deployment.

## AI tools used

Claude Code (Claude Opus) wrote the code, tests and docs. The 3D object art was generated earlier with ChatGPT images for xorv-near and is reused. No Codex.

## License

MIT, Copyright (c) 2026 Nivesh Gajengi. `contracts/lib/eerc` is Ava Labs' code under the Ava Labs Ecosystem License.
