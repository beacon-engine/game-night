# Cars: real cars, cut into panels (and the other vehicles)

Realistic cars of made-up makes (no real brands or badges), for any game that drives. Each is cut into
the panels a real car is made of, so a game can take it apart: Shift Bots folds them onto a robot.

| | |
|---|---|
| `models/<id>.glb` | One car, facing +Z, Y up, its left at +X, in metres, on the ground. One node per panel: `bonnet`, `nose.L/R` (the front bumper halves, lamps and all), `fender.L/R`, `door.L/R` (with their windows and mirrors), `quarter.L/R`, `deck` (boot lid, engine cover or load bed), `tail.L/R`, `roof`, `glass.front`, `glass.rear`, `cockpit`, `chassis`, and `wheel.front.L` etc. (tyre, rim, brakes: spin them about X). Meshes are Draco-compressed (decode with `/people/draco/`). |
| `cars.json` | Each car's size, beltline, wheels (centre and radius), panels, triangles and credit. |
| `source/sketchfab/<id>/` | Where each came from (README: author, link, licence). The downloads themselves aren't in git. |

The car's paint is a material named `paint` (and on some a second colour, `accent`): a game swaps in its
own to repaint the car.

## Making them

```
python3 tools/cars/fetch.py                  # the originals from Sketchfab (needs an API token in ~/.sketchfab_token)
blender -b -P tools/cars/cars.py             # cut, slim and export them all (or name some: -- goblin abyss)
blender -b -P tools/cars/cars.py -- --preview goblin   # a picture of how it stands (source/previews/)
```

`tools/cars/cars.py` turns each car the right way round and to its real length, finds the wheels (round
pieces at the corners, or the tyre rubber), cuts the body along the shut lines (the bumpers, the doors,
the middle, the edges of the bonnet, the beltline) and gives each piece between the cuts to a panel, by
where it is and which way it faces; small bits join the panel nearest them. It slims each car to 40,000
triangles, makes textures with nothing see-through in them JPEG (the rest PNG, at most 512 px), and
Draco-compresses the meshes. To add a car: add it to `fetch.py` and to `CARS` in `cars.py` (its length, and
whatever the file gets wrong: which way it faces, its paint, its tyres).

## The cars and their makers

All CC Attribution: the credit goes with the car (Shift Bots shows it in the garage).

