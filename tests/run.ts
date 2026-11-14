// COURTSIDE gameplay tests. Run with: npm test
import { newBall, solveLaunch, stepBall } from "../shared/ball";
import { DT, HOOP, MATCH, shotValueAt } from "../shared/constants";
import { Game, SHOT_DURATION, SHOT_TARGET, gradeTiming, contestLabel } from "../shared/game";
import { defaultSettings, emptyInput, PlayerInput, PlayerSetup } from "../shared/types";

let failures = 0, passes = 0;
function check(name: string, ok: boolean, info = "") {
  if (ok) { passes++; console.log(`  ✓ ${name} ${info}`); } else { failures++; console.log(`  ✗ ${name} ${info}`); }
}

// --------------------------------------------------------------- ball physics
console.log("Ball physics");
function shootFrom(x: number, z: number, ex = 0, ez = 0) {
  const b = newBall();
  const v = solveLaunch(x, 2.4, z, HOOP.x + ex, HOOP.y, HOOP.z + ez, 0.9 + Math.hypot(HOOP.x - x, z) * 0.11);
  Object.assign(b, { x, y: 2.4, z, vx: v.vx, vy: v.vy, vz: v.vz, state: "shot" });
  let scored = false, rim = 0, t = 0;
  while (t < 5) { const r = stepBall(b, DT); t += DT; if (r.scored) scored = true; rim += r.rimHits.length; }
  return { scored, rim, b };
}
for (const [x, z] of [[8.5, 0], [5.5, 0], [9, 4], [12.4, -6.9], [7.5, -3.5], [11, 1]]) {
  check(`dead-center shot from (${x},${z}) goes in`, shootFrom(x, z).scored);
}
{
  const r = shootFrom(7, 0, 0, 0.6);
  check("shot 0.6 m wide misses", !r.scored);
  check("shot 0.6 m long banks off the glass", shootFrom(7, 0, 0.6, 0).b.touchedBoard);
  const r2 = shootFrom(7, 0, -0.5, 0.2);
  check("shot 0.5 m short misses", !r2.scored);
  let makes = 0;
  for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2; if (shootFrom(7, 1, Math.cos(a) * 0.18, Math.sin(a) * 0.18).scored) makes++; }
  check("0.18 m errors: some rattle in, some rim out", makes > 5 && makes < 55, `(${makes}/60 made)`);
  const b = newBall(); Object.assign(b, { x: 5, y: 3, z: 0, vx: 0, vy: 0, vz: 0, state: "loose" });
  let maxBounce = 0; for (let i = 0; i < 480; i++) { const rr = stepBall(b, DT); if (rr.floorHit) maxBounce++; }
  check("dropped ball bounces and settles", maxBounce >= 3 && b.y <= 0.13 && Math.abs(b.vy) < 0.01, `(${maxBounce} bounces)`);
  // backboard
  const bb = newBall(); Object.assign(bb, { x: 11.5, y: 3.4, z: 0.3, vx: 6, vy: 0, vz: 0, state: "shot" });
  let hit = false; for (let i = 0; i < 60; i++) { if (stepBall(bb, DT).boardHit) hit = true; }
  check("ball bounces off the backboard", hit && bb.x < HOOP.boardX);
}

// --------------------------------------------------------------- helpers
function setups(n: number, humans: string[] = []): PlayerSetup[] {
  const out: PlayerSetup[] = [];
  for (let i = 0; i < n * 2; i++) {
    const id = humans[i] ?? `bot${i}`;
    out.push({ id, name: id, team: (i % 2) as 0 | 1, bot: !humans[i], archetype: (["allaround", "sharpshooter", "slasher", "lockdown", "playmaker"] as const)[i % 5] });
  }
  return out;
}
function noNaN(g: Game) { return g.players.every((p) => [p.x, p.y, p.z, p.vx, p.vz].every(Number.isFinite)) && [g.ball.x, g.ball.y, g.ball.z].every(Number.isFinite); }

// --------------------------------------------------------------- bot matches
for (const mode of ["1v1", "2v2", "3v3"] as const) {
  console.log(`${mode} bot match`);
  const size = mode === "1v1" ? 1 : mode === "2v2" ? 2 : 3;
  const s = defaultSettings(mode); s.timeLimit = 0;
  const g = new Game(s, setups(size), 1234);
  const counts: Record<string, number> = {};
  let ok = true;
  for (let i = 0; i < 60 * 60 * 30 && g.phase !== "gameover"; i++) {
    g.step();
    for (const e of g.events) counts[e.t] = (counts[e.t] ?? 0) + 1;
    if (!noNaN(g)) { ok = false; break; }
  }
  const [a, b] = g.score;
  check("no NaN positions", ok);
  check("match finishes", g.phase === "gameover", `score ${a}-${b} in ${Math.round(g.matchTime)}s`);
  check(`winner reached the target (${s.target})`, Math.max(a, b) >= s.target && a !== b);
  const r = g.result();
  const pts = r.players.reduce((acc, p) => acc + p.stats.pts, 0);
  check("player points add up to the score", pts === a + b, `(${pts} vs ${a + b})`);
  console.log("    events:", JSON.stringify(counts));
}

