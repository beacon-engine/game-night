# Beacon Arcade

Couch games for the TV after a long day: the laptop is the console, everyone's phone is a pad.
No accounts, no app to install on the phones, nothing leaves your Wi-Fi.

Nine games are playable today: Football, Stock Cars, Grand Prix, Rally, City Runners, Neon Trails, Space
Shooter, Fireteam and Chess. [Many more](web/games) are planned across sports, racing, action and arcade, each with its own
README, plus [competitions](web/games/COMPETITIONS.md) (leagues, cups, race weekends, championships).
Pick one and help build it.

### Weather

The outdoor games can be played in any weather, chosen in the lobby: **Dry**, **Showers** (dry to start,
then rain on and off), **Rain** (all game) or **Snow**. The rain wets the ground over half a minute and
it takes a couple of minutes to dry, so a shower changes the game for a stretch, not all at once. You
see it fall, the sky clouds over and the ground darkens and shines.

| Game | Weather | What it changes |
|---|---|---|
| Football | Dry, Showers, Rain, Snow | A wet pitch is quicker (the ball skids on and bounces lower) and players lose a little footing. In snow the ball rolls short, hardly bounces, and is orange so you can see it. |
| Grand Prix | Dry, Showers, Rain | Slicks or grooved wets: box when it changes and the crew fits the right ones. |
| Rally | Dry, Showers, Rain, Snow | Dirt turns to mud, tarmac gets slippery; snow covers the stage and everyone runs studs. |
| Stock Cars | Showers or Rain on the road course | Ovals are only raced dry, as in the real sport. Pick slicks or wets before the start. |

## Play

