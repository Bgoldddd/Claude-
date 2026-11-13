"""COURTSIDE — shared court kit (used by every court script).

Builds the full outdoor court scene in Blender, saves the .blend,
and exports a game-ready GLB.

World layout (Blender, Z up; glTF/Three.js: Y up, three.z = -blender.y):
  * Court center at the origin. Court is 28 m (X) x 15 m (Y), FIBA size.
  * Main hoop (gameplay) at +X: rim center (12.425, 0, 3.05).
  * Everything is in meters.

Run inside Blender's Python:
  python build_the_block.py <texture_dir> <out_blend> <out_glb>
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, Matrix

TEX, OUT_BLEND, OUT_GLB = sys.argv[-3], sys.argv[-2], sys.argv[-1]
MAP = __import__("os").environ.get("COURT_MAP", "the_block")
random.seed(42)

# ------------------------------------------------------------------ setup
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

COLL = {}
for name in ["Environment", "Court", "Hoops", "Props", "Lighting", "Decorations", "Collision", "Background", "Anchors"]:
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    COLL[name] = c


def link(obj, coll):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    COLL[coll].objects.link(obj)
    return obj


# ------------------------------------------------------------------ materials
_img_cache = {}


def img(name, non_color=False):
    if name in _img_cache:
        return _img_cache[name]
    im = bpy.data.images.load(f"{TEX}/{name}")
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    _img_cache[name] = im
    return im


def material(name, color=(0.8, 0.8, 0.8), rough=0.7, metal=0.0, tex=None, nrm=None, rgh=None,
             emit=None, emit_tex=None, emit_strength=1.0, alpha_tex=False, double=False):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    y = 300
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(tex); t.location = (-400, y); y -= 300
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_tex:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
    if nrm:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(nrm, True); t.location = (-400, y); y -= 300
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-150, y)
        nm.inputs["Strength"].default_value = 0.8
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if rgh:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(rgh, True); t.location = (-400, y); y -= 300
        sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-150, y)
        nt.links.new(t.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs[0], bsdf.inputs["Roughness"])
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if emit_tex:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(emit_tex); t.location = (-400, y); y -= 300
        nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    m.use_backface_culling = not double
    return m


M = {
    "asphalt": material("M_Asphalt", tex="asphalt_col.png", nrm="asphalt_nrm.png", rgh="asphalt_rgh.png"),
    "concrete": material("M_CourtConcrete", tex="concrete_col.png", nrm="concrete_nrm.png", rgh="concrete_rgh.png"),
    "sidewalk": material("M_Sidewalk", color=(0.62, 0.61, 0.58), tex="concrete_col.png", rough=0.85),
    "paint_orange": material("M_PaintOrange", color=(0.62, 0.22, 0.07), rough=0.55),
    "paint_charcoal": material("M_PaintCharcoal", color=(0.045, 0.047, 0.05), rough=0.6),
    "paint_line": material("M_PaintLine", color=(0.88, 0.86, 0.80), rough=0.5),
    "logo": material("M_CenterLogo", tex="center_logo.png", alpha_tex=True, rough=0.55),
    "steel": material("M_Steel", color=(0.55, 0.56, 0.58), metal=1.0, rough=0.35),
    "steel_dark": material("M_SteelDark", color=(0.06, 0.06, 0.065), metal=0.6, rough=0.45),
    "rim": material("M_RimOrange", color=(0.85, 0.25, 0.03), metal=0.5, rough=0.35),
    "board": material("M_Backboard", color=(0.86, 0.85, 0.82), rough=0.4),
    "board_mark": material("M_BackboardMark", color=(0.80, 0.27, 0.06), rough=0.45),
    "chain": material("M_ChainNet", color=(0.75, 0.76, 0.78), metal=1.0, rough=0.25),
    "pad": material("M_PolePad", color=(0.05, 0.05, 0.055), rough=0.8),
    "chainlink": material("M_ChainLink", tex="chainlink_rgba.png", alpha_tex=True, metal=0.7, rough=0.4, double=True),
    "brick": material("M_Brick", tex="brick_col.png", nrm="brick_nrm.png", rough=0.9),
    "brick_gray": material("M_BrickGray", color=(0.55, 0.55, 0.56), tex="brick_col.png", rough=0.9),
    "facade_dark": material("M_FacadeDark", color=(0.12, 0.12, 0.13), rough=0.8),
    "windows": material("M_Windows", tex="window_rgba.png", alpha_tex=True, emit_tex="window_emi.png", emit_strength=2.5, rough=0.2),
    "roof": material("M_Roof", color=(0.16, 0.16, 0.17), rough=0.95),
    "wood": material("M_BenchWood", color=(0.42, 0.26, 0.14), rough=0.7),
    "aluminum": material("M_Aluminum", color=(0.75, 0.76, 0.78), metal=1.0, rough=0.3),
    "trash": material("M_TrashCan", color=(0.10, 0.18, 0.13), metal=0.5, rough=0.5),
    "lamp": material("M_LampGlow", color=(1, 0.95, 0.85), emit=(1.0, 0.92, 0.78), emit_strength=12.0),
    "ball": material("M_Basketball", tex="ball_col.png", rough=0.75),
    "sky_tower": material("M_SkylineTower", color=(0.03, 0.035, 0.05), emit_tex="skyline_emi.png", emit_strength=3.0, rough=0.6),
    "graffiti_a": material("M_GraffitiA", tex="graffiti_a.png", rough=0.8),
    "graffiti_b": material("M_GraffitiB", tex="graffiti_b.png", rough=0.8),
    "graffiti_c": material("M_GraffitiC", tex="graffiti_c.png", rough=0.8),
    "sign": material("M_SignBoard", color=(0.04, 0.04, 0.045), rough=0.5),
    "sign_text": material("M_SignText", color=(1.0, 0.45, 0.12), emit=(1.0, 0.42, 0.1), emit_strength=6.0),
    "curb": material("M_Curb", color=(0.7, 0.69, 0.66), rough=0.9),
    "road_line": material("M_RoadLine", color=(0.85, 0.72, 0.2), rough=0.6),
    "tarp": material("M_WaterTower", color=(0.36, 0.25, 0.17), rough=0.9),
    "planter": material("M_Planter", color=(0.18, 0.4, 0.15), rough=0.9),
    "accent": material("M_ElectricAccent", color=(0.0, 0.85, 0.95), emit=(0.0, 0.8, 1.0), emit_strength=4.0),
}


# ------------------------------------------------------------------ mesh helpers
def new_obj(name, bm, mat=None, coll="Environment", mats=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    COLL[coll].objects.link(ob)
    if mats:
        for mm in mats:
            me.materials.append(mm)
    elif mat:
        me.materials.append(mat)
    return ob


def box_uv(bm, tile=1.0, offset=(0, 0, 0)):
    """World-ish box projection UVs. tile = meters per texture repeat."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co + Vector(offset)
            if ax == 0:
                u, v = co.y, co.z
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            l[uv].uv = (u / tile, v / tile)


