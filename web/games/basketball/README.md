# Basketball

3-on-3 half court · 1–6 players · Sports · **coming soon**

Street-court 3-on-3 to 21, half court, make-it-take-it. Quick passing, pick-and-rolls and a shot meter that rewards a clean release at the top of the jump.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | With the ball | Defending |
|---|---|---|
| Bolt | Pass (toward the stick) | Switch player |
| Drop | Bounce pass | Steal |
| Leaf | Shoot: hold, release at the top of the jump | Jump / block |
| Star | Lob / alley-oop | Call for a pick |
| L1 | Crossover | — |
| R1 | Spin move | Hold: double-team |
| Stick past the ring | Sprint | Sprint |

## Competition

**Exhibition** · **League** · **Cup** · **Groups + knockout**

Seasons of 3-on-3 between street-court crews; the cup is a single-elimination bracket, games to 21 (win by 2). Tie on the league table: head to head, then points difference.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Half court, hoop with a backboard and rim the ball can bounce off
- [ ] 3 players a side, AI teammates and opponents
- [ ] Dribble, pass, shoot with a timing meter, rebound
- [ ] Scoring to 21 (2s and 3s), check-ball after a score
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Dunks and layups by speed and angle
- Fouls and free throws
- Full court 5-on-5
- Player ratings like football's teams.json

## Notes

3D with three.js. The people and their moves come from [`web/people/`](../../people/README.md), as the footballers do: a basketball cast (vests, long shorts, high-tops) and its moves are recipes in `tools/people/recipes/`.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
