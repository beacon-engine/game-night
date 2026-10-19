# Beach Volleyball

2-on-2 on the sand · 1–4 players · Sports · **coming soon**

Bump, set, spike. Each side gets three touches; the timing of the jump decides how hard the spike is.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Rally | Serving |
|---|---|---|
| ✕ | Bump / set (to your partner) | Serve |
| ○ | Dive | Jump serve |
| □ | Spike: jump, hit at the top | — |
| △ | Block | — |
| Stick | Move; aim the hit | Aim |

## Competition

**Exhibition** · **Cup** · **Tour**

Beach tour: pairs, pool play then knockout, best of 3 sets.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Court, net, a floaty ball
- [ ] Three touches a side, auto-position for a partner
- [ ] Spikes and blocks
- [ ] Rally scoring to 21
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Indoor 6-a-side
- Weather and wind

## Notes

3D. Reuse the player model; the ball is lighter and slower than a football.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
