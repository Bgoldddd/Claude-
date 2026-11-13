// REST client for the COURTSIDE server.
import type { Loadout } from "../../shared/cosmetics";

export const SERVER_URL: string = (import.meta as any).env?.VITE_SERVER_URL
  || ((import.meta as any).env?.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);

// ?profile=2 lets you run a second player in another tab on the same computer
const slot = new URLSearchParams(location.search).get("profile") ?? "1";
const TOKEN_KEY = `courtside.token.${slot}`;

export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(t: string | null) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
  slot,
};

export const OFFLINE_BUILD = (import.meta as any).env?.VITE_OFFLINE === "1";

export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (OFFLINE_BUILD) throw new ApiError("Offline version", 0);
  let r: Response;
  try {
    r = await fetch(SERVER_URL + path, {
      method,
      headers: { "Content-Type": "application/json", ...(auth.token ? { Authorization: "Bearer " + auth.token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the COURTSIDE server", 0);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data?.error ?? `Error ${r.status}`, r.status);
  return data as T;
}

export interface Me {
  id: string; name: string; friendCode: string; rep: number; coins: number; rank: string; rankColor: string;
  rankInfo: { index: number; name: string; color: string; next: number | null; nextName: string | null; progress: number };
  loadout: Loadout; owned: string[]; settings: any; stats: any; blocked: string[];
}

export const api = {
  health: () => req<{ ok: boolean }>("GET", "/api/health"),
  guest: (name: string) => req<{ token: string; profile: Me }>("POST", "/api/auth/guest", { name }),
  me: () => req<Me>("GET", "/api/me"),
  rename: (name: string) => req<Me>("PUT", "/api/me/name", { name }),
  saveLoadout: (l: Loadout) => req<Me>("PUT", "/api/me/loadout", l),
  saveSettings: (s: any) => req<{ ok: boolean }>("PUT", "/api/me/settings", s),
  buy: (id: string) => req<Me>("POST", "/api/shop/buy", { id }),
  social: () => req<any>("GET", "/api/social"),
  friendRequest: (code: string) => req<any>("POST", "/api/friends/request", { code }),
  friendRequestById: (id: string) => req<any>("POST", "/api/friends/request", { id }),
  respond: (id: string, accept: boolean) => req<any>("POST", "/api/friends/respond", { id, accept }),
  unfriend: (id: string) => req<any>("DELETE", `/api/friends/${id}`),
  block: (id: string) => req<any>("POST", "/api/block", { id }),
  unblock: (id: string) => req<any>("DELETE", `/api/block/${id}`),
  report: (id: string, reason: string) => req<any>("POST", "/api/report", { id, reason }),
  invite: (to: string, roomId: string, mode: string, kind: "party" | "challenge" = "party") => req<any>("POST", "/api/invites", { to, roomId, mode, kind }),
  dismissInvite: (id: string) => req<any>("DELETE", `/api/invites/${id}`),
  profile: (id: string) => req<any>("GET", `/api/profile/${id}`),
  matches: () => req<any[]>("GET", "/api/matches/me"),
  rivals: () => req<any[]>("GET", "/api/rivals"),
  leaderboard: (by: string) => req<any>("GET", `/api/leaderboard?by=${by}`),
};
