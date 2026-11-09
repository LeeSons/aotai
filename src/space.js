// ===================== 太空：飞出大气层、去月球、钻进太阳（无敌模式） =====================
// 用真实尺寸和距离：地球半径 6371 km、月球 1737 km、太阳 69.6 万 km；地月 38.44 万 km、日地 1.496 亿 km。
// 天体太远太大，直接画会超出深度范围和浮点精度。这里把每个天体沿视线“等比例缩小”到相机附近再画：
// 看上去的大小、方向完全不变；远的先画、近的后画（画家算法），所以不需要深度缓冲。
// 每个天体在着色器里逐像素和视线求交，是严格的球面，贴着地表飞也不会出现多边形棱角。
import * as THREE from 'three';
import { clamp, smoothstep } from './noise.js';

export const R_EARTH = 6371e3, R_MOON = 1737.4e3, R_SUN = 696340e3;
export const D_MOON = 384400e3, AU = 1.496e11, C_LIGHT = 299792458;
export const KARMAN = 100e3;        // 卡门线：大气层与太空的约定分界（海拔 100 km）
export const SPACE_ALT = 10e3;      // 海拔 10 km 以上切到“太空视图”（地面只剩一个球）
export const MOON_ALT = 3e3;        // 离月面 3 km 以下切到月面地形
export const MOON_G = 1.62 / 9.81;  // 月球重力是地球的 1/6
const QINLING_LAT = 34 * Math.PI / 180;

// 标准大气温度（℃）：对流层每升 1 km 降 6.5℃，平流层先恒温再回暖，中间层又降温
export function stdTemp(h) {
  const k = Math.max(0, h) / 1000;
  if (k < 11) return 15 - 6.5 * k;
  if (k < 20) return -56.5;
  if (k < 47) return -56.5 + (k - 20) * 2;
  if (k < 51) return -2.5;
  if (k < 85) return -2.5 - (k - 51) * 2.47;
  return -86.5;
}
export const sound = (tC) => 331.3 + 0.606 * tC;
export const atmoCap = (h) => 3.5 * sound(stdTemp(h));   // 大气层里最快 3.5 马赫
// 时间加速：贴近天体时 4.5×（和地面上的竖直比例一致），离开 1000 km 后 150×（= 游戏里的时间流速，1 秒 = 2.5 分钟）
export const timeScale = (alt) => 4.5 + 145.5 * smoothstep(KARMAN, 1000e3, alt);

