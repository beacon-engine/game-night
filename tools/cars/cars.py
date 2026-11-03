# Make the game's cars from the downloads (tools/cars/fetch.py): each one set the right way round and
# to its real size, its wheels found, its body cut into the panels a real car is made of (bonnet, wings,
# doors, rear quarters, bumpers, boot, roof, glass), slimmed to a budget, and saved as
# web/cars/models/<id>.glb, with what the games need to know about it in web/cars/cars.json.
# Run with Blender:
#
#   blender -b -P tools/cars/cars.py                     # all of them
#   blender -b -P tools/cars/cars.py -- goblin abyss     # just these
#   blender -b -P tools/cars/cars.py -- --preview goblin # a picture of each (web/cars/source/previews/), no export
#
# The car faces -Y in Blender with Z up (the glTF file then faces +Z with Y up, as the games expect), its
# left side at +X. Lengths in metres.
import bpy
import bmesh
import json
import math
import os
import re
import sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'cars'))
SOURCE = os.path.join(ROOT, 'source', 'sketchfab')

# What we know about each car that the file doesn't say: its real length; which way it faces, if the
# names don't give it away ('+x', '-x', '+y', '-y' in the file's own axes) or 'flip' when they get it wrong;
# a turn to stand it up; which meshes to keep when a file has more than one car (a box in the file's units:
# x0, x1, y0, y1); its paint, when the material names don't say (the games repaint it); and 'drop': a regex of
# material names to leave out (real sponsors' decals)
CARS = {
    'goblin': {'name': 'Goblin', 'length': 4.6, 'flip': True},
    'cheetah': {'name': 'Cheetah', 'length': 4.4, 'flip': True},
    'abyss': {'name': 'Abyss', 'length': 4.8, 'turn': Matrix.Rotation(math.pi / 2, 4, 'X')},
    'sport-lp': {'name': 'Stinger', 'length': 4.5, 'keep': (-2.6, 2.4, -1.2, 1.2), 'flip': True, 'paint': ['Material.217']},
    'gt-coupe': {'name': 'Sovereign', 'length': 4.7},
    'azura': {'name': 'Azura', 'length': 4.4},
    'nfr': {'name': 'Nomad', 'length': 4.4},
    'kiri': {'name': 'Kiri', 'length': 4.4},
    'vanguard': {'name': 'Vanguard', 'length': 4.8, 'paint': ['material', 'CarBackface'], 'tyre': ['Palubovka']},
    'thunderbolt': {'name': 'Thunderbolt', 'length': 4.4},
    'sedan': {'name': 'Meridian', 'length': 4.9},
    'shc': {'name': 'Halcyon', 'length': 4.8},
    'suv': {'name': 'Summit', 'length': 4.8},
    'wyvern': {'name': 'Wyvern', 'length': 4.9, 'paint': ['material']},
    'lightbody': {'name': 'Ridgeback', 'length': 5.2},
    'open-wheeler': {'name': 'Single-seater', 'length': 5.4, 'paint': ['body'], 'flip': True, 'drop': r'hexis|siemens'},
}

FRONT = re.compile(r'head|windshield|windscreen|hood|bonnet|grill|front', re.I)
REAR = re.compile(r'tail|brake.?light|trunk|rear|reverse|exhaust|plate', re.I)
SHADOW = re.compile(r'shadow|icosphere|clearcoat', re.I)  # (shadow planes under the car, the studio's sky ball, and clear-coat shells: the game paints its own)
PAINT = re.compile(r'paint|body', re.I)
ACCENT = re.compile(r'secondary', re.I)
GLASS = re.compile(r'glass|window|windshield|windscreen', re.I)
INTERIOR = re.compile(r'interior|interier|seat|dashboard|steering|carpet|fabric|media|palubovka|wood', re.I)
UNDER = re.compile(r'bottom|chassis|suspension|engine|mechanic|exhaust|floor|radiator|spring|damper|filter', re.I)
TYRE = re.compile(r'tire|tyre|rubber', re.I)
BUDGET = 40000  # triangles a car may have, all told (the robot's frame is drawn by the game)


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = '--preview' in a
    ids = [x for x in a if not x.startswith('--')] or list(CARS)
    return ids, preview


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def bounds(objs):
    lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def names(o):
    return o.name + ' ' + ' '.join(s.material.name for s in o.material_slots if s.material)


