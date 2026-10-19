# Capture the Flag

Two teams, two flags · 2–8 players · Action · **coming soon**

Grab their flag, bring it home while yours is still there. Tag carriers to send them back.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| Bolt | Tag (when close) |
| Drop | Dash |
| Leaf | Pass the flag to a teammate |
| Stick past the ring | Sprint |
| Stick | Move |

## Competition

**Exhibition** · **League** · **Cup**

First to 3 captures; teams in a league or bracket.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Map with two bases
- [ ] Pick up, carry, capture
- [ ] Tagging and returns
- [ ] First to 3
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Bigger maps
- Power-ups

## Notes

3D with the shared player model, top-down camera.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
