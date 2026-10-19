# 🤼 Sumo Push

Push everyone off the platform · 2–8 players · **coming soon**

Round platform, slippery, and everyone wants you off it. Charge, dodge, and time your shove.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ✕ | Shove (charge by holding) |
| ○ | Dodge |
| □ | Brace (hard to push, can't move) |
| Stick past the ring | Charge run |

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Platform and simple round bodies with mass
- [ ] Shove, dodge, brace
- [ ] Falling off; last one on wins
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Shrinking or tilting platforms
- Hazards

## Notes

3D with simple shapes; football's player collision (`separate()` in match.ts) is the same idea.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
