# Makes models/people/: the two bodies, the hairstyles and the eyebrows from Quaternius' Universal Base
# Characters (CC0; the originals are in ../../football/source/characters/), with only their colour
# textures, shrunk to 512 px, so a TV can load half a dozen runners. (Uses macOS's `sips` to resize.)
#
#   python3 web/games/city-runners/source/make-bodies.py
import json, os, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '../../football/source/characters')
OUT = os.path.join(HERE, '../models/people')
BODIES = os.path.join(SRC, 'Base Characters/Godot - UE')
HAIR = os.path.join(SRC, 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)')
TEX = os.path.join(SRC, 'Base Characters/Textures')

MESHES = [(BODIES, 'Superhero_Male_FullBody'), (BODIES, 'Superhero_Female_FullBody')] + [
    (HAIR, n) for n in ['Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Buns', 'Hair_Long', 'Hair_SimpleParted', 'Hair_Beard', 'Eyebrows_Regular', 'Eyebrows_Female']]
# the skin tones (the body files point at the dark ones; the game swaps in the light ones)
EXTRA = ['T_Superhero_Male_Ligh.png', 'T_Superhero_Female_Light_BaseColor.png']

os.makedirs(OUT, exist_ok=True)
images = set(EXTRA)
for folder, name in MESHES:
    g = json.load(open(os.path.join(folder, name + '.gltf')))
    # colour only: drop the normal and roughness maps (and the images only they used)
    for m in g.get('materials', []):
        m.pop('normalTexture', None)
        m.get('pbrMetallicRoughness', {}).pop('metallicRoughnessTexture', None)
    used = {m['pbrMetallicRoughness']['baseColorTexture']['index'] for m in g.get('materials', []) if 'baseColorTexture' in m.get('pbrMetallicRoughness', {})}
    keep = sorted(used)
    remap = {old: new for new, old in enumerate(keep)}
    for m in g.get('materials', []):
        t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if t: t['index'] = remap[t['index']]
    g['textures'] = [g['textures'][i] for i in keep]
    srcs = sorted({t['source'] for t in g['textures']})
    imap = {old: new for new, old in enumerate(srcs)}
    for t in g['textures']: t['source'] = imap[t['source']]
    g['images'] = [g['images'][i] for i in srcs]
    images |= {im['uri'] for im in g['images']}
    json.dump(g, open(os.path.join(OUT, name + '.gltf'), 'w'), separators=(',', ':'))
    shutil.copy(os.path.join(folder, name + '.bin'), OUT)

for uri in sorted(images):
    src = next(p for p in [os.path.join(BODIES, uri), os.path.join(TEX, uri), os.path.join(HAIR, uri)] if os.path.exists(p))
    dst = os.path.join(OUT, uri)
    shutil.copy(src, dst)
    subprocess.run(['sips', '-Z', '512', dst], check=True, capture_output=True)
    print(uri, os.path.getsize(dst) // 1024, 'KB')