def add_box(bm, center, size, rot_z=0.0):
    m = Matrix.Translation(center) @ Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Diagonal((*size, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def add_cyl(bm, p0, p1, r, segs=10, r2=None, cap=True):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    m = Matrix.Translation((p0 + p1) / 2) @ rot
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=L, matrix=m)


def make_box_obj(name, center, size, mat, coll="Environment", tile=None, rot_z=0.0):
    bm = bmesh.new()
    add_box(bm, center, size, rot_z)
    if tile:
        box_uv(bm, tile)
    return new_obj(name, bm, mat, coll)


def plane_obj(name, x0, x1, y0, y1, z, mat, coll, tile=None, uv_full=False):
    bm = bmesh.new()
    vs = [bm.verts.new((x0, y0, z)), bm.verts.new((x1, y0, z)), bm.verts.new((x1, y1, z)), bm.verts.new((x0, y1, z))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.verify()
    for l in f.loops:
        co = l.vert.co
        if uv_full:
            l[uv].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))
        else:
            l[uv].uv = (co.x / tile, co.y / tile)
    return new_obj(name, bm, mat, coll)


def wall_quad(name, p0, p1, z0, z1, mat, coll, uv_tile=None, uv_full=False, flip=False):
    """Vertical quad from p0 to p1 (xy), facing the left side of p0->p1."""
    bm = bmesh.new()
    a = bm.verts.new((p0[0], p0[1], z0)); b = bm.verts.new((p1[0], p1[1], z0))
    c = bm.verts.new((p1[0], p1[1], z1)); d = bm.verts.new((p0[0], p0[1], z1))
    f = bm.faces.new([a, b, c, d] if not flip else [d, c, b, a])
    uv = bm.loops.layers.uv.verify()
    L = (Vector(p1) - Vector(p0)).length
    for l, (s, t) in zip(f.loops, ([(0, 0), (1, 0), (1, 1), (0, 1)] if not flip else [(0, 1), (1, 1), (1, 0), (0, 0)])):
        if uv_full:
            l[uv].uv = (s, t)
        else:
            l[uv].uv = (s * L / uv_tile, (z0 + t * (z1 - z0)) / uv_tile)
    return new_obj(name, bm, mat, coll)


