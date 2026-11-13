# Pool

8-ball, take turns · 1–2 players · Sports · **playable**

8-ball pool on a proper table. Calm game after football: line it up, choose the power and spin, pass the turn.
Play a friend (a phone each, or one phone passed between you) or the computer at three strengths, for one frame
or the best of three or five.

## Controls

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. While it's your shot the phone shows the stick; the rest of the time, the d-pad for menus
(`controls.json`).

| Button | Aiming | Ball in hand |
|---|---|---|
| Stick | Aim: gently for small turns, all the way (or past the ring) for big ones | Move the cue ball |
| Bolt | Shoot: hold, the power swings up and back down; let go to shoot | Put the cue ball down |
| Drop | Cancel the shot; with the ball in hand, pick the cue ball up again | — |
| Leaf | Spin: a tap is the next one (centre, follow, draw, stun, left, right); hold it and the stick puts the tip anywhere | — |
| Star | Camera: behind the cue or overhead | Camera |
| L1 / R1 | Fine aim: a tap is 1/20 of a degree, held it creeps | — |
| ❚❚ (pause) | Resume, concede the frame, quit | |

The phone shows the power as a bar while you hold Bolt. Two keyboard players work too (WASD with F to shoot, G spin,
T camera, Q/E fine aim; and the arrows with , . ; K L). Enter starts, Esc pauses or goes back, M mutes.

## How it works

- `physics.ts`: the balls, no drawing. A flat table in metres (an 8-foot bed, 57 mm balls), each ball with a velocity
  and a full spin. Sliding friction at the cloth turns slide into roll (so draw, follow and stun come out of the
  physics rather than being faked), then rolling resistance; side spin dies away slowly. Ball on ball is nearly
  elastic, with surface friction that falls off with slip speed (the measured curve for pool balls), so cut shots
  and side spin throw the object ball a degree or two and pass spin across. Cushions lose more energy the harder
  they're hit, rub side spin into running or check english, and take most of the roll out. The pockets have jaws
  at the real angles (corners 142°, sides 104°, narrowing into the throat), so a ball that hits one can rattle out;
  a ball drops when its centre gets over the hole. It runs in fixed 1/1200 s substeps, and every collision is wound
  back to the moment of contact before it's resolved, so a break can't tunnel or send balls through each other.
- `rules.ts`: 8-ball. The break (legal: a ball potted or four to a cushion), the open table, groups, fouls (in-off,
  no ball hit, wrong ball first, no cushion after the hit) with ball in hand, the 8 (early, or with a foul, loses).
- `ai.ts`: the computer. It finds pots a player would see (a clear line from ball to pocket and from cue ball to the
  ghost ball, a makeable cut, a pocket it can enter), then plays the best few out on a copy of the table with the
  real physics, a few milliseconds a frame. Medium checks which go in; Hard also tries follow and draw and picks the
  shot that leaves it the best next pot. With nothing on, it plays a safety that leaves you the worst shot (off a
  cushion if it has to). Then it shoots with human error: about a degree of aim on Easy, a seventh of one on Hard.
  With ball in hand it puts the cue ball behind its best pot.
- `view.ts`: three.js. The table is built from the physics' own cushion and pocket outlines; a lamp over it, ball
  shadows, lacquered balls that turn with their real spin. The cue sits on the point the tip will strike and lifts
  over the rail when the cue ball is close to one. The guide runs to the first ball (or cushion), with a ghost ball
  where they meet (red if that ball is a foul to hit first), the object ball's line and the cue ball's line after it.
  Cameras: behind the cue, overhead, and a broadcast view while the balls run.
- `audio.ts`: clicks, cushion thuds, pockets and the tip, synthesised (no files).
- `main.ts`: lobby, turns, the computer's turn (it moves the cue ball in hand, turns the cue, draws it back), pause,
  results, saved records (wins, frames, best run, the strongest computer beaten) and stars.

House rules, to keep it moving on a sofa: no calling shots (any of your balls in any pocket counts, the 8 too), an
illegal break or the 8 on the break means a fresh rack, and the first ball potted after the break decides the groups.

## Competition

**Exhibition** (one frame, or best of 3 or 5) · Cup · Ladder

Race-to-N frames in each round. The ladder: challenge anyone up to two places above you; win and you swap.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

8-ball's rules are a century old and belong to everyone. Our own table, cloth colour, cue and look, all built in code.
See [Originality](../README.md#originality).

## First playable: done

- [x] Table with cushions and pockets; ball-to-ball collisions that feel right
- [x] Aim line with a short guide (long or short, in the lobby)
- [x] Power and spin
- [x] 8-ball rules: groups, fouls, ball in hand, the black
- [x] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [x] Two keyboard players can play it too (they come free with `Input`)

Also built: the computer at three strengths, pass-the-phone for two, matches of 3 or 5 frames, saved records.

## Later

- 9-ball
- Trick-shot challenges
- Cue and cloth colours (a `shop.json`)
- Calling the pocket for the 8 (and a "call shots" setting)
- Jump and massé shots (an elevated cue)
- Cup and Ladder competitions

## Notes

Physics is the whole game: fixed 60 Hz game steps, each 20 physics substeps. The physics module has nothing from the
browser in it, so it can be run (and tested) with node on its own.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
