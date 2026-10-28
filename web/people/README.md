# People: the people in the 3D games

Real-looking people for any game that needs them: footballers now, and next boxers, wrestlers, soldiers
and zombies. Each has their own body, face, skin and hair, and wears real clothes rather than a kit
painted on skin. They move with motion capture. They're built in Blender from free-licensed parts by
[`tools/people/`](../../tools/people/README.md). This folder is what the games load. A game imports
`@people/people.ts` (the alias is in `tsconfig.json`). The files are served at `/people/`.

| File | |
|---|---|
| `people.ts` | Loads a cast (`loadCast`) and a set of moves (`loadMoves`). Makes a `Person` from one of the cast, dresses them in colours (`dress`: shirt with stripes or hoops and the number on the back, shorts, socks, boots, gloves), tints hair and skin, and fits the moves to their body (`fit`). |
| `models/footballers.glb` | 10 outfield players, 2 keepers (in gloves) and a referee, athletes' builds, in a plain grey kit for the game to colour: a collared jersey, shorts, high socks and boots. 3.4 MB in all. |
| `models/soldiers.glb`, `soldiers-axis.glb` | Eight infantrymen each, in the same field uniform (sweater, cargo trousers, boots: grey for the game to colour each army) with a steel helmet made to measure: an M1-style dome, or the flared kind. 1.3 MB each. |
| `models/soldier-moves.glb` / `.json` | Legs: idle, walk, jog, run, crouched. Upper body: a rifle at the ready and aimed at the shoulder (CMU subject 79), a grenade throw. Whole body: hit, falling, getting up. |
| `models/football-moves.glb` / `.json` | Idle, walk, jog and run cycles (the run, and the jog's arms, are an athlete's: CMU subject 78); a kick and a pass with each foot; falling, getting up, sliding and throwing. The `.json` gives each clip's length, how fast it was captured travelling, whether it loops, and when a strike meets the ball. |
| `draco/` | The decoder for the compressed meshes (from three.js). |
| `source/` | The originals everything is made from. They're kept in git and never shipped. See below. |

## One skeleton for everyone

Every person has MakeHuman's `game_engine` rig: Unreal-style bone names (`pelvis`, `spine_01`,
`thigh_l`, `hand_r`...), with fingers. So any set of moves plays on anyone, and the procedural posing a
game does by bone name (football's tackles and dives) works on all of them. Bodies differ, so `fit`
re-bases each clip on the body once. Each bone turns from its own rest pose the way the moves'
skeleton turned from its rest, and the hips rise and fall in proportion to the body's height. Clips
stay in place, and the game moves the person over the ground. Clips captured without fingers (CMU's)
keep the hands relaxed, as at the start of the idle.

Each strike's `.json` entry says when the boot meets the ball (`contact`), and `fit`'s body tells the
game where: beside the standing foot, well to the side of the body's middle, as in a real kick. A
game sets the ball there before the swing (football's `strikeSpot`).

## Kits

The shirt, shorts, socks, boots and gloves come in grey, keeping their folds and seams, so a material
colour shows true. `dress` colours them per person. Stripes, hoops and the number are drawn by the
shirt's shader where they'd be printed: they're measured on the shirt as it was made (its rest shape),
so they fold and stretch with the cloth as the person moves.

## Sources (`source/`)

| Folder | What | Licence |
|---|---|---|
| `mh/assets/` | The MakeHuman parts the cast uses, as they come in the packs: skins, eyes, brows, lashes, hair, the shirt, shorts, socks, boots and gloves. The packs themselves (some over GitHub's 100 MB file limit) aren't in git: `tools/people/fetch/mh.sh` downloads them again. | CC0, apart from two CC-BY parts (credited below) |
| `cmu/` | 88 takes from the [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu) (BVH), with the database's index of what each one is (`INDEX.txt`). | Free to use in games, though not to resell as raw data |
| `ual1/`, `ual2/` | Quaternius' [Universal Animation Library](https://quaternius.com) 1 and 2. | CC0 |

CC-BY parts used by the footballers:
- Men's short trousers 2, worn as football shorts, by Elvaerwyn (CC BY)
- Running shoes 01, worn as boots, by punkduck (CC BY 3.0)

They're all MakeHuman community assets, from [makehumancommunity.org](http://www.makehumancommunity.org).
