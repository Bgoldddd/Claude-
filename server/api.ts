// REST API for profiles, friends, rivalries, leaderboards, shop and settings.
import type { Application as Express, Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { db, Profile } from "./db";
import { presence, inviteBox } from "./social";
import { rankFor } from "../shared/progression";
import { ITEMS, JERSEY_COLORS, sanitizeLoadout, Loadout } from "../shared/cosmetics";

type AuthedReq = Request & { me: Profile };

const BAD_WORDS = ["fuck", "shit", "bitch", "nigg", "fag", "cunt", "whore", "slut", "rape", "nazi"];
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9 _.-]{3,16}$/.test(n)) return null;
  const low = n.toLowerCase().replace(/[^a-z]/g, "");
  if (BAD_WORDS.some((w) => low.includes(w))) return null;
  return n;
}

export function publicProfile(p: Profile) {
  const r = rankFor(p.rep);
  return {
    id: p.id, name: p.name, rank: r.name, rankColor: r.color, rep: p.rep, loadout: p.loadout,
    stats: p.stats, friendCode: p.friendCode, createdAt: p.createdAt,
  };
}

function privateProfile(p: Profile) {
  return { ...publicProfile(p), coins: p.coins, owned: p.owned, settings: p.settings, rankInfo: rankFor(p.rep), blocked: p.blocked };
}