// --------------------------------------------------------------- scripted human: perfect release
console.log("Human shooting");
function human(g: Game, id: string, f: (inp: PlayerInput, t: number) => void) {
  const inp = emptyInput();
  return (t: number) => { const i = { ...g.player(id)!.input }; Object.assign(i, inp); f(i, t); Object.assign(inp, i); g.setInput(id, { ...i }); };
}
function freeShot(release: number, x = 8, z = 0) {
  const g = new Game({ ...defaultSettings("free") }, [{ id: "me", name: "me", team: 0, bot: false, archetype: "sharpshooter" }], 7);
  const me = g.player("me")!;
  me.x = x; me.z = z; me.facing = 0;
  g.ball.state = "held"; g.ball.holder = "me";
  let shotEvent: any = null, scored = false;
  const dur = SHOT_DURATION.jumpshot;
  for (let i = 0; i < 300; i++) {
    const t = i * DT;
    g.setInput("me", { ...emptyInput(), shoot: t < release * dur });
    g.step();
    for (const e of g.events) { if (e.t === "shot") shotEvent = e; if (e.t === "score") scored = true; }
  }
  return { shotEvent, scored };
}
{
  const target = SHOT_TARGET.jumpshot;
  const r = freeShot(target + 0.005);
  check("perfect-timed open jumper is graded PERFECT", r.shotEvent?.timing === "perfect", `(${r.shotEvent?.timing})`);
  check("perfect-timed open jumper goes in", r.scored);
  let perfMakes = 0, earlyMakes = 0;
  for (let i = 0; i < 20; i++) { if (freeShot(target, 6 + (i % 4), -2 + (i % 5)).scored) perfMakes++; }
  for (let i = 0; i < 20; i++) { if (freeShot(target - 0.3, 6 + (i % 4), -2 + (i % 5)).scored) earlyMakes++; }
  check("perfect releases beat very early releases", perfMakes >= 18 && earlyMakes <= 4, `(perfect ${perfMakes}/20, early ${earlyMakes}/20)`);
  const late = freeShot(target + 0.25);
  check("late release is graded LATE", late.shotEvent?.timing === "late");
}

{
  // GREEN = guaranteed: a perfect release goes in even with a defender jumping in your face, from anywhere
  let makes = 0, tries = 0;
  for (const [x, z] of [[8, 0], [5.6, 0], [12.9, -6.9], [7.5, 4.5], [10.5, -2]]) {
    const g = new Game({ ...defaultSettings("free") }, [
      { id: "me", name: "me", team: 0, bot: false, archetype: "playmaker" },
      { id: "d", name: "d", team: 1, bot: false, archetype: "lockdown" }], 3);
    const me = g.player("me")!, d = g.player("d")!;
    me.x = x; me.z = z; me.facing = Math.atan2(-z, HOOP.x - x);
    d.x = x + Math.cos(me.facing) * 0.7; d.z = z + Math.sin(me.facing) * 0.7; d.facing = me.facing + Math.PI;
    g.ball.state = "held"; g.ball.holder = "me";
    let scored = false, timing = "";
    for (let i = 0; i < 300; i++) {
      const t = i * DT;
      g.setInput("me", { ...emptyInput(), shoot: t < SHOT_TARGET.jumpshot * SHOT_DURATION.jumpshot + 0.01, hold: SHOT_TARGET.jumpshot * SHOT_DURATION.jumpshot + 0.005 });
      g.setInput("d", { ...emptyInput(), stance: true, jump: i > 20 ? 1 : 0 });
      g.step();
      for (const e of g.events) { if (e.t === "score") scored = true; if (e.t === "shot") timing = e.timing; }
    }
    tries++; if (scored && timing === "perfect") makes++;
  }
  check("green release always goes in, even heavily contested", makes === tries, `(${makes}/${tries})`);
}

