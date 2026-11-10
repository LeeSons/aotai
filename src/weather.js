// ===================== 天气系统：一日四季，诡异莫测 =====================
import * as THREE from 'three';
import { SEC_PER_GAME_HOUR, SEASONS } from './data.js';
import { clamp, lerp, smoothstep } from './noise.js';

export const WX = {
  clear:    { name: '晴',     icon: '☀', wind: [4, 6],   fog: 0.0007, rain: 0,    snow: 0,   hail: 0, cloud: 0.12, temp: 1,   light: 1.0,  dur: [2.5, 6] },
  cloudy:   { name: '多云',   icon: '☁', wind: [5, 7],   fog: 0.0016, rain: 0,    snow: 0,   hail: 0, cloud: 0.62, temp: -2,  light: 0.72, dur: [1.5, 4] },
  fog:      { name: '浓雾',   icon: '🌫', wind: [3, 6],   fog: 0.062,  rain: 0,    snow: 0,   hail: 0, cloud: 0.9,  temp: -4,  light: 0.55, dur: [1.5, 4], damp: 0.06 },
  rain:     { name: '冷雨',   icon: '🌧', wind: [5, 8],   fog: 0.008,  rain: 0.6,  snow: 0,   hail: 0, cloud: 0.92, temp: -6,  light: 0.45, dur: [1, 2.5] },
  storm:    { name: '雷暴雨', icon: '⛈', wind: [7, 10],  fog: 0.014,  rain: 1.0,  snow: 0,   hail: 0, cloud: 1,    temp: -8,  light: 0.25, dur: [0.8, 2], thunder: true },
  hail:     { name: '冰雹',   icon: '🧊', wind: [6, 9],   fog: 0.011,  rain: 0.2,  snow: 0,   hail: 1, cloud: 1,    temp: -10, light: 0.3,  dur: [0.3, 0.8] },
  sleet:    { name: '雨夹雪', icon: '🌨', wind: [6, 8],   fog: 0.012,  rain: 0.5,  snow: 0.5, hail: 0, cloud: 1,    temp: -10, light: 0.35, dur: [0.8, 2] },
  snow:     { name: '暴雪',   icon: '❄', wind: [7, 10],  fog: 0.026,  rain: 0,    snow: 1,   hail: 0, cloud: 1,    temp: -14, light: 0.36, dur: [1.5, 3.5] },
  gale:     { name: '狂风',   icon: '🌬', wind: [9, 11],  fog: 0.0018, rain: 0,    snow: 0,   hail: 0, cloud: 0.4,  temp: -5,  light: 0.85, dur: [1, 2.5] },
  whiteout: { name: '白毛风', icon: '🌪', wind: [10, 12], fog: 0.07,  rain: 0,    snow: 0.9, hail: 0, cloud: 1,    temp: -17, light: 0.42, dur: [0.6, 1.6], damp: 0.03 },
};
const SEVERE = ['storm', 'hail', 'snow', 'gale', 'whiteout', 'sleet'];

// 云顶海拔（米）。鳌太的风雨雪雾都在云里：贴着主脊的层云、层积云，顶部只比主脊（3500–3767 米）高几百米到一两千米；
// 下雨下雪的雨层云，云顶一般 5–6 千米；只有夏天的雷暴云（积雨云）能冲到 1 万米上下。
// 每场天气在范围内随机取一个；冬天对流弱、云层低，夏天高。飞到云顶以上就没有雨雪和雾了，云海在脚下。
const CLOUD_TOP = {
  clear: [3700, 4400], cloudy: [4300, 5500], fog: [3750, 4400], rain: [4800, 6300], storm: [8500, 12000],
  hail: [8000, 11000], sleet: [4500, 5800], snow: [4400, 6000], gale: [3800, 4600], whiteout: [3900, 4800],
};
const TOP_SEASON = { winter: -500, spring: -150, summer: 400, autumn: 0 };