def load(id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCE, id, 'model.glb'))
    cfg = CARS[id]
    # bake every transform into the meshes, and throw away what isn't the car
    world = {o.name: o.matrix_world.copy() for o in meshes()}  # (all first: moving a parent moves its children)
    for o in meshes():
        o.parent = None
        o.data = o.data.copy()  # (instanced meshes: each its own, so baking one doesn't move the others)
        o.data.transform(world[o.name])
        o.matrix_world = Matrix()
    for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    for o in meshes():
        if SHADOW.search(names(o)) or len(o.data.vertices) == 0 or ('drop' in cfg and re.search(cfg['drop'], names(o), re.I)):
            bpy.data.objects.remove(o)
    if 'keep' in cfg:
        x0, x1, y0, y1 = cfg['keep']
        for o in meshes():
            c = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
            if not (x0 <= c.x <= x1 and y0 <= c.y <= y1):
                bpy.data.objects.remove(o)
    objs = meshes()
    if 'turn' in cfg:  # (a file that has it lying down)
        for o in objs: o.data.transform(cfg['turn'])
    lo, hi = bounds(objs)
    size = hi - lo
    # along Y, nose to -Y
    if size.x > size.y:
        for o in objs: o.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
    lo, hi = bounds(objs)
    centre = (lo + hi) / 2
    front = cfg.get('front')
    if front is None:
        score = 0.0
        for o in objs:
            n = names(o)
            c = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
            if FRONT.search(n): score += (c.y - centre.y)
            if REAR.search(n): score -= (c.y - centre.y)
        front = '+y' if score > 0 else '-y'
    if (front in ('+y', '+x')) != bool(cfg.get('flip')):
        for o in objs: o.data.transform(Matrix.Rotation(math.pi, 4, 'Z'))
    # to size, on the ground, in the middle
    lo, hi = bounds(objs)
    k = cfg['length'] / (hi.y - lo.y)
    for o in objs: o.data.transform(Matrix.Scale(k, 4))
    lo, hi = bounds(objs)
    shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for o in objs: o.data.transform(Matrix.Translation(shift))
    return objs