{
  // blocks: the jump goes toward the shooter; jumping while moving away is weak and slows you down
  function jumpTest(awaySpeed: number) {
    const g = new Game({ ...defaultSettings("free") }, [
      { id: "o", name: "o", team: 0, bot: false, archetype: "allaround" },
      { id: "d", name: "d", team: 1, bot: false, archetype: "lockdown" }], 4);
    const o = g.player("o")!, d = g.player("d")!;
    o.x = 7; o.z = 0; d.x = 9; d.z = 0; d.vx = awaySpeed; d.facing = 0;
    g.ball.state = "held"; g.ball.holder = "o";
    const d0 = Math.hypot(o.x - d.x, o.z - d.z);
    let maxY = 0;
    g.setInput("d", { ...emptyInput(), jump: 1 }); g.step();
    let i = 0;
    for (; i < 120 && (i < 5 || d.y > 0); i++) { g.setInput("d", { ...emptyInput(), jump: 1 }); g.step(); maxY = Math.max(maxY, d.y); }
    const closer = d0 - Math.hypot(o.x - d.x, o.z - d.z);
    for (let k = 0; k < 8; k++) { g.setInput("d", { ...emptyInput(), jump: 1, mx: -1 }); g.step(); }
    return { closer, maxY, landSpeed: Math.hypot(d.vx, d.vz) };
  }
  const toward = jumpTest(0), away = jumpTest(3.5);
  check("block jump moves toward the shooter", toward.closer > 0.4, `(${toward.closer.toFixed(2)} m closer)`);
  check("jumping while moving away is lower and slows you after landing", away.maxY < toward.maxY * 0.8 && away.landSpeed < toward.landSpeed * 0.6, `(height ${away.maxY.toFixed(2)} vs ${toward.maxY.toFixed(2)}, speed after ${away.landSpeed.toFixed(2)})`);
}

{
  // contest: every shot reports a contest level, and heavy contests shrink the green window
  const t = SHOT_TARGET.jumpshot;
  check("slightly-off release is green when open", gradeTiming(t + 0.035, t, "jumpshot", 0) === "perfect");
  check("same release is NOT green when heavily contested", gradeTiming(t + 0.035, t, "jumpshot", 0.8) !== "perfect");
  check("dead-on release is still green when smothered", gradeTiming(t + 0.005, t, "jumpshot", 1) === "perfect");
  const g = new Game({ ...defaultSettings("free") }, [{ id: "me", name: "me", team: 0, bot: false, archetype: "playmaker" }, { id: "d", name: "d", team: 1, bot: false, archetype: "lockdown" }], 3);
  const me = g.player("me")!, d = g.player("d")!;
  me.x = 8; me.z = 0; me.facing = 0; d.x = 8.8; d.z = 0; d.facing = Math.PI;
  g.ball.state = "held"; g.ball.holder = "me";
  let ev: any = null;
  for (let i = 0; i < 90; i++) { g.setInput("me", { ...emptyInput(), shoot: i < 40 }); g.setInput("d", { ...emptyInput(), stance: true }); g.step(); for (const e of g.events) if (e.t === "shot") ev = e; }
  check("shot event carries the contest level", ev && ev.contest > 0.35 && ev.contestBy === "d", `(${ev?.contest} → ${contestLabel(ev?.contest ?? 0)})`);
}

{
  // ISO moves
  check("3 points beyond the arc, 2 inside", shotValueAt(HOOP.x - 7.5, 0) === 3 && shotValueAt(HOOP.x - 4, 0) === 2 && shotValueAt(13, 7) === 3);
  const mk = () => {
    const g = new Game({ ...defaultSettings("free") }, [{ id: "o", name: "o", team: 0, bot: false, archetype: "slasher" }, { id: "d", name: "d", team: 1, bot: false, archetype: "lockdown" }], 6);
    const o = g.player("o")!, d = g.player("d")!;
    o.x = 5; o.z = 0; o.facing = 0; d.x = 7.2; d.z = 0; d.facing = Math.PI;
    g.ball.state = "held"; g.ball.holder = "o";
    return { g, o, d };
  };
  // pump fake: tap Space keeps the ball
  {
    const { g, o } = mk();
    for (let i = 0; i < 40; i++) { g.setInput("o", { ...emptyInput(), shoot: i < 5, hold: i < 5 ? 0 : 0.08 }); g.step(); if (o.action === "pumpfake") break; }
    check("tapping shoot is a pump fake (keeps the ball, no shot)", o.action === "pumpfake" && g.ball.holder === "o");
  }
  // drive with nobody set: blows by
  {
    const { g, o, d } = mk();
    d.z = 1.2;
    g.setInput("o", { ...emptyInput(), l: 1 }); g.step();
    for (let i = 0; i < 30; i++) { g.setInput("o", { ...emptyInput(), l: 1, mx: 1 }); g.step(); }
    check("drive bursts toward the rim", o.x > 7.0, `(x ${o.x.toFixed(1)})`);
    void d;
  }
  // drive into a defender who slides into the lane: cut off
  {
    const { g, o, d } = mk();
    d.z = 0.9;
    let cut = false;
    g.setInput("o", { ...emptyInput(), l: 1 }); g.setInput("d", { ...emptyInput(), k: 1, mz: -1 }); g.step();
    for (let i = 0; i < 40; i++) { g.setInput("o", { ...emptyInput(), l: 1, mx: 1 }); g.setInput("d", { ...emptyInput(), k: 1 }); g.step(); for (const e of g.events) if (e.t === "msg" && e.text === "CUT OFF") cut = true; }
    check("sliding into the lane cuts off the drive", cut, `(driver x ${o.x.toFixed(1)})`);
  }
}

