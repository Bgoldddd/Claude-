// One Colyseus room = one court. Lobby (shootaround + ready-up) -> server-run match -> results -> rematch.
import { Room, Client } from "colyseus";
import { Game } from "../shared/game";
import { DT, MODE_INFO, Mode, TEAM_MODES } from "../shared/constants";
import { defaultSettings, emptyInput, GameEvent, MatchSettings, PlayerInput, PlayerSetup, TeamId } from "../shared/types";
import { computeReward, rankFor } from "../shared/progression";
import { defaultLoadout, JERSEY_COLORS, Loadout, TRIM_COLORS, HAIR_COLORS, SKIN_TONES } from "../shared/cosmetics";
import { db, Profile } from "./db";
import { presence } from "./social";
import { publicProfile } from "./api";

interface Seat { sid: string; id: string; name: string; team: TeamId; ready: boolean; connected: boolean; loadout: Loadout; rank: string; rankColor: string }
type RoomPhase = "lobby" | "match" | "results";

const BOT_NAMES = ["Ace", "Blaze", "Dre", "Juice", "Kilo", "Moose", "Nitro", "Pistol", "Rook", "Slim", "Tank", "Vega", "Hops", "Smoke", "Lefty", "Biscuit"];
const ARCHS = ["sharpshooter", "slasher", "lockdown", "playmaker", "allaround"] as const;
const MODES: Mode[] = ["1v1", "2v2", "3v3", "shootout", "dunk"];

export class CourtRoom extends Room {
  maxClients = 6;
  phase: RoomPhase = "lobby";
  seats = new Map<string, Seat>(); // by sessionId
  settings: MatchSettings = defaultSettings("1v1");
  fillBots = true;
  court = "the_block";
  hostSid: string | null = null;
  visibility: "public" | "private" | "solo" = "private";
  game!: Game;
  botLoadouts = new Map<string, Loadout>();
  pendingEvents: GameEvent[] = [];
  acc = 0;
  snapCounter = 0;
  resultSent = false;
  gameoverT = 0;
  rematchVotes = new Set<string>();
  lastQm = new Map<string, number>();
  inputCount = new Map<string, { n: number; t: number }>();
  publicWaitT = 0;

  onCreate(options: any) {
    const mode: Mode = MODES.includes(options?.mode) ? options.mode : "1v1";
    this.settings = { ...defaultSettings(mode), difficulty: ["rookie", "pro", "legend"].includes(options?.difficulty) ? options.difficulty : "pro" };
    this.visibility = options?.solo ? "solo" : options?.public ? "public" : "private";
    this.court = typeof options?.court === "string" ? options.court.slice(0, 20) : "the_block";
    if (this.visibility === "solo") this.maxClients = 1;
    if (this.visibility === "public") this.maxClients = MODE_INFO[mode].size * 2;
    if (this.visibility !== "public") this.setPrivate(true);
    this.game = new Game(defaultSettings("free"), []);
    this.updateMeta();

    this.onMessage("in", (c: Client, m: any) => this.onInput(c, m));
    this.onMessage("team", (c: Client, m: any) => {
      const s = this.seats.get(c.sessionId); if (!s || this.phase !== "lobby") return;
      const t: TeamId = m?.team === 1 ? 1 : 0;
      const size = MODE_INFO[this.settings.mode].size;
      if (TEAM_MODES.includes(this.settings.mode) && this.humansOn(t).length >= size) { c.send("toast", { text: "That team is full" }); return; }
      s.team = t; s.ready = false; this.syncLobbyGame(); this.sendRoster();
    });
    this.onMessage("ready", (c: Client, m: any) => {
      const s = this.seats.get(c.sessionId); if (!s || this.phase !== "lobby") return;
      s.ready = !!m?.ready; this.sendRoster(); this.maybeAutoStart();
    });
    this.onMessage("settings", (c: Client, m: any) => {
      if (c.sessionId !== this.hostSid || this.phase !== "lobby" || this.visibility === "public") return;
      if (MODES.includes(m?.mode) && m.mode !== "shootout" && m.mode !== "dunk") this.settings.mode = m.mode;
      if (m?.rule === "losers" || m?.rule === "winners") this.settings.rule = m.rule;
      if (["rookie", "pro", "legend"].includes(m?.difficulty)) this.settings.difficulty = m.difficulty;
      if ([7, 11, 15, 21].includes(m?.target)) this.settings.target = m.target;
      if ([0, 300, 600, 900].includes(m?.timeLimit)) this.settings.timeLimit = m.timeLimit;
      if (typeof m?.fillBots === "boolean") this.fillBots = m.fillBots;
      if (typeof m?.court === "string") this.court = m.court.slice(0, 20);
      // keep teams legal for the new size
      const size = MODE_INFO[this.settings.mode].size;
      for (const t of [0, 1] as TeamId[]) { const hs = this.humansOn(t); hs.slice(size).forEach((s) => (s.team = (1 - t) as TeamId)); }
      for (const s of this.seats.values()) s.ready = false;
      this.updateMeta(); this.sendRoster();
    });
    this.onMessage("start", (c: Client) => { if (c.sessionId === this.hostSid && this.phase === "lobby") this.tryStart(true, c); });
    this.onMessage("qm", (c: Client, m: any) => {
      const s = this.seats.get(c.sessionId); if (!s) return;
      const now = Date.now(); if (now - (this.lastQm.get(c.sessionId) ?? 0) < 1500) return;
      this.lastQm.set(c.sessionId, now);
      const id = Math.max(0, Math.min(7, Math.round(Number(m?.id) || 0)));
      this.broadcast("qm", { from: s.id, name: s.name, id });
    });
    this.onMessage("rematch", (c: Client) => {
      if (this.phase !== "results") return;
      this.rematchVotes.add(c.sessionId);
      this.broadcast("rematch", { votes: this.rematchVotes.size, need: this.connectedSeats().length });
      if (this.connectedSeats().every((s) => this.rematchVotes.has(s.sid))) this.startMatch();
    });
    this.onMessage("lobby", (c: Client) => {
      if (this.phase === "results" && (c.sessionId === this.hostSid || this.visibility === "solo")) this.backToLobby();
    });

    // fixed-step simulation (60 Hz), snapshots at 20 Hz
    this.setSimulationInterval((dtMs: number) => this.tick(dtMs), 1000 / 60);
  }

