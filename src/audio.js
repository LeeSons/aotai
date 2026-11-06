// ===================== 程序化音频：风、雨、脚步、雷、心跳、呼吸、五声音阶配乐 =====================
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.musicMood = 0; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.35; this.musicBus.connect(this.master);
    // 混响（简易卷积）
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.reverb.buffer = ir;
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.5; this.reverb.connect(this.revGain); this.revGain.connect(this.master);

    // 噪声
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; nd[i] = w * 0.6 + last * 3.0; }
    this.noiseBuf = nb;
    const loop = (filterType, f, q, g0) => {
      const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true; src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const flt = ctx.createBiquadFilter(); flt.type = filterType; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = g0;
      src.connect(flt); flt.connect(g); g.connect(this.sfx); src.start();
      return { src, flt, g };
    };
    this.wind = loop('bandpass', 500, 0.8, 0);
    this.windHi = loop('bandpass', 1400, 6, 0);
    this.rain = loop('highpass', 1200, 0.5, 0);
    this.rainLo = loop('lowpass', 400, 0.7, 0);
    this.stream = loop('bandpass', 2200, 0.6, 0);
    this.musicNext = 2;
    this.birdNext = 3;
    this.heartNext = 0;
    this.breathNext = 0;
    this.t = 0;
  }

  setMaster(v) { if (this.master) this.master.gain.value = v; }

  env(p) {
    // p: wind 0..12, rain 0..1, stream 0..1, inside 0..1
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const w = Math.max(0, p.wind) / 10;
    const muf = 1 - p.inside * 0.7;
    const gust = 0.75 + 0.25 * Math.sin(t * 0.7) * Math.sin(t * 0.31 + 1);
    this.wind.g.gain.setTargetAtTime(Math.min(0.9, w * w * 0.9 + 0.03) * gust * muf, t, 0.3);
    this.wind.flt.frequency.setTargetAtTime(300 + w * 700 * gust, t, 0.4);
    this.windHi.g.gain.setTargetAtTime(Math.max(0, w - 0.5) * 0.35 * gust * muf, t, 0.3);
    this.windHi.flt.frequency.setTargetAtTime(900 + w * 900 + Math.sin(t * 1.3) * 200, t, 0.3);
    this.rain.g.gain.setTargetAtTime(p.rain * 0.45 * (p.inside > 0.5 ? 1.1 : 1), t, 0.5);
    this.rain.flt.frequency.setTargetAtTime(p.inside > 0.5 ? 2500 : 1100, t, 0.3);
    this.rainLo.g.gain.setTargetAtTime(p.rain * 0.35, t, 0.5);
    this.stream.g.gain.setTargetAtTime(p.stream * 0.12, t, 0.5);
  }

  burst({ f = 1000, type = 'bandpass', q = 1, dur = 0.12, vol = 0.3, attack = 0.005, rate = 1, rev = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = rate;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(this.sfx); if (rev) { const rg = ctx.createGain(); rg.gain.value = rev; g.connect(rg); rg.connect(this.reverb); }
    s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }

  tone({ f = 440, type = 'sine', dur = 0.3, vol = 0.2, attack = 0.01, bus, glide = 0, rev = 0.3, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * glide), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfx);
    if (rev) { const rg = ctx.createGain(); rg.gain.value = rev; g.connect(rg); rg.connect(this.reverb); }
    o.start(t); o.stop(t + dur + 0.05);
  }

  step(surface, speed) {
    const v = Math.min(0.35, 0.12 + speed * 0.025);
    if (surface === 'rock') { this.burst({ f: 1800 + Math.random() * 900, q: 2, dur: 0.07, vol: v * 0.9 }); this.burst({ f: 3200, q: 4, dur: 0.03, vol: v * 0.4, delay: 0.02 }); }
    else if (surface === 'snow') this.burst({ f: 700 + Math.random() * 300, type: 'lowpass', q: 0.5, dur: 0.18, vol: v * 1.1, attack: 0.03 });
    else if (surface === 'wet') this.burst({ f: 900, q: 1.5, dur: 0.14, vol: v, attack: 0.01 });
    else this.burst({ f: 500 + Math.random() * 300, type: 'lowpass', q: 0.7, dur: 0.12, vol: v * 0.9 });
  }

  thunder(dist) {
    const delay = Math.min(4, dist / 250);
    const vol = Math.max(0.15, 1 - dist / 900);
    if (dist < 250) this.burst({ f: 3000, type: 'highpass', dur: 0.25, vol: vol * 0.6, delay });
    this.burst({ f: 180, type: 'lowpass', q: 0.8, dur: 4.5, vol: vol * 0.9, attack: 0.05, delay, rate: 0.5, rev: 0.6 });
    this.burst({ f: 90, type: 'lowpass', q: 1, dur: 6, vol: vol * 0.7, attack: 0.4, delay: delay + 0.3, rate: 0.3 });
  }

  impact(v = 0.6) { this.burst({ f: 220, type: 'lowpass', dur: 0.35, vol: v, rate: 0.6 }); this.tone({ f: 70, dur: 0.3, vol: v * 0.6, glide: 0.5, rev: 0 }); }
  rockRoll() { for (let i = 0; i < 8; i++) this.burst({ f: 900 + Math.random() * 1200, q: 3, dur: 0.08, vol: 0.25, delay: i * 0.09 + Math.random() * 0.05, rev: 0.3 }); }
  snort() { this.burst({ f: 400, q: 1, dur: 0.5, vol: 0.5, rate: 0.5, attack: 0.05 }); this.tone({ f: 85, type: 'sawtooth', dur: 0.6, vol: 0.08, glide: 0.7, rev: 0.2 }); }
  hiss() { this.burst({ f: 6000, type: 'highpass', dur: 1.1, vol: 0.2, attack: 0.2 }); }
  ui() { this.tone({ f: 880, dur: 0.08, vol: 0.06, rev: 0 }); }
  buy() { this.tone({ f: 1320, dur: 0.1, vol: 0.06, rev: 0 }); this.tone({ f: 1760, dur: 0.12, vol: 0.05, delay: 0.06, rev: 0 }); }
  warn() { this.tone({ f: 330, type: 'triangle', dur: 0.4, vol: 0.12 }); this.tone({ f: 311, type: 'triangle', dur: 0.5, vol: 0.1, delay: 0.25 }); }
  gustWarn() { this.burst({ f: 600, q: 0.7, dur: 1.6, vol: 0.4, attack: 1.0 }); }
  sting() { this.burst({ f: 300, q: 0.5, dur: 0.15, vol: 0.4 }); }
  eat() { for (let i = 0; i < 4; i++) this.burst({ f: 1500, q: 2, dur: 0.05, vol: 0.12, delay: i * 0.18 }); }
  drink() { for (let i = 0; i < 3; i++) this.tone({ f: 300 + Math.random() * 80, dur: 0.12, vol: 0.08, glide: 1.8, delay: i * 0.28, rev: 0.1 }); }
  zip() { this.burst({ f: 2500, q: 3, dur: 0.5, vol: 0.15, attack: 0.05, rate: 1.4 }); }
  buzz() { this.tone({ f: 120, type: 'sawtooth', dur: 1.5, vol: 0.05, rev: 0 }); this.burst({ f: 5000, type: 'highpass', dur: 1.5, vol: 0.06, attack: 0.5 }); }

  // ---- 雾中怪声 ----
  voice() {
    // 远处“喂——”：带共振峰的锯齿波
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t); o.frequency.linearRampToValueAtTime(210, t + 0.3); o.frequency.linearRampToValueAtTime(160, t + 1.6);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 700; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.25); g.gain.linearRampToValueAtTime(0.0001, t + 1.8);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g);
    if (pan) { pan.pan.value = Math.random() * 2 - 1; g.connect(pan); pan.connect(this.reverb); pan.connect(this.sfx); } else { g.connect(this.reverb); }
    o.start(t); o.stop(t + 2);
  }
  footBehind() { for (let i = 0; i < 5; i++) this.burst({ f: 1500 + Math.random() * 500, q: 2, dur: 0.07, vol: 0.09 - i * 0.012, delay: i * 0.55 + Math.random() * 0.08, rev: 0.5 }); }
  bell() { [220, 440 * 1.01, 660 * 0.99, 880 * 1.37].forEach((f, i) => this.tone({ f, type: 'sine', dur: 6 - i, vol: 0.06 / (i + 1), attack: 0.005, rev: 0.9, bus: this.musicBus })); }
  whistle() { this.tone({ f: 1800, dur: 0.6, vol: 0.03, glide: 1.25, rev: 0.8 }); this.tone({ f: 2200, dur: 0.4, vol: 0.025, glide: 0.8, rev: 0.8, delay: 0.7 }); }
  eagle() { this.tone({ f: 2400, type: 'triangle', dur: 0.9, vol: 0.035, glide: 0.6, rev: 0.7 }); this.tone({ f: 2100, type: 'triangle', dur: 0.7, vol: 0.025, glide: 0.55, rev: 0.7, delay: 0.8 }); }
  cuckoo() { this.tone({ f: 660, dur: 0.35, vol: 0.05, glide: 0.98, rev: 0.6 }); this.tone({ f: 523, dur: 0.5, vol: 0.05, glide: 0.98, rev: 0.6, delay: 0.42 }); }
  pole() { this.burst({ f: 3400, q: 5, dur: 0.04, vol: 0.08 }); }
  birdSong(kind) {
    if (kind === 0) { const f = 2600 + Math.random() * 1500, n = 3 + (Math.random() * 5 | 0); for (let i = 0; i < n; i++) this.tone({ f: f * (1 + (Math.random() - 0.5) * 0.25), dur: 0.08, vol: 0.03, glide: 1.4, delay: i * 0.1, rev: 0.4 }); }
    else if (kind === 1) { for (let i = 0; i < 6; i++) this.tone({ f: 3800 - i * 120, dur: 0.05, vol: 0.022, glide: 0.8, delay: i * 0.07, rev: 0.4 }); }
    else if (kind === 2) { this.tone({ f: 1900, dur: 0.25, vol: 0.035, glide: 1.6, rev: 0.5 }); this.tone({ f: 3000, dur: 0.3, vol: 0.03, glide: 0.7, delay: 0.3, rev: 0.5 }); this.tone({ f: 2400, dur: 0.4, vol: 0.03, glide: 1.2, delay: 0.65, rev: 0.5 }); }
    else this.cuckoo();
  }

  arrival() {
    // 五声音阶琶音（宫商角徵羽）
    const base = 293.66; const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
    [0, 2, 3, 4, 5].forEach((k, i) => this.pluck(base * scale[k], 0.12 + i * 0.16, 0.12));
  }
  pluck(f, delay = 0, vol = 0.1) {
    // 古筝式拨弦
    this.tone({ f, type: 'triangle', dur: 2.2, vol, attack: 0.004, delay, rev: 0.6, bus: this.musicBus });
    this.tone({ f: f * 2, type: 'sine', dur: 1.2, vol: vol * 0.35, attack: 0.004, delay, rev: 0.6, bus: this.musicBus });
  }

  update(dt, p) {
    // p: heart(0..1), breath(0..1), forest(bool), day(bool), calm(0..1 danger 0 ... calm 1), muffled
    if (!this.ctx) return;
    this.t += dt;
    if (p.heart > 0) {
      this.heartNext -= dt;
      if (this.heartNext <= 0) {
        this.heartNext = 1.1 - p.heart * 0.55;
        this.tone({ f: 55, dur: 0.18, vol: 0.25 * p.heart, glide: 0.6, rev: 0 });
        this.tone({ f: 50, dur: 0.2, vol: 0.18 * p.heart, glide: 0.6, rev: 0, delay: 0.16 });
      }
    }
    if (p.breath > 0) {
      this.breathNext -= dt;
      if (this.breathNext <= 0) {
        this.breathNext = 1.9 - p.breath * 0.9;
        this.burst({ f: 700, q: 1.2, dur: 0.55, vol: 0.12 * p.breath, attack: 0.25 });
        this.burst({ f: 500, q: 1.2, dur: 0.6, vol: 0.1 * p.breath, attack: 0.15, delay: 0.75 - p.breath * 0.3 });
      }
    }
    if ((p.forest || p.meadow) && p.day && p.calm > 0.55 && p.birds > 0) {
      this.birdNext -= dt * p.birds;
      if (this.birdNext <= 0) {
        this.birdNext = (p.forest ? 1.5 : 4) + Math.random() * 5;
        const r = Math.random();
        this.birdSong(r < 0.45 ? 0 : r < 0.7 ? 1 : r < 0.92 ? 2 : 3);
      }
    }
    // 配乐：根据情绪选择音符
    this.musicNext -= dt;
    if (this.musicNext <= 0) {
      const calm = p.calm;
      const base = calm > 0.5 ? 293.66 : 220; // D / A
      const pent = calm > 0.5 ? [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3] : [1, 6 / 5, 4 / 3, 3 / 2, 9 / 5];
      const oct = Math.random() < 0.3 ? 0.5 : Math.random() < 0.8 ? 1 : 2;
      const f = base * pent[(Math.random() * 5) | 0] * oct;
      this.pluck(f, 0, calm > 0.5 ? 0.07 : 0.05);
      if (Math.random() < 0.35) this.pluck(f * 1.5, 0.35, 0.04);
      if (calm < 0.4 && Math.random() < 0.5) this.tone({ f: base / 4, type: 'sawtooth', dur: 5, vol: 0.025, attack: 1.5, bus: this.musicBus, rev: 0.8 });
      this.musicNext = calm > 0.5 ? 2.5 + Math.random() * 5 : 1.5 + Math.random() * 3;
    }
  }
}
