#!/bin/sh
# MakeHuman (MPFB) add-on and the CC0 / CC-BY asset packs, resumable
D="$(cd "$(dirname "$0")/../../.." && pwd)/web/people/source/mh"
mkdir -p "$D" && cd "$D" || exit 1
get() { for i in $(seq 1 60); do curl -sfL -C - --retry 5 -y 30 -Y 2000 -o "$2" "$1" && return 0; sleep 3; done; echo "FAILED $2"; }
get https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip mpfb-2.0.18.zip
B=https://files2.makehumancommunity.org/asset_packs
for p in makehuman_system_assets/makehuman_system_assets_cc0 eyelashes01/eyelashes01_cc0 gloves01/gloves01_cc0 underwear04/underwear04_cc0 hats01/hats01_cc0 eyebrows01/eyebrows01_cc0 pants01/pants01_cc0 shirts01/shirts01_cc0 hair03/hair03_ccby pants03/pants03_ccby suits01/suits01_cc0 hats02/hats02_cc0 shirts03/shirts03_ccby hair02/hair02_ccby skins01/skins01_cc0 shoes01/shoes01_cc0 shoes02/shoes02_ccby skins02/skins02_cc0 hair01/hair01_cc0 suits02/suits02_cc0; do
  get "$B/$p.zip" "$(basename $p).zip"
  ls -la "$(basename $p).zip"
done
echo ALL DONE
