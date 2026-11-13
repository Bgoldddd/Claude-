import { BALL, FENCE, G, HOOP } from "./constants";

export type BallState = "held" | "shot" | "pass" | "loose" | "dead";

export interface Ball {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  state: BallState;
  holder: string | null;
  // flight info
  shooter: string | null;
  shotValue: number;
  shotKind: string;
  shotTime: number; // seconds since release
  touchedRim: boolean;
  touchedBoard: boolean;
  passer: string | null;
  passTarget: string | null;
  lastTouch: string | null;
  lastTouchTeam: number;
  noPickup: string | null; // player that cannot grab it right now
  noPickupT: number;
  inNet: number; // time spent inside the net (for net drag)
}

export const newBall = (): Ball => ({
  x: 4.8, y: 1.0, z: 0, vx: 0, vy: 0, vz: 0, state: "dead", holder: null,
  shooter: null, shotValue: 1, shotKind: "jumpshot", shotTime: 0, touchedRim: false, touchedBoard: false,
  passer: null, passTarget: null, lastTouch: null, lastTouchTeam: -1, noPickup: null, noPickupT: 0, inNet: 0,
});

export interface BallStepResult {
  scored: boolean;
  rimHits: { v: number }[];
  boardHit: number; // impact speed, 0 if none
  floorHit: number; // impact speed, 0 if none
  netTouch: boolean;
}

const R = BALL.radius;

/**
 * Advance a free ball (shot, pass or loose) by dt seconds with substeps.
 * Handles gravity, drag, floor, backboard, rim (torus), pole and fence collisions,
 * the chain net slowdown, and downward passage through the rim (a made basket).
 */
