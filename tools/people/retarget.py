# Putting motion capture onto our people: a BVH take (CMU's skeleton, or any with a bone map) is
# imported, and each frame every bone of the character's rig is turned the way the same bone turned
# in the capture, measured from each skeleton's own rest pose (so a capture in a T-pose drives a rig
# in an A-pose correctly). The hips also carry the capture's travel, scaled to the character's leg
# length. The result is baked as an action on the rig, sampled at `fps`.
#
# Used by build.py; it runs inside Blender (bpy).
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

# Our people all have MakeHuman's "game_engine" rig: Unreal-style names, with fingers. Each source's
# bones, mapped onto it (source name -> rig name); bones a source doesn't have stay as they are.
CMU = {  # the CMU motion capture database (BVH)
    'Hips': 'pelvis', 'LowerBack': 'spine_01', 'Spine': 'spine_02', 'Spine1': 'spine_03', 'Neck': 'neck_01', 'Head': 'head',
    'LeftShoulder': 'clavicle_l', 'LeftArm': 'upperarm_l', 'LeftForeArm': 'lowerarm_l', 'LeftHand': 'hand_l',
    'RightShoulder': 'clavicle_r', 'RightArm': 'upperarm_r', 'RightForeArm': 'lowerarm_r', 'RightHand': 'hand_r',
    'LeftUpLeg': 'thigh_l', 'LeftLeg': 'calf_l', 'LeftFoot': 'foot_l', 'LeftToeBase': 'ball_l',
    'RightUpLeg': 'thigh_r', 'RightLeg': 'calf_r', 'RightFoot': 'foot_r', 'RightToeBase': 'ball_r',
}
_SIDES = ['l', 'r']
QUATERNIUS = {  # Quaternius' Universal Animation Library 1 and 2: the same names, but for the head
    'Head': 'head', 'head': 'head', 'pelvis': 'pelvis', 'neck_01': 'neck_01', **{f'spine_0{i}': f'spine_0{i}' for i in (1, 2, 3)},
    **{f'{b}_{s}': f'{b}_{s}' for s in _SIDES for b in ('clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball')},
    **{f'{f}_0{i}_{s}': f'{f}_0{i}_{s}' for s in _SIDES for f in ('thumb', 'index', 'middle', 'ring', 'pinky') for i in (1, 2, 3)},
}
HIPS = 'pelvis'


def import_bvh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=path, rotate_mode='QUATERNION', axis_forward='-Z', axis_up='Y',
                            update_scene_fps=False, update_scene_duration=True, global_scale=1.0)
    src = next(o for o in bpy.data.objects if o not in before)
    # (the importer keys every frame of the file, one per scene frame: its rate is the file's)
    with open(path) as f:
        rate = next(1 / float(line.split(':')[1]) for line in f if line.startswith('Frame Time'))
    src['fps'] = rate
    return src


def use(arm, action):
    # play this action on this armature (since Blender 4.4 an action plays through one of its slots)
    arm.animation_data_create()
    arm.animation_data.action = action
    if getattr(action, 'slots', None) and len(action.slots) and arm.animation_data.action_slot is None:
        arm.animation_data.action_slot = action.slots[0]


def import_glb(path):
    # an animation library as glTF: its armature, and every clip in it as an action
    before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before_o]
    arm = next(o for o in new if o.type == 'ARMATURE')
    for o in new:
        if o is not arm and o.type == 'MESH':
            bpy.data.objects.remove(o)
    arm.animation_data_create()
    arm['fps'] = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    return arm, {a.name: a for a in bpy.data.actions if a not in before_a}


def import_fbx(path):
    # the same, from FBX
    before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True, ignore_leaf_bones=True)
    new = [o for o in bpy.data.objects if o not in before_o]
    arm = next(o for o in new if o.type == 'ARMATURE')
    for o in new:
        if o is not arm and o.type != 'ARMATURE':
            bpy.data.objects.remove(o)
    arm.animation_data_create()
    arm['fps'] = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    # (FBX clip names carry the armature's: "Armature|Idle_Loop")
    return arm, {a.name.split('|')[-1]: a for a in bpy.data.actions if a not in before_a}


