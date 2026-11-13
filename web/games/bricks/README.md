# Bricks

Paddle, ball, bricks: co-op or head to head · 1–4 players · Arcade · **playable**

The classic, for a crowd. Co-op: up to four paddles share the bottom edge and clear wall after wall
together. Versus: everyone gets the same wall, side by side, and races to clear it, sending junk and
shrinks across to the others.

## Controls

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. Here the phone shows the stick while you play (`controls.json`); the buttons say what
they'd do right now (Launch, Fire, Send Junk).

| Button | Playing |
|---|---|
| Stick | Move the paddle (past the ring: faster) |
| Bolt | Launch the ball; let go of a caught one; hold to fire the laser |
| Drop | Versus: send the power-up you hold (junk or shrink) to your rivals |

## Competition

**Arcade** · **Versus**

Co-op is a run for score: the team's best scores are saved (top ten), and each player's best, walls and
bricks. Versus is first to 1, 2 or 3 round wins (best of 3 by default).

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Paddle-and-bricks games go back to *Breakout* (1976). Our own board shapes, power-ups, colours and sounds; nothing taken from Breakout or other versions. See [Originality](../README.md#originality).

## First playable: done

- [x] Paddle, ball, bricks that break
- [x] Angles off the paddle
- [x] Power-ups: multi-ball, wide paddle
- [x] Levels
- [x] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [x] Two keyboard players can play it too (they come free with `Input`)

Also built:

- **Ten hand-made walls** (`levels.ts`), drawn as text: tough bricks (two or three hits, a pip per hit
  left), steel that never breaks, charges that blow up their neighbours (and set each other off), and
  bricks that always drop a power-up. After the tenth the walls come round again, a little faster.
- **The ball**: where it lands on the paddle sets the angle (straight up off the middle, about 55° off the ends) and the paddle's
  movement drags it a further 12° or so; it never goes nearly flat. It speeds up the longer it's in play
  and goes back to its starting speed when a ball is lost. It moves by sweeping (see `sim.ts`), so it
  can't pass through a brick or a paddle at any speed.
- **Power-ups**: wide, multi-ball (every ball becomes three), laser, slow, catch, extra ball; in versus
  also junk (a row of bricks drops onto every rival's wall, pushing it down) and shrink.
- **Co-op**: the paddles keep their order along the bottom and can't pass through each other; with
  three or four of you, two balls are served. A combo multiplier for bricks broken without touching a
  paddle (×2 at five, up to ×8). A bonus for each wall.
- **Versus**: first to clear the wall takes the round; else the last one with a ball; else (time up
  after 2:30) whoever broke the most.
- **Computer players**: partners in co-op, rivals in versus (beatable), and the demo behind the lobby.
  If a phone drops mid-game the computer keeps its paddle until it's back.
- Sparks, flying shards, explosion rings, screen shake on big hits, a note that climbs with the combo,
  stars at the end, saved records per player.

## Files

- `levels.ts`: the walls
- `sim.ts`: the rules (fields, paddles, the swept ball, bricks, power-ups, the computer players, judging
  a versus round), no drawing
- `draw.ts`: the canvas drawing, cheap enough for a 1 GB TV (bricks painted once into a layer)
- `sound.ts`: synthesised sound
- `main.ts`: lobby, co-op and versus flow, HUD, results, saved records, the phones
- `manual.json`, `controls.json`, `game.json`

## Later

- Level editor (levels as json)
- Four-way versus is small on one screen: a narrower field for three or four players

## Notes

2D canvas.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
