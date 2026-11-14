// COURTSIDE — authoritative game simulation.
// Pure TypeScript, no DOM, no network. The server runs it for real matches;
// the browser runs the same code for offline practice.

import { Ball, newBall, solveLaunch, stepBall } from "./ball";
import {
  COURT, DT, DUNK_CONTEST, HOOP, MATCH, Mode, PLAYER, SHOOTOUT, SPOTS, isBeyondArc, shotValueAt,
} from "./constants";
import { ARCHETYPES } from "./progression";
import {
  Action, Archetype, Attributes, GameEvent, MatchResult, MatchSettings, Phase, PlayerInput, PlayerSetup,
  PlayerSnap, PlayerStats, ShotTiming, Snapshot, TeamId, emptyInput, emptyStats,
} from "./types";
import { botThink } from "./ai";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const MOVE_ACTIONS: Action[] = ["cross", "btl", "btb", "hesi", "stepback", "spin", "drive", "jab"];

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SHOT_DURATION: Record<string, number> = { jumpshot: 0.95, layup: 0.62, dunk: 0.6 };
export const SHOT_TARGET: Record<string, number> = { jumpshot: 0.78, layup: 0.72, dunk: 0.7 };
// timing windows in meter fraction (meter fills over SHOT_DURATION seconds)
export const WINDOWS = { perfect: 0.045, excellent: 0.085, good: 0.14 };

/** Contest level labels, from 0 (nobody close) to 1 (smothered). */
export function contestLabel(c: number) {
  if (c < 0.15) return "WIDE OPEN";
  if (c < 0.35) return "OPEN";
  if (c < 0.6) return "CONTESTED";
  if (c < 0.8) return "HEAVILY CONTESTED";
  return "SMOTHERED";
}

/** The green window shrinks as the contest gets heavier (down to 45% of its size). */
export const greenScale = (contest: number) => Math.max(0.45, 1 - contest * 0.6);

export function gradeTiming(meter: number, target: number, kind: string, contest = 0): ShotTiming {
  const scale = kind === "layup" ? 1.4 : 1;
  const d = meter - target;
  const a = Math.abs(d);
  if (a <= WINDOWS.perfect * scale * greenScale(contest)) return "perfect";
  if (a <= WINDOWS.excellent * scale) return "excellent";
  if (a <= WINDOWS.good * scale) return "good";
  return d < 0 ? "early" : "late";
}

export class SimPlayer {
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0; facing = 0;
  stamina = 1;
  action: Action = "none"; actionT = 0; actionData: any = null;
  hand: 1 | -1 = 1;
  input: PlayerInput = emptyInput();
  prev: PlayerInput = emptyInput();
  stance = false; sprint = false;
  stumbleT = 0; moveCd = 0; stealCd = 0; emoteCd = 0; jumpCd = 0;
  stanceT = 0; // how long stance has been held (the slide assist fades over time)
  meter = -1;
  contest = 0; // live contest on my shot (0..1)
  moveTimes: number[] = [];
  lastMoveT = -9; stepbackT = -9;
  stats: PlayerStats = emptyStats();
  attrs: Attributes;
  guard: string | null = null; // who this player defends (AI)
  botMemory: any = {};
  constructor(public id: string, public name: string, public team: TeamId, public bot: boolean, public archetype: Archetype) {
    this.attrs = { ...ARCHETYPES[archetype].attrs };
  }
  get airborne() { return this.y > 0.02; }
}

interface ExtraBall { ball: Ball; life: number; money: boolean; counted: boolean }

export class Game {
  tick = 0;
  time = 0; // seconds of sim
  phase: Phase = "pregame";
  phaseT = 0;
  score: [number, number] = [0, 0];
  poss: TeamId = 0;
  mustClear = false;
  shotClock = MATCH.shotClock;
  winner: TeamId | -1 = -1;
  ball: Ball = newBall();
  extra: ExtraBall[] = [];
  players: SimPlayer[] = [];
  events: GameEvent[] = [];
  rand: () => number;
  nextPoss: TeamId = 0;
  shootout = { score: 0, rack: 0, ball: 0, left: SHOOTOUT.duration, giveT: 0, done: false };
  dunk = { total: 0, attempt: 0, last: 0, left: DUNK_CONTEST.duration, resetT: 0, resolved: true };
  matchTime = 0; // seconds of live/check play (the match timer)
  overtimeNextScore = false;

  constructor(public settings: MatchSettings, setups: PlayerSetup[], seed = Date.now()) {
    this.rand = mulberry32(seed);
    for (const s of setups) this.addPlayer(s);
    this.reset();
  }

  get mode(): Mode { return this.settings.mode; }
  get isTeamMode() { return this.mode === "1v1" || this.mode === "2v2" || this.mode === "3v3"; }

  addPlayer(s: PlayerSetup) {
    const p = new SimPlayer(s.id, s.name, s.team, s.bot, s.archetype);
    this.players.push(p);
    this.placeIdle(p, this.players.length - 1);
    return p;
  }

  removePlayer(id: string) {
    const p = this.player(id);
    if (!p) return;
    if (this.ball.holder === id) this.dropBall(p);
    this.players = this.players.filter((q) => q !== p);
  }

  /** A human left mid-match: a bot takes over so the match stays fair and finishable. */
  botTakeover(id: string) {
    const p = this.player(id);
    if (p) { p.bot = true; p.name = p.name + " (CPU)"; p.input = emptyInput(); p.prev = emptyInput(); }
  }

  player(id: string | null | undefined) { return id ? this.players.find((p) => p.id === id) : undefined; }
  teamOf(t: TeamId) { return this.players.filter((p) => p.team === t); }

  reset() {
    this.score = [0, 0];
    this.winner = -1;
    this.time = 0; this.matchTime = 0; this.tick = 0;
    this.overtimeNextScore = false;
    this.extra = [];
    for (const p of this.players) { p.stats = emptyStats(); p.stamina = 1; p.action = "none"; p.meter = -1; }
    this.ball = newBall();
    this.shootout = { score: 0, rack: 0, ball: 0, left: SHOOTOUT.duration, giveT: 0, done: false };
    this.dunk = { total: 0, attempt: 0, last: 0, left: DUNK_CONTEST.duration, resetT: 0, resolved: true };
    this.poss = (this.rand() < 0.5 ? 0 : 1) as TeamId;
    this.nextPoss = this.poss;
    if (this.mode === "free") {
      this.setPhase("live");
      this.ball.state = "loose"; this.ball.x = 6; this.ball.y = 0.5; this.ball.z = 0;
      this.players.forEach((p, i) => this.placeIdle(p, i));
    } else {
      this.setPhase("pregame");
      this.players.forEach((p, i) => this.placeIdle(p, i));
    }
  }

  setInput(id: string, input: PlayerInput) {
    const p = this.player(id);
    if (!p || p.bot) return;
    // sanitize
    const len = Math.hypot(input.mx, input.mz);
    const mx = len > 1 ? input.mx / len : input.mx, mz = len > 1 ? input.mz / len : input.mz;
    p.input = { ...input, mx: Number.isFinite(mx) ? mx : 0, mz: Number.isFinite(mz) ? mz : 0, yaw: Number.isFinite(input.yaw) ? input.yaw : 0 };
  }

  private setPhase(ph: Phase) { this.phase = ph; this.phaseT = 0; }
  private emit(e: GameEvent) { this.events.push(e); }

  // ------------------------------------------------------------------ main step
  step() {
    this.events = [];
    this.tick++; this.time += DT; this.phaseT += DT;
    if (this.phase === "live" || this.phase === "check") this.matchTime += DT;

    for (const p of this.players) if (p.bot) p.input = botThink(this, p);
    for (const p of this.players) this.handlePresses(p);
    for (const p of this.players) this.movePlayer(p);
    this.collidePlayers();
    for (const p of this.players) this.updateAction(p);
    this.updateBall();
    this.updateRules();
    for (const p of this.players) p.prev = { ...p.input };
  }

  // ------------------------------------------------------------------ input presses
  private pressed(p: SimPlayer, k: "jump" | "pass" | "move" | "action" | "interact" | "emote" | "j" | "k" | "l") {
    return p.input[k] !== p.prev[k];
  }

  private canPlay() { return this.phase === "live" || this.mode === "free"; }

