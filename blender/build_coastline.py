"""COURTSIDE — COASTLINE: a beachside court with an ocean view, daytime.
Run: python build_coastline.py <texture_dir> <out_blend> <out_glb>
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from courtkit import *  # noqa: F401,F403

random.seed(55)
sand = material("M_Sand", tex="sand_col.png", rough=0.95)
pad = material("M_CoastCourt", color=(0.92, 0.88, 0.8), tex="concrete_col.png", rough=0.7)
apron = material("M_CoastApron", color=(0.06, 0.36, 0.42), rough=0.6)
ocean = material("M_Ocean", color=(0.02, 0.22, 0.33), metal=0.2, rough=0.08)
foam = material("M_Foam", color=(0.95, 0.97, 0.98), rough=0.6)
wood = material("M_Boardwalk", tex="wood_col.png", color=(0.75, 0.62, 0.5), rough=0.8)
trunk = material("M_PalmTrunk", color=(0.42, 0.3, 0.2), rough=0.9)
leaf = material("M_PalmLeaf", color=(0.16, 0.42, 0.14), rough=0.8, double=True)
red = material("M_LifeguardRed", color=(0.75, 0.12, 0.08), rough=0.6)
coast_sign = material("M_CoastSign", tex="sign_coast.png", rough=0.6)
hill = material("M_Headland", color=(0.33, 0.4, 0.22), rough=0.95)
cloth = [material(f"M_Umbrella{i}", color=c, rough=0.8, double=True) for i, c in enumerate([(0.85, 0.35, 0.1), (0.05, 0.55, 0.6), (0.95, 0.85, 0.3)])]

for nm, mat in (("Court_Surface", pad), ("Court_Apron", apron)):
    bpy.data.objects[nm].data.materials[0] = mat
g = bpy.data.objects["Ground_Asphalt"]; g.data.materials[0] = sand
# raised concrete pad edge under the apron
bm = bmesh.new(); add_box(bm, (0, 0, -0.06), (2 * CX + 7, 2 * CY + 7.4, 0.12)); box_uv(bm, 2.0)
new_obj("Court_Pad", bm, M["curb"], "Court")
# ocean + foam line (beach slopes toward -Y)
plane_obj("Ocean", -400, 400, -600, -34, -0.25, ocean, "Background", tile=20)
bm = bmesh.new()
for i in range(60):
    x = -200 + i * 7
    add_box(bm, (x, -34 + math.sin(i * 0.7) * 1.2, -0.2), (7.2, 1.2 + random.random(), 0.05))
box_uv(bm, 2.0); new_obj("Ocean_Foam", bm, foam, "Background")
# boardwalk on the land side
bm = bmesh.new(); add_box(bm, (0, 17.5, 0.25), (90, 5, 0.5)); box_uv(bm, 3.0)
new_obj("Boardwalk", bm, wood, "Environment")
bm = bmesh.new()
for x in range(-44, 46, 4):
    add_cyl(bm, (x, 19.9, 0.5), (x, 19.9, 1.5), 0.06, 8)
add_cyl(bm, (-44, 19.9, 1.45), (44, 19.9, 1.45), 0.05, 8)
box_uv(bm, 1.0); new_obj("Boardwalk_Rail", bm, wood, "Environment")
# shops along the boardwalk (low, colorful)
for i, x in enumerate(range(-40, 41, 16)):
    col = [(0.95, 0.9, 0.8), (0.55, 0.78, 0.82), (0.95, 0.7, 0.5), (0.85, 0.85, 0.75), (0.6, 0.75, 0.6), (0.9, 0.82, 0.6)][i % 6]
    m = material(f"M_Shop{i}", color=col, rough=0.8)
    make_box_obj(f"Shop_{i}", (x, 26, 2.5), (12, 8, 5), m, "Background", tile=3.0)
    make_box_obj(f"Shop_{i}_Awning", (x, 21.6, 3.2), (10, 1.2, 0.12), cloth[i % 3], "Background", tile=1.0)
    bm = bmesh.new(); add_box(bm, (x, 21.95, 1.8), (8.5, 0.05, 2.0)); box_uv(bm, 1.0); new_obj(f"Shop_{i}_Window", bm, material(f"M_ShopGlass{i}", color=(0.3, 0.45, 0.5), metal=0.5, rough=0.1), "Background")
# headlands in the distance
bm = bmesh.new()
for (x, y, s) in [(-170, -120, 60), (190, -90, 75), (-230, 60, 90), (240, 120, 80)]:
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1, matrix=Matrix.Translation((x, y, -s * 0.55)) @ Matrix.Diagonal((s * 1.6, s, s, 1)))
box_uv(bm, 20.0); new_obj("Headlands", bm, hill, "Background")


def palm(name, x, y, h, lean):
    bmt, bml = bmesh.new(), bmesh.new()
    pts = []
    for i in range(9):
        t = i / 8
        pts.append(Vector((x + lean[0] * t * t * h * 0.25, y + lean[1] * t * t * h * 0.25, t * h)))
    for a, b in zip(pts, pts[1:]):
        add_cyl(bmt, a, b, 0.22 - 0.1 * (b.z / h), 8)
    top = pts[-1]
    for k in range(9):
        ang = k / 9 * math.tau + random.uniform(-0.2, 0.2)
        tip = top + Vector((math.cos(ang) * 3.2, math.sin(ang) * 3.2, -1.4 - random.random()))
        mid = top.lerp(tip, 0.5) + Vector((0, 0, 0.6))
        for p0, p1, w0, w1 in ((top, mid, 0.05, 0.5), (mid, tip, 0.5, 0.05)):
            d = p1 - p0
            side = d.cross(Vector((0, 0, 1))).normalized()
            v = [bml.verts.new(p0 + side * w0), bml.verts.new(p1 + side * w1), bml.verts.new(p1 - side * w1), bml.verts.new(p0 - side * w0)]
            bml.faces.new(v)
    bmesh.ops.create_icosphere(bmt, subdivisions=1, radius=0.35, matrix=Matrix.Translation(top))
    box_uv(bmt, 1.0); box_uv(bml, 1.0)
    new_obj(name + "_Trunk", bmt, trunk, "Decorations"); new_obj(name + "_Leaves", bml, leaf, "Decorations")


for i, (x, y) in enumerate([(-21, 14), (-12, 15), (11, 15), (21, 13.5), (-24, -14), (24, -15), (-30, 4), (30, -3)]):
    palm(f"Palm_{i}", x, y, random.uniform(7, 10), (random.uniform(-1, 1), random.uniform(-1, 1)))

# lifeguard tower
bm = bmesh.new()
lx, ly = -22, -24
for dx in (-1.2, 1.2):
    for dy in (-1.2, 1.2):
        add_cyl(bm, (lx + dx, ly + dy, 0), (lx + dx * 0.8, ly + dy * 0.8, 3.0), 0.1, 6)
add_box(bm, (lx, ly, 3.1), (2.8, 2.8, 0.2)); add_cyl(bm, (lx + 1.6, ly + 1.8, 0), (lx + 1.0, ly + 1.0, 3.0), 0.06, 6)
box_uv(bm, 1.0); new_obj("Lifeguard_Frame", bm, wood, "Decorations")
make_box_obj("Lifeguard_Hut", (lx, ly, 4.1), (2.4, 2.4, 1.8), material("M_LifeguardWall", color=(0.95, 0.93, 0.88), rough=0.7), "Decorations", tile=1.0)
make_box_obj("Lifeguard_Roof", (lx, ly, 5.1), (3.0, 3.0, 0.2), red, "Decorations", tile=1.0)
# umbrellas & surfboards
for i, (x, y) in enumerate([(10, -22), (16, -25), (-8, -25), (26, -22)]):
    bm = bmesh.new(); add_cyl(bm, (x, y, 0), (x, y, 2.4), 0.03, 6); box_uv(bm, 1.0); new_obj(f"Umbrella_{i}_Pole", bm, M["aluminum"], "Decorations")
    bm = bmesh.new(); add_cyl(bm, (x, y, 2.0), (x, y, 2.6), 1.4, 12, r2=0.05, cap=False); box_uv(bm, 1.0); new_obj(f"Umbrella_{i}", bm, cloth[i % 3], "Decorations")
for i, x in enumerate([-15.5, -14.6, -13.7]):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1, matrix=Matrix.Translation((x, FY + 0.35, 1.05)) @ Matrix.Rotation(-0.25, 4, 'X') @ Matrix.Diagonal((0.28, 0.05, 1.05, 1)))
    box_uv(bm, 1.0); new_obj(f"Surfboard_{i}", bm, cloth[i % 3], "Decorations")

# court: shorter fence, sign, seating
GATE = (-7.0, -3.0)
for nm, a, b in [("Fence_South", (-FX, -FY), (FX, -FY)), ("Fence_East", (FX, -FY), (FX, FY)), ("Fence_West", (-FX, FY), (-FX, -FY)),
                 ("Fence_NorthA", (FX, FY), (GATE[1], FY)), ("Fence_NorthB", (GATE[0], FY), (-FX, FY))]:
    fence_run(nm, a, b, 2.6)
bm = bmesh.new()
for y in (-5.5, 5.5):
    add_cyl(bm, (FX + 1.2, y, 0), (FX + 1.2, y, 5.6), 0.1, 10)
box_uv(bm, 1.0); new_obj("Sign_Posts", bm, wood, "Decorations")
make_box_obj("Sign_Board", (FX + 1.25, 0, 4.6), (0.1, 11.4, 2.0), M["sign"], "Decorations", tile=1.0)
wall_quad("Sign_Coast", (FX + 1.19, 5.5), (FX + 1.19, -5.5), 3.75, 5.45, coast_sign, "Decorations", uv_full=True)
bleacher("Bleachers_A", -9.0, -1.0, -8.6); bleacher("Bleachers_B", 1.5, 9.5, -8.6)
bench("Bench_A", 2.5, 9.6); bench("Bench_B", 8.0, 9.6)
trash_can("TrashCan_A", 12.0, 10.6)
loose_ball("Basketball_Loose0", -15.3, -9.8); loose_ball("Basketball_Loose1", 15.9, 10.6)
for i, (x, y) in enumerate([(-FX + 0.5, -FY + 0.5), (FX - 0.5, -FY + 0.5), (-FX + 0.5, FY - 0.5), (FX - 0.5, FY - 0.5)]):
    flood_anchor(i, x, y, 6.0)

court_anchors_and_collision([
    ("COL_Fence_South", (0, -FY, 1.3), (2 * FX, 0.1, 2.6)), ("COL_Fence_East", (FX, 0, 1.3), (0.1, 2 * FY, 2.6)), ("COL_Fence_West", (-FX, 0, 1.3), (0.1, 2 * FY, 2.6)),
])
finish(sun_color=(1.0, 0.96, 0.88), sun_energy=4.0, world_color=(0.55, 0.75, 0.95))
