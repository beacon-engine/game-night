#!/bin/sh
# The MakeHuman asset packs (fetched by mh.sh) into MPFB's library in Blender, where people.py finds them
D="$(cd "$(dirname "$0")/../../.." && pwd)/web/people/source/mh"
B=${BLENDER:-blender}
M=$("$B" -b --python-expr "import bpy; print('MPFB=' + bpy.utils.extension_path_user('bl_ext.user_default.mpfb', path='data', create=True))" 2>/dev/null | sed -n 's/^MPFB=//p')
[ -n "$M" ] || { echo "MPFB isn't installed in $B (see tools/people/README.md)"; exit 1; }
for z in "$D"/*_cc0.zip "$D"/*_ccby.zip; do
  [ -f "$z" ] && unzip -oq "$z" -d "$M" && echo "installed $(basename "$z")"
done