# ------------------------------------------------------------------ COURT
CX, CY = 14.0, 7.5          # half length / half width
LW = 0.05                   # line width
HOOP_X = 12.425             # rim center distance from center
RIM_Z = 3.05
BOARD_X = 12.8              # backboard face
Z_PAINT, Z_KEY, Z_LINE, Z_LOGO = 0.004, 0.007, 0.010, 0.008

# ground (asphalt streets around everything)
g = plane_obj("Ground_Asphalt", -90, 90, -90, 90, 0.0, M["asphalt"], "Environment", tile=5.0)
# court slab: concrete playing surface + charcoal border apron
plane_obj("Court_Apron", -CX - 3.0, CX + 3.0, -CY - 3.2, CY + 3.2, Z_PAINT * 0.5, M["paint_charcoal"], "Court", tile=4.0)
plane_obj("Court_Surface", -CX, CX, -CY, CY, Z_PAINT, M["concrete"], "Court", tile=6.0)
# keys (painted lanes)
for s, nm in ((1, "Court_Key_East"), (-1, "Court_Key_West")):
    x0, x1 = sorted((s * CX, s * (CX - 5.8)))
    plane_obj(nm, x0, x1, -2.45, 2.45, Z_KEY, M["paint_orange"], "Court", tile=2.0)
plane_obj("Court_CenterLogo", -1.75, 1.75, -1.75, 1.75, Z_LOGO, M["logo"], "Court", uv_full=True)


def strip(bm, pts, w=LW, z=Z_LINE, closed=False):
    """Flat ribbon along a 2D polyline."""
    n = len(pts)
    left, right = [], []
    for i in range(n):
        p = Vector(pts[i])
        if closed:
            a, b = Vector(pts[i - 1]), Vector(pts[(i + 1) % n])
        else:
            a = Vector(pts[max(i - 1, 0)]); b = Vector(pts[min(i + 1, n - 1)])
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))
        left.append(bm.verts.new((*(p + nrm * w / 2), z)))
        right.append(bm.verts.new((*(p - nrm * w / 2), z)))
    rng_ = range(n) if closed else range(n - 1)
    for i in rng_:
        j = (i + 1) % n
        bm.faces.new([right[i], right[j], left[j], left[i]])


def arc(cx, cy, r, a0, a1, segs=48):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / segs), cy + r * math.sin(a0 + (a1 - a0) * i / segs)) for i in range(segs + 1)]


