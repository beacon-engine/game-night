# Table Tennis

Fast rallies, spin and smashes · 1–4 players · Sports · **coming soon**

Close to the table, fast. Spin is the game: topspin dips, backspin floats, sidespin curves, and returning it badly sends it long or into the net.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Rally | Serving |
|---|---|---|
| Bolt | Topspin drive | Serve (topspin) |
| Drop | Push / backspin | Serve (backspin) |
| Leaf | Smash | Serve (sidespin) |
| Star | Block | — |
| Stick | Move and aim | Aim the serve |

## Competition

**Exhibition** · **Cup** · **Groups + knockout**

Groups of 4, top two into a knockout; best of 5 games to 11.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Table, net, ball with spin and a short, fast bounce
- [ ] Bat follows the stick; shot choice decides spin
- [ ] Serve rules (bounce on each side)
- [ ] Games to 11
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Doubles with alternating hits
- Spin you can see on the ball
- Tournament mode

## Notes

Could be 3D or a tilted 2.5D view; a close camera behind each player works for 1-v-1.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
