// Loads a court GLB and dresses it: materials, shadows, lights, sky, fog, crowd and the chain net.
import * as THREE from "three";
import { loadGLB, CourtDef } from "./assets";
import { Character } from "./character";
import { defaultLoadout, JERSEY_COLORS, SKIN_TONES, HAIR_COLORS, TRIM_COLORS } from "../../shared/cosmetics";
import { HOOP } from "../../shared/constants";

export type Quality = "low" | "medium" | "high";

interface Mood { bloom: number; skyTop: string; skyHorizon: string; skyGlow: string; fog: string; fogDensity: number; sun: string; sunI: number; sunDir: [number, number, number]; hemiSky: string; hemiGround: string; hemiI: number; floodI: number; flood: string; exposure: number; stars: boolean; env: number }
const MOODS: Record<CourtDef["mood"], Mood> = {
  dusk: { bloom: 0.88, skyTop: "#0b1020", skyHorizon: "#4a3550", skyGlow: "#e0753a", fog: "#2a2230", fogDensity: 0.006, sun: "#ffb07a", sunI: 1.6, sunDir: [-0.55, 0.42, -0.72], hemiSky: "#6c7aa8", hemiGround: "#3a2f2a", hemiI: 0.75, floodI: 260, flood: "#ffe6c4", exposure: 1.05, stars: true, env: 0.35 },
  night: { bloom: 0.92, skyTop: "#03050c", skyHorizon: "#14203a", skyGlow: "#3b4f86", fog: "#0c1222", fogDensity: 0.0025, sun: "#9fb4ff", sunI: 0.5, sunDir: [0.3, 0.6, -0.5], hemiSky: "#3d4c7a", hemiGround: "#141018", hemiI: 0.45, floodI: 150, flood: "#f2f4ff", exposure: 0.95, stars: true, env: 0.3 },
  day: { bloom: 1.2, skyTop: "#2f6fc4", skyHorizon: "#a9d2ee", skyGlow: "#fff2d6", fog: "#bfdcef", fogDensity: 0.0012, sun: "#fff4e2", sunI: 2.1, sunDir: [0.45, 0.75, 0.35], hemiSky: "#bcdcff", hemiGround: "#b8a37a", hemiI: 0.65, floodI: 0, flood: "#ffffff", exposure: 0.72, stars: false, env: 0.6 },
  indoor: { bloom: 0.97, skyTop: "#111", skyHorizon: "#222", skyGlow: "#333", fog: "#15161a", fogDensity: 0.0, sun: "#ffffff", sunI: 0.9, sunDir: [0.2, 1, 0.1], hemiSky: "#c9d2e0", hemiGround: "#3a3530", hemiI: 0.55, floodI: 70, flood: "#fff6ea", exposure: 0.8, stars: false, env: 0.5 },
};

