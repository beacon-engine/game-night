#!/bin/sh
# Builds the Android TV app: dist/beacon-arcade_<version>_android-tv.apk
# Usage: scripts/android.sh v1.2.0   (run `make web` first; `make android` does both)
# Needs a JDK 17+ and the Android SDK (ANDROID_HOME).
set -eu
version=${1:?usage: scripts/android.sh <version>}
app=android/app/src/main

# The server, as an executable for each ARM flavour TVs run (32-bit is still common on TVs).
# Static Linux builds run on Android as they are; the web files ship separately (below).
for target in "arm64 arm64-v8a" "arm armeabi-v7a"; do
  set -- $target
  mkdir -p "$app/jniLibs/$2"
  CGO_ENABLED=0 GOOS=linux GOARCH=$1 GOARM=7 go build -tags noweb -trimpath \
    -ldflags "-s -w -X main.version=$version" -o "$app/jniLibs/$2/libgamenight.so" .
done

# The web files, unpacked on the TV on first run
mkdir -p "$app/assets"
rm -f "$app/assets/web.zip"
(cd web/dist && zip -qr -X "../../$app/assets/web.zip" .)

# versionCode: v1.2.3 -> 1020300, plus commits since the tag (v1.2.3-4-gabc -> 1020304)
code=$(echo "$version" | sed -E 's/^v?([0-9]+)\.([0-9]+)\.([0-9]+)(-([0-9]+)-g.*)?.*$/\1 \2 \3 \5/' |
  awk '{ n = $4 == "" ? 0 : $4; if (n > 99) n = 99; print $1 * 1000000 + $2 * 10000 + $3 * 100 + n }')
case "$code" in ''|*[!0-9]*) code=1 ;; esac

(cd android && ./gradlew -q assembleRelease -PgnVersionName="$version" -PgnVersionCode="$code")
mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk "dist/beacon-arcade_${version}_android-tv.apk"
echo "  dist/beacon-arcade_${version}_android-tv.apk (versionCode $code)"