  private handlePresses(p: SimPlayer) {
    const hasBall = this.ball.holder === p.id;
    const busy = p.action === "jumpshot" || p.action === "layup" || p.action === "dunk" || p.action === "stumble";
    p.stance = (p.input.stance || p.action === "slide") && !hasBall && !busy;
    p.stanceT = p.stance ? p.stanceT + DT : 0;
    p.sprint = p.input.sprint && p.stamina > 0.05 && !p.stance;

    if (this.pressed(p, "emote") && p.emoteCd <= 0) {
      p.emoteCd = 1.5;
      this.emit({ t: "emote", by: p.id, id: clamp(Math.round(p.input.emoteId), 0, 7) });
    }
    // E: check ball early
    if (this.pressed(p, "interact") && this.phase === "check" && hasBall && this.phaseT > 0.4) {
      this.goLive();
    }
    if (this.phase === "pregame" || this.phase === "gameover") return;

    // shoot (hold)
    if (p.input.shoot && !p.prev.shoot && hasBall && !busy && this.phase === "live") this.startShot(p);
    if (busy) return;

    if (this.pressed(p, "jump") && !p.airborne && p.jumpCd <= 0) {
      if (!hasBall) this.blockJump(p);
    }
    if (this.pressed(p, "pass") && hasBall && this.canPlay()) this.tryPass(p);
    // ISO keys — what they do depends on whether you have the ball
    if (this.pressed(p, "j")) { if (hasBall && this.canPlay()) this.dribbleMove(p, false, "cross"); else if (!hasBall && p.stealCd <= 0) this.startSteal(p); }
    if (this.pressed(p, "k")) { if (hasBall && this.canPlay()) this.dribbleMove(p, true); else if (!hasBall) this.startSlide(p); }
    if (this.pressed(p, "l")) { if (hasBall && this.canPlay()) this.drive(p); else if (!hasBall && !p.airborne && p.jumpCd <= 0) this.blockJump(p); }
    if (this.pressed(p, "move") && hasBall && this.canPlay()) this.dribbleMove(p, false);
    if (this.pressed(p, "action")) {
      if (hasBall && this.canPlay()) this.dribbleMove(p, true);
      else if (!hasBall && p.stealCd <= 0) this.startSteal(p);
    }
  }

  // ------------------------------------------------------------------ movement
  private movePlayer(p: SimPlayer) {
    p.stumbleT = Math.max(0, p.stumbleT - DT);
    p.moveCd = Math.max(0, p.moveCd - DT);
    p.stealCd = Math.max(0, p.stealCd - DT);
    p.emoteCd = Math.max(0, p.emoteCd - DT);
    p.jumpCd = Math.max(0, p.jumpCd - DT);

    const hasBall = this.ball.holder === p.id;
    let mx = p.input.mx, mz = p.input.mz;
    let locked = false;
    if (this.phase === "pregame" || this.phase === "gameover") locked = true;
    if (this.mode === "shootout") locked = true;
    if (this.phase === "check" && hasBall) locked = true;
    if (p.action === "jumpshot" || p.action === "celebrate" || p.action === "pass" && p.actionT < 0.15) locked = true;
    if (p.action === "layup" || p.action === "dunk") locked = true; // driven by the action
    if (locked) { mx = 0; mz = 0; }

    // stamina
    const moving = Math.hypot(mx, mz) > 0.1;
    if (p.sprint && moving) p.stamina = Math.max(0, p.stamina - PLAYER.staminaSprintDrain * DT * (hasBall ? 1.2 : 1));
    else p.stamina = Math.min(1, p.stamina + PLAYER.staminaRegen * DT * (moving ? 0.6 : 1));

    let maxSpeed = PLAYER.runSpeed * (0.94 + p.attrs.speed * 0.1);
    if (p.sprint) maxSpeed = PLAYER.sprintSpeed * (0.92 + p.attrs.speed * 0.12) * (0.75 + 0.25 * Math.min(1, p.stamina * 3));
    if (p.stance) maxSpeed = PLAYER.stanceSpeed * (0.9 + p.attrs.defense * 0.15);
    if (hasBall) maxSpeed *= PLAYER.dribbleMult;
    if (p.stumbleT > 0) maxSpeed *= 0.3;

    // DEFENSE LOCK-ON: in stance near the ball handler, the defender is pulled to the spot
    // between the handler and the hoop and can slide as fast as the handler moves.
    const handler = this.player(this.ball.holder);
    if (p.stance && handler && handler.team !== p.team && p.stumbleT <= 0) {
      const d = Math.hypot(handler.x - p.x, handler.z - p.z);
      if (d < 4.5) {
        const hl = Math.hypot(HOOP.x - handler.x, HOOP.z - handler.z) || 1;
        const tx = handler.x + ((HOOP.x - handler.x) / hl) * 1.0 + handler.vx * 0.15;
        const tz = handler.z + ((HOOP.z - handler.z) / hl) * 1.0 + handler.vz * 0.15;
        let ex = tx - p.x, ez = tz - p.z;
        // when the driver is close, hold your ground: no backing up toward the hoop, only slide sideways
        if (d < 1.4) {
          const ux = (HOOP.x - handler.x) / hl, uz = (HOOP.z - handler.z) / hl;
          const along = ex * ux + ez * uz;
          if (along > 0) { ex -= along * ux; ez -= along * uz; }
        }
        // assist only sideways: you still have to close out and recover yourself
        {
          const ux = (HOOP.x - handler.x) / hl, uz = (HOOP.z - handler.z) / hl;
          const along = ex * ux + ez * uz; ex -= along * ux; ez -= along * uz;
        }
        const el = Math.hypot(ex, ez);
        // some help, not a full lock: strongest when you first get set, then it fades
        const fade = clamp(1.2 - p.stanceT / 2.0, 0.3, 1);
        const pull = clamp(0.9 - d / 4.5, 0, 0.45) * fade;
        if (el > 0.05) {
          const k = Math.min(1, el / 0.5);
          mx = mx * (1 - pull) + (ex / el) * k * pull;
          mz = mz * (1 - pull) + (ez / el) * k * pull;
        }
        maxSpeed = Math.max(maxSpeed, Math.hypot(handler.vx, handler.vz) * (handler.sprint ? 0.86 : 0.94) * (0.8 + 0.2 * fade));
      }
    }
    // BLOW-BY CONTROL: a set defender in stance right in front slows the ball handler down
    if (hasBall && !p.airborne) {
      const mvx = mx, mvz = mz, ml = Math.hypot(mvx, mvz);
      if (ml > 0.1) {
        for (const d of this.players) {
          if (d.team === p.team || !d.stance || d.stumbleT > 0) continue;
          const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz);
          if (dist > 1.5) continue;
          const toward = (dx * mvx + dz * mvz) / (dist * ml);
          if (toward > 0.35) maxSpeed *= 1 - 0.42 * toward * (1.5 - dist) / 1.5 * (0.7 + d.attrs.defense * 0.4);
        }
      }
    }
    if (p.stamina < 0.15) maxSpeed *= 0.88;

    if (!p.airborne && p.action !== "layup" && p.action !== "dunk") {
      // moves: burst velocity is applied in dribbleMove; here we steer toward desired velocity
      const isMove = (MOVE_ACTIONS.includes(p.action) && p.actionT < (p.action === "drive" ? 0.4 : 0.28)) || (p.action === "slide" && p.actionT < 0.22);
      if (!isMove) {
        const tvx = mx * maxSpeed, tvz = mz * maxSpeed;
        const dvx = tvx - p.vx, dvz = tvz - p.vz;
        const dl = Math.hypot(dvx, dvz);
        const acc = (moving ? PLAYER.accel : PLAYER.decel) * (p.stance ? 1.25 : 1) * DT;
        if (dl <= acc) { p.vx = tvx; p.vz = tvz; } else { p.vx += (dvx / dl) * acc; p.vz += (dvz / dl) * acc; }
      } else {
        p.vx *= 0.985; p.vz *= 0.985;
      }
    }

    // facing
    let want: number | null = null;
    if (p.action === "jumpshot" || p.action === "layup" || p.action === "dunk") want = Math.atan2(HOOP.z - p.z, HOOP.x - p.x);
    else if (p.stance) {
      const h = this.player(this.ball.holder);
      const tgt = h && h.team !== p.team ? h : null;
      want = tgt ? Math.atan2(tgt.z - p.z, tgt.x - p.x) : Math.atan2(this.ball.z - p.z, this.ball.x - p.x);
    } else if (moving) want = Math.atan2(mz, mx);
    else if (hasBall) want = Math.atan2(HOOP.z - p.z, HOOP.x - p.x);
    if (want !== null) {
      const rate = (p.stance ? 14 : 11) * DT;
      const d = angDiff(p.facing, want);
      p.facing += clamp(d, -rate, rate);
    }

    // vertical
    if (p.y > 0 || p.vy > 0) {
      p.vy -= 9.81 * DT;
      p.y += p.vy * DT;
      if (p.y <= 0) { p.y = 0; p.vy = 0; if (p.action === "jump") p.action = "none"; }
    }
    p.x += p.vx * DT; p.z += p.vz * DT;

