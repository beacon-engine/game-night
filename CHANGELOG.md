# Changelog

All notable changes to Game Night. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

### Added
- The original art packs for football (Quaternius characters and animations) are now in the repo, in
  `web/games/football/source/`. Each game keeps its source art in its own `source/` folder; it's never shipped.

## [0.1.0] - 2026-10-19

First release.

### Added
- `game-night`: one program for macOS, Windows, Linux and Raspberry Pi that serves the games on your
  Wi-Fi and opens the game select page. Phones join by scanning a QR code; no app to install.
- Game select page, driven by phone, keyboard or mouse. Every folder in `games/` with a `game.json` is listed.
- The phone pad: stick, ✕ ○ □ △, L1, R1 and swipes, the same in every game. Buttons a game isn't using are
  dimmed. Players keep their number and colour across games and reconnects.
- Football: PS2-style 3D football, 1–8 players, with fouls, cards, set pieces, substitutions, stamina,
  day and night, four cameras, and remappable controls.
- An optional user folder to replace built-in files (clubs, settings, controls) or add games without rebuilding.
- Plans for 23 more games, each with a README: basketball, baseball, cricket, long tennis, table tennis,
  pool, racing, beach volleyball, boxing, crazy golf, air hockey, dodgeball, fighters, street brawler,
  tanks, laser tag, blast zone, sumo push, dogfight, last stand, capture the flag, rooftop brawl,
  danfo rush and heist.

[Unreleased]: https://github.com/beacon-engine/game-night/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/beacon-engine/game-night/releases/tag/v0.1.0
