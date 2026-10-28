# Helmets made to measure: a steel dome with a brim (M1-style) or with a flared skirt that comes down
# lower at the back and sides (the German style), sized and placed from the man's own head, and bound
# to his head bone so it moves with him. (MakeHuman's helmet asset is netting over a cap: no good.)
import math

import bmesh
import bpy
from mathutils import Vector

SHAPES = {
    # dome: half-widths as fractions of the head's (x across, y front-to-back); drop: where the rim
    # sits, as a fraction of the head's height down from its top (about the brow); rim: how far it
    # flares out and down; back: how much lower the rim is at the back and sides
    'm1': {'dome': (1.1, 1.06), 'rim': (0.14, 0.02), 'back': 0.0, 'drop': 0.4},
    'stahl': {'dome': (1.06, 1.04), 'rim': (0.16, 0.0), 'back': 0.55, 'drop': 0.36},
    # a modern combat helmet: close to the head, no brim, cut lower at the back and the sides
    'ach': {'dome': (1.16, 1.1), 'rim': (0.0, 0.0), 'back': 0.5, 'drop': 0.42},
}


CLEAR = 0.03  # m between the top of the skull and the inside of the crown


def head_box(body):
    # the head's size and where it is: from the vertices the head bone moves most, as the body is shaped
    # (its build is shape keys: the mesh's own vertices are the unshaped body), helpers left out
    g = body.vertex_groups.get('head')
    if g is None:
        raise RuntimeError('no head vertex group on the body')
    skip = {body.vertex_groups[n].index for n in ('HelperGeometry', 'JointCubes') if n in body.vertex_groups}
    was = [(m, m.show_viewport) for m in body.modifiers]
    for m, _ in was:
        m.show_viewport = False
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    shaped = body.evaluated_get(deps).to_mesh()
    w = body.matrix_world
    pts = [w @ shaped.vertices[v.index].co for v in body.data.vertices
           if any(e.group == g.index and e.weight > 0.6 for e in v.groups) and not any(e.group in skip and e.weight > 0 for e in v.groups)]
    body.evaluated_get(deps).to_mesh_clear()
    for m, on in was:
        m.show_viewport = on
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def add(rig, body, kind, material):
    s = SHAPES[kind]
    lo, hi = head_box(body)
    size = (hi - lo) / 2
    top, height = hi.z, hi.z - lo.z
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2 + size.y * 0.05, top - height * s['drop']))
    rx, ry, rz = size.x * s['dome'][0], size.y * s['dome'][1], height * s['drop'] + CLEAR
    bm = bmesh.new()
    rings, segs = 10, 28
    rows = []
    for i in range(rings + 1):
        a = (i / rings) * (math.pi / 2)  # from the crown down to the rim
        row = []
        for j in range(segs):
            t = (j / segs) * math.pi * 2
            x, y = math.sin(t), math.cos(t)  # (y: front, -y: back; the face is -y in Blender)
            drop = s['back'] * (0.75 * max(0.0, y) + 0.5 * abs(x)) * (i / rings) ** 4  # (lower at the back and sides)
            row.append(bm.verts.new(centre + Vector((rx * math.sin(a) * x, ry * math.sin(a) * y, rz * (math.cos(a) - drop)))))
        rows.append(row)
    # the rim: flared out (and down) from the dome's edge
    edge = rows[-1]
    rim = []
    for j, v in enumerate(edge):
        out = (v.co - Vector((centre.x, centre.y, v.co.z))).normalized()
        rim.append(bm.verts.new(v.co + out * (size.x * s['rim'][0]) - Vector((0, 0, size.z * s['rim'][1]))))
    rows.append(rim)
    crown = bm.verts.new(centre + Vector((0, 0, rz)))
    for j in range(segs):
        bm.faces.new((crown, rows[1][j], rows[1][(j + 1) % segs]))
    for i in range(1, len(rows) - 1):
        for j in range(segs):
            a, b = rows[i][j], rows[i][(j + 1) % segs]
            c, d = rows[i + 1][(j + 1) % segs], rows[i + 1][j]
            bm.faces.new((a, b, c, d))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new('helmet')
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(f'{rig.name}.helmet', mesh)
    bpy.context.scene.collection.objects.link(o)
    # thick enough to see from inside the brim, then bound to the head bone
    sol = o.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = size.x * 0.06
    o.data.materials.append(material)
    o.parent = rig
    o.matrix_parent_inverse = rig.matrix_world.inverted()
    g = o.vertex_groups.new(name='head')
    g.add(list(range(len(mesh.vertices))), 1.0, 'REPLACE')
    arm = o.modifiers.new('rig', 'ARMATURE')
    arm.object = rig
    return o
