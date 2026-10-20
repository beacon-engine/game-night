# Changelog

All notable changes to Beacon Arcade. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

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

### Fixed
- A phone with the pad open in two tabs no longer flips between them every second (so nothing it
  pressed counted). The older tab stops and offers to take over.

- New look everywhere, defined once in `web/brand/` (colours, type, components; rules in its README):
  a dark night palette with one volt accent and the pad's four button colours, Big Shoulders Display and
  Inter (bundled, works offline), line icons instead of emoji, and a selection frame.
- The game select page is now a library: the selected game on the left with how to join, every game
  on the right grouped by category, moved through with the stick or keyboard.
- The phone pad, football's lobby, scoreboard, banners, player HUD, pause menu and substitutions follow it.
  Player colours are the brand's.

### Added
- Games can have an `icon.svg` and a `category` in `game.json`.
- Plans for 12 more games: Superbikes (motorbike grand prix), Grand Prix (open-wheel), Stock Cars (ovals),
  Go-Karts, and an Arcade category: Space Shooter, Bricks, Snake Battle, Neon Trails, Cat and Mouse,
  Space Rocks, Pinball, Road Hopper. Racing is now its own category.
- A shared plan for competitions in every game (`web/games/COMPETITIONS.md`): leagues, cups, groups,
  race weekends with qualifying, championships with points tables, playoffs, title fights and careers,
  ladders, arcade high scores, and an Arcade Cup across games. Each game's README says which it uses.

### Added (games)
- **Stock Cars**, the third playable game: 1–4 drivers on a banked oval under the lights, with up to 11
  computer drivers at three paces. Slipstreams, bump drafts, 3, 5 or 10 laps, a split screen for 2 to 4
  people, a TV camera when nobody's driving, engine sounds, and saved records (wins, best lap, the lap record).
  The phone becomes a steering pad with gas and brake. Pick from four tracks (countryside, desert at
  dusk, a harbour at night, a city) and six cars (from Kenney's CC0 Car Kit); cars bounce, scrape and spin.
- **Neon Trails**, the second playable game: 1–8 riders on phones or keyboards, computer riders to fill in,
  first to 3, 5 or 7 rounds, walls that close in so rounds don't drag, a demo round behind the lobby.
- **Saved progress** for every game (`gameSaves()`): kept as files on the machine running Beacon Arcade
  (`<your folder>/saves/`), so it's there next time. Neon Trails keeps each player's record, by phone.
- **How to play**: every playable game has a manual (`manual.json`), opened with Star on the game select page
  and in the lobby. The controls in it come from the game's `controls.json`.
- The game select page lists the games you can play right now first, under "Ready to play".

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

### Fixed
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
another console's button symbols; they were replaced by our own (see Unreleased).

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

[Unreleased]: https://github.com/beacon-engine/game-night/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/beacon-engine/game-night/releases/tag/v0.1.0
