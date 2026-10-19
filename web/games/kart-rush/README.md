# Kart Rush

Arcade kart racing with items, drifts and shortcuts · 1–4 players · Racing · **coming soon**

Party kart racing: drift to charge a boost, grab item boxes, throw things at whoever is winning. Short, loud and close.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Driving |
|---|---|
| ✕ | Accelerate |
| ○ | Brake / reverse |
| R1 | Hop and drift (hold) |
| □ | Use item |
| △ | Throw item behind |
| Stick | Steer |

## Competition

**Exhibition** · **Cup** · **Battle**

Cups of 4 races, points per position; battle mode in arenas.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One track with a shortcut
- [ ] Drift boost
- [ ] Three items
- [ ] Up to 4 in split screen, AI fills the grid
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Battle arenas
- More tracks and items
- Danfo, okada and keke karts

## Notes

3D. This takes over the arcade side of the old "Racing" idea.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
