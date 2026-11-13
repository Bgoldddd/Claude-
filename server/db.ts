// COURTSIDE data store.
// Saves to server/data/db.json on the machine running the server (real persistence,
// survives restarts). The same tables exist in supabase/schema.sql for a hosted setup.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { defaultLoadout, Loadout } from "../shared/cosmetics";
import { emptyStats, PlayerStats, MatchResult, TeamId } from "../shared/types";

export interface Profile {
  id: string;
  name: string;
  friendCode: string;
  tokenHash: string;
  createdAt: number;
  rep: number;
  coins: number;
  loadout: Loadout;
  owned: string[];
  settings: Record<string, unknown>;
  stats: PlayerStats & { games: number; wins: number; losses: number; streak: number; bestStreak: number; shootoutBest: number; dunkBest: number };
  blocked: string[];
}

export interface FriendRequest { id: string; from: string; to: string; at: number }
export interface MatchRecord {
  id: string; at: number; mode: string; winner: TeamId | -1; score: [number, number]; duration: number;
  players: { id: string; name: string; team: TeamId; bot: boolean; pts: number; reb: number; ast: number; stl: number; blk: number }[];
  extraScore?: number;
}
export interface Rivalry {
  a: string; b: string; aWins: number; bWins: number; streakOwner: string | null; streak: number; bestA: number; bestB: number;
  recent: { at: number; winner: string; score: [number, number]; mode: string }[];
}
export interface Report { id: string; from: string; target: string; reason: string; at: number }

interface Data {
  version: 1;
  profiles: Record<string, Profile>;
  friends: Record<string, string[]>; // id -> friend ids
  requests: FriendRequest[];
  matches: MatchRecord[];
  rivalries: Record<string, Rivalry>; // key "a|b" with a < b
  reports: Report[];
}

const DATA_DIR = process.env.COURTSIDE_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const FILE = path.join(DATA_DIR, "db.json");

export const newStats = () => ({ ...emptyStats(), games: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, shootoutBest: 0, dunkBest: 0 });

