// Keyboard + mouse input with rebindable keys. Produces a PlayerInput every frame.
import { emptyInput, PlayerInput } from "../../shared/types";

export type Bind = "forward" | "back" | "left" | "right" | "sprint" | "jump" | "pass" | "interact" | "move" | "action" | "scoreboard" | "camera";
export const DEFAULT_BINDS: Record<Bind, string> = {
  forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", sprint: "ShiftLeft", jump: "Space",
  pass: "KeyQ", interact: "KeyE", move: "KeyC", action: "KeyR", scoreboard: "Tab", camera: "KeyV",
};
export const BIND_LABELS: Record<Bind, string> = {
  forward: "Move forward", back: "Move back", left: "Move left", right: "Move right", sprint: "Sprint", jump: "Jump / Block / Rebound",
  pass: "Pass", interact: "Interact / Check ball", move: "Dribble move", action: "Steal (defense) / Step-back (offense)", scoreboard: "Scoreboard", camera: "Camera mode",
};

export function keyName(code: string) {
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace("ShiftLeft", "L-Shift").replace("ShiftRight", "R-Shift").replace("ControlLeft", "L-Ctrl").replace("AltLeft", "L-Alt").replace("Space", "Space");
}

export type Scheme = "iso" | "classic";
export const ISO_KEYS: [string, string, string][] = [
  ["W A S D", "Move (W is always toward the hoop)", "Move"],
  ["Space", "Hold to shoot, let go on the green · tap to pump fake", "Block (jump as they rise)"],
  ["J", "Crossover (best right when they reach)", "Steal (miss and you stumble)"],
  ["K", "Stepback", "Slide (hold A or D the way they go)"],
  ["L", "Drive (press twice to blow by)", "Jump"],
  ["I", "Pass", "—"],
  ["Shift", "Sprint", "Sprint"],
  ["E", "Check the ball", "—"],
];

export class Input {
  scheme: Scheme = "iso";
  spaceDown = false;
  autoStance = false;
  keys = new Set<string>();
  binds: Record<Bind, string> = { ...DEFAULT_BINDS };
  mouseL = false; mouseR = false;
  dx = 0; dy = 0; // accumulated mouse delta
  counters = { jump: 0, pass: 0, move: 0, action: 0, interact: 0, emote: 0, j: 0, k: 0, l: 0 };
  emoteId = 0;
  seq = 0;
  shootStart = 0;
  shootEnd = 0;
  enabled = false;
  onToggleScoreboard: (down: boolean) => void = () => {};
  onCamera: () => void = () => {};
  onEscape: () => void = () => {};
  private el: HTMLElement | null = null;

  attach(el: HTMLElement) {
    this.el = el;
    window.addEventListener("keydown", this.kd);
    window.addEventListener("keyup", this.ku);
    el.addEventListener("mousedown", this.md);
    window.addEventListener("mouseup", this.mu);
    window.addEventListener("mousemove", this.mm);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("blur", () => { this.keys.clear(); this.mouseL = this.mouseR = false; this.spaceDown = false; });
  }

  private isTyping(e: Event) { const t = e.target as HTMLElement; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"); }

  private kd = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    if (e.code === "Escape") { this.onEscape(); return; }
    if (!this.enabled) return;
    if (e.code === this.binds.scoreboard) { e.preventDefault(); this.onToggleScoreboard(true); }
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (this.scheme === "iso") {
      if (e.code === "Space") { if (!this.spaceDown) this.shootStart = performance.now(); this.spaceDown = true; this.counters.jump++; }
      if (e.code === "KeyJ") this.counters.j++;
      if (e.code === "KeyK") this.counters.k++;
      if (e.code === "KeyL") this.counters.l++;
      if (e.code === "KeyI") this.counters.pass++;
      if (e.code === "KeyE") this.counters.interact++;
      if (e.code === this.binds.camera) this.onCamera();
      if (/^Digit[1-8]$/.test(e.code)) { this.emoteId = Number(e.code.slice(5)) - 1; this.counters.emote++; }
      return;
    }
    const b = this.binds;
    if (e.code === b.jump) this.counters.jump++;
    if (e.code === b.pass) this.counters.pass++;
    if (e.code === b.move) this.counters.move++;
    if (e.code === b.action) this.counters.action++;
    if (e.code === b.interact) this.counters.interact++;
    if (e.code === b.camera) this.onCamera();
    if (/^Digit[1-8]$/.test(e.code)) { this.emoteId = Number(e.code.slice(5)) - 1; this.counters.emote++; }
  };
  private ku = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === "Space" && this.spaceDown) { this.spaceDown = false; this.shootEnd = performance.now(); }
    if (e.code === this.binds.scoreboard) this.onToggleScoreboard(false);
  };
  private md = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (e.button === 0) { if (!this.mouseL) this.shootStart = performance.now(); this.mouseL = true; }
    if (e.button === 2) this.mouseR = true;
  };
  private mu = (e: MouseEvent) => { if (e.button === 0) { if (this.mouseL) this.shootEnd = performance.now(); this.mouseL = false; } if (e.button === 2) this.mouseR = false; };
  private mm = (e: MouseEvent) => {
    if (document.pointerLockElement === this.el) { this.dx += e.movementX; this.dy += e.movementY; }
  };

  get shootHeld() { return this.enabled && (this.scheme === "iso" ? this.spaceDown : this.mouseL); }

  consumeMouse() { const r = [this.dx, this.dy]; this.dx = 0; this.dy = 0; return r; }

  /** Build the input for this frame, with movement relative to the camera yaw. */
  build(camYaw: number): PlayerInput {
    const k = this.keys, b = this.binds;
    let f = 0, s = 0;
    if (this.enabled) {
      const iso = this.scheme === "iso";
      if (k.has(iso ? "KeyW" : b.forward)) f += 1; if (k.has(iso ? "KeyS" : b.back)) f -= 1;
      if (k.has(iso ? "KeyD" : b.right)) s += 1; if (k.has(iso ? "KeyA" : b.left)) s -= 1;
    }
    // camera looks along (cos yaw, sin yaw); right is (-sin, cos)
    const fx = Math.cos(camYaw), fz = Math.sin(camYaw);
    let mx = fx * f + -fz * s, mz = fz * f + fx * s;
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    const shoot = this.enabled && (this.scheme === "iso" ? this.spaceDown : this.mouseL);
    return {
      ...emptyInput(), seq: this.seq++, mx, mz, yaw: camYaw,
      sprint: this.enabled && (k.has(this.scheme === "iso" ? "ShiftLeft" : b.sprint) || k.has("ShiftRight")), shoot, stance: this.enabled && (this.scheme === "iso" ? this.autoStance : this.mouseR),
      ...this.counters, emoteId: this.emoteId,
      hold: ((shoot ? performance.now() : this.shootEnd) - this.shootStart) / 1000,
    };
  }
}
