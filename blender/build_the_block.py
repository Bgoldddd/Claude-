"""COURTSIDE — THE BLOCK (outdoor neighborhood court at dusk).
Run: python build_the_block.py <texture_dir> <out_blend> <out_glb>
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from courtkit import *  # noqa: F401,F403  (builds the court + hoops, provides helpers)

# ------------------------------------------------------------------ FENCE
GATE = (-7.0, -3.0)  # entrance gap on +Y side (x range)


fence_run("Fence_South", (-FX, -FY), (FX, -FY))
fence_run("Fence_East", (FX, -FY), (FX, FY))
fence_run("Fence_West", (-FX, FY), (-FX, -FY))
fence_run("Fence_NorthA", (FX, FY), (GATE[1], FY))
fence_run("Fence_NorthB", (GATE[0], FY), (-FX, FY))

# entrance arch with sign
bm = bmesh.new()
for x in GATE:
    add_cyl(bm, (x, FY, 0), (x, FY, 4.6), 0.09, 12)
add_cyl(bm, (GATE[0], FY, 4.6), (GATE[1], FY, 4.6), 0.07, 12)
box_uv(bm, 1.0)
new_obj("Entrance_Arch", bm, M["steel_dark"], "Decorations")
make_box_obj("Entrance_SignBoard", (sum(GATE) / 2, FY, 4.15), (3.6, 0.08, 0.7), M["sign"], "Decorations", tile=1.0)
bpy.ops.object.text_add(location=(sum(GATE) / 2, FY - 0.06, 4.15))
txt = bpy.context.active_object
txt.data.body = "THE BLOCK"
txt.data.align_x = 'CENTER'; txt.data.align_y = 'CENTER'
txt.data.size = 0.5; txt.data.extrude = 0.015
txt.rotation_euler = (math.pi / 2, 0, 0)
txt.name = "Entrance_SignText"
txt.data.materials.append(M["sign_text"])
bpy.ops.object.convert(target='MESH')
link(bpy.context.active_object, "Decorations")

# ------------------------------------------------------------------ MURAL WALL behind the main hoop
WALL_X = FX + 1.2
make_box_obj("MuralWall", (WALL_X + 0.2, 0, 3.0), (0.4, 18.0, 6.0), M["brick_gray"], "Decorations", tile=3.0)
wall_quad("Mural_TheBlock", (WALL_X - 0.01, 8.6), (WALL_X - 0.01, -8.6), 0.4, 5.8, M["graffiti_a"], "Decorations", uv_full=True)

# ------------------------------------------------------------------ BLEACHERS (south sideline, facing court)


bleacher_boxes = [bleacher("Bleachers_A", -9.0, -1.0, -8.6), bleacher("Bleachers_B", 1.5, 9.5, -8.6)]

# ------------------------------------------------------------------ BENCHES, TRASH, BALL RACK


bench("Bench_A", 2.5, 9.6)
bench("Bench_B", 8.0, 9.6)
bench("Bench_C", -10.0, 9.6)


trash_can("TrashCan_A", 12.0, 10.6)
trash_can("TrashCan_B", -14.5, 10.6)
trash_can("TrashCan_C", 15.8, -10.8)

# ball rack with balls (ball mesh is a reusable asset)
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

bm = bmesh.new()
rx, ry = 14.2, 9.5
add_box(bm, (rx, ry, 0.5), (1.2, 0.04, 0.04)); add_box(bm, (rx, ry, 0.9), (1.2, 0.04, 0.04))
add_box(bm, (rx, ry + 0.3, 0.5), (1.2, 0.04, 0.04)); add_box(bm, (rx, ry + 0.3, 0.9), (1.2, 0.04, 0.04))
for dx in (-0.6, 0.6):
    for dy in (0, 0.3):
        add_box(bm, (rx + dx, ry + dy, 0.5), (0.04, 0.04, 1.0))
box_uv(bm, 1.0)
new_obj("BallRack", bm, M["steel"], "Props")
for i, (dx, dz) in enumerate([(-0.4, 0.62), (-0.13, 0.62), (0.14, 0.62), (0.41, 0.62), (-0.27, 1.02), (0.0, 1.02), (0.27, 1.02)]):
    ob = bpy.data.objects.new(f"Basketball_Rack{i}", ball_me)
    ob.location = (rx + dx, ry + 0.15, dz)
    ob.rotation_euler = (random.random() * 3, random.random() * 3, random.random() * 3)
    COLL["Props"].objects.link(ob)
for i, (x, y) in enumerate([(-15.3, -9.8), (-4.0, 10.6)]):
    ob = bpy.data.objects.new(f"Basketball_Loose{i}", ball_me)
    ob.location = (x, y, 0.12)
    COLL["Props"].objects.link(ob)

# water bottles / cooler near bench
make_box_obj("Cooler", (5.3, 9.7, 0.22), (0.6, 0.4, 0.44), M["accent"], "Props", tile=1.0)

# ------------------------------------------------------------------ LIGHTS (court floodlights + street lamps)
LIGHT_POS = [(-FX + 0.5, -FY + 0.5), (FX - 0.5, -FY + 0.5), (-FX + 0.5, FY - 0.5), (FX - 0.5, FY - 0.5), (0, -FY + 0.5), (0, FY - 0.5)]
bm_pole, bm_glow = bmesh.new(), bmesh.new()
for i, (x, y) in enumerate(LIGHT_POS):
    add_cyl(bm_pole, (x, y, 0), (x, y, 8.5), 0.11, 12, r2=0.07)
    dirv = Vector((-x, -y, 0)).normalized() * 0.9
    add_cyl(bm_pole, (x, y, 8.4), (x + dirv.x, y + dirv.y, 8.6), 0.05, 8)
    hx, hy = x + dirv.x, y + dirv.y
    add_box(bm_pole, (hx, hy, 8.6), (0.7, 0.7, 0.18), math.atan2(dirv.y, dirv.x))
    add_box(bm_glow, (hx, hy, 8.5), (0.62, 0.62, 0.02), math.atan2(dirv.y, dirv.x))
    e = bpy.data.objects.new(f"LIGHT_Flood_{i}", None)  # anchor the game uses for spotlights
    e.location = (hx, hy, 8.45)
    COLL["Anchors"].objects.link(e)
for x in (-30, -10, 10, 30):
    for y in (17.0, -17.5):
        add_cyl(bm_pole, (x, y, 0), (x, y, 6.0), 0.08, 10)
        add_cyl(bm_pole, (x, y, 6.0), (x, y - 1.2 * (1 if y > 0 else -1), 6.2), 0.05, 8)
        add_box(bm_glow, (x, y - 1.2 * (1 if y > 0 else -1), 6.12), (0.5, 0.22, 0.08))
box_uv(bm_pole, 1.0); box_uv(bm_glow, 1.0)
new_obj("Lights_Poles", bm_pole, M["steel_dark"], "Lighting")
new_obj("Lights_Glow", bm_glow, M["lamp"], "Lighting")

# ------------------------------------------------------------------ STREETS & SIDEWALKS
plane_obj("Sidewalk_Around", -FX - 3.5, FX + 3.5, -FY - 3.5, FY + 3.5, -0.001, M["sidewalk"], "Environment", tile=3.0)
bm = bmesh.new()
for (x0, x1, y0, y1) in [(-FX - 3.6, FX + 3.6, FY + 3.4, FY + 3.6), (-FX - 3.6, FX + 3.6, -FY - 3.6, -FY - 3.4),
                         (FX + 3.4, FX + 3.6, -FY - 3.6, FY + 3.6), (-FX - 3.6, -FX - 3.4, -FY - 3.6, FY + 3.6)]:
    add_box(bm, ((x0 + x1) / 2, (y0 + y1) / 2, 0.075), (x1 - x0, y1 - y0, 0.15))
box_uv(bm, 1.0)
new_obj("Curbs", bm, M["curb"], "Environment")
bm = bmesh.new()
for x in range(-80, 81, 6):
    add_box(bm, (x, FY + 9.5, 0.003), (3.0, 0.15, 0.004))
    add_box(bm, (x, -FY - 9.5, 0.003), (3.0, 0.15, 0.004))
for y in range(-80, 81, 6):
    add_box(bm, (FX + 9.5, y, 0.003), (0.15, 3.0, 0.004))
    add_box(bm, (-FX - 9.5, y, 0.003), (0.15, 3.0, 0.004))
box_uv(bm, 1.0)
new_obj("Road_Lines", bm, M["road_line"], "Environment")
# far sidewalks in front of buildings
for (x0, x1, y0, y1) in [(-70, 70, FY + 15.5, FY + 19), (-70, 70, -FY - 19, -FY - 15.5), (FX + 15.5, FX + 19, -FY - 15.5, FY + 15.5), (-FX - 19, -FX - 15.5, -FY - 15.5, FY + 15.5)]:
    plane_obj(f"Sidewalk_{int(x0)}_{int(y0)}", x0, x1, y0, y1, 0.001, M["sidewalk"], "Environment", tile=3.0)

# ------------------------------------------------------------------ BUILDINGS


def building(name, x, y, w, d, h, mat, face_dirs, mural=None):
    """Box building with window facades on the given faces ('N','S','E','W') and roof details."""
    bm = bmesh.new()
    add_box(bm, (x, y, h / 2), (w, d, h))
    box_uv(bm, 3.0)
    new_obj(name, bm, mat, "Background")
    # parapet + roof
    bm = bmesh.new()
    add_box(bm, (x, y, h + 0.02), (w - 0.2, d - 0.2, 0.04))
    for (cx, cy, sx, sy) in [(x, y + d / 2 - 0.15, w, 0.3), (x, y - d / 2 + 0.15, w, 0.3), (x + w / 2 - 0.15, y, 0.3, d), (x - w / 2 + 0.15, y, 0.3, d)]:
        add_box(bm, (cx, cy, h + 0.45), (sx, sy, 0.9))
    for _ in range(random.randint(1, 3)):
        ax, ay = x + random.uniform(-w / 3, w / 3), y + random.uniform(-d / 3, d / 3)
        add_box(bm, (ax, ay, h + 0.5), (random.uniform(1.2, 2.2), random.uniform(1.0, 1.6), 1.0))
    if random.random() < 0.6:
        add_cyl(bm, (x + w / 4, y - d / 4, h), (x + w / 4, y - d / 4, h + 4.5), 0.04, 6)  # antenna
    box_uv(bm, 2.0)
    new_obj(name + "_Roof", bm, M["roof"], "Background")
    # windows: one quad per facade, starting above the ground floor
    for f in face_dirs:
        z0, z1 = 3.5, h - 1.0
        if z1 - z0 < 3:
            continue
        o = 0.03
        if f == 'N':
            p0, p1 = (x + w / 2 - 1, y + d / 2 + o), (x - w / 2 + 1, y + d / 2 + o)
        elif f == 'S':
            p0, p1 = (x - w / 2 + 1, y - d / 2 - o), (x + w / 2 - 1, y - d / 2 - o)
        elif f == 'E':
            p0, p1 = (x + w / 2 + o, y - d / 2 + 1), (x + w / 2 + o, y + d / 2 - 1)
        else:
            p0, p1 = (x - w / 2 - o, y + d / 2 - 1), (x - w / 2 - o, y - d / 2 + 1)
        wq = wall_quad(f"{name}_Windows{f}", p0, p1, z0, z1, M["windows"], "Background", uv_tile=12.0)
    # storefront band on the ground floor
    for f in face_dirs[:1]:
        if f in ('S', 'N'):
            yy = y - d / 2 - 0.05 if f == 'S' else y + d / 2 + 0.05
            make_box_obj(f"{name}_Awning", (x, yy - (0.6 if f == 'S' else -0.6), 3.0), (w * 0.8, 1.2, 0.12), M["paint_orange"] if random.random() < 0.5 else M["facade_dark"], "Background", tile=1.0)
    if mural:
        mat_, (p0, p1), (z0, z1) = mural
        wall_quad(f"{name}_Mural", p0, p1, z0, z1, mat_, "Decorations", uv_full=True)
    # water tower on tall roofs
    if h > 16 and random.random() < 0.7:
        bm = bmesh.new()
        tx, ty = x - w / 4, y + d / 4
        for (lx, ly) in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
            add_cyl(bm, (tx + lx * 1.1, ty + ly * 1.1, h), (tx + lx * 0.9, ty + ly * 0.9, h + 3.0), 0.08, 6)
        add_cyl(bm, (tx, ty, h + 3.0), (tx, ty, h + 6.5), 1.6, 16)
        add_cyl(bm, (tx, ty, h + 6.5), (tx, ty, h + 7.8), 1.65, 16, r2=0.05)
        box_uv(bm, 2.0)
        new_obj(name + "_WaterTower", bm, M["tarp"], "Background")


# North row (+Y, behind the entrance)
yN = FY + 19 + 7
building("Bldg_N1", -48, yN, 22, 14, 18, M["brick"], ['S'])
building("Bldg_N2", -24, yN, 20, 14, 24, M["brick_gray"], ['S'],
         mural=(M["graffiti_b"], ((-33.6, yN - 7.04), (-14.4, yN - 7.04)), (4.0, 13.6)))
building("Bldg_N3", -2, yN + 1, 18, 16, 14, M["brick"], ['S'])
building("Bldg_N4", 18, yN, 18, 14, 21, M["facade_dark"], ['S'])
building("Bldg_N5", 40, yN, 22, 14, 16, M["brick"], ['S'])
# South row (-Y, behind bleachers)
yS = -FY - 19 - 7
building("Bldg_S1", -44, yS, 24, 14, 22, M["brick_gray"], ['N'])
building("Bldg_S2", -18, yS, 20, 14, 15, M["brick"], ['N'],
         mural=(M["graffiti_c"], ((-8.6, yS + 7.04), (-27.4, yS + 7.04)), (3.6, 12.0)))
building("Bldg_S3", 4, yS, 18, 14, 27, M["facade_dark"], ['N'])
building("Bldg_S4", 26, yS, 20, 14, 18, M["brick"], ['N'])
building("Bldg_S5", 48, yS, 18, 14, 13, M["brick_gray"], ['N'])
# East (behind mural wall) and West ends
xE = FX + 19 + 8
building("Bldg_E1", xE, -18, 16, 20, 20, M["brick"], ['W'])
building("Bldg_E2", xE + 2, 6, 16, 22, 30, M["brick_gray"], ['W'])
xW = -FX - 19 - 8
building("Bldg_W1", xW, -16, 16, 22, 17, M["brick_gray"], ['E'])
building("Bldg_W2", xW, 10, 16, 22, 23, M["brick"], ['E'])

# ------------------------------------------------------------------ SKYLINE (far background, one mesh)
bm = bmesh.new()
for i in range(70):
    a = math.tau * i / 70 + random.uniform(-0.03, 0.03)
    r = random.uniform(150, 230)
    w = random.uniform(14, 34); d = random.uniform(14, 34); h = random.uniform(35, 140)
    add_box(bm, (math.cos(a) * r, math.sin(a) * r, h / 2), (w, d, h), a)
    if random.random() < 0.25:
        add_box(bm, (math.cos(a) * r, math.sin(a) * r, h + 6), (w * 0.5, d * 0.5, 12), a)
box_uv(bm, 40.0)
new_obj("Skyline", bm, M["sky_tower"], "Background")

# planters / small trees along the north sidewalk
bm, bm2 = bmesh.new(), bmesh.new()
for x in (-36, -12, 12, 36):
    add_box(bm, (x, FY + 17, 0.35), (1.4, 1.4, 0.7))
    add_cyl(bm2, (x, FY + 17, 0.7), (x, FY + 17, 2.8), 0.08, 8)
    bmesh.ops.create_icosphere(bm2, subdivisions=2, radius=1.3, matrix=Matrix.Translation((x, FY + 17, 3.6)))
box_uv(bm, 1.0); box_uv(bm2, 1.0)
new_obj("Planters", bm, M["curb"], "Decorations")
new_obj("Trees", bm2, M["planter"], "Decorations")

# ------------------------------------------------------------------ COLLISION (simple boxes, hidden in game)
cols = [
    ("COL_Fence_South", (0, -FY, 1.8), (2 * FX, 0.1, 3.6)),
    ("COL_Fence_East", (FX, 0, 1.8), (0.1, 2 * FY, 3.6)),
    ("COL_Fence_West", (-FX, 0, 1.8), (0.1, 2 * FY, 3.6)),
    ("COL_Fence_NorthA", ((FX + GATE[1]) / 2, FY, 1.8), (FX - GATE[1], 0.1, 3.6)),
    ("COL_Fence_NorthB", ((GATE[0] - FX) / 2, FY, 1.8), (GATE[0] + FX, 0.1, 3.6)),
    ("COL_Pole_East", (CX + 1.2, 0, 1.8), (0.32, 0.32, 3.6)),
    ("COL_Pole_West", (-CX - 1.2, 0, 1.8), (0.32, 0.32, 3.6)),
]
for (x0, x1, y0, y1) in bleacher_boxes:
    cols.append((f"COL_Bleachers_{int(x0)}", ((x0 + x1) / 2, (y0 + y1) / 2, 1.2), (x1 - x0, y1 - y0, 2.4)))
for name, c, s in cols:
    ob = make_box_obj(name, c, s, None, "Collision")
    ob.display_type = 'WIRE'

# ------------------------------------------------------------------ ANCHORS (gameplay reference points)
for name, loc in [("ANCHOR_RimEast", (HOOP_X, 0, RIM_Z)), ("ANCHOR_RimWest", (-HOOP_X, 0, RIM_Z)),
                  ("ANCHOR_CheckBall", (HOOP_X - 7.6, 0, 0)), ("ANCHOR_CourtCenter", (0, 0, 0)),
                  ("ANCHOR_Entrance", (sum(GATE) / 2, FY - 1.0, 0))]:
    e = bpy.data.objects.new(name, None)
    e.location = loc
    COLL["Anchors"].objects.link(e)

finish()
