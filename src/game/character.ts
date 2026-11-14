// Player character: assembled from Blender-made parts, recolored from the loadout,
// and animated with procedural poses that blend smoothly into each other.
import * as THREE from "three";
import { Loadout, SKIN_TONES, itemById } from "../../shared/cosmetics";
import type { Action } from "../../shared/types";

let PARTS: Record<string, THREE.Object3D> = {};
export function setCharacterParts(scene: THREE.Group) {
  PARTS = {};
  scene.traverse((o) => { if (/^(Part_|Hair_|Acc_)/.test(o.name) && !PARTS[o.name]) PARTS[o.name] = o; });
}
export const partsReady = () => !!PARTS["Part_Torso"];

// ---------------------------------------------------------------- pose model
const KEYS = [
  "hipY", "lean", "roll", "twist", "headPitch", "headYaw", "rootYaw",
  "shPitchL", "shAbdL", "shTwistL", "elbowL", "wristL",
  "shPitchR", "shAbdR", "shTwistR", "elbowR", "wristR",
  "hipPitchL", "hipAbdL", "kneeL", "ankleL",
  "hipPitchR", "hipAbdR", "kneeR", "ankleR",
] as const;
type Key = (typeof KEYS)[number];
export type Pose = Record<Key, number>;
const zeroPose = (): Pose => Object.fromEntries(KEYS.map((k) => [k, 0])) as Pose;

export interface AnimInput {
  speed: number; // horizontal m/s
  sprint: boolean; stance: boolean; hasBall: boolean; hand: number;
  action: Action; actionT: number; airborne: boolean;
  celebration: string; phase: string; result: "win" | "lose" | null;
  style: number; // dunk style bits
  lookYaw: number; // head look offset (radians)
  holdBall: boolean; // ball in both hands (check / pass windup)
  sitting?: boolean; cheer?: number;
}