bm = bmesh.new()
o = LW / 2
strip(bm, [(-CX + o, -CY + o), (CX - o, -CY + o), (CX - o, CY - o), (-CX + o, CY - o)], closed=True)  # boundary
strip(bm, [(0, -CY), (0, CY)])                       # half-court line
strip(bm, arc(0, 0, 1.8, 0, math.tau, 64), closed=True)  # center circle
for s in (1, -1):
    hx = s * HOOP_X
    # key outline
    kx = s * (CX - 5.8)
    strip(bm, [(s * CX, -2.45), (kx, -2.45), (kx, 2.45), (s * CX, 2.45)])
    # free-throw circle
    strip(bm, arc(kx, 0, 1.8, 0, math.tau, 56), closed=True)
    # three-point line: corners at y = ±6.6, arc radius 6.75 around hoop
    ang = math.asin(6.6 / 6.75)
    corner_x = hx - s * 6.75 * math.cos(ang)
    pts = [(s * CX, -6.6), (corner_x, -6.6)]
    if s == 1:
        pts += arc(hx, 0, 6.75, math.pi + ang, math.pi - ang, 80)[1:-1]
    else:
        pts += arc(hx, 0, 6.75, -ang, ang, 80)[1:-1]
    pts += [(corner_x, 6.6), (s * CX, 6.6)]
    strip(bm, pts)
    # restricted area arc (1.25 m)
    strip(bm, arc(hx, 0, 1.25, math.pi / 2 if s == 1 else -math.pi / 2, 3 * math.pi / 2 if s == 1 else math.pi / 2, 30))
    # lane hash marks
    for d in (1.75, 2.6, 3.45):
        mx = s * (CX - d)
        strip(bm, [(mx, 2.45), (mx, 2.65)], w=0.05)
        strip(bm, [(mx, -2.45), (mx, -2.65)], w=0.05)
box_uv(bm, 1.0)
new_obj("Court_Lines", bm, M["paint_line"], "Court")