| id | Ours | Model | By | Licence | Triangles | Size |
|---|---|---|---|---|---|---|
| `goblin` | Goblin | [Fictional supercar - V12 Goblin](https://sketchfab.com/3d-models/fictional-supercar-v12-goblin-0a20e49ad5774d778567cb5c3f345786) | ollitei (https://sketchfab.com/ollitei) | CC Attribution | 39k | 1.0 MB |
| `cheetah` | Cheetah | [Generic Supercar "Cheetah"](https://sketchfab.com/3d-models/generic-supercar-cheetah-f5420af7b30c4e8c874be33cc58724f2) | mk2design (https://sketchfab.com/mk2design) | CC Attribution | 37k | 1.3 MB |
| `abyss` | Abyss | [Tokii Abyss GT.7 V12](https://sketchfab.com/3d-models/tokii-abyss-gt7-v12-c399568541104e0e903cf138b1e24908) | Glas'kavin (https://sketchfab.com/fiendishfarlander76) | CC Attribution | 32k | 1.0 MB |
| `sport-lp` | Stinger | [Generic Sport Car Low Poly](https://sketchfab.com/3d-models/generic-sport-car-low-poly-7ad3bfb2bd7449c19698fc7d0592a601) | Han66st (https://sketchfab.com/Han66st) | CC Attribution | 6k | 0.1 MB |
| `gt-coupe` | Sovereign | [Generic Sport Coupé Car](https://sketchfab.com/3d-models/generic-sport-coupe-car-820a13c4831c41959ce75e6c2014e882) | MMC Works (https://sketchfab.com/mmcworks) | CC Attribution | 35k | 2.2 MB |
| `azura` | Azura | [Generic Coupe "Azura"](https://sketchfab.com/3d-models/generic-coupe-azura-2e1a3699de7e4f688d328dc005ef1aac) | mk2design (https://sketchfab.com/mk2design) | CC Attribution | 39k | 1.4 MB |
| `nfr` | Nomad | [NFR '90 - Low Poly model](https://sketchfab.com/3d-models/nfr-90-low-poly-model-776078e51fbe4ec9addbe45ba13e1aad) | Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) | CC Attribution | 21k | 3.7 MB |
| `kiri` | Kiri | [Kiri '94 Racemod - Low Poly model](https://sketchfab.com/3d-models/kiri-94-racemod-low-poly-model-64d5d6f074a84717ac6d764f35c95285) | Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) | CC Attribution | 23k | 3.7 MB |
| `vanguard` | Vanguard | [Vanguard - Fictional Muscle Car](https://sketchfab.com/3d-models/vanguard-fictional-muscle-car-194ab4697e7a46be8ffb5103f877cd59) | SimonStrikesBack (https://sketchfab.com/SimonStrikesBack) | CC Attribution | 37k | 0.3 MB |
| `thunderbolt` | Thunderbolt | [Thunderbolt '96 - Low Poly Model](https://sketchfab.com/3d-models/thunderbolt-96-low-poly-model-25a4ff2002834ec1b4441c57ecd7ca9f) | Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) | CC Attribution | 24k | 3.7 MB |
| `sedan` | Meridian | [Generic Sedan Car](https://sketchfab.com/3d-models/generic-sedan-car-58c33766470d46e7b2aed542650494e5) | MMC Works (https://sketchfab.com/mmcworks) | CC Attribution | 37k | 3.1 MB |
| `shc` | Halcyon | [SHC MC Free Promotion Car](https://sketchfab.com/3d-models/shc-mc-free-promotion-car-cfaabdec76a74b68a48ba5657b6d9aee) | denniswoo1993 (https://sketchfab.com/denniswoo1993) | CC Attribution | 39k | 0.9 MB |
| `suv` | Summit | [MMC Generic Small SUV Car](https://sketchfab.com/3d-models/mmc-generic-small-suv-car-5db696c6ed5d4bdc87905c1040fa072a) | MMC Works (https://sketchfab.com/mmcworks) | CC Attribution | 33k | 2.9 MB |
| `wyvern` | Wyvern | [Wyvern concept car - FREE](https://sketchfab.com/3d-models/wyvern-concept-car-free-969f16578168435d8f12391001fbd311) | NETRUNNER_pl (https://sketchfab.com/NETRUNNER_pl) | CC Attribution | 14k | 0.5 MB |
| `lightbody` | Ridgeback | [Lightbody Lifted '85 - Low poly model](https://sketchfab.com/3d-models/lightbody-lifted-85-low-poly-model-67beae18c3d24be68f9c8f0ec382d8e3) | Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) | CC Attribution | 23k | 3.7 MB |
| `open-wheeler` | Single-seater | [Open Wheel Race Car](https://sketchfab.com/3d-models/open-wheel-race-car-4599e9608b6845aaafadc89f7d41fa3c) | Dylan Jade (https://sketchfab.com/DylanJade3D) | CC Attribution | 38k | 2.8 MB |

The Grand Prix single-seater's sponsors' decals were left out (`'drop'` in `cars.py`).

## The other vehicles

Not cars to drive: the street's traffic and what's overhead, for City Runners and Street Racing (the police car
chases you in both). Not cut into panels: `vehicles/<id>.glb`, facing -Z (the other way to the cars: a racing
game loads them as `vehicles/<id>` and turns them round), in metres, on the ground, with `vehicles.json` (sizes
and credits). Made by `tools/cars/vehicles.py`:

```
python3 tools/cars/vehicles.py fetch                                  # the originals (source/vehicles/<id>/)
blender -b -P tools/cars/vehicles.py -- build                         # turn, size and compress them all
blender -b -P tools/cars/vehicles.py -- build airliner --preview      # a picture of one (source/vehicles/previews/)
```

| id | What | Model | By | Licence | Triangles | Size |
|---|---|---|---|---|---|---|
| `police` | Police cruiser | [Fairheaven LT '80 Cop Cruiser - Low poly model](https://sketchfab.com/3d-models/fairheaven-lt-80-cop-cruiser-low-poly-model-61766c1e6e1e4b2b803c174f33433a74) | Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) | CC Attribution | 19.5k | 3.6 MB |
| `lorry` | Box lorry | [LCT 3000 '95 - Low poly model](https://sketchfab.com/3d-models/lct-3000-95-low-poly-model-663a0953c038434a918cb85725c88ffa) | Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) | CC Attribution | 18.9k | 3.7 MB |
| `van` | Panel van | [Shvan '92 - Low poly model](https://sketchfab.com/3d-models/shvan-92-low-poly-model-09d718c9cf72401b8534d265a06a803f) | Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) | CC Attribution | 23.0k | 3.7 MB |
| `bus` | Town bus | [Generic Town Bus](https://sketchfab.com/3d-models/generic-town-bus-14fe03d792914d51b6c6250b393c44fd) | own.guest (https://sketchfab.com/own.guest) | CC Attribution | 54.5k | 0.6 MB |
| `airliner` | Airliner | [Low Poly Airliner](https://sketchfab.com/3d-models/low-poly-airliner-f06d488f08764e3ca26f2917d4053c69) | Mauro3D (https://sketchfab.com/maurogsw) | CC Attribution | 3.5k | 0.0 MB |
| `helicopter` | Helicopter | [Low Poly Helicopter](https://sketchfab.com/3d-models/low-poly-helicopter-5bbed2de9baa4a13a7faa72653b78b64) | antonmoek (https://sketchfab.com/antonmoek) | CC Attribution | 1.9k | 0.1 MB |