const OMEN = {
  clear: '云层散开，阳光照了下来。',
  cloudy: '天空渐渐阴了下来，风里带着一股寒意。',
  fog: '山谷里的雾气正迅速向山脊涌来……能见度在急剧下降！',
  rain: '西边天际压过来一片铅灰色的云，空气里有了雨的味道。',
  storm: '远处传来闷雷，云底黑得发紫——雷暴要来了！远离山顶和高点！',
  hail: '温度骤降，冰冷的风里夹着一粒粒冰渣……冰雹来了！',
  sleet: '雨点里开始夹杂着湿冷的雪粒，打在脸上像针扎。',
  snow: '气温断崖式下跌，天地间开始飘起雪花——暴风雪正在逼近！',
  gale: '风声陡然变成了尖啸，阵风大得几乎站不住！',
  whiteout: '狂风卷起地上的积雪，天地瞬间白成一片——白毛风！',
};
const SUDDEN = {
  clear: '云雾像被一只手扯开，阳光毫无预兆地洒了下来。',
  fog: '一转身，白雾就把你吞没了——几秒钟前还能看见远处的山峰！',
  rain: '天色说变就变，冰冷的雨点砸了下来！',
  storm: '没有任何预兆，一道闪电劈开了天空——雷暴来了！',
  hail: '晴空里突然砸下来冰雹！',
  sleet: '一阵冷风过后，雨夹雪劈头盖脸地落下。',
  snow: '气温在几分钟内骤降，暴雪劈头盖脸地落了下来！',
  gale: '一股狂风毫无征兆地从山谷里冲上来！',
  whiteout: '风雪骤起，四周瞬间白茫茫一片，连自己的脚都看不清！',
  cloudy: '不知从哪里涌来的云把太阳遮住了。',
};

// 人在山下林中时看到的“远处的天气”：危险在主脊上，不在脚下
const OMEN_LOW = {
  fog: '云雾顺着山坡压了下来，林子里起了薄雾。主脊上此刻应该已经什么都看不见了。',
  storm: '远处山顶滚过闷雷，云底黑得发紫——主脊上在下雷暴。林子里只是一阵急雨，但上了林线就不是这样了。',
  hail: '山上的云底翻滚发黑，远处坡上传来冰雹砸落的沙沙声。林下只落下几颗冰渣。',
  sleet: '下起了冷雨。抬头看，林线以上的山坡已经一片灰白——那里在下雨夹雪。',
  snow: '气温降了下来，冷雨淅淅沥沥。主脊方向白茫茫一片——山上正在下雪。',
  gale: '头顶的树冠被吹得哗哗作响。林子里还好，山脊上的风一定大得吓人。',
  whiteout: '山顶被一团翻滚的白云吞没了。林子里只是风紧雪小，主脊上正刮着白毛风。',
};

function pickWeighted(w, r) {
  let s = 0; for (const k in w) s += w[k];
  let v = r * s;
  for (const k in w) { v -= w[k]; if (v <= 0) return k; }
  return Object.keys(w)[0];
}

export class Weather {
  constructor(scene, rng, diff, seasonKey = 'autumn') {
    this.rng = rng;
    this.diff = diff;
    this.seasonKey = seasonKey;
    this.S = SEASONS[seasonKey];
    this.cur = 'clear';
    this.next = null;
    this.blend = 1;
    this.blendRate = 1 / 22;
    this.timeLeft = 2 * SEC_PER_GAME_HOUR;
    this.p = { ...WX.clear, windLevel: 4, key: 'clear', rainEff: 0, snowEff: 0, hailEff: 0, damp: 0 };
    this.windDir = new THREE.Vector2(1, 0.3).normalize();
    this.windAngle = 0.3;
    this.snowCover = this.S.snow0;
    this.wetGround = 0;
    this.flash = 0;
    this.lightningTimer = 4;
    this.events = [];
    this.fakeClear = false;
    this.forceSevere = false;
    this.rainbow = 0;
    this.glory = 0;
    this.elapsed = 0;
    this.topCur = this.sampleTop('clear'); this.topNext = null;
    this.buildPrecip(scene);
    this.buildBolt(scene);
  }