  onAuth(_client: Client, options: any) {
    const p = db.byToken(options?.token);
    if (!p) throw new Error("Not signed in");
    return p;
  }

  onJoin(client: Client, _options: any, auth: Profile) {
    const prof = auth ?? db.byToken(_options?.token);
    if (!prof) { client.leave(); return; }
    // the same profile joining twice (e.g. two tabs) replaces the old seat
    for (const s of this.seats.values()) if (s.id === prof.id) { this.seats.delete(s.sid); this.game.removePlayer(s.id); }
    const size = MODE_INFO[this.settings.mode].size;
    const team: TeamId = this.humansOn(0).length <= this.humansOn(1).length && this.humansOn(0).length < size ? 0 : 1;
    const r = rankFor(prof.rep);
    const seat: Seat = { sid: client.sessionId, id: prof.id, name: prof.name, team, ready: false, connected: true, loadout: prof.loadout ?? defaultLoadout(), rank: r.name, rankColor: r.color };
    this.seats.set(client.sessionId, seat);
    if (!this.hostSid || !this.seats.has(this.hostSid)) this.hostSid = client.sessionId;
    presence.setRoom(prof.id, { roomId: this.roomId, mode: this.settings.mode, phase: this.phase });
    client.send("welcome", { you: prof.id, roomId: this.roomId, visibility: this.visibility, phase: this.phase });
    if (this.phase === "lobby") this.syncLobbyGame();
    this.sendRoster();
    this.updateMeta();
    if (this.visibility === "solo") this.startMatch();
  }

  async onDrop(client: Client) {
    const s = this.seats.get(client.sessionId);
    if (!s) return;
    s.connected = false; this.sendRoster();
    try { await this.allowReconnection(client, 20); } catch { /* gave up; onLeave runs */ }
  }

  onReconnect(client: Client) {
    const s = this.seats.get(client.sessionId);
    if (s) { s.connected = true; this.sendRoster(); client.send("welcome", { you: s.id, roomId: this.roomId, visibility: this.visibility, phase: this.phase }); }
  }

  onLeave(client: Client) {
    const s = this.seats.get(client.sessionId);
    if (!s) return;
    this.seats.delete(client.sessionId);
    presence.setRoom(s.id, null);
    this.rematchVotes.delete(client.sessionId);
    if (this.phase === "match") {
      this.game.botTakeover(s.id);
      this.broadcast("toast", { text: `${s.name} left — CPU takes over` });
    } else {
      this.game.removePlayer(s.id);
    }
    if (this.hostSid === client.sessionId) this.hostSid = this.seats.keys().next().value ?? null;
    this.sendRoster(); this.updateMeta();
    if (this.phase === "results" && this.connectedSeats().length && this.connectedSeats().every((x) => this.rematchVotes.has(x.sid))) this.startMatch();
  }

  onDispose() { for (const s of this.seats.values()) presence.setRoom(s.id, null); }

  // ------------------------------------------------------------------ helpers
  humansOn(t: TeamId) { return Array.from(this.seats.values()).filter((s) => s.team === t); }
  connectedSeats() { return Array.from(this.seats.values()).filter((s) => s.connected); }

