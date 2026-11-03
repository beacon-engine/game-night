# Fetch Shift Bots' skies and ground from Poly Haven (CC0): a photographed sky for each battleground (it
# lights the scene and shines in the paint) and photo textures for its ground and rock, at the sizes the
# game uses, into web/games/shift-bots/env/. Resumes: what's there is kept. (Only the standard library.)
#
#   python3 tools/shift-bots/polyhaven.py
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'games', 'shift-bots', 'env'))

HDRIS = ['kloofendal_48d_partly_cloudy_puresky', 'goegap', 'horn-koppe_snow', 'hansaplatz']  # quarry, desert, snow, city
TEXTURES = ['sandy_gravel_02', 'sand_01', 'snow_02', 'asphalt_02', 'rock_face_03', 'sandstone_cracks', 'gravel_concrete']
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough'}
UA = {'User-Agent': 'beacon-arcade-asset-fetch/1.0 (https://github.com/beacon-engine/game-night)'}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(path + '.part', 'wb') as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)
    os.replace(path + '.part', path)
    print(f'  {os.path.basename(path)}: {os.path.getsize(path) / 1e6:.1f} MB')


def main():
    os.makedirs(OUT, exist_ok=True)
    for h in HDRIS:
        files = get_json(f'https://api.polyhaven.com/files/{h}')
        get(files['hdri']['2k']['hdr']['url'], os.path.join(OUT, f'{h}.hdr'))
    for t in TEXTURES:
        files = get_json(f'https://api.polyhaven.com/files/{t}')
        for name, short in MAPS.items():
            if name not in files:
                print(f'{t}: no {name}', file=sys.stderr)
                continue
            get(files[name]['1k']['jpg']['url'], os.path.join(OUT, f'{t}_{short}.jpg'))


if __name__ == '__main__':
    main()
