# Changelog

All notable changes to Beacon Arcade. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

### Added (games)
- **Fireteam**, a squad shooter for 1–4 (marked In progress). Each of you leads a squad (up to three computer
  squad-mates) through one mission in the Normandy bocage, in five steps: through their hedgerow line, into the farm,
  down the orchard to the sunken lane, silencing a field gun at the edge of the woods, then holding the crossroads
  against their counter-attack. Real soldiers (MakeHuman, in field uniform with steel helmets, motion-captured), real
  guns held in both hands (assault rifle, rifle, shotgun, sniper rifle). Photographed countryside (Poly Haven, CC0):
  rolling pasture, wheat and plough, mud tracks, earth-bank hedgerows thick with leaves, dry-stone walls, barbed
  wire, shell craters, a stone farm with a tiled roof, a ruined cottage, oaks, ashes and an orchard (grown by
  ez-tree), lit by an overcast sky. Cover and crouching matter, near misses pin you down, grenades, squad orders
  (follow me, hold here, assault), getting a downed friend back on his feet, checkpoints. Whatever stands between
  the camera and a player dissolves round him.

- **Space Shooter**, a co-op side-scrolling shooter for 1–4 (marked In progress). Three stages (The Kessler
  Belt, Orbital Yard, The Rift), each with its waves of darts, raiders, miners, carriers, turrets, rocks and mines,
  and a boss at the end: shoot off its guns, then its core. Then they come round again, tougher. Fly with the
  stick, hold Bolt to fire, Leaf to focus (slower and tighter), Drop for a bomb that clears the screen. Pickups
  power your weapon up or change it (blaster, spread, laser, homing missiles), give you a shield, a bomb or a
  spare ship. The team shares its ships and its score, with a kill chain multiplier, ten seconds to continue,
  and a high score table. Computer wingmen if you're short of pilots; they fly the demo behind the menu. Ships
  and scenery from Kenney's Space Kit (CC0), with hull paint jobs in the shop.
- **City Runners**, an endless runner for 1–4 at once on one screen: over city rooftops and an elevated rail line.
  Pick one of six runners (real, motion-captured people, each with a strength: quick across, a big jump, shrugs off
  stumbles, long reach for coins) and one of three routes (Rooftops at dusk, The Rail Line at night, Sky Bridges at
  sunrise). Change lanes, jump and slide with the phone's arrows; jump the gaps, slide under the signs,
  run along the trains, and cross the widest gaps on a beam or a zip line. At a crossing, choose your way across:
  the zip line (fastest, but jump to grab it), the thin rail (safe but slow) or swinging ropes (time each jump). Coins and power-ups (magnet, jump boots,
  shield, double) go to whoever gets there first. Stumble twice, or fall behind, and the security drone has you: the
  last one running wins. Computer runners to race, "today's course" (the same all day), saved records and best
  distances, and suits and light trails in the shop.
- **Rally**, the fourth playable racing game (marked In progress): 1–4 drivers and up to 5 computer drivers,
  everyone on the stage at once, 1 to 5 laps. Two stages built from a seed: Forest Ridge (gravel through
  the pines, with a water splash) and Red Canyon (dirt between the rocks at sunset). Real car physics: each
  car is a body on four sprung wheels, so it slides on loose ground, flies off crests (further the faster you
  take them), pitches nose-down in the air, lands on its springs and can roll if it lands badly. Cars hit each
  other and the trees and rocks. A handbrake for the hairpins, the gas and brake to level the car in the air,
  a button to get back on the road, and a co-driver calling the bends and jumps on the screen and the phone.
  Five cars (Kenney's Car Kit, shared with Stock Cars), dust and spray, saved records (stage records, biggest
  air) and paint jobs in the shop.
