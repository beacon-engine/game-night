# Fetch the car models the games are built from: realistic cars of made-up makes (no real brands),
# CC Attribution, from Sketchfab, as their authors published them, into web/cars/source/sketchfab/<id>/.
# Each gets a README with its author, link and licence (those are kept in git; the downloads aren't:
# run this again to get them back). Resumes: what's there is kept.
#
# Downloading from Sketchfab needs an account's API token (sketchfab.com/settings/password), in
# ~/.sketchfab_token or SKETCHFAB_TOKEN. Only the standard library, so it runs anywhere.
#
#   python3 tools/cars/fetch.py            # all of them
#   python3 tools/cars/fetch.py goblin     # just these
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'cars', 'source', 'sketchfab'))

# (our id, Sketchfab uid, what it is)
CARS = [
    ('goblin', '0a20e49ad5774d778567cb5c3f345786', 'hypercar, low wedge'),
    ('cheetah', 'f5420af7b30c4e8c874be33cc58724f2', 'supercar, 80s wedge'),
    ('abyss', 'c399568541104e0e903cf138b1e24908', 'hypercar, modern'),
    ('sport-lp', '7ad3bfb2bd7449c19698fc7d0592a601', 'supercars, a pack of three'),
    ('gt-coupe', '820a13c4831c41959ce75e6c2014e882', 'grand tourer coupé'),
    ('azura', '2e1a3699de7e4f688d328dc005ef1aac', 'sports coupé, 90s'),
    ('nfr', '776078e51fbe4ec9addbe45ba13e1aad', 'mid-engined sports car, 90s'),
    ('kiri', '64d5d6f074a84717ac6d764f35c95285', 'widebody tuner coupé'),
    ('vanguard', '194ab4697e7a46be8ffb5103f877cd59', 'muscle car'),
    ('thunderbolt', '25a4ff2002834ec1b4441c57ecd7ca9f', 'rally sedan'),
    ('sedan', '58c33766470d46e7b2aed542650494e5', 'sports sedan, modern'),
    ('shc', 'cfaabdec76a74b68a48ba5657b6d9aee', 'sportback'),
    ('suv', '5db696c6ed5d4bdc87905c1040fa072a', 'luxury SUV'),
    ('wyvern', '969f16578168435d8f12391001fbd311', 'armoured off-roader, concept'),
    ('lightbody', '67beae18c3d24be68f9c8f0ec382d8e3', 'lifted pickup'),
    ('open-wheeler', '4599e9608b6845aaafadc89f7d41fa3c', 'single-seater race car'),
]

API = 'https://api.sketchfab.com/v3/models/'


def token():
    t = os.environ.get('SKETCHFAB_TOKEN')
    if not t:
        path = os.path.expanduser('~/.sketchfab_token')
        if os.path.exists(path):
            t = open(path).read().strip()
    if not t:
        sys.exit('No Sketchfab API token: put it in ~/.sketchfab_token or SKETCHFAB_TOKEN (sketchfab.com/settings/password)')
    return t


def api(url, tok):
    req = urllib.request.Request(url, headers={'Authorization': f'Token {tok}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def get(url, path):
    with urllib.request.urlopen(url, timeout=600) as r, open(path + '.part', 'wb') as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)
    os.replace(path + '.part', path)


def main():
    tok, only = token(), set(sys.argv[1:])
    for id, uid, what in CARS:
        if only and id not in only:
            continue
        folder = os.path.join(OUT, id)
        os.makedirs(folder, exist_ok=True)
        info = api(API + uid, tok)
        licence = (info.get('license') or {}).get('label', '?')
        if licence not in ('CC Attribution', 'CC0 Public Domain'):
            print(f'{id}: skipped, licence is {licence}')
            continue
        with open(os.path.join(folder, 'README.md'), 'w') as f:
            f.write(f"# {info['name']}\n\n{what}\n\n- By: {info['user']['displayName']} ({info['user']['profileUrl']})\n"
                    f"- From: {info['viewerUrl']}\n- Licence: {licence} ({(info.get('license') or {}).get('url', '')})\n"
                    f"- Triangles: {info.get('faceCount')}\n")
        glb = os.path.join(folder, 'model.glb')
        if os.path.exists(glb) and os.path.getsize(glb) > 0:
            print(f'{id}: have it')
            continue
        links = api(API + uid + '/download', tok)
        if 'glb' not in links:
            print(f'{id}: no .glb to download ({", ".join(links)})')
            continue
        print(f"{id}: downloading {links['glb']['size'] / 1e6:.1f} MB")
        get(links['glb']['url'], glb)


if __name__ == '__main__':
    main()
