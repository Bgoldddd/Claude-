// Cosmetic catalog. Purely visual. Unlocked by rank and coins earned in play.
// No real-money purchases, no loot boxes.

export interface Loadout {
  skin: number;
  hair: string; // "none" | Hair_* id
  hairColor: string;
  jerseyColor: string;
  jerseyTrim: string;
  jerseyNumber: number;
  shortsColor: string;
  shortsTrim: string;
  shoe: string; // shoe id
  sockColor: string;
  accessories: string[]; // ids
  accessoryColor: string;
  celebration: string;
  nameplate: string;
  archetype: import("./types").Archetype;
  height: number; // 0.94..1.06 scale (visual only)
}

export const SKIN_TONES = ["#f1c9a5", "#e0ac7f", "#c68a5e", "#a8704a", "#8a5636", "#6b3f25", "#4d2b18"];

export interface Item { id: string; name: string; kind: "hair" | "shoe" | "accessory" | "celebration" | "nameplate" | "jersey"; rank: number; price: number; data?: any }

export const ITEMS: Item[] = [
  { id: "none", name: "Bald", kind: "hair", rank: 0, price: 0 },
  { id: "Hair_Buzz", name: "Buzz Cut", kind: "hair", rank: 0, price: 0 },
  { id: "Hair_Fade", name: "High Top Fade", kind: "hair", rank: 0, price: 0 },
  { id: "Hair_Braids", name: "Cornrows", kind: "hair", rank: 0, price: 150 },
  { id: "Hair_Twists", name: "Twists", kind: "hair", rank: 1, price: 250 },
  { id: "Hair_Afro", name: "Afro", kind: "hair", rank: 2, price: 400 },

  { id: "shoe_classic", name: "Classic Low", kind: "shoe", rank: 0, price: 0, data: { upper: "#141416", sole: "#f0eee6", accent: "#00d0f0" } },
  { id: "shoe_white", name: "Clean Whites", kind: "shoe", rank: 0, price: 0, data: { upper: "#ecebe6", sole: "#ffffff", accent: "#d06a2a" } },
  { id: "shoe_ember", name: "Ember", kind: "shoe", rank: 1, price: 300, data: { upper: "#c2410c", sole: "#1a1a1a", accent: "#ffd166" } },
  { id: "shoe_concrete", name: "Concrete", kind: "shoe", rank: 1, price: 250, data: { upper: "#8a8a88", sole: "#3a3a3a", accent: "#ff7a2f" } },
  { id: "shoe_volt", name: "Volt", kind: "shoe", rank: 2, price: 500, data: { upper: "#1b1b1f", sole: "#d4ff3a", accent: "#d4ff3a" } },
  { id: "shoe_legend", name: "Legend Gold", kind: "shoe", rank: 5, price: 1500, data: { upper: "#f5f2ea", sole: "#c9a227", accent: "#c9a227" } },

  { id: "Acc_Headband", name: "Headband", kind: "accessory", rank: 0, price: 0 },
  { id: "Acc_Wristband", name: "Wristbands", kind: "accessory", rank: 0, price: 50 },
  { id: "Acc_ArmSleeve", name: "Arm Sleeve", kind: "accessory", rank: 1, price: 150 },
  { id: "Acc_KneeSleeve", name: "Knee Sleeves", kind: "accessory", rank: 1, price: 150 },
  { id: "Acc_Chain", name: "Gold Chain", kind: "accessory", rank: 3, price: 900 },

  { id: "flex", name: "The Flex", kind: "celebration", rank: 0, price: 0 },
  { id: "sky", name: "Point to the Sky", kind: "celebration", rank: 0, price: 100 },
  { id: "shimmy", name: "Shimmy", kind: "celebration", rank: 1, price: 300 },
  { id: "chest", name: "Chest Pound", kind: "celebration", rank: 2, price: 450 },

  { id: "plate_street", name: "Street", kind: "nameplate", rank: 0, price: 0, data: { bg: "#1c1c1f", fg: "#f2efe8", accent: "#d9662b" } },
  { id: "plate_concrete", name: "Concrete", kind: "nameplate", rank: 0, price: 0, data: { bg: "#8f8d88", fg: "#111", accent: "#111" } },
  { id: "plate_ember", name: "Ember", kind: "nameplate", rank: 1, price: 200, data: { bg: "#c2410c", fg: "#fff", accent: "#ffd166" } },
  { id: "plate_electric", name: "Electric", kind: "nameplate", rank: 2, price: 400, data: { bg: "#06141a", fg: "#00e5ff", accent: "#00e5ff" } },
  { id: "plate_legend", name: "Legend", kind: "nameplate", rank: 5, price: 1200, data: { bg: "#0d0d0d", fg: "#e9c46a", accent: "#e9c46a" } },
];

