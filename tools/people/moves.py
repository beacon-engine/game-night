# Building a game's moves: a list of clips, each cut from a motion capture take or a clip library
# and baked onto the game_engine rig (retarget.py), exported together as one .glb (the rig and its
# clips, no body) plus a .json saying, for each clip, how long it is, how fast it travels, whether it
# loops, and when a strike lands.
#
#   blender -b -P tools/people/moves.py -- recipes/football-moves.json out.glb
#
# A move: {"name", one source: "cmu": "09_01" | "ual1": "Idle_Loop" | "ual2": "Slide_Loop",
#   optional "start"/"end" (s into the take), "loop": [shortest, longest] (s; find the cycle),
#   "mirror": true (the other side), "foot": "RightToeBase" (time the strike: when it moves fastest,
#   or with "support": "LeftToeBase", when it comes past the standing foot), "around": [before,
#   after] (s either side of that strike: the take is cut there, and turned so the strike goes
#   straight ahead), "travel": "inplace" | "full", "stance": {"legs": deg, "arms": deg} (legs or arms
#   turned out from the body: the file's "stance" is the default), "upper": {a source, "loop"...}
#   (a cycle's shoulders, arms and head from another cycle, stride for stride)}
import bpy
import json
import os
import sys

from bl_ext.user_default.mpfb.services.humanservice import HumanService

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import retarget  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..', 'web'))
SOURCES = {
    'cmu': os.path.join(ROOT, 'people', 'source', 'cmu', '{}.bvh'),
    'ual1': os.path.join(ROOT, 'people', 'source', 'ual1', 'Unreal Engine', 'AL_Standard.fbx'),
    'ual2': os.path.join(ROOT, 'people', 'source', 'ual2', 'Universal Animation Library 2 [Standard]', 'Unreal-Godot', 'UAL2_Standard.glb'),
}
MAPS = {'cmu': retarget.CMU, 'ual1': retarget.QUATERNIUS, 'ual2': retarget.QUATERNIUS}

_libraries = {}


def source(kind, ref):
    """The armature to bake from, and the action on it: a CMU take is imported each time; a clip
    library once, then each clip is one of its actions."""
    if kind == 'cmu':
        src = retarget.import_bvh(SOURCES['cmu'].format(ref))
        return src, None
    if kind not in _libraries:
        path = SOURCES[kind]
        _libraries[kind] = retarget.import_fbx(path) if path.endswith('.fbx') else retarget.import_glb(path)
    arm, actions = _libraries[kind]
    return arm, actions[ref]


def main(argv):
    args = argv[argv.index('--') + 1:]
    recipe, out = args[0], args[1]
    with open(recipe if os.path.isabs(recipe) else os.path.join(HERE, recipe)) as f:
        book = json.load(f)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fps = book.get('fps', 30)
    body = HumanService.create_human(macro_detail_dict={**HumanService._create_default_human_info_dict()['phenotype'], **book.get('body', {})})
    rig = HumanService.add_builtin_rig(body, 'game_engine', import_weights=False)
    rig.name = 'moves'
    only = os.environ.get('ONLY')
    info = {}
    for mv in book['moves']:
        if only and mv['name'] not in only.split(','):
            continue
        kind = next(k for k in SOURCES if k in mv)
        src, action = source(kind, mv[kind])
        if action is not None:
            retarget.use(src, action)
        start, end = mv.get('start'), mv.get('end')
        facing = None
        if 'around' in mv:
            hit, facing = (retarget.passing(src, mv['foot'], mv['support'], start or 0, end) if 'support' in mv
                           else retarget.fastest(src, mv['foot'], start or 0, end))
            start, end = max(0, hit - mv['around'][0]), hit + mv['around'][1]
        elif mv.get('loop') and kind == 'cmu':
            # (a cycle goes straight ahead, whichever way the subject was running in the room)
            facing = retarget.heading(src, 'Hips', start or 0, end)
        if facing is not None and mv.get('mirror'):
            facing.x = -facing.x
        act, about = retarget.retarget(src, rig, mv['name'], MAPS[kind], action=action, fps=fps, start=start, end=end,
                                       travel=mv.get('travel', 'inplace'), mirror=mv.get('mirror', False),
                                       loop=mv.get('loop'), foot=mv.get('foot'), facing=facing,
                                       stance=mv.get('stance', book.get('stance')))
        if 'upper' in mv:
            # (the upper body from another cycle: a jog's legs with an athlete's arms)
            up = mv['upper']
            uk = next(k for k in SOURCES if k in up)
            usrc, uact = source(uk, up[uk])
            arms, _ = retarget.retarget(usrc, rig, mv['name'] + '.upper', MAPS[uk], action=uact, fps=fps,
                                        start=up.get('start'), end=up.get('end'), loop=up.get('loop'),
                                        stance=up.get('stance', book.get('stance')))
            retarget.upper_from(act, arms, fps)
            if uk == 'cmu':
                retarget.drop(usrc)
        if 'around' in mv:
            about['contact'] = round(hit - start, 4)  # (the strike, as found above)
        about['loop'] = bool(mv.get('loop') or mv.get('cyclic'))
        info[mv['name']] = about
        print('MOVE', mv['name'], about)
        if kind == 'cmu':
            retarget.drop(src)
    for arm, actions in _libraries.values():
        retarget.drop(arm, actions.values())
    rig.animation_data.action = None
    # just the rig: the body was only there to fit it
    bpy.data.objects.remove(body)
    for o in list(bpy.data.objects):
        if o is not rig:
            bpy.data.objects.remove(o)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
                              export_force_sampling=False, export_optimize_animation_size=True, export_def_bones=False)
    with open(out[:-4] + '.json', 'w') as f:
        json.dump({'fps': fps, 'clips': info}, f, indent=1)
    print('BUILT', out, os.path.getsize(out))


main(sys.argv)