export function stepBall(b: Ball, dt: number): BallStepResult {
  const res: BallStepResult = { scored: false, rimHits: [], boardHit: 0, floorHit: 0, netTouch: false };
  const sub = 6;
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    const prevY = b.y;
    const prevHx = b.x - HOOP.x, prevHz = b.z - HOOP.z;
    // integrate
    b.vy -= G * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;

    // ---- rim: torus in the XZ plane
    {
      const dx = b.x - HOOP.x, dz = b.z - HOOP.z, dy = b.y - HOOP.y;
      const hd = Math.hypot(dx, dz);
      if (Math.abs(dy) < R + 0.05 && hd > HOOP.rimRadius - R - 0.05 && hd < HOOP.rimRadius + R + 0.05) {
        const ux = hd > 1e-6 ? dx / hd : 1, uz = hd > 1e-6 ? dz / hd : 0;
        const cx = HOOP.x + ux * HOOP.rimRadius, cz = HOOP.z + uz * HOOP.rimRadius;
        let nx = b.x - cx, ny = b.y - HOOP.y, nz = b.z - cz;
        const d = Math.hypot(nx, ny, nz);
        const minD = R + HOOP.rimTube;
        if (d < minD && d > 1e-6) {
          nx /= d; ny /= d; nz /= d;
          b.x += nx * (minD - d); b.y += ny * (minD - d); b.z += nz * (minD - d);
          const vn = b.vx * nx + b.vy * ny + b.vz * nz;
          if (vn < 0) {
            const e = BALL.rimRestitution;
            b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; b.vz -= (1 + e) * vn * nz;
            // tangential friction
            b.vx *= 0.9; b.vz *= 0.9;
            res.rimHits.push({ v: -vn });
            b.touchedRim = true;
          }
        }
      }
    }

    // ---- backboard (axis-aligned box)
    {
      const x0 = HOOP.boardX, x1 = HOOP.boardX + HOOP.boardThick;
      const cx = Math.max(x0, Math.min(b.x, x1));
      const cy = Math.max(HOOP.boardBottom, Math.min(b.y, HOOP.boardTop));
      const cz = Math.max(-HOOP.boardHalfW, Math.min(b.z, HOOP.boardHalfW));
      let nx = b.x - cx, ny = b.y - cy, nz = b.z - cz;
      const d = Math.hypot(nx, ny, nz);
      if (d < R) {
        if (d < 1e-6) { nx = -1; ny = 0; nz = 0; } else { nx /= d; ny /= d; nz /= d; }
        const push = R - (d < 1e-6 ? 0 : d);
        b.x += nx * push; b.y += ny * push; b.z += nz * push;
        const vn = b.vx * nx + b.vy * ny + b.vz * nz;
        if (vn < 0) {
          const e = BALL.boardRestitution;
          b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; b.vz -= (1 + e) * vn * nz;
          b.vy *= 0.95; b.vz *= 0.95;
          res.boardHit = Math.max(res.boardHit, -vn);
          b.touchedBoard = true;
        }
      }
    }

    // ---- pole (vertical cylinder behind the baseline) + arm
    {
      const dx = b.x - HOOP.poleX, dz = b.z;
      const d = Math.hypot(dx, dz);
      if (b.y < HOOP.poleTop && d < HOOP.poleRadius + R) {
        const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
        b.x = HOOP.poleX + nx * (HOOP.poleRadius + R); b.z = nz * (HOOP.poleRadius + R);
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; }
      }
    }

    // ---- made basket: center crosses the rim plane going down, inside the cylinder
    if (prevY >= HOOP.y && b.y < HOOP.y && b.vy < 0) {
      const hd0 = Math.hypot(prevHx, prevHz);
      const hd1 = Math.hypot(b.x - HOOP.x, b.z - HOOP.z);
      if (Math.min(hd0, hd1) < HOOP.innerRadius - 0.02) res.scored = true;
    }

    // ---- chain net: slows the ball while it is inside it
    {
      const hd = Math.hypot(b.x - HOOP.x, b.z - HOOP.z);
      if (b.y < HOOP.y && b.y > HOOP.y - 0.45 && hd < HOOP.innerRadius) {
        const k = Math.pow(0.04, h); // strong damping
        b.vx *= k; b.vz *= k;
        if (b.vy < -2.5) b.vy *= Math.pow(0.2, h);
        // keep it centered in the net
        b.vx += (HOOP.x - b.x) * 20 * h; b.vz += (HOOP.z - b.z) * 20 * h;
        b.inNet += h;
        res.netTouch = true;
      }
    }

    // ---- floor
    if (b.y < R) {
      b.y = R;
      if (b.vy < 0) {
        const impact = -b.vy;
        if (impact > 0.6) res.floorHit = Math.max(res.floorHit, impact);
        // restitution drops at low impact speeds so the ball settles naturally
        const e = BALL.floorRestitution * Math.min(1, 0.62 + impact * 0.12);
        b.vy = impact > 0.6 ? impact * e : 0;
        b.vx *= 0.9; b.vz *= 0.9;
      }
      if (b.vy === 0) {
        const sp = Math.hypot(b.vx, b.vz);
        if (sp > 0) {
          const ns = Math.max(0, sp - BALL.rollFriction * h);
          b.vx *= ns / sp; b.vz *= ns / sp;
        }
      }
    }

    // ---- fence
    if (Math.abs(b.x) > FENCE.x - R) { b.x = Math.sign(b.x) * (FENCE.x - R); b.vx *= -0.35; }
    if (Math.abs(b.z) > FENCE.z - R) { b.z = Math.sign(b.z) * (FENCE.z - R); b.vz *= -0.35; }
  }
  return res;
}

export interface LaunchOpts { arc: number } // apex height above the higher endpoint

/** Velocity that takes the ball from (x0,y0,z0) to (tx,ty,tz) along a gravity arc with the given apex lift. */
export function solveLaunch(x0: number, y0: number, z0: number, tx: number, ty: number, tz: number, arc: number) {
  const apex = Math.max(y0, ty) + Math.max(0.15, arc);
  const vy = Math.sqrt(2 * G * (apex - y0));
  const tUp = vy / G;
  const tDown = Math.sqrt((2 * (apex - ty)) / G);
  const t = tUp + tDown;
  return { vx: (tx - x0) / t, vy, vz: (tz - z0) / t, t };
}
