"""COURTSIDE — player character parts.

Builds an original stylized basketball player as separate body parts.
Each part has its pivot at the joint, so the game assembles a rig and
animates it in code (procedural animation with blending).

Blender coords: Z up, character faces -Y  (=> glTF/Three: Y up, faces +Z).
Material names are fixed; the game recolors them per player:
  M_Skin M_Jersey M_JerseyTrim M_Shorts M_ShortsTrim M_Sock
  M_ShoeUpper M_ShoeSole M_ShoeAccent M_Hair M_Eye M_EyeWhite M_Accessory M_Gold

Run: python build_character.py <out_blend> <out_glb>
"""
import sys, math
import bpy, bmesh
from mathutils import Vector, Matrix

OUT_BLEND, OUT_GLB = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = bpy.data.collections.new("Character"); scene.collection.children.link(coll)


def mat(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


MATS = {k: mat(*v) for k, v in {
    "skin": ("M_Skin", (0.55, 0.36, 0.24), 0.55),
    "jersey": ("M_Jersey", (0.75, 0.3, 0.08), 0.65),
    "trim": ("M_JerseyTrim", (0.95, 0.93, 0.88), 0.6),
    "shorts": ("M_Shorts", (0.06, 0.06, 0.07), 0.6),
    "shorts_trim": ("M_ShortsTrim", (0.75, 0.3, 0.08), 0.6),
    "sock": ("M_Sock", (0.95, 0.95, 0.93), 0.9),
    "shoe": ("M_ShoeUpper", (0.08, 0.08, 0.09), 0.45),
    "sole": ("M_ShoeSole", (0.94, 0.93, 0.9), 0.7),
    "shoe_accent": ("M_ShoeAccent", (0.0, 0.8, 0.95), 0.4),
    "hair": ("M_Hair", (0.03, 0.025, 0.02), 0.85),
    "eye": ("M_Eye", (0.02, 0.015, 0.012), 0.2),
    "eyewhite": ("M_EyeWhite", (0.92, 0.9, 0.86), 0.3),
    "acc": ("M_Accessory", (0.95, 0.95, 0.95), 0.7),
    "gold": ("M_Gold", (1.0, 0.75, 0.3), 0.25, 1.0),
}.items()}
ORDER = list(MATS.keys())


def finish(name, bm, smooth=True):
    """bm faces carry material_index into ORDER. Keeps only used materials."""
    me = bpy.data.meshes.new(name)
    used = sorted({f.material_index for f in bm.faces})
    remap = {u: i for i, u in enumerate(used)}
    for f in bm.faces:
        f.material_index = remap[f.material_index]
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:  # simple cylindrical uv (only used for subtle detail)
        for l in f.loops:
            c = l.vert.co
            l[uv].uv = ((math.atan2(c.y, c.x) / math.tau) % 1.0, c.z)
    bm.to_mesh(me); bm.free()
    for u in used:
        me.materials.append(MATS[ORDER[u]])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def mi(key):
    return ORDER.index(key)


def loft(bm, rings, segs=16, cx=0.0, cy=0.0, mat_key="skin", cap_top=True, cap_bottom=True, mat_fn=None):
    """rings: list of (z, rx, ry[, dy]) ellipses stacked along Z."""
    vr = []
    for r in rings:
        z, rx, ry = r[0], r[1], r[2]
        dy = r[3] if len(r) > 3 else 0.0
        vr.append([bm.verts.new((cx + rx * math.cos(math.tau * i / segs), cy + dy + ry * math.sin(math.tau * i / segs), z)) for i in range(segs)])
    for k in range(len(vr) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            f = bm.faces.new([vr[k][i], vr[k][j], vr[k + 1][j], vr[k + 1][i]])
            f.material_index = mi(mat_fn(k) if mat_fn else mat_key)
    for idx, cap in ((0, cap_bottom), (-1, cap_top)):
        if cap:
            ring = vr[idx]
            c = bm.verts.new(sum((v.co for v in ring), Vector()) / segs)
            for i in range(segs):
                j = (i + 1) % segs
                f = bm.faces.new([ring[i], ring[j], c] if idx == -1 else [ring[j], ring[i], c])
                f.material_index = mi(mat_fn(len(vr) - 2 if idx == -1 else 0) if mat_fn else mat_key)
    bm.normal_update()
    return vr


def ellipsoid(bm, center, radii, mat_key, segs=16, rings=10):
    m = Matrix.Translation(center) @ Matrix.Diagonal((*radii, 1))
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = mi(mat_key)


def boxm(bm, center, size, mat_key):
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(center) @ Matrix.Diagonal((*size, 1)))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = mi(mat_key)


def torus(bm, center, R, r, mat_key, segs=20, rsegs=6, axis='Z'):
    rot = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
    rings = []
    for i in range(segs):
        a = math.tau * i / segs
        ring = []
        for j in range(rsegs):
            b = math.tau * j / rsegs
            p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
            ring.append(bm.verts.new(Vector(center) + (rot @ p.to_4d()).to_3d()))
        rings.append(ring)
    for i in range(segs):
        for j in range(rsegs):
            f = bm.faces.new([rings[i][j], rings[(i + 1) % segs][j], rings[(i + 1) % segs][(j + 1) % rsegs], rings[i][(j + 1) % rsegs]])
            f.material_index = mi(mat_key)


# ---------------------------------------------------------------- TORSO (pivot: hips)
bm = bmesh.new()
loft(bm, [(-0.02, 0.172, 0.118), (0.04, 0.168, 0.114), (0.14, 0.158, 0.106), (0.26, 0.168, 0.112),
          (0.38, 0.19, 0.122), (0.46, 0.2, 0.124), (0.52, 0.19, 0.115), (0.565, 0.15, 0.09), (0.585, 0.08, 0.065)],
     segs=20, mat_key="jersey", cap_bottom=True, cap_top=True)
# hem trim + collar trim + armhole trims
torus(bm, (0, 0, 0.0), 0.165, 0.012, "trim", 24, 5)
loft(bm, [(0.55, 0.07, 0.06, -0.01), (0.66, 0.058, 0.055, -0.005)], segs=12, mat_key="skin")  # neck
torus(bm, (0, -0.01, 0.575), 0.085, 0.012, "trim", 18, 5)
for s in (-1, 1):
    torus(bm, (s * 0.17, 0, 0.47), 0.075, 0.011, "trim", 16, 5, axis='X')
finish("Part_Torso", bm)

# ---------------------------------------------------------------- PELVIS / waistband (pivot: hips)
bm = bmesh.new()
loft(bm, [(-0.16, 0.17, 0.115), (-0.04, 0.175, 0.118), (0.03, 0.172, 0.117), (0.06, 0.168, 0.114)], segs=20, mat_key="shorts")
torus(bm, (0, 0, -0.06), 0.174, 0.015, "shorts_trim", 24, 5)
finish("Part_Pelvis", bm)

# ---------------------------------------------------------------- THIGH (pivot: hip joint) — shorts leg + skin
bm = bmesh.new()
loft(bm, [(0.06, 0.1, 0.105), (-0.1, 0.108, 0.112), (-0.25, 0.114, 0.118), (-0.37, 0.118, 0.12)],
     segs=16, mat_key="shorts", cap_top=False, cap_bottom=False)
torus(bm, (0, 0, -0.36), 0.115, 0.012, "shorts_trim", 16, 5)
loft(bm, [(-0.3, 0.072, 0.078), (-0.4, 0.062, 0.066), (-0.46, 0.055, 0.058)], segs=12, mat_key="skin")
finish("Part_Thigh", bm)

# ---------------------------------------------------------------- SHIN (pivot: knee) — calf + sock
bm = bmesh.new()
loft(bm, [(0.02, 0.055, 0.058), (-0.08, 0.058, 0.066, 0.01), (-0.18, 0.052, 0.058, 0.01), (-0.3, 0.042, 0.045)],
     segs=12, mat_key="skin", cap_bottom=False)
loft(bm, [(-0.28, 0.046, 0.048), (-0.36, 0.044, 0.046), (-0.45, 0.046, 0.05)], segs=12, mat_key="sock")
finish("Part_Shin", bm)

# ---------------------------------------------------------------- SHOE (pivot: ankle; toes toward -Y)
bm = bmesh.new()
# sole
loft(bm, [(-0.105, 0.058, 0.155, -0.045), (-0.075, 0.062, 0.16, -0.045)], segs=20, mat_key="sole")
# upper: tapered ellipse, higher at the heel collar
loft(bm, [(-0.078, 0.056, 0.15, -0.045), (-0.03, 0.054, 0.135, -0.035), (0.0, 0.05, 0.1, -0.012), (0.04, 0.048, 0.06, 0.012)],
     segs=20, mat_key="shoe")
# toe cap + swoosh-free accent stripe (original)
ellipsoid(bm, (0, -0.15, -0.06), (0.056, 0.06, 0.04), "shoe", 12, 8)
boxm(bm, (0.058, -0.04, -0.045), (0.006, 0.12, 0.02), "shoe_accent")
boxm(bm, (-0.058, -0.04, -0.045), (0.006, 0.12, 0.02), "shoe_accent")
boxm(bm, (0, 0.105, -0.03), (0.06, 0.012, 0.05), "shoe_accent")  # heel tab
finish("Part_Shoe", bm)

# ---------------------------------------------------------------- UPPER ARM (pivot: shoulder)
bm = bmesh.new()
ellipsoid(bm, (0, 0, -0.02), (0.068, 0.07, 0.075), "skin", 14, 10)  # deltoid
loft(bm, [(-0.02, 0.058, 0.062), (-0.14, 0.054, 0.06, 0.006), (-0.25, 0.046, 0.05), (-0.31, 0.042, 0.044)], segs=12, mat_key="skin")
finish("Part_UpperArm", bm)

# ---------------------------------------------------------------- FOREARM (pivot: elbow)
bm = bmesh.new()
loft(bm, [(0.01, 0.042, 0.044), (-0.08, 0.045, 0.042), (-0.2, 0.036, 0.032), (-0.27, 0.03, 0.026)], segs=12, mat_key="skin")
finish("Part_Forearm", bm)

# ---------------------------------------------------------------- HAND (pivot: wrist)
bm = bmesh.new()
loft(bm, [(0.0, 0.03, 0.022), (-0.05, 0.042, 0.022), (-0.1, 0.044, 0.02), (-0.12, 0.04, 0.018)], segs=10, mat_key="skin")
for k in range(4):
    x = -0.03 + k * 0.02
    loft(bm, [(-0.115, 0.009, 0.01, 0.002), (-0.17 + abs(k - 1.5) * 0.01, 0.008, 0.009, 0.006)], segs=6, cx=x, mat_key="skin")
loft(bm, [(-0.03, 0.011, 0.011), (-0.08, 0.009, 0.009, -0.02)], segs=6, cx=0.042, cy=-0.012, mat_key="skin")  # thumb
finish("Part_Hand", bm)

# ---------------------------------------------------------------- HEAD (pivot: top of neck)
bm = bmesh.new()
ellipsoid(bm, (0, 0.005, 0.125), (0.094, 0.104, 0.122), "skin", 22, 16)       # skull
ellipsoid(bm, (0, -0.03, 0.06), (0.078, 0.078, 0.07), "skin", 18, 12)          # jaw / cheeks
ellipsoid(bm, (0, -0.103, 0.105), (0.016, 0.022, 0.028), "skin", 10, 8)        # nose
for s in (-1, 1):
    ellipsoid(bm, (s * 0.094, 0.0, 0.11), (0.014, 0.024, 0.03), "skin", 8, 6)   # ears
    ellipsoid(bm, (s * 0.036, -0.088, 0.14), (0.017, 0.008, 0.011), "eyewhite", 10, 6)
    ellipsoid(bm, (s * 0.036, -0.095, 0.14), (0.0085, 0.004, 0.0085), "eye", 8, 6)
    boxm(bm, (s * 0.037, -0.093, 0.163), (0.034, 0.012, 0.008), "hair")       # brows
boxm(bm, (0, -0.096, 0.065), (0.04, 0.008, 0.006), "eye")                       # mouth line
finish("Part_Head", bm)

# ---------------------------------------------------------------- HAIR variants (pivot: same as head)
import random
random.seed(3)


def hair_shell(bm, radii, center=(0, 0.005, 0.125), front_cut=0.185, back_cut=0.075, segs=22, rings=16):
    """Ellipsoid shell around the skull, trimmed by a tilted hairline (high at the forehead, low at the nape)."""
    m = Matrix.Translation(center) @ Matrix.Diagonal((*radii, 1))
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)
    faces = {f for v in res["verts"] for f in v.link_faces}
    kill = []
    for f in faces:
        c = f.calc_center_median()
        t = (c.y + 0.11) / 0.22  # 0 at front, 1 at back
        if c.z < front_cut + (back_cut - front_cut) * max(0, min(1, t)):
            kill.append(f)
        else:
            f.material_index = mi("hair")
    bmesh.ops.delete(bm, geom=kill, context='FACES')


