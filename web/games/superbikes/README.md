# Superbikes

Motorbike Grand Prix: lean, brake late, get your knee down · 1–4 players · Racing · **coming soon**

Grand-prix motorbike racing on real-feeling circuits. Bikes are about lean angle and braking points: tip in too fast and you run wide or lowside. Slipstream on the straights, outbrake into the corner.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Racing |
|---|---|
| ✕ | Throttle |
| ○ | Front brake |
| □ | Rear brake |
| L1 | Tuck in (more top speed) |
| R1 | Look behind |
| Stick | Lean (left/right), weight forward/back |

## Competition

**Exhibition** · **Race weekend** · **Championship** · **Career**

Weekend: free practice, qualifying (Q1/Q2 sets the grid), sprint race, main race. Championship: a calendar of rounds with points for the top 15 (25-20-16-13-11-10-9-8-7-6-5-4-3-2-1). Career: start in the lightweight class, move up to premier with a team.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One circuit, one bike class
- [ ] Lean, grip, braking; crashing and rejoining
- [ ] Slipstream
- [ ] AI riders; a 5-lap race with positions
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Lightweight, middleweight and premier classes
- Tyre wear and weather
- Wheelies and stoppies
- Photo finish

## Notes

3D, chase camera; split screen for 2–4. The rider can reuse the motion-capture skeleton from football for tucking and leaning.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