  serialize() { return { cur: this.cur, next: this.next, blend: this.blend, blendRate: this.blendRate, timeLeft: this.timeLeft, snowCover: this.snowCover, windAngle: this.windAngle, fakeClear: this.fakeClear, forceSevere: this.forceSevere, elapsed: this.elapsed, topCur: this.topCur, topNext: this.topNext }; }
  // 云顶至少比拔仙台（3767 米）高一截：主脊上走路时天气照旧，只有飞上去才会钻出云顶
  sampleTop(k) { const r = CLOUD_TOP[k] || CLOUD_TOP.cloudy; return Math.max(3900, Math.round(lerp(r[0], r[1], this.rng()) + (TOP_SEASON[this.seasonKey] || 0))); }
  restore(s) { Object.assign(this, s); this.recompute(); }

  choose(hour, alt) {
    const sev = this.diff.weather;
    const high = smoothstep(2900, 3500, alt);
    const low = lerp(0.5, 1, smoothstep(2300, 3200, alt)); // 对冲气流在主脊上最猛；人在山下时，剧烈天气少一些
    const aft = hour >= 12 && hour <= 18 ? 1 : 0;
    const night = hour < 6 || hour > 20 ? 1 : 0;
    const W = this.S.wx;
    const w = {
      clear: 2.6, cloudy: 2.6,
      fog: (1.3 + high * 2.0) * sev,
      rain: (1.2 + aft * 1.0) * sev,
      storm: (0.3 + aft * 1.4 + high * 0.4) * sev,
      hail: (0.15 + high * 0.4 + aft * 0.25) * sev,
      sleet: (0.1 + high * 0.4) * sev * (this.seasonKey === 'summer' ? 0.2 : 1),
      snow: (0.05 + high * 0.6 + night * 0.4) * sev * sev,
      gale: (0.35 + high * 1.0) * sev,
      whiteout: (high * 0.25 + night * 0.1) * sev * (this.seasonKey === 'winter' ? 3 : this.seasonKey === 'spring' ? 1 : 0.08),
    };
    for (const k of ['hail', 'sleet', 'snow', 'gale', 'whiteout']) w[k] *= low;
    for (const k in w) w[k] *= (W[k] !== undefined ? W[k] : (k === 'sleet' ? (W.snow + W.rain) / 2 : k === 'whiteout' ? W.snow : 1));
    w[this.cur] *= 0.2;
    if (this.cur === 'storm') { w.hail *= 2.5; w.rain *= 1.5; }
    if (this.cur === 'snow') { w.whiteout *= 2; w.fog *= 1.5; w.gale *= 1.5; }
    if (this.elapsed < 1.5 * SEC_PER_GAME_HOUR) for (const k of SEVERE) w[k] *= 0.05;
    return pickWeighted(w, this.rng());
  }

  forceWeather(k, sudden = false) { this.next = k; this.topNext = this.sampleTop(k); this.blend = 0; this.blendRate = sudden ? 1 / 6 : 1 / 22; this.timeLeft = lerp(WX[k].dur[0], WX[k].dur[1], this.rng()) * SEC_PER_GAME_HOUR; }

