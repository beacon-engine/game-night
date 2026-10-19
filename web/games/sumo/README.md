# Sumo Push

Push everyone off the platform · 2–8 players · Action · **coming soon**

Round platform, slippery, and everyone wants you off it. Charge, dodge, and time your shove.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ✕ | Shove (charge by holding) |
| ○ | Dodge |
| □ | Brace (hard to push, can't move) |
| Stick past the ring | Charge run |

## Competition

**Exhibition** · **Basho**

Basho: everyone fights everyone over a set of days; most wins takes the title.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Platform and simple round bodies with mass
- [ ] Shove, dodge, brace
- [ ] Falling off; last one on wins
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Shrinking or tilting platforms
- Hazards

## Notes

3D with simple shapes; football's player collision (`separate()` in match.ts) is the same idea.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
