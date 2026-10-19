# Baseball

Pitch, swing, run the bases · 1–2 (teams) players · Sports · **coming soon**

Three-inning games: one side pitches and fields, the other bats. Pitching is choosing a pitch and a spot; batting is timing and aiming the swing.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Batting | Pitching | Fielding |
|---|---|---|---|
| ✕ | Swing (timing) | Fastball | Throw to first |
| ○ | Bunt | Curveball | Throw to second |
| □ | Power swing | Changeup | Throw to third |
| △ | Steal / run | Pickoff | Throw home |
| Stick | Aim the swing | Aim the pitch | Move the fielder |

## Competition

**Exhibition** · **League** · **Series**

A short season, then the top four play best-of-3 series. Extra innings break ties.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Diamond, pitcher and batter, a ball with a believable flight
- [ ] Swing timing decides contact; aim decides direction
- [ ] AI fielders chase and throw; runners advance
- [ ] Balls, strikes, outs, three innings
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Pitch types with real break
- Diving catches
- Pass the pad between innings for 1-player-per-side

## Notes

3D. The ball physics in football's `match.ts` (drag, bounce) is a good start for a batted ball.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
