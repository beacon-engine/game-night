# Game Night

Couch games for the TV after a long day: the laptop is the console, everyone's phone is a pad.
No accounts, no app to install on the phones, nothing leaves your Wi-Fi.

## Play

Needs [Node.js](https://nodejs.org) 18 or newer.

```
npx game-night        # once it is published to npm
```

or from a copy of this repo:

```
npm install
npm start
```

1. Open **http://localhost:10000** on the laptop (put it on the TV via HDMI for the full experience) and pick a game (`npx game-night` opens it for you). Click once to enable sound.
2. On each phone (same Wi-Fi), scan the QR code or open the `/pad` URL shown on screen. Turn the phone sideways.
3. In the menu: stick ◀ ▶ changes your club, **SWAP** changes side, **START** kicks off.

No phones? Two keyboard players work too: `WASD` + `F G H` + Left Shift, or arrows + `, . /` + Right Shift.
Enter starts, Esc returns to the menu, **C** cycles the camera (full-width / broadcast / wide / close), **N** cycles name tags (all / active / none), **M** mutes.

## Football: PS2-style 3D football

### Controls (PlayStation layout on the phone pad)
Defaults below; every button can be remapped in `data/controls/football.json` (per situation:
`attack`, `defend`, `throwIn`; `"triangle+swipe"` = a swipe across △). Keyboard keys live in the same file.

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

The start screen (`/`) is the game picker: every game in `public/games/` shows up there, picked with a pad stick + ✕,
the keyboard, or the mouse. Football is the only one built so far. See *Adding a game* below.

Keyboard: WASD + F (✕) H (○) G (□) T (△) + L-Shift sprint, or arrows + `,` (✕) `/` (○) `.` (□) `;` (△) + R-Shift.
Enter kicks off, Esc/P pauses (Backspace quits from the pause menu), C camera, N name tags, M mute.

### Player abilities
Each player in `data/teams.json` has ratings out of 100:
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

### Customising (no code needed)
- `data/teams.json`: clubs, kits, players and their ratings (pace, passing, shooting, tackling, dribbling, keeping)
- `data/formations.json`: team shapes for 5-, 7- and 11-a-side
- `data/settings.json`: match length (halves swap ends at half time), `playersPerSide` (5, 7 or 11; use a smaller `pitch` for 5/7), pitch and goal size, `camera`, `nameTags`, `renderScale` (lower = faster on weak laptops), `aiSkill`

## Adding a game
Each game is a folder in `public/games/<id>/`. The picker finds it on its own (no restart needed):

```
public/games/my-game/
  game.json    { "name": "My Game", "icon": "🎯", "tagline": "One line", "players": "1–4", "order": 10 }
  index.html   the game itself, served at /games/my-game/
```

- A folder with only a `game.json` (or `"status": "soon"`) shows as *Coming soon*.
- Phones stay connected when you switch pages. Use the shared pad input with
  `import { Input, BTN } from '/js/input.js'`, and `loadControls('<id>')` from `/js/controls.js` for
  remappable buttons in `data/controls/<id>.json`.
- Send players back to the picker with `location.href = '/'` (football does this on Esc / ○ in its lobby).
- three.js is served at `/vendor/three.module.js` and `/addons/`; copy the import map from `public/games/football/index.html`.

## Troubleshooting
- Phone can't connect: allow Node through the macOS firewall prompt; some guest/office Wi-Fi blocks devices talking to each other, so use a phone hotspot instead.
- Phone screen dims mid-game: raise auto-lock time (browsers can't keep it awake over plain http).

## Credits
- Player bodies, faces and hair: [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) by Quaternius, CC0.
- Running/walking/idle motion capture: [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) by Quaternius, CC0.

Game copies live in `public/games/football/models/` (`ubc/` and `ual_ue.fbx`); the original downloads are not in the repo (put them in `assets/`, which git ignores).
Football actions (kicks, tackles, slides, dives...) are posed in code on the same skeleton.

The lobby has a ☀ DAY / 🌙 NIGHT switch (default from `timeOfDay` in `data/settings.json`).

## License

Code: [MIT](LICENSE). 3D models and animations: CC0 (see Credits).
