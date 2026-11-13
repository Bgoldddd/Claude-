// All sounds are synthesized live with the Web Audio API (original, no sample files).
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode; sfx!: GainNode; crowd!: GainNode; ui!: GainNode;
  private crowdSrc: AudioBufferSourceNode | null = null;
  private crowdFilter!: BiquadFilterNode;
  private crowdLevel = 0.25;
  vol = { master: 0.8, sfx: 0.9, crowd: 0.5, ui: 0.7 };
  private noiseBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture (browser rule). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const C = window.AudioContext || (window as any).webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.crowd = c.createGain(); this.crowd.connect(this.master);
    this.ui = c.createGain(); this.ui.connect(this.master);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startCrowd();
  }

  setVolumes(v: Partial<typeof this.vol>) { this.vol = { ...this.vol, ...v }; this.applyVolumes(); }
  private applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfx.gain.value = this.vol.sfx;
    this.crowd.gain.value = this.vol.crowd;
    this.ui.gain.value = this.vol.ui;
  }

  private noise(dur: number, out: AudioNode, opts: { type?: BiquadFilterType; freq?: number; q?: number; gain?: number; attack?: number; decay?: number; t?: number } = {}) {
    const c = this.ctx; if (!c || !this.noiseBuf) return;
    const t = opts.t ?? c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = opts.type ?? "bandpass"; f.frequency.value = opts.freq ?? 1000; f.Q.value = opts.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.5, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.decay ?? dur));
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, out: AudioNode, opts: { type?: OscillatorType; gain?: number; slide?: number; t?: number; attack?: number } = {}) {
    const c = this.ctx; if (!c) return;
    const t = opts.t ?? c.currentTime;
    const o = c.createOscillator(); o.type = opts.type ?? "sine"; o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(opts.gain ?? 0.3, t + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- game sounds
  bounce(v = 4, pan = 0) {
    if (!this.ctx) return;
    const k = Math.min(1, v / 7);
    const out = this.panner(pan);
    this.tone(150 + 40 * k, 0.16, out, { gain: 0.55 * k + 0.08, slide: 0.45 });
    this.noise(0.06, out, { type: "lowpass", freq: 900, gain: 0.25 * k + 0.05, decay: 0.06 });
    this.tone(620, 0.05, out, { gain: 0.05 * k, type: "triangle" }); // concrete slap
  }
  rim(v = 3) {
    if (!this.ctx) return;
    const k = Math.min(1, v / 5);
    for (const [f, g] of [[523, 0.22], [1307, 0.12], [2210, 0.07], [3410, 0.04]] as const) this.tone(f * (0.98 + Math.random() * 0.04), 0.5 + k * 0.4, this.sfx, { gain: g * (0.4 + k), type: "sine" });
    this.noise(0.05, this.sfx, { freq: 3000, q: 2, gain: 0.2 * k });
  }
  board(v = 3) {
    if (!this.ctx) return;
    const k = Math.min(1, v / 5);
    this.tone(95, 0.22, this.sfx, { gain: 0.45 * k + 0.1, slide: 0.7 });
    this.noise(0.12, this.sfx, { type: "lowpass", freq: 600, gain: 0.3 * k });
  }
  /** Chain-net jingle: lots of tiny metallic ticks. */
  chain(swish = true) {
    const c = this.ctx; if (!c) return;
    const n = swish ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const t = c.currentTime + i * 0.012 + Math.random() * 0.02;
      this.tone(2800 + Math.random() * 3200, 0.07 + Math.random() * 0.05, this.sfx, { gain: 0.05 + Math.random() * 0.04, t, type: "triangle" });
    }
    this.noise(0.35, this.sfx, { type: "highpass", freq: 5000, gain: 0.12, decay: 0.35 });
  }
  squeak() {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(1800 + Math.random() * 600, t); o.frequency.linearRampToValueAtTime(2600 + Math.random() * 500, t + 0.09);
    const lfo = c.createOscillator(); lfo.frequency.value = 60; const lg = c.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(o.frequency);
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = 6;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t); lfo.start(t); o.stop(t + 0.15); lfo.stop(t + 0.15);
  }
  swoosh() { this.noise(0.25, this.sfx, { freq: 800, q: 0.8, gain: 0.15, attack: 0.08, decay: 0.25 }); }
  whistle() {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = 2900;
    const lfo = c.createOscillator(); lfo.frequency.value = 35; const lg = c.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(o.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.setValueAtTime(0.18, t + 0.32); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g); g.connect(this.sfx); o.start(t); lfo.start(t); o.stop(t + 0.5); lfo.stop(t + 0.5);
  }
  perfect() { const c = this.ctx; if (!c) return; [880, 1318, 1760].forEach((f, i) => this.tone(f, 0.25, this.ui, { gain: 0.12, t: c.currentTime + i * 0.05, type: "triangle" })); }
  meterTick() { this.tone(1200, 0.04, this.ui, { gain: 0.05, type: "square" }); }
  click() { this.tone(660, 0.05, this.ui, { gain: 0.08, type: "triangle" }); this.tone(990, 0.04, this.ui, { gain: 0.04, type: "sine" }); }
  hover() { this.tone(1400, 0.025, this.ui, { gain: 0.025, type: "sine" }); }
  horn() {
    const c = this.ctx; if (!c) return;
    for (const f of [220, 277, 330]) this.tone(f, 0.9, this.sfx, { gain: 0.12, type: "sawtooth", attack: 0.03 });
  }
  victory() { const c = this.ctx; if (!c) return; [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, this.ui, { gain: 0.14, t: c.currentTime + i * 0.12, type: "triangle" })); this.cheer(1); }
  defeat() { const c = this.ctx; if (!c) return; [392, 330, 262].forEach((f, i) => this.tone(f, 0.6, this.ui, { gain: 0.12, t: c.currentTime + i * 0.18, type: "triangle" })); }
  /** A short burst of crowd noise on big plays. */
  cheer(k = 0.6) {
    const c = this.ctx; if (!c) return;
    this.noise(1.6, this.crowd, { type: "bandpass", freq: 1200, q: 0.6, gain: 0.6 * k, attack: 0.08, decay: 1.6 });
    this.noise(1.2, this.crowd, { type: "bandpass", freq: 2500, q: 1.2, gain: 0.25 * k, attack: 0.1, decay: 1.2 });
    for (let i = 0; i < 6 * k; i++) this.tone(300 + Math.random() * 500, 0.3, this.crowd, { gain: 0.03, t: c.currentTime + Math.random() * 0.6, type: "sawtooth", slide: 1.3 });
  }
  ooh() { const c = this.ctx; if (!c) return; this.tone(220, 0.8, this.crowd, { gain: 0.08, type: "sawtooth", slide: 0.7, attack: 0.1 }); this.noise(0.8, this.crowd, { freq: 500, q: 1, gain: 0.25, attack: 0.1, decay: 0.8 }); }

  private panner(pan: number): AudioNode {
    const c = this.ctx!;
    if (!c.createStereoPanner) return this.sfx;
    const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(this.sfx);
    return p;
  }

  private startCrowd() {
    const c = this.ctx; if (!c || !this.noiseBuf) return;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    this.crowdFilter = c.createBiquadFilter(); this.crowdFilter.type = "bandpass"; this.crowdFilter.frequency.value = 700; this.crowdFilter.Q.value = 0.5;
    const g = c.createGain(); g.gain.value = this.crowdLevel;
    // slow swell
    const lfo = c.createOscillator(); lfo.frequency.value = 0.13; const lg = c.createGain(); lg.gain.value = 0.08; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.connect(this.crowdFilter); this.crowdFilter.connect(g); g.connect(this.crowd);
    src.start();
    this.crowdSrc = src;
  }
  setCrowdIntensity(k: number) { if (this.crowdFilter) this.crowdFilter.frequency.value = 600 + k * 500; }
}

export const audio = new Audio();