def preview(id):
    objs = load(id)
    lo, hi = bounds(objs)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.render.resolution_x, scene.render.resolution_y = 640, 400
    world = bpy.data.worlds.new('w'); scene.world = world
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    # three quarters from the front left (the front is -Y, the left +X)
    cam.location = (6.5, -7.5, 3.2)
    d = Vector((0, 0, 0.6)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    out = os.path.join(ROOT, 'source', 'previews', f'{id}.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print(f'{id}: {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} m -> {out}')


# --- cutting it up ------------------------------------------------------------------------------------
def join(objs):
    """Everything in one mesh (materials and all), so it can be cut as one"""
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    return objs[0]


def islands(bm):
    """The separate pieces of the mesh, as lists of faces"""
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, piece = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            piece.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index); stack.append(h)
        out.append(piece)
    return out


def box(faces):
    vs = [v.co for f in faces for v in f.verts]
    return Vector(map(min, *vs)) if len(vs) > 1 else vs[0].copy(), Vector(map(max, *vs)) if len(vs) > 1 else vs[0].copy()


def find_wheels(pieces, mats, tyre):
    """The four wheels: round pieces about wheel-sized, standing on the ground at the corners (or, when a tyre
    is made of several pieces, the faces of tyre rubber at each corner); and everything inside each (rim,
    brake disc, caliper, hub). Returns {wheel name: centre, radius} and {piece: wheel name}."""
    tyres = []
    for i, faces in enumerate(pieces):
        lo, hi = box(faces)
        d = hi - lo
        c = (lo + hi) / 2
        if 0.4 < d.z < 1.3 and abs(d.y - d.z) < 0.18 * d.z and 0.1 < d.x < 0.75 * d.z and abs(c.z - d.z / 2) < 0.15 and abs(c.x) > 0.3:
            tyres.append((i, c, d.z / 2))
    wheels = {}
    for front in (True, False):
        for left in (True, False):
            mine = [t for t in tyres if (t[1].y < 0) == front and (t[1].x > 0) == left]
            if mine:
                i, c, r = max(mine, key=lambda t: t[2])
                wheels[f"wheel.{'front' if front else 'rear'}.{'L' if left else 'R'}"] = (c, r)
    if len(wheels) < 4:
        rubber = [f for faces in pieces for f in faces if tyre(mats[f.material_index]) and f.calc_center_median().z < 1.2]
        for front in (True, False):
            for left in (True, False):
                mine = [f for f in rubber if (f.calc_center_median().y < 0) == front and (f.calc_center_median().x > 0) == left]
                if mine:
                    lo, hi = box(mine)
                    wheels[f"wheel.{'front' if front else 'rear'}.{'L' if left else 'R'}"] = ((lo + hi) / 2, (hi - lo).z / 2)
    owner = {}
    for i, faces in enumerate(pieces):
        lo, hi = box(faces)
        c = (lo + hi) / 2
        for name, (wc, r) in wheels.items():
            # inside the wheel's drum: within its radius round the axle, and not far in from the tyre
            if (Vector((0, c.y - wc.y, c.z - wc.z)).length < r * 0.95 and (hi - lo).z < r * 2.15 and (hi - lo).y < r * 2.15
                    and abs(c.x - wc.x) < 0.32 and abs(c.x) > 0.25):
                owner[i] = name
    return wheels, owner


def region(c, n, mat, dims):
    """Which panel a piece of the body belongs to, from where it is (c), which way it faces (n) and what
    it's mostly made of"""
    L, W, belt, cuts = dims['L'], dims['W'], dims['belt'], dims['cuts']
    t = (L / 2 - c.y) / L  # 0 at the tail .. 1 at the nose
    side = 'L' if c.x >= 0 else 'R'
    if INTERIOR.search(mat):
        return 'cockpit'
    if UNDER.search(mat) or c.z < 0.12:
        return 'chassis'
    if c.z > belt:  # the glasshouse
        if GLASS.search(mat) and not re.search(r'light|lens', mat, re.I):
            if abs(n.x) > 0.55: return f'window.{side}'
            return 'glass.front' if t > dims['mid'] else 'glass.rear'
        if abs(n.x) > 0.6 and n.z < 0.5: return f'window.{side}'  # (the pillars and mirrors, with the door)
        if t > cuts['doorF'] + 0.04 and n.z < 0.8: return 'bonnet' if t < cuts['nose'] else f'nose.{side}'
        if t < cuts['doorR'] - 0.04 and n.z < 0.8: return 'deck' if t > cuts['tail'] else f'tail.{side}'
        return 'roof'
    if t >= cuts['nose']: return f'nose.{side}'
    if t <= cuts['tail']: return f'tail.{side}'
    top = n.z > 0.55 and abs(c.x) < 0.78 * W
    if t >= cuts['doorF']: return 'bonnet' if top else f'fender.{side}'
    if t <= cuts['doorR']: return 'deck' if top else f'quarter.{side}'
    return f'door.{side}'


def cut(id):
    cfg = CARS[id]
    objs = load(id)
    lo, hi = bounds(objs)
    L, W, H = hi.y - lo.y, (hi.x - lo.x) / 2, hi.z - lo.z
    # the games repaint the car: its paint is called 'paint' (and a second colour 'accent')
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or m.name in ('paint', 'accent'): continue
            if m.name in cfg.get('paint', []) or ('paint' not in cfg and PAINT.search(m.name) and not INTERIOR.search(m.name)):
                m.name = 'accent' if ACCENT.search(m.name) else 'paint'
    body = join(objs)
    body.name = id
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    pieces = islands(bm)
    mats = [s.material.name if s.material else '' for s in body.material_slots]
    wheels, owner = find_wheels(pieces, mats, lambda m: m in cfg.get('tyre', []) or bool(TYRE.search(m)))
    if len(wheels) < 4:
        print(f'{id}: found {len(wheels)} wheels: {sorted(wheels)}')
    wheel_of = {}
    for i, name in owner.items():
        for f in pieces[i]: wheel_of[f.index] = name
    # where the cuts go: the bumpers just past the wheels, the doors between them, the beltline under the glass
    tf = (L / 2 - wheels.get('wheel.front.L', (Vector((0, -L * 0.3, 0)), 0.35))[0].y) / L
    tr = (L / 2 - wheels.get('wheel.rear.L', (Vector((0, L * 0.3, 0)), 0.35))[0].y) / L
    r = max((w[1] for w in wheels.values()), default=0.35)
    side_glass = sorted(f.calc_center_median().z for f in bm.faces if f.index not in wheel_of and GLASS.search(mats[f.material_index])
                        and not re.search(r'light|lens', mats[f.material_index], re.I) and abs(f.normal.x) > 0.6 and f.calc_center_median().z > 0.45 * H)
    belt = side_glass[len(side_glass) // 12] - 0.02 if side_glass else 0.62 * H
    cuts = {'nose': tf + (r * 0.95) / L, 'doorF': tf - (r + 0.12) / L, 'doorR': tr + (r + 0.12) / L, 'tail': tr - (r * 0.95) / L}
    dims = {'L': L, 'W': W, 'belt': belt, 'cuts': cuts, 'mid': (tf + tr) / 2 + 0.06}
    # cut straight across the body along those lines (not through the wheels), so the panels part cleanly
    tag = bm.faces.layers.int.new('wheel')
    for f in bm.faces: f[tag] = 1 if f.index in wheel_of else 0
    # (the shut lines: across the car at the bumpers and doors, down the middle, along the edges of the
    # bonnet and boot lid, and the beltline; each cut is split open so the pieces come apart)
    planes = [((0, 0, 0), (1, 0, 0)), ((0.78 * W, 0, 0), (1, 0, 0)), ((-0.78 * W, 0, 0), (1, 0, 0)), ((0, 0, belt), (0, 0, 1))]
    planes += [((0, L / 2 - L * t, 0), (0, 1, 0)) for t in cuts.values()]
    for co, no in planes:
        geom = [f for f in bm.faces if not f[tag]]
        geom = list({e for f in geom for e in f.edges}) + list({v for f in geom for v in f.verts}) + geom
        done = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
        bmesh.ops.split_edges(bm, edges=[e for e in done['geom_cut'] if isinstance(e, bmesh.types.BMEdge)])
    bm.faces.ensure_lookup_table()
    # each piece between the cuts goes whole to one panel, by where its middle is and which way it faces
    # (so no panel is left with slivers of another); the wheels are found again by their tag
    # Small bits (a mirror, a badge, a sliver left by a cut) don't get a panel of their own: they go with
    # the big piece nearest them, so nothing is left floating loose on the robot.
    groups, small, big = {}, [], []
    for piece in islands(bm):
        if piece[0][tag]:
            for f in piece:
                c = f.calc_center_median()
                groups.setdefault(min(wheels, key=lambda w: (wheels[w][0] - c).length), []).append(f.index)
            continue
        area = sum(f.calc_area() for f in piece) or 1e-9
        c = sum((f.calc_center_median() * f.calc_area() for f in piece), Vector()) / area
        n = sum((f.normal * f.calc_area() for f in piece), Vector())
        n = n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))
        by = {}
        for f in piece: by[f.material_index] = by.get(f.material_index, 0) + f.calc_area()
        mat = mats[max(by, key=by.get)]
        lo, hi = box(piece)
        name = region(c, n, mat, dims)
        if name in ('cockpit', 'chassis') or (hi - lo).length > 0.45 or area > 0.05:
            groups.setdefault(name, []).extend(f.index for f in piece)
            if name not in ('cockpit', 'chassis'): big.append((lo, hi, name))
        else:
            small.append((c, piece))
    for c, piece in small:
        gap = lambda b: (Vector(map(max, b[0], Vector(map(min, c, b[1])))) - c).length  # (from c to the box)
        name = min(big, key=gap)[2] if big else 'chassis'
        groups.setdefault(name, []).extend(f.index for f in piece)
    # the side windows and pillars go with the doors
    for side in 'LR':
        if f'window.{side}' in groups:
            groups.setdefault(f'door.{side}', []).extend(groups.pop(f'window.{side}'))
    panels = []
    for name, faces in groups.items():
        keep = set(faces)
        b2 = bm.copy()
        b2.faces.ensure_lookup_table()
        bmesh.ops.delete(b2, geom=[f for f in b2.faces if f.index not in keep], context='FACES')
        me = bpy.data.meshes.new(name)
        b2.to_mesh(me)
        b2.free()
        for m in body.data.materials: me.materials.append(m)
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        lo2, hi2 = bounds([o])
        c = (lo2 + hi2) / 2
        me.transform(Matrix.Translation(-c))
        o.location = c
        panels.append(o)
    bm.free()
    bpy.data.objects.remove(body)
    # slim it to the budget (the cockpit, seen only through glass, slimmer still)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in panels)
    if tris > BUDGET:
        k = BUDGET / tris
        for o in panels:
            n = sum(len(p.vertices) - 2 for p in o.data.polygons)
            if n < 150: continue
            mod = o.modifiers.new('slim', 'DECIMATE')
            mod.ratio = k * (0.4 if o.name in ('cockpit', 'chassis') else 1)
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_apply(modifier='slim')
    for o in panels:  # (drop materials a panel doesn't use)
        used = {p.material_index for p in o.data.polygons}
        for i in reversed(range(len(o.data.materials))):
            if i not in used: o.data.materials.pop(index=i)
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            k = 1024 / max(img.size)
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
            img.pack()  # (a resized image only lives in memory: packed, the exporter can write it)
    # textures with nothing see-through in them go as JPEG (a fraction of the size); the rest stay PNG
    tmp = os.path.join(bpy.app.tempdir, 'cars')
    os.makedirs(tmp, exist_ok=True)
    bpy.context.scene.render.image_settings.quality = 85
    for img in list(bpy.data.images):
        if not img.has_data or img.file_format == 'JPEG' or img.size[0] * img.size[1] < 4096:
            continue
        if min(img.pixels[3::4]) < 0.99:
            if max(img.size) > 512:  # (see-through ones stay PNG, at half size)
                k = 512 / max(img.size)
                img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
                img.pack()
            continue
        path = os.path.join(tmp, re.sub(r'[^\w.-]', '_', img.name) + '.jpg')
        img.filepath_raw = path
        img.file_format = 'JPEG'
        img.save()
        if img.packed_file: img.unpack(method='REMOVE')
        img.filepath = path
        img.reload()
        img.pack()
    after = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in panels)
    info = {
        'id': id, 'name': cfg['name'], 'length': round(L, 3), 'width': round(W * 2, 3), 'height': round(H, 3), 'belt': round(belt, 3),
        'wheels': {n: {'x': round(c.x, 3), 'y': round(c.z, 3), 'z': round(-c.y, 3), 'r': round(rr, 3)} for n, (c, rr) in wheels.items()},
        'panels': sorted(o.name for o in panels), 'triangles': after,
    }
    return panels, info


