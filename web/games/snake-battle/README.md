# Snake Battle

Everyone is a snake. Eat, grow, cut them off · 2–8 players · Arcade · **coming soon**

All snakes on one board at once. Eat to grow; hit anything and you're out. Cut across someone's path to finish them.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ✕ | Boost (costs length) |
| Stick | Turn |

## Competition

**Party** · **Cup**

Best of 5 rounds; knockout for big groups.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Board with food
- [ ] Snakes that grow and crash
- [ ] Last one alive wins the round
- [ ] Best of 5
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Walls that close in
- Teams

## Notes

2D grid. Trivial to sync: everyone's on one screen anyway.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
