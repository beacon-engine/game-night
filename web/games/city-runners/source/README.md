# Source art

How [`../models/`](../models) was made. The original bodies are in `characters/` here, and the animation library
with the other shared sources in [`web/people/source/ual1/`](../../../people/README.md). Nothing in this folder is
shipped in `beacon-arcade`.

| In `models/` | What | From | License |
|---|---|---|---|
| `people/` | The male and female bodies, six hairstyles and a beard, rigged to the head bone | [Quaternius, Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | CC0 |
| `animations.json` | Idle, sprint, jog, jump (start, in the air, landing), roll, crouch, hit, fall, dance | [Quaternius, Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) | CC0 |

- `make-bodies.py` copies the bodies and hair, keeps only their colour textures and shrinks them to 512 px (macOS
  `sips`), so a TV can load half a dozen runners: 4 MB in all.
- `make-animations.mjs` cuts the clips the game uses out of the library's 25 MB FBX (`web/people/source/ual1/Unreal Engine/AL_Standard.fbx`): joint
  rotations only, plus the pelvis height, no fingers, rounded. 420 KB (75 KB compressed). The game fits the pelvis
  height to each body when it loads them (`people.ts`).

```
python3 web/games/city-runners/source/make-bodies.py
cd web && node games/city-runners/source/make-animations.mjs
```
