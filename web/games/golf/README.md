# Crazy Golf

Mini golf, everyone at once · 1–8 players · Sports · **coming soon**

Mini golf where everyone plays the hole at the same time (balls pass through each other). Ramps, windmills, loops.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Aiming |
|---|---|
| ✕ | Putt: hold for power |
| ○ | Cancel |
| △ | Look at the hole |
| Stick | Aim |

## Competition

**Exhibition** · **Tournament**

Stroke play over 9 or 18 holes; ties go to a sudden-death playoff hole.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Three holes with slopes and walls
- [ ] Ball rolling physics
- [ ] Simultaneous turns with a short timer
- [ ] Strokes counted, scorecard at the end
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- 18 holes
- Moving obstacles
- Hole editor (holes as json)

## Notes

3D, top-down camera. Rolling physics is close to football's ball on grass.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