// --------------------------------------------------------------- must clear + out of bounds
console.log("Match rules");
{
  const s = defaultSettings("1v1");
  const g = new Game(s, setups(1, ["me"]), 9);
  // run until check phase, then go live
  for (let i = 0; i < 400 && g.phase !== "check"; i++) g.step();
  check("pregame leads to check ball", g.phase === "check");
  const me = g.player("me")!;
  const off = g.poss === me.team;
  for (let i = 0; i < 400 && g.phase !== "live"; i++) g.step();
  check("check leads to live play", g.phase === "live");
  if (off) {
    // walk the handler out of bounds over the sideline
    for (let i = 0; i < 300 && g.phase === "live"; i++) { g.setInput("me", { ...emptyInput(), mx: 0, mz: 1, sprint: true }); g.step(); }
    check("stepping out of bounds is a turnover", g.phase === "dead" || g.events.some((e) => e.t === "turnover"));
  } else {
    // as defender: give the ball to me inside the arc -> must clear
    g.ball.holder = "me"; g.ball.state = "held"; me.x = 10; me.z = 0;
    (g as any).poss = me.team; g.mustClear = true;
    let blocked = false;
    g.setInput("me", { ...emptyInput(), shoot: true }); g.step();
    blocked = me.action !== "jumpshot";
    check("cannot shoot before clearing", blocked);
  }
}
{
  // turnover on shot clock
  const g = new Game(defaultSettings("1v1"), setups(1, ["me", "you"]), 3);
  for (let i = 0; i < 2000 && g.phase !== "live"; i++) { g.step(); }
  let to = false;
  for (let i = 0; i < 60 * (MATCH.shotClock + 2); i++) { g.step(); if (g.events.some((e) => e.t === "turnover" && /clock/i.test(e.why))) to = true; }
  check("shot clock violation fires", to);
}

// --------------------------------------------------------------- shootout & dunk contest
console.log("Shootout");
{
  const g = new Game(defaultSettings("shootout"), [{ id: "me", name: "me", team: 0, bot: false, archetype: "sharpshooter" }], 5);
  let holdStart = -1;
  for (let i = 0; i < 60 * 70 && g.phase !== "gameover"; i++) {
    const me = g.player("me")!;
    const has = g.ball.holder === "me";
    let shoot = false;
    if (has && me.action === "none") { shoot = true; holdStart = i; }
    if (me.action === "jumpshot" && !me.actionData.released) shoot = (i - holdStart) * DT < SHOT_TARGET.jumpshot * SHOT_DURATION.jumpshot;
    g.setInput("me", { ...emptyInput(), shoot });
    g.step();
  }
  check("shootout ends", g.phase === "gameover", `score ${g.shootout.score}, racks ${g.shootout.rack}`);
  check("perfect shooter scores big", g.shootout.score >= 22);
}
console.log("Dunk contest");
{
  const g = new Game(defaultSettings("dunk"), [{ id: "me", name: "me", team: 0, bot: false, archetype: "slasher" }], 5);
  const scores: number[] = [];
  let pressT = 0;
  for (let i = 0; i < 60 * 130 && g.phase !== "gameover"; i++) {
    const me = g.player("me")!;
    const inp = { ...emptyInput() };
    if (g.phase === "live" && g.ball.holder === "me" && me.action === "none") {
      inp.mx = 1; inp.sprint = true;
      const d = Math.hypot(HOOP.x - me.x, me.z);
      if (d < 2.5) { inp.shoot = true; pressT = 0; }
    }
    if (me.action === "dunk") { pressT += DT; inp.shoot = pressT < SHOT_TARGET.dunk * SHOT_DURATION.dunk; inp.move = me.actionT > 0.1 ? 1 : 0; }
    g.setInput("me", inp);
    g.step();
    for (const e of g.events) if (e.t === "dunkscore") scores.push(e.score);
  }
  check("dunk contest ends after 5 attempts", g.phase === "gameover" && scores.length === 5, `scores ${scores.join(", ")}`);
  check("well-timed 360 dunks score 8+", scores.filter((s) => s >= 8).length >= 3);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