# ------------------------------------------------------------------ HOOPS (built once, instanced)
def build_hoop_meshes():
    """Return list of (name, mesh, material) for one hoop facing -X at +X end."""
    parts = []
    # pole + gooseneck arm
    bm = bmesh.new()
    px = CX + 1.2
    add_cyl(bm, (px, 0, 0), (px, 0, 3.55), 0.1, 16)
    add_cyl(bm, (px, 0, 3.55), (px - 0.35, 0, 3.85), 0.09, 12)
    add_cyl(bm, (px - 0.35, 0, 3.85), (BOARD_X + 0.6, 0, 3.85), 0.08, 12)
    add_cyl(bm, (BOARD_X + 0.6, 0, 3.85), (BOARD_X + 0.08, 0, 3.55), 0.07, 12)
    # brace
    add_cyl(bm, (px, 0, 2.6), (BOARD_X + 0.6, 0, 3.8), 0.04, 8)
    # board mount frame
    add_box(bm, (BOARD_X + 0.07, 0, 3.4), (0.06, 0.9, 0.08))
    add_box(bm, (BOARD_X + 0.07, 0, 3.2), (0.06, 0.06, 0.6))
    # base plate + bolts
    add_box(bm, (px, 0, 0.02), (0.6, 0.6, 0.04))
    box_uv(bm, 1.0)
    parts.append(("Hoop_Pole", bm, M["steel_dark"]))
    # padding
    bm = bmesh.new()
    add_box(bm, (px, 0, 1.0), (0.32, 0.32, 1.9))
    box_uv(bm, 1.0)
    parts.append(("Hoop_Pad", bm, M["pad"]))
    # backboard (steel, painted)
    bm = bmesh.new()
    add_box(bm, (BOARD_X + 0.02, 0, 2.9 + 0.525), (0.04, 1.8, 1.05))
    box_uv(bm, 1.0)
    parts.append(("Hoop_Backboard", bm, M["board"]))
    # target square + border on the board face
    bm = bmesh.new()
    fx = BOARD_X - 0.002
    for (y0, y1, z0, z1) in [(-0.295, 0.295, 3.20, 3.25), (-0.295, 0.295, 3.60, 3.65), (-0.295, -0.245, 3.20, 3.65), (0.245, 0.295, 3.20, 3.65),
                             (-0.9, 0.9, 2.9, 2.95), (-0.9, 0.9, 3.9, 3.95), (-0.9, -0.85, 2.9, 3.95), (0.85, 0.9, 2.9, 3.95)]:
        vs = [bm.verts.new((fx, y0, z0)), bm.verts.new((fx, y0, z1)), bm.verts.new((fx, y1, z1)), bm.verts.new((fx, y1, z0))]
        bm.faces.new(vs)
    box_uv(bm, 1.0)
    parts.append(("Hoop_BoardMarks", bm, M["board_mark"]))
    # rim (torus) + bracket
    bm = bmesh.new()
    R, r = 0.2325, 0.01
    segs, rsegs = 32, 8
    rings = []
    for i in range(segs):
        a = math.tau * i / segs
        ring = []
        for j in range(rsegs):
            b = math.tau * j / rsegs
            x = HOOP_X + (R + r * math.cos(b)) * math.cos(a)
            y = (R + r * math.cos(b)) * math.sin(a)
            z = RIM_Z + r * math.sin(b)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    for i in range(segs):
        for j in range(rsegs):
            a, b2 = rings[i][j], rings[(i + 1) % segs][j]
            c, d = rings[(i + 1) % segs][(j + 1) % rsegs], rings[i][(j + 1) % rsegs]
            bm.faces.new([a, b2, c, d])
    add_box(bm, (BOARD_X - 0.08, 0, RIM_Z - 0.02), (0.16, 0.16, 0.03))
    add_box(bm, (BOARD_X - 0.01, 0, RIM_Z - 0.06), (0.02, 0.2, 0.14))
    # net hooks
    for i in range(12):
        a = math.tau * (i + 0.5) / 12
        add_box(bm, (HOOP_X + 0.235 * math.cos(a), 0.235 * math.sin(a), RIM_Z - 0.015), (0.012, 0.012, 0.03))
    box_uv(bm, 1.0)
    parts.append(("Hoop_Rim", bm, M["rim"]))
    # chain net (classic street): diamond lattice of thin links
    bm = bmesh.new()
    strands, rows = 12, 6
    top_r, bot_r, length = 0.225, 0.15, 0.42
    pts = []
    for k in range(rows + 1):
        t = k / rows
        rr = top_r + (bot_r - top_r) * (t ** 0.8)
        z = RIM_Z - 0.02 - length * t
        off = 0.5 * (k % 2)
        pts.append([(HOOP_X + rr * math.cos(math.tau * (i + off) / strands), rr * math.sin(math.tau * (i + off) / strands), z) for i in range(strands)])
    for k in range(rows):
        for i in range(strands):
            a = pts[k][i]
            b1 = pts[k + 1][i]
            b2 = pts[k + 1][(i - 1) % strands] if k % 2 == 0 else pts[k + 1][(i + 1) % strands]
            add_cyl(bm, a, b1, 0.0045, 4, cap=False)
            add_cyl(bm, a, b2, 0.0045, 4, cap=False)
    box_uv(bm, 1.0)
    parts.append(("Hoop_Net", bm, M["chain"]))
    out = []
    for name, b, mat in parts:
        me = bpy.data.meshes.new(name + "_Mesh")
        b.to_mesh(me); b.free()
        me.materials.append(mat)
        out.append((name, me))
    return out


hoop_meshes = build_hoop_meshes()
for side, tag in ((1, "East"), (-1, "West")):
    root = bpy.data.objects.new(f"Hoop_{tag}", None)
    COLL["Hoops"].objects.link(root)
    if side == -1:
        root.rotation_euler = (0, 0, math.pi)
    for name, me in hoop_meshes:
        ob = bpy.data.objects.new(f"{name}_{tag}", me)  # shared mesh data = reusable asset
        COLL["Hoops"].objects.link(ob)
        ob.parent = root


