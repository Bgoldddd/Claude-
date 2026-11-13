"""COURTSIDE — SKYLINE: a rooftop court above the city at night.
Run: python build_skyline.py <texture_dir> <out_blend> <out_glb>
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from courtkit import *  # noqa: F401,F403

random.seed(77)

# ---- recolor the court for night: deep navy, teal keys, cyan accent
navy = material("M_SkyCourt", color=(0.05, 0.08, 0.14), tex="concrete_col.png", rough=0.55)
teal = material("M_SkyKey", color=(0.02, 0.32, 0.38), rough=0.5)
pav = material("M_Pavers", tex="pavers_col.png", rough=0.85)
neon = material("M_NeonSign", tex="sign_skyline.png", emit_tex="sign_skyline.png", emit_strength=5.0)
glass = material("M_Glass", color=(0.5, 0.65, 0.75), metal=0.6, rough=0.08)
bulb = material("M_StringBulb", color=(1, 0.85, 0.6), emit=(1.0, 0.78, 0.45), emit_strength=10.0)
red = material("M_AntennaRed", color=(1, 0.1, 0.05), emit=(1, 0.08, 0.04), emit_strength=8.0)
for nm, mat in (("Court_Surface", navy), ("Court_Key_East", teal), ("Court_Key_West", teal)):
    o = bpy.data.objects[nm]; o.data.materials[0] = mat
# the shared ground becomes the roof deck
g = bpy.data.objects["Ground_Asphalt"]; bpy.data.objects.remove(g)
RX, RY = 22.0, 16.0
make_box_obj("Roof_Slab", (0, 0, -1.5), (2 * RX, 2 * RY, 3.0), pav, "Environment", tile=4.0)
# parapet + glass railing
bm = bmesh.new()
for (cx, cy, sx, sy) in [(0, RY, 2 * RX + 0.6, 0.3), (0, -RY, 2 * RX + 0.6, 0.3), (RX, 0, 0.3, 2 * RY), (-RX, 0, 0.3, 2 * RY)]:
    add_box(bm, (cx, cy, 0.5), (sx, sy, 1.0))
box_uv(bm, 2.0)
new_obj("Roof_Parapet", bm, M["roof"], "Environment")
bm = bmesh.new()
for (cx, cy, sx, sy) in [(0, RY, 2 * RX, 0.04), (0, -RY, 2 * RX, 0.04), (RX, 0, 0.04, 2 * RY), (-RX, 0, 0.04, 2 * RY)]:
    add_box(bm, (cx, cy, 1.55), (sx, sy, 1.1))
box_uv(bm, 2.0)
new_obj("Roof_GlassRail", bm, glass, "Environment")

# ---- court fence (dark), same footprint as the game's ball fence
dark_link = material("M_ChainLinkDark", tex="chainlink_rgba.png", alpha_tex=True, color=(0.2, 0.2, 0.22), metal=0.8, rough=0.4, double=True)
GATE = (-7.0, -3.0)
for nm, a, b in [("Fence_South", (-FX, -FY), (FX, -FY)), ("Fence_East", (FX, -FY), (FX, FY)), ("Fence_West", (-FX, FY), (-FX, -FY)),
                 ("Fence_NorthA", (FX, FY), (GATE[1], FY)), ("Fence_NorthB", (GATE[0], FY), (-FX, FY))]:
    fence_run(nm, a, b, 4.2)
    bpy.data.objects[nm + "_Mesh"].data.materials[0] = dark_link

# ---- neon sign on a steel frame behind the main hoop
bm = bmesh.new()
for y in (-7, 7):
    add_cyl(bm, (FX + 1.5, y, 0), (FX + 1.5, y, 9.5), 0.12, 10)
add_box(bm, (FX + 1.55, 0, 9.4), (0.2, 14.4, 0.2)); add_box(bm, (FX + 1.55, 0, 5.8), (0.2, 14.4, 0.2))
box_uv(bm, 1.0)
new_obj("Sign_Frame", bm, M["steel_dark"], "Decorations")
wall_quad("Sign_Skyline", (FX + 1.4, 7.0), (FX + 1.4, -7.0), 5.9, 9.3, neon, "Decorations", uv_full=True)

# ---- rooftop details: HVAC, stair house, water tank, lounge
bm = bmesh.new()
for (x, y, sx, sy, sz) in [(-19.5, 13.5, 3.0, 2.0, 1.6), (-19.5, -13.0, 2.4, 2.4, 1.4), (19.6, 13.6, 2.2, 1.6, 1.2), (8, 14.6, 4.0, 1.4, 1.0)]:
    add_box(bm, (x, y, sz / 2), (sx, sy, sz))
    add_cyl(bm, (x, y, sz), (x, y, sz + 0.25), min(sx, sy) * 0.35, 14)
box_uv(bm, 1.0)
new_obj("Roof_HVAC", bm, M["aluminum"], "Props")
make_box_obj("Roof_StairHouse", (-14.0, 14.4, 1.6), (5.0, 2.6, 3.2), M["brick_gray"], "Environment", tile=3.0)
make_box_obj("Roof_StairDoor", (-14.0, 13.08, 1.1), (1.0, 0.05, 2.1), M["steel_dark"], "Environment", tile=1.0)
bench("Bench_A", 2.5, 13.0); bench("Bench_B", 8.0, 13.0)
bleacher("Bleachers_A", -9.0, -1.0, -12.6); bleacher("Bleachers_B", 1.5, 9.5, -12.6)
trash_can("TrashCan_A", 12.0, 13.5)
loose_ball("Basketball_Loose0", -15.3, -9.8); loose_ball("Basketball_Loose1", 16.4, 10.4)
# string lights zig-zagging over the court
bm = bmesh.new(); bmw = bmesh.new()
for k in range(7):
    x0 = -15 + k * 5
    a = Vector((x0, -FY + 0.3, 6.5)); b = Vector((x0 + 2.5, FY - 0.3, 6.5))
    pts = [a.lerp(b, t / 16) for t in range(17)]
    for i, p in enumerate(pts):
        p.z -= math.sin(i / 16 * math.pi) * 1.2
    for p0, p1 in zip(pts, pts[1:]):
        add_cyl(bmw, p0, p1, 0.01, 4, cap=False)
    for p in pts[1:-1]:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.06, matrix=Matrix.Translation(p))
box_uv(bm, 1.0); box_uv(bmw, 1.0)
new_obj("StringLights_Bulbs", bm, bulb, "Lighting"); new_obj("StringLights_Wire", bmw, M["steel_dark"], "Lighting")
# light poles + flood anchors
bm_pole, bm_glow = bmesh.new(), bmesh.new()
for i, (x, y) in enumerate([(-FX + 0.5, -FY + 0.5), (FX - 0.5, -FY + 0.5), (-FX + 0.5, FY - 0.5), (FX - 0.5, FY - 0.5)]):
    add_cyl(bm_pole, (x, y, 0), (x, y, 8.5), 0.11, 12, r2=0.07)
    dv = Vector((-x, -y, 0)).normalized() * 0.9
    add_box(bm_pole, (x + dv.x, y + dv.y, 8.6), (0.7, 0.7, 0.18), math.atan2(dv.y, dv.x))
    add_box(bm_glow, (x + dv.x, y + dv.y, 8.5), (0.62, 0.62, 0.02), math.atan2(dv.y, dv.x))
    flood_anchor(i, x + dv.x, y + dv.y)
box_uv(bm_pole, 1.0); box_uv(bm_glow, 1.0)
new_obj("Lights_Poles", bm_pole, M["steel_dark"], "Lighting"); new_obj("Lights_Glow", bm_glow, M["lamp"], "Lighting")

# ---- the city: towers rising from far below the roof
tower_mats = [M["sky_tower"], material("M_TowerBlue", color=(0.02, 0.03, 0.06), emit_tex="skyline_emi.png", emit_strength=2.0, rough=0.3, metal=0.4)]
bms = [bmesh.new(), bmesh.new()]
bmr = bmesh.new()
for i in range(140):
    a = random.uniform(0, math.tau)
    r = random.uniform(45, 260)
    w = random.uniform(12, 32); d = random.uniform(12, 32); h = random.uniform(20, 160) if r > 70 else random.uniform(-25, 25)
    z0 = -80.0
    top = h
    k = i % 2
    add_box(bms[k], (math.cos(a) * r, math.sin(a) * r, (z0 + top) / 2), (w, d, top - z0), a)
    if top > 60 and random.random() < 0.5:
        add_cyl(bms[k], (math.cos(a) * r, math.sin(a) * r, top), (math.cos(a) * r, math.sin(a) * r, top + 14), 0.4, 6)
        bmesh.ops.create_icosphere(bmr, subdivisions=1, radius=0.9, matrix=Matrix.Translation((math.cos(a) * r, math.sin(a) * r, top + 14.5)))
for k in range(2):
    box_uv(bms[k], 40.0)
    new_obj(f"Skyline_{k}", bms[k], tower_mats[k], "Background")
box_uv(bmr, 1.0); new_obj("Skyline_Beacons", bmr, red, "Background")
# streets far below (a dark plane with glow)
plane_obj("City_Ground", -400, 400, -400, 400, -80, material("M_CityGround", color=(0.02, 0.02, 0.03), emit=(0.25, 0.15, 0.06), emit_strength=0.4), "Background", tile=40)

court_anchors_and_collision([
    ("COL_Fence_South", (0, -FY, 2.1), (2 * FX, 0.1, 4.2)), ("COL_Fence_East", (FX, 0, 2.1), (0.1, 2 * FY, 4.2)), ("COL_Fence_West", (-FX, 0, 2.1), (0.1, 2 * FY, 4.2)),
])
finish(sun_color=(0.6, 0.7, 1.0), sun_energy=0.8, world_color=(0.02, 0.03, 0.06))
