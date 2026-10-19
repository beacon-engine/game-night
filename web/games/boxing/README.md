# Boxing

Three rounds, one winner · 1–2 players · Sports · **coming soon**

Footwork and timing over button mashing. Stamina drains with every punch thrown; a tired boxer is slow and open.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Fighting |
|---|---|
| Bolt | Jab |
| Drop | Cross |
| Leaf | Hook |
| Star | Uppercut |
| L1 | Block (hold) |
| R1 | Duck / slip |
| Stick | Move around the ring |

## Competition

**Exhibition** · **Title fight** · **Tournament** · **Career**

Weight classes (lightweight to heavyweight), rankings by class, belts to win and defend. Tournament: 8-boxer knockout. Career: start unranked, fight up the rankings, take the belt.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Ring, two boxers, hit reactions
- [ ] Punches with reach and timing; blocks
- [ ] Stamina and health
- [ ] Knockdowns, a count, three rounds and points
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Career mode
- Weight classes
- Punch combos with a bonus

## Notes

3D. The motion-capture rig used for football fits; punches can be posed procedurally like football's kicks.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
