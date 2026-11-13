// COURTSIDE renderer + client game loop.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { World, Quality } from "./world";
import { Character, setCharacterParts, AnimInput, partsReady } from "./character";
import { loadGLB, courtById } from "./assets";
import { Input } from "./input";
import { audio } from "./audio";
import { makeNameplate, makeBubble, makeRing, Sparks } from "./fx";
import { Session } from "../net/session";
import { HOOP, FENCE } from "../../shared/constants";
import { SHOT_DURATION, SHOT_TARGET, WINDOWS, contestLabel, greenScale } from "../../shared/game";
import { GameEvent, PlayerSnap, Snapshot, BallSnap } from "../../shared/types";
import { Loadout, defaultLoadout, itemById, QUICK_MESSAGES } from "../../shared/cosmetics";

export type EngineMode = "menu" | "locker" | "play";
export interface UiEvent { kind: "feed" | "center" | "timing" | "hint" | "dunk" | "contest"; text: string; sub?: string; color?: string; big?: boolean; tag?: string; tagColor?: string }
export interface EngineSettings { quality: Quality; sensitivity: number; invertY: boolean; camDist: number; showFps: boolean; hoopCam: boolean; showMeter: boolean }

const TEAM_RING = ["#ff7a2f", "#00d0f0"];
const TEAM_JERSEY = [{ color: "#c2541c", trim: "#ecebe6" }, { color: "#1e1f22", trim: "#00c2dc" }];
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
const sm = (a: number, b: number, t: number) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const lerpAng = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

interface PView {
  id: string; char: Character; team: 0 | 1; name: string;
  plate: THREE.Sprite | null; plateKey: string; ring: THREE.Mesh | null; ringKey: string;
  bubble: THREE.Sprite | null; bubbleT: number;
  disp: THREE.Vector3; facing: number; lastDribble: number; seen: boolean;
}

