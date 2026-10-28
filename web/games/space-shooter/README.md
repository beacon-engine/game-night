# Space Shooter

Co-op side-scrolling shooter: waves, bosses, power-ups · 1–4 players · Arcade · **playable** (in progress)

Up to four of you fly together across three stages, with a boss at the end of each, sharing your spare ships and
your score. Clear all three and they come round again, faster and tougher.

## Playing

| Button | Flying |
|---|---|
| Stick | Fly |
| Bolt | Fire (hold) |
| Leaf | Focus (hold): slower, and your fire tightens up, for slipping between shots |
| Drop | Bomb: clears every enemy shot and hits everything it sweeps over |

The lobby sets the difficulty (Easy, Normal, Hard), how many computer wingmen fly with you (0 to 3; they don't use
the team's ships) and the stage to start at. Bindings are in `controls.json`.

- **Weapons.** Blaster (more streams as it powers up), Spread (a fan), Laser (a beam through everything in a line)
  and Missiles (homing, alongside the blaster). Pickups: P powers up what you have; S, L and M change it (or power it
  up if it's the one you have); ◆ a shield that takes one hit; B a bomb; + a spare ship for the team.
- **Getting hit.** Only the middle of your ship counts, not the wings. When you're shot down you lose a weapon level
  (it floats there to be grabbed again) and fly back in while the team has ships left.
- **Bosses.** Armoured until their guns are shot off; then the core opens and fights back harder.
- **Score.** Kills close together build a chain: every five adds one to the multiplier, up to ×8. A stage clear
  pays a bonus to everyone still flying. Out of ships, you get ten seconds to continue; the high score table
  (`high-scores` in the game's saves) notes the continues, the stage reached and the difficulty.
- **More ships, more to shoot.** Bosses take 40% more for each ship after the first (a lone pilot gets them 20%
  easier), and the rest of the enemies a little more. Joining mid-game takes over a wingman's ship.

## How it's made

| File | |
|---|---|
| `stages.ts` | The data: the enemies, the three stages (their waves, their look) and their bosses, the pickups, the difficulties. |
| `sim.ts` | The rules, no graphics: ships and weapons, enemy paths and fire, bosses, hits, pickups, lives, the chain, and the computer pilot (wingmen and the demo). |
| `scene.ts` | three.js: the models turned to face the camera (the field is a flat plane facing it), a moving nebula, layers of stars, a planet and scenery drifting past behind, glowing shots, beams, explosions (sparks, smoke, shockwaves, a flash), screen shake and bloom. |
| `sound.ts` | Synthesised shots, explosions, pickups, bombs, the boss warning and an engine hum. |
| `main.ts` | The flow: lobby (with the demo), stage intros, the boss warning, stage clear, continue, results, the high score table, saved records, stars, the phones. |

`?stage=2&at=96` starts a game at the second stage's boss (for testing). The rules can be run without a browser
(the AI flies every ship), which is how the stages were balanced.

## Art

Ships, enemies, bosses and scenery are [Kenney's Space Kit](https://kenney.nl/assets/space-kit) (CC0): the models
the game uses are in `models/`, the whole pack as downloaded in `source/` (not shipped). Each ship's trim is its
pilot's colour; the shop (`shop.json`) sells hull paint jobs.

## Originality

Side-scrolling shooters are a whole genre (from the early 1980s on). Our own enemies, stages and bosses, no
borrowed names, layouts or patterns. See [Originality](../README.md#originality).

## Later

- More stages and bosses
- Revive a fallen partner by flying through their wreck
- Versus mode: send enemies to the other side