# ------------------------------------------------------------------ shared props
FX, FY, FH = 17.5, 12.0, 3.6


def fence_run(name, p0, p1, z1=FH):
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    n = max(1, round(L / 3.0))
    bm = bmesh.new()
    for i in range(n + 1):
        p = p0.lerp(p1, i / n)
        add_cyl(bm, (p.x, p.y, 0), (p.x, p.y, z1 + 0.1), 0.045, 8)
    add_cyl(bm, (*p0, z1), (*p1, z1), 0.03, 8)
    add_cyl(bm, (*p0, 0.15), (*p1, 0.15), 0.025, 8)
    add_cyl(bm, (*p0, z1 * 0.5), (*p1, z1 * 0.5), 0.02, 6)
    box_uv(bm, 1.0)
    new_obj(name + "_Posts", bm, M["steel"], "Environment")
    wall_quad(name + "_Mesh", tuple(p0), tuple(p1), 0.0, z1, M["chainlink"], "Environment", uv_tile=0.8)


def bleacher(name, x0, x1, y_front):
    bm = bmesh.new()
    rows = 5
    for r in range(rows):
        y = y_front - r * 0.55
        z = 0.45 + r * 0.4
        add_box(bm, ((x0 + x1) / 2, y, z), (x1 - x0, 0.32, 0.05))          # seat plank
        add_box(bm, ((x0 + x1) / 2, y + 0.24, z - 0.22), (x1 - x0, 0.22, 0.03))  # foot plank
    bm_frame = bmesh.new()
    for x in [x0 + 0.2 + i * ((x1 - x0 - 0.4) / 3) for i in range(4)]:
        add_cyl(bm_frame, (x, y_front + 0.1, 0), (x, y_front - (rows - 1) * 0.55 - 0.1, 0.45 + (rows - 1) * 0.4), 0.035, 6)
        add_cyl(bm_frame, (x, y_front - (rows - 1) * 0.55 - 0.1, 0), (x, y_front - (rows - 1) * 0.55 - 0.1, 0.45 + (rows - 1) * 0.4 + 0.9), 0.03, 6)
    add_cyl(bm_frame, (x0, y_front - (rows - 1) * 0.55 - 0.1, 2.5), (x1, y_front - (rows - 1) * 0.55 - 0.1, 2.5), 0.03, 6)
    box_uv(bm, 1.0); box_uv(bm_frame, 1.0)
    new_obj(name, bm, M["aluminum"], "Props")
    new_obj(name + "_Frame", bm_frame, M["steel_dark"], "Props")
    return (x0, x1, y_front - (rows - 1) * 0.55 - 0.3, y_front + 0.3)


def bench(name, x, y, rot=0.0):
    bm = bmesh.new()
    for dy in (-0.12, 0.0, 0.12):
        add_box(bm, (0, dy, 0.46), (2.0, 0.1, 0.04))
    for dy in (0.25, 0.37):
        add_box(bm, (0, dy, 0.75 + (dy - 0.25)), (2.0, 0.1, 0.04))
    bm2 = bmesh.new()
    for dx in (-0.85, 0.85):
        add_box(bm2, (dx, 0.0, 0.22), (0.06, 0.4, 0.44))
        add_box(bm2, (dx, 0.3, 0.65), (0.06, 0.06, 0.5))
    for b_ in (bm, bm2):
        bmesh.ops.transform(b_, matrix=Matrix.Translation((x, y, 0)) @ Matrix.Rotation(rot, 4, 'Z'), verts=b_.verts)
        box_uv(b_, 1.0)
    new_obj(name, bm, M["wood"], "Props")
    new_obj(name + "_Legs", bm2, M["steel_dark"], "Props")


def trash_can(name, x, y):
    bm = bmesh.new()
    add_cyl(bm, (x, y, 0), (x, y, 0.95), 0.3, 14, r2=0.32)
    add_cyl(bm, (x, y, 0.95), (x, y, 1.0), 0.34, 14)
    box_uv(bm, 1.0)
    new_obj(name, bm, M["trash"], "Props")


