# Xorv 3D object kit

Single calm objects for a black-and-white developer product. The UI stays monochrome with no accent colour, so the
objects do too. Xorv is infrastructure, so the objects carry no face.

- **Material:** satin white porcelain for the main body, matte black ceramic for structure, small brushed graphite
  details. Engineered proportions, precise rounded bevels, no toy look. No colour, no chrome, no polished silver, no
  glitter.
- **Palette (from `packages/web/src/styles.css`):** main porcelain `#efefef` (`--ink`), structure matte black `#101010`
  (`--surface`), detail graphite `#3a3a3a` (the button hover border), rim light pure white `#ffffff` (`--white`). The
  UI's status green `#4ade80` and red `#f87171` never appear in the art.
- **Face:** none. The object alone carries the meaning.
- **Background:** transparent (no ground shadow) for every object. On the near-black page each sits on a faint white
  radial light (`.art3d::before`) so the black ceramic parts keep their edge.
- **Subjects:** GPU card (providers), chat bubble (chat), sealed envelope (sealed bids), gavel (the auction clears),
  server rack (nodes, gateway setup), coin (credits), key (API keys), magnifier (spot checks), cracked shield
  (slashing), empty tray (empty states), check-mark badge (success), warning sign (errors), trophy (rankings), and a
  sculpted X-and-node logo-mark candidate.

Style line used in every prompt (ChatGPT, one fresh chat, one image per message):

> Premium developer-infrastructure 3D render, strictly monochrome (only black, white and neutral grey, zero colour, no
> tint, no warm or blue cast): main body in satin white porcelain #efefef, structural parts in matte black ceramic
> #101010, small details in brushed graphite #3a3a3a, a soft pure white #ffffff rim light, soft studio lighting, crisp
> subtle reflections, precise rounded bevelled edges, calm engineered proportions (not toy-like, not cartoon), no face,
> one single centred object with generous empty margin around it, transparent background (no background, no ground
> shadow, no floor), square 1024x1024, no text, no letters, no numbers, no logos.

The first check-mark badge and trophy came back with polished chrome rims and stems; both were regenerated with
"no shiny metal, no chrome, no silver anywhere" and matte black ceramic in place of the graphite.

Files: `packages/web/public/art/3d/xorv-3d-<subject>.webp` (trimmed, padded square, 640 px, transparent, 17-31 KB
each). 3D art generated with ChatGPT.

## Where each object is used

Sparingly, at OpenRouter density. Never inside a chat thread.

| Object | File | Used in |
|---|---|---|
| Chat bubble | `xorv-3d-chat.webp` | `/chat` empty state (112 px, 80 px on phones), in place of the small logo mark |
| Sealed envelope | `xorv-3d-envelope.webp` | Landing "How every answer clears": Sealed bids |
| Gavel | `xorv-3d-gavel.webp` | Landing row: Lowest bid wins |
| Magnifier | `xorv-3d-magnifier.webp` | Landing row: Random re-runs (percentage read from `get_config`) |
| Cracked shield | `xorv-3d-shield.webp` | Landing row: Liars get slashed (percentage read from `get_config`) |
| Server rack | `xorv-3d-rack.webp` | `/providers` header; "Setup required: start the Xorv gateway" on Credits and API keys |
| GPU card | `xorv-3d-gpu.webp` | `/providers/join` header |
| Trophy | `xorv-3d-trophy.webp` | `/rankings` header |
| Coin | `xorv-3d-coin.webp` | `/account` (Credits) header |
| Key | `xorv-3d-key.webp` | `/keys` header and the "No keys yet" empty state |
| Check-mark badge | `xorv-3d-success.webp` | "Copy your key now" after a key is created |
| Empty tray | `xorv-3d-empty.webp` | No models (landing, models), no providers match, no bounties, no usage |
| Warning sign | `xorv-3d-warning.webp` | "Could not read the contract" on models, providers, rankings, bounties, usage and the provider rules |
| X-and-node mark | `xorv-3d-mark.webp` | Logo-mark candidate only; the header keeps the flat mark |

Header objects are 104 px and hidden below 640 px; state objects are 72 px (56 px on phones); landing objects are
64 px. Every object has a fixed width and height, a faint white radial light behind it, and a 4 px float over 6 s that
stops under `prefers-reduced-motion`.
