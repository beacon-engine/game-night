# Bricks

Paddle, ball, bricks: co-op or head to head · 1–4 players · Arcade · **coming soon**

The classic, for a crowd: up to four paddles on the sides of the board, or two players racing to clear mirrored walls.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| Bolt | Launch the ball |
| Drop | Use power-up |
| Stick | Move the paddle |

## Competition

**Arcade** · **Versus**

Level runs for score; versus best of 3.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Paddle-and-bricks games go back to *Breakout* (1976). Our own board shapes, power-ups, colours and sounds; nothing taken from Breakout or other versions. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Paddle, ball, bricks that break
- [ ] Angles off the paddle
- [ ] Power-ups: multi-ball, wide paddle
- [ ] Levels
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Versus: bricks you break drop on the other side
- Level editor (levels as json)

## Notes

2D canvas.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
