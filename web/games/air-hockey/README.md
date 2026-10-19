# 🏒 Air Hockey

Table air hockey, first to 7 · 1–2 players · **coming soon**

Arcade air hockey: the mallet follows the stick, the puck is fast, the table is noisy. Perfect two-minute game.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ✕ | Strike (a quick push forward) |
| Stick | Move the mallet |

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Table with goals, a puck that slides and bounces
- [ ] Mallets follow the stick with a speed limit
- [ ] Goals and first to 7
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- 2-v-2 on a wide table
- Power-ups (two pucks)

## Notes

2D canvas is enough, or a simple 3D table.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
