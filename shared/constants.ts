// COURTSIDE — shared constants. World units are meters, Y is up.
// The court center is the origin. The gameplay hoop is at +X (half-court games).
// These numbers match the Blender scene (blender/build_the_block.py).

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const G = 9.81;

export const COURT = {
  halfLength: 14, // baseline at x = 14
  halfWidth: 7.5, // sidelines at z = ±7.5
  threeRadius: 6.75,
  threeCornerZ: 6.6,
  keyHalfWidth: 2.45,
  ftLineX: 14 - 5.8,
};

export const HOOP = {
  x: 12.425,
  y: 3.05,
  z: 0,
  rimRadius: 0.2325, // to the center of the rim tube
  rimTube: 0.01,
  innerRadius: 0.225,
  boardX: 12.8, // front face of the backboard
  boardThick: 0.04,
  boardHalfW: 0.9,
  boardBottom: 2.9,
  boardTop: 3.95,
  poleX: 15.2,
  poleRadius: 0.12,
  poleTop: 3.55,
};

export const BALL = {
  radius: 0.12,
  floorRestitution: 0.78,
  rimRestitution: 0.52,
  boardRestitution: 0.62,
  rollFriction: 1.2,
};

export const FENCE = { x: 17.5, z: 12.0 };

export const PLAYER = {
  radius: 0.36,
  height: 1.95,
  runSpeed: 4.9,
  sprintSpeed: 6.9,
  stanceSpeed: 3.4,
  dribbleMult: 0.94,
  accel: 26,
  decel: 30,
  jumpVel: 3.8,
  reachStanding: 2.05, // hand height for loose balls while standing
  reachJumping: 2.75, // extra for arms-up when jumping
  boundsMinX: -1.5,
  boundsMaxX: 15.6,
  boundsZ: 8.6,
  staminaSprintDrain: 0.13,
  staminaRegen: 0.17,
};

// Positions used by the match flow
export const SPOTS = {
  check: { x: HOOP.x - 7.7, z: 0 },
  checkDefense: { x: HOOP.x - 5.9, z: 0 },
};

export const MATCH = {
  target: 11,
  winBy: 1, // first to the target wins
  cap: 15,
  shotClock: 12,
  shotClockTeam: 14,
  timeLimit: 10 * 60,
  deadTime: 1.8,
  checkTime: 1.6,
};

export const SHOOTOUT = { duration: 60, spots: 5, ballsPerSpot: 5 };
export const DUNK_CONTEST = { attempts: 5, duration: 120 };

export type Mode = "1v1" | "2v2" | "3v3" | "shootout" | "dunk" | "free";
export const TEAM_MODES: Mode[] = ["1v1", "2v2", "3v3"];
export const MODE_INFO: Record<Mode, { label: string; size: number; desc: string }> = {
  "1v1": { label: "1V1 SHOWDOWN", size: 1, desc: "First to 11. Make it, take it. 2s and 3s." },
  "2v2": { label: "2V2 DUOS", size: 2, desc: "First to 16. Two-man game." },
  "3v3": { label: "3V3 PARK", size: 3, desc: "First to 16. Run it with your squad." },
  shootout: { label: "SHOOTOUT", size: 1, desc: "60 seconds. 5 racks. Money ball is worth 2." },
  dunk: { label: "DUNK CONTEST", size: 1, desc: "5 attempts. Style, timing and speed score points." },
  free: { label: "SHOOTAROUND", size: 6, desc: "Warm up. No score, no pressure." },
};

/** Point value of a shot taken from (x, z): 2 beyond the arc, 1 inside (street scoring). */
/** Point value of a shot taken from (x, z): 3 beyond the arc, 2 inside. */
export function shotValueAt(x: number, z: number): 2 | 3 {
  const dx = x - HOOP.x;
  const d = Math.hypot(dx, z - HOOP.z);
  if (Math.abs(z) >= COURT.threeCornerZ && x > HOOP.x - 1.6) return 3;
  return d > COURT.threeRadius ? 3 : 2;
}

export function isBeyondArc(x: number, z: number, margin = 0.15): boolean {
  const d = Math.hypot(x - HOOP.x, z - HOOP.z);
  if (Math.abs(z) >= COURT.threeCornerZ + margin && x > HOOP.x - 1.6) return true;
  return d > COURT.threeRadius + margin;
}

export function inHalfCourt(x: number, z: number): boolean {
  return x >= 0 && x <= COURT.halfLength && Math.abs(z) <= COURT.halfWidth;
}
