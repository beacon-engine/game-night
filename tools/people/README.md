# People: realistic players, boxers, wrestlers and soldiers

The people in the 3D games are built here, in Blender, from free-licensed parts, and exported as
glTF for the games to load. Nothing here runs in the game; only what it exports ships.

| Part | From | Licence |
|---|---|---|
| Bodies, faces, skin, eyes, hair, clothes | [MakeHuman](http://www.makehumancommunity.org) asset packs, through its Blender add-on [MPFB](https://extensions.blender.org/add-ons/mpfb/) | CC0 (MakeHuman's output and core assets); some packs CC-BY (credited) |
| Motion capture: running, kicking, boxing, falls, getting up, crouching, sneaking, gun handling | [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu) (BVH conversion) | Free to use in games, not to resell as raw data |
| Game moves: jabs, crosses, hooks, hit reactions, pistol aim/shoot/reload, deaths, zombie walks | [Quaternius Universal Animation Library 1 and 2](https://quaternius.com) | CC0 |

Every person has the same skeleton: MPFB's `game_engine` rig (Unreal-style bone names, with
fingers), so one animation plays on anyone, whatever their build.

## Building

```
blender -b -P tools/people/people.py -- recipes/footballers.json web/people/models/footballers.glb [--render lineup.png]
blender -b -P tools/people/moves.py  -- recipes/football-moves.json web/people/models/football-moves.glb
```

(About 20 s and 10 s. `ONLY=p1,p2` builds just those people, or just those moves.)

| File | |
|---|---|
| `people.py` | A file of people (`recipes/*.json`) as one .glb: each recipe gives a body (MakeHuman's gender, age, muscle, weight, height, proportions and ancestry), a skin, hair, and clothes by role (shirt, shorts...). MPFB builds and dresses them, gives them the rig, and names every part's material for what it is. `plain` roles go grey for the game to colour. `detail` thins out a part's triangles. `--render` draws the line-up front and back, for checking by eye. |
| `moves.py` | A file of moves as one .glb (the rig and its clips) and a .json about them. Each move is cut from a CMU take or a Quaternius clip. A `loop` finds the cycle in the take that joins up best, and turns it to run straight ahead. An `around` cuts a strike either side of the moment it meets the ball (with `support`, when the swinging foot comes past the standing one) and turns it so the strike goes straight ahead. A `mirror` gives the other foot. A `stance` turns the legs (or arms) out from the body: some takes run with the feet landing on one line. An `upper` takes a cycle's shoulders and arms from another cycle, stride for stride. |
| `retarget.py` | Baking a capture onto the rig (below). |
| `helmets.py` | Steel helmets made to measure (`"helmet": "m1"` or `"stahl"` in a recipe): a dome and a brim (or a flared skirt) sized from the man's own head, as his build shapes it, bound to his head bone. MakeHuman's helmet asset is netting over a cap. |
| `textures.py` | Materials and textures for export: plain glTF materials, kit parts in grey, textures scaled to what the game draws (skin 1024 px, the rest 512 or less), WebP. Meshes are Draco-compressed. |
| `recipes/` | `footballers.json`, `football-moves.json`, `soldiers.json`, `soldiers-axis.json`, `soldier-moves.json`. A new cast or set of moves is a new recipe. |

Choosing parts: `--render` a line-up with the candidates. The footballers' kit came from two line-ups of
shirts, shorts and shoes. Some packs' "shorts" are briefs, some shirts have logos or a frayed hem drawn
in, and a fitted scoop-neck tee on a slim build reads as a woman's top: the jersey is a loose collared
shirt (a classic football shirt) on athletes' builds (muscle 0.75 to 0.95).

Choosing motion: most of CMU's runners are recreational joggers (hands held up at the chest, feet
landing on one line). Subject 78 is an athlete (basketball moves: drives, feints, defending), and the
run is theirs. There's no steady jog of theirs, so the jog is a jogger's legs (`stance` widened) with
subject 78's arms (`upper`). Compare candidates side by side in a browser before choosing.

## How the motion gets onto them (`retarget.py`)

A capture is imported (BVH, or a glTF clip library) and baked onto the rig frame by frame: each bone
is turned the way the same bone turned in the capture, measured from each skeleton's own rest pose.
The two don't stand alike at rest (CMU's T-pose, MakeHuman's A-pose), so the rig is first posed bone
by bone the way the capture stands, and that is its rest for the transfer. The hips keep their rise,
fall and sway, scaled to the character's leg length; travel over the ground is left to the game
(`travel='inplace'`) unless asked for. Clips are sampled by time, at 30 a second, whatever rate the
source was keyed at.

## Getting the sources

Blender 4.5 LTS (MPFB supports 4.2 and later), then:

```
tools/people/fetch/mh.sh     # MPFB and the MakeHuman asset packs  -> web/people/source/mh/
tools/people/fetch/cmu.sh    # the CMU takes we use                -> web/people/source/cmu/
blender --command extension install-file -r user_default -e web/people/source/mh/mpfb-*.zip
tools/people/fetch/install.sh  # the packs into MPFB's library, where people.py finds them
```

Both scripts resume where they stopped and give up on a stalled transfer and retry, so they can be run
again on a slow connection. The parts the cast uses are kept in the repo, as they come in the packs,
in `web/people/source/mh/assets/`. The zipped packs aren't kept, since some are over GitHub's 100 MB
file limit. The CMU takes and Quaternius' libraries are kept whole. None of it ships in the binary.
