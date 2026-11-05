# Shift Bots

Build a car that turns into a robot, then fight the horde together · 1–4 players · Action · **playable**

Each of you builds a bot in the garage: a body (fifteen cars, each becoming its own robot), paint in any of
65 colours, a trim colour, a finish (gloss, metallic, pearl, matte), a weapon and a special. Then you
fight waves of enemy bots on one of four battlegrounds (a quarry, a desert canyon, a city at night, a
snowfield), side by side. As a robot you shoot and punch; as
a car you're fast, you ram, and your armour mends while you're out of the fight.

## The bots (`rig.ts`, `paint.ts`, `bots.json`)

Every body is a real car from [`web/cars/`](../../cars/README.md): fifteen of made-up makes, from
hypercars to a lifted pickup, each cut into its panels in Blender. The robot lies folded inside the car
holding them; changing, it tips up tail-first onto its feet, the arms swing down and the head comes up
last, and each panel slides the last bit into place as its limb arrives. The car becomes the robot's
armour: its face (bonnet, bumper, lamps) the chest, the front wings and wheels the shoulders, the doors
shields on the forearms, the roof and boot the back, the rear quarters the legs and the tail the feet.
Each body changes at its own speed (bots.json `robot.shift`: from 0.55 s to 1.35 s). The paint is a base
colour under a clear coat, with metal flakes in the metallic and pearl finishes.

`?wave=5` starts a fight at the fifth wave. `?showroom` shows every body at once (`&t=1` as robots, `&t=0.5` halfway, `&only=2` one of them, a negative
`t` frames it as a robot, `&yaw=` which way they face).

## Playing

| Button | Robot | Car |
|---|---|---|
| Stick | Walk (up on the stick is away from the camera, which only comes round behind you as you walk forwards); all the way out to run | Left and right steer, up is the gas, pulled back brakes and then reverses |
| Bolt | Fire (hold): aims at the nearest enemy roughly ahead, in sight | Boost (hold, flat out ahead; the meter refills) |
| Drop | Punch: three in a row, the third knocks them flying | |
| Leaf | Change into a car | Change into a robot; at speed you leap and land with a slam |
| L1 | Dodge: a quick dash, untouchable for a moment | |
| Star | Special, when it's charged: a shield that stops their shots (friends can shelter in it), a shockwave that throws back and stuns everything close, or a salvo of homing missiles | |

You take half damage while changing, but can't fight. A car out of the fight mends its armour. Ram the
enemy at speed to hurt them (you take a little too). Wrecks leave scrap: drive or walk over it.

## The fight (`sim.ts`, `arena.ts`, `battle.ts`)

- **The rules** (`sim.ts`, no graphics) run 60 steps a second: bots as cars or robots, bolts and shells in
  flight (rocks stop them), punches, dodges, rams, the slam, scrap and the waves.
- **The enemy**, all in gunmetal with red eyes: Scouts (small quick cars) run at you, ram, carry on past
  and come round again; Troopers (saloons) drive in, stand up within range, keep their distance and shoot,
  side-stepping; Brutes (the big SUVs and pickups) walk right up and punch, hard; Lancers (long grand
  tourers) hang back and snipe with slow, heavy bolts; and every fifth wave the Hauler, an armoured
  off-roader twice the size, fires volleys of shells and stamps the ground when you get close (its armour
  across the top of the screen). They come round cover to get a shot; stuck on a rock, a car turns off.
- **Waves** grow each time: Brutes from the third, Lancers from the fourth, the Hauler every fifth. They
  come in one at a time, fewer at once early on, more for more of you. On your own you take less damage.
- **Down, not out**: stand by a friend who's down for three seconds to get them up (a ring fills round
  them); anyone still down gets up when the wave is cleared; everyone down at once ends it.
- **Between waves** the fight holds while you spend scrap on your phone: armour, damage, speed or a
  quicker special, each step dearer than the last. It carries on when you're all done, or after 30 s.
- **Balance**: `node web/games/shift-bots/balance.ts` has bots play whole fights headless, for one to four
  of them on each level, and says how far they get (solo on Normal reaches about the first Hauler).
- **The battlegrounds** (`arena.ts`, as numbers; `battle.ts` draws them), each with the middle clear to
  start in:

  | | | Tyres grip |
  |---|---|---|
  | Quarry | A gravel pit ringed by terraces of rock; boulders and tall pillars everywhere for cover | fully |
  | Desert canyon | Wide red sand between five huge mesas, a few boulders, sandstone walls: room to drive | 80% |
  | Night city | Blocks of lit office towers with streets between, parked cars (real ones, from the garage) and barriers to duck behind, street lamps, a skyline all round | fully |
  | Snowfield | Snow-capped pines and rocks, icy walls, snow falling: robots keep their feet, cars slide round every turn | 45% |

  Things on the floor are round (rocks, trunks) or boxes (buildings, cars, barriers); both stop bots,
  shots and sight. `battle.ts` also draws each bot as its Rig, the shots, scrap, sparks, fire and smoke,
  and a camera behind each of you (the screen splits for two to four).
- **What you see**: each battleground's sky is a photographed one from [Poly Haven](https://polyhaven.com)
  (CC0), which also lights the scene and shines in the paint, and its ground and rock are Poly Haven photo
  textures (`tools/shift-bots/polyhaven.py` fetches them into `env/`). Shots are tracers (a bright core in
  a glow, the lancer's a long red beam) with muzzle flashes; robots carry their gun on the right forearm
  (a six-barrel rotary that spins up as it fires, a cannon, twin scatter barrels, the lancer's rifle).
  A radar in the corner of each view shows the enemy, your team, scrap and the rocks round you, with an
  arrow to the nearest enemy when there's none close.
- **Sound** (`sound.ts`) is synthesised: an engine for each of you as a car (rising with speed and the
  boost), the guns, hits, punches, rams and explosions (quieter further from the nearest of you), the
  whirr and clanks of changing, the specials, and horns for a wave starting and ending.
- **Drawing it cheaply** (`rig.ts`): a bot is dozens of pieces, but settled as a car it's drawn merged
  (one mesh per material, and its four wheels), and settled as a robot as skinned meshes bound to its
  joints (one per material, about 20 draws for the whole robot); only while changing are the pieces
  drawn one by one.

## Stars and the shop

Every fight pays stars, and more for beating your best wave on that battleground (kept per person).
`shop.json` sells finishes with them (looks only): Satin, Candy, Chrome and Gold plate; once bought they
join the free four (gloss, metallic, pearl, matte) in the garage's Finish row.

## Next

- A versus arena: the same bots, against each other.
- More specials (a tow cable, a decoy, an oil slick), more bodies as more cars come into `web/cars/`.
- A real playtest on phones and TVs to tune the feel (the balance so far is from `balance.ts`).