def fastest(src, bone, start=0, end=None):
    """When (s into the take) this bone moves fastest, and which way over the ground (a unit
    Vector): a kick's strike, and where the ball goes. The take's first moments are skipped (the
    importer's first frame can jump from the rest pose)."""
    scene = bpy.context.scene
    fps = src['fps']
    f0, f1 = src.animation_data.action.frame_range
    a = f0 + max(start, 0.15) * fps
    b = f1 if end is None else min(f1, f0 + end * fps)
    pb = src.pose.bones[bone]
    best, at, way, prev = -1, a, Vector((0, -1, 0)), None
    f = a
    while f <= b:
        scene.frame_set(int(f), subframe=f - int(f))
        p = src.matrix_world @ pb.head
        if prev is not None and (p - prev).length > best:
            best, at, way = (p - prev).length, f, (p - prev)
        prev = p.copy()
        f += 1
    way.z = 0
    return (at - f0) / fps, way.normalized()


def passing(src, foot, support, start=0, end=None):
    """When (s into the take) a kick meets the ball, and which way it sends it (a unit Vector over
    the ground): the moment the swinging foot comes past the standing one, low, on its way through
    (the ball sits beside the standing foot). The fastest moment of the swing comes earlier, while
    the foot is still coming round behind the body."""
    scene = bpy.context.scene
    fps = src['fps']
    f0, f1 = src.animation_data.action.frame_range
    a = f0 + max(start, 0.15) * fps
    b = f1 if end is None else min(f1, f0 + end * fps)
    kb, sb = src.pose.bones[foot], src.pose.bones[support]
    rows = []
    f = a
    while f <= b:
        scene.frame_set(int(f), subframe=f - int(f))
        rows.append((f, src.matrix_world @ kb.head, src.matrix_world @ sb.head))
        f += 1
    # the swing: around the fastest moment; contact is where, after it, the foot is level with the
    # standing foot along the way it's going
    speed = [(rows[i + 1][1] - rows[i][1]).length for i in range(len(rows) - 1)]
    peak = max(range(len(speed)), key=speed.__getitem__)
    best, at = None, peak
    for i in range(peak, min(len(rows) - 1, peak + int(0.25 * fps))):
        way = rows[i + 1][1] - rows[i][1]
        way.z = 0
        if way.length < 1e-6:
            continue
        ahead = (rows[i][1] - rows[i][2]).dot(way.normalized())  # foot ahead of the standing foot
        if best is None or abs(ahead) < best:
            best, at = abs(ahead), i
    way = rows[min(at + 1, len(rows) - 1)][1] - rows[at][1]
    way.z = 0
    return (rows[at][0] - f0) / fps, way.normalized()


def heading(src, bone, start=0, end=None):
    """Which way (a unit Vector over the ground) this bone travels between start and end (s into the
    take): the way a run is going."""
    scene = bpy.context.scene
    fps = src['fps']
    f0, f1 = src.animation_data.action.frame_range
    pb = src.pose.bones[bone]
    at = []
    for t in (start or 0, (f1 - f0) / fps if end is None else end):
        f = min(f1, f0 + t * fps)
        scene.frame_set(int(f), subframe=f - int(f))
        at.append(src.matrix_world @ pb.head)
    way = at[1] - at[0]
    way.z = 0
    return way.normalized()


def _leg(arm, hips, foot):
    # the length of the leg, hips to ankle, at rest (what the capture's travel is scaled by)
    b = arm.data.bones
    w = arm.matrix_world
    return ((w @ b[hips].head_local) - (w @ b[foot].head_local)).length


def _other(name):
    # the same bone on the other side: thigh_l <-> thigh_r
    for a, b in (('_l', '_r'), ('_r', '_l')):
        if name.endswith(a):
            return name[:-len(a)] + b
    return name


def _mirror(q):
    # a rotation seen in a mirror across the body's middle (the world's X = 0 plane)
    return Quaternion((q.w, q.x, -q.y, -q.z))


