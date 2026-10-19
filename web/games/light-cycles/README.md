# Light Cycles

Leave a wall of light; make them hit it · 2–8 players · Arcade · **coming soon**

Neon bikes that leave a solid trail. Box people in, don't get boxed in. Rounds last seconds.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Riding |
|---|---|
| ✕ | Boost (short, cooldown) |
| ○ | Brake |
| Stick | Turn 90° |

## Competition

**Party** · **Cup**

First to 5 round wins.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Arena and trails
- [ ] Turning, crashing
- [ ] Rounds and a score
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- 3D view from behind the bike
- Teams
- Power-ups: jump over a trail

## Notes

2D top-down first; a 3D chase camera later. Glow is allowed here: it's the game's world, not the UI.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