const sm = (a: number, b: number, t: number) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Character {
  root = new THREE.Group();
  body = new THREE.Group();
  hips = new THREE.Group();
  spine = new THREE.Group();
  head = new THREE.Group();
  sh: Record<"L" | "R", THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  el: Record<"L" | "R", THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  wr: Record<"L" | "R", THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  hp: Record<"L" | "R", THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  kn: Record<"L" | "R", THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  an: Record<"L" | "R", THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  handTip: Record<"L" | "R", THREE.Object3D> = { L: new THREE.Object3D(), R: new THREE.Object3D() };
  mats: Record<string, THREE.MeshStandardMaterial> = {};
  pose: Pose = zeroPose();
  locoPhase = 0;
  dribblePhase = 0;
  t = Math.random() * 10;
  hairObj: THREE.Object3D | null = null;
  accObjs: THREE.Object3D[] = [];
  numberTex: THREE.CanvasTexture;
  numberCanvas: HTMLCanvasElement;
  loadout: Loadout | null = null;
  shadow: THREE.Mesh;
  private lastNumberKey = "";

  constructor(public castShadow = true) {
    this.numberCanvas = document.createElement("canvas");
    this.numberCanvas.width = 128; this.numberCanvas.height = 128;
    this.numberTex = new THREE.CanvasTexture(this.numberCanvas);
    this.numberTex.colorSpace = THREE.SRGBColorSpace;
    this.build();
    // soft blob shadow (cheap, always on)
    const sg = new THREE.CircleGeometry(0.42, 20); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.position.y = 0.012; this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
  }

  private mat(name: string) {
    if (!this.mats[name]) this.mats[name] = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    return this.mats[name];
  }

  /** Clone a part and give it this character's own materials. */
  private part(name: string, mirror = false): THREE.Object3D {
    const src = PARTS[name];
    const obj = src ? src.clone(true) : new THREE.Object3D();
    obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const srcMat = m.material as THREE.MeshStandardMaterial;
        const nm = srcMat?.name || "M_Skin";
        const mine = this.mat(nm);
        if (!mine.userData.init) {
          mine.userData.init = true; mine.name = nm;
          mine.color.copy(srcMat.color); mine.roughness = srcMat.roughness; mine.metalness = srcMat.metalness;
        }
        m.material = mine;
        m.castShadow = this.castShadow; m.receiveShadow = false;
      }
    });
    if (mirror) obj.scale.x = -1;
    return obj;
  }

  private build() {
    const r = this.root, b = this.body;
    r.add(b); b.add(this.hips);
    this.hips.position.set(0, 1.005, 0);
    this.hips.add(this.part("Part_Pelvis"));
    this.hips.add(this.spine);
    this.spine.add(this.part("Part_Torso"));
    this.spine.add(this.head); this.head.position.set(0, 0.655, 0);
    this.head.add(this.part("Part_Head"));
    this.head.scale.setScalar(1.08);
    // jersey numbers (front + back)
    const numMat = new THREE.MeshStandardMaterial({ map: this.numberTex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), numMat); front.position.set(0, 0.36, 0.126); front.rotation.x = -0.05;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), numMat); back.position.set(0, 0.34, -0.125); back.rotation.y = Math.PI;
    this.spine.add(front, back);
    for (const s of ["L", "R"] as const) {
      const sx = s === "L" ? 1 : -1, mir = s === "R";
      const shoulder = this.sh[s], elbow = this.el[s], wrist = this.wr[s];
      shoulder.position.set(0.215 * sx, 0.47, 0);
      this.spine.add(shoulder);
      shoulder.add(this.part("Part_UpperArm", mir));
      shoulder.add(elbow); elbow.position.set(0, -0.3, 0);
      elbow.add(this.part("Part_Forearm", mir));
      elbow.add(wrist); wrist.position.set(0, -0.26, 0);
      wrist.add(this.part("Part_Hand", mir));
      wrist.add(this.handTip[s]); this.handTip[s].position.set(0, -0.09, 0.02);
      const hip = this.hp[s], knee = this.kn[s], ankle = this.an[s];
      hip.position.set(0.095 * sx, 0, 0);
      this.hips.add(hip);
      hip.add(this.part("Part_Thigh", mir));
      hip.add(knee); knee.position.set(0, -0.46, 0);
      knee.add(this.part("Part_Shin", mir));
      knee.add(ankle); ankle.position.set(0, -0.44, 0);
      ankle.add(this.part("Part_Shoe", mir));
    }
  }

  setLoadout(l: Loadout, teamJersey?: { color: string; trim: string }) {
    this.loadout = l;
    const c = (n: string, hex: string) => this.mat(n).color.set(hex);
    c("M_Skin", SKIN_TONES[l.skin] ?? SKIN_TONES[3]);
    c("M_Jersey", teamJersey?.color ?? l.jerseyColor);
    c("M_JerseyTrim", teamJersey?.trim ?? l.jerseyTrim);
    c("M_Shorts", l.shortsColor); c("M_ShortsTrim", l.shortsTrim);
    c("M_Sock", l.sockColor); c("M_Hair", l.hairColor);
    c("M_Accessory", l.accessoryColor);
    const shoe = itemById(l.shoe)?.data ?? { upper: "#141416", sole: "#f0eee6", accent: "#00d0f0" };
    c("M_ShoeUpper", shoe.upper); c("M_ShoeSole", shoe.sole); c("M_ShoeAccent", shoe.accent);
    // hair
    if (this.hairObj) this.head.remove(this.hairObj);
    this.hairObj = l.hair && l.hair !== "none" ? this.part(l.hair) : null;
    if (this.hairObj) this.head.add(this.hairObj);
    // accessories
    for (const a of this.accObjs) a.parent?.remove(a);
    this.accObjs = [];
    for (const id of l.accessories) {
      if (id === "Acc_Headband") this.attach(this.head, "Acc_Headband");
      if (id === "Acc_Chain") this.attach(this.spine, "Acc_Chain");
      if (id === "Acc_Wristband") { this.attach(this.el.L, "Acc_Wristband"); this.attach(this.el.R, "Acc_Wristband", true); }
      if (id === "Acc_ArmSleeve") this.attach(this.sh.R, "Acc_ArmSleeve", true);
      if (id === "Acc_KneeSleeve") { this.attach(this.kn.L, "Acc_KneeSleeve"); this.attach(this.kn.R, "Acc_KneeSleeve", true); }
    }
    this.body.scale.setScalar(l.height || 1);
    this.drawNumber(l.jerseyNumber, teamJersey?.trim ?? l.jerseyTrim, teamJersey?.color ?? l.jerseyColor);
  }

  private attach(parent: THREE.Object3D, name: string, mirror = false) {
    const o = this.part(name, mirror); parent.add(o); this.accObjs.push(o);
  }

  private drawNumber(n: number, color: string, bg: string) {
    const key = `${n}|${color}|${bg}`;
    if (key === this.lastNumberKey) return;
    this.lastNumberKey = key;
    const g = this.numberCanvas.getContext("2d")!;
    g.clearRect(0, 0, 128, 128);
    g.font = "italic 800 92px Poppins, Arial Black, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 8; g.strokeStyle = bg; g.fillStyle = color;
    g.strokeText(String(n), 64, 70); g.fillText(String(n), 64, 70);
    this.numberTex.needsUpdate = true;
  }

  /** World position of a hand (for placing the ball). */
  handWorld(side: "L" | "R", out: THREE.Vector3) { return this.handTip[side].getWorldPosition(out); }

  // ---------------------------------------------------------------- animation
  update(dt: number, a: AnimInput) {
    this.t += dt;
    const stride = a.sprint ? 2.1 : 1.65;
    this.locoPhase += (a.speed * dt / stride) * Math.PI * 2;
    const dribbleHz = 1.9 + Math.min(1, a.speed / 6) * 1.4;
    this.dribblePhase = (this.dribblePhase + dt * dribbleHz) % 1;
    const target = this.computePose(a);
    // fast blend for snappy actions, softer for locomotion
    const fast = a.action !== "none" && a.action !== "celebrate";
    const k = 1 - Math.exp(-(fast ? 22 : 12) * dt);
    for (const key of KEYS) this.pose[key] = lerp(this.pose[key], target[key], key === "rootYaw" ? 1 : k);
    this.apply();
  }

  private computePose(a: AnimInput): Pose {
    const p = zeroPose();
    const t = this.t;
    const sp = Math.min(1, a.speed / 7);
    const moving = a.speed > 0.4;

    // ---- base: idle / run
    const breath = Math.sin(t * 2.1) * 0.02;
    p.lean = 0.04 + breath; p.kneeL = p.kneeR = 0.14; p.hipPitchL = p.hipPitchR = 0.07;
    p.shAbdL = p.shAbdR = 0.12; p.elbowL = p.elbowR = 0.25 + breath;
    if (moving) {
      const ph = this.locoPhase;
      const A = 0.28 + 0.5 * sp;
      p.hipPitchL = A * Math.sin(ph) + 0.1; p.hipPitchR = -A * Math.sin(ph) + 0.1;
      p.kneeL = 0.2 + (0.5 + 0.9 * sp) * Math.max(0, -Math.sin(ph - 0.7));
      p.kneeR = 0.2 + (0.5 + 0.9 * sp) * Math.max(0, Math.sin(ph - 0.7));
      p.ankleL = 0.25 * Math.sin(ph + 0.4); p.ankleR = -0.25 * Math.sin(ph + 0.4);
      p.shPitchL = -(0.25 + 0.6 * sp) * Math.sin(ph); p.shPitchR = (0.25 + 0.6 * sp) * Math.sin(ph);
      p.elbowL = p.elbowR = 0.6 + 0.8 * sp;
      p.lean = 0.08 + 0.22 * sp;
      p.hipY = -0.03 * Math.abs(Math.sin(ph)) * (0.5 + sp);
      p.twist = 0.08 * Math.sin(ph) * sp;
    }

    // ---- with the ball: athletic crouch + dribble arm
    if (a.hasBall && a.action === "none" && !a.holdBall) {
      const b = a.hand > 0 ? "R" : "L", o = a.hand > 0 ? "L" : "R";
      p.hipY -= 0.07; p.kneeL += 0.3; p.kneeR += 0.3; p.hipPitchL += 0.22; p.hipPitchR += 0.22; p.lean += 0.18;
      const pump = Math.sin(this.dribblePhase * Math.PI * 2);
      (p as any)["shPitch" + b] = 0.35; (p as any)["shAbd" + b] = 0.22; (p as any)["elbow" + b] = 0.75 + 0.35 * pump; (p as any)["wrist" + b] = 0.35 * pump;
      (p as any)["shPitch" + o] = 0.42; (p as any)["shAbd" + o] = 0.28; (p as any)["elbow" + o] = 0.85;
    }
    if (a.holdBall) {
      p.shPitchL = p.shPitchR = 0.9; p.elbowL = p.elbowR = 1.5; p.shAbdL = p.shAbdR = 0.15; p.shTwistL = 0.3; p.shTwistR = -0.3;
    }

    // ---- defensive stance
    if (a.stance && a.action === "none") {
      const slide = Math.sin(this.locoPhase * 1.3);
      p.hipY = -0.2; p.lean = 0.42; p.kneeL = p.kneeR = 1.0; p.hipPitchL = p.hipPitchR = 0.78;
      p.hipAbdL = p.hipAbdR = 0.28 + (moving ? 0.1 * slide : 0); p.ankleL = p.ankleR = -0.25;
      p.shPitchL = p.shPitchR = 0.55; p.shAbdL = p.shAbdR = 1.05; p.elbowL = p.elbowR = 0.45;
      p.shPitchR += Math.sin(t * 3) * 0.12; p.headPitch = -0.25;
    }

    // ---- actions
    const at = a.actionT;
    switch (a.action) {
      case "jumpshot": {
        const gather = sm(0, 0.18, at), rise = sm(0.24, 0.42, at), follow = sm(0.72, 0.82, at), land = sm(1.05, 1.35, at);
        p.hipY = lerp(-0.16 * gather, 0, rise); p.kneeL = p.kneeR = lerp(0.9 * gather + 0.15, 0.1, rise);
        p.hipPitchL = p.hipPitchR = lerp(0.65 * gather, 0.05, rise); p.ankleL = p.ankleR = lerp(0, -0.45, rise);
        p.lean = lerp(0.18, -0.04, rise);
        // shooting (right) arm: chest -> set point -> extend
        p.shPitchR = lerp(1.1, 2.75, rise); p.elbowR = lerp(1.7, lerp(1.55, 0.1, follow), rise); p.wristR = lerp(0, 1.1, follow);
        p.shAbdR = 0.12;
        p.shPitchL = lerp(1.0, 2.45, rise); p.elbowL = lerp(1.6, 1.35, rise); p.shAbdL = lerp(0.1, 0.35 + 0.4 * follow, rise);
        p.headPitch = -0.3 * rise;
        if (land > 0) { p.shPitchR = lerp(p.shPitchR, 0.3, land); p.shPitchL = lerp(p.shPitchL, 0.3, land); p.elbowR = lerp(p.elbowR, 0.4, land); p.wristR = lerp(p.wristR, 0, land); }
        break;
      }
      case "layup": {
        const up = sm(0.1, 0.3, at), rel = sm(0.45, 0.6, at);
        p.hipPitchR = 1.4 * up; p.kneeR = 1.6 * up; p.hipPitchL = -0.1; p.kneeL = 0.15; p.ankleL = -0.4 * up;
        p.shPitchR = lerp(1.0, 2.95, up); p.elbowR = lerp(1.4, 0.15, up); p.wristR = 0.8 * rel;
        p.shPitchL = lerp(0.9, 1.6, up); p.elbowL = 0.9; p.shAbdL = 0.4;
        p.lean = 0.1; p.headPitch = -0.35 * up;
        break;
      }
      case "dunk": {
        const up = sm(0.05, 0.35, at), hang = sm(0.42, 0.5, at), drop = sm(0.85, 1.0, at);
        const wind = (a.style & 2) && at > 0.1 && at < 0.45 ? (at - 0.1) / 0.35 : -1;
        p.shPitchL = p.shPitchR = lerp(1.0, 3.05, up); p.elbowL = p.elbowR = lerp(1.4, 0.35, up);
        if (wind >= 0) { p.shPitchR = 3.05 - Math.sin(wind * Math.PI) * 4.0 * (1 - hang); p.elbowR = 0.1; }
        p.kneeL = p.kneeR = lerp(0.4, 1.1, up); p.hipPitchL = p.hipPitchR = lerp(0.3, 0.6, up) * (1 - hang * 0.7);
        p.lean = lerp(0.25, -0.1, up);
        if (hang > 0 && drop < 1) { p.kneeL = 0.3 + Math.sin(t * 9) * 0.25; p.kneeR = 0.4 - Math.sin(t * 9) * 0.25; p.hipPitchL = 0.2; p.hipPitchR = -0.1; p.headPitch = -0.2; }
        if (a.style & 1) p.rootYaw = Math.PI * 2 * sm(0.08, 0.42, at);
        if (drop > 0) { p.shPitchL = lerp(p.shPitchL, 0.4, drop); p.shPitchR = lerp(p.shPitchR, 0.4, drop); }
        break;
      }
      case "pass": {
        const push = sm(0.0, 0.12, at), back = sm(0.22, 0.35, at);
        p.shPitchL = p.shPitchR = lerp(1.0, 1.45, push) * (1 - back) + 0.3 * back;
        p.elbowL = p.elbowR = lerp(1.6, 0.15, push) * (1 - back) + 0.4 * back;
        p.wristL = p.wristR = 0.6 * push * (1 - back); p.lean = 0.2;
        break;
      }
      case "steal": {
        const r = sm(0, 0.1, at) * (1 - sm(0.25, 0.38, at));
        p.lean = 0.25 + 0.4 * r; p.hipY = -0.12 * r; p.kneeL = 0.7; p.kneeR = 0.4; p.hipPitchL = 0.8 * r; p.hipPitchR = -0.1;
        p.shPitchR = 0.4 + 0.9 * r; p.elbowR = 0.15; p.shTwistR = -0.4; p.shPitchL = 0.3; p.shAbdL = 0.6; p.elbowL = 0.6;
        break;
      }
      case "jump": {
        p.shPitchL = p.shPitchR = 2.95; p.elbowL = p.elbowR = 0.15; p.shAbdL = p.shAbdR = 0.12;
        p.kneeL = p.kneeR = 0.45; p.hipPitchL = p.hipPitchR = 0.25; p.ankleL = p.ankleR = -0.4; p.headPitch = -0.3;
        break;
      }
      case "cross": case "btl": case "btb": {
        const k = sm(0, 0.12, at) * (1 - sm(0.32, 0.45, at));
        const s = a.hand > 0 ? -1 : 1; // lean toward the new hand side
        p.roll = 0.22 * k * s; p.lean += 0.15 * k; p.hipY -= 0.08 * k;
        p.hipAbdL += 0.3 * k; p.hipAbdR += 0.3 * k;
        if (a.action === "btl") { p.hipPitchL = 0.55 * k; p.kneeL = 0.7; p.hipPitchR = -0.25 * k; p.kneeR = 0.6; }
        if (a.action === "btb") { p.twist = 0.35 * k * s; const b = a.hand > 0 ? "L" : "R"; (p as any)["shPitch" + b] = -0.7 * k; (p as any)["elbow" + b] = 0.6; }
        else { p.shPitchL = p.shPitchR = 0.5; p.elbowL = p.elbowR = 0.9; p.shAbdL = p.shAbdR = 0.25; }
        break;
      }
      case "hesi": {
        const stop = 1 - sm(0.2, 0.3, at);
        p.lean = lerp(0.45, -0.02, stop); p.hipY = -0.05 * stop; p.headPitch = -0.15 * stop;
        p.shPitchL = 0.55; p.shAbdL = 0.4; p.elbowL = 1.1;
        break;
      }
      case "stepback": {
        const k = sm(0, 0.1, at) * (1 - sm(0.3, 0.45, at));
        p.lean = -0.15 * k + 0.1; p.hipY = -0.1 * k; p.kneeL = p.kneeR = 0.6 * k + 0.2; p.hipPitchL = 0.4 * k; p.hipPitchR = -0.2 * k;
        p.shPitchL = p.shPitchR = 0.9; p.elbowL = p.elbowR = 1.4;
        break;
      }
      case "stumble": {
        const f = Math.sin(t * 14);
        p.lean = -0.35; p.roll = 0.15 * f; p.shAbdL = 1.2 + 0.3 * f; p.shAbdR = 1.2 - 0.3 * f; p.elbowL = p.elbowR = 0.5;
        p.hipPitchL = 0.6; p.kneeL = 0.9; p.hipPitchR = -0.15; p.kneeR = 0.3; p.headPitch = 0.25;
        break;
      }
      case "pumpfake": {
        const up = sm(0, 0.12, at) * (1 - sm(0.22, 0.38, at));
        p.hipY = -0.08 * up; p.kneeL = p.kneeR = 0.35 + 0.15 * up; p.hipPitchL = p.hipPitchR = 0.25;
        p.shPitchR = 1.1 + 1.5 * up; p.elbowR = 1.6 - 0.1 * up; p.shPitchL = 1.0 + 1.3 * up; p.elbowL = 1.5; p.shAbdL = 0.2;
        p.headPitch = -0.25 * up; p.lean = 0.1;
        break;
      }
      case "drive": {
        const k = sm(0, 0.08, at) * (1 - sm(0.45, 0.55, at));
        p.lean += 0.35 * k; p.hipY -= 0.1 * k; p.kneeL += 0.2 * k; p.kneeR += 0.2 * k;
        const o = a.hand > 0 ? "L" : "R"; (p as any)["shPitch" + o] = 0.7; (p as any)["shAbd" + o] = 0.35; (p as any)["elbow" + o] = 1.2;
        break;
      }
      case "slide": {
        const k = sm(0, 0.06, at) * (1 - sm(0.25, 0.32, at));
        p.hipY = -0.24; p.lean = 0.4; p.kneeL = p.kneeR = 1.05; p.hipPitchL = p.hipPitchR = 0.8;
        p.hipAbdL = p.hipAbdR = 0.3 + 0.25 * k; p.shPitchL = p.shPitchR = 0.5; p.shAbdL = p.shAbdR = 1.2; p.elbowL = p.elbowR = 0.35;
        break;
      }
      case "jab": {
        const k = sm(0, 0.08, at) * (1 - sm(0.2, 0.3, at));
        p.roll = 0.18 * k * (a.hand > 0 ? 1 : -1); p.hipPitchR = 0.6 * k; p.kneeR = 0.6 * k; p.lean += 0.15 * k;
        break;
      }
      case "celebrate": this.celebrate(p, a.celebration, at, t); break;
    }

    if (a.result === "lose" && a.action === "none" && !moving) {
      p.lean = 0.95; p.hipY = -0.12; p.kneeL = p.kneeR = 0.55; p.hipPitchL = p.hipPitchR = 0.5;
      p.shPitchL = p.shPitchR = 1.05; p.elbowL = p.elbowR = 0.2; p.headPitch = 0.45; p.shAbdL = p.shAbdR = 0.25;
    }
    if (a.result === "win" && a.action === "none" && !moving) this.celebrate(p, a.celebration, t % 3, t);

    // airborne legs tuck a bit
    if (a.airborne && a.action === "none") { p.kneeL += 0.4; p.kneeR += 0.5; p.ankleL = p.ankleR = -0.4; }

    if (a.sitting) {
      p.hipY = -0.48; p.hipPitchL = p.hipPitchR = 1.5; p.kneeL = p.kneeR = 1.5; p.lean = -0.05; p.ankleL = p.ankleR = -0.1;
      p.shPitchL = p.shPitchR = 0.5; p.elbowL = p.elbowR = 1.0; p.shAbdL = p.shAbdR = 0.2;
      if (a.cheer && a.cheer > 0) { p.shPitchL = p.shPitchR = 2.8 + Math.sin(t * 12) * 0.2; p.elbowL = p.elbowR = 0.3; p.hipY = -0.4 + Math.abs(Math.sin(t * 8)) * 0.08; }
    }

    p.headYaw = Math.max(-1.1, Math.min(1.1, a.lookYaw)) * (a.action === "none" ? 0.7 : 0.2);
    return p;
  }

  private celebrate(p: Pose, kind: string, at: number, t: number) {
    const k = sm(0, 0.2, at);
    if (kind === "sky") {
      p.shPitchR = 3.0 * k; p.elbowR = 0.1; p.headPitch = -0.6 * k; p.shPitchL = 0.3; p.lean = -0.08;
    } else if (kind === "shimmy") {
      p.twist = Math.sin(t * 18) * 0.28 * k; p.shPitchL = p.shPitchR = 0.8; p.elbowL = p.elbowR = 1.7; p.shAbdL = p.shAbdR = 0.5; p.hipY = -0.08; p.kneeL = p.kneeR = 0.4; p.lean = -0.05;
    } else if (kind === "chest") {
      const hit = Math.max(0, Math.sin(t * 9));
      p.shPitchR = 0.9 + 0.4 * hit; p.elbowR = 2.1; p.shAbdR = -0.3; p.shTwistR = 0.6; p.shPitchL = 0.2; p.lean = -0.1 - 0.05 * hit; p.headPitch = -0.2;
    } else { // flex
      p.shAbdL = p.shAbdR = 1.45 * k; p.elbowL = p.elbowR = 2.0 * k; p.shPitchL = p.shPitchR = 0.15; p.shTwistL = 0.6 * k; p.shTwistR = -0.6 * k;
      p.lean = -0.12; p.hipY = -0.05; p.kneeL = p.kneeR = 0.3; p.headPitch = -0.15;
    }
  }

  private apply() {
    const p = this.pose;
    this.hips.position.y = 1.005 + p.hipY;
    this.spine.rotation.set(p.lean, p.twist, p.roll);
    this.head.rotation.set(p.headPitch, p.headYaw, 0);
    this.body.rotation.y = p.rootYaw;
    for (const s of ["L", "R"] as const) {
      const sx = s === "L" ? 1 : -1;
      const g = (k: string) => (p as any)[k + s] as number;
      this.sh[s].rotation.set(-g("shPitch"), g("shTwist"), sx * g("shAbd"), "XZY");
      this.el[s].rotation.set(-g("elbow"), 0, 0);
      this.wr[s].rotation.set(g("wrist"), 0, 0);
      this.hp[s].rotation.set(-g("hipPitch"), 0, sx * g("hipAbd"));
      this.kn[s].rotation.set(g("knee"), 0, 0);
      this.an[s].rotation.set(g("ankle") * -1 + 0, 0, 0);
    }
    // keep the blob shadow on the floor even when jumping
    this.shadow.position.y = 0.012 - this.root.position.y;
    const h = Math.max(0, this.root.position.y);
    this.shadow.scale.setScalar(1 / (1 + h * 0.8));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 / (1 + h * 1.5);
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const m of Object.values(this.mats)) m.dispose();
    this.numberTex.dispose();
  }
}