def retarget(src, rig, name, bone_map, *, action=None, fps=30, start=None, end=None, travel='inplace',
             mirror=False, loop=None, foot=None, facing=None, stance=None):
    """Bake `src`'s motion onto `rig` as an action called `name`. Returns (action, info).

    `travel`: 'full' keeps the capture's movement over the ground, 'inplace' keeps only the hips'
    rise and fall (the game moves the player), None neither. `action`: which of the source's
    actions (a library of clips has many). `start`/`end`: the part of the take, in seconds.
    `mirror`: left for right (a right-footed kick becomes a left-footed one). `loop`: (shortest,
    longest) cycle in seconds: the take is searched for the cycle (a stride) that joins up best,
    and only that is kept, its ends matched so it plays round without a jump. `foot`: the source
    bone of a striking foot: info['contact'] is when it moves fastest (when a kick meets the ball).
    `stance`: {'legs': degrees, 'arms': degrees}: each whole leg (or arm) turned out from the body by
    this much (in by a negative amount), about the hips' (shoulders') front-to-back line. Some takes
    run with the feet landing on one line and the elbows out: a footballer runs wider, arms in.
    `facing`: a direction over the ground (in the capture) that is turned to face straight ahead,
    the way the character faces at rest: a kick is turned so the ball goes straight on.

    info: 'duration' (s), 'speed' (m/s over the ground at the character's size, before
    'inplace' takes it out), 'contact' (s, with `foot`)."""
    scene = bpy.context.scene
    if action is not None:
        use(src, action)
    a = src.animation_data.action
    src_fps = src['fps']  # (the rate its keys are at)
    f0, f1 = a.frame_range
    if start is not None:
        f0 = a.frame_range[0] + start * src_fps
    if end is not None:
        f1 = min(f1, a.frame_range[0] + end * src_fps)

    # pairs (target pose bone, source pose bone), parents before children. Mirrored, each bone
    # follows its other side's source bone.
    by_target = {t: s for s, t in bone_map.items() if s in src.pose.bones}
    pairs = []
    for tname, sname in by_target.items():
        if tname not in rig.pose.bones:
            continue
        if mirror:
            sname = by_target.get(_other(tname))
            if sname is None:
                continue
        pairs.append((rig.pose.bones[tname], src.pose.bones[sname]))
    order = {b.name: i for i, b in enumerate(_walk(rig.data.bones))}
    pairs.sort(key=lambda p: order[p[0].name])

    # rest orientations in world space. The two skeletons don't stand the same way at rest (a
    # capture's T-pose, the character's A-pose), so first the character is posed the way the
    # capture stands, bone by bone, and that is taken as its rest.
    rest_s = {sb.name: (src.matrix_world @ sb.bone.matrix_local).to_quaternion() for _, sb in pairs}
    rest_t = _match_rest(src, rig, pairs, mirror)
    src_hips = by_target[HIPS]
    src_foot = by_target['foot_l']
    scale = _leg(rig, HIPS, 'foot_l') / max(1e-6, _leg(src, src_hips, src_foot))

    rig.animation_data_create()
    for tb, _ in pairs:
        tb.rotation_mode = 'QUATERNION'
    # (characters face -Y at rest)
    turn = Vector((0, -1, 0)).rotation_difference(Vector((facing.x, facing.y, 0)).normalized()).inverted() if facing is not None else Quaternion()
    # (outward is +X for the left side: characters face -Y, so their left is +X)
    spread = {}
    for part, chain in (('legs', ('thigh', 'calf')), ('arms', ('upperarm', 'lowerarm', 'hand'))):
        deg = (stance or {}).get(part, 0)
        for side, sign in (('l', -1), ('r', 1)):
            for b in chain:
                spread[f'{b}_{side}'] = Quaternion(Vector((0, 1, 0)), sign * math.radians(deg))
    hips_t = rig.pose.bones[HIPS]
    hips_s = src.pose.bones[src_hips]
    foot_s = src.pose.bones.get(foot) if foot else None

    # sample the pose at `fps`
    rot = []  # per frame: [local quaternion per pair]
    loc = []  # per frame: hips location
    ground = []  # per frame: the capture's hips over the ground (scaled), and the striking foot
    strike = []
    origin = None
    count = int((f1 - f0) / src_fps * fps) + 1
    for k in range(count):
        at = f0 + k * src_fps / fps
        scene.frame_set(int(at), subframe=at - int(at))
        for tb, sb in pairs:
            ws = (src.matrix_world @ sb.matrix).to_quaternion()
            delta = ws @ rest_s[sb.name].inverted()
            if mirror:
                delta = _mirror(delta)
            wt = turn @ spread.get(tb.name, Quaternion()) @ delta @ rest_t[tb.name]
            m = (rig.matrix_world.inverted().to_quaternion() @ wt).to_matrix().to_4x4()
            m.translation = tb.matrix.translation  # keep the bone where its parent puts it
            tb.matrix = m
            bpy.context.view_layer.update()
        p = src.matrix_world @ hips_s.matrix.translation
        if mirror:
            p.x = -p.x
        p = turn @ p
        if origin is None:
            origin = p.copy()
        d = (p - origin) * scale
        ground.append(d.copy())
        if foot_s:
            strike.append(turn @ (src.matrix_world @ foot_s.matrix.translation) * scale)
        if travel:
            if travel == 'inplace':
                d.x = d.y = 0  # (the game moves him over the ground)
            m = hips_t.matrix.copy()
            m.translation = rig.matrix_world.inverted() @ (rig.matrix_world @ hips_t.bone.head_local + d)
            hips_t.matrix = m
            bpy.context.view_layer.update()
        rot.append([tb.rotation_quaternion.copy() for tb, _ in pairs])
        loc.append(hips_t.location.copy())

    first, last = 0, count - 1
    if loop:
        first, last = _cycle(rot, pairs, fps, loop)
        _join(rot, loc, first, last)
    frames = range(first, last + 1)
    dur = (last - first) / fps
    run = ground[last] - ground[first]
    info = {'duration': round(dur, 4), 'speed': round(run.xy.length / dur, 3) if dur else 0}
    if strike:
        v = [(strike[i + 1] - strike[i]).length for i in range(first, last)]
        info['contact'] = round((max(range(len(v)), key=v.__getitem__) + 0.5) / fps, 4)

    # write the keys
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    for tb, _ in pairs:
        tb.keyframe_insert('rotation_quaternion', frame=1)
    hips_t.keyframe_insert('location', frame=1)
    for i, (tb, _) in enumerate(pairs):
        path = tb.path_from_id('rotation_quaternion')
        for c in range(4):
            _keys(act, path, c, [(n + 1, rot[f][i][c]) for n, f in enumerate(frames)])
    path = hips_t.path_from_id('location')
    for c in range(3):
        _keys(act, path, c, [(n + 1, loc[f][c]) for n, f in enumerate(frames)])
    act.use_fake_user = True
    scene.render.fps, scene.render.fps_base = fps, 1  # (the keys are frames at `fps`)
    return act, info