function skyDome(m: Mood) {
  const g = new THREE.SphereGeometry(600, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(m.skyTop) }, hor: { value: new THREE.Color(m.skyHorizon) }, glow: { value: new THREE.Color(m.skyGlow) }, sunDir: { value: new THREE.Vector3(...m.sunDir).normalize() }, stars: { value: m.stars ? 1 : 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 glow; uniform vec3 sunDir; uniform float stars; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 c = mix(hor, top, pow(max(h,0.0), 0.55));
        float s = max(dot(vDir, sunDir), 0.0);
        c += glow * (pow(s, 6.0)*0.55 + pow(max(1.0-abs(h)*3.5,0.0),2.0)*0.35*(0.4+0.6*s));
        if (stars > 0.5 && h > 0.12) { vec3 q = floor(vDir*420.0); float st = step(0.9975, hash(q)); c += vec3(st)*0.8*h; }
        gl_FragColor = vec4(c,1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.name = "SkyDome"; mesh.frustumCulled = false;
  return mesh;
}

const TINTS: Record<string, string> = {
  M_SkyCourt: "#2a3a5c", M_BrickGray: "#8c8c8f", M_Sidewalk: "#a3a19b", M_CoastCourt: "#efe6d6", M_Boardwalk: "#c4a588",
  M_HardwoodDark: "#7a5940", M_LabWall: "#6b6b6e", M_ChainLinkDark: "#3a3a3e", M_ChainLinkCurtain: "#1a1a1c",
};
const EMISSIVE_SCALE: Record<string, number> = { M_SkylineTower: 0.5, M_TowerBlue: 0.5, M_Windows: 0.8, M_LightPanel: 0.5, M_ClerestoryGlass: 0.5 };

export interface NetRig { group: THREE.Group; k: number; t: number; swish: boolean }

export class World {
  root = new THREE.Group();
  court: CourtDef | null = null;
  sun!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  floods: THREE.SpotLight[] = [];
  nets: NetRig[] = [];
  crowd: { c: Character; cheer: number; base: THREE.Vector3; sitting: boolean }[] = [];
  ballTemplate: THREE.Mesh | null = null;
  mood: Mood = MOODS.dusk;

  constructor(public scene: THREE.Scene, public quality: Quality) {}

  async load(court: CourtDef, onProgress?: (p: number) => void) {
    this.clear();
    this.court = court;
    const m = (this.mood = MOODS[court.mood]);
    const env = await loadGLB(court.file, onProgress);
    const g = env.clone(true);
    const anchors: Record<string, THREE.Vector3> = {};
    const toHide: THREE.Object3D[] = [];
    g.traverse((o) => {
      if (o.name.startsWith("COL_")) toHide.push(o);
      if (o.name.startsWith("ANCHOR_") || o.name.startsWith("LIGHT_")) anchors[o.name] = o.getWorldPosition(new THREE.Vector3());
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const n = mat?.name ?? "";
      const big = /Ground|Court_|Sidewalk|Apron|Skyline|Bldg|Road|Curbs|Mural|Wall|Floor|Sand|Ocean|Roof|Boardwalk|Headland|Shop|Ceiling|Clerestory|City_|Curtain|Trusses|Light_Panels|Banner|Scoreboard/.test(o.name);
      mesh.castShadow = !big && !/Lines|Logo|Glow|Windows|Mural/.test(o.name);
      mesh.receiveShadow = !/Skyline|Glow/.test(o.name);
      if (TINTS[n]) mat.color.set(TINTS[n]);
      if (EMISSIVE_SCALE[n] && court.mood !== "dusk") mat.emissiveIntensity *= EMISSIVE_SCALE[n];
      if (/ChainLink|Windows|CenterLogo|PalmLeaf/.test(n)) { mat.alphaTest = 0.5; mat.transparent = false; mat.side = THREE.DoubleSide; }
      if (/Court_Lines|Court_Key|CenterLogo|Court_Surface/.test(o.name)) {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = o.name.includes("Lines") ? -4 : o.name.includes("Logo") ? -3 : o.name.includes("Key") ? -2 : -1;
        mat.polygonOffsetUnits = mat.polygonOffsetFactor;
      }
      if (/LampGlow|SignText|ElectricAccent|NeonSign|StringBulb|AntennaRed|LightPanel/.test(n)) mat.toneMapped = false;
      if (o.name.startsWith("Basketball_Loose0") && !this.ballTemplate) this.ballTemplate = mesh;
    });
    toHide.forEach((o) => (o.visible = false));
    this.root.add(g);
    // chain nets: wrap so they can swing around the rim
    for (const side of ["East", "West"]) {
      const net = g.getObjectByName(`Hoop_Net_${side}`);
      if (!net) continue;
      const pivot = new THREE.Group();
      const sx = side === "East" ? 1 : -1;
      pivot.position.set(sx * HOOP.x, HOOP.y, 0);
      const parent = net.parent!;
      parent.add(pivot);
      // keep the net's world transform while re-parenting
      pivot.updateMatrixWorld(true);
      pivot.attach(net);
      this.nets.push({ group: pivot, k: 0, t: 0, swish: false });
    }
    this.scene.background = null;
    this.root.add(skyDome(m));
    this.scene.fog = m.fogDensity > 0 ? new THREE.FogExp2(m.fog, m.fogDensity) : null;
    this.hemi = new THREE.HemisphereLight(m.hemiSky, m.hemiGround, m.hemiI);
    this.root.add(this.hemi);
    this.sun = new THREE.DirectionalLight(m.sun, m.sunI);
    this.sun.position.set(m.sunDir[0] * 60, m.sunDir[1] * 60, m.sunDir[2] * 60);
    this.sun.target.position.set(4, 0, 0);
    this.root.add(this.sun, this.sun.target);
    this.applyShadows();
    // flood lights at the anchors from Blender
    if (m.floodI > 0) {
      const floods = Object.entries(anchors).filter(([k]) => k.startsWith("LIGHT_Flood"));
      for (const [, p] of floods) {
        const s = new THREE.SpotLight(m.flood, m.floodI, 0, 0.95, 0.65, 2);
        s.position.copy(p);
        s.target.position.set(p.x * 0.35, 0, p.z * 0.35);
        this.root.add(s, s.target);
        this.floods.push(s);
      }
    }
    if (this.quality !== "low") this.spawnCrowd(court.id);
  }

  applyShadows() {
    const s = this.sun;
    if (!s) return;
    s.castShadow = this.quality !== "low";
    const size = this.quality === "high" ? 2048 : 1024;
    s.shadow.mapSize.set(size, size);
    const cam = s.shadow.camera as THREE.OrthographicCamera;
    cam.left = -22; cam.right = 22; cam.top = 16; cam.bottom = -16; cam.near = 1; cam.far = 160;
    cam.updateProjectionMatrix();
    s.shadow.bias = -0.0004; s.shadow.normalBias = 0.03;
    if (s.shadow.map) { s.shadow.map.dispose(); (s.shadow as any).map = null; }
  }

  private spawnCrowd(courtId: string) {
    const n = this.quality === "high" ? 14 : 7;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const seats: { x: number; z: number; y: number; ry: number; sitting: boolean }[] = [];
    if (courtId === "the_block") {
      for (let i = 0; i < 40; i++) {
        const row = Math.floor(rnd(0, 5));
        const x = Math.random() < 0.5 ? rnd(-8.6, -1.4) : rnd(1.9, 9.1);
        seats.push({ x, z: 8.6 + row * 0.55, y: row * 0.4 - 0.03, ry: Math.PI, sitting: true });
      }
      for (let i = 0; i < 6; i++) seats.push({ x: rnd(-14, 14), z: -10.9 + rnd(-0.2, 0.2), y: 0, ry: 0, sitting: false });
    } else {
      for (let i = 0; i < 12; i++) seats.push({ x: rnd(-12, 12), z: (Math.random() < 0.5 ? -1 : 1) * rnd(9.8, 10.6), y: 0, ry: 0, sitting: false });
    }
    // de-duplicate seats that are too close
    const chosen: typeof seats = [];
    for (const s of seats) { if (chosen.length >= n) break; if (chosen.every((c) => Math.hypot(c.x - s.x, c.z - s.z) > 0.8)) chosen.push(s); }
    for (const s of chosen) {
      const c = new Character(false);
      const jersey = pick(JERSEY_COLORS).color;
      c.setLoadout({ ...defaultLoadout(), skin: Math.floor(Math.random() * SKIN_TONES.length), hair: pick(["none", "Hair_Buzz", "Hair_Fade", "Hair_Afro", "Hair_Braids", "Hair_Twists"]), hairColor: pick(HAIR_COLORS), jerseyColor: jersey, jerseyTrim: pick(TRIM_COLORS), jerseyNumber: Math.floor(Math.random() * 99), shortsColor: pick(["#1e1f22", "#3a4a6b", "#7d7b76", "#ecebe6"]), height: rnd(0.93, 1.03) });
      c.root.position.set(s.x, s.y, s.z);
      c.root.rotation.y = s.ry + (s.sitting ? 0 : Math.atan2(-s.x * 0.3, 1));
      c.shadow.visible = !s.sitting;
      if (!s.sitting) {
        // face the main hoop area
        c.root.rotation.y = Math.atan2(6 - s.x, 0 - s.z);
      }
      this.root.add(c.root);
      this.crowd.push({ c, cheer: 0, base: c.root.position.clone(), sitting: s.sitting });
    }
  }

  cheer(k = 1) { for (const p of this.crowd) p.cheer = Math.max(p.cheer, (0.8 + Math.random() * 1.6) * k); }

  netHit(side: "East" | "West", swish: boolean) { const n = this.nets[side === "East" ? 0 : 1]; if (n) { n.k = 1; n.t = 0; n.swish = swish; } }

  update(dt: number) {
    for (const n of this.nets) {
      if (n.k <= 0.001) { n.group.scale.set(1, 1, 1); n.group.rotation.set(0, 0, 0); continue; }
      n.t += dt; n.k *= Math.exp(-dt * (n.swish ? 2.2 : 3.2));
      const w = Math.sin(n.t * 18) * n.k;
      n.group.scale.set(1 - 0.08 * n.k, 1 + 0.22 * n.k * (0.6 + 0.4 * Math.sin(n.t * 11)), 1 - 0.08 * n.k);
      n.group.rotation.set(w * 0.12, 0, w * 0.18);
    }
    for (const p of this.crowd) {
      p.cheer = Math.max(0, p.cheer - dt);
      p.c.update(dt, { speed: 0, sprint: false, stance: false, hasBall: false, hand: 1, action: p.cheer > 0 && !p.sitting ? "celebrate" : "none", actionT: 2 - p.cheer, airborne: false, celebration: "sky", phase: "", result: null, style: 0, lookYaw: 0, holdBall: false, sitting: p.sitting, cheer: p.cheer });
      if (!p.sitting) p.c.root.position.y = p.base.y + (p.cheer > 0 ? Math.abs(Math.sin(p.cheer * 9)) * 0.12 : 0);
    }
  }

  clear() {
    for (const p of this.crowd) p.c.dispose();
    this.crowd = []; this.floods = []; this.nets = [];
    this.root.clear();
    this.ballTemplate = null;
  }
}
