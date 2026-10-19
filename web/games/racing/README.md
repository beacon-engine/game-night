# 🏎️ Racing

Split-screen circuit racing · 1–4 players · **coming soon**

Arcade circuit racing, everyone on one screen (split for 2–4). Drift through corners to fill a boost bar.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Driving |
|---|---|
| ✕ | Accelerate |
| ○ | Brake / reverse |
| □ | Boost |
| R1 | Drift |
| △ | Look behind |
| Stick | Steer |

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One track with walls and a start line
- [ ] Car handling with grip and drift
- [ ] Split screen for up to 4
- [ ] Laps, positions, a finish
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- More tracks
- AI racers
- Pickups (kart style)
- Danfo and okada skins

## Notes

3D. Split screen = one renderer, several viewports (`renderer.setViewport` / `setScissor`).

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
