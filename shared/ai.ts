// Bot brain. Produces the same PlayerInput a human would send.
import { COURT, HOOP, isBeyondArc } from "./constants";
import type { Game, SimPlayer } from "./game";
import { SHOT_DURATION, SHOT_TARGET } from "./game";
import { PlayerInput } from "./types";

const DIFF = {
  rookie: { sigma: 0.11, react: 0.4, steal: 0.12, contest: 0.55, iq: 0.45, bite: 0.6, slide: 0.3 },
  pro: { sigma: 0.065, react: 0.2, steal: 0.25, contest: 0.8, iq: 0.7, bite: 0.32, slide: 0.55 },
  legend: { sigma: 0.04, react: 0.12, steal: 0.35, contest: 0.95, iq: 0.9, bite: 0.12, slide: 0.8 },
};

function gauss(r: () => number) { return Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r()); }

export function botThink(g: Game, p: SimPlayer): PlayerInput {
  const d = DIFF[g.settings.difficulty] ?? DIFF.pro;
  const m = p.botMemory;
  const inp: PlayerInput = { ...p.prev, mx: 0, mz: 0, sprint: false, shoot: false, stance: false };
  const press = (k: "jump" | "pass" | "move" | "action" | "interact" | "j" | "k" | "l") => { inp[k] = p.prev[k] + 1; };
  const goTo = (x: number, z: number, sprint = false, slowR = 0.6) => {
    const dx = x - p.x, dz = z - p.z; const l = Math.hypot(dx, dz);
    if (l < 0.15) return true;
    const s = Math.min(1, l / slowR);
    inp.mx = (dx / l) * s; inp.mz = (dz / l) * s; inp.sprint = sprint && l > 2;
    return false;
  };
  const b = g.ball;
  const hasBall = b.holder === p.id;
  m.t = (m.t ?? 0) + 1 / 60;

  // ongoing shot: release at the planned time
  if (p.action === "jumpshot" || p.action === "layup") {
    if (m.faking && p.action === "jumpshot") { m.faking = false; inp.shoot = false; return inp; } // tap = pump fake
    if (m.releaseAt === undefined) {
      const kind = p.action;
      m.releaseAt = SHOT_TARGET[kind] * SHOT_DURATION[kind] + gauss(g.rand) * d.sigma * SHOT_DURATION[kind];
    }
    inp.shoot = p.actionT < m.releaseAt;
    return inp;
  }
  m.releaseAt = undefined;
  if (p.action === "dunk") { inp.shoot = true; return inp; }

  if (g.phase === "pregame" || g.phase === "gameover") return inp;
  if (g.phase === "dead") { return inp; }
  if (g.phase === "check") {
    if (hasBall && g.phaseT > 1.2) press("interact");
    return inp;
  }

  const opp = g.players.filter((q) => q.team !== p.team);
  const mates = g.players.filter((q) => q.team === p.team && q !== p);
  const handler = g.player(b.holder);
  const dRim = Math.hypot(HOOP.x - p.x, HOOP.z - p.z);

  // ---------------- loose ball / rebound
  if (!handler && (b.state === "loose" || b.state === "shot")) {
    const chasers = g.players.filter((q) => q.team === p.team).sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z));
    if (chasers[0] === p || Math.hypot(p.x - b.x, p.z - b.z) < 3) {
      // read where it will come down
      const lead = b.state === "shot" ? 0.35 : 0.2;
      goTo(b.x + b.vx * lead, b.z + b.vz * lead, true, 0.3);
      if (b.y > 2.1 && b.y < 3.4 && b.vy < 0 && Math.hypot(p.x - b.x, p.z - b.z) < 1.2 && !p.airborne && g.rand() < 0.3) press("jump");
      return inp;
    }
    goTo((HOOP.x + p.x) / 2, p.z * 0.6);
    return inp;
  }
  if (b.state === "pass") {
    if (b.passTarget === p.id) { goTo(b.x, b.z, false, 0.2); return inp; }
  }

  // ---------------- offense with the ball
  if (hasBall) {
    const def = opp.slice().sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
    const od = def ? Math.hypot(def.x - p.x, def.z - p.z) : 99;
    const toRimX = (HOOP.x - p.x) / (dRim || 1), toRimZ = (HOOP.z - p.z) / (dRim || 1);
    const defInFront = def ? ((def.x - p.x) * toRimX + (def.z - p.z) * toRimZ) / (od || 1) > 0.3 : false;
    const open = od > 1.9 || !defInFront || (def && def.stumbleT > 0);

    if (g.mustClear && g.isTeamMode) {
      const ang = Math.atan2(p.z - HOOP.z, p.x - HOOP.x);
      const r = COURT.threeRadius + 0.9;
      let tx = HOOP.x + Math.cos(ang) * r, tz = HOOP.z + Math.sin(ang) * r;
      tx = Math.max(1.5, Math.min(13, tx)); tz = Math.max(-6.8, Math.min(6.8, tz));
      if (isBeyondArc(p.x, p.z, 0.4)) { goTo(p.x - 0.5, p.z); } else goTo(tx, tz, p.stamina > 0.5);
      return inp;
    }

    m.decideT = (m.decideT ?? 0) - 1 / 60;
    if (m.decideT <= 0) {
      m.decideT = 0.2 + (1 - d.iq) * 0.25;
      const shooter = p.attrs.three > 0.8;
      const range = shooter ? 8.0 : p.attrs.mid > 0.68 ? 6.6 : 5.0;
      const late = g.isTeamMode && g.shotClock < 2.5;
      m.plan = "drive";
      if (dRim < 2.8 && (open || g.rand() < 0.5)) m.plan = "attack";
      else if ((open && dRim < range && g.rand() < 0.55 + d.iq * 0.3) || late) m.plan = "shoot";
      else if (def && od < 1.6 && defInFront && p.moveCd <= 0 && p.stamina > 0.3 && g.rand() < 0.35 + d.iq * 0.2) {
        const r = g.rand();
        m.plan = shooter && dRim < 8.5 && r < 0.3 ? "stepback" : r < 0.55 ? "jabdrive" : r < 0.75 && dRim < 8 ? "pumpfake" : "move";
      }
      else if (def && od < 2.4 && defInFront && dRim < 7.5 && p.moveCd <= 0 && g.rand() < 0.25) m.plan = "jabdrive";
      else if (mates.length && g.rand() < 0.22) {
        const openMate = mates.find((q) => opp.every((o) => Math.hypot(o.x - q.x, o.z - q.z) > 2.2));
        if (openMate) { m.plan = "pass"; m.passTo = openMate.id; }
      }
    }
    switch (m.plan) {
      case "shoot":
        inp.shoot = true; m.plan = "drive"; return inp;
      case "attack": {
        goTo(HOOP.x - toRimX * 0.3, HOOP.z - toRimZ * 0.3, true, 0.1);
        if (dRim < 3.0) inp.shoot = true;
        return inp;
      }
      case "move": {
        const side = g.rand() < 0.5 ? 1 : -1;
        inp.mx = -toRimZ * side; inp.mz = toRimX * side;
        // face is roughly toward the rim, so sideways input => crossover
        press("move"); m.plan = "drive"; m.decideT = 0.15; return inp;
      }
      case "stepback": press("action"); m.plan = "shoot"; m.decideT = 0.35; return inp;
      case "jabdrive": {
        // jab one way, then drive (same way or the other way)
        m.jab = m.jab ?? { side: g.rand() < 0.5 ? 1 : -1, t: 0, go: g.rand() < 0.5 ? 1 : -1 };
        m.jab.t += 1 / 60;
        const sx = -toRimZ, sz = toRimX;
        if (m.jab.t < 0.22) { inp.mx = sx * m.jab.side * 0.6; inp.mz = sz * m.jab.side * 0.6; return inp; }
        inp.mx = toRimX * 0.75 + sx * m.jab.side * m.jab.go * 0.65; inp.mz = toRimZ * 0.75 + sz * m.jab.side * m.jab.go * 0.65;
        press("l"); m.jab = undefined; m.plan = "attack"; m.decideT = 0.6; return inp;
      }
      case "pumpfake": {
        // tap shoot to fake, then attack if they bite
        m.pf = (m.pf ?? 0) + 1;
        if (m.pf === 1) { inp.shoot = true; m.faking = true; }
        if (m.pf > 12) { m.pf = 0; m.plan = def && def.airborne ? "jabdrive" : g.rand() < 0.5 ? "shoot" : "jabdrive"; }
        return inp;
      }
      case "pass": {
        const t = g.player(m.passTo);
        if (t) { inp.yaw = Math.atan2(t.z - p.z, t.x - p.x); inp.mx = 0; inp.mz = 0; press("pass"); }
        m.plan = "drive"; return inp;
      }
      default: {
        // drive along a lane that bends away from the defender
        let lx = toRimX, lz = toRimZ;
        if (def && defInFront && od < 2.5) {
          const sx = -toRimZ, sz = toRimX;
          const side = ((def.x - p.x) * sx + (def.z - p.z) * sz) > 0 ? -1 : 1;
          lx += sx * side * 0.9; lz += sz * side * 0.9;
        }
        const l = Math.hypot(lx, lz) || 1;
        inp.mx = lx / l; inp.mz = lz / l; inp.sprint = p.stamina > 0.45 && dRim > 3;
        // stay in bounds
        if (Math.abs(p.z) > COURT.halfWidth - 0.8) inp.mz -= Math.sign(p.z) * 0.8;
        return inp;
      }
    }
  }

  // ---------------- offense without the ball: space the floor, cut sometimes
  if (handler && handler.team === p.team) {
    const idx = mates.indexOf(handler) + (p.id < handler.id ? 0 : 1);
    const spots = [{ x: HOOP.x - 1.2, z: -6.7 }, { x: HOOP.x - 1.2, z: 6.7 }, { x: HOOP.x - 5.2, z: -4.8 }, { x: HOOP.x - 5.2, z: 4.8 }];
    m.cutT = (m.cutT ?? 3 + g.rand() * 3) - 1 / 60;
    let s = spots[(idx + (handler.z > 0 ? 0 : 1)) % spots.length];
    if (m.cutT < 0) { s = { x: HOOP.x - 1.6, z: p.z > 0 ? 0.8 : -0.8 }; if (m.cutT < -1.4) m.cutT = 3 + g.rand() * 4; }
    if (g.mustClear) s = { x: HOOP.x - 7.6, z: p.z > 0 ? 3.5 : -3.5 };
    goTo(s.x, s.z, m.cutT < 0);
    return inp;
  }

  // ---------------- defense
  const man = g.player(p.guard) ?? handler ?? opp[0];
  if (!man) return inp;
  const onBall = handler && handler === man;
  const gap = onBall ? 0.95 + (1 - d.iq) * 0.3 : 2.0;
  const mx = man.x, mz = man.z;
  const mdx = HOOP.x - mx, mdz = HOOP.z - mz; const ml = Math.hypot(mdx, mdz) || 1;
  const tx = mx + (mdx / ml) * Math.min(gap, ml * 0.6), tz = mz + (mdz / ml) * Math.min(gap, ml * 0.6);
  // react with a delay to where the attacker is heading
  m.reactT = (m.reactT ?? 0) - 1 / 60;
  if (m.reactT <= 0 || m.tx === undefined) { m.tx = tx + man.vx * d.react * 0.4; m.tz = tz + man.vz * d.react * 0.4; m.reactT = d.react * 0.5; }
  goTo(m.tx, m.tz, Math.hypot(m.tx - p.x, m.tz - p.z) > 3, 0.4);
  const dist = Math.hypot(man.x - p.x, man.z - p.z);
  if (onBall && dist < 3.2) inp.stance = true;
  // contest shots
  if (onBall && (man.action === "jumpshot" || man.action === "layup" || man.action === "dunk") && dist < 2.4) {
    m.contestT = m.contestT ?? d.react * (0.8 + g.rand() * 0.6);
    m.contestT -= 1 / 60;
    if (m.contestT <= 0 && !p.airborne && g.rand() < d.contest) { press("jump"); m.contestT = 99; }
  } else m.contestT = undefined;
  // read the drive: slide to beat them to the spot
  if (onBall && man.action === "drive" && man.actionT < 0.45 && dist < 3.5) {
    m.slideT = m.slideT ?? d.react * (0.6 + g.rand() * 0.6);
    m.slideT -= 1 / 60;
    if (m.slideT <= 0) {
      if (g.rand() < d.slide) { const tx = man.x + man.vx * 0.3 - p.x, tz = man.z + man.vz * 0.3 - p.z; inp.mx = tx; inp.mz = tz; press("k"); } // beat him to the spot
      m.slideT = 99;
    }
  } else m.slideT = undefined;
  // bite on pump fakes (better defenders bite less)
  if (onBall && man.action === "pumpfake" && man.actionT < 0.12 && dist < 2.4 && !p.airborne && !m.bitTried) {
    m.bitTried = true;
    if (g.rand() < d.bite) press("jump");
  }
  if (man.action !== "pumpfake") m.bitTried = false;
  // steals
  if (onBall && dist < 1.25 && p.stealCd <= 0 && man.action !== "jumpshot" && g.rand() < d.steal / 60 * 2.2) press("action");
  return inp;
}
