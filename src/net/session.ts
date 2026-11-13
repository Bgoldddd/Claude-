// A Session is "a running court": either an online Colyseus room or an offline local game.
// The renderer only talks to this interface.
import { Client, Room } from "@colyseus/sdk";
import { Game } from "../../shared/game";
import { DT, Mode } from "../../shared/constants";
import { defaultSettings, GameEvent, MatchSettings, PlayerInput, PlayerSetup, Snapshot } from "../../shared/types";
import { Loadout, defaultLoadout } from "../../shared/cosmetics";
import { SERVER_URL, auth } from "./api";

export interface RosterSeat { id: string; name: string; team: 0 | 1; ready: boolean; connected: boolean; loadout: Loadout; rank: string; rankColor: string }
export interface Roster {
  phase: "lobby" | "match" | "results"; host: string | null; visibility: "public" | "private" | "solo" | "offline";
  settings: MatchSettings; fillBots: boolean; court: string; seats: RosterSeat[];
  bots: { id: string; name: string; team: 0 | 1; loadout: Loadout }[];
}

export interface TimedSnap { t: number; snap: Snapshot }

export abstract class Session {
  me = "";
  roster: Roster | null = null;
  snaps: TimedSnap[] = [];
  results: any = null;
  online = false;
  roomId = "";
  listeners: { [k: string]: ((d: any) => void)[] } = {};
  on(ev: string, fn: (d: any) => void) { (this.listeners[ev] ??= []).push(fn); return () => { this.listeners[ev] = this.listeners[ev].filter((f) => f !== fn); }; }
  protected fire(ev: string, d?: any) { for (const f of this.listeners[ev] ?? []) f(d); }
  protected pushSnap(snap: Snapshot, ev: GameEvent[]) {
    this.snaps.push({ t: performance.now(), snap });
    if (this.snaps.length > 30) this.snaps.shift();
    if (ev.length) this.fire("events", ev);
    this.fire("snap", snap);
  }
  abstract sendInput(i: PlayerInput): void;
  abstract send(type: string, data?: any): void;
  abstract leave(): void;
  abstract update(dt: number): void;
}

// ---------------------------------------------------------------- online
export class OnlineSession extends Session {
  online = true;
  private lastSend = 0;
  private lastInput: PlayerInput | null = null;
  private constructor(public room: Room) {
    super();
    this.roomId = room.roomId;
    room.onMessage("welcome", (m: any) => { this.me = m.you; this.fire("welcome", m); });
    room.onMessage("roster", (m: Roster) => { this.roster = m; this.fire("roster", m); });
    room.onMessage("s", (m: any) => this.pushSnap(m.snap, m.ev));
    room.onMessage("phase", (m: any) => { if (m.phase !== "results") this.results = null; this.snaps = []; this.fire("phase", m); });
    room.onMessage("results", (m: any) => { this.results = m; this.fire("results", m); });
    room.onMessage("toast", (m: any) => this.fire("toast", m));
    room.onMessage("qm", (m: any) => this.fire("qm", m));
    room.onMessage("rematch", (m: any) => this.fire("rematch", m));
    room.onLeave((code: number) => this.fire("left", code));
    room.onError((code: number, msg?: string) => this.fire("error", { code, msg }));
  }

  static client() { return new Client(SERVER_URL); }

  static async create(opts: { mode: Mode; solo?: boolean; public?: boolean; difficulty?: string; court?: string }) {
    const c = OnlineSession.client();
    const room = opts.public
      ? await c.joinOrCreate("court", { token: auth.token, mode: opts.mode, public: true, visibility: "public", court: opts.court })
      : await c.create("court", { token: auth.token, ...opts, visibility: opts.solo ? "solo" : "private" });
    return new OnlineSession(room);
  }
  static async join(roomId: string) {
    const room = await OnlineSession.client().joinById(roomId.trim(), { token: auth.token });
    return new OnlineSession(room);
  }