def export(id, panels):
    # nothing but the glass is a perfect mirror (some files leave roughness at 0: the car then shows the sky in its tyres)
    for m in bpy.data.materials:
        bsdf = m.node_tree.nodes.get('Principled BSDF') if m.use_nodes and m.node_tree else None
        if bsdf and not GLASS.search(m.name) and not bsdf.inputs['Roughness'].links and bsdf.inputs['Roughness'].default_value < 0.05:
            bsdf.inputs['Roughness'].default_value = 0.4
    out = os.path.join(ROOT, 'models', f'{id}.glb')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    for o in bpy.context.scene.objects: o.select_set(o in panels)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_image_format='AUTO', export_materials='EXPORT', export_extras=False,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    return out


def credit(id):
    text = open(os.path.join(SOURCE, id, 'README.md')).read()
    get = lambda key: (re.search(rf'- {key}: (.*)', text) or [None, ''])[1].strip()
    return {'title': text.splitlines()[0].lstrip('# ').strip(), 'by': get('By'), 'from': get('From'), 'licence': get('Licence')}


def main():
    ids, only_preview = args()
    catalogue_path = os.path.join(ROOT, 'cars.json')
    catalogue = json.load(open(catalogue_path)) if os.path.exists(catalogue_path) else {'cars': []}
    for id in ids:
        if only_preview:
            preview(id)
            continue
        panels, info = cut(id)
        out = export(id, panels)
        info['credit'] = credit(id)
        info['bytes'] = os.path.getsize(out)
        catalogue['cars'] = [c for c in catalogue['cars'] if c['id'] != id] + [info]
        print(f"{id}: {len(info['wheels'])} wheels, {len(info['panels'])} panels, {info['triangles']} triangles, {info['bytes'] / 1e6:.1f} MB")
    catalogue['cars'].sort(key=lambda c: list(CARS).index(c['id']))
    with open(catalogue_path, 'w') as f:
        json.dump(catalogue, f, indent=1)


if __name__ == '__main__':
    main()