    // bounds
    p.x = clamp(p.x, PLAYER.boundsMinX, PLAYER.boundsMaxX);
    p.z = clamp(p.z, -PLAYER.boundsZ, PLAYER.boundsZ);
    // hoop pole
    const dx = p.x - HOOP.poleX, dz = p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) { p.x = HOOP.poleX + (d > 1e-4 ? dx / d : -1) * 0.5; p.z = (d > 1e-4 ? dz / d : 0) * 0.5; }
  }

  private collidePlayers() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = PLAYER.radius * 2;
      if (d < min && d > 1e-5) {
        const push = (min - d) / 2;
        const nx = dx / d, nz = dz / d;
        // the ball handler is "stronger" when driving, defenders in stance hold ground
        const wa = a.stance ? 0.2 : 0.5, wb = b.stance ? 0.2 : 0.5;
        const sa = wa / (wa + wb), sb = wb / (wa + wb);
        a.x -= nx * push * 2 * sa; a.z -= nz * push * 2 * sa;
        b.x += nx * push * 2 * sb; b.z += nz * push * 2 * sb;
        // running into a set defender kills your momentum
        const holder = this.ball.holder;
        if (holder === a.id && b.stance) { const vn = a.vx * nx + a.vz * nz; if (vn > 0) { a.vx -= vn * nx * 0.8; a.vz -= vn * nz * 0.8; } }
        if (holder === b.id && a.stance) { const vn = -(b.vx * nx + b.vz * nz); if (vn > 0) { b.vx += vn * nx * 0.8; b.vz += vn * nz * 0.8; } }
      }
    }
  }

  // ------------------------------------------------------------------ dribble moves
  private dribbleMove(p: SimPlayer, contextual: boolean, force?: Action) {
    if (p.moveCd > 0 || p.airborne) return;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const rx = -fz, rz = fx; // right of facing
    const ix = p.input.mx, iz = p.input.mz;
    const fwd = ix * fx + iz * fz, side = ix * rx + iz * rz;
    let kind: Action;
    let bx = 0, bz = 0, burst = 0;
    if (contextual) { kind = "stepback"; bx = -fx; bz = -fz; burst = 4.6; }
    else if (force === "cross") { kind = "cross"; const s = Math.abs(side) > 0.3 ? Math.sign(side) : -p.hand; bx = rx * s + fx * 0.45; bz = rz * s + fz * 0.45; burst = 5.8; p.hand = (s > 0 ? 1 : -1) as 1 | -1; }
    else if (Math.abs(side) > 0.45) { kind = "cross"; const s = Math.sign(side); bx = rx * s + fx * 0.45; bz = rz * s + fz * 0.45; burst = 5.6; p.hand = (s > 0 ? 1 : -1) as 1 | -1; }
    else if (fwd > 0.45) { kind = "hesi"; bx = fx; bz = fz; burst = 6.2; }
    else if (fwd < -0.45) { kind = "btl"; bx = -fx * 0.3; bz = -fz * 0.3; burst = 2.0; p.hand = (-p.hand) as 1 | -1; }
    else { kind = "btb"; const s = -p.hand; bx = rx * s * 0.8 + fx * 0.3; bz = rz * s * 0.8 + fz * 0.3; burst = 4.4; p.hand = s as 1 | -1; }
    const bl = Math.hypot(bx, bz) || 1;
    const cost = kind === "hesi" ? 0.06 : 0.09;
    p.stamina = Math.max(0, p.stamina - cost);
    p.action = kind; p.actionT = 0; p.moveCd = kind === "stepback" ? 0.65 : 0.42;
    if (kind === "hesi") { p.vx *= 0.2; p.vz *= 0.2; p.actionData = { burst: { x: bx / bl, z: bz / bl, s: burst }, at: 0.22 }; }
    else { p.vx = (bx / bl) * burst; p.vz = (bz / bl) * burst; p.actionData = null; }
    if (kind === "stepback") p.stepbackT = this.time;
    p.moveTimes = p.moveTimes.filter((t) => this.time - t < 1.4);
    p.moveTimes.push(this.time);
    p.lastMoveT = this.time;
    this.emit({ t: "move", by: p.id, kind });

    // fumble risk when spamming on empty legs
    if (p.stamina < 0.12 && p.moveTimes.length >= 3 && this.rand() < 0.35) {
      this.dropBall(p, 2.5);
      this.emit({ t: "turnover", team: p.team, why: "Lost the handle", by: p.id });
      p.stats.tov++;
      return;
    }
    // ankle check against the nearest defender in front
    const d = this.nearestOpponent(p);
    if (d) {
      const dist = Math.hypot(d.x - p.x, d.z - p.z);
      const dirx = (d.x - p.x) / (dist || 1), dirz = (d.z - p.z) / (dist || 1);
      const inFront = dirx * fx + dirz * fz > 0.2;
      if (dist < 1.7 && inFront) {
        let chance = 0.12 + (p.attrs.dribble - d.attrs.defense) * 0.45;
        if (d.action === "steal" && d.actionT < 0.3) chance += 0.65; // crossed right as they reached: ankles
        else if (d.action === "steal" || d.airborne) chance += 0.45; // punish reaching and biting
        if (!d.stance) chance += 0.08; else chance -= 0.05;
        // defender drifting the wrong way relative to the move
        const dv = d.vx * (bx / bl) + d.vz * (bz / bl);
        if (dv < -1.0) chance += 0.15;
        chance -= Math.max(0, p.moveTimes.length - 1) * 0.12; // spam penalty
        if (p.stamina < 0.25) chance -= 0.1;
        if (kind === "hesi" && d.stance) chance += 0.05;
        if (this.rand() < clamp(chance, 0.02, 0.6)) {
          d.stumbleT = 0.7; d.action = "stumble"; d.actionT = 0; d.vx *= 0.2; d.vz *= 0.2;
          this.emit({ t: "ankle", by: p.id, on: d.id });
        }
      }
    }
  }

  // ------------------------------------------------------------------ ISO moves: drive, slide, block jump
  /** L with the ball: burst toward the rim (or where you're pushing). Press again mid-drive to blow by. */
  private drive(p: SimPlayer) {
    if (p.airborne) return;
    if (p.action === "drive" && p.actionT < 0.45 && !p.actionData?.second) {
      const sp = Math.hypot(p.vx, p.vz) || 1;
      p.vx = (p.vx / sp) * 7.6; p.vz = (p.vz / sp) * 7.6;
      p.actionData.second = true; p.actionT = 0.05;
      p.stamina = Math.max(0, p.stamina - 0.08);
      this.emit({ t: "move", by: p.id, kind: "drive" });
      return;
    }
    if (p.moveCd > 0) return;
    let dx = p.input.mx, dz = p.input.mz;
    if (Math.hypot(dx, dz) < 0.3) { dx = HOOP.x - p.x; dz = HOOP.z - p.z; }
    const l = Math.hypot(dx, dz) || 1;
    p.action = "drive"; p.actionT = 0; p.actionData = { second: false, beat: false };
    p.vx = (dx / l) * 6.6; p.vz = (dz / l) * 6.6;
    p.facing = Math.atan2(dz, dx);
    p.moveCd = 0.4; p.stamina = Math.max(0, p.stamina - 0.07);
    p.lastMoveT = this.time;
    this.emit({ t: "move", by: p.id, kind: "drive" });
  }

  /** During a drive: a set defender in your path cuts you off; an unset one gets beat. */
  private driveContact(p: SimPlayer) {
    const sp = Math.hypot(p.vx, p.vz); if (sp < 0.5) return;
    const ux = p.vx / sp, uz = p.vz / sp;
    for (const d of this.players) {
      if (d.team === p.team || d.airborne) continue;
      const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > 1.0) continue;
      const ahead = (dx * ux + dz * uz) / (dist || 1);
      if (ahead >= 0.35) {
        // defender in the lane: a slide (or a squared-up stance, sometimes) stops the drive
        const slid = d.action === "slide";
        const squared = d.stance && ahead > 0.8 && dist < 0.85;
        if (squared && !slid && !p.actionData.rolled) { p.actionData.rolled = true; p.actionData.stanceStop = this.rand() < 0.3 + (d.attrs.defense - p.attrs.dribble) * 0.5; }
        if ((slid || (squared && p.actionData.stanceStop)) && d.stumbleT <= 0) {
          p.vx *= 0.15; p.vz *= 0.15; p.action = "none"; p.stumbleT = 0.3;
          this.emit({ t: "msg", text: "CUT OFF", to: p.id });
          this.emit({ t: "msg", text: "Cut him off!", to: d.id });
          return;
        }
      } else if (ahead < -0.1 && ahead > -0.8 && dist < 0.9 && !p.actionData.beat && d.action !== "slide") {
        // got alongside him: he's beat
        p.actionData.beat = true;
        d.stumbleT = Math.max(d.stumbleT, 0.3);
      }
    }
  }

  /** K on defense: a quick slide in the direction you hold (A/D). Beat them to the spot to cut off a drive. */
  private startSlide(p: SimPlayer) {
    if (p.airborne || p.stumbleT > 0 || (p.action === "slide" && p.actionT < 0.3)) return;
    let dx = p.input.mx, dz = p.input.mz;
    if (Math.hypot(dx, dz) < 0.3) {
      const h = this.player(this.ball.holder);
      if (h && h.team !== p.team) { dx = h.vx; dz = h.vz; }
    }
    const l = Math.hypot(dx, dz);
    p.action = "slide"; p.actionT = 0;
    if (l > 0.1) { p.vx = (dx / l) * 6.2; p.vz = (dz / l) * 6.2; }
    p.stamina = Math.max(0, p.stamina - 0.04);
  }

  /** Jump to block: goes at the shooter; moving away when you jump is weak and slow. */
  private blockJump(p: SimPlayer) {
    let vy = PLAYER.jumpVel * (0.95 + p.attrs.defense * 0.08);
    const t = this.blockTarget(p);
    if (t) {
      const dx = t.x - p.x, dz = t.z - p.z, dist = Math.hypot(dx, dz) || 1;
      const ux = dx / dist, uz = dz / dist;
      const away = -(p.vx * ux + p.vz * uz);
      p.facing = Math.atan2(dz, dx);
      if (away > 1.0) {
        vy *= 0.78; p.vx *= 0.25; p.vz *= 0.25;
        p.stumbleT = Math.max(p.stumbleT, 0.95);
      } else {
        const lunge = Math.min(2.4, Math.max(0, dist - 0.6) * 1.6);
        p.vx = p.vx * 0.4 + ux * lunge; p.vz = p.vz * 0.4 + uz * lunge;
      }
    }
    p.vy = vy;
    p.action = "jump"; p.actionT = 0; p.jumpCd = 0.55;
    p.stamina = Math.max(0, p.stamina - 0.04);
  }

  /** Who a jump should go at: an opponent holding or shooting the ball within 3.5 m. */
  private blockTarget(p: SimPlayer): SimPlayer | undefined {
    const b = this.ball;
    const id = b.state === "held" ? b.holder : b.state === "shot" && b.shotTime < 0.4 ? b.shooter : null;
    const t = this.player(id);
    if (!t || t.team === p.team) return undefined;
    return Math.hypot(t.x - p.x, t.z - p.z) < 3.5 ? t : undefined;
  }

  private nearestOpponent(p: SimPlayer) {
    let best: SimPlayer | undefined, bd = 1e9;
    for (const q of this.players) if (q.team !== p.team) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = q; } }
    return best;
  }

  // ------------------------------------------------------------------ shooting
  private startShot(p: SimPlayer) {
    if (this.isTeamMode && this.phase !== "live") return;
    if (this.mode === "free" || this.isTeamMode || this.mode === "shootout" || this.mode === "dunk") { /* ok */ }
    if (this.isTeamMode && this.mustClear) {
      this.emit({ t: "msg", text: "CLEAR THE BALL first — take it behind the arc", to: p.id });
      return;
    }
    const dx = HOOP.x - p.x, dz = HOOP.z - p.z;
    const dist = Math.hypot(dx, dz);
    const speed = Math.hypot(p.vx, p.vz);
    const toward = (p.vx * dx + p.vz * dz) / (dist || 1);
    let kind: "jumpshot" | "layup" | "dunk" = "jumpshot";
    if (this.mode === "shootout") kind = "jumpshot";
    else if (this.mode === "dunk") {
      if (dist > 3.2) { this.emit({ t: "msg", text: "Get closer — dunk from inside 3 meters", to: p.id }); return; }
      kind = "dunk";
    }
    else if (dist < 2.6 && (p.sprint || speed > 4.2) && toward > 2 && p.attrs.dunk && p.stamina > 0.2) kind = "dunk";
    else if (dist < 3.5 && toward > 1.5) kind = "layup";
    else if (dist < 1.7) kind = "layup";
    p.action = kind; p.actionT = 0; p.meter = 0;
    p.actionData = {
      kind, released: false, value: this.mode === "shootout" ? (this.shootout.ball === SHOOTOUT.ballsPerSpot - 1 ? 2 : 1) : shotValueAt(p.x, p.z),
      startSpeed: speed, startDist: dist, style: 0, blocked: false, stepback: this.time - p.stepbackT < 0.9,
    };
    if (kind === "layup") {
      const l = dist || 1;
      p.vx = (dx / l) * Math.min(4.2, Math.max(2.5, speed)); p.vz = (dz / l) * Math.min(4.2, Math.max(2.5, speed));
    }
    if (kind === "dunk") {
      // fly toward a point just in front of the rim
      const l = dist || 1;
      const tx = HOOP.x - (dx / l) * 0.42, tz = HOOP.z - (dz / l) * 0.42;
      const t = 0.5;
      p.vx = (tx - p.x) / t; p.vz = (tz - p.z) / t;
      p.vy = 4.0; p.y = 0.01;
      p.actionData.takeoff = dist;
      if (this.mode !== "dunk") p.meter = -1;
    }
  }

  private shotContest(p: SimPlayer) {
    let c = 0;
    const fx = HOOP.x - p.x, fz = HOOP.z - p.z;
    const fl = Math.hypot(fx, fz) || 1;
    for (const d of this.players) {
      if (d.team === p.team) continue;
      const dx = d.x - p.x, dz = d.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.6) continue;
      const front = (dx * fx + dz * fz) / (fl * (dist || 1));
      if (front < -0.2) continue;
      let k = (1 - dist / 2.6) * (0.55 + 0.45 * Math.max(0, front));
      if (d.stance) k *= 1.15;
      if (d.airborne) k *= 1.35;
      if (d.stumbleT > 0) k *= 0.25;
      k *= 0.75 + d.attrs.defense * 0.4;
      c = Math.max(c, k);
    }
    return clamp(c, 0, 1);
  }

  /** The defender doing the most to bother this shot (for "your contest" feedback). */
  private mainContester(p: SimPlayer): string | undefined {
    let best: string | undefined, bd = 2.6;
    for (const d of this.players) { if (d.team === p.team) continue; const dist = Math.hypot(d.x - p.x, d.z - p.z); if (dist < bd) { bd = dist; best = d.id; } }
    return best;
  }

  private releaseShot(p: SimPlayer) {
    const data = p.actionData;
    if (!data || data.released) return;
    data.released = true;
    const kind: string = data.kind;
    const target = SHOT_TARGET[kind];
    const meter = p.meter;
    const contest = this.shotContest(p);
    const timing = gradeTiming(meter, target, kind, contest);
    p.meter = -1; p.contest = 0;
    const dist = Math.hypot(HOOP.x - p.x, HOOP.z - p.z);

    // ---- shot quality
    const tq: Record<ShotTiming, number> = { perfect: 1, excellent: 0.86, good: 0.68, early: 0, late: 0 };
    let timingQ = tq[timing];
    if (timing === "early" || timing === "late") timingQ = Math.max(0.08, 0.5 - Math.abs(meter - target) * 2.2);
    let attr = kind === "layup" ? p.attrs.finish : data.value === 2 ? p.attrs.three : p.attrs.mid;
    const attrF = 0.86 + attr * 0.16;
    let distF = 1;
    if (kind === "jumpshot") distF = 1 - clamp((dist - 4.5) / 5, 0, 1) * 0.3 - Math.max(0, dist - 8.3) * 0.3;
    const contestM = 1 - contest * 0.6;
    const moveF = kind === "jumpshot" ? 1 - clamp(data.startSpeed / 7, 0, 1) * (data.stepback ? 0.08 : 0.28) : 1;
    const fatigue = p.stamina < 0.35 ? 0.86 + 0.14 * (p.stamina / 0.35) : 1;
    let q = timingQ * attrF * distF * contestM * moveF * fatigue;
    const green = timing === "perfect";
    if (green) q = 1; // GREEN RELEASE: always goes in (like 2K) — contest and distance don't matter
    q = clamp(q, 0, 1);
    if (timing === "perfect") p.stats.perfect++;

    // ---- aim error: smaller with better quality; early shots fall short, late shots go long
    const err = Math.pow(1 - q, 1.25) * (kind === "layup" ? 0.55 : 0.8);
    const ang = this.rand() * Math.PI * 2;
    let ex = Math.cos(ang) * err * 0.65, ez = Math.sin(ang) * err * 0.65;
    const ux = (HOOP.x - p.x) / (dist || 1), uz = (HOOP.z - p.z) / (dist || 1);
    const depthBias = timing === "early" ? -1 : timing === "late" ? 1 : (this.rand() - 0.5);
    ex += ux * depthBias * err * 0.75; ez += uz * depthBias * err * 0.75;

    // ---- launch
    const hx = p.x + Math.cos(p.facing) * 0.25, hz = p.z + Math.sin(p.facing) * 0.25;
    const hy = kind === "layup" ? 2.55 + p.y : 2.35 + p.y;
    let tx = HOOP.x + ex, tz = HOOP.z + ez, ty = HOOP.y;
    let arc = kind === "layup" ? 0.55 : 0.9 + dist * 0.11;
    if (kind === "layup" && Math.abs(p.z) > 0.6 && q > 0.5) { tx = HOOP.x + 0.06 + ex; } // soft kiss
    const v = solveLaunch(hx, hy, hz, tx, ty, tz, arc);
    const b = this.mode === "shootout" ? this.spawnShootoutFlight(p, data.value === 2) : this.ball;
    b.x = hx; b.y = hy; b.z = hz; b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
    b.state = "shot"; b.holder = null; b.shooter = p.id; b.shotValue = data.value; b.shotKind = kind; b.shotTime = 0;
    b.touchedRim = false; b.touchedBoard = false; b.lastTouch = p.id; b.lastTouchTeam = p.team; b.noPickup = p.id; b.noPickupT = 0.35; b.inNet = 0;
    (b as any).green = green;
    p.stats.fga++; if (data.value === 2) p.stats.tpa++;
    this.emit({ t: "shot", by: p.id, timing, kind, value: data.value, quality: Math.round(q * 100) / 100, contest: Math.round(contest * 100) / 100, contestBy: this.mainContester(p) });
  }

  private dunkFinish(p: SimPlayer) {
    const data = p.actionData;
    if (!data || data.released) return;
    data.released = true;
    p.meter = -1;
    const b = this.ball;
    b.holder = null; b.shooter = p.id; b.shotValue = 1; b.shotKind = "dunk"; b.shotTime = 0;
    b.touchedRim = true; b.lastTouch = p.id; b.lastTouchTeam = p.team; b.noPickup = p.id; b.noPickupT = 0.5; b.inNet = 0;
    p.stats.fga++;
    let make = true;
    if (this.mode === "dunk") {
      const timing = gradeTiming(data.meterAtPress ?? -1, SHOT_TARGET.dunk, "dunk");
      data.timing = timing;
      if (timing === "early" || timing === "late") make = this.rand() < 0.25;
      this.emit({ t: "shot", by: p.id, timing, kind: "dunk", value: 1, quality: make ? 1 : 0 });
    } else {
      this.emit({ t: "shot", by: p.id, timing: "perfect", kind: "dunk", value: 1, quality: 1 });
    }
    if (make) {
      b.x = HOOP.x; b.z = HOOP.z; b.y = HOOP.y + 0.2; b.vx = 0; b.vz = 0; b.vy = -5; b.state = "shot";
    } else {
      // rims out
      const ux = (p.x - HOOP.x), uz = (p.z - HOOP.z); const l = Math.hypot(ux, uz) || 1;
      b.x = HOOP.x + (ux / l) * 0.2; b.z = HOOP.z + (uz / l) * 0.2; b.y = HOOP.y + 0.18; b.vx = (ux / l) * 2.2; b.vz = (uz / l) * 2.2; b.vy = 2.5; b.state = "shot";
    }
  }

  // ------------------------------------------------------------------ actions over time
  private updateAction(p: SimPlayer) {
    p.actionT += DT;
    const a = p.action;
    if (a === "jumpshot" || a === "layup") {
      const dur = SHOT_DURATION[a];
      const data = p.actionData;
      if (!data.released) {
        p.meter = p.actionT / dur;
        p.contest = this.shotContest(p);
        // jump timing
        if (a === "jumpshot" && p.actionT >= 0.26 && !p.airborne && !data.jumped) { p.vy = 3.1; p.y = 0.01; data.jumped = true; p.vx *= 0.3; p.vz *= 0.3; }
        if (a === "layup" && p.actionT >= 0.16 && !data.jumped) { p.vy = 3.7; p.y = 0.01; data.jumped = true; }
        if (a === "jumpshot" && !data.jumped) { p.vx *= 0.85; p.vz *= 0.85; }
        if (!p.input.shoot && a === "jumpshot" && !data.jumped && (p.input.hold > 0 ? p.input.hold < 0.17 : p.actionT < 0.17)) {
          // tap = PUMP FAKE: keep the ball, sell the shot
          p.action = "pumpfake"; p.actionT = 0; p.meter = -1; p.contest = 0;
          this.emit({ t: "move", by: p.id, kind: "pumpfake" });
        } else if (!p.input.shoot && p.actionT > 0.08) {
          // trust the client's own hold time if it is close to what the server saw (absorbs network jitter)
          const h = p.input.hold;
          if (h > 0 && Math.abs(h - p.actionT) < 0.15) p.meter = h / dur;
          this.releaseShot(p);
        } else if (p.meter >= 1.25) this.releaseShot(p);
        if (this.ball.holder !== p.id && this.mode !== "shootout") { p.meter = -1; data.released = true; } // stripped
      }
      if (data.released && !p.airborne && p.actionT > 0.5) { p.action = "none"; p.meter = -1; }
      if (p.actionT > 2.2) { p.action = "none"; p.meter = -1; }
    } else if (a === "dunk") {
      const data = p.actionData;
      if (this.mode === "dunk" && !data.released) {
        p.meter = p.actionT / SHOT_DURATION.dunk;
        if (!p.input.shoot && data.meterAtPress === undefined && p.actionT > 0.05) {
          const h = p.input.hold;
          data.meterAtPress = h > 0 && Math.abs(h - p.actionT) < 0.15 ? h / SHOT_DURATION.dunk : p.meter;
        }
        if (this.pressed(p, "move")) data.style |= 1; // 360 spin
        if (this.pressed(p, "jump")) data.style |= 2; // windmill
      }
      if (!data.released && p.actionT >= 0.45) {
        if (data.meterAtPress === undefined) data.meterAtPress = p.meter;
        if (this.ball.holder === p.id) this.dunkFinish(p); else data.released = true;
      }
      if (data.released && p.actionT < 0.85 && p.actionT >= 0.45) { p.y = Math.max(p.y, 0.72); p.vy = 0; p.vx = 0; p.vz = 0; } // hang on the rim
      if (p.actionT > 0.85 && p.y <= 0.001) { p.action = "none"; }
      if (p.actionT > 2) p.action = "none";
    } else if (a === "steal") {
      if (!p.actionData?.resolved && p.actionT >= 0.12) this.resolveSteal(p);
      if (p.actionT > 0.38) p.action = "none";
    } else if (a === "pass") {
      if (p.actionT > 0.35) p.action = "none";
    } else if (a === "drive") {
      this.driveContact(p);
      if (p.actionT > 0.55) p.action = "none";
    } else if (MOVE_ACTIONS.includes(a)) {
      if (a === "hesi" && p.actionData && p.actionT >= p.actionData.at && !p.actionData.done) {
        p.actionData.done = true;
        p.vx = p.actionData.burst.x * p.actionData.burst.s; p.vz = p.actionData.burst.z * p.actionData.burst.s;
      }
      if (p.actionT > 0.45) p.action = "none";
    } else if (a === "pumpfake") {
      p.vx *= 0.8; p.vz *= 0.8;
      if (p.actionT > 0.38) p.action = "none";
    } else if (a === "slide") {
      if (p.actionT > 0.32) p.action = "none";
    } else if (a === "stumble") {
      if (p.stumbleT <= 0) p.action = "none";
    } else if (a === "celebrate") {
      if (p.actionT > 2.0) p.action = "none";
    } else if (a === "jump") {
      if (!p.airborne && p.actionT > 0.1) p.action = "none";
    }
  }

  // ------------------------------------------------------------------ passing / stealing
  private tryPass(p: SimPlayer) {
    const mates = this.players.filter((q) => q.team === p.team && q !== p);
    if (mates.length === 0) { this.emit({ t: "msg", text: "No teammate to pass to", to: p.id }); return; }
    // aim: move input if any, else camera yaw
    let ax = p.input.mx, az = p.input.mz;
    if (Math.hypot(ax, az) < 0.3) { ax = Math.cos(p.input.yaw); az = Math.sin(p.input.yaw); }
    let best = mates[0], bs = -1e9;
    for (const m of mates) {
      const dx = m.x - p.x, dz = m.z - p.z; const d = Math.hypot(dx, dz) || 1;
      const s = (dx * ax + dz * az) / d - d * 0.03;
      if (s > bs) { bs = s; best = m; }
    }
    const b = this.ball;
    const sx = p.x + Math.cos(p.facing) * 0.35, sz = p.z + Math.sin(p.facing) * 0.35, sy = 1.35 + p.y;
    const dist0 = Math.hypot(best.x - sx, best.z - sz);
    const speed = 13;
    const t = Math.max(0.18, dist0 / speed);
    const tx = best.x + best.vx * t, tz = best.z + best.vz * t, ty = 1.3;
    b.x = sx; b.y = sy; b.z = sz;
    b.vx = (tx - sx) / t; b.vz = (tz - sz) / t; b.vy = (ty - sy + 0.5 * 9.81 * t * t) / t;
    b.state = "pass"; b.holder = null; b.passer = p.id; b.passTarget = best.id; b.lastTouch = p.id; b.lastTouchTeam = p.team;
    b.noPickup = p.id; b.noPickupT = 0.25; b.shotTime = 0;
    p.action = "pass"; p.actionT = 0;
    p.facing = Math.atan2(tz - p.z, tx - p.x);
    (b as any).passTime = this.time;
    this.emit({ t: "pass", by: p.id, to: best.id });
  }

  private startSteal(p: SimPlayer) {
    if (p.airborne || p.stumbleT > 0) return;
    p.action = "steal"; p.actionT = 0; p.actionData = { resolved: false };
    p.stealCd = 0.9; p.stamina = Math.max(0, p.stamina - 0.06);
    // small lunge
    p.vx += Math.cos(p.facing) * 1.5; p.vz += Math.sin(p.facing) * 1.5;
  }

  private resolveSteal(p: SimPlayer) {
    p.actionData.resolved = true;
    const h = this.player(this.ball.holder);
    if (!h || h.team === p.team || this.ball.state !== "held") return;
    const dx = h.x - p.x, dz = h.z - p.z; const dist = Math.hypot(dx, dz);
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const front = (dx * fx + dz * fz) / (dist || 1);
    if (dist > 1.35 || front < 0.3) { p.stumbleT = 0.35; return; }
    // which side is the ball on? (dribble hand relative to the defender)
    const hx = -Math.sin(h.facing) * h.hand, hz = Math.cos(h.facing) * h.hand; // vector toward ball side
    const near = -(hx * dx + hz * dz) / (dist || 1); // >0 when ball side faces the defender
    let chance = 0.16 + (p.attrs.defense - h.attrs.dribble) * 0.35 + near * 0.1;
    if (this.time - h.lastMoveT < 0.35) chance += 0.14; // ball exposed mid-move
    if (h.sprint) chance += 0.07;
    if (h.action === "jumpshot" || h.action === "layup") chance += 0.1;
    if (h.stamina < 0.2) chance += 0.06;
    if (this.rand() < clamp(chance, 0.04, 0.6)) {
      this.dropBall(h, 3.0, p);
      p.stats.stl++; h.stats.tov++;
      this.emit({ t: "steal", by: p.id, from: h.id });
    } else {
      p.stumbleT = 0.4; // reaching leaves you off balance
    }
  }

  /** Knock the ball loose from p. */
  private dropBall(p: SimPlayer, speed = 2.5, toward?: SimPlayer) {
    const b = this.ball;
    let dx = toward ? toward.x - p.x : Math.cos(p.facing + (this.rand() - 0.5) * 2), dz = toward ? toward.z - p.z : Math.sin(p.facing + (this.rand() - 0.5) * 2);
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    b.holder = null; b.state = "loose";
    b.x = p.x + dx * 0.4; b.z = p.z + dz * 0.4; b.y = 0.9;
    b.vx = dx * speed + (this.rand() - 0.5); b.vz = dz * speed + (this.rand() - 0.5); b.vy = 1.2;
    b.lastTouch = toward?.id ?? p.id; b.lastTouchTeam = toward?.team ?? p.team; b.noPickup = p.id; b.noPickupT = 0.4;
    if (p.action === "jumpshot" || p.action === "layup" || p.action === "dunk") { p.action = "none"; p.meter = -1; }
  }

  // ------------------------------------------------------------------ ball
  private give(p: SimPlayer) {
    const b = this.ball;
    b.state = "held"; b.holder = p.id; b.passer = null; b.passTarget = null; b.noPickup = null; b.shooter = null;
    b.lastTouch = p.id; b.lastTouchTeam = p.team;
    p.hand = 1;
  }

  private updateBall() {
    const b = this.ball;
    b.noPickupT = Math.max(0, b.noPickupT - DT);
    if (b.noPickupT <= 0) b.noPickup = null;

    if (b.state === "held") {
      const h = this.player(b.holder);
      if (!h) { b.state = "loose"; b.holder = null; return; }
      // approximate ball at the dribble hand (the client animates the real dribble)
      const side = h.hand * 0.32;
      b.x = h.x + Math.cos(h.facing) * 0.3 - Math.sin(h.facing) * side;
      b.z = h.z + Math.sin(h.facing) * 0.3 + Math.cos(h.facing) * side;
      b.y = 0.9 + h.y; b.vx = h.vx; b.vz = h.vz; b.vy = 0;
      return;
    }
    if (b.state === "dead" && this.isTeamMode && (this.phase === "check" || this.phase === "pregame")) return;

    b.shotTime += DT;
    const res = stepBall(b, DT);
    for (const r of res.rimHits) if (r.v > 0.4) this.emit({ t: "rim", x: b.x, y: b.y, z: b.z, v: r.v });
    if (res.boardHit > 0.5) this.emit({ t: "board", v: res.boardHit });
    if (res.floorHit > 0) this.emit({ t: "bounce", v: res.floorHit, x: b.x, z: b.z });
    if (res.scored) this.onBasket(b);
    if (res.rimHits.length && this.isTeamMode) this.shotClock = this.teamShotClock();

    // shot ball becomes a rebound once it is coming down off the rim/board or hits the floor
    if (b.state === "shot" && (res.floorHit > 0 || ((b.touchedRim || b.touchedBoard) && b.vy < 0 && b.y < HOOP.y - 0.2))) {
      b.state = "loose";
      (b as any).rebound = true;
    }
    if (b.state === "pass" && (res.floorHit > 0 || b.shotTime > 2.5)) b.state = "loose";

    this.blocksAndGoaltends();
    this.pickups();
  }

  private teamShotClock() { return this.mode === "1v1" ? MATCH.shotClock : MATCH.shotClockTeam; }

  private blocksAndGoaltends() {
    const b = this.ball;
    if (b.state !== "shot" || b.shotKind === "dunk") {
      // dunk blocks: a defender in the air near the dunker before the slam
      if (this.ball.state === "held") {
        const h = this.player(b.holder);
        if (h && h.action === "dunk" && h.actionT > 0.15 && h.actionT < 0.45) {
          for (const d of this.players) {
            if (d.team === h.team || !d.airborne) continue;
            const dist = Math.hypot(d.x - h.x, d.z - h.z);
            if (dist < 0.95 && d.y > 0.25 && this.rand() < 0.05 + d.attrs.defense * 0.05) {
              this.dropBall(h, 3.5, d);
              h.actionData.released = true;
              d.stats.blk++;
              this.emit({ t: "block", by: d.id, on: h.id });
              break;
            }
          }
        }
      }
      return;
    }
    const shooter = this.player(b.shooter);
    if ((b as any).green) return; // a green release can't be blocked
    for (const d of this.players) {
      if (!shooter || d.team === shooter.team) continue;
      if (!d.airborne && d.action !== "jump") continue;
      const hx = d.x + Math.cos(d.facing) * 0.2, hz = d.z + Math.sin(d.facing) * 0.2, hy = 2.45 + d.y;
      const dist = Math.hypot(b.x - hx, b.y - hy, b.z - hz);
      if (dist > 0.48) continue;
      const nearRim = Math.hypot(b.x - HOOP.x, b.z - HOOP.z) < 1.0 && b.y > HOOP.y;
      if (b.vy < 0 && nearRim) {
        // goaltending: points awarded
        this.emit({ t: "block", by: d.id, on: shooter.id, goaltend: true });
        b.state = "dead"; b.vx = 0; b.vz = 0;
        this.awardBasket(shooter, b.shotValue, "goaltend", false);
        return;
      }
      if (b.shotTime < 0.55) {
        const ax = b.x - d.x, az = b.z - d.z; const l = Math.hypot(ax, az) || 1;
        b.vx = (ax / l) * 3.5 + (this.rand() - 0.5) * 2; b.vz = (az / l) * 3.5 + (this.rand() - 0.5) * 2; b.vy = 0.5;
        b.state = "loose"; (b as any).rebound = true; b.lastTouch = d.id; b.lastTouchTeam = d.team;
        d.stats.blk++;
        this.emit({ t: "block", by: d.id, on: shooter.id });
        return;
      }
    }
  }

  private pickups() {
    const b = this.ball;
    if (b.state === "held" || b.state === "dead" && this.mode !== "free") return;
    if (b.state === "shot" && !(b.touchedRim || b.touchedBoard) && b.y > 1.0) return; // in flight
    if (this.phase !== "live" && this.mode !== "free" && this.mode !== "dunk") return;
    let best: SimPlayer | null = null, bd = 1e9;
    for (const p of this.players) {
      if (b.noPickup === p.id) continue;
      if (p.action === "stumble") continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      const reach = p.airborne || p.action === "jump" ? PLAYER.reachJumping + p.y : PLAYER.reachStanding;
      const rad = b.state === "pass" && b.passTarget === p.id ? 0.85 : 0.62;
      if (d < rad && b.y < reach && b.y > -0.1) {
        // interception of a pass needs luck unless you are the target
        if (b.state === "pass" && b.passTarget !== p.id) {
          const passerTeam = this.player(b.passer)?.team;
          if (passerTeam === p.team) continue;
          const chance = (p.stance || p.action === "steal" ? 0.55 : 0.25) + p.attrs.defense * 0.2;
          if ((b as any).interceptRolled?.[p.id]) continue;
          (b as any).interceptRolled = { ...((b as any).interceptRolled || {}), [p.id]: true };
          if (this.rand() > chance) continue;
          p.stats.stl++;
          const passer = this.player(b.passer); if (passer) passer.stats.tov++;
          this.emit({ t: "steal", by: p.id, from: b.passer ?? "" });
        }
        if (d < bd) { bd = d; best = p; }
      }
    }
    if (!best) return;
    const wasShot = (b as any).rebound === true;
    const wasPass = b.state === "pass";
    const passer = b.passer;
    const prevTeam = b.lastTouchTeam;
    (b as any).rebound = false; (b as any).interceptRolled = undefined;
    this.give(best);
    if (wasPass && passer && this.player(passer)?.team === best.team) {
      (b as any).assistFrom = passer; (b as any).assistTime = this.time;
    } else (b as any).assistFrom = null;
    if (wasShot) {
      best.stats.reb++;
      this.emit({ t: "rebound", by: best.id, off: best.team === this.poss });
    }
    if (best.action === "dunk" || best.action === "layup" || best.action === "jumpshot") { best.action = "none"; best.meter = -1; }

    if (this.isTeamMode && this.phase === "live") {
      if (best.team !== this.poss) {
        this.poss = best.team;
        this.shotClock = this.teamShotClock();
        this.mustClear = !isBeyondArc(best.x, best.z);
        if (this.mustClear) this.emit({ t: "mustclear", team: best.team });
      } else if (wasShot) {
        this.shotClock = this.teamShotClock();
      }
      void prevTeam;
    }
    if (this.mode === "dunk" && !this.dunk.resolved) { /* catching own miss ends the attempt */ }
  }

  private onBasket(b: Ball) {
    if (this.mode === "shootout") return; // flights are handled separately
    const shooter = this.player(b.shooter) ?? this.player(b.lastTouch);
    if (!shooter) return;
    const pts = b.state === "shot" ? b.shotValue : 1;
    const swish = !b.touchedRim && !b.touchedBoard;
    b.state = "dead";
    this.awardBasket(shooter, pts, b.shotKind, swish);
  }

  private awardBasket(shooter: SimPlayer, pts: number, kind: string, swish: boolean) {
    const b = this.ball;
    let assist: string | undefined;
    const af = (b as any).assistFrom; const at = (b as any).assistTime ?? -9;
    if (af && af !== shooter.id && this.time - at < 5) { assist = af; const ap = this.player(af); if (ap) ap.stats.ast++; }
    (b as any).assistFrom = null;
    shooter.stats.fgm++; shooter.stats.pts += pts; if (pts === 2) shooter.stats.tpm++;
    const team = shooter.team;
    if (this.mode === "dunk") {
      this.scoreDunk(shooter);
      return;
    }
    this.emit({ t: "score", team, pts, by: shooter.id, assist, kind, swish });
    if (!this.isTeamMode) return;
    this.score[team] += pts;
    shooter.action = "celebrate"; shooter.actionT = 0;
    this.nextPoss = (this.settings.rule === "losers" ? (1 - team) : team) as TeamId;
    if (!this.checkGameOver()) this.setPhase("dead");
  }

  private checkGameOver(): boolean {
    const [a, c] = this.score;
    const tgt = this.settings.target;
    const cap = tgt + 4;
    let w: TeamId | -1 = -1;
    if ((a >= tgt || c >= tgt) && Math.abs(a - c) >= MATCH.winBy) w = a > c ? 0 : 1;
    if (a >= cap || c >= cap) w = a > c ? 0 : 1;
    if (this.overtimeNextScore && a !== c) w = a > c ? 0 : 1;
    if (w !== -1) { this.endGame(w); return true; }
    return false;
  }

  private endGame(w: TeamId | -1) {
    this.winner = w;
    this.setPhase("gameover");
    for (const p of this.players) if (p.team === w) { p.action = "celebrate"; p.actionT = 0; }
    this.emit({ t: "gameover", winner: w, score: [...this.score] as [number, number] });
  }

  // ------------------------------------------------------------------ rules & phases
  private goLive() {
    this.setPhase("live");
    this.shotClock = this.teamShotClock();
    this.mustClear = false;
    this.emit({ t: "live" });
  }

  private turnover(team: TeamId, why: string, by?: string) {
    if (this.phase !== "live") return;
    const p = this.player(by); if (p) p.stats.tov++;
    this.emit({ t: "turnover", team, why, by });
    this.nextPoss = (1 - team) as TeamId;
    this.ball.state = "dead"; this.ball.holder = null;
    this.setPhase("dead");
    this.phaseT = MATCH.deadTime - 0.9;
  }

  private updateRules() {
    if (this.mode === "shootout") return this.updateShootout();
    if (this.mode === "dunk") return this.updateDunkContest();
    if (this.mode === "free") {
      // keep the ball in play forever
      if (this.ball.state === "dead") this.ball.state = "loose";
      return;
    }
    const b = this.ball;
    switch (this.phase) {
      case "pregame":
        if (this.phaseT > 2.5) this.enterCheck(this.poss);
        break;
      case "check":
        if (this.phaseT > MATCH.checkTime + (this.players.some((p) => !p.bot) ? 1.2 : 0)) this.goLive();
        break;
      case "dead":
        if (this.phaseT > MATCH.deadTime) this.enterCheck(this.nextPoss);
        break;
      case "live": {
        this.shotClock -= DT;
        if (this.shotClock <= 0 && b.state !== "shot") { this.turnover(this.poss, "Shot clock violation"); break; }
        if (this.settings.timeLimit > 0 && this.matchTime >= this.settings.timeLimit && !this.overtimeNextScore) {
          if (this.score[0] !== this.score[1]) { this.endGame(this.score[0] > this.score[1] ? 0 : 1); break; }
          this.overtimeNextScore = true;
          this.emit({ t: "msg", text: "TIME! Next bucket wins" });
        }
        const h = this.player(b.holder);
        if (h) {
          if (!(h.x >= 0 && h.x <= COURT.halfLength + 0.05 && Math.abs(h.z) <= COURT.halfWidth + 0.05) && !h.airborne) {
            this.turnover(h.team, "Out of bounds", h.id); break;
          }
          if (this.mustClear && h.team === this.poss && isBeyondArc(h.x, h.z)) {
            this.mustClear = false; this.emit({ t: "cleared", team: h.team });
          }
        } else if (b.state === "loose" && b.y < 0.3) {
          if (b.x < 0 || b.x > COURT.halfLength || Math.abs(b.z) > COURT.halfWidth) {
            this.turnover(b.lastTouchTeam as TeamId, "Out of bounds"); break;
          }
        }
        break;
      }
    }
  }

  private enterCheck(team: TeamId) {
    this.poss = team;
    this.mustClear = false;
    this.setPhase("check");
    this.shotClock = this.teamShotClock();
    const off = this.teamOf(team), def = this.teamOf((1 - team) as TeamId);
    const offSpots = [SPOTS.check, { x: HOOP.x - 3.2, z: -5.6 }, { x: HOOP.x - 3.2, z: 5.6 }];
    off.forEach((p, i) => { const s = offSpots[i] ?? offSpots[0]; this.place(p, s.x, s.z); });
    def.forEach((p, i) => {
      const o = off[i] ?? off[0];
      const tx = o ? o.x + (HOOP.x - o.x) * 0.22 : SPOTS.checkDefense.x;
      const tz = o ? o.z + (HOOP.z - o.z) * 0.22 : 0;
      this.place(p, tx, tz);
      p.facing = Math.atan2((o?.z ?? 0) - tz, (o?.x ?? 0) - tx);
      p.guard = o?.id ?? null;
    });
    off.forEach((p, i) => { p.guard = def[i]?.id ?? null; });
    const handler = off.find((p) => !p.bot) ?? off[0];
    if (handler) this.give(handler);
    this.emit({ t: "check", team });
  }

  private place(p: SimPlayer, x: number, z: number) {
    p.x = x; p.z = z; p.y = 0; p.vx = 0; p.vz = 0; p.vy = 0;
    p.facing = Math.atan2(HOOP.z - z, HOOP.x - x);
    if (p.action !== "celebrate") p.action = "none";
    p.meter = -1; p.stumbleT = 0;
  }

  private placeIdle(p: SimPlayer, i: number) {
    const spots = [[5, -2], [5, 2], [7, -4], [7, 4], [3, 0], [9, 0]];
    const s = spots[i % spots.length];
    this.place(p, s[0], s[1]);
  }

  // ------------------------------------------------------------------ SHOOTOUT
  static SHOOTOUT_SPOTS = [
    { x: 13.1, z: -6.95 }, { x: HOOP.x - 5.0, z: -5.0 }, { x: HOOP.x - 7.05, z: 0 }, { x: HOOP.x - 5.0, z: 5.0 }, { x: 13.1, z: 6.95 },
  ];

  private spawnShootoutFlight(_p: SimPlayer, money: boolean): Ball {
    const nb = newBall();
    this.extra.push({ ball: nb, life: 0, money, counted: false });
    this.ball.holder = null; this.ball.state = "dead"; this.ball.y = -5;
    this.shootout.giveT = 0.55;
    this.shootout.ball++;
    return nb;
  }

  private updateShootout() {
    const so = this.shootout;
    const p = this.players[0];
    if (!p) return;
    if (this.phase === "pregame") {
      if (this.phaseT < DT * 1.5) { const s = Game.SHOOTOUT_SPOTS[0]; this.place(p, s.x, s.z); }
      if (this.phaseT > 2.2) { this.setPhase("live"); this.give(p); this.emit({ t: "live" }); }
      return;
    }
    if (this.phase === "gameover") return;
    so.left = Math.max(0, so.left - DT);
    // flights
    for (const e of this.extra) {
      e.life += DT;
      const r = stepBall(e.ball, DT);
      for (const h of r.rimHits) if (h.v > 0.4) this.emit({ t: "rim", x: e.ball.x, y: e.ball.y, z: e.ball.z, v: h.v });
      if (r.boardHit > 0.5) this.emit({ t: "board", v: r.boardHit });
      if (r.floorHit > 0) this.emit({ t: "bounce", v: r.floorHit, x: e.ball.x, z: e.ball.z });
      if (r.scored && !e.counted) {
        e.counted = true;
        const pts = e.money ? 2 : 1;
        so.score += pts; p.stats.fgm++; p.stats.pts += pts; if (pts === 2) p.stats.tpm++;
        this.emit({ t: "score", team: 0, pts, by: p.id, kind: "jumpshot", swish: !e.ball.touchedRim && !e.ball.touchedBoard });
      }
    }
    this.extra = this.extra.filter((e) => e.life < 3.5);
    // feed next ball
    if (so.giveT > 0) {
      so.giveT -= DT;
      if (so.giveT <= 0 && so.left > 0 && !so.done) {
        if (so.ball >= SHOOTOUT.ballsPerSpot) {
          so.rack++; so.ball = 0;
          if (so.rack >= SHOOTOUT.spots) so.done = true;
          else { const s = Game.SHOOTOUT_SPOTS[so.rack]; this.place(p, s.x, s.z); }
        }
        if (!so.done) { this.ball.y = 1; this.give(p); }
      }
    }
    this.emitShootoutState();
    if ((so.left <= 0 || so.done) && this.extra.every((e) => e.life > 2.2 || e.counted)) {
      if (this.ball.holder) { this.ball.holder = null; this.ball.state = "dead"; }
      this.winner = 0;
      this.setPhase("gameover");
      this.emit({ t: "gameover", winner: 0, score: [so.score, 0] });
    }
  }

  private lastSoEmit = -1;
  private emitShootoutState() {
    const so = this.shootout;
    const k = so.score * 1000 + so.rack * 10 + so.ball;
    if (k !== this.lastSoEmit) { this.lastSoEmit = k; this.emit({ t: "shootout", score: so.score, rack: so.rack, ball: so.ball }); }
  }

  // ------------------------------------------------------------------ DUNK CONTEST
  private resetDunker(p: SimPlayer) {
    this.place(p, HOOP.x - 8.2, 0);
    this.ball.x = p.x; this.ball.y = 1; this.ball.z = p.z;
    this.give(p);
    this.dunk.resolved = false;
  }

  private scoreDunk(p: SimPlayer) {
    const d = p.actionData || {};
    const parts: string[] = [];
    let s = 5.6;
    const speed = d.startSpeed ?? 0; const sb = clamp(speed / 7, 0, 1) * 0.9; s += sb; if (sb > 0.5) parts.push("Speed");
    if ((d.takeoff ?? 0) > 2.3) { s += 0.6; parts.push("Long takeoff"); }
    if (d.style & 1) { s += 1.1; parts.push("360"); }
    if (d.style & 2) { s += 1.2; parts.push("Windmill"); }
    if ((d.style & 3) === 3) { s += 0.5; parts.push("Combo"); }
    const t = d.timing as ShotTiming | undefined;
    if (t === "perfect") { s += 1.2; parts.push("Perfect finish"); } else if (t === "excellent") { s += 0.7; parts.push("Clean finish"); } else if (t === "good") s += 0.3;
    s += (this.rand() - 0.5) * 0.4;
    s = Math.round(clamp(s, 5, 10) * 10) / 10;
    this.dunk.total = Math.round((this.dunk.total + s) * 10) / 10; this.dunk.last = s;
    this.dunk.resolved = true; this.dunk.resetT = 2.0;
    this.emit({ t: "dunkscore", by: p.id, score: s, parts });
    this.emit({ t: "score", team: 0, pts: 1, by: p.id, kind: "dunk", swish: false });
  }

  private updateDunkContest() {
    const dk = this.dunk;
    const p = this.players[0];
    if (!p) return;
    if (this.phase === "pregame") {
      if (this.phaseT < DT * 1.5) this.resetDunker(p);
      if (this.phaseT > 2.2) { this.setPhase("live"); this.emit({ t: "live" }); }
      return;
    }
    if (this.phase === "gameover") return;
    dk.left = Math.max(0, dk.left - DT);
    if (this.ball.state === "dead" && dk.resolved === false) this.ball.state = "loose";
    // a failed attempt: ball loose and on the floor after the dunk action, or a jumper
    if (!dk.resolved && this.ball.holder === null && p.action !== "dunk" && this.ball.state === "loose" && this.ball.y < 0.4) {
      dk.resolved = true; dk.last = 0; dk.resetT = 1.6;
      this.emit({ t: "dunkscore", by: p.id, score: 0, parts: ["Missed"] });
    }
    if (dk.resolved && dk.resetT > 0) {
      dk.resetT -= DT;
      if (dk.resetT <= 0) {
        dk.attempt++;
        if (dk.attempt >= DUNK_CONTEST.attempts || dk.left <= 0) {
          this.winner = 0; this.setPhase("gameover");
          this.emit({ t: "gameover", winner: 0, score: [Math.round(dk.total), 0] });
          return;
        }
        this.resetDunker(p);
      }
    }
    if (dk.left <= 0 && this.phase === "live" && !dk.resetT) {
      this.winner = 0; this.setPhase("gameover");
      this.emit({ t: "gameover", winner: 0, score: [Math.round(dk.total), 0] });
    }
  }

  // ------------------------------------------------------------------ output
  snapshot(): Snapshot {
    const b = this.ball;
    return {
      tick: this.tick, mode: this.mode, phase: this.phase, score: [...this.score] as [number, number], poss: this.poss,
      clear: this.mustClear, shotClock: Math.max(0, this.shotClock), time: this.matchTime, timeLimit: this.settings.timeLimit,
      phaseT: this.phaseT, winner: this.winner,
      p: this.players.map((p): PlayerSnap => ({
        id: p.id, n: p.name, tm: p.team, bot: p.bot,
        x: r3(p.x), y: r3(p.y), z: r3(p.z), f: r3(p.facing), vx: r3(p.vx), vz: r3(p.vz),
        a: p.action, at: r3(p.actionT), st: r3(p.stamina),
        fl: (b.holder === p.id ? 1 : 0) | (p.stance ? 2 : 0) | (p.sprint ? 4 : 0) | (p.airborne ? 8 : 0) | (p.actionData?.style ? (p.actionData.style << 5) : 0),
        m: r3(p.meter), h: p.hand, ct: Math.round(p.contest * 100) / 100,
        ss: [p.stats.pts, p.stats.reb, p.stats.ast, p.stats.stl, p.stats.blk, p.stats.fgm, p.stats.fga, p.stats.tpm, p.stats.tpa, p.stats.perfect],
      })),
      b: { x: r3(b.x), y: r3(b.y), z: r3(b.z), vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz), s: b.state, h: b.holder },
      extra: this.mode === "shootout"
        ? { shootout: { score: this.shootout.score, rack: this.shootout.rack, ball: this.shootout.ball, left: this.shootout.left } }
        : this.mode === "dunk" ? { dunk: { total: this.dunk.total, attempt: this.dunk.attempt, last: this.dunk.last, left: this.dunk.left } } : undefined,
      ...(this.extra.length ? { xb: this.extra.map((e) => [r3(e.ball.x), r3(e.ball.y), r3(e.ball.z)]) } : {}),
    } as Snapshot;
  }

  result(): MatchResult {
    return {
      mode: this.mode, winner: this.winner, score: [...this.score] as [number, number], duration: Math.round(this.matchTime),
      players: this.players.map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, stats: { ...p.stats } })),
      shootoutScore: this.mode === "shootout" ? this.shootout.score : undefined,
      dunkScore: this.mode === "dunk" ? this.dunk.total : undefined,
    };
  }
}

function r3(v: number) { return Math.round(v * 1000) / 1000; }
