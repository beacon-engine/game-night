# Changelog

All notable changes to Beacon Arcade. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

### Added
- **Stock Cars: a road course.** Ridgeway, 2.3 km in the hills, turning both ways: the esses, a loop to the
  right and a hairpin, with walls both sides and kerbs in the turns. Brake for the turns; the computer
  drivers take the racing line and brake for them too. Tracks can now be a whole lap (`"lap"` in
  `tracks.json`), with right turns.

### Changed
- **Stock Cars handles differently.**
  - The cars differ more: the Prototype is quickest flat out and wins on the big oval, the Hot Hatch and
    the Open Wheeler on the short track and the road course, and the heavy ones win the shoving matches.
  - An oval's banking is steeper up by the wall, so the high line carries more speed, and the apron below
    the inside edge is slow: hugging the bottom is no longer the way round.
  - Cars bounce off each other, and the walls, with a knock you can't just steer out of. Walls cost more
    speed, and grinding along one costs more still.
  - The computer drivers keep looking for a way past instead of sitting behind a slower car.
- **Stock Cars looks better.** The paint is glossy (with a clear coat where the screen has power to spare),
  the windows are dark glass, the rims are metal and the tyres are rubber; the cars reflect that track's sky
  and lights, their lights come on at dusk and at night, and each sits on a shadow of its own shape.

### Fixed
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
