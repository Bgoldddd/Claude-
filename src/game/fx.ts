// Small visual helpers: nameplates, chat bubbles, player rings, spark bursts.
import * as THREE from "three";

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function makeNameplate(name: string, sub: string, plate: { bg: string; fg: string; accent: string }, teamColor: string): THREE.Sprite {
  const c = document.createElement("canvas"); c.width = 512; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = plate.bg + "e6"; roundRect(g, 16, 18, 480, 82, 18); g.fill();
  g.fillStyle = teamColor; roundRect(g, 16, 18, 14, 82, 7); g.fill();
  g.fillStyle = plate.fg; g.font = "italic 800 46px Poppins, Arial Black, sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
  g.fillText(name.toUpperCase().slice(0, 16), 46, 52);
  g.fillStyle = plate.accent; g.font = "600 22px Poppins, Arial, sans-serif";
  g.fillText(sub.toUpperCase(), 48, 86);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(1.1, 0.275, 1); s.renderOrder = 10;
  return s;
}

export function makeBubble(text: string): THREE.Sprite {
  const c = document.createElement("canvas"); c.width = 512; c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "700 44px Poppins, Arial, sans-serif";
  const w = Math.min(480, g.measureText(text).width + 60);
  g.fillStyle = "#f2efe8"; roundRect(g, (512 - w) / 2, 10, w, 84, 26); g.fill();
  g.beginPath(); g.moveTo(236, 92); g.lineTo(256, 120); g.lineTo(276, 92); g.fill();
  g.fillStyle = "#151517"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 54);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(1.3, 0.325, 1); s.renderOrder = 11;
  return s;
}

export function makeRing(color: string, me: boolean): THREE.Mesh {
  const g = new THREE.RingGeometry(me ? 0.48 : 0.44, me ? 0.58 : 0.5, 40);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: me ? 0.95 : 0.6, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(g, m); ring.position.y = 0.02; ring.renderOrder = 2;
  if (me) {
    const a = new THREE.Shape(); a.moveTo(0, 0.78); a.lineTo(0.13, 0.6); a.lineTo(-0.13, 0.6); a.lineTo(0, 0.78);
    const ag = new THREE.ShapeGeometry(a); ag.rotateX(-Math.PI / 2);
    const arrow = new THREE.Mesh(ag, m); arrow.rotation.y = Math.PI; ring.add(arrow);
  }
  return ring;
}

export class Sparks {
  points: THREE.Points;
  private vel: Float32Array;
  private life: Float32Array;
  private n = 160;
  private i = 0;
  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.n * 3).fill(-999), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
    this.vel = new Float32Array(this.n * 3); this.life = new Float32Array(this.n);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  burst(p: THREE.Vector3, color: string, count = 40, speed = 3) {
    const pos = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const j = this.i++ % this.n;
      pos.setXYZ(j, p.x, p.y, p.z);
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.8);
      this.vel[j * 3] = Math.cos(a) * Math.sqrt(1 - u * u) * s; this.vel[j * 3 + 1] = Math.abs(u) * s + 1; this.vel[j * 3 + 2] = Math.sin(a) * Math.sqrt(1 - u * u) * s;
      this.life[j] = 0.7 + Math.random() * 0.6;
      col.setXYZ(j, c.r, c.g, c.b);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }
  update(dt: number) {
    const pos = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    let any = false;
    for (let j = 0; j < this.n; j++) {
      if (this.life[j] <= 0) continue;
      any = true;
      this.life[j] -= dt;
      this.vel[j * 3 + 1] -= 6 * dt;
      pos.setXYZ(j, pos.getX(j) + this.vel[j * 3] * dt, pos.getY(j) + this.vel[j * 3 + 1] * dt, pos.getZ(j) + this.vel[j * 3 + 2] * dt);
      if (this.life[j] <= 0) pos.setXYZ(j, -999, -999, -999);
    }
    if (any) pos.needsUpdate = true;
  }
}
