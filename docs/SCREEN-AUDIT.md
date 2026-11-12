# Xorv: screen-by-screen audit (ship round, Nov 12–13, 2026)

Every hosted route and state of https://xorv-avax.vercel.app at 1440 and 375, judged before and after this round.
Screenshots: `orchestration/shots/avax-xorv/ship/before/` (hosted, before) and `.../ship/after/` (hosted, after),
`<route>-desktop.png` / `<route>-mobile.png`; the signed-in judge path (test wallet → paid chat → private top-up →
receipt → private chat) is in `.../9round/judge-*.png` from the Nov 12 round and was not changed. The look is unchanged
(black and white, Golos Text and Nanum Gothic Coding, the porcelain-and-ceramic 3D kit, no orange); fixes are copy,
layout, states and function only, plus new objects from the existing kit.

| Screen / state | Width | Before | What was wrong | Fix | After |
|---|---|---|---|---|---|
| Landing | 1440 | 7.5 | "One API for the AI nobody's using" needs a second read to get; no hero object; a search box competed with the call to action; seven sections (models, how, index, two payment cards, jobs, provider line). | Headline "Every AI request goes to the lowest bidder", one sub-line (pay per message, sealed auction, public price index on Avalanche), one primary action (Start chatting). A new hero object (chat bubble on an auction block). Four sections: how it works (3 steps, new objects), a price nobody can fake (live index + private credit), use it from chat, code or an agent (x402 endpoint, models), check it yourself (latest jobs + five contracts on Snowtrace). OG card with real type. | 9 |
| Landing | 375 | 7.5 | Same positioning issue; latest-jobs rows very tall. | As above; headline wraps naturally; contracts in two columns; four jobs instead of six. | 8.5 |
| Chat, signed out | 1440 | 7.5 | "Start with a test wallet" ran into the sentence before it (an inline paragraph); the empty state repeated a filler line ("Each message is a sealed-bid auction…") that the footer said again; sidebar filler under "No chats yet". | Button on its own row; one short line ("Providers bid for every message. The lowest bid answers."); footer says only the spot-check rate and slashing; sidebar just "No chats yet." | 9 |
| Chat, signed out | 375 | 6.5 | Suggestion cards ran off the right edge (grid tracks sized to their nowrap text); "Private credit" toggle wrapped to two lines; placeholder cut off. | `minmax(0, 1fr)` tracks so the cards fit; toggle labels nowrap; placeholder "Connect a wallet to chat". | 9 |
| Chat, paid answer (x402) / private answer | both | 9 | Unchanged this round (judge path jobs #21, #22). | — | 9 |
| Compute Index | 1440 / 375 | 8.5 | Header object (a gavel) didn't say "price index". | New stepped price-line object. | 9 |
| Models, model detail | both | 9 | — | — | 9 |
| Providers, provider detail | 1440 | 9 | — | — | 9 |
| Providers | 375 | 8.5 | The providers table scrolls sideways for the stake and earnings columns. | — | 8.5 |
| Become a provider | both | 9 | — | — | 9 |
| Rankings | both | 9 / 8.5 | Mobile section tabs scroll sideways (by design); latest-activity table scrolls. | — | 9 / 8.5 |
| Job detail, paid and slashed | both | 9 | — | — | 9 |
| Private credit | both | 9 | — | — | 9 |
| Account, signed out | 1440 | 8 | Two identical coins (page header and the state). | The state shows the key object and "Start paying per message". | 9 |
| Account, signed out | 375 | 7.5 | Coin pinned left beside centred text. | State art stacks above centred text on phones. | 9 |
| Not found | both | 9 | — | — | 9 |
| Gateway offline (Setup required) | both | 9 | Shown when `/api/health` fails: "Setup required: start the gateway" with the command; read from code, not forced on the hosted site. | — | 9 |
| Loading (skeletons) | both | 9 | — | — | 9 |

## Screens still below 9, and why

- **Landing, Providers and Rankings at 375 (8.5):** the shared jobs and providers tables keep one line per row and
  scroll sideways for the last columns. Turning them into cards would change the approved OpenRouter-style table
  look; left as is.