// Jersey colors: free basics + unlockable colorways
export const JERSEY_COLORS: { id: string; color: string; rank: number; price: number }[] = [
  { id: "#c2541c", color: "#c2541c", rank: 0, price: 0 },
  { id: "#1e1f22", color: "#1e1f22", rank: 0, price: 0 },
  { id: "#ecebe6", color: "#ecebe6", rank: 0, price: 0 },
  { id: "#7d7b76", color: "#7d7b76", rank: 0, price: 0 },
  { id: "#1f4fa3", color: "#1f4fa3", rank: 0, price: 50 },
  { id: "#8b1e2b", color: "#8b1e2b", rank: 0, price: 50 },
  { id: "#1f6b46", color: "#1f6b46", rank: 1, price: 150 },
  { id: "#5b2a86", color: "#5b2a86", rank: 1, price: 150 },
  { id: "#00b8d4", color: "#00b8d4", rank: 2, price: 300 },
  { id: "#d4ff3a", color: "#d4ff3a", rank: 3, price: 450 },
];
export const TRIM_COLORS = ["#ecebe6", "#1e1f22", "#c2541c", "#ffd166", "#00e5ff", "#8a8a88"];
export const HAIR_COLORS = ["#120d0a", "#3b2414", "#6b4423", "#b58a4c", "#d9c39a", "#8f8f8f", "#c2541c"];

export const defaultLoadout = (): Loadout => ({
  skin: 3, hair: "Hair_Fade", hairColor: "#120d0a",
  jerseyColor: "#c2541c", jerseyTrim: "#ecebe6", jerseyNumber: 23,
  shortsColor: "#1e1f22", shortsTrim: "#c2541c",
  shoe: "shoe_classic", sockColor: "#ecebe6",
  accessories: [], accessoryColor: "#ecebe6",
  celebration: "flex", nameplate: "plate_street", archetype: "allaround", height: 1.0,
});

export function itemById(id: string) { return ITEMS.find((i) => i.id === id); }

/** Free items and items the player owns. Used by the server to validate a loadout. */
export function isOwned(id: string, owned: string[], rankIndex: number): boolean {
  const it = itemById(id) ?? JERSEY_COLORS.find((j) => j.id === id);
  if (!it) return false;
  if (it.price === 0 && rankIndex >= it.rank) return true;
  return owned.includes(id);
}

/** Return a safe loadout: anything not owned falls back to the default. */
export function sanitizeLoadout(l: Partial<Loadout>, owned: string[], rankIndex: number): Loadout {
  const d = defaultLoadout();
  const out: Loadout = { ...d, ...l } as Loadout;
  const hex = (s: any, fb: string) => (typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s) ? s : fb);
  out.skin = Math.max(0, Math.min(SKIN_TONES.length - 1, Math.round(Number(out.skin) || 0)));
  if (!isOwned(out.hair, owned, rankIndex)) out.hair = d.hair;
  if (!isOwned(out.shoe, owned, rankIndex)) out.shoe = d.shoe;
  if (!isOwned(out.celebration, owned, rankIndex)) out.celebration = d.celebration;
  if (!isOwned(out.nameplate, owned, rankIndex)) out.nameplate = d.nameplate;
  if (!JERSEY_COLORS.some((j) => j.id === out.jerseyColor) || !isOwned(out.jerseyColor, owned, rankIndex)) out.jerseyColor = d.jerseyColor;
  out.accessories = (Array.isArray(out.accessories) ? out.accessories : []).filter((a) => isOwned(a, owned, rankIndex)).slice(0, 4);
  out.hairColor = hex(out.hairColor, d.hairColor);
  out.jerseyTrim = hex(out.jerseyTrim, d.jerseyTrim);
  out.shortsColor = hex(out.shortsColor, d.shortsColor);
  out.shortsTrim = hex(out.shortsTrim, d.shortsTrim);
  out.sockColor = hex(out.sockColor, d.sockColor);
  out.accessoryColor = hex(out.accessoryColor, d.accessoryColor);
  out.jerseyNumber = Math.max(0, Math.min(99, Math.round(Number(out.jerseyNumber) || 0)));
  out.height = Math.max(0.94, Math.min(1.06, Number(out.height) || 1));
  if (!["sharpshooter", "slasher", "lockdown", "playmaker", "allaround"].includes(out.archetype)) out.archetype = d.archetype;
  return out;
}

export const QUICK_MESSAGES = ["Nice shot!", "Good game", "Run it back", "Pass it!", "Too easy", "My bad", "Lock in", "Let's go!"];
