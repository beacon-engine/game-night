# Source art

The original downloads the football assets in [`../models/`](../models) were made from. They're here so
anyone can rework them (more hairstyles, the female body, other animations); the game itself only loads
`models/`. Nothing in this folder is shipped in `beacon-arcade`.

| Folder | What | From | License |
|---|---|---|---|
| `characters/` | Universal Base Characters (Standard): male and female bodies, hairstyles, textures, for Unity, Unreal and Godot | [Quaternius](https://quaternius.itch.io/universal-base-characters) | CC0 ([License_Standard.txt](characters/License_Standard.txt)) |
| `animations/` | Universal Animation Library (Standard): motion capture as FBX (Unity, Unreal) and GLB (Godot) | [Quaternius](https://quaternius.com/packs/universalanimationlibrary.html) | CC0 ([License.txt](animations/License.txt)) |

How `models/` was made from these:
- `models/ubc/`: unchanged copies of
  - the male body and its textures: `characters/Base Characters/Godot - UE/` (plus `T_Eye_Brown`,
    `T_Hair_*_BaseColor` and the two skin colours from `characters/Base Characters/Textures/`)
  - hair, beard and eyebrows: `characters/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/`
    (rigged to the head bone, so the game re-binds them to each player's skeleton)
- `models/ual_ue.fbx`: `animations/Unreal Engine/AL_Standard.fbx`, renamed.

Other games keep their source art the same way, in their own `source/` folder.