Download the archive for your computer from [Releases](https://github.com/beacon-engine/game-night/releases/latest),
unpack it and run `beacon-arcade`. It opens the game select page in your browser.

- **macOS**: it isn't signed with an Apple certificate yet, so the first run is blocked: allow it in
  System Settings → Privacy & Security → Open Anyway (or run `xattr -d com.apple.quarantine beacon-arcade`).
- **Windows**: allow it through the firewall when asked, so phones can reach it.
- **Raspberry Pi** (64-bit OS): the `linux-arm64-raspberry-pi` archive; plug the Pi into the TV.
- **Android TV**: install the `android-tv` APK on the TV itself, no computer needed. See [android/README.md](android/README.md).

Beacon Arcade checks what each screen can handle and only offers the games it runs well: a TV with 1 GB of
memory gets the 2D games, a laptop gets everything.

1. Put the browser on the TV (HDMI, or just play on the laptop) and pick a game. Click once to enable sound.
2. On each phone (same Wi-Fi), scan the QR code or open the `/pad/` address shown on screen. Turn the phone sideways.
3. Everyone uses the same pad in every game. The buttons a game isn't using right now are dimmed.

### Stars and the shop

Every game you finish earns **stars**: for playing, more for winning, coming in the top three or setting
a record, and a bonus for your first game of the day. Tap your stars at the top of your phone to open the
**shop** and spend them on looks: paint jobs in Stock Cars, board themes in Chess, with more to come.
Stars never buy an advantage, so a friend playing for the first time can still win. Stars, like saved
progress, belong to your phone and are kept on the machine running Beacon Arcade.

No phones? Two keyboard players work too: `WASD` + `F G H T` + Left Shift, or the arrows + `, / . ;` + Right Shift.

```
beacon-arcade                 start (and open the browser)
beacon-arcade -port 8080      another port (PORT=8080 works too)
beacon-arcade -no-open        don't open a browser
```

### Build it yourself
Needs [Go](https://go.dev) 1.23+ and [Node.js](https://nodejs.org) 22+ (Node is only for building the web pages).

```
make            # builds web/dist and the ./beacon-arcade binary
make dev        # rebuilds on change and serves from disk: http://localhost:10000
make check      # type-checks the TypeScript, vets and tests the Go
make release    # binaries for macOS, Windows and Linux in dist/
make android    # the Android TV app in dist/ (needs a JDK and the Android SDK)
```

## Football: 11-a-side 3D football (in progress)

In the lobby each player has a team sheet for their side: ▲▼ moves down it, ◀ ▶ changes the line you're on
(club, shape, who starts in goal, and the team instructions below). Leaf swaps side, Bolt kicks off, Drop goes back to the games.

### Tactics
- **Shape**: from `formations.json`. 11-a-side: 4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 5-3-2; 7-a-side: 2-3-1, 3-2-1, 2-2-2;
  5-a-side: 1-2-1, 2-1-1, 2-2. Changing it mid-match moves each player to the nearest free place in the new shape.
- **With the ball**: *Keep the ball* (short, safe passes, shots from closer in, the team stays close together),
  *Mix it up* (the default), *Get it forward* (more forward and long passes, forwards run beyond the ball, shots from further out),
  *Hit on the break* (sits a little deeper with the forwards left up; for a few seconds after winning the ball everyone sprints forward and looks for the forward pass first).
- **Back line**: *Sit deep* / *Normal* / *Push up*: how high the whole team stands and how far up the defenders ever go.
- **Closing down**: *Stand off* (only goes to the ball when it's close or in our half, keeps the team tighter, tackles less),
  *Normal*, *Hunt the ball* (a second man joins the press in their half, tackles more, pushes up on their goal kicks).
- **Width**: *Stay narrow* / *Normal* / *Stretch wide*: how far apart players stand across the pitch (mostly with the ball).
- **In goal**: every squad has at least two keepers (a club in `teams.json` with only one gets a made-up stand-in).
  Pick the starter in the lobby; during a match a keeper can only be substituted for a keeper.

All of this works mid-match too: pause, choose Tactics (▲▼ choose, ◀ ▶ or Bolt change, Drop back).
Each player's shape, instructions and keeper (per club) are saved with their phone (keyboard players: per key layout)
and come back when they are the only player on a side.

### Controls (on the phone pad)
Defaults below; every button can be remapped in `games/football/controls.json` (per situation:
`attack`, `defend`, `throwIn`; `"star+swipe"` = a swipe across Star).

| Button | With the ball | Without it | Throw-in |
|--------|---------------|------------|----------|
| Bolt | Pass toward the stick | Hold: press (chase the ball, stab at it in reach) | Short throw |
| Drop | Long pass | Tackle (standing if close, slides in from a few metres) | Long throw |
| Leaf | Shoot: hold for power, stick aims | — | — |
| Star | Through ball along the ground; swipe across it: lofted | — | Short throw |
| L1 | Step-over | Switch player | |
| R1 | Drag-back | Hold: a teammate presses too | |
| Stick past its ring | Sprint | Sprint | |
| ❚❚ (top bar) | Pause menu: stick ▲▼ choose, Bolt select, Drop back (resume, subs, tactics, controls, camera, name tags, sound, restart, quit) | | |

Keyboard: WASD + F (Bolt) H (Drop) G (Leaf) T (Star) Y (lofted Star), Q/E step-over/drag-back, L-Shift sprint;
or arrows + `,` (Bolt) `/` (Drop) `.` (Leaf) `;` (Star) `'` (lofted Star), K/L, R-Shift.
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
- **foot**: his better foot: `"right"`, `"left"` or `"both"`. He strikes with the foot on the side the
  ball is; a one-footed player wraps his good foot round it some of the time, and with his weaker foot a
  pass or shot is less accurate and has less on it. Two-footed players are nearly as good with either.
  The foot shows beside his ratings on screen.
- **style** (optional): how he runs with the ball: `"close"` (little touches, sharp turns),
  `"knock"` (pushes it into space and sprints onto it) or `"balanced"`.
  If left out it's worked out from the ratings: dribbling 86+ = close, pace 86+ = knock.

### Fatigue and substitutions
Players tire as they run and recover when they ease off; your player's stamina bar is on screen.
Each team has 5 substitutes on the bench and can make 5 changes: pause, choose Substitutions, pick who comes off (Bolt) and who comes on (Bolt).
Computer-controlled teams bring on fresh legs themselves in the second half.

### Rules
Fouls (late or from-behind tackles), yellow and red cards (two yellows = off), free kicks with a defensive wall,
penalties for fouls in the box, corners, throw-ins, goal kicks, half-time with a change of ends.
A keeper holding the ball can't be challenged (it's a foul) and opponents must give him room to release it.
Back-pass rule: if a teammate deliberately kicks (or throws in) the ball to his own keeper, the keeper can't pick it up
and has to play it with his feet; headers, chest-downs and deflections are fine.
On a free kick, corner or penalty you're the taker: aim with the stick, then PASS / LOB / hold SHOOT.

## Customising (no code needed)

Beacon Arcade reads an optional folder before its built-in files: `~/Library/Application Support/beacon-arcade/`
on macOS, `%AppData%\beacon-arcade\` on Windows, `~/.config/beacon-arcade/` on Linux (or pass `-dir`).
Your saved progress and stars are kept in `beacon-arcade.db` in that folder (one SQLite file: copy it
to back everything up). Anything else you put there replaces the built-in file with the same path. For football:

- `games/football/teams.json`: clubs, kits, players and their ratings
- `games/football/formations.json`: team shapes for 5-, 7- and 11-a-side: per size, a list of `{ name, note, slots }`
  (the first is the default; each shape's first slot is the keeper). The older form, one list of slots per size, still works.
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
main.go                 the beacon-arcade command
internal/server/        HTTP server, game discovery, the phone <-> game relay (WebSocket), saves, stars, the shop
internal/store/         the database (SQLite, pure Go: the same build runs on Android)
web/
  build.ts              bundles each app with esbuild into web/dist (embedded in the binary)
  platform/             shared by every game: the pad, input, controls, wire protocol
  world/                shared by the 3D games: weather, rain and snow, the sky, particles, split screen, trees (ez-tree)
  racing/               shared by the racing games: cars and tyres, tracks, the race, engine sound (car models at /racing/models/)
  people/               the people in the 3D games: real bodies in real clothes, and their motion capture (/people/)
  armoury/              guns, ready to hold (/armoury/)
  hub/                  the game select page (/)
  pad/                  the phone controller (/pad/)
  games/<id>/           one folder per game (/games/<id>/)
```

Games share code through these folders (imported as `@platform`, `@world/…`, `@racing/…`, `@people/…`, `@armoury/…`), never by
reaching into another game's folder. Each page is bundled with only what it imports.

**Only the game you're playing is loaded.** Every game is its own page: the game select page loads
nothing but its own small script (20 KB) and the list of games, and a game's page loads only its own
script, models and textures, from the server, when you open it. Leaving a game frees all of it in the
browser. The server reads files out of the binary as they're asked for (it idles at about 20 MB of
memory, every game's models included).

The server relays between one display (the page on the TV) and the phones; the message shapes are
in [`web/platform/protocol.ts`](web/platform/protocol.ts). It also hands out player slots (P1, P2...),
so a phone keeps its number and colour across games and reconnects.

## Versions

Releases follow [Semantic Versioning](https://semver.org) and are listed in [CHANGELOG.md](CHANGELOG.md).
`beacon-arcade -version` says which one you have. How to cut a release: [RELEASING.md](RELEASING.md).

## Where it's headed

The idea this started from: a small portable console (a Raspberry Pi) that plugs into any TV over HDMI,
with phones connecting as pads over Bluetooth through a pad app, speaking one shared protocol. Today the
pads are web pages over Wi-Fi, which needs nothing installed; the protocol in
[`web/platform/protocol.ts`](web/platform/protocol.ts) is the one a Bluetooth pad would speak too, and
`beacon-arcade` already runs on a Pi.

## Troubleshooting
- Phone can't connect: allow beacon-arcade through the firewall prompt; some guest/office Wi-Fi blocks devices talking to each other, so use a phone hotspot instead.
- Phone screen dims mid-game: raise auto-lock time (browsers can't keep it awake over plain http).
- A typo in a `controls.json` shows up as a warning in the browser console (that button just does nothing).

## Credits
- Brand: [`web/brand/`](web/brand). Fonts: Big Shoulders Display and Inter (SIL Open Font License).
  Icons: [Tabler Icons](https://tabler.io/icons) (MIT).
- People (the footballers): bodies, faces, skin, hair and clothes from [MakeHuman](http://www.makehumancommunity.org)
  community assets, CC0, apart from two CC-BY parts: the shorts by Elvaerwyn and the boots (running shoes) by punkduck. They're built with [MPFB](https://extensions.blender.org/add-ons/mpfb/) in Blender
  ([`tools/people/`](tools/people/README.md)).
- Motion capture: the [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu) (runs, kicks, falls,
  getting up), and the [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)
  1 and 2 by Quaternius, CC0 (the idle, slides, throws; and City Runners' moves).
- City Runners' bodies: [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) by Quaternius, CC0.
- Cars: [Car Kit](https://kenney.nl/assets/car-kit) by Kenney, CC0 (in [`web/racing/models/`](web/racing/models)).
- Space Shooter's ships, enemies, bosses and scenery: [Space Kit](https://kenney.nl/assets/space-kit) by Kenney, CC0.
- Fireteam's countryside: textures, plants, props and the sky from [Poly Haven](https://polyhaven.com), CC0; trees grown
  by [ez-tree](https://github.com/dgreenheck/ez-tree) by Daniel Greenheck, MIT (in [`web/world/trees/`](web/world/trees)). Guns: the [Low Poly Weapon Pack](https://opengameart.org/content/low-poly-weapon-pack), CC0.

The original downloads are kept in `source/` folders next to what's made from them
([`web/people/source/`](web/people/README.md), a game's own `source/`), and aren't shipped in the binary.
Football actions other than running and striking the ball (tackles, dives, controls...) are still posed in code, on the same skeleton.

## License

Code: [MIT](LICENSE). 3D models and animations: CC0, CC-BY and the CMU database's terms (see Credits).
