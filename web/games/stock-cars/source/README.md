# Source art

The original downloads the Stock Cars assets in [`../models/`](../models) were taken from. They're kept
here so anyone can pick other cars from the kit; the game itself only loads `models/`. Nothing in this
folder is shipped in `beacon-arcade`.

| Folder | What | From | License |
|---|---|---|---|
| `kenney-car-kit/` | Car Kit 3.1: 40+ vehicles (cars, trucks, vans, karts) and debris, as GLB, with their shared palette `glb/Textures/colormap.png` | [Kenney](https://kenney.nl/assets/car-kit) | CC0 ([License.txt](kenney-car-kit/License.txt)) |

The kit also comes as FBX and OBJ; those copies were left out (the GLB files are the same models).
Get them from the link above if you need them.

How `models/` was made: unchanged copies of `sedan-sports`, `hatchback-sports`, `race-future`, `race`,
`truck` and `suv` `.glb`, and `Textures/colormap.png`. Which car is which is in `../cars.json`. The game
repaints each car by recolouring the paint column of the palette (`cars.ts`); to use another model from
the kit, copy it into `models/` and add it to `cars.json`.

Kenney asks for nothing, but credit is kind: thanks, [Kenney](https://www.kenney.nl).