- **Grand Prix**, the fifth playable racing game (marked In progress): 1–4 drivers and up to 11 computer
  drivers in single-seaters on two road circuits that turn both ways: Valley Ring (fast and flowing, 2.8 km)
  and Harbour Streets (right-angle corners between the walls at sunset, 2.0 km); 5, 10 or 15 laps. Every
  car has health, tyres and fuel, shown beside each name and on your own screen. Hits take health by how
  hard they are; a hard one can start a fire (box now, or it burns out) and a big one, worst into a barrier
  at speed, ends your race. Tyres wear and grip less, a damaged car is slower, and a full tank lasts 7
  laps. Press L1 to box: the pit lane runs alongside the main straight, and the crew refuels, changes tyres,
  mends damage and puts out fires, taking longer the more they do. The computer drivers plan their own
  stops, retirements show as DNF, and your phone says when to come in. Lap records, wins and liveries in
  the shop.

### Added
- **Weather in the racing games.** Choose it in the lobby. Rain comes in **Showers** (dry to start, then
  a spell or two of rain) or all race (**Rain**). The road soaks over half a minute and takes a couple of
  minutes to dry, so a shower is a stretch of the race, not a switch. Slicks are quickest in the dry and slide
  everywhere in the wet. Wets, with grooves you can see turning on the tyres, are slower in the dry and far
  better once it's wet. Braking grip drops too, and the computer drivers brake earlier to match. You see the
  rain fall, the sky cloud over, the road darken and shine, and spray come off the cars ahead; you hear the
  rain and the tyres hissing on a wet road.
  - **Grand Prix**: Dry, Showers or Rain. The crew fits the right tyres when you box, the pit wall calls
    *Wets* or *Slicks* when you're on the wrong ones, and wets wear out fast once the road dries.
  - **Rally**: Dry, Showers, Rain or **Snow**. In the wet, dirt turns to mud and tarmac gets slippery
    (gravel hardly minds). Snow covers the stage, and everyone runs studded tyres. Rally tyres now always
    show their tread.
  - **Stock Cars**: Showers or Rain on the road course; ovals stay dry, as in the real sport. With no pit
    stops, you choose slicks or wets before a showers race (Leaf), and half the computer drivers gamble on
    slicks.
- **Weather in Football**: Dry, Showers, Rain or Snow (the button next to Day/Night in the lobby). A wet
  pitch is quicker: the ball skids on and bounces lower, and players lose a little footing. Snow lies on
  the pitch (the lines show through), the ball rolls short, hardly bounces, and is orange.
- **Football: favourite foot.** Every player is right-footed, left-footed or two-footed (`"foot"` in
  `teams.json`, shown beside his ratings). He strikes with the foot on the side the ball is, and the
  kicking animation uses that leg; with his weaker foot a pass or shot is less accurate and has less on it.
- **Grand Prix: plan your pit stop.** On the way down the pit lane your phone turns into a d-pad and a panel
  opens on your screen: keep the tyres or fit slicks or wets, put in fuel a lap at a time (or exactly enough
  to the flag), mend the damage or save the time; it shows how long you'll be stopped. The pit entry is now
  easy to find: a dashed line down the left of the straight, a ◀ PIT board over it, PIT IN and PIT OUT on the
  road, and the metres to the entry on your screen once you've asked to box.
- **Stock Cars: a road course.** Ridgeway, 2.3 km in the hills, turning both ways: the esses, a loop to the
  right and a hairpin, with walls both sides and kerbs in the turns. Brake for the turns; the computer
  drivers take the racing line and brake for them too. Tracks can now be a whole lap (`"lap"` in
  `tracks.json`), with right turns.