# basketball mesh (reusable asset)
ball_me = bpy.data.meshes.new("Basketball_Mesh")
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=0.12)
uvl = bm.loops.layers.uv.verify()
for f in bm.faces:
    for l in f.loops:
        co = l.vert.co.normalized()
        u = (math.atan2(co.y, co.x) / math.tau) % 1.0
        v = 0.5 + math.asin(max(-1, min(1, co.z))) / math.pi
        l[uvl].uv = (u, v)
# fix seam wrap
for f in bm.faces:
    us = [l[uvl].uv.x for l in f.loops]
    if max(us) - min(us) > 0.5:
        for l in f.loops:
            if l[uvl].uv.x < 0.5:
                l[uvl].uv.x += 1.0
bm.to_mesh(ball_me); bm.free()
for p in ball_me.polygons:
    p.use_smooth = True
ball_me.materials.append(M["ball"])



def loose_ball(name, x, y, z=0.12):
    ob = bpy.data.objects.new(name, ball_me)
    ob.location = (x, y, z)
    COLL["Props"].objects.link(ob)
    return ob


def flood_anchor(i, x, y, z=8.45):
    e = bpy.data.objects.new(f"LIGHT_Flood_{i}", None)
    e.location = (x, y, z)
    COLL["Anchors"].objects.link(e)


def court_anchors_and_collision(extra=()):
    cols = [("COL_Pole_East", (CX + 1.2, 0, 1.8), (0.32, 0.32, 3.6)), ("COL_Pole_West", (-CX - 1.2, 0, 1.8), (0.32, 0.32, 3.6))] + list(extra)
    for name, c, s in cols:
        ob = make_box_obj(name, c, s, None, "Collision")
        ob.display_type = 'WIRE'
    for name, loc in [("ANCHOR_RimEast", (HOOP_X, 0, RIM_Z)), ("ANCHOR_RimWest", (-HOOP_X, 0, RIM_Z)),
                      ("ANCHOR_CheckBall", (HOOP_X - 7.6, 0, 0)), ("ANCHOR_CourtCenter", (0, 0, 0))]:
        e = bpy.data.objects.new(name, None)
        e.location = loc
        COLL["Anchors"].objects.link(e)


def finish(sun_color=(1.0, 0.72, 0.5), sun_energy=2.5, world_color=(0.22, 0.17, 0.2)):
    sun_data = bpy.data.lights.new("Sun_Dusk", 'SUN')
    sun_data.energy = sun_energy
    sun_data.color = sun_color
    sun = bpy.data.objects.new("Sun_Dusk", sun_data)
    sun.rotation_euler = (math.radians(68), 0, math.radians(-125))
    COLL["Lighting"].objects.link(sun)
    world = bpy.data.worlds.new("World_Dusk")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*world_color, 1)
    bg.inputs[1].default_value = 0.7
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 24
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    cam.location = (-4.0, -11.0, 5.5)
    direction = Vector((HOOP_X, 0, 2.0)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam

    # smooth shading on round things
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and any(k in ob.name for k in ("Pole", "Rim", "Net", "Trees", "TrashCan", "Lights_Poles")):
            for p in ob.data.polygons:
                p.use_smooth = True

    # ------------------------------------------------------------------ save + export
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

    # export: everything except Blender-only helpers (camera, sun). Collision + anchors are kept
    # (named COL_ / ANCHOR_ / LIGHT_) so the game can read them, then hides them.
    for ob in bpy.data.objects:
        ob.select_set(ob.type in ('MESH', 'EMPTY'))
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_image_format='WEBP',
        export_image_quality=82,
    )

    tri = 0
    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            tri += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print("OBJECTS", len(bpy.data.objects), "TRIS~", tri)
    print("SAVED", OUT_BLEND, OUT_GLB)

