# Materials and textures for export: MPFB's materials are rebuilt as plain glTF ones (a colour
# texture into a Principled BSDF, with alpha where the part needs it), kit textures are turned to
# grey so a game can colour them, and every texture is scaled down to what the game draws it at.
import bpy
import numpy as np

# The biggest a texture of each part is kept at (px); the rest are SIZE
SIZES = {'skin': 1024, 'hair': 512, 'eyes': 256, 'brows': 256, 'lashes': 256}
SIZE = 512

# How shiny each part is
ROUGH = {'skin': 0.55, 'hair': 0.6, 'eyes': 0.2, 'boots': 0.45, 'helmet': 0.6, 'gear': 0.45, 'pads': 0.6, 'gloves': 0.6}
ROUGH_CLOTH = 0.85

# Parts drawn see-through where their texture is (strands of hair, lashes): the rest are opaque
ALPHA = {'hair', 'brows', 'lashes'}

_plain = {}


def _image(m):
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and n.name.startswith('diffuse'):
            return n.image
    return next((n.image for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)


def clean(m, role):
    """Rebuild a material as a colour texture into a Principled BSDF, named for its part."""
    img = _image(m)
    part = role.split('.')[0]  # (a person's own: "skin.p3")
    out = bpy.data.materials.new(role)
    out.use_nodes = True
    nt = out.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = ROUGH.get(part, ROUGH_CLOTH)
    if img is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        img['role'] = part
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if part in ALPHA:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    return out


def plain(m, role):
    """A material for a kit part: its texture in grey, scaled so the cloth's average is near white
    (the game's colour then shows as itself, with the folds and seams still shaded). One per part:
    everyone wearing that garment shares it."""
    img = _image(m)
    key = (role, img.name if img else None)
    if key in _plain:
        return _plain[key]
    out = clean(m, role)
    if img is not None:
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        lum = px[:, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        solid = px[:, 3] > 0.5
        top = np.percentile(lum[solid], 85) if solid.any() else 1.0
        g = np.clip(lum / max(top, 1e-3), 0, 1)
        if role not in ALPHA:
            # (a see-through bit of an opaque garment, like a frayed hem drawn in the texture, would
            # show as black: fill it with the cloth)
            g[~solid] = np.median(g[solid]) if solid.any() else 1.0
            px[:, 3] = 1.0
        grey = bpy.data.images.new(f'{role}.grey', w, h, alpha=True)
        px[:, 0] = px[:, 1] = px[:, 2] = g
        grey.pixels.foreach_set(px.ravel())
        grey['role'] = role
        grey.pack()
        next(n for n in out.node_tree.nodes if n.type == 'TEX_IMAGE').image = grey
    _plain[key] = out
    return out


def shrink():
    for img in bpy.data.images:
        if not img.size[0]:
            continue
        most = SIZES.get(img.get('role'), SIZE)
        w, h = img.size
        if max(w, h) > most:
            k = most / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))


_flat = {}


def flat(role):
    """A material of one even light grey for a part, no texture (the game colours it). Shared."""
    if role not in _flat:
        m = bpy.data.materials.new(role)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
        bsdf.inputs['Roughness'].default_value = ROUGH.get(role, ROUGH_CLOTH)
        _flat[role] = m
    return _flat[role]