### Changed (football)
- **Real people in real kits.** Every footballer is a real-looking person now: ten outfield bodies, two keepers
  and a referee, each with their own build, height, face, skin and hair. They're made with MakeHuman in Blender from
  free-licensed parts. The kit is real clothing (shirt, shorts, high socks, boots, keeper's gloves) in the team's
  colours. Stripes, hoops and the number are printed on the shirt and fold with it as he moves. Before, everyone
  was one superhero body with the kit painted on the skin.
- **Motion-captured running and striking.** Walking, jogging, running and sprinting are captured cycles (CMU's
  motion capture database), blended by speed with the stride in step with how fast he's moving. The old
  bounding jog, with its springs in the feet, is gone. Kicks and passes are captured strikes with either foot
  (a right-footed take, mirrored for the left), timed so the boot meets the ball when the game strikes it. The
  windup is a little longer (0.28 s, from the last stride and the backswing).
- **Men who move like players.** The bodies are athletes' builds, in a loose collared jersey (not a fitted tee) and
  proper football shorts. Running and the jog's arm action come from an athlete's motion capture (CMU subject 78),
  with a wider stance: no more feet landing on one line, or hands held up at the chest.
- **Strikes meet the ball.** The swing only starts once the ball is at his feet, set beside the standing foot where
  the captured kick meets it, so nobody kicks thin air running at a ball a stride away. Dead balls too: the run-up
  goes to the standing foot's spot, and a kick-off taker steps into place first.
- **Turning to pass, and balance.** Before passing or shooting, the player turns with the ball toward where it's
  going (a pass back means turning round first, not spinning on the spot as it's struck). Striking it well away
  from where he's facing costs pace and accuracy, and a really awkward one leaves him stumbling.
- **Bending the ball.** Hold the stick to one side just after you strike a pass or shot and it curls that way (a
  swerve that builds in flight and fades as it rolls). The computer curls some of its shots round the keeper.
- **The net billows.** The back and roof of the net ripple out from where the ball hits them, harder the harder
  it's struck, and swing back as they settle.
- The people, their moves and the tools that build them are shared by any game (`web/people/`, `tools/people/`):
  boxers, wrestlers, soldiers and zombies come next.

### Changed
- What the 3D games share is in `web/world/` (`@world/…`): the weather, rain and snow, the sky, particles,
  drawn textures and the split screen, so football and the racing games use the same weather. City Runners'
  copy of the texture helpers is gone. The weather and tyres use enums (`Forecast`, `Conditions`, `Tyre`,
  Grand Prix's `Call`) and named thresholds instead of chains of string comparisons.
- The code and car models the racing games share are now in one place, `web/racing/` (imported as
  `@racing/…`): the cars and their tyres, the track, the racing, the weather, the sound, the sky and the
  scenery. Rally and Grand Prix no longer reach into Stock Cars' folder, and helpers that had been copied
  between the three games (the sky, reflections, split screen, particles, track ribbons, kerbs, the crowd)
  are now written once.
- **Stock Cars handles differently.**
  - The cars differ more: the Prototype is quickest flat out and wins on the big oval, the Hot Hatch and
    the Open Wheeler on the short track and the road course, and the heavy ones win the shoving matches.
  - An oval's banking is steeper up by the wall, so the high line carries more speed, and the apron below
    the inside edge is slow: hugging the bottom is no longer the way round.
  - Cars bounce off each other, and the walls, with a knock you can't just steer out of. Walls cost more
    speed, and grinding along one costs more still.
  - The computer drivers keep looking for a way past instead of sitting behind a slower car.
  - Every track is wider (the road course and the short track most), so three wide fits.
- **Stock Cars sounds like racing, not a hum.** Engines work through the gears (the revs climb, drop at
  each shift and climb again) with a V8's burble, brighter on the gas; tyres and wind grow with speed,
  tyres squeal in a slide, a wall grinds, and the computer drivers roar by. With the screen split, each
  person's car is on their side.
- **Stock Cars looks better.** The paint is glossy (with a clear coat where the screen has power to spare),
  the windows are dark glass, the rims are metal and the tyres are rubber; the cars reflect that track's sky
  and lights, their lights come on at dusk and at night, and each sits on a shadow of its own shape.

### Fixed
- The screen no longer dims and sleeps mid-game, on the TV page or on the phones (where the browser
  allows it; the TV app already kept its screen on).
- Stock Cars: the turns were bumpy. The banked surface was drawn flat across, so cars sank into it and
  rose out of it as they moved across the track; and a car sliding out to the wall bounced off it over
  and over instead of grinding along it.
- Stock Cars: the front wheels turn with the steering.
- Stock Cars: a knock from another car could throw a car right across the track. Hits are softer, and
  no hit throws a car sideways faster than 6 m/s.
- Stock Cars and Grand Prix: a car that went into a tight turn much too fast could be flung across the
  track, from one barrier to the other, without touching anything (up to 70 m/s sideways in one moment).
  A slide now builds up over a moment and has a limit. The computer drivers also ease across when they
  change lanes instead of darting.
- Two games finishing at the same moment could each pay the first-game-of-the-day bonus and go past the
  daily limits on stars. Payouts now happen one at a time.
- Going back to the game select page with the browser's Back button left a black screen until the page
  was reloaded.

## [0.2.0] - 2026-10-21

Stock Cars, Neon Trails and Chess are playable, players earn stars, and the program is now Beacon Arcade.

### Added (games)
- **Chess**, and a new **Board** category: 1–2 players, against a friend on the same screen or the computer
  (Easy, Medium, Hard; it thinks a little each frame, so the screen never freezes). The full rules (castling,
  en passant, promotion, the draws), the moves in standard notation, optional 5 or 10 minute clocks, draw offers
  and resigning, and saved records (including wins against each computer strength). Move a square with the
  phone's arrows, pick up and put down with Bolt. Our own pieces, drawn in code.
- Plans for more board games, all with generic names: Checkers, Four in a Row, Reversi, Backgammon, Ludo,
  Snakes and Ladders, Dominoes and Mancala (oware, or ayo as it's known in Nigeria).
- **Stock Cars**, the third playable game: 1–4 drivers on banked ovals, with up to 11
  computer drivers at three paces. Slipstreams, bump drafts, 3, 5 or 10 laps, a split screen for 2 to 4
  people, a TV camera when nobody's driving, engine sounds, and saved records (wins, best lap, the lap record).
  The phone becomes a steering pad with gas and brake. Pick from four tracks (countryside, desert at
  dusk, a harbour at night, a city) and six cars (from Kenney's CC0 Car Kit); cars bounce, scrape and spin.
- **Neon Trails**, the second playable game: 1–8 riders on phones or keyboards, computer riders to fill in,
  first to 3, 5 or 7 rounds, walls that close in so rounds don't drag, a demo round behind the lobby.
- **Saved progress** for every game (`gameSaves()`): kept on the machine running Beacon Arcade
  (in `beacon-arcade.db`, SQLite, so it runs the same on Android TV), so it's there next time. Neon Trails keeps each player's record, by phone.
- **How to play**: every playable game has a manual (`manual.json`), opened with Star on the game select page
  and in the lobby. The controls in it come from the game's `controls.json`.
- The game select page lists the games you can play right now first, under "Ready to play".

### Added
- **Stars and a shop.** Finishing a game earns stars (more for a win, a podium, a record or a title, and a
  bonus for the first game of the day; capped per day so replaying one quick game all night doesn't flood
  the shop). Each phone shows its stars; tapping them opens the shop, where they buy looks, never an
  advantage: paint jobs in Stock Cars (pick them in the garage with ▲▼), board themes in Chess. Games
  sell items with a `shop.json` and pay out with `earnStars()`.
- **Football tactics.** Five shapes for 11-a-side (4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 5-3-2) and more for 7- and
  5-a-side; team instructions (with the ball, back line, closing down, width) that change how the
  computer-controlled teammates play; a choice of keeper. Set them on the team sheet in the lobby or from
  the pause menu. Each player's plan is saved.
- Games can have an `icon.svg` and a `category` in `game.json`.
- Plans for 12 more games: Superbikes (motorbike grand prix), Grand Prix (open-wheel), Stock Cars (ovals),
  Go-Karts, and an Arcade category: Space Shooter, Bricks, Snake Battle, Neon Trails, Cat and Mouse,
  Space Rocks, Pinball, Road Hopper. Racing is now its own category.
- A shared plan for competitions in every game (`web/games/COMPETITIONS.md`): leagues, cups, groups,
  race weekends with qualifying, championships with points tables, playoffs, title fights and careers,
  ladders, arcade high scores, and an Arcade Cup across games. Each game's README says which it uses.

### Added (TV)
- **Android TV app** (`make android`, `android/README.md`): the TV runs the server and is the game screen;
  phones join it as usual. The remote works on the game select page; Back is Esc in games.
- **Device checks**: each game says what it needs in `game.json` (`light`, `standard`, `heavy`), the screen
  measures itself (memory and cores from the TV app or browser, graphics features, a short graphics test), and
  games it can't run well are shown as "Not on this TV" (or device), in plain words. A game opened anyway stops before
  loading anything big.
- **Running safely**: games lower their detail, then stop, if they can't keep up; running out of graphics
  memory ends the game cleanly. 3D games run at 30 fps on TVs. Leaving the app stops everything.
- The server can serve the web files from a folder (`-web DIR`, builds tagged `noweb`), be told the address to
  show the phones (`-host`), and stop when its parent app does (`-exit-with-stdin`).

### Added (pad)
- Pad layouts, picked by the game per screen: a **d-pad** (one tap, one step) for menus and grid games, the
  analog **stick** for moving freely, and **racing** (slide to steer, throttle and brake pedals). The game
  select page and football's menus now use the d-pad; football matches use the stick.

### Changed
- **Game Night is now Beacon Arcade** (the old name is already used by other game services). The program
  is `beacon-arcade`, and the user folder is `beacon-arcade` (an existing `game-night` folder is moved
  over, saved progress and all).
- The pad's four buttons are our own icons: **Bolt** (bottom), **Drop** (right), **Leaf** (left), **Star** (top),
  in amber, blue, green and pink. The logo is the four in their diamond. In `controls.json` the
  buttons are `bolt`, `drop`, `leaf`, `star`; manuals can draw one with `{bolt}`.
- Games renamed or reworked so none copies an existing game's name or look (see "Originality" in
  `web/games/README.md`); Danfo Rush is dropped.
- Football is marked **In progress**: playable, but still being worked on.
- New look everywhere, defined once in `web/brand/` (colours, type, components; rules in its README):
  a dark night palette with one volt accent and the pad's four button colours, Big Shoulders Display and
  Inter (bundled, works offline), line icons instead of emoji, and a selection frame.
- The game select page is now a library: the selected game on the left with how to join, every game
  on the right grouped by category, moved through with the stick or keyboard.
- The phone pad, football's lobby, scoreboard, banners, player HUD, pause menu and substitutions follow it.
  Player colours are the brand's.

### Fixed
- A phone with the pad open in two tabs no longer flips between them every second (so nothing it
  pressed counted). The older tab stops and offers to take over.
- A quick tap on the phone could be missed by menus; d-pad taps now always register.
- Two open game screens kept taking the phones from each other every second. The newest screen now
  wins, and the other one says so, with a button to take over again.
- A slow old connection being replaced could pause everyone's input for a few seconds.

### Removed
- The generic "Racing" plan, replaced by the three motorsport games and Go-Karts.
- The original art packs for football (Quaternius characters and animations) are now in the repo, in
  `web/games/football/source/`. Each game keeps its source art in its own `source/` folder; it's never shipped.

## [0.1.0] - 2026-10-19

First release (as "Game Night"; the program in that release is called `game-night`). The pad then used
another console's button symbols; they were replaced by our own (see 0.2.0).

### Added
- `beacon-arcade`: one program for macOS, Windows, Linux and Raspberry Pi that serves the games on your
  Wi-Fi and opens the game select page. Phones join by scanning a QR code; no app to install.
- Game select page, driven by phone, keyboard or mouse. Every folder in `games/` with a `game.json` is listed.
- The phone pad: stick, Bolt, Drop, Leaf, Star, L1, R1 and swipes, the same in every game. Buttons a game isn't using are
  dimmed. Players keep their number and colour across games and reconnects.
- Football: 11-a-side 3D football, 1–8 players, with fouls, cards, set pieces, substitutions, stamina,
  day and night, four cameras, and remappable controls.
- An optional user folder to replace built-in files (clubs, settings, controls) or add games without rebuilding.
- Plans for more games, each with a README: basketball, baseball, cricket, long tennis, table tennis, pool,
  beach volleyball, boxing, crazy golf, puck duel, dodgeball, fighters, brawlers, tanks, laser arena,
  bomb maze, sumo, dogfight, last stand, capture the flag, rooftop brawl, heist, and racing.
  (Some had other names at the time; they were renamed, and one dropped, so none borrows an existing game's name.)

[Unreleased]: https://github.com/beacon-engine/game-night/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/beacon-engine/game-night/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/beacon-engine/game-night/releases/tag/v0.1.0
