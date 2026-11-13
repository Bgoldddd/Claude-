// Debug view: ?posetest shows the character in every animation, side by side.
import * as THREE from "three";
import { loadGLB } from "./game/assets";
import { Character, setCharacterParts } from "./game/character";
import { defaultLoadout } from "../shared/cosmetics";

export async function poseTest() {
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(window.innerWidth, window.innerHeight); r.domElement.style.cssText = "position:fixed;inset:0;z-index:5"; document.body.appendChild(r.domElement);
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#3a3d44");
  scene.add(new THREE.HemisphereLight("#fff", "#555", 1.6));
  const d = new THREE.DirectionalLight("#fff", 2); d.position.set(3, 6, 8); scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 200);
  const view = new URLSearchParams(location.search).get("view") ?? "front";
  setCharacterParts(await loadGLB("assets/character_parts.glb"));
  const poses: [string, any][] = [
    ["idle", {}], ["run", { speed: 5 }], ["dribble", { hasBall: true, speed: 0 }], ["stance", { stance: true }],
    ["shot .1", { action: "jumpshot", actionT: 0.1 }], ["shot .5", { action: "jumpshot", actionT: 0.5 }], ["shot .9", { action: "jumpshot", actionT: 0.9 }],
    ["layup", { action: "layup", actionT: 0.35 }], ["dunk", { action: "dunk", actionT: 0.6 }], ["pass", { action: "pass", actionT: 0.12 }],
    ["steal", { action: "steal", actionT: 0.15 }], ["block", { action: "jump", actionT: 0.2 }], ["cross", { action: "cross", actionT: 0.15, hasBall: true }],
    ["btb", { action: "btb", actionT: 0.15, hasBall: true, hand: -1 }], ["hold", { hasBall: true, holdBall: true }], ["stumble", { action: "stumble" }],
    ["flex", { action: "celebrate", actionT: 1, celebration: "flex" }], ["sky", { action: "celebrate", actionT: 1, celebration: "sky" }],
    ["lose", { result: "lose" }], ["sit", { sitting: true }],
  ];
  const cols = 10;
  poses.forEach(([, a], i) => {
    const c = new Character(false);
    c.setLoadout({ ...defaultLoadout(), accessories: ["Acc_Headband", "Acc_Wristband"] });
    const x = (i % cols) * 1.3, y = Math.floor(i / cols) * -2.6;
    c.root.position.set(x, y, 0);
    c.root.rotation.y = view === "side" ? Math.PI / 2 : view === "back" ? Math.PI : 0;
    for (let k = 0; k < 40; k++) c.update(1 / 30, { speed: 0, sprint: false, stance: false, hasBall: false, hand: 1, action: "none", actionT: 0 as number, airborne: false, celebration: "flex", phase: "", result: null, style: 0, lookYaw: 0, holdBall: false, ...a });
    scene.add(c.root);
  });
  cam.position.set(5.85, -1.2, 22); cam.lookAt(5.85, -1.4, 0);
  r.render(scene, cam);
  document.title = "posetest-ready";
}
