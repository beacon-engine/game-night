# Rooftop Brawl

Platform fighter: knock them off the roof · 2–4 players · Action · **coming soon**

A platform fighter: the more damage you take the further you fly. Knock everyone off the rooftops.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Fighting |
|---|---|
| ✕ | Attack (direction from the stick) |
| ○ | Jump (twice in the air) |
| □ | Special |
| L1 | Shield / dodge |
| R1 | Grab |
| Stick | Move |

## Competition

**Exhibition** · **Tournament** · **Ranked**

Stock matches; tournaments double-elimination; ranked rating.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Platform fighters are a genre; nothing from Super Smash Bros. (characters, damage display, stages, items). See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One rooftop stage with platforms
- [ ] Damage percent and knockback
- [ ] Stocks (3 lives)
- [ ] 2–4 players
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- More stages
- Items
- Characters with different moves

## Notes

Side view, 3D models or sprites.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
