# 🚩 Capture the Flag

Two teams, two flags · 2–8 players · **coming soon**

Grab their flag, bring it home while yours is still there. Tag carriers to send them back.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ✕ | Tag (when close) |
| ○ | Dash |
| □ | Pass the flag to a teammate |
| Stick past the ring | Sprint |
| Stick | Move |

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Map with two bases
- [ ] Pick up, carry, capture
- [ ] Tagging and returns
- [ ] First to 3
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Bigger maps
- Power-ups

## Notes

3D with the shared player model, top-down camera.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
