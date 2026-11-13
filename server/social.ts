// Presence and invites live in memory (they are short-lived by nature).
import crypto from "node:crypto";

export interface Invite { id: string; from: string; fromName: string; to: string; roomId: string; mode: string; kind: "party" | "challenge"; at: number }

const lastSeen = new Map<string, number>();
const inRoom = new Map<string, { roomId: string; mode: string; phase: string }>();
let invites: Invite[] = [];

export const presence = {
  touch(id: string) { lastSeen.set(id, Date.now()); },
  setRoom(id: string, info: { roomId: string; mode: string; phase: string } | null) {
    if (info) inRoom.set(id, info); else inRoom.delete(id);
  },
  status(id: string): { online: boolean; room: { roomId: string; mode: string; phase: string } | null } {
    const t = lastSeen.get(id) ?? 0;
    const room = inRoom.get(id) ?? null;
    return { online: !!room || Date.now() - t < 25_000, room };
  },
};

export const inviteBox = {
  add(i: Omit<Invite, "id" | "at">) {
    invites = invites.filter((x) => !(x.from === i.from && x.to === i.to));
    const inv = { ...i, id: crypto.randomUUID(), at: Date.now() };
    invites.push(inv);
    return inv;
  },
  for(id: string) {
    const now = Date.now();
    invites = invites.filter((x) => now - x.at < 120_000);
    return invites.filter((x) => x.to === id);
  },
  remove(id: string, owner: string) { invites = invites.filter((x) => !(x.id === id && (x.to === owner || x.from === owner))); },
};
