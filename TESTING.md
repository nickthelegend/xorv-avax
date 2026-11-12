# Testing

Every test that touches a chain runs against real contracts: Foundry's EVM for the Solidity suites, and a fresh local Anvil chain with the full deployment (market, registry, index, router, test dollar and Ava Labs' eERC with its production verifiers) for the TypeScript suites. No mocked clients, no stub RPCs. The live Fuji runs are listed in [README](README.md#live-on-fuji) and recorded in [deployments/fuji.json](deployments/fuji.json).

| Suite | Command | Tests | Result (Nov 12, 2026) |
| --- | --- | --- | --- |
| Contracts (Foundry) | `cd contracts && forge test` | 55 (one fuzz test, 256 runs) | 55 passed |
| SDK, eERC and gateway on a local chain | `bash scripts/test-local.sh` | 19 | 19 passed |
| **Total** | | **74** | **74 passed** |

`scripts/test-local.sh` starts Anvil on port 5546, deploys with `scripts/deploy.ts`, registers the four provider nodes, runs the suites and stops Anvil. The eERC suite generates real Groth16 proofs with the official circuits, so run `pnpm circuits` once first (it fetches Ava Labs' `circom/build` artifacts at the pinned commit into `.eerc/circuits`).

## Contracts: 55

**Market (23).** Lowest revealed rate wins and the buyer pays only for the tokens used; ties go to more stake, then the earlier commit; a reveal must match its sealed commitment; commit and reveal windows are enforced; a bid above the buyer's ceiling is rejected; one bid per provider and only registered nodes bid; unbonding providers and providers that do not serve the model cannot bid; no reveals means a full refund; only the winning node delivers; tokens are capped at the buyer's maximum; a sampled check that matches pays the checker; "verify" jobs are always checked; a checker must quote the real stored result; **a lying provider is slashed and the buyer compensated**; **a lying checker is slashed and the provider paid**; a winner that never delivers is slashed; a checker timeout still pays the provider; the draw cannot resolve inside the delivery block; an aged-out draw block forces a check; stake rules (unbonding, open jobs) and the node key cannot withdraw; only the market touches stake; only the owner withdraws earnings; fuzz: escrow is always fully accounted.

**x402 (13).** A payment funds a job owned by the signer, not the facilitator, and the refund goes back to the signer; **replay through the router and directly on the token is rejected**; **expired** and **not-yet-valid** authorizations are rejected; underpayment; a tampered amount or a forged signer; a payment signed for another payee; a canceled authorization; only the router posts x402 jobs; a front-run direct submission fails loudly and the stray payment is refundable exactly once; the refund cannot drain posted jobs; faucet cooldown.

**Index and similarity (13).** A paid, competitive clearing updates the index; TWAP weighs time and VWAP weighs tokens; any contract can read it (a `ComputeQuoter` consumer); **a wash bid without delivery never moves the index**; bids alone and expired auctions never reach it; a single-bidder job is not indexed; a buyer winning its own job is not indexed; a slashed delivery is not indexed; **one outlier clearing moves the index at most 25%**; only the market writes; empty reads; on-chain Jaccard similarity cases; two 6,000-byte outputs compare in under 4M gas.

**Forwards (6).** Compute got dearer, so the long is paid; cheaper, so the short is paid; payoff capped at margin; no early or late settlement, refund after the window; **a last-minute wash bid cannot move a forward's settlement**; offer rules (duration bounds, no self-trade, cancel).

## SDK, eERC and gateway on a local chain: 19

**SDK (6).** TypeScript similarity equals the on-chain `Similarity` library byte for byte across ASCII, Unicode, empty and long texts; the bid commitment equals `XorvMarket.bidCommitment`; x402 signing and off-chain verification catch a raised amount, a wrong payee, underpayment, expiry and a wrong network; the token accepts the SDK's EIP-712 signature on-chain; prompt packing; reader decoding.

**eERC with Ava Labs' official contracts and circuits (8).** Registration with a real proof and setting the auditor; the same account signature always derives the same eERC key; deposit, private transfer, decrypt as receiver and as auditor, with the plaintext matching the on-chain ElGamal ciphertext and never appearing in the logs; **overspending cannot be proven** (the circuit refuses); **a tampered proof is rejected on-chain** by the production verifier; transfers to or from unregistered accounts revert; withdraw returns public tUSD; a key from another signature cannot decrypt.

**Gateway as a real process (5).** An unpaid call gets HTTP 402 with exact-scheme requirements; garbage, underpaid, expired and unfunded payments are refused before gas is spent; a valid payment settles on-chain into a job the payer owns and **its replay gets 409**; an unserved model is refused; the private credit lane: wrong signer and stale signatures are rejected, credit equals exactly the encrypted top-up the desk decrypted, the posted job does not name the buyer, a signed request cannot be replayed or have its body changed.

## Browser QA

`web/scripts/qa-flow.mjs` drives the built app in headless Chrome with a build-flagged QA signer (`VITE_XORV_QA=1`; the key is injected at runtime by Playwright and never enters a bundle or the repo) and sends one real paid chat on Fuji through the UI. `web/scripts/shots.mjs` captures every route at 1440 px and 375 px and checks for horizontal overflow and console errors. Results: [deployments/fuji.json](deployments/fuji.json) `evidence.webQaFlow`, screenshots in `/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-xorv/`.

## What is not tested

- Output similarity is word-set Jaccard. It catches junk and unrelated answers; it does not judge quality, and two honest runs of a nondeterministic model can disagree (the tolerance is 50%).
- Token counts are reported by the winning node and capped at the buyer's maximum; the checker's own count is recorded beside it but not enforced.
- The desk's credit ledger lives in the gateway (a file), not on-chain.
- Browser-side eERC proving is not built; top-up proofs are made by the Node client.