bm = bmesh.new(); hair_shell(bm, (0.099, 0.109, 0.128)); finish("Hair_Buzz", bm)
bm = bmesh.new(); hair_shell(bm, (0.1, 0.11, 0.165), center=(0, 0.0, 0.12)); finish("Hair_Fade", bm)
bm = bmesh.new(); hair_shell(bm, (0.15, 0.155, 0.145), center=(0, 0.02, 0.19), front_cut=0.19, back_cut=0.06); finish("Hair_Afro", bm)

bm = bmesh.new(); hair_shell(bm, (0.099, 0.109, 0.128))
for i in range(30):
    a = math.tau * i / 30 + random.uniform(-0.08, 0.08)
    for ring_r, z in ((0.075, 0.21), (0.045, 0.24)):
        if ring_r == 0.045 and i % 2:
            continue
        p = Vector((math.cos(a) * ring_r, math.sin(a) * ring_r + 0.01, z))
        tip = p + Vector((math.cos(a) * 0.035, math.sin(a) * 0.035, 0.065 + random.uniform(-0.01, 0.02)))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.012, radius2=0.007, depth=(tip - p).length,
                              matrix=Matrix.Translation((p + tip) / 2) @ (tip - p).to_track_quat('Z', 'Y').to_matrix().to_4x4())
