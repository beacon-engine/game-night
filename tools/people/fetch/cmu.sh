#!/bin/sh
# The CMU motion capture takes we use (BVH conversion of the CMU Graphics Lab database), resumable
D="$(cd "$(dirname "$0")/../../.." && pwd)/web/people/source/cmu"
mkdir -p "$D" && cd "$D" || exit 1
R=https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data
for t in 02_03 02_05 09_01 09_02 09_03 09_05 09_08 10_01 10_02 10_03 10_04 10_05 10_06 11_01 \
  13_17 13_18 14_01 14_02 14_03 15_13 17_10 79_08 80_10 86_01 86_06 86_08 76_01 \
  16_35 16_36 16_37 16_39 16_41 16_43 16_45 16_55 16_57 35_17 35_18 35_22 35_26 78_06 78_12 78_20 78_21 78_24 78_29 78_31 \
  20_08 21_08 104_03 139_05 139_09 139_10 139_11 139_14 139_16 139_18 139_19 139_29 139_31 79_96 80_03 \
  136_09 136_11 111_03 111_06 111_07 133_01 140_01 140_03 140_08 90_16 127_23 128_10 141_01 141_10 141_11 \
  33_01 33_02 34_01 34_02 22_17 23_17 75_16 85_15 78_32 78_25 78_33; do
  s=$(echo $t | cut -d_ -f1); s=$(printf %03d $((10#$s)))
  [ -s $t.bvh ] && continue
  # (into a .part, resumed after a stall, and only named .bvh once it's all there)
  for i in $(seq 1 30); do curl -sfL -C - --retry 4 -y 30 -Y 2000 -o $t.part "$R/$s/$t.bvh" && mv $t.part $t.bvh && break; sleep 3; done
  [ -s $t.bvh ] || echo "FAILED $t"
done
ls | wc -l
echo ALL DONE
