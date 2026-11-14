import type { Mode } from "./constants";

export type TeamId = 0 | 1;

/** What a client sends every frame. Button presses are counters: the server acts when a counter changes. */
export interface PlayerInput {
  seq: number;
  mx: number; // desired move direction (world X), length <= 1
  mz: number; // desired move direction (world Z)
  yaw: number; // camera yaw (radians); used to aim passes
  sprint: boolean;
  shoot: boolean; // held
  stance: boolean; // held (right mouse)
  jump: number; // press counters
  pass: number;
  move: number;
  action: number;
  interact: number;
  emote: number; // quick message id press counter
  emoteId: number;
  hold: number; // client-measured seconds the shoot button has been held (checked by the server)
  j: number; k: number; l: number; // ISO keys: J cross/steal, K stepback/slide, L drive/jump
}

export const emptyInput = (): PlayerInput => ({
  seq: 0, mx: 0, mz: 0, yaw: 0, sprint: false, shoot: false, stance: false,
  jump: 0, pass: 0, move: 0, action: 0, interact: 0, emote: 0, emoteId: 0, hold: 0, j: 0, k: 0, l: 0,
});

export type Action =
  | "none" | "jumpshot" | "layup" | "dunk" | "pass" | "steal" | "jump"
  | "cross" | "btl" | "btb" | "hesi" | "stepback" | "spin"
  | "celebrate" | "stumble" | "check" | "pumpfake" | "drive" | "slide" | "jab";

export type ShotTiming = "perfect" | "excellent" | "good" | "early" | "late";

export interface Attributes {
  three: number; mid: number; finish: number; dribble: number; defense: number; speed: number; dunk: boolean;
}

export type Archetype = "sharpshooter" | "slasher" | "lockdown" | "playmaker" | "allaround";

export interface PlayerStats {
  pts: number; fga: number; fgm: number; tpa: number; tpm: number;
  ast: number; reb: number; stl: number; blk: number; tov: number; perfect: number;
}
export const emptyStats = (): PlayerStats => ({ pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, ast: 0, reb: 0, stl: 0, blk: 0, tov: 0, perfect: 0 });

export type GameEvent =
  | { t: "score"; team: TeamId; pts: number; by: string; assist?: string; kind: string; swish: boolean }
  | { t: "shot"; by: string; timing: ShotTiming; kind: string; value: number; quality: number; contest?: number; contestBy?: string }
  | { t: "rim"; x: number; y: number; z: number; v: number }
  | { t: "board"; v: number }
  | { t: "bounce"; v: number; x: number; z: number }
  | { t: "net" }
  | { t: "block"; by: string; on: string; goaltend?: boolean }
  | { t: "steal"; by: string; from: string }
  | { t: "ankle"; by: string; on: string }
  | { t: "turnover"; team: TeamId; why: string; by?: string }
  | { t: "check"; team: TeamId }
  | { t: "live" }
  | { t: "mustclear"; team: TeamId }
  | { t: "cleared"; team: TeamId }
  | { t: "rebound"; by: string; off: boolean }
  | { t: "pass"; by: string; to: string }
  | { t: "move"; by: string; kind: Action }
  | { t: "emote"; by: string; id: number }
  | { t: "msg"; text: string; to?: string }
  | { t: "gameover"; winner: TeamId | -1; score: [number, number] }
  | { t: "shootout"; score: number; rack: number; ball: number }
  | { t: "dunkscore"; by: string; score: number; parts: string[] };

export interface PlayerSnap {
  id: string; n: string; tm: TeamId; bot: boolean;
  x: number; y: number; z: number; f: number; vx: number; vz: number;
  a: Action; at: number; // action + elapsed time
  st: number; // stamina 0..1
  fl: number; // flags: 1 hasBall, 2 stance, 4 sprint, 8 airborne, 16 mustClear
  m: number; // shot meter fill 0..1 (or -1)
  h: number; // dribble hand (-1 left, 1 right)
  ct?: number; // live contest on this player's shot (0..1)
  ss: number[]; // box score: pts reb ast stl blk fgm fga tpm tpa perfect
}

export interface BallSnap {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  s: "held" | "shot" | "pass" | "loose" | "dead"; h: string | null;
}

export interface Snapshot {
  tick: number;
  mode: Mode;
  phase: Phase;
  score: [number, number];
  poss: TeamId;
  clear: boolean;
  shotClock: number;
  time: number;
  timeLimit: number;
  phaseT: number;
  winner: TeamId | -1;
  p: PlayerSnap[];
  b: BallSnap;
  xb?: number[][];
  extra?: { shootout?: { score: number; rack: number; ball: number; left: number; best?: number }; dunk?: { total: number; attempt: number; last?: number; left: number } };
}

export type Phase = "pregame" | "check" | "live" | "dead" | "gameover";

export interface MatchSettings {
  mode: Mode;
  rule: "losers" | "winners";
  target: number;
  timeLimit: number; // seconds, 0 = none
  difficulty: "rookie" | "pro" | "legend";
}

export const defaultSettings = (mode: Mode = "1v1"): MatchSettings => ({ mode, rule: "winners", target: mode === "2v2" || mode === "3v3" ? 16 : 11, timeLimit: 600, difficulty: "pro" });

export interface PlayerSetup {
  id: string;
  name: string;
  team: TeamId;
  bot: boolean;
  archetype: Archetype;
}

export interface MatchResult {
  mode: Mode;
  winner: TeamId | -1;
  score: [number, number];
  duration: number;
  players: { id: string; name: string; team: TeamId; bot: boolean; stats: PlayerStats }[];
  shootoutScore?: number;
  dunkScore?: number;
}
