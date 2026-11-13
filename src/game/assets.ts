// Loads the Blender-made GLB files once and keeps them for reuse.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

// the link version can't host .glb files, so it ships the same files renamed to .bin
const GLB_EXT = (import.meta as any).env?.VITE_OFFLINE === "1" ? ".bin" : ".glb";
export const assetUrl = (u: string) => u.replace(/\.glb$/, GLB_EXT);

export function loadGLB(url: string, onProgress?: (p: number) => void): Promise<THREE.Group> {
  url = assetUrl(url);
  // link version: models are packed into assets/models.js as base64
  const packed = (window as any).__COURTSIDE_GLB?.[url.split("/").pop()!.replace(/\.(glb|bin)$/, "")];
  if (packed && !cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      const bin = atob(packed); const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      loader.parse(buf.buffer, "", (g) => resolve(g.scene), (err) => reject(new Error(`Could not load ${url}: ${(err as any)?.message ?? err}`)));
    }));
  }
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      loader.load(url, (g) => resolve(g.scene), (e) => { if (e.total && onProgress) onProgress(e.loaded / e.total); }, (err) => {
        cache.delete(url);
        reject(new Error(`Could not load ${url}: ${(err as Error)?.message ?? err}`));
      });
    }));
  }
  return cache.get(url)!;
}

export interface CourtDef { id: string; name: string; tagline: string; file: string; mood: "dusk" | "night" | "day" | "indoor" }
export const COURTS: CourtDef[] = [
  { id: "the_block", name: "THE BLOCK", tagline: "Neighborhood court. Chain nets. Where legends start.", file: "assets/the_block.glb", mood: "dusk" },
  { id: "skyline", name: "SKYLINE", tagline: "Rooftop run above the city lights.", file: "assets/skyline.glb", mood: "night" },
  { id: "coastline", name: "COASTLINE", tagline: "Sun, sand and ocean breeze.", file: "assets/coastline.glb", mood: "day" },
  { id: "the_lab", name: "THE LAB", tagline: "Indoor training facility. No excuses.", file: "assets/the_lab.glb", mood: "indoor" },
];

/** Which court files actually exist (checked with a HEAD request). */
export async function availableCourts(): Promise<CourtDef[]> {
  const out: CourtDef[] = [];
  for (const c of COURTS) {
    try {
      if ((window as any).__COURTSIDE_GLB?.[c.id]) { out.push(c); continue; }
      const r = await fetch(assetUrl(c.file), { method: "HEAD" });
      const type = r.headers.get("content-type") ?? "";
      if (r.ok && !type.includes("text/html")) out.push(c);
    } catch { /* missing */ }
  }
  return out;
}
export const courtById = (id: string) => COURTS.find((c) => c.id === id) ?? COURTS[0];