  updateMeta() {
    this.setMetadata({ mode: this.settings.mode, visibility: this.visibility, phase: this.phase, humans: this.seats.size, court: this.court } as any);
    for (const s of this.seats.values()) presence.setRoom(s.id, { roomId: this.roomId, mode: this.settings.mode, phase: this.phase });
  }

  sendRoster() {
    const bots = this.game.players.filter((p) => p.bot && !Array.from(this.seats.values()).some((s) => s.id === p.id));
    this.broadcast("roster", {
      phase: this.phase, host: this.seats.get(this.hostSid ?? "")?.id ?? null, visibility: this.visibility,
      settings: this.settings, fillBots: this.fillBots, court: this.court,
      seats: Array.from(this.seats.values()).map(({ sid: _sid, ...s }) => s),
      bots: bots.map((b) => ({ id: b.id, name: b.name, team: b.team, loadout: this.botLoadouts.get(b.id) ?? defaultLoadout() })),
    });
  }

  /** Lobby: everyone shoots around on the court with one ball. */
  syncLobbyGame() {
    const ids = new Set(Array.from(this.seats.values()).map((s) => s.id));
    for (const p of [...this.game.players]) if (!ids.has(p.id)) this.game.removePlayer(p.id);
    for (const s of this.seats.values()) {
      const p = this.game.player(s.id);
      if (!p) this.game.addPlayer({ id: s.id, name: s.name, team: s.team, bot: false, archetype: s.loadout.archetype });
      else p.team = s.team;
    }
  }