  recompute() {
    const a = WX[this.cur], b = this.next ? WX[this.next] : a;
    const B = this.next ? smoothstep(0, 1, this.blend) : 1;
    const p = this.p;
    for (const k of ['fog', 'rain', 'snow', 'hail', 'cloud', 'temp', 'light']) p[k] = this.next ? lerp(a[k], b[k], B) : a[k];
    p.damp = this.next ? lerp(a.damp || 0, b.damp || 0, B) : (a.damp || 0);
    const wl = this.next ? lerp((a.wind[0] + a.wind[1]) / 2, (b.wind[0] + b.wind[1]) / 2, B) : (a.wind[0] + a.wind[1]) / 2;
    p.windLevel = wl + (this.seasonKey === 'winter' ? 1.5 : this.seasonKey === 'spring' ? 0.5 : 0);
    p.thunder = (this.next ? (B > 0.5 ? b : a) : a).thunder || false;
    p.key = this.next && B > 0.5 ? this.next : this.cur;
    p.name = WX[p.key].name; p.icon = WX[p.key].icon;
    p.severe = SEVERE.includes(p.key);
    // 云顶：换天气时慢慢升降（对流发展、云层消散）。旧存档没有这项就现取一个
    if (this.topCur == null) this.topCur = this.sampleTop(this.cur);
    if (this.next && this.topNext == null) this.topNext = this.sampleTop(this.next);
    p.top = this.next ? lerp(this.topCur, this.topNext, B) : this.topCur;
  }

