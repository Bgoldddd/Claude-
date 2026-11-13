// End-to-end multiplayer test: starts the real server, connects two real clients.
// Run with: npx tsx tests/server.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, Room } from "@colyseus/sdk";
import { SHOT_DURATION, SHOT_TARGET } from "../shared/game";
import type { Snapshot } from "../shared/types";

const PORT = 2577;
const URL_ = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "courtside-test-"));
let failures = 0, passes = 0;
const check = (n: string, ok: boolean, info = "") => { ok ? passes++ : failures++; console.log(`  ${ok ? "✓" : "✗"} ${n} ${info}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const srv = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, PORT: String(PORT), COURTSIDE_DATA_DIR: dataDir }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let srvOut = "";
srv.stdout.on("data", (d) => (srvOut += d)); srv.stderr.on("data", (d) => (srvOut += d));
async function api(token: string | null, method: string, p: string, body?: any) {
  const r = await fetch(URL_ + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

/** Plays like a simple human: when holding the ball in live play, shoots with a perfect release. */
function autopilot(room: Room, me: string) {
  let seq = 0, shootUntil = 0, holding = false, holdStart = 0, last: Snapshot | null = null;
  const counters = { jump: 0, pass: 0, move: 0, action: 0, interact: 0, emote: 0 };
  room.onMessage("s", (m: any) => { last = m.snap; });
  const iv = setInterval(() => {
    const now = performance.now() / 1000;
    const s = last; if (!s) return;
    const p = s.p.find((x) => x.id === me);
    const hasBall = s.b.h === me;
    if (!holding && hasBall && s.phase === "live" && p && p.a === "none") { holding = true; holdStart = now; shootUntil = now + SHOT_TARGET.jumpshot * SHOT_DURATION.jumpshot; }
    if (s.phase === "check" && hasBall) counters.interact++;
    const shoot = holding && now < shootUntil;
    room.send("in", { seq: seq++, mx: 0, mz: 0, yaw: 0, sprint: false, shoot, stance: false, ...counters, emoteId: 0, hold: holding ? Math.min(now, shootUntil) - holdStart : 0 });
    if (holding && now >= shootUntil + 0.3) holding = false;
  }, 1000 / 30);
  return () => clearInterval(iv);
}

try {
  // wait for the server
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_ + "/api/health")).ok) break; } catch { /* not yet */ } await sleep(250); }
  console.log("Accounts & friends");
  const a = await api(null, "POST", "/api/auth/guest", { name: "Ben" });
  const b = await api(null, "POST", "/api/auth/guest", { name: "Rival_2" });
  check("guest accounts created", !!a.json?.token && !!b.json?.token);
  check("bad names rejected", (await api(null, "POST", "/api/auth/guest", { name: "x" })).status === 400);
  const ta = a.json.token, tb = b.json.token, ida = a.json.profile.id, idb = b.json.profile.id;
  check("unauthenticated calls refused", (await api(null, "GET", "/api/me")).status === 401);
  await api(ta, "POST", "/api/friends/request", { code: b.json.profile.friendCode });
  const soc = await api(tb, "GET", "/api/social");
  check("friend request arrives", soc.json.incoming.length === 1);
  await api(tb, "POST", "/api/friends/respond", { id: soc.json.incoming[0].id, accept: true });
  const socA = await api(ta, "GET", "/api/social");
  check("now friends, with online status", socA.json.friends.length === 1 && socA.json.friends[0].status.online === true);

  console.log("Private room, two clients");
  const ca = new Client(URL_), cb = new Client(URL_);
  const ra = await ca.create("court", { token: ta, mode: "1v1" });
  let rosterB: any = null; let phaseB = "";
  const inv = await api(ta, "POST", "/api/invites", { to: idb, roomId: ra.roomId, mode: "1v1" });
  check("invite sent to friend", !!inv.json?.id);
  const socB = await api(tb, "GET", "/api/social");
  check("friend sees the invite", socB.json.invites.some((i: any) => i.roomId === ra.roomId));
  const rb = await cb.joinById(ra.roomId, { token: tb });
  rb.onMessage("roster", (m: any) => (rosterB = m));
  rb.onMessage("phase", (m: any) => (phaseB = m.phase));
  let snapsB = 0, lastB: Snapshot | null = null;
  rb.onMessage("s", (m: any) => { snapsB++; lastB = m.snap; });
  ra.onMessage("roster", () => {}); ra.onMessage("phase", () => {});
  ["welcome", "toast", "qm", "results", "rematch"].forEach((t) => { ra.onMessage(t, () => {}); rb.onMessage(t, () => {}); });
  await sleep(600);
  check("both players in the room", rosterB?.seats?.length === 2, `(${rosterB?.seats?.map((s: any) => s.name + ":" + s.team).join(", ")})`);
  check("players on opposite teams", new Set(rosterB?.seats?.map((s: any) => s.team)).size === 2);
  check("lobby shootaround snapshots flow", snapsB > 5 && lastB!.p.length === 2);
  // movement sync in lobby: A moves +x, B should see it
  const x0 = lastB!.p.find((p) => p.id === ida)!.x;
  for (let i = 0; i < 30; i++) { ra.send("in", { seq: i, mx: 1, mz: 0, yaw: 0, sprint: true, shoot: false, stance: false, jump: 0, pass: 0, move: 0, action: 0, interact: 0, emote: 0, emoteId: 0, hold: 0 }); await sleep(33); }
  await sleep(200);
  const x1 = lastB!.p.find((p) => p.id === ida)!.x;
  check("B sees A move", x1 - x0 > 2, `(${x0.toFixed(2)} → ${x1.toFixed(2)})`);
  // quick message
  let gotQm: any = null; rb.onMessage("qm", (m: any) => (gotQm = m));
  ra.send("qm", { id: 0 }); await sleep(300);
  check("quick message delivered", gotQm?.name === "Ben");

  // ready up both -> match
  ra.send("ready", { ready: true }); rb.send("ready", { ready: true });
  await sleep(500);
  check("ready-up starts the match", phaseB === "match");

  console.log("Full 1v1 match (both clients shoot perfect releases)");
  let results: any = null; rb.onMessage("results", (m: any) => (results = m));
  let shotTimings: string[] = [];
  rb.onMessage("s", (m: any) => { snapsB++; lastB = m.snap; for (const e of m.ev) if (e.t === "shot") shotTimings.push(e.timing); });
  const stopA = autopilot(ra, ida), stopB = autopilot(rb, idb);
  const t0 = Date.now();
  while (!results && Date.now() - t0 < 240_000) await sleep(250);
  stopA(); stopB();
  check("match reached the end", !!results, results ? `final ${results.result.score.join("-")} in ${Math.round((Date.now() - t0) / 1000)}s` : "");
  const perfect = shotTimings.filter((t) => t === "perfect").length;
  check("network releases graded PERFECT (client hold time works)", perfect / Math.max(1, shotTimings.length) > 0.8, `(${perfect}/${shotTimings.length})`);
  if (results) {
    check("rewards paid by the server", (results.rewards[ida]?.rep ?? 0) > 0 && (results.rewards[idb]?.rep ?? 0) > 0);
    const meA = await api(ta, "GET", "/api/me");
    check("REP saved to the profile", meA.json.rep === results.rewards[ida].rep, `(rep ${meA.json.rep})`);
    const riv = await api(ta, "GET", "/api/rivals");
    check("rivalry recorded", riv.json.length === 1 && riv.json[0].games === 1, JSON.stringify(riv.json[0] && { w: riv.json[0].wins, l: riv.json[0].losses, streak: riv.json[0].streak }));
    const hist = await api(tb, "GET", "/api/matches/me");
    check("match history saved", hist.json.length === 1);
    // rematch
    ra.send("rematch"); rb.send("rematch"); phaseB = "";
    await sleep(500);
    check("rematch starts a new match", phaseB === "match");
  }
  await ra.leave(); await rb.leave();

  console.log("Solo shootout on the server");
  const solo = await ca.create("court", { token: ta, mode: "shootout", solo: true });
  let soloRes: any = null; solo.onMessage("results", (m: any) => (soloRes = m));
  ["roster", "phase", "welcome", "toast", "qm", "rematch"].forEach((t) => solo.onMessage(t, () => {}));
  const stopS = autopilot(solo, ida);
  const t1 = Date.now();
  while (!soloRes && Date.now() - t1 < 90_000) await sleep(250);
  stopS();
  check("shootout finished on the server", !!soloRes, soloRes ? `score ${soloRes.result.shootoutScore}` : "");
  const lb = await api(ta, "GET", "/api/leaderboard?by=shootout");
  check("shootout best on the leaderboard", lb.json.rows[0]?.value === soloRes?.result.shootoutScore);
  await solo.leave();

  console.log("Persistence");
  await sleep(500);
  const file = path.join(dataDir, "db.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  check("db.json written to disk", Object.keys(saved.profiles).length === 2 && saved.matches.length >= 2);
} catch (e) {
  failures++;
  console.error("TEST ERROR", e);
} finally {
  try { process.kill(-srv.pid!, "SIGTERM"); } catch { srv.kill(); }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) console.log(srvOut.slice(-3000));
  process.exit(failures ? 1 : 0);
}
