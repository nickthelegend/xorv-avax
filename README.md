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
| TestDollar tUSD (6 decimals, EIP-3009, faucet) | [`0x2210a2161b13a1a2375951577b506707867f9739`](https://testnet.snowtrace.io/address/0x2210a2161b13a1a2375951577b506707867f9739) |
| EncryptedERC (Ava Labs, converter) | [`0xf0f1d107bbca6568e0ff0cec580cf053e1b73787`](https://testnet.snowtrace.io/address/0xf0f1d107bbca6568e0ff0cec580cf053e1b73787) |
| Registrar (Ava Labs) | [`0x335d199e8442ddad556c874a065801ba0ac63350`](https://testnet.snowtrace.io/address/0x335d199e8442ddad556c874a065801ba0ac63350) |
| eERC verifiers (registration, mint, withdraw, transfer, burn) | [`0xc209…bca7`](https://testnet.snowtrace.io/address/0xc209d4402a2e1c12b7e91155d71cefe42df1bca7), [`0x0503…31d3`](https://testnet.snowtrace.io/address/0x050323ac0c920effb5bcfeed4feb4b7a035b31d3), [`0xe9df…c1c4`](https://testnet.snowtrace.io/address/0xe9df883c6758acc8058db196a73841cb7f5eb1c4), [`0x9e7b…5cf0`](https://testnet.snowtrace.io/address/0x9e7bf355f92d35e7e9f372b1737aa83bcad55cf0), [`0x3834…3b92`](https://testnet.snowtrace.io/address/0x3834ebc73323f24eb8ddc83a348095854c953b92) |

Every address, deployment transaction and recorded run is in [deployments/fuji.json](deployments/fuji.json). An earlier market deployment (same tUSD and eERC, market `0x3130…a07c`) was replaced after Fuji testing showed the spot-check draw waited for a later block that a quiet Avalanche chain may not produce; its jobs stay on-chain but are not counted here.

<!-- EVIDENCE:START -->
#### Jobs on the current market (19)

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

#### Index

- GPT-OSS 20B: index $0.217 per 1M tokens, TWAP 1h $0.178, VWAP 24h $0.240 over 2269 tokens, 15 clearings.
- GPT-OSS 120B: index $0.464 per 1M tokens, TWAP 1h $0.464, VWAP 24h $0.491 over 517 tokens, 3 clearings.

#### Totals

jobs 19, clearings 19, staked $39.00, paid to providers $0.002799, slashed $1.00 in 1 slash(es)

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

- **App:** https://xorv-avax.vercel.app (Vercel, production build; no QA signer, so paying from it needs a Fuji wallet
  such as Core or MetaMask holding tUSD). `/api/*` and `/v1/*` are rewritten to the hosted gateway.
- **Gateway + four provider nodes:** https://xorv-api.201-18-198-162.sslip.io (`/api/health`, `/v1/models`,
  `POST /v1/chat/completions` → 402) on the hackathon VPS, one container, `deploy/docker-compose.yml`. The nodes run
  Groq with the provider key; the server holds only the desk (facilitator) key, the four node keys and `GROQ_API_KEY`.
- **Checked:** job #18 was paid and answered through the hosted gateway
  ([settlement](https://testnet.snowtrace.io/tx/0xbe1efe7f989ff06393e0d35eccd019ed8e926a7fab870ac5f256347c8797ef8a)): the
  web app's QA build ran on a laptop with its `/api` proxy pointed at the VPS, signed x402 with the QA test key, and the
  four hosted nodes bid, dune won and delivered. The Vercel page loads the live index, models and job table from the same
  gateway with no console errors.
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
- Forwards settle within a day after expiry at the TWAP from start to the settle time. The Fuji forward ran 25 minutes (a week is the intended term).

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
