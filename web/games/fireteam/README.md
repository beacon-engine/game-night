# Fireteam

Squad shooter: lead your squad through the hedgerows of Normandy · 1–4 players · Action · **playable** (in progress)

Each of you leads a squad of soldiers (0 to 3 computer squad-mates each) on one mission in the bocage (small fields
boxed in by high earth-bank hedgerows), in five steps: through their line at the first hedgerow, taking the
farm, down through the orchard into the sunken lane, silencing the field gun at the edge of the woods, and
then holding the crossroads against their counter-attack until the tanks come up. If everyone on your side goes down,
you go back to the step's checkpoint.

## Playing

| Button | |
|---|---|
| Stick | Move (past the ring: sprint). You aim at the nearest enemy you can see the way you're facing or moving. |
| Bolt | Fire (hold) |
| Leaf | Crouch / stand (a tap); held beside the gun: set the charge |
| Drop | Grenade (at whoever you're aiming at, or ahead) |
| Star | Squad orders: Follow me, Hold here, Assault |
| L1 | Reload |

In the lobby, Leaf chooses your weapon: assault rifle, rifle, shotgun or sniper rifle. Bindings are in
`controls.json`.

## How the fighting works (`sim.ts`)

- **Every shot is a chance**, worked out from the gun (each has its accuracy, damage, range, rate and magazine),
  the range (past the gun's range, quickly worse), whether the target is crouched, whether there's low cover
  (a dry-stone wall, a cart, sandbags, a crater's rim) right in front of him, whether the shooter is moving or pinned down, and how long
  he's been aiming at that man. Hedgerows and buildings stop bullets and sight altogether.
- **Near misses pin people down** (suppression): they shoot worse and duck. Keep a man's head down while a friend
  works round him.
- **Down, not out.** Our side goes down when hit hard enough and bleeds out over 30 s; someone standing still
  beside him for 3 s gets him up. Squad-mates come and do it when it's safe.
- **Grenades** are lobbed, bounce off walls, and blast everyone in reach who isn't behind something solid.
- **The enemy** holds its posts from cover, pushes a little toward you when it can't see you, throws grenades at
  anyone crouched behind low cover, and in the last step comes at the crossroads from several sides.
- **Fair for a couch.** The computer is a worse shot than a player and slower to settle on someone; players
  (and their squads) take less from each hit; each step's defenders and the counter-attack scale with how many
  of you there are; and the enemy holds its fire for the first moments of a step.

## The battlefield (`map.ts`)

The countryside is data: the lie of the land (`height()`: gentle rolls, the sunken lane, shell craters),
buildings (solid blocks), hedgerows, dry-stone walls, barbed wire, props, trees, fields, the track and the road,
and the mission's steps (what to do, where, who's there, the checkpoint). A 1 m grid made from it says where
you can walk, what stops sight and bullets, and where there's cover; the computer finds its way with A* over it.

`?step=4` starts a game at the fourth step (for testing). The rules run without a browser: a test drives the
players as bots through the whole mission, which is how it was balanced.

## Art

- The soldiers are [`web/people/`](../../people/README.md)'s `soldiers` and `soldiers-axis` casts (MakeHuman,
  in field uniform, with steel helmets made to measure), moving with motion capture (`soldier-moves`: CMU's
  runs, crouches and a rifleman's shooting take for the upper body; Quaternius' throw, hits and falls).
- Their guns are [`web/armoury/`](../../armoury/README.md)'s (CC0), held between both hands.
- The land (`land.ts`) is drawn from photographed surfaces and models from [Poly Haven](https://polyhaven.com),
  all CC0: the ground (grass, mud tracks, plough, leaf litter, scorched earth) painted over the terrain by a
  map of where each lies; the buildings, put together in code from stone, plaster, roof-tile and plank
  textures; the hedgerows, thick with leaves from Poly Haven's leaf sheet on their earth banks; grass and wheat
  from its grass cut-outs; shrubs, nettles, rocks, stumps, logs, crates, barrels and jerrycans; and the light,
  from its overcast farmland sky. `tools/fireteam/polyhaven.py` fetches them into `source/polyhaven/` (not
  shipped), `tools/fireteam/textures.sh` sizes the textures (`models/tex/`) and `tools/fireteam/props.py`
  (Blender) thins the models (`models/props/`).
- The trees are grown when the game loads by [ez-tree](https://github.com/dgreenheck/ez-tree) (MIT, in
  [`web/world/trees/`](../../world/trees/)): oaks, ashes and apple trees, in Poly Haven's bark and leaves.
- Whatever stands between the camera and a player (a tree, a hedge, a building) dissolves round him
  (`cutaway.ts`).

## Later

- More missions (a beach landing, a river crossing at night, a bridge to hold)
- A 1–4 player versus arena, split screen
- A sniper mode and a zombie survival mode on the same ground
