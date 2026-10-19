# Game Night for Android TV

The TV runs everything: it's the game screen, and it runs the game-night server the phones join.
No laptop needed.

## Put it on your TV

1. Get `game-night_<version>_android-tv.apk` (from a release, or `make android`).
2. Install it, one of:
   - **Over the network (adb):** on the TV, turn on Developer options (Settings → Device Preferences → About →
     click Build 7 times), then Developer options → USB / Network debugging. On a computer on the same Wi-Fi:
     `adb connect <tv-ip>` then `adb install game-night_<version>_android-tv.apk`.
   - **From a USB stick:** copy the APK onto it, and open it on the TV with a file manager app
     (allow it to install unknown apps when asked).
3. Open **Game Night** from the TV's apps. Phones on the same Wi-Fi scan the QR code, as usual.

The remote works on the game select page (arrows, OK). **Back** acts like Esc inside a game (pause, back
to the lobby, back to the games) and leaves the app from the game select page.

## Looking after the TV

A TV is both the screen and the computer here, and many have little memory (1 GB is common).
So Game Night checks what it's running on before offering anything:

- The app tells the page the TV's real memory and CPU cores; the page tests its graphics. Each game says
  what it needs in its `game.json` (`light`: 2D, `standard`: simple 3D, `heavy`: big 3D like football).
  Games the TV can't run well are shown as **Not on this TV**, with a plain explanation, and can't be started.
  On a 1 GB TV that leaves the 2D games.
- 3D games run at a steady 30 fps on the TV.
- If a game can't keep up anyway, it lowers its detail, then stops and goes back to the games rather than
  grind. If the TV runs out of graphics memory, the game ends cleanly; if the page itself is killed for
  memory, the app reopens the game select page.
- Leaving the app (Home, another app) stops the game and the server. If Android kills the app, the server
  notices (`-exit-with-stdin`) and stops too. Nothing runs in the background.

Software can't damage a TV's hardware: its chip slows itself down when it gets hot. The point of all this
is that it never gets there, and the TV stays responsive.

## How it works

```
app/src/main/java/.../
  MainActivity.kt   full-screen WebView on http://127.0.0.1:<port>/; remote keys; starts/stops the server
  GameServer.kt     runs the server: lib/<abi>/libgamenight.so (the same Go program, built for Linux on ARM)
  WebFiles.kt       unpacks assets/web.zip (the built web/dist) once per version
  DeviceInfo.kt     memory, cores and model for the page (window.GameNightApp); the Wi-Fi address for the QR code
```

`scripts/android.sh` (`make android`) builds the server for 64- and 32-bit ARM into `jniLibs/`, zips
`web/dist` into `assets/`, and runs Gradle. Needs a JDK 17+ and the Android SDK (`ANDROID_HOME`).

The APK is signed with the Android debug key, which is fine for installing it yourself. Before it goes to a
store, or if releases should update each other in place on everyone's TVs, it needs a real signing key.
