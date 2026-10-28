#!/bin/sh
# Fireteam's ground, wall and roof textures (Poly Haven, CC0) at game size, from source/polyhaven/ into
# models/tex/: colour at 1024 px, normal and ARM (occlusion, roughness, metal) at 512. (macOS sips.)
cd "$(dirname "$0")/../../web/games/fireteam" || exit 1
mkdir -p models/tex
for d in source/polyhaven/*/; do
  n=$(basename "$d")
  [ -f "$d${n}_diff_1k.jpg" ] || continue
  sips -s format jpeg -s formatOptions 78 -Z 1024 "$d${n}_diff_1k.jpg" --out "models/tex/${n}_diff.jpg" >/dev/null
  [ -f "$d${n}_nor_gl_1k.jpg" ] && sips -s format jpeg -s formatOptions 80 -Z 512 "$d${n}_nor_gl_1k.jpg" --out "models/tex/${n}_nor.jpg" >/dev/null
  [ -f "$d${n}_arm_1k.jpg" ] && sips -s format jpeg -s formatOptions 80 -Z 512 "$d${n}_arm_1k.jpg" --out "models/tex/${n}_arm.jpg" >/dev/null
done
# leaf and grass cards: colour and cut-out (the page puts them together)
for n in shrub_01 grass_medium_01 nettle_plant; do
  sips -s format jpeg -s formatOptions 82 -Z 1024 "source/polyhaven/$n/textures/${n}_diff_1k.jpg" --out "models/tex/${n}_diff.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 85 -Z 1024 "source/polyhaven/$n/textures/${n}_alpha_1k.jpg" --out "models/tex/${n}_alpha.jpg" >/dev/null
done
cp source/polyhaven/farmland_overcast/farmland_overcast_1k.hdr models/tex/sky.hdr
ls -la models/tex | awk '{s+=$5} END {print s/1024/1024 " MB"}'
