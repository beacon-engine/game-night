# Cricket

T5: five overs of bat, bowl, field · 1–4 players · Sports · **coming soon**

Five-over innings each. Batters pick their shot and time it; bowlers choose line, length and pace or spin; fielders chase it down.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Batting | Bowling | Fielding |
|---|---|---|---|
| ✕ | Play the shot (timing) | Bowl | Throw to the keeper |
| ○ | Defend / block | Bouncer | Throw to the bowler's end |
| □ | Loft it | Yorker | Dive |
| △ | Run / call | Slower ball | — |
| Stick | Where to hit it | Line and length | Move the fielder |

## Competition

**Exhibition** · **League** · **Groups + knockout**

T5 league with net run rate on the table; knockouts end in a super over if tied.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Pitch, stumps, a bounce off the pitch that depends on length
- [ ] Batting with timing and direction; 4s and 6s
- [ ] Bowled, caught, run out
- [ ] Two five-over innings and a chase
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Spin with turn off the pitch
- LBW
- Teams and ratings
- Super over on a tie

## Notes

3D. Share the ball physics and the player model with football.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
