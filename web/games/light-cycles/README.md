# Light Cycles

Leave a wall of light; make them hit it · 1–8 players · Arcade · **playable**

Neon bikes that leave a solid trail. Box people in, don't get boxed in. Rounds last seconds.

## Controls

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. Here the phone shows the d-pad: turn with the arrows; ✕ boosts, hold ○ to brake (`controls.json`).

| Button | Riding |
|---|---|
| ✕ | Boost (short, then a 3 s wait) |
| ○ | Brake (hold) |
| D-pad, stick or arrow keys | Turn 90° |

## Competition

**Party** · **Cup**

First to 5 round wins.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable: done

- [x] Arena and trails
- [x] Turning, crashing
- [x] Rounds and a score
- [x] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [x] Two keyboard players can play it too (they come free with `Input`)

Also built: computer riders (they weigh up open space), walls that close in after 25 seconds, fast-forward
once every person is out, a demo round behind the lobby, saved records per player, and a manual.

## Files

- `arena.ts`: the rules (grid, riders, crashes, the computer riders), no drawing
- `draw.ts`: the canvas drawing, cheap enough for a 1 GB TV
- `main.ts`: lobby, rounds, results, saved records, the phones
- `manual.json`, `controls.json`, `game.json`

## Later

- 3D view from behind the bike
- Teams
- Power-ups: jump over a trail

## Notes

2D top-down first; a 3D chase camera later. Glow is allowed here: it's the game's world, not the UI.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
