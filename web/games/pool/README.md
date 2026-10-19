# Pool

8-ball, take turns · 1–2 players · Sports · **coming soon**

8-ball pool on a proper table. Calm game after football: line it up, choose the power and spin, pass the turn.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Aiming | Ball in hand |
|---|---|---|
| ✕ | Shoot: hold for power | Place the cue ball |
| ○ | Cancel / look around | — |
| □ | Spin: cycle top / back / side | — |
| L1 | Fine aim left | — |
| R1 | Fine aim right | — |
| Stick | Aim | Move the cue ball |

## Competition

**Exhibition** · **Cup** · **Ladder**

Race-to-N frames in each round. The ladder: challenge anyone up to two places above you; win and you swap.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Table with cushions and pockets; ball-to-ball collisions that feel right
- [ ] Aim line with a short guide
- [ ] Power and spin
- [ ] 8-ball rules: groups, fouls, ball in hand, the black
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- 9-ball
- Trick-shot challenges
- Cue and cloth colours

## Notes

Top-down 3D. Physics is the whole game: fixed-step simulation like football's (60 Hz).

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
