# Fetch Fireteam's Poly Haven assets (CC0): ground, wall and roof textures, the sky, plants and props, as
# Poly Haven publishes them, into web/games/fireteam/source/polyhaven/<asset>/. Resumes: what's there is
# kept. (Only the standard library, so it runs anywhere.)
#
#   python3 tools/fireteam/polyhaven.py
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'games', 'fireteam', 'source', 'polyhaven'))

TEXTURES = [  # (asset, the maps we use) at 1k
    'leafy_grass', 'sparse_grass', 'muddy_tracks', 'dry_mud_field_001', 'brown_mud_leaves_01', 'forest_leaves_03',
    'burned_ground_01', 'rustic_stone_wall', 'plastered_stone_wall', 'clay_roof_tiles_02', 'weathered_planks',
    'bark_brown_02', 'stacked_stone_wall',
]
MAPS = ['Diffuse', 'nor_gl', 'arm']
HDRIS = ['farmland_overcast']
MODELS = ['shrub_01', 'shrub_02', 'shrub_04', 'grass_medium_01', 'nettle_plant', 'rock_moss_set_01', 'tree_stump_01',
          'dead_tree_trunk', 'wooden_crate_02', 'wooden_military_crate', 'ammo_box', 'wooden_barrels_01', 'metal_jerrycan_green']


UA = {'User-Agent': 'beacon-arcade-asset-fetch/1.0 (https://github.com/beacon-engine/game-night)'}


def open_url(url, timeout):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for attempt in range(6):
        try:
            with open_url(url, 120) as r, open(path + '.part', 'wb') as f:
                while chunk := r.read(1 << 16):
                    f.write(chunk)
            os.replace(path + '.part', path)
            print('got', os.path.relpath(path, OUT), os.path.getsize(path))
            return
        except Exception as e:  # (a slow line: try again)
            print('retry', url, e, file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f'could not get {url}')


def files(asset):
    with open_url(f'https://api.polyhaven.com/files/{asset}', 60) as r:
        return json.load(r)


def main():
    for t in TEXTURES:
        f = files(t)
        for m in MAPS:
            if m in f:
                jpg = f[m]['1k'].get('jpg') or f[m]['1k'].get('png')
                get(jpg['url'], os.path.join(OUT, t, os.path.basename(jpg['url'])))
    for h in HDRIS:
        hdr = files(h)['hdri']['1k']['hdr']
        get(hdr['url'], os.path.join(OUT, h, os.path.basename(hdr['url'])))
    for m in MODELS:
        f = files(m)
        g = f['gltf']['1k']['gltf']
        if 'Alpha' in f:  # (plants: the cut-out of their leaves and blades, for leaf cards)
            a = f['Alpha']['1k']['jpg']
            get(a['url'], os.path.join(OUT, m, 'textures', os.path.basename(a['url'])))
        get(g['url'], os.path.join(OUT, m, os.path.basename(g['url'])))
        for rel, inc in g['include'].items():
            get(inc['url'], os.path.join(OUT, m, rel))
    with open(os.path.join(OUT, 'LICENSE.txt'), 'w') as f:
        f.write('Every asset in this folder is from Poly Haven (https://polyhaven.com), CC0: public domain.\n')
    print('ALL DONE')


main()