// very small rate limiter per profile/ip
const hits = new Map<string, { n: number; t: number }>();
function limited(key: string, max = 120, windowMs = 60_000) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > windowMs) { hits.set(key, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > max;
}

export function mountApi(app: Express) {
  app.use("/api", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });

  const auth = (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    const me = db.byToken(token);
    if (!me) { res.status(401).json({ error: "Not signed in" }); return; }
    if (limited("u:" + me.id, 240)) { res.status(429).json({ error: "Slow down" }); return; }
    presence.touch(me.id);
    (req as AuthedReq).me = me;
    next();
  };

  app.get("/api/health", (_req, res) => { res.json({ ok: true, name: "COURTSIDE", time: Date.now() }); });

  // ------------------------------------------------------------ accounts (guest accounts with a secret token)
  app.post("/api/auth/guest", (req, res) => {
    if (limited("ip:" + req.ip, 20)) { res.status(429).json({ error: "Too many new accounts. Try later." }); return; }
    const name = cleanName(req.body?.name);
    if (!name) { res.status(400).json({ error: "Name must be 3-16 letters, numbers, spaces, _ . -" }); return; }
    const { profile, token } = db.createProfile(name);
    res.json({ token, profile: privateProfile(profile) });
  });

  app.get("/api/me", auth, (req, res) => { res.json(privateProfile((req as AuthedReq).me)); });

  app.put("/api/me/name", auth, (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) { res.status(400).json({ error: "Name must be 3-16 letters, numbers, spaces, _ . -" }); return; }
    (req as AuthedReq).me.name = name; db.save();
    res.json(privateProfile((req as AuthedReq).me));
  });

  app.put("/api/me/loadout", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    me.loadout = sanitizeLoadout(req.body as Partial<Loadout>, me.owned, rankFor(me.rep).index);
    db.save();
    res.json(privateProfile(me));
  });

  app.put("/api/me/settings", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const s = req.body;
    if (typeof s !== "object" || !s || JSON.stringify(s).length > 4000) { res.status(400).json({ error: "Bad settings" }); return; }
    me.settings = s; db.save();
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ shop (coins earned in play only)
  app.post("/api/shop/buy", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const id = String(req.body?.id ?? "");
    const item = ITEMS.find((i) => i.id === id) ?? JERSEY_COLORS.find((j) => j.id === id);
    if (!item) { res.status(404).json({ error: "No such item" }); return; }
    const rank = rankFor(me.rep);
    if (rank.index < item.rank) { res.status(403).json({ error: "Rank too low" }); return; }
    if (item.price === 0 || me.owned.includes(id)) { res.json(privateProfile(me)); return; }
    if (me.coins < item.price) { res.status(402).json({ error: "Not enough coins" }); return; }
    me.coins -= item.price; me.owned.push(id); db.save();
    res.json(privateProfile(me));
  });

  // ------------------------------------------------------------ profiles & history
  app.get("/api/profile/:id", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const p = db.get(String(req.params.id));
    if (!p) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...publicProfile(p), rivalry: p.id === me.id ? null : db.rivalryView(me.id, p.id), friend: db.areFriends(me.id, p.id), matches: db.matchesOf(p.id, 10) });
  });
  app.get("/api/matches/me", auth, (req, res) => { res.json(db.matchesOf((req as AuthedReq).me.id, 30)); });

  // ------------------------------------------------------------ social: friends, requests, invites, presence
  app.get("/api/social", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const friends = db.friendsOf(me.id).map((id) => db.get(id)).filter(Boolean).map((p) => ({
      ...publicProfile(p!), status: presence.status(p!.id), rivalry: db.rivalryView(me.id, p!.id),
    }));
    const incoming = db.data.requests.filter((r) => r.to === me.id && !me.blocked.includes(r.from)).map((r) => ({ id: r.id, from: r.from, name: db.get(r.from)?.name ?? "?", at: r.at }));
    const outgoing = db.data.requests.filter((r) => r.from === me.id).map((r) => ({ id: r.id, to: r.to, name: db.get(r.to)?.name ?? "?", at: r.at }));
    const invites = inviteBox.for(me.id).filter((i) => !me.blocked.includes(i.from));
    const recent = recentOpponents(me.id);
    res.json({ friends, incoming, outgoing, invites, recent, blocked: me.blocked.map((id) => ({ id, name: db.get(id)?.name ?? "?" })) });
  });

  app.post("/api/friends/request", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const target = req.body?.id ? db.get(String(req.body.id)) : db.byCode(String(req.body?.code ?? ""));
    if (!target) { res.status(404).json({ error: "No player with that friend code" }); return; }
    if (target.id === me.id) { res.status(400).json({ error: "That's your own code" }); return; }
    if (db.areFriends(me.id, target.id)) { res.status(400).json({ error: "Already friends" }); return; }
    if (target.blocked.includes(me.id) || me.blocked.includes(target.id)) { res.status(403).json({ error: "Can't send a request to this player" }); return; }
    // if they already asked me, accept
    const theirs = db.data.requests.find((r) => r.from === target.id && r.to === me.id);
    if (theirs) {
      db.data.requests = db.data.requests.filter((r) => r !== theirs);
      db.addFriendship(me.id, target.id);
      res.json({ ok: true, friends: true }); return;
    }
    if (!db.data.requests.some((r) => r.from === me.id && r.to === target.id)) {
      db.data.requests.push({ id: crypto.randomUUID(), from: me.id, to: target.id, at: Date.now() });
      db.save();
    }
    res.json({ ok: true, name: target.name });
  });

  app.post("/api/friends/respond", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const r = db.data.requests.find((x) => x.id === req.body?.id && x.to === me.id);
    if (!r) { res.status(404).json({ error: "Request not found" }); return; }
    db.data.requests = db.data.requests.filter((x) => x !== r);
    if (req.body?.accept) db.addFriendship(me.id, r.from); else db.save();
    res.json({ ok: true });
  });

  app.delete("/api/friends/:id", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    db.removeFriendship(me.id, String(req.params.id));
    db.data.requests = db.data.requests.filter((r) => !(r.from === me.id && r.to === req.params.id));
    db.save();
    res.json({ ok: true });
  });

  app.post("/api/block", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const id = String(req.body?.id ?? "");
    if (!db.get(id) || id === me.id) { res.status(404).json({ error: "Not found" }); return; }
    if (!me.blocked.includes(id)) me.blocked.push(id);
    db.removeFriendship(me.id, id);
    db.data.requests = db.data.requests.filter((r) => !((r.from === id && r.to === me.id) || (r.from === me.id && r.to === id)));
    db.save();
    res.json({ ok: true });
  });
  app.delete("/api/block/:id", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    me.blocked = me.blocked.filter((x) => x !== req.params.id); db.save();
    res.json({ ok: true });
  });
  app.post("/api/report", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const id = String(req.body?.id ?? ""), reason = String(req.body?.reason ?? "").slice(0, 300);
    if (!db.get(id)) { res.status(404).json({ error: "Not found" }); return; }
    if (limited("rep:" + me.id, 10, 3600_000)) { res.status(429).json({ error: "Too many reports" }); return; }
    db.data.reports.push({ id: crypto.randomUUID(), from: me.id, target: id, reason, at: Date.now() });
    db.save();
    console.log(`[report] ${me.name} reported ${db.get(id)?.name}: ${reason}`);
    res.json({ ok: true });
  });

  app.post("/api/invites", auth, (req, res) => {
    const me = (req as AuthedReq).me;
    const to = db.get(String(req.body?.to ?? ""));
    if (!to || !db.areFriends(me.id, to.id)) { res.status(403).json({ error: "You can only invite friends" }); return; }
    if (to.blocked.includes(me.id)) { res.status(403).json({ error: "Can't invite this player" }); return; }
    const roomId = String(req.body?.roomId ?? "").slice(0, 40);
    if (!roomId) { res.status(400).json({ error: "No room" }); return; }
    const inv = inviteBox.add({ from: me.id, fromName: me.name, to: to.id, roomId, mode: String(req.body?.mode ?? "1v1"), kind: req.body?.kind === "challenge" ? "challenge" : "party" });
    res.json(inv);
  });
  app.delete("/api/invites/:id", auth, (req, res) => { inviteBox.remove(String(req.params.id), (req as AuthedReq).me.id); res.json({ ok: true }); });

  // ------------------------------------------------------------ rivalries & leaderboards
  app.get("/api/rivals", auth, (req, res) => { res.json(db.rivalriesOf((req as AuthedReq).me.id)); });

  app.get("/api/leaderboard", auth, (req, res) => {
    const by = String(req.query.by ?? "rep");
    const me = (req as AuthedReq).me;
    const key = (p: Profile) => by === "wins" ? p.stats.wins : by === "shootout" ? p.stats.shootoutBest : by === "dunk" ? p.stats.dunkBest : by === "pts" ? p.stats.pts : p.rep;
    const all = Object.values(db.data.profiles).sort((a, b) => key(b) - key(a));
    const rows = all.slice(0, 50).map((p, i) => ({ place: i + 1, id: p.id, name: p.name, rank: rankFor(p.rep).name, rankColor: rankFor(p.rep).color, value: key(p), wins: p.stats.wins, losses: p.stats.losses, friend: db.areFriends(me.id, p.id), me: p.id === me.id }));
    const myPlace = all.findIndex((p) => p.id === me.id) + 1;
    res.json({ by, rows, me: { place: myPlace, value: key(me) }, friendsOnly: all.filter((p) => p.id === me.id || db.areFriends(me.id, p.id)).map((p, i) => ({ place: i + 1, id: p.id, name: p.name, value: key(p), me: p.id === me.id })) });
  });
}

function recentOpponents(me: string) {
  const seen = new Map<string, { id: string; name: string; at: number; mode: string }>();
  for (const m of db.matchesOf(me, 30)) {
    const mine = m.players.find((p) => p.id === me);
    for (const p of m.players) if (!p.bot && p.id !== me && p.team !== mine?.team && !seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.name, at: m.at, mode: m.mode });
  }
  return Array.from(seen.values()).slice(0, 10);
}
