# Laser Tag

Twin-stick arena shooter, teams or free-for-all · 2–8 players · Action · **coming soon**

Neon arena, tag the other team. You're never out for long: get tagged, flash for three seconds, back in.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ✕ | Fire (where you face) |
| ○ | Dash |
| □ | Shield |
| △ | Ping (show enemies briefly) |
| R1 | Hold: strafe (keep facing) |
| Stick | Move and face |

## Competition

**Exhibition** · **League** · **Cup**

Teams of up to 4; matches of 3 rounds.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One arena with cover
- [ ] Move, aim by facing, fire
- [ ] Tags and respawns
- [ ] Teams and a 3-minute timer
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Capture zones
- Power-ups
- Night mode with lights only

## Notes

Top-down 3D with glow. One stick means aiming by facing (R1 locks it).

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
