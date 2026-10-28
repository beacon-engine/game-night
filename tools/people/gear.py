# A modern infantryman's kit, made to measure and bound to his bones: a high-cut combat helmet with
# its night-vision mount and rails, the goggles themselves (twice: flipped up on the helmet and down
# over the eyes, so a game shows one or the other), a plate carrier (front and back plates, cummerbund,
# shoulder straps) with magazine, radio and grenade pouches and a knife, an assault pack, knee pads and
# a pistol holster on the right thigh. Sized from the man (his chest from his shirt, his head from his
# shaped body), so it fits every build. Blender: x is the man's left, -y is the way he faces, z up.
#
# Each part gets its own material role, so the game can colour (and camouflage) it: "helmet", "vest",
# "pack", "pads", "gear" (the hard black kit: the mount, the goggles, the holster, the radio), and the
# goggles' two positions are separate objects, "nvg_up" and "nvg_down".
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import helmets

CLEAR = 0.004  # m between the shirt and the inside of the carrier


def bone(rig, name, tail=False):
    b = rig.data.bones[name]
    return rig.matrix_world @ (b.tail_local if tail else b.head_local)


def box_of(obj, groups, weight=0.45):
    # the space taken by the vertices those bones move most (an evaluated mesh: as fitted and shaped)
    idx = {obj.vertex_groups[g].index for g in groups if g in obj.vertex_groups}
    skip = {obj.vertex_groups[n].index for n in ('HelperGeometry', 'JointCubes') if n in obj.vertex_groups}
    was = [(m, m.show_viewport) for m in obj.modifiers]
    for m, _ in was:
        m.show_viewport = False
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    ev = obj.evaluated_get(deps)
    shaped = ev.to_mesh()
    w = obj.matrix_world
    pts = [w @ shaped.vertices[v.index].co for v in obj.data.vertices
           if any(e.group in idx and e.weight > weight for e in v.groups) and not any(e.group in skip and e.weight > 0 for e in v.groups)]
    ev.to_mesh_clear()
    for m, on in was:
        m.show_viewport = on
    if not pts:
        raise RuntimeError(f'nothing of {groups} on {obj.name}')
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi, pts


class Piece:
    """One part being built: boxes and cylinders added to a bmesh, then made into an object bound to bones."""

    def __init__(self):
        self.bm = bmesh.new()

    def box(self, centre, size, rot=(0, 0, 0), bend=0.0):
        # (bend: its sides pulled back, like a plate shaped to a chest: toward +y by `bend` at the edges;
        # made of five slices, each turned to follow the curve)
        R = Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
        if bend:
            n = 5
            for i in range(n):
                u = (i + 0.5) / n - 0.5
                off = R @ Vector((u * size[0], bend * (2 * u) ** 2, 0))
                turn = math.atan(8 * bend * u / size[0])
                self._block(centre + off, (size[0] / n * 1.04, size[1], size[2]), R @ Matrix.Rotation(turn, 4, 'Z'))
        else:
            self._block(centre, size, R)

    def _block(self, centre, size, R):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        m = Matrix.Translation(centre) @ R @ Matrix.Diagonal((*size, 1))
        for v in r['verts']:
            v.co = m @ v.co

    def bar(self, a, b, width, thick):
        # a flat strap from a to b, its width across x
        d = b - a
        length = d.length
        pitch = math.atan2(d.z, -d.y)  # (turned about x so its length lies from a to b)
        self._block((a + b) / 2, (width, length, thick), Matrix.Rotation(pitch - math.pi / 2, 4, 'X'))

    def cylinder(self, centre, radius, depth, rot=(0, 0, 0), segs=10):
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segs, radius1=radius, radius2=radius, depth=depth)
        m = Matrix.Translation(centre) @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
        for v in r['verts']:
            v.co = m @ v.co

    def sphere(self, centre, radius):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=10, v_segments=7, radius=radius)
        for v in r['verts']:
            v.co = v.co + centre

    def make(self, rig, name, material, weights, bevel=0.006):
        """weights(co) -> {bone: weight}: how each vertex follows the skeleton"""
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        o = bpy.data.objects.new(f'{rig.name}.{name}', mesh)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(material)
        if bevel:
            b = o.modifiers.new('soft', 'BEVEL')
            b.width = bevel
            b.segments = 2
            b.limit_method = 'ANGLE'
        for p in mesh.polygons:
            p.use_smooth = False
        o.parent = rig
        o.matrix_parent_inverse = rig.matrix_world.inverted()
        groups = {}
        for v in mesh.vertices:
            for b, w in weights(v.co).items():
                if b not in groups:
                    groups[b] = o.vertex_groups.new(name=b)
                groups[b].add([v.index], w, 'REPLACE')
        arm = o.modifiers.new('rig', 'ARMATURE')
        arm.object = rig
        return o


