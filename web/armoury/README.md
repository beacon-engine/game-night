# Armoury: guns for any game

Guns at their real sizes, ready to hold: Fireteam's squads carry them, and the sniper and zombie games
will. Built by [`tools/armoury/guns.py`](../../tools/armoury/guns.py) in Blender, loaded with
`@armoury/armoury.ts`, served at `/armoury/`.

| Gun | Model | Length |
|---|---|---|
| `rifle` | Karabiner 98k, bolt action | 1.11 m |
| `assault` | StG 44, automatic | 0.94 m |
| `sniper` | a scoped bolt-action rifle | 1.2 m |
| `shotgun` | pump action | 1.0 m |
| `pistol` | M1911 | 0.22 m |
| `machine-pistol` | C96 | 0.31 m |

Each has its barrel along +x, its top up, and its grip (where the trigger hand holds it) at the origin.
Its glTF extras say where the other hand goes on the fore-end (`support`, metres along the barrel from
the grip) and where the muzzle is (`muzzle`). `holdBetween` puts one in a pair of hands each frame: the
grip in one, the barrel aimed through the other.

The pack's models come in parts but with no textures, so the build colours each part: blued steel,
walnut, an olive synthetic stock on the sniper rifle. `models/guns.glb` is 280 KB.

## Source

`source/low-poly-weapon-pack/`: the [Low Poly Weapon Pack](https://opengameart.org/content/low-poly-weapon-pack)
from OpenGameArt, CC0, as downloaded (more guns in it than we use: an AK, an M16, an RPG, a V2 rocket...).
Not shipped.
