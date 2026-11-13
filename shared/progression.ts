import type { Archetype, Attributes, MatchResult, PlayerStats, TeamId } from "./types";

// ---------------------------------------------------------------- archetypes
// Every archetype has the same total budget. Progression never raises these,
// so new players are never helpless against veterans (no pay-to-win).
export const ARCHETYPES: Record<Archetype, { label: string; desc: string; attrs: Attributes }> = {
  sharpshooter: { label: "Sharpshooter", desc: "Deadly from deep. Weaker at the rim.", attrs: { three: 0.92, mid: 0.86, finish: 0.56, dribble: 0.66, defense: 0.56, speed: 0.66, dunk: false } },
  slasher: { label: "Slasher", desc: "Attacks the rim. Can dunk. Streaky jumper.", attrs: { three: 0.56, mid: 0.66, finish: 0.92, dribble: 0.76, defense: 0.56, speed: 0.80, dunk: true } },
  lockdown: { label: "Lockdown", desc: "Elite steals, blocks and contests.", attrs: { three: 0.56, mid: 0.62, finish: 0.66, dribble: 0.60, defense: 0.96, speed: 0.76, dunk: true } },
  playmaker: { label: "Playmaker", desc: "Tight handle. Moves break ankles.", attrs: { three: 0.70, mid: 0.72, finish: 0.64, dribble: 0.96, defense: 0.58, speed: 0.80, dunk: false } },
  allaround: { label: "All-Around", desc: "Solid at everything.", attrs: { three: 0.72, mid: 0.72, finish: 0.72, dribble: 0.72, defense: 0.72, speed: 0.72, dunk: true } },
};

// ---------------------------------------------------------------- ranks
export const RANKS = [
  { name: "Rookie", rep: 0, color: "#9aa0a6" },
  { name: "Prospect", rep: 300, color: "#7fc8a9" },
  { name: "Starter", rep: 900, color: "#5aa9ff" },
  { name: "All-Star", rep: 2000, color: "#ffb347" },
  { name: "Elite", rep: 4000, color: "#ff6b3d" },
  { name: "Legend", rep: 7500, color: "#00e5ff" },
] as const;
export type RankName = (typeof RANKS)[number]["name"];

export function rankFor(rep: number) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (rep >= RANKS[i].rep) idx = i;
  const cur = RANKS[idx];
  const next = RANKS[idx + 1];
  return { index: idx, name: cur.name, color: cur.color, rep, next: next?.rep ?? null, nextName: next?.name ?? null,
    progress: next ? (rep - cur.rep) / (next.rep - cur.rep) : 1 };
}

// ---------------------------------------------------------------- rewards
export interface Reward { rep: number; coins: number; reasons: string[] }

/** Server-side only: computes REP and coins for one human player from a validated match result. */
export function computeReward(result: MatchResult, playerId: string): Reward {
  const me = result.players.find((p) => p.id === playerId);
  if (!me) return { rep: 0, coins: 0, reasons: [] };
  const reasons: string[] = [];
  let rep = 0, coins = 0;
  const humansOpp = result.players.some((p) => p.team !== me.team && !p.bot);
  if (result.mode === "shootout") {
    const s = result.shootoutScore ?? 0;
    rep = Math.min(80, 10 + s * 2); coins = Math.min(60, 5 + s * 2);
    reasons.push(`Shootout score ${s}`);
    return { rep, coins, reasons };
  }
  if (result.mode === "dunk") {
    const s = result.dunkScore ?? 0;
    rep = Math.min(80, 10 + Math.round(s)); coins = Math.min(60, 5 + Math.round(s * 0.8));
    reasons.push(`Dunk contest ${s.toFixed(1)} pts`);
    return { rep, coins, reasons };
  }
  if (result.mode === "free") return { rep: 0, coins: 0, reasons };
  const won = result.winner === me.team;
  const finished = result.winner !== -1;
  if (finished) {
    rep += won ? 40 : 15; coins += won ? 60 : 25;
    reasons.push(won ? "Win" : "Played to the end");
    if (humansOpp) { rep += won ? 20 : 5; reasons.push("Beat real players bonus"); }
  }
  const s = me.stats;
  const statRep = Math.min(40, s.pts + s.ast * 2 + s.stl * 2 + s.blk * 2 + s.reb);
  rep += statRep;
  coins += Math.min(40, s.perfect * 3);
  if (s.perfect > 0) reasons.push(`${s.perfect} perfect releases`);
  return { rep, coins, reasons };
}

export function addStats(a: PlayerStats, b: PlayerStats): PlayerStats {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof PlayerStats)[]) out[k] = (a[k] ?? 0) + b[k];
  return out;
}

export function winnerName(team: TeamId | -1) { return team === -1 ? "No winner" : team === 0 ? "Home" : "Away"; }
