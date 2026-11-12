# Xorv on Avalanche: where it stands against the rubric

Honest self-score after the 9/10 round (Nov 12, 2026), against the Avalanche Speedrun weights.

| Criterion (weight) | Before (Nov 12 am) | After hosting | 9/10 round | Why |
|---|---|---|---|---|
| Does it work (30%) | 7.5 | 8 | 8.8 | A judge with an empty browser finishes the main flow on the hosted app: one tap makes a test wallet and `XorvGasStation` funds it, then a paid chat runs a sealed-bid auction on Fuji and answers in about 40 s with its Snowtrace settlement (job #21, 0 console errors). The private lane runs from the same page (job #22). Not higher: a chat still takes 25-40 s (two 10-second auction windows), and Groq is the only model host. |
| Idea and originality (25%) | 8 | 8 | 8.2 | Per-request sealed-bid auctions over idle AI capacity, paid with x402, feeding an on-chain compute price index that forwards settle against. Private spend through eERC. |
| Technical depth (20%) | 8 | 8 | 9 | On-chain text similarity and slashing, a manipulation-resistant index, x402 settled into escrow in one transaction, forwards, eERC proofs made in the browser with Ava Labs' SDK, signed desk receipts checked down to the sender ciphertext of the buyer's own proof, a gas station whose limits live on-chain. 99 tests, no mocked chains. |
| Avalanche fit (15%) | 7.5 | 7.5 | 8 | x402 on Fuji where per-request auctions are affordable; eERC for a real job (private AI spend with an auditor); the gas station works because C-Chain gas is cheap. No own L1, no ICM/ICTT. |
| Demo and communication (10%) | 7 | 7 | 7.5 | Screenshots at 1440 and 375, README with every transaction, slides outline. The 3-minute film is not cut. |
| **Weighted** | **7.7** | **7.8** | **8.4** | |

## What is left for 9/10, in order of value

1. **The film.** Lead with an empty browser: Start with a test wallet → ask → watch four sealed bids, the winner, the
   answer and the Snowtrace settlement → Private credit: top up privately (proofs in the page) → the five green checks
   → a private chat that names the desk. Then the index page and the slashed job #8.
2. **The desk ledger is checkable, not trustless.** Receipts catch a cheating desk; they do not stop one from refusing
   service. An on-chain ledger would publish the amounts eERC hides; a stronger design would keep encrypted per-buyer
   credit in a contract the desk updates with proofs. Not built.
3. **Speed.** Shorter commit/reveal windows (the contract allows 3 s) would bring a chat under 15 s at the cost of
   fewer bids on a quiet chain.
4. **Own L1 or ICM.** Not used, and not claimed.

## The `net::ERR_CONNECTION_CLOSED` on the hosted landing

Not reproduced: three headless loads of the hosted landing (up to 90 s each, with its polling) logged no failed request
and no console error, before and after this round's deploy. What was found while looking: the browser's RPC fallback
was broken. drpc's free plan answers HTTP 400 to any JSON-RPC batch of more than 3 calls, and the app sent it batches
of any size, so whenever publicnode dropped a request (a dropped connection is what Chrome logs as
`net::ERR_CONNECTION_CLOSED`), the drpc fallback failed too. Batches to drpc are now capped at 3 and to the others at
20. A browser still logs a network error when a public RPC drops a connection; the read then succeeds on the next
endpoint, and the page shows no error.

## Things that are real and easy to miss

- The gas station's limits are on-chain: a second gateway, a restart or a leaked relayer key cannot pay a wallet
  twice or pass 40 drips a day. The per-requester tag is an HMAC of the IP; no IP goes on-chain.
- The test wallet's key never leaves the browser; the gateway sees only a signature over (station, chain, wallet,
  deadline). It is for Fuji test funds only, and the page says so.
- The receipt check decrypts the sender ciphertext from the buyer's own transfer proof in the tab, so a desk that
  signs a wrong amount fails even though the signature is genuine (tested on a local chain).
- Ava Labs' SDK and snarkjs load only on the private-credit page; the circuit files are Ava Labs' published build at
  the pinned commit, sha256-checked when the site is built.