class Store {
  data: Data;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      try { this.data = JSON.parse(fs.readFileSync(FILE, "utf8")); }
      catch (e) {
        const bad = FILE + ".corrupt-" + Date.now();
        fs.copyFileSync(FILE, bad);
        console.error(`[db] could not read ${FILE}; saved a copy to ${bad} and started fresh`);
        this.data = Store.empty();
      }
    } else this.data = Store.empty();
  }

  static empty(): Data { return { version: 1, profiles: {}, friends: {}, requests: [], matches: [], rivalries: {}, reports: [] }; }

  /** Debounced atomic write (temp file + rename). */
  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, FILE);
  }

  // ---------------------------------------------------------------- profiles
  static hash(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }

  createProfile(name: string): { profile: Profile; token: string } {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString("hex");
    let code = "";
    do { code = "CS-" + crypto.randomBytes(3).toString("hex").toUpperCase(); } while (Object.values(this.data.profiles).some((p) => p.friendCode === code));
    const profile: Profile = {
      id, name, friendCode: code, tokenHash: Store.hash(token), createdAt: Date.now(), rep: 0, coins: 150,
      loadout: defaultLoadout(), owned: [], settings: {}, stats: newStats(), blocked: [],
    };
    this.data.profiles[id] = profile;
    this.data.friends[id] = [];
    this.save();
    return { profile, token };
  }

  byToken(token: string | undefined | null): Profile | null {
    if (!token || typeof token !== "string" || token.length > 200) return null;
    const h = Store.hash(token);
    for (const p of Object.values(this.data.profiles)) if (p.tokenHash === h) return p;
    return null;
  }
  get(id: string) { return this.data.profiles[id] ?? null; }
  byCode(code: string) { return Object.values(this.data.profiles).find((p) => p.friendCode === code.trim().toUpperCase()) ?? null; }

  // ---------------------------------------------------------------- friends
  friendsOf(id: string) { return this.data.friends[id] ?? []; }
  areFriends(a: string, b: string) { return this.friendsOf(a).includes(b); }
  addFriendship(a: string, b: string) {
    this.data.friends[a] = Array.from(new Set([...(this.data.friends[a] ?? []), b]));
    this.data.friends[b] = Array.from(new Set([...(this.data.friends[b] ?? []), a]));
    this.save();
  }
  removeFriendship(a: string, b: string) {
    this.data.friends[a] = this.friendsOf(a).filter((x) => x !== b);
    this.data.friends[b] = this.friendsOf(b).filter((x) => x !== a);
    this.save();
  }

  // ---------------------------------------------------------------- matches, stats, rivalries
  recordMatch(r: MatchResult): MatchRecord {
    const rec: MatchRecord = {
      id: crypto.randomUUID(), at: Date.now(), mode: r.mode, winner: r.winner, score: r.score, duration: r.duration,
      players: r.players.map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, pts: p.stats.pts, reb: p.stats.reb, ast: p.stats.ast, stl: p.stats.stl, blk: p.stats.blk })),
      extraScore: r.shootoutScore ?? r.dunkScore,
    };
    this.data.matches.push(rec);
    if (this.data.matches.length > 5000) this.data.matches.splice(0, this.data.matches.length - 5000);

    for (const pl of r.players) {
      if (pl.bot) continue;
      const prof = this.get(pl.id);
      if (!prof) continue;
      const s = prof.stats;
      for (const k of Object.keys(pl.stats) as (keyof PlayerStats)[]) (s as any)[k] = ((s as any)[k] ?? 0) + pl.stats[k];
      if (r.mode === "shootout") s.shootoutBest = Math.max(s.shootoutBest, r.shootoutScore ?? 0);
      else if (r.mode === "dunk") s.dunkBest = Math.max(s.dunkBest, r.dunkScore ?? 0);
      else if (r.winner !== -1) {
        s.games++;
        if (r.winner === pl.team) { s.wins++; s.streak = Math.max(1, s.streak + 1); s.bestStreak = Math.max(s.bestStreak, s.streak); }
        else { s.losses++; s.streak = Math.min(-1, s.streak - 1); }
      }
    }
    // head-to-head rivalries between humans on opposite teams
    if (r.winner !== -1 && (r.mode === "1v1" || r.mode === "2v2" || r.mode === "3v3")) {
      const humans = r.players.filter((p) => !p.bot);
      for (const x of humans) for (const y of humans) {
        if (x.id >= y.id || x.team === y.team) continue;
        const winner = r.winner === x.team ? x.id : y.id;
        this.updateRivalry(x.id, y.id, winner, r.score, r.mode, x.team);
      }
    }
    this.save();
    return rec;
  }

  private updateRivalry(a: string, b: string, winner: string, score: [number, number], mode: string, aTeam: TeamId) {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const [ka, kb] = a < b ? [a, b] : [b, a];
    const rv = this.data.rivalries[key] ?? { a: ka, b: kb, aWins: 0, bWins: 0, streakOwner: null, streak: 0, bestA: 0, bestB: 0, recent: [] };
    if (winner === rv.a) rv.aWins++; else rv.bWins++;
    if (rv.streakOwner === winner) rv.streak++; else { rv.streakOwner = winner; rv.streak = 1; }
    if (winner === rv.a) rv.bestA = Math.max(rv.bestA, rv.streak); else rv.bestB = Math.max(rv.bestB, rv.streak);
    // store the score from rv.a's point of view
    const aIsTeam0 = (rv.a === a ? aTeam : (1 - aTeam)) === 0;
    rv.recent.unshift({ at: Date.now(), winner, score: aIsTeam0 ? score : [score[1], score[0]], mode });
    rv.recent = rv.recent.slice(0, 10);
    this.data.rivalries[key] = rv;
  }

  /** Rivalry from `me`'s point of view. */
  rivalryView(me: string, other: string) {
    const key = me < other ? `${me}|${other}` : `${other}|${me}`;
    const rv = this.data.rivalries[key];
    if (!rv) return null;
    const mine = rv.a === me;
    const wins = mine ? rv.aWins : rv.bWins, losses = mine ? rv.bWins : rv.aWins;
    return {
      opponent: other, wins, losses, games: wins + losses, pct: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
      streak: rv.streakOwner === me ? rv.streak : -rv.streak, best: mine ? rv.bestA : rv.bestB,
      recent: rv.recent.map((m) => ({ at: m.at, won: m.winner === me, score: mine ? m.score : [m.score[1], m.score[0]] as [number, number], mode: m.mode })),
    };
  }

  rivalriesOf(me: string) {
    const out = [];
    for (const rv of Object.values(this.data.rivalries)) {
      if (rv.a !== me && rv.b !== me) continue;
      const other = rv.a === me ? rv.b : rv.a;
      const v = this.rivalryView(me, other);
      if (v) out.push({ ...v, name: this.get(other)?.name ?? "Unknown", lastAt: rv.recent[0]?.at ?? 0 });
    }
    return out.sort((x, y) => y.lastAt - x.lastAt);
  }

  matchesOf(id: string, limit = 20) {
    const out: MatchRecord[] = [];
    for (let i = this.data.matches.length - 1; i >= 0 && out.length < limit; i--) {
      const m = this.data.matches[i];
      if (m.players.some((p) => p.id === id)) out.push(m);
    }
    return out;
  }
}

export const db = new Store();
process.on("exit", () => { try { db.flush(); } catch { /* ignore */ } });
