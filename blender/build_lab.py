"""COURTSIDE — THE LAB: an indoor training facility.
Run: python build_lab.py <texture_dir> <out_blend> <out_glb>
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from courtkit import *  # noqa: F401,F403

random.seed(12)
wood = material("M_Hardwood", tex="wood_col.png", nrm="wood_nrm.png", rough=0.35)
wood_dark = material("M_HardwoodDark", tex="wood_col.png", color=(0.45, 0.32, 0.22), rough=0.4)
key = material("M_LabKey", color=(0.07, 0.07, 0.08), rough=0.35)
wall = material("M_LabWall", color=(0.42, 0.42, 0.43), tex="concrete_col.png", rough=0.85)
pad = material("M_WallPad", color=(0.1, 0.1, 0.11), rough=0.8)
ceil = material("M_Ceiling", color=(0.06, 0.06, 0.07), rough=0.9)
panel = material("M_LightPanel", color=(1, 1, 1), emit=(1.0, 0.98, 0.94), emit_strength=6.0)
daylight = material("M_ClerestoryGlass", color=(0.7, 0.8, 0.9), emit=(0.65, 0.78, 0.95), emit_strength=2.5)
net_curtain = material("M_ChainLinkCurtain", tex="chainlink_rgba.png", alpha_tex=True, color=(0.08, 0.08, 0.09), rough=0.9, double=True)
banners = {k: material(f"M_Banner_{k}", tex=f"{f}.png", rough=0.8) for k, f in (("lab", "banner_lab"), ("nodays", "banner_nodays"), ("work", "banner_work"))}
score_m = material("M_Scoreboard", tex="scoreboard.png", emit_tex="scoreboard.png", emit_strength=3.0)
rubber = material("M_RubberMat", color=(0.12, 0.12, 0.13), rough=0.95)
iron = material("M_Iron", color=(0.15, 0.15, 0.16), metal=0.8, rough=0.4)
cone = material("M_Cone", color=(1.0, 0.4, 0.05), rough=0.6)

for nm, mat in (("Court_Surface", wood), ("Court_Apron", wood_dark), ("Court_Key_East", key), ("Court_Key_West", key)):
    bpy.data.objects[nm].data.materials[0] = mat
# nylon nets indoors
M["chain"].node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.0
M["chain"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.95, 0.95, 0.95, 1)
M["chain"].name = "M_NylonNet"
g = bpy.data.objects["Ground_Asphalt"]; bpy.data.objects.remove(g)

RX, RY, H = 23.0, 17.0, 11.0
plane_obj("Floor", -RX, RX, -RY, RY, -0.001, wood_dark, "Environment", tile=4.0)
# walls (inward facing) and ceiling
for nm, p0, p1 in [("Wall_N", (RX, RY), (-RX, RY)), ("Wall_S", (-RX, -RY), (RX, -RY)), ("Wall_E", (RX, -RY), (RX, RY)), ("Wall_W", (-RX, RY), (-RX, -RY))]:
    wall_quad(nm, p0, p1, 0, H, wall, "Environment", uv_tile=4.0)
bm = bmesh.new(); add_box(bm, (0, 0, H + 0.1), (2 * RX, 2 * RY, 0.2)); box_uv(bm, 4.0); new_obj("Ceiling", bm, ceil, "Environment")
# clerestory windows (glowing daylight strips)
for nm, p0, p1 in [("Clerestory_N", (RX - 1, RY - 0.02), (-RX + 1, RY - 0.02)), ("Clerestory_S", (-RX + 1, -RY + 0.02), (RX - 1, -RY + 0.02))]:
    wall_quad(nm, p0, p1, H - 2.2, H - 0.8, daylight, "Environment", uv_full=True)
# steel trusses + light panels
bm, bml = bmesh.new(), bmesh.new()
for x in range(-20, 21, 5):
    add_box(bm, (x, 0, H - 0.4), (0.25, 2 * RY, 0.5))
    for y in (-10, -5, 0, 5, 10):
        add_box(bml, (x + 2.5, y, H - 0.7), (1.8, 0.6, 0.05)) if x < 20 else None
box_uv(bm, 1.0); box_uv(bml, 1.0)
new_obj("Trusses", bm, iron, "Environment"); new_obj("Light_Panels", bml, panel, "Lighting")
for i, (x, y) in enumerate([(-10, -6), (-10, 6), (2, -6), (2, 6), (10, -4), (10, 4)]):
    flood_anchor(i, x, y, H - 0.9)
# wall pads behind the hoops and the divider curtains (match the game's ball boundary)
for sx in (1, -1):
    wall_quad(f"WallPad_{sx}", (sx * (RX - 0.05), -6 * sx), (sx * (RX - 0.05), 6 * sx), 0, 2.4, pad, "Decorations", uv_tile=2.0)
for nm, a, b in [("Curtain_E", (FX, -FY), (FX, FY)), ("Curtain_W", (-FX, FY), (-FX, -FY)), ("Curtain_S", (-FX, -FY), (FX, -FY)), ("Curtain_N", (FX, FY), (-FX, FY))]:
    wall_quad(nm, a, b, 0, 5.0, net_curtain, "Environment", uv_tile=0.8)
bm = bmesh.new()
for (a, b) in [((FX, -FY), (FX, FY)), ((-FX, FY), (-FX, -FY)), ((-FX, -FY), (FX, -FY)), ((FX, FY), (-FX, FY))]:
    add_cyl(bm, (*a, 5.0), (*b, 5.0), 0.04, 6)
box_uv(bm, 1.0); new_obj("Curtain_Rails", bm, iron, "Environment")
# banners + scoreboard
wall_quad("Banner_Lab", (RX - 0.03, 7.5), (RX - 0.03, -7.5), 3.6, 11.1 - 2.6, banners["lab"], "Decorations", uv_full=True)
wall_quad("Banner_NoDays", (-14, RY - 0.03), (-26 + 18, RY - 0.03), 4.0, 6.0, banners["nodays"], "Decorations", uv_full=True)
wall_quad("Banner_Work", (14, -RY + 0.03), (4, -RY + 0.03), 4.0, 6.0, banners["work"], "Decorations", uv_full=True)
make_box_obj("Scoreboard_Box", (0, RY - 0.3, 7.0), (5.2, 0.5, 2.7), iron, "Decorations", tile=1.0)
wall_quad("Scoreboard_Face", (2.5, RY - 0.56), (-2.5, RY - 0.56), 5.8, 8.2, score_m, "Decorations", uv_full=True)
# training gear: racks, cones, weights, mats
bm = bmesh.new()
for (rx, ry) in [(-16, 15.3), (16, 15.3)]:
    add_box(bm, (rx, ry, 0.5), (1.2, 0.04, 0.04)); add_box(bm, (rx, ry, 0.9), (1.2, 0.04, 0.04))
    for dx in (-0.6, 0.6):
        add_box(bm, (rx + dx, ry, 0.5), (0.04, 0.04, 1.0))
box_uv(bm, 1.0); new_obj("BallRacks", bm, M["steel"], "Props")
for i, (dx, dz) in enumerate([(-0.4, 0.62), (-0.13, 0.62), (0.14, 0.62), (0.41, 0.62), (-0.27, 1.02), (0.0, 1.02), (0.27, 1.02)]):
    ob = bpy.data.objects.new(f"Basketball_Rack{i}", ball_me); ob.location = (-16 + dx, 15.15, dz); COLL["Props"].objects.link(ob)
loose_ball("Basketball_Loose0", -15.3, -9.8); loose_ball("Basketball_Loose1", 4.0, 13.2)
bm = bmesh.new()
for i in range(8):
    x = -12 + i * 1.5
    add_cyl(bm, (x, 13.6, 0), (x, 13.6, 0.45), 0.14, 10, r2=0.02)
box_uv(bm, 1.0); new_obj("Cones", bm, cone, "Props")
make_box_obj("Mat_Area", (-19.5, -12, 0.015), (6, 8, 0.03), rubber, "Props", tile=1.0)
bm = bmesh.new()
for k in range(5):
    y = -15 + k * 1.6
    add_cyl(bm, (-21.8, y, 0.5), (-20.2, y, 0.5), 0.02, 8)
    for x in (-21.6, -20.4):
        add_cyl(bm, (x, y, 0.3), (x, y, 0.7), 0.18, 12)
add_box(bm, (-21, -11.8, 0.3), (2.0, 7.0, 0.05))
box_uv(bm, 1.0); new_obj("Dumbbell_Rack", bm, iron, "Props")
bench("Bench_A", 2.5, 13.2); bench("Bench_B", 8.0, 13.2)
bleacher("Bleachers_A", -9.0, -1.0, -12.8); bleacher("Bleachers_B", 1.5, 9.5, -12.8)

court_anchors_and_collision([
    ("COL_Curtain_E", (FX, 0, 2.5), (0.1, 2 * FY, 5.0)), ("COL_Curtain_W", (-FX, 0, 2.5), (0.1, 2 * FY, 5.0)),
    ("COL_Curtain_S", (0, -FY, 2.5), (2 * FX, 0.1, 5.0)), ("COL_Curtain_N", (0, FY, 2.5), (2 * FX, 0.1, 5.0)),
])
finish(sun_color=(1, 1, 1), sun_energy=1.0, world_color=(0.1, 0.1, 0.11))