def torso_weights(rig):
    # the chest follows spine_03, the belly spine_02, blended between
    z3, z2 = bone(rig, 'spine_03').z, bone(rig, 'spine_02').z

    def w(co):
        t = max(0.0, min(1.0, (co.z - z2) / max(0.01, z3 - z2)))
        return {'spine_03': t, 'spine_02': 1 - t}
    return w


def add(rig, body, top, mats):
    """mats: {role: material}"""
    # --- the head: helmet, mount, rails, the goggles
    helmets.add(rig, body, 'ach', mats['helmet'])
    hlo, hhi = helmets.head_box(body)
    hs = (hhi - hlo) / 2
    hc = (hlo + hhi) / 2
    top_z, h_h = hhi.z, hhi.z - hlo.z
    on_head = lambda co: {'head': 1.0}  # noqa: E731
    front = hlo.y - hs.y * 0.08  # (the helmet's front surface, about)
    mount = Piece()
    mount.box(Vector((hc.x, front - 0.012, top_z - h_h * 0.3)), (0.06, 0.02, 0.045))  # the shroud
    for s in (-1, 1):  # rails along the sides
        mount.box(Vector((hc.x + s * (hs.x * 1.08 + 0.012), hc.y, top_z - h_h * 0.34)), (0.012, hs.y * 1.3, 0.022))
    mount.box(Vector((hc.x, hhi.y + 0.01, top_z - h_h * 0.32)), (0.05, 0.02, 0.03))  # (the counterweight at the back)
    mount.make(rig, 'mount', mats['gear'], on_head, bevel=0.003)
    eye_z = top_z - h_h * 0.46
    for name, down in (('nvg_down', True), ('nvg_up', False)):
        g = Piece()
        if down:  # two tubes in front of the eyes, the arm up to the shroud
            for s in (-1, 1):
                g.cylinder(Vector((hc.x + s * 0.032, hlo.y - 0.06, eye_z)), 0.019, 0.085, rot=(math.pi / 2, 0, 0))
            g.box(Vector((hc.x, hlo.y - 0.035, eye_z + 0.03)), (0.05, 0.035, 0.035))
            g.box(Vector((hc.x, front - 0.02, (eye_z + top_z - h_h * 0.3) / 2 + 0.01)), (0.02, 0.015, 0.06))
        else:  # flipped up against the front of the helmet
            for s in (-1, 1):
                g.cylinder(Vector((hc.x + s * 0.032, front - 0.04, top_z - h_h * 0.12)), 0.019, 0.085, rot=(0.25, 0, 0))
            g.box(Vector((hc.x, front - 0.03, top_z - h_h * 0.24)), (0.05, 0.035, 0.035))
        g.make(rig, name, mats['gear'], on_head, bevel=0.002)

    # --- the plate carrier, measured on the shirt
    _, _, pts = box_of(top, ['spine_03', 'spine_02'])
    arm = bone(rig, 'upperarm_l').x * 0.85  # (the sleeves round the armpits are no part of the chest)
    pts = [p for p in pts if abs(p.x) < arm]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    neck = bone(rig, 'neck_01')
    belly = bone(rig, 'spine_01')
    cx = (lo.x + hi.x) / 2
    W = hi.x - lo.x
    z_top, z_bot = neck.z - 0.08, belly.z + 0.02
    H = z_top - z_bot
    zc = (z_top + z_bot) / 2
    tw = torso_weights(rig)

    def side(z, sign):  # (how far the shirt goes out to that side at that height)
        near = [p.x for p in pts if abs(p.z - z) < 0.04]
        return (max(near) if sign > 0 else min(near)) if near else cx + sign * W / 2
    vest = Piece()
    fy, by = lo.y - CLEAR - 0.017, hi.y + CLEAR + 0.017
    vest.box(Vector((cx, fy, zc)), (W * 0.72, 0.034, H), bend=0.04)  # front plate
    vest.box(Vector((cx, by, zc + 0.01)), (W * 0.72, 0.034, H), bend=-0.04)  # back plate
    for s in (-1, 1):
        # the cummerbund round each side, low
        zc_ = z_bot + H * 0.28
        vest.box(Vector((side(zc_, s) + s * (CLEAR + 0.012), (fy + by) / 2, zc_)), (0.025, (by - fy) * 0.92, H * 0.52))
        # shoulder straps: from the top of the front plate up over the shoulder and down to the back plate
        x = cx + s * W * 0.22
        sh = max(p.z for p in pts if abs(p.x - x) < 0.03) + 0.012 if any(abs(p.x - x) < 0.03 for p in pts) else z_top + 0.1
        mid = (lo.y + hi.y) / 2
        top = Vector((x, mid, sh))
        vest.bar(Vector((x, fy + 0.012, z_top)), top + Vector((0, -0.04, -0.005)), 0.06, 0.018)
        vest.bar(top + Vector((0, -0.045, 0)), top + Vector((0, 0.045, 0)), 0.06, 0.018)
        vest.bar(top + Vector((0, 0.04, -0.005)), Vector((x, by - 0.012, z_top + 0.01)), 0.06, 0.018)
    # three rifle magazines across the front, an admin pouch above them
    for k in (-1, 0, 1):
        vest.box(Vector((cx + k * 0.09, fy - 0.055, z_bot + 0.085)), (0.08, 0.065, 0.15))
    vest.box(Vector((cx, fy - 0.04, z_bot + 0.215)), (0.2, 0.03, 0.09))
    vest.make(rig, 'vest', mats['vest'], tw)

    kit = Piece()
    # the radio on the left side, its aerial up behind the shoulder
    rx = side(z_bot + H * 0.3, 1) + 0.05
    kit.box(Vector((rx, (fy + by) / 2 + 0.03, z_bot + H * 0.4)), (0.05, 0.075, 0.17))
    kit.cylinder(Vector((rx, (fy + by) / 2 + 0.06, z_bot + H * 0.4 + 0.3)), 0.005, 0.45)
    # a knife upside-down on the left of the chest, its handle down
    kit.box(Vector((cx + W * 0.26, fy - 0.03, zc + H * 0.08)), (0.035, 0.018, 0.17), rot=(0, 0.2, 0))
    kit.box(Vector((cx + W * 0.27, fy - 0.035, zc - H * 0.12)), (0.03, 0.025, 0.09), rot=(0, 0.2, 0))
    kit.make(rig, 'kit', mats['gear'], tw)
    nades = Piece()
    for k in (0, 1):
        nades.sphere(Vector((side(z_bot + 0.12, -1) - 0.045, fy + 0.05 + k * 0.075, z_bot + 0.12)), 0.033)
    nades.make(rig, 'grenades', mats['pads'], tw, bevel=0)

    # --- the pack, high on the back
    pack = Piece()
    pack.box(Vector((cx, by + 0.1, zc + H * 0.12)), (W * 0.62, 0.15, H * 0.78))
    pack.box(Vector((cx, by + 0.185, zc + H * 0.02)), (W * 0.45, 0.04, H * 0.4))  # (its front pocket)
    pack.make(rig, 'pack', mats['pack'], lambda co: {'spine_03': 1.0})

    # --- knee pads, and the holster on the right thigh
    for side in ('l', 'r'):
        knee = bone(rig, f'calf_{side}')
        _, _, pts = box_of(body, [f'calf_{side}'], 0.5)
        near = [p for p in pts if abs(p.z - knee.z) < 0.06]
        fwd = min(p.y for p in near) if near else knee.y - 0.06
        pad = Piece()
        pad.box(Vector((knee.x, fwd - 0.025, knee.z - 0.03)), (0.1, 0.045, 0.13))
        pad.make(rig, f'pad_{side}', mats['pads'], lambda co, s=side: {f'calf_{s}': 1.0})
    th, kn = bone(rig, 'thigh_r'), bone(rig, 'calf_r')
    mid = th.lerp(kn, 0.4)
    hol = Piece()
    hol.box(Vector((mid.x - 0.1, mid.y + 0.005, mid.z)), (0.045, 0.085, 0.2), rot=(0, 0.08, 0))
    hol.box(Vector((mid.x - 0.1, mid.y - 0.005, mid.z + 0.13)), (0.035, 0.05, 0.07))  # (the pistol's grip, in it)
    hol.make(rig, 'holster', mats['gear'], lambda co: {'thigh_r': 1.0})