  // localK：天气在玩家所在处的强度（0.2 山下林中 ~ 1 主脊）
  update(dt, hour, alt, airTemp, onMessage, localK = 1) {
    this.events.length = 0;
    this.elapsed += dt;
    this.timeLeft -= dt;
    if (!this.next && this.timeLeft <= 0) {
      let n;
      const wasSevere = SEVERE.includes(this.cur);
      if (this.forceSevere) { n = ['storm', 'snow', 'hail', 'gale', 'fog'][Math.floor(this.rng() * 5)]; if (this.seasonKey === 'winter' && n === 'storm') n = 'whiteout'; if (this.seasonKey === 'summer' && n === 'snow') n = 'storm'; this.forceSevere = false; }
      else if (wasSevere && this.rng() < 0.35 * this.diff.weather) { n = 'clear'; this.fakeClear = true; }
      else n = this.choose(hour, alt);
      if (n !== this.cur) {
        const sudden = this.rng() < 0.32 * this.diff.weather || (this.fakeClear === false && this.cur === 'clear' && n === 'fog' && this.rng() < 0.5);
        this.next = n; this.topNext = this.sampleTop(n); this.blend = 0;
        this.blendRate = sudden ? 1 / (4 + this.rng() * 3) : 1 / (16 + this.rng() * 10);
        if (onMessage) {
          if (localK < 0.6 && OMEN_LOW[n]) onMessage(OMEN_LOW[n], 'warn');
          else if (this.wasFake && SEVERE.includes(n)) onMessage('刚才的晴朗只是风暴的间隙！' + (OMEN[n] || ''), 'crit');
          else if (sudden) onMessage('天气突变！' + SUDDEN[n], SEVERE.includes(n) || n === 'fog' ? 'crit' : 'info');
          else if (this.rng() < 0.85) onMessage(OMEN[n], SEVERE.includes(n) || n === 'fog' ? 'danger' : 'info');
        }
        this.wasFake = false;
        if (this.cur === 'rain' || this.cur === 'storm' || this.cur === 'sleet') { if ((n === 'clear' || n === 'cloudy') && hour > 7 && hour < 18) this.rainbowPending = true; }
      }
      let dur = lerp(WX[n].dur[0], WX[n].dur[1], this.rng()) * SEC_PER_GAME_HOUR;
      if (this.fakeClear && n === 'clear') { dur = (0.35 + this.rng() * 0.5) * SEC_PER_GAME_HOUR; this.fakeClear = false; this.forceSevere = true; this.wasFake = true; }
      this.timeLeft = dur;
    }
    if (this.next) {
      this.blend += dt * this.blendRate;
      if (this.blend >= 1) {
        this.cur = this.next; this.next = null; this.blend = 1; this.topCur = this.topNext; this.topNext = null;
        if (this.rainbowPending) { this.rainbowPending = false; this.rainbow = 1; this.events.push({ type: 'rainbow' }); }
      }
    }
    this.recompute();
    this.rainbow = Math.max(0, this.rainbow - dt / 90);
    this.glory = Math.max(0, this.glory - dt / 30);
    // 风向漂移，偶尔突变
    this.windAngle += ((this.rng() - 0.5) * 0.02) * dt;
    if (this.rng() < dt * 0.01) { this.windAngle += (this.rng() - 0.5) * 2.5; this.events.push({ type: 'windshift' }); }
    this.windDir.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    // 降水形态随气温变化
    const p = this.p;
    p.rainEff = p.rain; p.snowEff = p.snow; p.hailEff = p.hail;
    if (airTemp < -0.5 && p.rain > 0) { p.snowEff = Math.max(p.snowEff, p.rain * 0.85); p.rainEff = 0; }
    if (airTemp > 2.5 && p.snow > 0) { p.rainEff = Math.max(p.rainEff, p.snow * 0.8); p.snowEff = p.snow * clamp((5 - airTemp) / 2.5, 0, 1) * 0.5; }
    // 积雪
    if (p.snowEff > 0.1 && airTemp < 1.5) this.snowCover = Math.min(1, this.snowCover + p.snowEff * dt * 0.014);
    else {
      const floor = this.seasonKey === 'winter' ? 0.85 : this.seasonKey === 'spring' ? 0.35 : 0;
      if (this.snowCover > floor) this.snowCover = Math.max(floor, this.snowCover - dt * (airTemp > 3 ? 0.004 : 0.0012));
    }
    if (p.rainEff > 0.05) this.wetGround = Math.min(1, this.wetGround + p.rainEff * dt * 0.05);
    else this.wetGround = Math.max(0, this.wetGround - dt * 0.005);
    // 闪电
    this.flash = Math.max(0, this.flash - dt * 6);
    this.boltLife -= dt;
    this.bolt.visible = this.boltLife > 0;
    if (p.thunder) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 2.5 + this.rng() * 7;
        const dist = 90 + this.rng() * 650;
        this.events.push({ type: 'lightning', dist });
        this.flash = 1.2;
      }
    }
  }

  // ---------- 降水粒子 ----------
  buildPrecip(scene) {
    const N = 9000;
    const off = new Float32Array(N * 2 * 3), tail = new Float32Array(N * 2), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 60, y = Math.random() * 40, z = Math.random() * 60, s = Math.random();
      for (let k = 0; k < 2; k++) { off.set([x, y, z], (i * 2 + k) * 3); tail[i * 2 + k] = k; seed[i * 2 + k] = s; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(off, 3));
    g.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -24, 0) }, uAmount: { value: 0 }, uColor: { value: new THREE.Color(0.7, 0.75, 0.8) }, uLen: { value: 0.9 } };
    const rainMat = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `attribute float aTail; attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform vec3 uVel; uniform float uAmount; uniform float uLen; varying float vA;
        void main(){ vec3 box = vec3(60.0, 40.0, 60.0);
          vec3 p = position + uVel * uTime * (0.85 + aSeed * 0.3);
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          p -= normalize(uVel) * uLen * aTail;
          vA = step(aSeed, uAmount) * (1.0 - aTail * 0.8);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(uColor, vA * 0.38); }`,
    });
    this.rain = new THREE.LineSegments(g, rainMat); this.rain.frustumCulled = false; scene.add(this.rain);

    const M = 7000;
    const p2 = new Float32Array(M * 3), s2 = new Float32Array(M);
    for (let i = 0; i < M; i++) { p2.set([Math.random() * 50, Math.random() * 30, Math.random() * 50], i * 3); s2[i] = Math.random(); }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(p2, 3));
    g2.setAttribute('aSeed', new THREE.BufferAttribute(s2, 1));
    this.snowU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -3, 0) }, uAmount: { value: 0 }, uSize: { value: 0.12 }, uColor: { value: new THREE.Color(1, 1, 1) }, uSway: { value: 1 } };
    const snowMat = new THREE.ShaderMaterial({
      uniforms: this.snowU, transparent: true, depthWrite: false,
      vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform vec3 uVel; uniform float uAmount; uniform float uSize; uniform float uSway; varying float vA;
        void main(){ vec3 box = vec3(50.0, 30.0, 50.0);
          vec3 p = position + uVel * uTime * (0.7 + aSeed * 0.6);
          p.x += sin(uTime * 1.3 + aSeed * 40.0) * 0.8 * uSway; p.z += cos(uTime * 1.1 + aSeed * 30.0) * 0.8 * uSway;
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          vA = step(aSeed, uAmount);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.6 + aSeed) * 600.0 / -mv.z;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ if (vA < 0.01) discard; float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.15, d); gl_FragColor = vec4(uColor, a * 0.85); }`,
    });
    this.snowPts = new THREE.Points(g2, snowMat); this.snowPts.frustumCulled = false; scene.add(this.snowPts);
    this.hailU = { ...THREE.UniformsUtils.clone(this.snowU) };
    this.hailU.uVel.value.set(0, -22, 0); this.hailU.uSize.value = 0.07; this.hailU.uSway.value = 0.05; this.hailU.uColor.value.set(0.9, 0.95, 1);
    const hailMat = snowMat.clone(); hailMat.uniforms = this.hailU;
    this.hailPts = new THREE.Points(g2, hailMat); this.hailPts.frustumCulled = false; scene.add(this.hailPts);
  }

  buildBolt(scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
    this.bolt = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xe8f0ff, fog: false, transparent: true, opacity: 0.95 }));
    this.bolt.visible = false; this.bolt.frustumCulled = false;
    this.boltLife = 0;
    scene.add(this.bolt);
  }

  spawnBolt(from, groundY) {
    const pos = this.bolt.geometry.attributes.position;
    let x = from.x, y = groundY + 380, z = from.z;
    const n = 40;
    for (let i = 0; i < n; i++) { pos.setXYZ(i, x, y, z); x += (Math.random() - 0.5) * 22; z += (Math.random() - 0.5) * 22; y -= 380 / (n - 1); }
    pos.needsUpdate = true;
    this.boltLife = 0.18;
  }

  dispose(scene) { for (const o of [this.rain, this.snowPts, this.hailPts, this.bolt]) scene.remove(o); }

  updateVisuals(t, cam, wind, inShelter, loc) {
    const p = loc ? { ...this.p, rainEff: loc.rain, snowEff: loc.snow, hailEff: loc.hail } : this.p;
    const wx = wind.x * 1.4, wz = wind.y * 1.4;
    this.rainU.uTime.value = t; this.rainU.uCam.value.copy(cam);
    this.rainU.uVel.value.set(wx, -26, wz);
    this.rainU.uAmount.value = clamp(p.rainEff, 0, 1) * (inShelter ? 0.4 : 1);
    this.rain.visible = this.rainU.uAmount.value > 0.01;
    this.snowU.uTime.value = t; this.snowU.uCam.value.copy(cam);
    this.snowU.uVel.value.set(wx * (p.key === 'whiteout' ? 4 : 1.6), -3.2, wz * (p.key === 'whiteout' ? 4 : 1.6));
    this.snowU.uAmount.value = clamp(p.snowEff, 0, 1);
    this.snowPts.visible = this.snowU.uAmount.value > 0.01;
    this.hailU.uTime.value = t; this.hailU.uCam.value.copy(cam);
    this.hailU.uVel.value.set(wx * 0.5, -24, wz * 0.5);
    this.hailU.uAmount.value = clamp(p.hailEff, 0, 1) * 0.5;
    this.hailPts.visible = this.hailU.uAmount.value > 0.01;
  }
}
