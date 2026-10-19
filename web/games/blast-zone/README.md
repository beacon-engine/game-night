# Blast Zone

Drop bombs, blow walls, last one standing · 2–8 players · Action · **coming soon**

A grid maze of breakable blocks. Drop bombs, blow up blocks, find power-ups, trap each other.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ✕ | Drop a bomb |
| ○ | Kick a bomb (with the power-up) |
| □ | Detonate (remote power-up) |
| Stick | Move on the grid |

## Competition

**Exhibition** · **Party** · **Cup**

Best of 3 rounds per match; knockout for bigger groups.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Grid with solid and breakable blocks
- [ ] Bombs, blast lines, chain reactions
- [ ] Power-ups: more bombs, bigger blasts, speed
- [ ] Last one standing, best of 3
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Shrinking arena at the end
- Teams
- Level themes

## Notes

2D top-down, or 3D blocks with a fixed camera.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
