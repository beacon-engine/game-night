#!/bin/sh
# Builds the games written in Odin: web/games/<id>/odin/ -> web/games/<id>/sim.wasm.
#
#   scripts/wasm.sh            every game with an odin/ folder
#   scripts/wasm.sh pinball    just that one (what `make dev` runs when a game's Odin changes)
#
# Needs Odin (https://odin-lang.org; `brew install odin` on a Mac) and LLVM's wasm-ld linker,
# which Homebrew installs alongside it but doesn't put on the PATH. The .wasm files are kept in
# git, so building the rest of Beacon Arcade doesn't need Odin.
set -eu
cd "$(dirname "$0")/.."

if ! command -v odin >/dev/null 2>&1; then
	echo "odin not found: install it from https://odin-lang.org (brew install odin)" >&2
	exit 1
fi
if ! command -v wasm-ld >/dev/null 2>&1; then
	for dir in /opt/homebrew/opt/lld*/bin /usr/local/opt/lld*/bin /usr/lib/llvm-*/bin; do
		if [ -x "$dir/wasm-ld" ]; then PATH="$dir:$PATH"; break; fi
	done
fi
if ! command -v wasm-ld >/dev/null 2>&1; then
	echo "wasm-ld not found: install LLVM's lld (brew install lld, apt install lld)" >&2
	exit 1
fi

if [ $# -eq 0 ]; then
	set -- $(for d in web/games/*/odin; do [ -d "$d" ] && basename "$(dirname "$d")"; done)
fi
for game in "$@"; do
	echo "odin: $game"
	odin build "web/games/$game/odin" -target:freestanding_wasm32 -no-entry-point -o:speed \
		-vet -strict-style -out:"web/games/$game/sim.wasm"
done