export function fmtDist(m) {
  const km = m / 1000;
  if (m >= AU * 0.05) return (m / AU).toFixed(3) + ' 天文单位';
  if (km >= 1e8) return (km / 1e8).toFixed(2) + ' 亿 km';
  if (km >= 1e4) return (km / 1e4).toFixed(km >= 1e5 ? 1 : 2) + ' 万 km';
  if (km >= 1) return (km < 10 ? km.toFixed(2) : Math.round(km)) + ' km';
  return Math.max(0, Math.round(m)) + ' m';
}
export function fmtSpeed(v) {
  if (v >= C_LIGHT * 0.005) return `${Math.round(v / 1000).toLocaleString()} km/s（${(v / C_LIGHT).toFixed(3)} c）`;
  if (v >= 1000) return `${(v / 1000).toFixed(v < 1e4 ? 2 : 0)} km/s`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} m/s`;
}
export function fmtTime(sec) {
  if (sec < 1) return '不到 1 秒';
  if (sec < 90) return Math.round(sec) + ' 秒';
  if (sec < 5400) return Math.round(sec / 60) + ' 分钟';
  if (sec < 86400 * 2) return (sec / 3600).toFixed(1) + ' 小时';
  return (sec / 86400).toFixed(1) + ' 天';
}

// ---------------- 着色器 ----------------
const NOISE = `
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p, int oct){ float s = 0.0, a = 0.5; for (int i = 0; i < 12; i++) { if (i >= oct) break; s += a * vn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;
const BODY_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BODY_HEAD = `
uniform vec3 uC; uniform float uR; uniform vec3 uL; uniform float uTime; uniform vec3 uPole; uniform vec3 uUp;
varying vec3 vW;
`;
// 地球：程序生成的海陆、冰盖、云、夜面灯光、大气散射（不是真实地图）
const EARTH_FS = BODY_HEAD + NOISE + `
void main(){
  vec3 ro = cameraPosition, rd = normalize(vW - ro);
  vec3 oc = ro - uC; float b = dot(oc, rd); float c = dot(oc, oc) - uR * uR; float disc = b * b - c;
  float atm = uR * 0.016;                    // 大气层厚约 100 km
  float tc = max(-b, 0.0); vec3 pc = ro + rd * tc; float dmin = length(pc - uC);
  float sunSide = clamp(dot(normalize(pc - uC), uL) * 1.6 + 0.35, 0.0, 1.0);
  vec3 sky = vec3(0.32, 0.55, 1.0);
  if (disc < 0.0 || -b - sqrt(max(disc, 0.0)) < 0.0) {   // 没碰到球，或者交点在身后
    float h = (dmin - uR) / atm;
    float g = exp(-max(h, 0.0) * 2.4);
    gl_FragColor = vec4(sky * (0.25 + sunSide * 1.1), clamp(g * (0.15 + sunSide), 0.0, 1.0));
    return;
  }
  float t = -b - sqrt(disc);
  vec3 p = ro + rd * t; vec3 n = normalize(p - uC);
  float lat = asin(clamp(dot(n, uPole), -1.0, 1.0));
  float cont = fbm3(n * 2.3 + 11.0, 8) + (fbm3(n * 900.0, 4) - 0.5) * 0.04;
  float qin = smoothstep(0.975, 0.998, dot(n, uUp));          // 秦岭一带：保证是陆地，而且是林木茂密的山地
  cont += qin * 0.3;
  float land = smoothstep(0.515, 0.53, cont);
  float k = fbm3(n * 60.0, 5);
  vec3 ocean = mix(vec3(0.008, 0.04, 0.13), vec3(0.02, 0.11, 0.25), smoothstep(0.42, 0.515, cont));
  vec3 green = mix(vec3(0.06, 0.13, 0.04), vec3(0.17, 0.19, 0.08), k);
  float dry = smoothstep(0.45, 0.65, fbm3(n * 3.1 + 5.0, 5)) * (1.0 - smoothstep(0.7, 1.1, abs(lat)));
  dry *= 1.0 - qin;
  vec3 landC = mix(green, vec3(0.4, 0.33, 0.22), dry * 0.85);
  landC = mix(landC, vec3(0.2, 0.19, 0.16), smoothstep(0.62, 0.7, cont) * 0.5 * (1.0 - qin));   // 高山
  landC = mix(landC, vec3(0.035, 0.075, 0.03), qin * 0.8);
  // 近看的细节：山脊、沟谷、林地和裸岩（低空飞行时看得到）
  float det = fbm3(n * 2600.0, 5), det2 = fbm3(n * 24000.0, 3);
  landC *= 0.55 + 0.9 * det * (0.7 + 0.6 * det2);
  landC = mix(landC, vec3(0.3, 0.29, 0.27), smoothstep(0.62, 0.75, det) * 0.5);
  float ice = smoothstep(1.12, 1.22, abs(lat) + (k - 0.5) * 0.25);
  vec3 col = mix(ocean, landC, land);
  col = mix(col, vec3(0.85, 0.88, 0.93), ice);
  float cl = smoothstep(0.58, 0.78, fbm3(n * 5.0 + vec3(uTime * 0.0015, 0.0, uTime * 0.0006), 7));
  cl *= smoothstep(0.3, 0.62, fbm3(n * 70.0 + 4.0, 5)) * (0.55 + 0.45 * smoothstep(0.35, 0.6, fbm3(n * 600.0, 3)));   // 云团碎成一块块，能看到地面
  float ndl = dot(n, uL);
  float day = smoothstep(-0.1, 0.12, ndl);
  vec3 lit = col * max(ndl, 0.0) * 1.35;
  vec3 hv = normalize(uL - rd);
  lit += vec3(1.0, 0.92, 0.8) * pow(max(dot(n, hv), 0.0), 80.0) * (1.0 - land) * (1.0 - cl) * 0.7 * step(0.0, ndl);
  lit = mix(lit, vec3(1.0) * (max(ndl, 0.0) * 1.05 + 0.012), cl * 0.9);
  float city = step(0.982, h31(floor(n * 1400.0))) * land * (1.0 - ice) * (1.0 - day) * (1.0 - cl);
  lit += vec3(1.0, 0.7, 0.35) * city * 0.7;
  float mu = max(dot(n, -rd), 0.0);
  lit += sky * pow(1.0 - mu, 2.5) * sunSide * 0.7;
  // 视线穿过的大气越厚越蓝（低空看地面有一层蓝色薄雾）
  float camAlt = (length(oc) - uR) / atm;
  lit = mix(lit, sky * (0.2 + sunSide * 0.9), clamp(t / (uR * 0.08), 0.0, 1.0) * exp(-max(camAlt, 0.0) * 0.5) * 0.55);
  gl_FragColor = vec4(lit, 1.0);
}`;
// 月球：月海（暗）、高地（亮）、陨石坑（迎光的坑壁亮、背光的暗，晨昏线附近更明显）
const MOON_FS = BODY_HEAD + NOISE + `
void main(){
  vec3 ro = cameraPosition, rd = normalize(vW - ro);
  vec3 oc = ro - uC; float b = dot(oc, rd); float c = dot(oc, oc) - uR * uR; float disc = b * b - c;
  if (disc < 0.0 || -b - sqrt(max(disc, 0.0)) < 0.0) discard;
  float t = -b - sqrt(disc);
  vec3 p = ro + rd * t; vec3 n = normalize(p - uC);
  float ndl = dot(n, uL);
  vec3 Lt = normalize(uL - n * ndl + 1e-5);
  float maria = smoothstep(0.52, 0.6, fbm3(n * 1.7 + 3.0, 6));
  float alb = mix(0.30, 0.17, maria) * (0.85 + 0.3 * fbm3(n * 30.0, 4));
  float shade = 1.0;
  for (int s = 0; s < 4; s++) {
    float sc = 7.0 * pow(2.6, float(s));
    vec3 q = n * sc; vec3 i = floor(q), f = fract(q);
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 o = vec3(float(x), float(y), float(z));
      if (h31(i + o + 7.7) > 0.45) continue;
      vec3 cpos = o + vec3(h31(i + o), h31(i + o + 17.1), h31(i + o + 31.7));
      float r = 0.18 + 0.28 * h31(i + o + 5.3);
      vec3 v = f - cpos; float d = length(v) / r;
      if (d < 1.35) {
        vec3 dir = normalize(v - n * dot(v, n) + 1e-5);
        float wall = d < 1.0 ? smoothstep(0.35, 1.0, d) : -smoothstep(1.35, 1.0, d) * 0.6;
        shade *= 1.0 - 0.75 * dot(dir, Lt) * wall * (0.35 + 0.65 * (1.0 - max(ndl, 0.0)));
        if (d < 1.0) alb *= 0.93; else alb *= 1.06;
      }
    }
  }
  vec3 col = vec3(1.0, 0.97, 0.92) * alb * max(ndl, 0.0) * 3.2 * max(shade, 0.0);
  col += vec3(0.25, 0.32, 0.45) * alb * 0.025;        // 地照：地球反射的微光照在月球夜面
  gl_FragColor = vec4(col, 1.0);
}`;
// 太阳：米粒组织、临边昏暗、偶尔的黑子；视线没碰到日面时画日冕光晕
const SUN_FS = BODY_HEAD + NOISE + `
void main(){
  vec3 ro = cameraPosition, rd = normalize(vW - ro);
  vec3 oc = ro - uC; float b = dot(oc, rd); float c = dot(oc, oc) - uR * uR; float disc = b * b - c;
  float tc = max(-b, 0.0); float dmin = length(ro + rd * tc - uC);
  if (disc < 0.0 || -b - sqrt(max(disc, 0.0)) < 0.0) {
    float g = pow(uR / dmin, 2.6) * 0.9 + pow(uR / dmin, 12.0) * 2.0;
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * g * 2.0, clamp(g, 0.0, 1.0));
    return;
  }
  float t = -b - sqrt(disc);
  vec3 n = normalize(ro + rd * t - uC);
  float mu = max(dot(n, -rd), 0.0);
  float limb = 0.35 + 0.65 * sqrt(mu);
  float gran = fbm3(n * 220.0 + vec3(uTime * 0.03), 4);
  float spot = smoothstep(0.76, 0.8, fbm3(n * 6.0 + 2.0, 5));
  vec3 col = vec3(1.0, 0.84, 0.58) * (4.0 + gran * 2.2) * limb * (1.0 - spot * 0.75);
  gl_FragColor = vec4(col, 1.0);
}`;
// 太阳内部：越往里越热、越亮、越白；核心里不停闪烁的亮点代表一次次聚变
const INSIDE_FS = NOISE + `
uniform float uR; uniform float uTime; uniform float uA; uniform vec2 uAsp;
varying vec2 vUv;
void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uAsp;
  float n = fbm3(vec3(p * 2.2, uTime * 0.25), 5);
  float cells = fbm3(vec3(p * 7.0 + n * 2.0, uTime * 0.5), 3);
  vec3 photo = vec3(1.0, 0.45, 0.1), conv = vec3(1.0, 0.55, 0.16), rad = vec3(1.0, 0.78, 0.45), core = vec3(1.0, 0.93, 0.8);
  vec3 base = uR > 0.7 ? mix(conv, photo, smoothstep(0.7, 1.0, uR)) : uR > 0.25 ? mix(rad, conv, smoothstep(0.25, 0.7, uR)) : mix(core, rad, smoothstep(0.0, 0.25, uR));
  float bright = mix(2.2, 0.9, smoothstep(0.0, 1.0, uR));
  float tex = uR > 0.7 ? (0.45 + cells * 1.0) : (0.55 + n * 0.8);
  vec3 col = base * bright * tex;
  if (uR < 0.25) {
    vec2 g = floor(vUv * vec2(90.0, 50.0));
    float k = h31(vec3(g, floor(uTime * 12.0)));
    float sp = step(0.985, k) * smoothstep(0.5, 0.0, length(fract(vUv * vec2(90.0, 50.0)) - 0.5));
    col += vec3(1.0, 1.0, 0.92) * sp * 6.0 * smoothstep(0.25, 0.1, uR);
  }
  gl_FragColor = vec4(col, uA);
}`;
const STAR_VS = `attribute float aSize; attribute vec3 aCol; uniform float uAlpha; varying vec3 vCol;
void main(){ vCol = aCol * uAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize; }`;
const STAR_FS = `varying vec3 vCol; void main(){ float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(vCol, a); }`;

// ---------------- 太空场景 ----------------
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q0 = new THREE.Quaternion();

export class Space {
  constructor() {
    this.bg = new THREE.Scene();     // 星空 + 天体
    this.fg = new THREE.Scene();     // 只有玩家
    this.S = new THREE.Vector3();    // 玩家位置：以地心为原点，单位米（JS 双精度）
    this.V = new THREE.Vector3();    // 速度 m/s
    this.time = 0;
    // 星空：5000 颗随机恒星 + 3000 颗沿银河带分布的暗星
    const N = 8000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
    const gal = new THREE.Vector3(0.3, 0.6, 0.75).normalize();
    let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      let d;
      if (i < 5000) d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      else { const a = rnd() * Math.PI * 2; const u = new THREE.Vector3(1, 0, 0).cross(gal).normalize(), w = gal.clone().cross(u); d = u.multiplyScalar(Math.cos(a)).add(w.multiplyScalar(Math.sin(a))).addScaledVector(gal, (rnd() + rnd() + rnd() - 1.5) * 0.12); }
      d.normalize().multiplyScalar(90000);
      pos.set([d.x, d.y, d.z], i * 3);
      const m = Math.pow(rnd(), 6);                       // 亮星少、暗星多
      const temp = rnd();                                 // 恒星颜色：红 → 白 → 蓝
      const c = temp < 0.3 ? [1, 0.75, 0.55] : temp < 0.8 ? [1, 0.96, 0.9] : [0.75, 0.85, 1];
      const k = i < 5000 ? 0.25 + m * 2.5 : 0.18 + m * 0.4;
      col.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
      size[i] = i < 5000 ? 1.2 + m * 3.2 : 1.0 + m;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.starU = { uAlpha: { value: 1 } };
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: this.starU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.stars.renderOrder = -1e9; this.stars.frustumCulled = false;
    this.bg.add(this.stars);
    // 天体
    const mk = (key, name, R, fs, bound, segs) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Vector3() }, uR: { value: 1 }, uL: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uPole: { value: new THREE.Vector3(0, 1, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) } },
        vertexShader: BODY_VS, fragmentShader: fs, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segs, segs >> 1), mat);
      mesh.frustumCulled = false;
      this.bg.add(mesh);
      return { key, name, R, mat, mesh, bound, pos: new THREE.Vector3() };
    };
    this.earth = mk('earth', '地球', R_EARTH, EARTH_FS, 1.09, 64);
    this.moon = mk('moon', '月球', R_MOON, MOON_FS, 1.02, 48);
    this.sun = mk('sun', '太阳', R_SUN, SUN_FS, 6.0, 48);
    this.bodies = [this.earth, this.moon, this.sun];
    // 前景：玩家 + 太阳光
    this.light = new THREE.DirectionalLight(0xffffff, 3.2);
    this.amb = new THREE.AmbientLight(0x8090b0, 0.08);
    this.fg.add(this.light, this.light.target, this.amb);
    // 太阳内部的全屏效果
    this.inU = { uR: { value: 1 }, uTime: { value: 0 }, uA: { value: 0 }, uAsp: { value: new THREE.Vector2(1, 1) } };
    this.overlay = new THREE.Scene();
    this.overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.overlay.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: INSIDE_FS, uniforms: this.inU, transparent: true, depthTest: false, depthWrite: false,
    })));
    // 地球自转轴：玩家起飞处（北纬 34°）的“正上方”是 +Y，北方是 −Z
    this.earth.mat.uniforms.uPole.value.set(0, Math.sin(QINLING_LAT), -Math.cos(QINLING_LAT));
  }

  // 从地球起飞进入太空：太阳、月亮放在起飞那一刻天上它们所在的方向
  begin(altM, sunDir, moonDir, vel) {
    this.S.set(0, R_EARTH + altM, 0);
    this.V.copy(vel);
    this.sun.pos.copy(sunDir).normalize().multiplyScalar(AU);
    this.moon.pos.copy(moonDir).normalize().multiplyScalar(D_MOON);
    this.earth.pos.set(0, 0, 0);
    this.flags = {};
  }
  altOf(b) { return this.S.distanceTo(b.pos) - b.R; }
  nearest() { let best = null, ba = Infinity; for (const b of this.bodies) { const a = this.altOf(b); if (a < ba) { ba = a; best = b; } } return { body: best, alt: ba }; }
  upAt(b, out = new THREE.Vector3()) { return out.copy(this.S).sub(b.pos).normalize(); }
  // 太阳光是否被地球 / 月球挡住（在它们的影子里）
  inShadow() {
    const L = _v.copy(this.sun.pos).sub(this.S).normalize();
    for (const b of [this.earth, this.moon]) {
      const oc = _w.copy(this.S).sub(b.pos); const bb = oc.dot(L), cc = oc.lengthSq() - b.R * b.R;
      if (bb < 0 && bb * bb - cc > 0) return b;
    }
    return null;
  }

  // q：把太空坐标转到当前渲染坐标（月面上是月面的局部坐标），null = 不转
  render(R, cam, q, aspect) {
    const camP = cam.position;
    q = q || _q0.identity();
    for (const b of this.bodies) {
      const rel = _v.copy(b.pos).sub(this.S);
      const dist = rel.length();
      const dd = 2000 * Math.log10(1 + dist / 1000);
      const k = dd / dist;
      rel.multiplyScalar(k).applyQuaternion(q);
      b.mesh.position.copy(camP).add(rel);
      b.mesh.scale.setScalar(b.R * k * b.bound);
      const U = b.mat.uniforms;
      U.uC.value.copy(b.mesh.position); U.uR.value = b.R * k; U.uTime.value = this.time;
      if (b !== this.sun) U.uL.value.copy(this.sun.pos).sub(b.pos).normalize().applyQuaternion(q);
      b.mesh.renderOrder = -dd;
      b.mesh.visible = !(b === this.sun && dist < R_SUN) && b !== this.hide;   // 站在月面上时不画月球本身
    }
    this.earth.mat.uniforms.uPole.value.set(0, Math.sin(QINLING_LAT), -Math.cos(QINLING_LAT)).applyQuaternion(q);
    this.earth.mat.uniforms.uUp.value.set(0, 1, 0).applyQuaternion(q);
    this.stars.position.copy(camP); this.stars.quaternion.copy(q);
    // 在大气层里，白天的天空把星星盖住
    const ae = this.altOf(this.earth), up = this.upAt(this.earth, _w);
    const sunUp = _v.copy(this.sun.pos).sub(this.S).normalize().dot(up);
    this.starU.uAlpha.value = 1 - (1 - smoothstep(20e3, KARMAN, ae)) * smoothstep(-0.15, 0.1, sunUp) * 0.97;
    R.render(this.bg, cam);
    // 太阳内部
    const ds = this.S.distanceTo(this.sun.pos);
    this.inU.uR.value = ds / R_SUN; this.inU.uTime.value = this.time;
    this.inU.uA.value = smoothstep(1.0, 0.985, ds / R_SUN);
    this.inU.uAsp.value.set(aspect || 1, 1);
  }
  renderFG(R, cam, q) {
    q = q || _q0.identity();
    const L = _v.copy(this.sun.pos).sub(this.S).normalize().applyQuaternion(q);
    this.light.position.copy(cam.position).addScaledVector(L, 50); this.light.target.position.copy(cam.position);
    const sh = this.inShadow();
    const inSun = this.inU.uA.value;   // 在太阳里：四面八方都是光
    this.light.intensity = sh ? 0 : 3.2;
    this.amb.color.setRGB(1, 0.75, 0.45).lerp(new THREE.Color(0.5, 0.56, 0.7), 1 - inSun);
    this.amb.intensity = (sh === this.earth ? 0.12 : 0.06) + inSun * 1.6;
    R.render(this.fg, cam);
  }
  renderInside(R) { if (this.inU.uA.value > 0.001) R.render(this.overlay, this.overlayCam); }
}
