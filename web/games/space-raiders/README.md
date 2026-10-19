# Space Raiders

Co-op shoot-em-up: waves, bosses, power-ups · 1–4 players · Arcade · **coming soon**

A vertical shooter you play together on one screen. Waves of raiders, power-ups that change your shot, and a boss at the end of each stage.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Flying |
|---|---|
| ✕ | Fire (hold) |
| ○ | Bomb (clears bullets) |
| □ | Focus: slow, precise movement |
| Stick | Move |

## Competition

**Arcade** · **Score attack**

Credits and continues; a high-score table with initials.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One stage and a boss
- [ ] Enemy waves and bullet patterns
- [ ] Power-ups and bombs
- [ ] Shared lives, high score
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- More stages
- Revive a fallen partner
- Versus mode: send enemies to the other side

## Notes

2D canvas is fine; pixel-art or flat vector, in brand colours.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