export class Engine {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1500);
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  world!: World;
  input = new Input();
  session: Session | null = null;
  mode: EngineMode = "menu";
  settings: EngineSettings = { quality: "medium", sensitivity: 1, invertY: false, camDist: 5.2, showFps: false, hoopCam: false, showMeter: true };
  container!: HTMLElement;
  ready = false;
  paused = false;
  fps = 60;
  // camera
  yaw = -0.0; pitch = 0.22; camTarget = new THREE.Vector3(6, 1.5, 0);
  // players & ball
  views = new Map<string, PView>();
  ball!: THREE.Mesh; ballShadow!: THREE.Mesh; extraBalls: THREE.Mesh[] = [];
  ballDisp = new THREE.Vector3(6, 1, 0); ballBlend = 1; ballSpinAxis = new THREE.Vector3(1, 0, 0); lastBallState = "dead";
  sparks!: Sparks;
  loadouts = new Map<string, Loadout>();
  plates = new Map<string, { sub: string; plate: string }>();
  myLoadout: Loadout = defaultLoadout();
  showcase: Character | null = null; showcaseYaw = 0; showcaseAction: { kind: string; t: number } | null = null;
  lockerSpin = 0;
  meterContest: HTMLElement | null = null;
  private liveContest = 0;
  meterEl: HTMLElement | null = null; meterFill: HTMLElement | null = null; meterZone: HTMLElement | null = null; meterLabel: HTMLElement | null = null;
  onUi: (e: UiEvent) => void = () => {};
  onPauseRequest: () => void = () => {};
  onScoreboard: (down: boolean) => void = () => {};
  lastSnap: Snapshot | null = null;
  renderSnap: Snapshot | null = null;
  private clock = new THREE.Clock();
  private frameCount = 0; private fpsT = 0;
  private menuT = 0;
  private meterFreeze = 0; private meterGrade: string | null = null; private lastMeterValue = 0; private lastMeterKind = "jumpshot";
  private wasHolding = false;
  private court = "the_block";
  private loadingCourt: Promise<void> | null = null;
  private resizeObs: ResizeObserver | null = null;

  async init(container: HTMLElement, onProgress?: (p: number, label: string) => void) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.domElement.style.display = "block";
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    (this.scene as any).environmentIntensity = 0.35;
    this.world = new World(this.scene, this.settings.quality);
    this.scene.add(this.world.root);
    this.sparks = new Sparks(this.scene);
    this.input.attach(r.domElement);
    this.input.onToggleScoreboard = (d) => this.onScoreboard(d);
    this.input.onCamera = () => { this.settings.hoopCam = !this.settings.hoopCam; this.onUi({ kind: "hint", text: this.settings.hoopCam ? "Camera: follow hoop" : "Camera: free mouse" }); };
    this.input.onEscape = () => { if (this.mode === "play") this.onPauseRequest(); };
    r.domElement.addEventListener("click", () => { if (this.mode === "play" && !this.paused) this.lockPointer(); audio.unlock(); });
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement !== r.domElement && this.mode === "play" && !this.paused && this.session && !this.session.results) this.onPauseRequest();
    });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    onProgress?.(0.05, "Loading player models");
    setCharacterParts(await loadGLB("assets/character_parts.glb"));
    onProgress?.(0.2, "Loading THE BLOCK");
    await this.loadCourt("the_block", (p) => onProgress?.(0.2 + p * 0.75, "Loading THE BLOCK"));
    this.setupComposer();
    this.ready = true;
    onProgress?.(1, "Ready");
    r.setAnimationLoop(() => this.frame());
  }

  async loadCourt(id: string, onProgress?: (p: number) => void) {
    if (this.court === id && this.world.court) return;
    this.court = id;
    const job = (async () => {
      await this.world.load(courtById(id), onProgress);
      this.renderer.toneMappingExposure = this.world.mood.exposure;
      (this.scene as any).environmentIntensity = this.world.mood.env;
      if (this.bloom) this.bloom.threshold = this.world.mood.bloom;
      // ball mesh from the Blender scene (reused asset)
      const tpl = this.world.ballTemplate;
      if (this.ball) this.scene.remove(this.ball);
      this.ball = tpl ? new THREE.Mesh(tpl.geometry, tpl.material) : new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), new THREE.MeshStandardMaterial({ color: "#c2541c" }));
      this.ball.castShadow = true; this.ball.position.set(0, -10, 0);
      this.scene.add(this.ball);
      if (!this.ballShadow) {
        const g = new THREE.CircleGeometry(0.14, 20); g.rotateX(-Math.PI / 2);
        this.ballShadow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.4, depthWrite: false }));
        this.ballShadow.renderOrder = 1; this.scene.add(this.ballShadow);
      }
      for (const b of this.extraBalls) this.scene.remove(b);
      this.extraBalls = [];
      if (this.showcase) this.scene.add(this.showcase.root);
    })();
    this.loadingCourt = job;
    await job;
  }

  setupComposer() {
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === "high" ? Math.min(dpr, 2) : q === "medium" ? Math.min(dpr, 1.5) : Math.min(dpr, 1) * 0.85);
    this.renderer.shadowMap.enabled = q !== "low";
    this.world.quality = q;
    this.world.applyShadows();
    this.composer = null; this.bloom = null;
    if (q !== "low") {
      const size = new THREE.Vector2(); this.renderer.getSize(size);
      const c = new EffectComposer(this.renderer);
      c.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), q === "high" ? 0.6 : 0.45, 0.55, this.world.mood.bloom);
      c.addPass(this.bloom);
      c.addPass(new OutputPass());
      this.composer = c;
    }
    this.resize();
  }

  applySettings(s: Partial<EngineSettings>) {
    const qChanged = s.quality && s.quality !== this.settings.quality;
    this.settings = { ...this.settings, ...s };
    if (qChanged && this.ready) {
      this.setupComposer();
      const id = this.court; this.court = ""; this.loadCourt(id);
    }
  }

  resize() {
    if (!this.renderer || !this.container) return;
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%"; this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  lockPointer() {
    const el = this.renderer.domElement as any;
    const refused = () => { if (!this.settings.hoopCam) { this.settings.hoopCam = true; this.onUi({ kind: "hint", text: "Mouse lock not allowed here — camera follows the hoop" }); } };
    const plain = () => { try { const r = el.requestPointerLock(); r?.catch?.(refused); } catch { refused(); } };
    try { const r = el.requestPointerLock({ unadjustedMovement: true }); if (r?.catch) r.catch(plain); } catch { plain(); }
  }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ---------------------------------------------------------------- modes
  setMode(m: EngineMode) {
    this.mode = m;
    this.input.enabled = m === "play" && !this.paused;
    if (m !== "play") this.unlockPointer();
    if (m === "menu" || m === "locker") this.ensureShowcase();
    else if (this.showcase) this.showcase.root.visible = false;
    if (m === "play" && this.ball) this.ballShadow && (this.ballShadow.visible = true);
  }
  setPaused(p: boolean) { this.paused = p; this.input.enabled = this.mode === "play" && !p; if (p) this.unlockPointer(); }

  setMyLoadout(l: Loadout) { this.myLoadout = l; if (this.showcase) this.showcase.setLoadout(l); }

  private ensureShowcase() {
    if (!partsReady()) return;
    if (!this.showcase) {
      this.showcase = new Character(true);
      this.showcase.setLoadout(this.myLoadout);
      this.scene.add(this.showcase.root);
    }
    this.showcase.root.visible = true;
  }
  previewCelebration(kind: string) { this.showcaseAction = { kind, t: 0 }; }

  // ---------------------------------------------------------------- session
  attach(s: Session) {
    this.detach();
    this.session = s;
    s.on("events", (ev: GameEvent[]) => this.handleEvents(ev));
    s.on("roster", () => this.syncRoster());
    s.on("qm", (m: any) => this.showBubble(m.from, QUICK_MESSAGES[m.id] ?? ""));
    s.on("phase", () => { this.lastSnap = null; });
    if (s.roster) this.syncRoster();
  }
  detach() {
    for (const v of this.views.values()) { v.char.dispose(); v.plate?.parent?.remove(v.plate); }
    this.views.clear();
    this.session = null; this.lastSnap = null; this.renderSnap = null;
    this.ball && this.ball.position.set(0, -10, 0);
  }

  private teamJersey(team: 0 | 1) {
    const r = this.session?.roster;
    const mode = r?.phase === "lobby" ? "free" : r?.settings.mode;
    if (mode === "2v2" || mode === "3v3") return TEAM_JERSEY[team];
    return undefined;
  }

  private syncRoster() {
    const r = this.session?.roster; if (!r) return;
    for (const s of r.seats) { this.loadouts.set(s.id, s.loadout); this.plates.set(s.id, { sub: s.rank, plate: s.loadout.nameplate }); }
    for (const b of r.bots) { this.loadouts.set(b.id, b.loadout); this.plates.set(b.id, { sub: "CPU", plate: "plate_concrete" }); }
    for (const v of this.views.values()) { v.ringKey = ""; v.plateKey = ""; const l = this.loadouts.get(v.id); if (l) v.char.setLoadout(l, this.teamJersey(v.team)); }
  }

  private view(p: PlayerSnap): PView {
    let v = this.views.get(p.id);
    if (!v) {
      const c = new Character(this.settings.quality !== "low");
      c.setLoadout(this.loadouts.get(p.id) ?? defaultLoadout(), this.teamJersey(p.tm));
      this.scene.add(c.root);
      if (p.id === this.session?.me) { this.yaw = Math.atan2(HOOP.z - p.z, HOOP.x - p.x); this.camTarget.set(p.x, 1.5, p.z); }
      v = { id: p.id, char: c, team: p.tm, name: p.n, plate: null, plateKey: "", ring: null, ringKey: "", bubble: null, bubbleT: 0, disp: new THREE.Vector3(p.x, p.y, p.z), facing: p.f, lastDribble: 0, seen: true };
      this.views.set(p.id, v);
    }
    if (v.team !== p.tm) { v.team = p.tm; v.ringKey = ""; v.plateKey = ""; const l = this.loadouts.get(p.id); if (l) v.char.setLoadout(l, this.teamJersey(p.tm)); }
    const me = p.id === this.session?.me;
    const ringKey = `${p.tm}|${me}`;
    if (v.ringKey !== ringKey) {
      if (v.ring) v.char.root.remove(v.ring);
      v.ring = makeRing(me ? "#f2efe8" : TEAM_RING[p.tm], me);
      v.char.root.add(v.ring); v.ringKey = ringKey;
    }
    const pl = this.plates.get(p.id) ?? { sub: p.bot ? "CPU" : "", plate: "plate_street" };
    const plateKey = `${p.n}|${pl.sub}|${pl.plate}|${p.tm}`;
    if (v.plateKey !== plateKey && !me) {
      if (v.plate) v.char.root.remove(v.plate);
      const data = itemById(pl.plate)?.data ?? { bg: "#1c1c1f", fg: "#f2efe8", accent: "#d9662b" };
      v.plate = makeNameplate(p.n, pl.sub, data, TEAM_RING[p.tm]);
      v.plate.position.y = 2.42; v.char.root.add(v.plate); v.plateKey = plateKey;
    }
    v.name = p.n;
    return v;
  }

  showBubble(id: string, text: string) {
    const v = this.views.get(id); if (!v || !text) return;
    if (v.bubble) v.char.root.remove(v.bubble);
    v.bubble = makeBubble(text); v.bubble.position.y = 2.85; v.char.root.add(v.bubble); v.bubbleT = 3;
  }

  // ---------------------------------------------------------------- events -> sound, fx, ui
  private isOpponent(id: string) {
    const s = this.lastSnap; const me = this.session?.me;
    const a = s?.p.find((p) => p.id === id), b = s?.p.find((p) => p.id === me);
    return !!(a && b && a.tm !== b.tm);
  }

  private nameOf(id: string | undefined) { if (!id) return ""; return this.views.get(id)?.name ?? this.lastSnap?.p.find((p) => p.id === id)?.n ?? "?"; }
  private myTeam() { return this.lastSnap?.p.find((p) => p.id === this.session?.me)?.tm ?? 0; }

  private handleEvents(evs: GameEvent[]) {
    const me = this.session?.me;
    const camPos = this.camera.position;
    for (const e of evs) {
      switch (e.t) {
        case "shot":
          if (e.by === me) {
            this.meterGrade = e.timing; this.meterFreeze = 0.7;
            const col = e.timing === "perfect" ? "#3dff8a" : e.timing === "excellent" ? "#9be15d" : e.timing === "good" ? "#ffd166" : "#ff6b3d";
            const c = e.contest ?? 0;
            if (e.kind !== "dunk") this.onUi({ kind: "timing", text: e.timing.toUpperCase(), color: col, tag: contestLabel(c), tagColor: contestColor(c),
              sub: e.timing === "perfect" ? "GREEN — automatic bucket" : `${e.value === 2 ? "2PT" : "1PT"} · ${Math.round(e.quality * 100)}% shot` });
            if (e.timing === "perfect") audio.perfect();
          }
          // defender feedback: how well did I contest this shot?
          if (e.by !== me && e.kind !== "dunk" && this.lastSnap && this.isOpponent(e.by)) {
            const c = e.contest ?? 0;
            if (e.contestBy === me) this.onUi({ kind: "contest", text: `YOUR CONTEST: ${contestLabel(c)}`, color: contestColor(c), sub: e.timing === "perfect" ? "They greened it anyway" : c >= 0.6 ? "Great hand in the face" : c >= 0.35 ? "Decent — get closer" : "Too far — close out faster" });
            else if (c < 0.15) this.onUi({ kind: "contest", text: "LEFT WIDE OPEN", color: "#ff6b3d", sub: "Nobody closed out" });
          }
          audio.swoosh();
          break;
        case "score": {
          const side = "East";
          this.world.netHit(side, e.swish);
          audio.chain(e.swish);
          audio.cheer(e.pts === 2 ? 1 : 0.7); this.world.cheer(e.pts === 2 ? 1.2 : 0.8);
          if (e.swish || e.kind === "dunk") this.sparks.burst(tmp.set(HOOP.x, HOOP.y - 0.2, HOOP.z), e.kind === "dunk" ? "#ff7a2f" : "#3dff8a", 50, 3.5);
          const mode = this.lastSnap?.mode;
          if (mode !== "shootout" && mode !== "dunk") {
            const who = this.nameOf(e.by);
            this.onUi({ kind: "feed", text: `${who} ${e.kind === "dunk" ? "SLAMS IT" : e.swish ? "SWISH" : "SCORES"} +${e.pts}`, sub: e.assist ? `Assist: ${this.nameOf(e.assist)}` : undefined, color: TEAM_RING[e.team] });
          }
          break;
        }
        case "rim": audio.rim(e.v); break;
        case "board": audio.board(e.v); break;
        case "bounce": {
          const d = Math.hypot(e.x - camPos.x, e.z - camPos.z);
          audio.bounce(e.v / (1 + d * 0.08), Math.max(-1, Math.min(1, (e.x - camPos.x) / 20)));
          break;
        }
        case "block": audio.ooh(); this.world.cheer(1); this.onUi({ kind: "feed", text: e.goaltend ? `GOALTENDING on ${this.nameOf(e.by)}` : `REJECTED by ${this.nameOf(e.by)}`, color: "#ff6b3d" }); if (e.on === me && !e.goaltend) this.onUi({ kind: "center", text: "BLOCKED", color: "#ff6b3d" }); break;
        case "steal": audio.ooh(); this.onUi({ kind: "feed", text: `${this.nameOf(e.by)} with the STEAL`, color: "#00d0f0" }); break;
        case "ankle": audio.ooh(); this.world.cheer(1.4); audio.cheer(1); this.onUi({ kind: "center", text: "ANKLES!", sub: `${this.nameOf(e.by)} broke ${this.nameOf(e.on)}`, color: "#ffd166", big: true }); break;
        case "turnover": audio.whistle(); this.onUi({ kind: "feed", text: `TURNOVER — ${e.why}`, color: "#aaa" }); break;
        case "check": this.onUi({ kind: "center", text: "CHECK BALL", sub: this.lastSnap?.p.some((p) => p.id === me && p.fl & 1) || e.team === this.myTeam() ? "Your ball — press E to check" : "Defense — get ready", color: "#f2efe8" }); break;
        case "live": audio.whistle(); break;
        case "mustclear": if (e.team === this.myTeam()) this.onUi({ kind: "center", text: "CLEAR IT", sub: "Take it behind the arc before you shoot", color: "#ffd166" }); break;
        case "cleared": if (e.team === this.myTeam()) this.onUi({ kind: "hint", text: "Cleared — you can score" }); break;
        case "pass": audio.swoosh(); break;
        case "move": if (Math.random() < 0.6) audio.squeak(); break;
        case "rebound": break;
        case "emote": this.showBubble(e.by, QUICK_MESSAGES[e.id] ?? ""); break;
        case "msg": if (!e.to || e.to === me) { if (e.text) this.onUi({ kind: "hint", text: e.text }); } break;
        case "gameover": {
          audio.horn();
          const mode = this.lastSnap?.mode;
          if (mode === "shootout" || mode === "dunk") { audio.victory(); break; }
          const won = e.winner === this.myTeam();
          setTimeout(() => (won ? audio.victory() : audio.defeat()), 600);
          this.onUi({ kind: "center", text: won ? "VICTORY" : "DEFEAT", sub: `${e.score[0]} — ${e.score[1]}`, color: won ? "#3dff8a" : "#ff6b3d", big: true });
          break;
        }
        case "dunkscore": this.onUi({ kind: "dunk", text: e.score > 0 ? e.score.toFixed(1) : "MISS", sub: e.parts.join(" · "), color: e.score >= 9 ? "#3dff8a" : e.score >= 7.5 ? "#ffd166" : "#f2efe8" }); if (e.score >= 9) { audio.cheer(1.3); this.world.cheer(1.5); } break;
        case "shootout": break;
      }
    }
  }

  // ---------------------------------------------------------------- snapshot interpolation
  private interpolated(): Snapshot | null {
    const s = this.session; if (!s || s.snaps.length === 0) return null;
    const latest = s.snaps[s.snaps.length - 1];
    if (!s.online || s.snaps.length < 2) return latest.snap;
    const target = performance.now() - 110;
    let a = s.snaps[0], b = latest;
    for (let i = s.snaps.length - 1; i > 0; i--) { if (s.snaps[i - 1].t <= target) { a = s.snaps[i - 1]; b = s.snaps[i]; break; } }
    if (target >= latest.t) return latest.snap;
    const k = Math.max(0, Math.min(1, (target - a.t) / Math.max(1, b.t - a.t)));
    const out: Snapshot = { ...b.snap, p: b.snap.p.map((pb) => {
      const pa = a.snap.p.find((x) => x.id === pb.id); if (!pa) return pb;
      return { ...pb, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k, z: pa.z + (pb.z - pa.z) * k, f: lerpAng(pa.f, pb.f, k), at: pa.a === pb.a ? pa.at + (pb.at - pa.at) * k : pb.at };
    }) };
    const ba = a.snap.b, bb = b.snap.b;
    out.b = { ...bb, x: ba.x + (bb.x - ba.x) * k, y: ba.y + (bb.y - ba.y) * k, z: ba.z + (bb.z - ba.z) * k };
    // my own player uses the newest data (less input lag)
    const me = s.me;
    const mine = latest.snap.p.find((p) => p.id === me);
    if (mine) {
      const ext = Math.min(0.08, (performance.now() - latest.t) / 1000);
      out.p = out.p.map((p) => p.id === me ? { ...mine, x: mine.x + mine.vx * ext, z: mine.z + mine.vz * ext } : p);
      if (latest.snap.b.h === me) out.b = latest.snap.b;
    }
    return out;
  }

  // ---------------------------------------------------------------- frame
  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.frameCount++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = Math.round(this.frameCount / this.fpsT); this.frameCount = 0; this.fpsT = 0; }

    if (this.mode === "play" && this.session) {
      const inp = this.input.build(this.yaw);
      this.session.sendInput(inp);
      this.session.update(dt);
      const snap = this.interpolated();
      if (snap) { this.lastSnap = this.session.snaps[this.session.snaps.length - 1]?.snap ?? snap; this.renderSnap = snap; this.drawSnapshot(snap, dt); }
      this.updatePlayCamera(dt);
      this.updateMeter(dt);
    } else {
      this.updateShowcase(dt);
    }
    this.world.update(dt);
    this.sparks.update(dt);
    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
  }

  private drawSnapshot(s: Snapshot, dt: number) {
    const me = this.session!.me;
    for (const v of this.views.values()) v.seen = false;
    const ballHolder = s.b.s === "held" ? s.b.h : null;
    for (const p of s.p) {
      const v = this.view(p);
      v.seen = true;
      const k = 1 - Math.exp(-dt * (p.id === me ? 30 : 20));
      v.disp.x += (p.x - v.disp.x) * k; v.disp.z += (p.z - v.disp.z) * k; v.disp.y = p.y;
      if (Math.hypot(p.x - v.disp.x, p.z - v.disp.z) > 3) {
        v.disp.set(p.x, p.y, p.z);
        // teleported (check ball, new shootout rack): turn the camera to face the hoop
        if (p.id === me) { this.yaw = Math.atan2(HOOP.z - p.z, HOOP.x - p.x); this.camTarget.set(p.x, 1.5, p.z); }
      }
      v.facing = lerpAng(v.facing, p.f, 1 - Math.exp(-dt * 25));
      v.char.root.position.copy(v.disp);
      v.char.root.rotation.y = Math.PI / 2 - v.facing;
      const result = s.phase === "gameover" && s.winner !== -1 && (s.mode === "1v1" || s.mode === "2v2" || s.mode === "3v3") ? (p.tm === s.winner ? "win" : "lose") : null;
      const ballYaw = Math.atan2(s.b.z - p.z, s.b.x - p.x);
      let look = ballYaw - p.f; while (look > Math.PI) look -= Math.PI * 2; while (look < -Math.PI) look += Math.PI * 2;
      const anim: AnimInput = {
        speed: Math.hypot(p.vx, p.vz), sprint: !!(p.fl & 4), stance: !!(p.fl & 2), hasBall: ballHolder === p.id, hand: p.h,
        action: p.a, actionT: p.at, airborne: !!(p.fl & 8), celebration: this.loadouts.get(p.id)?.celebration ?? "flex",
        phase: s.phase, result, style: (p.fl >> 5) & 3, lookYaw: -look, holdBall: ballHolder === p.id && (s.phase === "check" || s.phase === "pregame"),
      };
      v.char.update(dt, anim);
      if (v.bubble) { v.bubbleT -= dt; if (v.bubbleT <= 0) { v.char.root.remove(v.bubble); v.bubble = null; } }
      if (v.ring) {
        const mat = v.ring.material as THREE.MeshBasicMaterial;
        mat.opacity = (p.id === me ? 0.95 : 0.55) * (ballHolder === p.id ? 0.8 + 0.2 * Math.sin(performance.now() / 120) : 1);
        v.ring.position.y = 0.02 - v.disp.y;
      }
    }
    for (const [id, v] of this.views) if (!v.seen) { v.char.dispose(); this.views.delete(id); }
    this.drawBall(s.b, s, dt);
    // shootout extra balls
    const xb = s.xb ?? [];
    while (this.extraBalls.length < xb.length) { const m = new THREE.Mesh(this.ball.geometry, this.ball.material); m.castShadow = true; this.scene.add(m); this.extraBalls.push(m); }
    this.extraBalls.forEach((m, i) => { if (xb[i]) { m.visible = true; m.position.set(xb[i][0], xb[i][1], xb[i][2]); m.rotation.x += dt * 8; } else m.visible = false; });
  }

  private heldBallPos(v: PView, p: PlayerSnap, s: Snapshot, out: THREE.Vector3, dt: number) {
    const c = v.char;
    const side = p.h > 0 ? "R" : "L", other = p.h > 0 ? "L" : "R";
    const fx = Math.cos(v.facing), fz = Math.sin(v.facing);
    if (p.a === "jumpshot" || p.a === "layup") {
      c.handWorld("R", out); out.y += 0.1; out.x += fx * 0.05; out.z += fz * 0.05; return;
    }
    if (p.a === "dunk" || s.phase === "check" || s.phase === "pregame" || p.a === "pass" || p.a === "celebrate") {
      c.handWorld("L", tmp2); c.handWorld("R", tmp3); out.copy(tmp2).add(tmp3).multiplyScalar(0.5); out.x += fx * 0.1; out.z += fz * 0.1;
      if (p.a === "dunk") out.y += 0.1;
      return;
    }
    if (p.a === "cross" || p.a === "btl" || p.a === "btb") {
      const t = sm(0, 0.32, p.at);
      c.handWorld(other, tmp2); c.handWorld(side, tmp3);
      const fl = new THREE.Vector3(v.disp.x, 0.13, v.disp.z);
      if (p.a === "cross") { fl.x += fx * 0.5; fl.z += fz * 0.5; }
      if (p.a === "btb") { fl.x -= fx * 0.35; fl.z -= fz * 0.35; }
      if (p.a === "btl") { fl.x += fx * 0.05; fl.z += fz * 0.05; }
      if (t < 0.5) out.lerpVectors(tmp2, fl, t * 2); else out.lerpVectors(fl, tmp3, (t - 0.5) * 2);
      if (Math.abs(t - 0.5) < 0.05 && v.lastDribble !== 2) { v.lastDribble = 2; this.dribbleSound(v); } else if (Math.abs(t - 0.5) >= 0.05) v.lastDribble = 0;
      return;
    }
    // regular dribble: hand -> floor -> hand
    c.handWorld(side as "L" | "R", tmp2);
    const ph = c.dribblePhase;
    const s2 = ph < 0.5 ? Math.pow(ph / 0.5, 1.5) : Math.pow(1 - (ph - 0.5) / 0.5, 0.75);
    const floor = tmp3.set(tmp2.x + fx * 0.12 + p.vx * 0.05, 0.12, tmp2.z + fz * 0.12 + p.vz * 0.05);
    out.lerpVectors(tmp2, floor, s2);
    out.y = Math.max(0.12, tmp2.y + (0.12 - tmp2.y) * s2 - 0.05);
    const half = ph >= 0.5 ? 1 : 0;
    if (half === 1 && v.lastDribble === 0) this.dribbleSound(v);
    v.lastDribble = half;
    void dt;
  }

  private dribbleSound(v: PView) {
    const d = v.disp.distanceTo(this.camera.position);
    if (d < 30) audio.bounce(4.5 / (1 + d * 0.12), Math.max(-1, Math.min(1, (v.disp.x - this.camera.position.x) / 15)));
  }

  private drawBall(b: BallSnap, s: Snapshot, dt: number) {
    if (!this.ball) return;
    const target = tmp.set(b.x, b.y, b.z);
    let held = false;
    if (b.s === "held" && b.h) {
      const v = this.views.get(b.h); const p = s.p.find((x) => x.id === b.h);
      if (v && p) { this.heldBallPos(v, p, s, target, dt); held = true; }
    }
    if (s.mode === "shootout" && b.s === "dead") target.set(0, -10, 0);
    if (this.lastBallState !== (held ? "held" : b.s)) { this.ballBlend = 0; this.lastBallState = held ? "held" : b.s; }
    this.ballBlend = Math.min(1, this.ballBlend + dt / 0.07);
    const prev = this.ballDisp.clone();
    if (this.ballBlend < 1 && prev.y > -5) this.ballDisp.lerp(target, this.ballBlend); else this.ballDisp.copy(target);
    this.ball.position.copy(this.ballDisp);
    // spin from motion
    const mv = tmp2.subVectors(this.ballDisp, prev);
    const dist = mv.length();
    if (dist > 1e-4 && dist < 2) {
      this.ballSpinAxis.set(mv.z, 0, -mv.x).normalize();
      if (this.ballSpinAxis.lengthSq() > 0) this.ball.rotateOnWorldAxis(this.ballSpinAxis, dist / 0.12);
    }
    if (b.s === "shot" && !held) this.ball.rotateOnWorldAxis(tmp3.set(Math.sin(Math.atan2(b.vz, b.vx)), 0, -Math.cos(Math.atan2(b.vz, b.vx))), -dt * 18);
    const h = Math.max(0, this.ballDisp.y - 0.12);
    this.ballShadow.position.set(this.ballDisp.x, 0.013, this.ballDisp.z);
    this.ballShadow.scale.setScalar(1 + h * 0.4);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.45 / (1 + h * 0.9);
    this.ballShadow.visible = this.ballDisp.y > -1;
  }

  // ---------------------------------------------------------------- camera
  private updatePlayCamera(dt: number) {
    const s = this.renderSnap; const me = this.session?.me;
    const v = me ? this.views.get(me) : undefined;
    const [mdx, mdy] = this.input.consumeMouse();
    const sens = 0.0024 * this.settings.sensitivity;
    if (!this.paused) {
      this.yaw += mdx * sens;
      this.pitch += (this.settings.invertY ? -mdy : mdy) * sens;
      this.pitch = Math.max(-0.05, Math.min(1.1, this.pitch));
    }
    const focus = v ? tmp.copy(v.disp) : tmp.set(6, 0, 0);
    // ON DEFENSE: swing the camera behind you so you face the ball handler (or the loose ball)
    const meSnap = s?.p.find((p) => p.id === me);
    const holder = s?.b.h ? s.p.find((p) => p.id === s.b.h) : undefined;
    const onDefense = !!(s && meSnap && (s.mode === "1v1" || s.mode === "2v2" || s.mode === "3v3") && (s.phase === "live" || s.phase === "check")
      && (holder ? holder.tm !== meSnap.tm : s.poss !== meSnap.tm));
    if (onDefense && v && s) {
      const tx = holder ? holder.x : s.b.x, tz = holder ? holder.z : s.b.z;
      if (Math.hypot(tx - focus.x, tz - focus.z) > 0.8) {
        const want = Math.atan2(tz - focus.z, tx - focus.x);
        this.yaw = lerpAng(this.yaw, want, 1 - Math.exp(-dt * 4.5));
      }
    } else if (this.settings.hoopCam && v) {
      const want = Math.atan2(HOOP.z - focus.z, HOOP.x - focus.x);
      const d = Math.hypot(HOOP.x - focus.x, HOOP.z - focus.z);
      if (d > 2.5) this.yaw = lerpAng(this.yaw, want, 1 - Math.exp(-dt * 2.5));
    }
    const ty = focus.y * 0.5 + 1.45;
    this.camTarget.lerp(tmp2.set(focus.x, ty, focus.z), 1 - Math.exp(-dt * 12));
    const dist = this.settings.camDist * (s?.mode === "dunk" ? 1.15 : 1);
    const cp = Math.cos(this.pitch), dir = tmp3.set(Math.cos(this.yaw) * cp, -Math.sin(this.pitch), Math.sin(this.yaw) * cp);
    const right = new THREE.Vector3(-Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const pos = this.camera.position;
    pos.copy(this.camTarget).addScaledVector(dir, -dist).addScaledVector(right, 0.45);
    pos.y = Math.max(0.55, pos.y + 0.35);
    pos.x = Math.max(-FENCE.x + 0.4, Math.min(FENCE.x + 2.5, pos.x));
    pos.z = Math.max(-FENCE.z + 0.4, Math.min(FENCE.z - 0.4, pos.z));
    this.camera.lookAt(tmp2.copy(this.camTarget).addScaledVector(dir, 3).addScaledVector(right, 0.45));
  }

  private updateShowcase(dt: number) {
    this.ensureShowcase();
    const c = this.showcase;
    if (!c) return;
    this.menuT += dt;
    let action: any = "none", actionT = 0;
    if (this.showcaseAction) {
      this.showcaseAction.t += dt; action = "celebrate"; actionT = this.showcaseAction.t;
      if (this.showcaseAction.t > 3) this.showcaseAction = null;
    }
    const inMenu = this.mode === "menu";
    c.root.position.set(inMenu ? 4.6 : 3, 0, inMenu ? 1.4 : 0);
    if (this.mode === "locker") { this.showcaseYaw += this.lockerSpin; this.lockerSpin *= 0.9; }
    c.root.rotation.y = this.mode === "locker" ? this.showcaseYaw : -Math.PI / 2 + 0.5;
    const dribbling = inMenu && !this.showcaseAction;
    c.update(dt, { speed: 0, sprint: false, stance: false, hasBall: dribbling, hand: 1, action, actionT, airborne: false, celebration: this.showcaseAction?.kind ?? "flex", phase: "", result: null, style: 0, lookYaw: 0, holdBall: false });
    // ball in the showcase hand
    if (this.ball) {
      if (dribbling) {
        c.handWorld("R", tmp2);
        const ph = c.dribblePhase; const s2 = ph < 0.5 ? Math.pow(ph / 0.5, 1.5) : Math.pow(1 - (ph - 0.5) / 0.5, 0.75);
        this.ball.position.set(tmp2.x, Math.max(0.12, tmp2.y + (0.12 - tmp2.y) * s2 - 0.05), tmp2.z);
        this.ball.rotation.x += dt * 4;
      } else this.ball.position.set(0, -10, 0);
      this.ballShadow.position.set(this.ball.position.x, 0.013, this.ball.position.z);
      this.ballShadow.visible = dribbling;
    }
    for (const v of this.views.values()) v.char.root.visible = false;
    if (inMenu) {
      // slow cinematic orbit that keeps the player and the mural in frame
      const a = -0.55 + Math.sin(this.menuT * 0.07) * 0.35;
      this.camera.position.set(4.6 + Math.cos(a) * -5.8, 1.55 + Math.sin(this.menuT * 0.11) * 0.15, 1.4 + Math.sin(a) * -5.8);
      this.camera.lookAt(7.5, 1.6, 0.4);
    } else {
      this.camera.position.set(3, 1.25, 3.3);
      this.camera.lookAt(3, 1.0, 0);
    }
  }

  // ---------------------------------------------------------------- shot meter
  bindMeter(el: HTMLElement | null) {
    this.meterEl = el;
    this.meterFill = el?.querySelector(".meter-fill") ?? null;
    this.meterZone = el?.querySelector(".meter-zone") ?? null;
    this.meterLabel = el?.querySelector(".meter-label") ?? null;
    this.meterContest = el?.querySelector(".meter-contest") ?? null;
  }

  private updateMeter(dt: number) {
    const el = this.meterEl; if (!el) return;
    const s = this.renderSnap; const me = this.session?.me;
    const p = s?.p.find((x) => x.id === me);
    const v = me ? this.views.get(me) : undefined;
    const holding = this.input.mouseL && this.input.enabled;
    const shooting = p && (p.a === "jumpshot" || p.a === "layup" || (p.a === "dunk" && s?.mode === "dunk"));
    const hasBall = !!p && s?.b.h === me;
    let show = false, value = 0, kind = this.lastMeterKind;
    if (this.meterFreeze > 0) { this.meterFreeze -= dt; show = true; value = this.lastMeterValue; }
    else if (holding && (shooting || hasBall) && p) {
      kind = p.a === "layup" ? "layup" : p.a === "dunk" ? "dunk" : p.a === "jumpshot" ? "jumpshot" : Math.hypot(HOOP.x - p.x, HOOP.z - p.z) < 3.5 && Math.hypot(p.vx, p.vz) > 1.5 ? "layup" : "jumpshot";
      if (s?.mode === "dunk") kind = "dunk";
      value = ((performance.now() - this.input.shootStart) / 1000) / SHOT_DURATION[kind];
      show = true; this.lastMeterValue = value; this.lastMeterKind = kind; this.meterGrade = null;
    }
    if (this.wasHolding && !holding && this.meterFreeze <= 0 && this.lastMeterValue > 0.05) this.meterFreeze = 0.7;
    this.wasHolding = holding;
    if (!this.settings.showMeter && !this.meterGrade) show = false;
    el.style.opacity = show ? "1" : "0";
    if (!show || !v) return;
    tmp.copy(v.disp); tmp.y += 1.4;
    tmp.project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w + 70}px, ${(-tmp.y * 0.5 + 0.5) * h - 70}px)`;
    const target = SHOT_TARGET[kind];
    const scale = kind === "layup" ? 1.4 : 1;
    if (this.meterFill) {
      this.meterFill.style.height = `${Math.min(1, value) * 100}%`;
      const g = this.meterGrade;
      this.meterFill.style.background = g === "perfect" ? "#3dff8a" : g === "excellent" ? "#9be15d" : g === "good" ? "#ffd166" : g ? "#ff6b3d" : value > target + WINDOWS.good * scale ? "#ff6b3d" : "#f2efe8";
    }
    // live contest: the green zone shrinks as a defender gets a hand up
    if (p && (p.a === "jumpshot" || p.a === "layup") && this.meterFreeze <= 0) this.liveContest = p.ct ?? 0;
    else if (!holding && this.meterFreeze <= 0) this.liveContest = 0;
    const g = WINDOWS.perfect * scale * greenScale(this.liveContest);
    if (this.meterZone) {
      this.meterZone.style.bottom = `${(target - g) * 100}%`;
      this.meterZone.style.height = `${g * 2 * 100}%`;
    }
    if (this.meterContest) {
      this.meterContest.textContent = s?.mode === "dunk" || s?.mode === "shootout" ? "" : contestLabel(this.liveContest);
      this.meterContest.style.color = contestColor(this.liveContest);
    }
    if (this.meterEl) this.meterEl.style.setProperty("--contest", contestColor(this.liveContest));
    if (this.meterLabel) this.meterLabel.textContent = this.meterGrade ? this.meterGrade.toUpperCase() : "";
  }

  // ---------------------------------------------------------------- HUD data (polled by React)
  hud() {
    const s = this.lastSnap; const me = this.session?.me;
    if (!s) return null;
    const mine = s.p.find((p) => p.id === me);
    return {
      mode: s.mode, phase: s.phase, score: s.score, poss: s.poss, clear: s.clear, shotClock: s.shotClock, time: s.time, timeLimit: s.timeLimit,
      myTeam: mine?.tm ?? 0, stamina: mine?.st ?? 1, hasBall: s.b.h === me, extra: s.extra, winner: s.winner,
      players: s.p.map((p) => ({ id: p.id, name: p.n, team: p.tm, bot: p.bot, me: p.id === me, ss: p.ss, hasBall: s.b.h === p.id })),
      fps: this.fps,
    };
  }
}

export function contestColor(c: number) {
  return c < 0.15 ? "#3dff8a" : c < 0.35 ? "#9be15d" : c < 0.6 ? "#ffd166" : c < 0.8 ? "#ff9a3d" : "#ff4d3d";
}

export const engine = new Engine();
