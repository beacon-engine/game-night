# Long Tennis

Singles and doubles on grass or clay · 1–4 players · Sports · **coming soon**

Proper tennis scoring with quick, arcade-feel rallies: position early, pick the shot, and aim with the stick as you swing.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Rally | Serving |
|---|---|---|
| ✕ | Topspin | Flat serve |
| ○ | Slice | Slice serve |
| □ | Lob | Kick serve |
| △ | Drop shot | — |
| R1 | Hold: run to the net | — |
| Stick | Move; aim as you swing | Aim the serve |

## Competition

**Exhibition** · **Cup** · **Tour**

Knockout draws of 8 or 16 with seeding; best of 3 sets (5 in the final). The tour is a season of tournaments on different surfaces with ranking points.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Court, net, a ball with spin that bounces true
- [ ] Auto-swing forehand/backhand when in reach; shot choice and aim
- [ ] Serving with faults and lets
- [ ] Points, games, a short set
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Doubles
- Surfaces (grass skids, clay slows)
- Player styles: baseliner, serve-and-volley

## Notes

3D. The rally needs good ball prediction; football's `predictPath` does the same job.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