for f in bm.faces:
    f.material_index = mi("hair")
finish("Hair_Twists", bm)

bm = bmesh.new(); hair_shell(bm, (0.097, 0.107, 0.125))
for k in range(6):  # cornrows: ridges front to back
    x = -0.06 + k * 0.024
    pts = []
    for t in range(10):
        th = -0.95 + 2.5 * t / 9
        pts.append(Vector((x, -math.sin(th) * 0.108 + 0.005, 0.125 + math.cos(th) * 0.126)))
    for a, b in zip(pts, pts[1:]):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.009, radius2=0.009, depth=(b - a).length,
                              matrix=Matrix.Translation((a + b) / 2) @ (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4())
for f in bm.faces:
    f.material_index = mi("hair")
finish("Hair_Braids", bm)

# ---------------------------------------------------------------- ACCESSORIES
bm = bmesh.new(); torus(bm, (0, 0.003, 0.175), 0.103, 0.014, "acc", 28, 6)
finish("Acc_Headband", bm)
bm = bmesh.new(); loft(bm, [(-0.17, 0.038, 0.036), (-0.24, 0.035, 0.032)], segs=12, mat_key="acc")
finish("Acc_Wristband", bm)  # pivot = elbow (forearm space)
bm = bmesh.new(); loft(bm, [(0.0, 0.064, 0.066), (-0.14, 0.058, 0.064, 0.006), (-0.3, 0.046, 0.048)], segs=12, mat_key="acc")
finish("Acc_ArmSleeve", bm)  # pivot = shoulder
bm = bmesh.new(); loft(bm, [(0.06, 0.064, 0.07), (-0.06, 0.062, 0.07, 0.008)], segs=12, mat_key="acc")
finish("Acc_KneeSleeve", bm)  # pivot = knee
bm = bmesh.new(); torus(bm, (0, -0.012, 0.6), 0.075, 0.006, "gold", 24, 5)
boxm(bm, (0, -0.088, 0.565), (0.02, 0.006, 0.026), "gold")
finish("Acc_Chain", bm)  # pivot = hips (torso space)

# ---------------------------------------------------------------- lay parts out (preview only) then export
x = 0
for ob in coll.objects:
    ob.location = (x, 0, 0)
    x += 0.4
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
for ob in coll.objects:
    ob.location = (0, 0, 0)  # export with pivot at origin
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
print("PARTS", [o.name for o in coll.objects])
print("TRIS", sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in coll.objects))