  sendInput(i: PlayerInput) {
    const now = performance.now();
    const changed = !this.lastInput || i.shoot !== this.lastInput.shoot || i.stance !== this.lastInput.stance || i.jump !== this.lastInput.jump
      || i.pass !== this.lastInput.pass || i.move !== this.lastInput.move || i.action !== this.lastInput.action || i.interact !== this.lastInput.interact || i.emote !== this.lastInput.emote
      || i.sprint !== this.lastInput.sprint;
    if (changed || now - this.lastSend > 1000 / 30) {
      this.room.send("in", i);
      this.lastSend = now; this.lastInput = i;
    }
  }
  send(type: string, data?: any) { this.room.send(type, data ?? {}); }
  leave() { try { this.room.leave(); } catch { /* already gone */ } }
  update() { /* network driven */ }
}

// ---------------------------------------------------------------- offline (no server): same simulation, no rewards
export class LocalSession extends Session {
  game: Game;
  private acc = 0;
  private input: PlayerInput | null = null;
  private evBuf: GameEvent[] = [];
  private gameoverT = 0;
  constructor(mode: Mode, difficulty: MatchSettings["difficulty"], public loadout: Loadout, name: string, court = "the_block") {
    super();
    this.me = "local-player";
    const settings = { ...defaultSettings(mode), difficulty };
    const size = mode === "1v1" ? 1 : mode === "2v2" ? 2 : mode === "3v3" ? 3 : 1;
    const setups: PlayerSetup[] = [{ id: this.me, name, team: 0, bot: false, archetype: loadout.archetype }];
    const botNames = ["Ace", "Blaze", "Dre", "Juice", "Kilo", "Moose"];
    if (mode !== "shootout" && mode !== "dunk") {
      for (let i = 1; i < size; i++) setups.push({ id: `cpu-0-${i}`, name: botNames[i], team: 0, bot: true, archetype: "allaround" });
      for (let i = 0; i < size; i++) setups.push({ id: `cpu-1-${i}`, name: botNames[3 + i], team: 1, bot: true, archetype: (["slasher", "sharpshooter", "lockdown"] as const)[i] });
    }
    this.game = new Game(settings, setups);
    this.roster = {
      phase: "match", host: this.me, visibility: "offline", settings, fillBots: true, court,
      seats: [{ id: this.me, name, team: 0, ready: true, connected: true, loadout, rank: "Offline", rankColor: "#888" }],
      bots: setups.filter((s) => s.bot).map((s, i) => ({ id: s.id, name: s.name, team: s.team, loadout: { ...defaultLoadout(), jerseyColor: s.team === 0 ? loadout.jerseyColor : "#1e1f22", jerseyNumber: 10 + i * 7, skin: (i * 2) % 7, hair: ["Hair_Buzz", "Hair_Afro", "Hair_Braids", "Hair_Twists"][i % 4] } })),
    };
    setTimeout(() => { this.fire("welcome", { you: this.me }); this.fire("roster", this.roster); this.fire("phase", { phase: "match" }); }, 0);
  }
  sendInput(i: PlayerInput) { this.input = i; }
  send(type: string) {
    if (type === "rematch") { this.game.reset(); this.results = null; this.gameoverT = 0; this.fire("phase", { phase: "match" }); }
  }
  leave() { /* nothing to close */ }
  update(dt: number) {
    if (this.input) this.game.setInput(this.me, this.input);
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= DT) {
      this.game.step();
      this.evBuf.push(...this.game.events);
      this.acc -= DT;
    }
    this.pushSnap(this.game.snapshot(), this.evBuf);
    this.evBuf = [];
    if (this.game.phase === "gameover" && !this.results) {
      this.gameoverT += dt;
      if (this.gameoverT > 2.5) {
        this.results = { result: this.game.result(), rewards: {}, offline: true };
        this.fire("results", this.results);
      }
    }
  }
}