def _fcurves(act):
    # an action's curves (since Blender 4.4 they sit in a layer's strip, by slot)
    if hasattr(act, 'layers') and len(act.layers):
        bag = act.layers[0].strips[0].channelbag(act.slots[0])
        return bag.fcurves
    return act.fcurves


def _keys(act, path, index, points):
    fc = next(c for c in _fcurves(act) if c.data_path == path and c.array_index == index)
    fc.keyframe_points.clear()
    fc.keyframe_points.add(len(points))
    flat = [v for p in points for v in p]
    fc.keyframe_points.foreach_set('co', flat)
    for kp in fc.keyframe_points:
        kp.interpolation = 'LINEAR'
    fc.update()


# Bones whose pose says where in a stride the body is (what a cycle is matched by)
_STRIDE = ('thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'upperarm_l', 'upperarm_r', 'foot_l', 'foot_r')


def _cycle(rot, pairs, fps, span):
    # the stretch of the take (one stride, or several) whose last pose is most like its first,
    # moving the same way: (first frame, last frame)
    idx = [i for i, (tb, _) in enumerate(pairs) if tb.name in _STRIDE]
    def gap(a, b):
        return sum(1 - abs(rot[a][i].dot(rot[b][i])) for i in idx)
    shortest, longest = (int(s * fps) for s in span)
    n = len(rot)
    best, at = None, (0, n - 1)
    for a in range(1, n - shortest - 1):
        for p in range(shortest, min(longest, n - 2 - a) + 1):
            g = gap(a, a + p) + gap(a + 1, a + p + 1)
            if best is None or g < best:
                best, at = g, (a, a + p)
    return at


def _join(rot, loc, first, last):
    # spread the difference between the cycle's last pose and its first over the cycle, so the
    # last frame is the first again and it plays round smoothly
    n = last - first
    for i in range(len(rot[0])):
        q0, q1 = rot[first][i], rot[last][i]
        fix = q0 @ q1.inverted()
        if fix.w < 0:
            fix.negate()
        for k in range(1, n + 1):
            q = Quaternion().slerp(fix, k / n) @ rot[first + k][i]
            rot[first + k][i] = q
    d = loc[first] - loc[last]
    for k in range(1, n + 1):
        loc[first + k] = loc[first + k] + d * (k / n)


def _direction(arm, bone):
    # which way a bone points at rest, in world space
    w = arm.matrix_world
    return ((w @ bone.tail_local) - (w @ bone.head_local)).normalized()


def _match_rest(src, rig, pairs, mirror=False):
    scene = bpy.context.scene
    for tb, _ in pairs:
        tb.rotation_mode = 'QUATERNION'
        tb.rotation_quaternion = Quaternion()
        tb.location = Vector()
    bpy.context.view_layer.update()
    rest = {}
    for tb, sb in pairs:
        want = _direction(src, sb.bone)
        if mirror:
            want.x = -want.x
        now = ((rig.matrix_world @ tb.tail) - (rig.matrix_world @ tb.head)).normalized()
        turn = now.rotation_difference(want)
        w = rig.matrix_world.to_quaternion() @ tb.matrix.to_quaternion()
        m = (rig.matrix_world.to_quaternion().inverted() @ turn @ w).to_matrix().to_4x4()
        m.translation = tb.matrix.translation
        tb.matrix = m
        bpy.context.view_layer.update()
        rest[tb.name] = (rig.matrix_world @ tb.matrix).to_quaternion()
    return rest


def drop(src, actions=()):
    # done with a source: remove its armature and its actions, so none of it is exported
    acts = set(actions)
    if src.animation_data and src.animation_data.action:
        acts.add(src.animation_data.action)
    data = src.data
    for c in list(src.children):
        bpy.data.objects.remove(c)
    bpy.data.objects.remove(src)
    for a in acts:
        bpy.data.actions.remove(a)
    bpy.data.armatures.remove(data)
    # (a baked clip named like one of the source's got a .001 on the end: now it can have its name)
    for a in bpy.data.actions:
        base, dot, n = a.name.rpartition('.')
        if dot and n.isdigit() and base not in bpy.data.actions:
            a.name = base


def _walk(bones):
    roots = [b for b in bones if b.parent is None]
    out = []
    def rec(b):
        out.append(b)
        for c in b.children:
            rec(c)
    for r in roots:
        rec(r)
    return out


# What `upper_from` takes from the other clip: the shoulders and arms (the spine and head stay, since
# they balance the clip's own hips: a fast runner's spine bends back over hips tipped forward)
UPPER = ('clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r')


def _curves(act, bone):
    return [c for c in _fcurves(act) if c.data_path.startswith(f'pose.bones["{bone}"].')]


def _stride(act, fps):
    # where in a cycle the left thigh is furthest forward (0..1): what two cycles are lined up by
    cs = {c.array_index: c for c in _curves(act, 'thigh_l') if c.data_path.endswith('rotation_quaternion')}
    f0, f1 = act.frame_range
    best, at = None, 0
    n = int(f1 - f0)
    for k in range(n):
        q = Quaternion([cs[i].evaluate(f0 + k) for i in range(4)])
        swing = q.to_euler().x
        if best is None or swing > best:
            best, at = swing, k
    return at / max(1, n)


def upper_from(legs, arms, fps):
    """Give a cycle (`legs`) another cycle's shoulders and arms (`arms`),
    each played at the point of its own stride that matches, so an arm still swings with the
    opposite leg. `arms` is removed."""
    fl0, fl1 = legs.frame_range
    fa0, fa1 = arms.frame_range
    nl, na = fl1 - fl0, fa1 - fa0
    shift = _stride(arms, fps) - _stride(legs, fps)
    for bone in UPPER:
        theirs = {(c.data_path, c.array_index): c for c in _curves(arms, bone)}
        for c in _curves(legs, bone):
            src = theirs.get((c.data_path, c.array_index))
            if src is None:
                continue
            pts = []
            for k in range(int(nl) + 1):
                u = (k / nl + shift) % 1
                pts.append((fl0 + k, src.evaluate(fa0 + u * na)))
            c.keyframe_points.clear()
            c.keyframe_points.add(len(pts))
            c.keyframe_points.foreach_set('co', [v for p in pts for v in p])
            for kp in c.keyframe_points:
                kp.interpolation = 'LINEAR'
            c.update()
    bpy.data.actions.remove(arms)
