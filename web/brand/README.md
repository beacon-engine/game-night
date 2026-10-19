# Beacon Arcade brand

One look for the game select page, the phone pad and every game's menus and HUD. It's defined once,
in [`brand.css`](brand.css); pages link it with `<link rel="stylesheet" href="/brand/brand.css">`.
If something you need isn't here, add it here rather than in your game, so the next game gets it too.

**The idea:** a night in. The room is dark, the TV is the light. Near-black surfaces, warm off-white type,
and one electric accent that always means "this one". The colours of the pad's four buttons are the
only other colours, so the brand and the controller in your hand are the same thing.

## Colour

| Token | Hex | Use |
|---|---|---|
| `--ink-0` | `#07080b` | the page |
| `--ink-1` | `#0e1016` | panels, tiles |
| `--ink-2` | `#161922` | raised: selected rows, glyphs |
| `--ink-3` | `#20242f` | tracks of bars |
| `--line` / `--line-strong` | `#262a36` / `#3a3f4e` | 1px hairlines, borders |
| `--chalk` | `#f3f0e8` | text |
| `--chalk-2` / `--chalk-3` | `#a6a4ae` / `#6a6875` | secondary / faint text |
| `--volt` | `#d7ff3b` | **the** accent: focus, selection, the main action, "ready" |
| `--bolt` `--drop` `--leaf` `--star` | `#ffc23d` `#4c8dff` `#2ee59d` `#ff5ecf` | the pad buttons; highlighting one word |
| `--good` `--warn` `--bad` | | stamina, cards, connection |

Player colours (P1–P8, the same in every game) are in `web/platform/pad.ts`: the four pad colours, then
amber, violet, orange and teal.

Rules:
- **Volt means "you are here" or "do this".** One volt thing per area: the selected item, the main button.
  Never decoration, never body text.
- One highlighted word per headline at most (`.hl-volt`, `.hl-bolt`...): *Pick your* **sides**.
- No gradients, glows or drop shadows on UI. The one exception: a soft dark shadow behind text that sits
  directly on the 3D scene, for legibility (`.over-pitch`).
- Team and kit colours come from the game's data; they're content, not brand.

## Type

- **Big Shoulders Display**, 700–900, UPPERCASE: titles, game names, scores, menu items (`.display`, `.h1`–`.h3`).
  Tall and condensed: it reads from the sofa.
- **Inter**, 400–700: everything else (body, buttons, numbers in tables).
- **Captions**: Inter 600, 12px, UPPERCASE, tracked 0.14em, `--chalk-2` (`.caption`, `.eyebrow` with its volt dash).
- The pair GAME / NIGHT is solid / outline (`.outline`). Use outline type sparingly, only for that kind of pair.

Both fonts are bundled in `fonts/` (SIL Open Font License), so it all works offline.

## Shape and motion

- Flat surfaces, 1px hairlines, almost square corners (`--r-1` 2px, `--r-2` 4px). Round only for pad buttons.
- **The frame**: viewfinder corners in volt around the selected tile (`.frame` + `.sel`). It's the signature;
  use it for "what the stick is on" in grids.
- In lists, selection is `--ink-2` background + a 3px volt bar on the left.
- Motion is quick and quiet: 120–200 ms, ease-out (`--ease`). Things fade and slide a few pixels, never bounce.
  `prefers-reduced-motion` turns it off.

## Components

| | Class / helper |
|---|---|
| Buttons | `.btn`, `.btn-primary` (volt; one per screen), `.btn-lg`, `.btn-icon` |
| Panels | `.panel`, `.panel-glass` (over the 3D scene) |
| A pad button | `glyph('bolt')` from `@platform`: the Bolt icon in its colour. `glyph('stick')`, `key('Enter')` for help text |
| Controls help | `.legend` of `<span>${glyph('bolt')} Play</span>` |
| A player | `chip(player)` from `@platform`: colour block, P1, name |
| Status | `.tag`, `.tag-volt` |
| QR code | `.qr` (a light tile so phones read it in a dark room) |
| Logo | `.wordmark` with `.mark` (the four pad buttons in their diamond); `mark.svg` is the favicon |

## Icons

Line icons, 2px stroke, round caps ([Tabler Icons](https://tabler.io/icons), MIT). A game's icon is
`icon.svg` in its folder; the page draws it as a mask in the right colour (volt when playable,
chalk otherwise), so the svg's own colours don't matter. No emoji in the UI.

## Voice

Short, warm, plain: "Scan to join", "Pick your sides", "Coming soon". Players never see technical
detail (memory sizes, frame rates, URL settings): say what works and what to do instead, e.g. "This TV
isn't powerful enough for Football. Play it on a laptop, or pick another game." Details go to the console. Write labels in sentence case;
the CSS turns titles, buttons and captions into capitals.

## Pad buttons

The four face buttons are our own icons, drawn in `web/platform/icons.ts`. Always use them (or their
names) for buttons, never another console's symbols.

| Button | Where | Colour | Usually |
|---|---|---|---|
| **Bolt** | bottom | `--bolt` amber | the main action: choose, start, jump, fire |
| **Drop** | right | `--drop` blue | back, cancel, a second action |
| **Leaf** | left | `--leaf` green | a third action |
| **Star** | top | `--star` pink | How to play in lobbies; a special move |

In a manual's text, write `{bolt}` (etc.) to draw the button.
