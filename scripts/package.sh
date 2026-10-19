#!/bin/sh
# Builds game-night for every platform into dist/ as release archives:
#   game-night_<version>_<platform>.tar.gz (.zip for Windows), plus checksums.txt
# Usage: scripts/package.sh v1.2.0   (run `make web` first; `make release` does both)
set -eu
version=${1:?usage: scripts/package.sh <version>}
rm -rf dist
mkdir -p dist

# GOOS GOARCH name
targets="darwin arm64 macos-apple-silicon
darwin amd64 macos-intel
windows amd64 windows-x64
linux amd64 linux-x64
linux arm64 linux-arm64-raspberry-pi"

echo "$targets" | while read -r goos goarch name; do
  dir="dist/game-night_${version}_${name}"
  bin="game-night"
  [ "$goos" = windows ] && bin="game-night.exe"
  mkdir -p "$dir"
  CGO_ENABLED=0 GOOS=$goos GOARCH=$goarch go build -trimpath -ldflags "-s -w -X main.version=$version" -o "$dir/$bin" .
  cp README.md LICENSE CHANGELOG.md "$dir/"
  (cd dist && if [ "$goos" = windows ]; then zip -qr "$(basename "$dir").zip" "$(basename "$dir")"; else tar -czf "$(basename "$dir").tar.gz" "$(basename "$dir")"; fi)
  rm -rf "$dir"
  echo "  built $name"
done

(cd dist && shasum -a 256 game-night_* > checksums.txt)
echo "  dist/ ready for $version"