  onInput(c: Client, m: any) {
    const s = this.seats.get(c.sessionId);
    if (!s || typeof m !== "object" || !m) return;
    const now = Date.now(); const ic = this.inputCount.get(c.sessionId) ?? { n: 0, t: now };
    if (now - ic.t > 1000) { ic.n = 0; ic.t = now; }
    if (++ic.n > 150) return; // flood guard
    this.inputCount.set(c.sessionId, ic);
    const num = (v: any, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
    const inp: PlayerInput = {
      ...emptyInput(),
      seq: num(m.seq, 0, 1e9), mx: num(m.mx, -1, 1), mz: num(m.mz, -1, 1), yaw: num(m.yaw, -10, 10),
      sprint: !!m.sprint, shoot: !!m.shoot, stance: !!m.stance,
      jump: num(m.jump, 0, 1e9), pass: num(m.pass, 0, 1e9), move: num(m.move, 0, 1e9), action: num(m.action, 0, 1e9),
      interact: num(m.interact, 0, 1e9), emote: num(m.emote, 0, 1e9), emoteId: num(m.emoteId, 0, 7), hold: num(m.hold, 0, 3),
    };
    this.game.setInput(s.id, inp);
  }

  maybeAutoStart() {
    if (this.phase !== "lobby") return;
    const seats = Array.from(this.seats.values());
    if (seats.length === 0) return;
    if (this.visibility === "public") {
      const full = seats.length >= MODE_INFO[this.settings.mode].size * 2;
      if (full || (seats.length >= 2 && seats.every((s) => s.ready))) this.tryStart(false);
      return;
    }
    if (seats.every((s) => s.ready) && seats.length >= 1) this.tryStart(false);
  }

  tryStart(force: boolean, by?: Client) {
    const size = MODE_INFO[this.settings.mode].size;
    if (TEAM_MODES.includes(this.settings.mode)) {
      for (const t of [0, 1] as TeamId[]) if (this.humansOn(t).length > size) { by?.send("toast", { text: "Too many players on one team" }); return; }
      if (!this.fillBots && (this.humansOn(0).length < size || this.humansOn(1).length < size)) { by?.send("toast", { text: "Teams aren't full. Turn on CPU fill or wait for players." }); return; }
    }
    if (!force && !Array.from(this.seats.values()).every((s) => s.ready)) return;
    this.startMatch();
  }

  startMatch() {
    const mode = this.settings.mode;
    const size = MODE_INFO[mode].size;
    const setups: PlayerSetup[] = [];
    const seats = Array.from(this.seats.values());
    this.botLoadouts.clear();
    if (mode === "shootout" || mode === "dunk") {
      const s = seats[0]; if (!s) return;
      setups.push({ id: s.id, name: s.name, team: 0, bot: false, archetype: s.loadout.archetype });
    } else {
      let bi = Math.floor(Math.random() * BOT_NAMES.length);
      for (const t of [0, 1] as TeamId[]) {
        const hs = seats.filter((s) => s.team === t).slice(0, size);
        for (const s of hs) setups.push({ id: s.id, name: s.name, team: t, bot: false, archetype: s.loadout.archetype });
        for (let k = hs.length; k < size; k++) {
          const id = `cpu-${t}-${k}`;
          const arch = ARCHS[Math.floor(Math.random() * ARCHS.length)];
          setups.push({ id, name: BOT_NAMES[bi++ % BOT_NAMES.length], team: t, bot: true, archetype: arch });
          this.botLoadouts.set(id, randomLoadout(arch));
        }
      }
    }
    this.game = new Game({ ...this.settings }, setups, (Math.random() * 2 ** 31) | 0);
    this.phase = "match";
    this.resultSent = false; this.gameoverT = 0;
    this.rematchVotes.clear();
    for (const s of this.seats.values()) s.ready = false;
    if (this.visibility === "public") this.lock();
    this.updateMeta();
    this.sendRoster();
    this.broadcast("phase", { phase: "match", settings: this.settings });
  }

  backToLobby() {
    this.phase = "lobby";
    this.game = new Game(defaultSettings("free"), []);
    this.syncLobbyGame();
    if (this.visibility !== "solo") this.unlock();
    this.updateMeta(); this.sendRoster();
    this.broadcast("phase", { phase: "lobby" });
  }

  // ------------------------------------------------------------------ simulation
  tick(dtMs: number) {
    this.acc += Math.min(dtMs, 250) / 1000;
    let steps = 0;
    while (this.acc >= DT && steps < 5) {
      this.game.step();
      if (this.game.events.length) this.pendingEvents.push(...this.game.events);
      this.acc -= DT; steps++;
      this.snapCounter++;
      if (this.snapCounter >= 3) {
        this.snapCounter = 0;
        this.broadcast("s", { snap: this.game.snapshot(), ev: this.pendingEvents });
        this.pendingEvents = [];
      }
    }
    if (this.phase === "match" && this.game.phase === "gameover" && !this.resultSent) {
      this.gameoverT += dtMs / 1000;
      if (this.gameoverT > 2.5) this.finishMatch();
    }
    if (this.phase === "lobby" && this.visibility === "public" && this.seats.size >= 1) {
      // quick match: wait up to 40 s for real players, then fill with CPU
      this.publicWaitT += dtMs / 1000;
      if (this.publicWaitT > 40) { this.publicWaitT = 0; this.startMatch(); }
    } else this.publicWaitT = 0;
  }

  /** Server validates and saves the result, then pays out rewards. Clients never decide scores or rewards. */
  finishMatch() {
    this.resultSent = true;
    const result = this.game.result();
    const rec = db.recordMatch(result);
    const rewards: Record<string, any> = {};
    for (const p of result.players) {
      if (p.bot) continue;
      const prof = db.get(p.id); if (!prof) continue;
      const before = rankFor(prof.rep);
      const rw = computeReward(result, p.id);
      prof.rep += rw.rep; prof.coins += rw.coins;
      const after = rankFor(prof.rep);
      rewards[p.id] = { ...rw, rankUp: after.index > before.index ? after.name : null, rank: after, coins: prof.coins, rivalry: null as any };
    }
    // rivalry views for 1v1 to show on the results screen
    const humans = result.players.filter((p) => !p.bot);
    for (const a of humans) {
      const opp = humans.find((b) => b.team !== a.team);
      if (opp && rewards[a.id]) rewards[a.id].rivalry = { ...db.rivalryView(a.id, opp.id), name: opp.name };
    }
    db.save();
    this.phase = "results";
    this.updateMeta();
    this.broadcast("results", { result, rewards, matchId: rec.id, profiles: Object.fromEntries(humans.map((h) => [h.id, publicProfile(db.get(h.id)!)])) });
  }
}

function randomLoadout(arch: (typeof ARCHS)[number]): Loadout {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return {
    ...defaultLoadout(), archetype: arch,
    skin: Math.floor(Math.random() * SKIN_TONES.length),
    hair: pick(["none", "Hair_Buzz", "Hair_Fade", "Hair_Braids", "Hair_Twists", "Hair_Afro"]),
    hairColor: pick(HAIR_COLORS.slice(0, 4)),
    jerseyColor: pick(JERSEY_COLORS).color, jerseyTrim: pick(TRIM_COLORS), jerseyNumber: Math.floor(Math.random() * 60),
    shortsColor: pick(["#1e1f22", "#ecebe6", "#7d7b76", "#1f4fa3"]), shortsTrim: pick(TRIM_COLORS),
    shoe: pick(["shoe_classic", "shoe_white", "shoe_ember", "shoe_concrete", "shoe_volt"]),
    accessories: Math.random() < 0.4 ? [pick(["Acc_Headband", "Acc_Wristband", "Acc_ArmSleeve", "Acc_KneeSleeve"])] : [],
    height: 0.96 + Math.random() * 0.08,
  };
}
