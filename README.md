# Game Night

Couch games for the TV after a long day: the laptop is the console, everyone's phone is a pad.
No accounts, no app to install on the phones, nothing leaves your Wi-Fi.

Football is playable today and [23 more games](web/games) are planned, each with its own README.
Pick one and help build it.

## Play

Download the archive for your computer from [Releases](https://github.com/beacon-engine/game-night/releases/latest),
unpack it and run `game-night`. It opens the game select page in your browser.

- **macOS**: it isn't signed with an Apple certificate yet, so the first run is blocked: allow it in
  System Settings → Privacy & Security → Open Anyway (or run `xattr -d com.apple.quarantine game-night`).
- **Windows**: allow it through the firewall when asked, so phones can reach it.
- **Raspberry Pi** (64-bit OS): the `linux-arm64-raspberry-pi` archive; plug the Pi into the TV.

1. Put the browser on the TV (HDMI, or just play on the laptop) and pick a game. Click once to enable sound.
2. On each phone (same Wi-Fi), scan the QR code or open the `/pad/` address shown on screen. Turn the phone sideways.
3. Everyone uses the same pad in every game. The buttons a game isn't using right now are dimmed.

No phones? Two keyboard players work too: `WASD` + `F G H T` + Left Shift, or the arrows + `, / . ;` + Right Shift.

```
game-night                 start (and open the browser)
game-night -port 8080      another port (PORT=8080 works too)
game-night -no-open        don't open a browser
```

### Build it yourself
Needs [Go](https://go.dev) 1.23+ and [Node.js](https://nodejs.org) 22+ (Node is only for building the web pages).

```
make            # builds web/dist and the ./game-night binary
make dev        # rebuilds on change and serves from disk: http://localhost:10000
make check      # type-checks the TypeScript, vets and tests the Go
make release    # binaries for macOS, Windows and Linux in dist/
```

## Football: PS2-style 3D football

In the lobby: stick ◀ ▶ changes your club, □ swaps side, ✕ kicks off, ○ goes back to the games.

### Controls (PlayStation layout on the phone pad)
Defaults below; every button can be remapped in `games/football/controls.json` (per situation:
`attack`, `defend`, `throwIn`; `"triangle+swipe"` = a swipe across △).

| Button | With the ball | Without it | Throw-in |
|--------|---------------|------------|----------|
| ✕ | Pass toward the stick | Hold: press (chase the ball, stab at it in reach) | Short throw |
| ○ | Long pass | Tackle (standing if close, slides in from a few metres) | Long throw |
| □ | Shoot: hold for power, stick aims | — | — |
| △ | Through ball along the ground; swipe across it: lofted | — | Short throw |
| L1 | Step-over | Switch player | |
| R1 | Drag-back | Hold: a teammate presses too | |
| Stick past its ring | Sprint | Sprint | |
| ❚❚ (top bar) | Pause menu: stick ▲▼ choose, ✕ select, ○ back (resume, subs, controls, camera, name tags, sound, restart, quit) | | |

Keyboard: WASD + F (✕) H (○) G (□) T (△) Y (lofted △), Q/E step-over/drag-back, L-Shift sprint;
or arrows + `,` (✕) `/` (○) `.` (□) `;` (△) `'` (lofted △), K/L, R-Shift.
Enter kicks off, Esc/P pauses, C cycles the camera (full-width / broadcast / wide / close), N name tags (all / active / none), M mutes.

### Player abilities
Each player in `teams.json` has ratings out of 100:
- **pace**: top speed (about 7.0 m/s at 60 up to 8.4 m/s at 100) and acceleration
- **passing**: accuracy of passes and crosses
- **shooting**: shot power and accuracy, header power
- **dribbling**: how much pace you keep with the ball, touch accuracy, turning, first touch, selling a step-over
- **stamina**: how quickly a player tires (tired players are slower and can't sprint as much)
- **tackling**: chance of winning the ball cleanly
- **keeping** (keepers): reach, reactions, catching instead of parrying
- **style** (optional): how he runs with the ball: `"close"` (little touches, sharp turns, like Messi),
  `"knock"` (pushes it into space and sprints onto it, like Ronaldo/Rashford) or `"balanced"`.
  If left out it's worked out from the ratings: dribbling 86+ = close, pace 86+ = knock.

### Fatigue and substitutions
Players tire as they run and recover when they ease off; your player's stamina bar is on screen.
Each team has 5 substitutes on the bench and can make 5 changes: pause, choose Substitutions, pick who comes off (✕) and who comes on (✕).
Computer-controlled teams bring on fresh legs themselves in the second half.

### Rules
Fouls (late or from-behind tackles), yellow and red cards (two yellows = off), free kicks with a defensive wall,
penalties for fouls in the box, corners, throw-ins, goal kicks, half-time with a change of ends.
A keeper holding the ball can't be challenged (it's a foul) and opponents must give him room to release it.
Back-pass rule: if a teammate deliberately kicks (or throws in) the ball to his own keeper, the keeper can't pick it up
and has to play it with his feet; headers, chest-downs and deflections are fine.
On a free kick, corner or penalty you're the taker: aim with the stick, then PASS / LOB / hold SHOOT.

## Customising (no code needed)

Game Night reads an optional folder before its built-in files: `~/Library/Application Support/game-night/`
on macOS, `%AppData%\game-night\` on Windows, `~/.config/game-night/` on Linux (or pass `-dir`).
Anything you put there replaces the built-in file with the same path. For football:

- `games/football/teams.json`: clubs, kits, players and their ratings
- `games/football/formations.json`: team shapes for 5-, 7- and 11-a-side
- `games/football/settings.json`: match length, `playersPerSide` (5, 7 or 11; use a smaller `pitch` for 5/7),
  pitch and goal size, `camera`, `nameTags`, `timeOfDay`, `maxFps`, `renderScale` (lower = faster on weak laptops), `aiSkill`
- `games/football/controls.json`: which button does what

Copy the originals from [`web/games/football/`](web/games/football) to start from.

## Adding a game

A game is a folder in [`web/games/`](web/games); there is no list to register it in. That page has the
roadmap, how a game folder works and the `@platform` API. A built game (plain `index.html` + scripts)
can also be dropped into `<your folder>/games/<id>/` (see Customising) and shows up without rebuilding.

In short:

```ts
import { Input, BIT, loadControls, backToHub } from '@platform';

// your own state on each player, typed
const input = new Input({ state: () => ({ score: 0 }) });

// your actions, bound to pad buttons in controls.json; unknown names are reported, not fatal
const controls = await loadControls(['play'] as const, ['jump', 'duck'] as const);

function tick() {
  for (const p of input.list) {
    // p.x / p.y: the stick, p.tag: 'P1', p.color: their colour in every game
    for (const ev of p.drain()) {
      if (ev.down && controls.action('play', ev.bit) === 'jump') p.score++;
    }
    // what their phone shows; buttons without a label are dimmed
    input.show(p, { label: p.tag, color: p.color, title: 'My Game', accent: '#0ea5e9', hint: '', labels: controls.labels('play') });
  }
  requestAnimationFrame(tick);
}
```

Phones stay connected when you go from page to page, and keep their player number.
Send everyone back to the game select page with `backToHub()`.

## How it fits together

```
main.go                 the game-night command
internal/server/        HTTP server, game discovery, the phone <-> game relay (WebSocket)
web/
  build.ts              bundles each app with esbuild into web/dist (embedded in the binary)
  platform/             shared by every game: the pad, input, controls, wire protocol
  hub/                  the game select page (/)
  pad/                  the phone controller (/pad/)
  games/<id>/           one folder per game (/games/<id>/)
```

The server relays between one display (the page on the TV) and the phones; the message shapes are
in [`web/platform/protocol.ts`](web/platform/protocol.ts). It also hands out player slots (P1, P2...),
so a phone keeps its number and colour across games and reconnects.

## Versions

Releases follow [Semantic Versioning](https://semver.org) and are listed in [CHANGELOG.md](CHANGELOG.md).
`game-night -version` says which one you have. How to cut a release: [RELEASING.md](RELEASING.md).

## Where it's headed

The idea this started from: a small portable console (a Raspberry Pi) that plugs into any TV over HDMI,
with phones connecting as pads over Bluetooth through a pad app, speaking one shared protocol. Today the
pads are web pages over Wi-Fi, which needs nothing installed; the protocol in
[`web/platform/protocol.ts`](web/platform/protocol.ts) is the one a Bluetooth pad would speak too, and
`game-night` already runs on a Pi.

## Troubleshooting
- Phone can't connect: allow game-night through the firewall prompt; some guest/office Wi-Fi blocks devices talking to each other, so use a phone hotspot instead.
- Phone screen dims mid-game: raise auto-lock time (browsers can't keep it awake over plain http).
- A typo in a `controls.json` shows up as a warning in the browser console (that button just does nothing).

## Credits
- Player bodies, faces and hair: [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) by Quaternius, CC0.
- Running/walking/idle motion capture: [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) by Quaternius, CC0.

The game loads `web/games/football/models/`; the full original packs are in [`web/games/football/source/`](web/games/football/source)
(not shipped in the binary). Each game keeps its own source art in its own `source/` folder.
Football actions (kicks, tackles, slides, dives...) are posed in code on the same skeleton.

## License

Code: [MIT](LICENSE). 3D models and animations: CC0 (see Credits).
