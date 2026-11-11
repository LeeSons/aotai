// ===================== 粒子特效 =====================
// 营火（火舌 / 火星 / 烟）、炊烟和香火、落叶、风吹雪、阳光里的浮尘、萤火虫、呵出的白气、脚下扬起的尘和雪。
// 大部分粒子是“无状态”的：位置完全由时间和随机种子在显卡上算出来，CPU 每帧只改几个参数。
import * as THREE from 'three';
import { tex } from './materials.js';

// 预乘透明度混合：一张图里既能画发光的（火、火星）也能画挡光的（烟）
const PREMULT = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, toneMapped: false, fog: false };

// ---------------------------------------------------------------- 火与烟
const FIRE_VS = `
attribute vec3 aBase; attribute vec4 aSeed; attribute vec2 aKind;      // aKind.x 0 火舌 1 火星 2 烟；aKind.y 大小倍率
uniform vec3 uPos; uniform vec3 uWind; uniform float uTime, uPower, uPx;
varying float vLife; varying float vKind; varying vec4 vSeed; varying float vFade;
void main(){
  float k = aKind.x, sc = aKind.y;
  float rate = k < 0.5 ? 1.1 + aSeed.x * 0.9 : (k < 1.5 ? 0.3 + aSeed.x * 0.4 : 0.11 + aSeed.x * 0.07);
  float life = fract(uTime * rate + aSeed.y);
  vec3 p = uPos + aBase;
  float ang = aSeed.z * 6.2832, rad = aSeed.w;
  float size;
  if (k < 0.5) {
    // 火舌：从柴堆一圈往中间收，边升边晃
    p.xz += vec2(cos(ang), sin(ang)) * rad * 0.2 * (1.0 - life * 0.75) * sc;
    p.y += (0.1 + life * (0.5 + aSeed.x * 0.55) * (0.55 + 0.45 * uPower)) * sc;
    p.xz += uWind.xz * life * life * 0.22 + vec2(sin(uTime * 7.0 + ang * 3.0), cos(uTime * 6.0 + ang * 2.0)) * 0.03 * life;
    size = mix(0.5, 0.1, life) * (0.7 + 0.5 * aSeed.x) * (0.55 + 0.45 * uPower) * sc;
  } else if (k < 1.5) {
    // 火星：被热气卷上去，打着旋飘走
    p.xz += vec2(cos(ang), sin(ang)) * (0.08 + rad * 0.5 * life) + uWind.xz * life * 1.5 + vec2(sin(uTime * 3.0 + ang * 5.0), cos(uTime * 2.3 + ang * 4.0)) * 0.14 * life;
    p.y += 0.3 + life * (1.5 + aSeed.x * 1.8);
    size = 0.045 * (1.0 - life * 0.5) * step(aSeed.w, 0.25 + 0.75 * uPower);
  } else {
    // 烟：越升越散，顺风飘
    p.xz += vec2(cos(ang), sin(ang)) * rad * 0.12 * sc + uWind.xz * life * (2.5 + 3.0 * life) + vec2(sin(ang * 7.0 + life * 3.0), cos(ang * 5.0 + life * 2.0)) * 0.35 * life * sc;
    p.y += (0.55 + life * (3.2 + aSeed.x * 2.2)) * sc;
    size = mix(0.35, 2.4, life) * sc;
  }
  vLife = life; vKind = k; vSeed = aSeed;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFade = smoothstep(260.0, 160.0, -mv.z) * smoothstep(0.3, 0.9, -mv.z);
  gl_PointSize = min(size * uPx / max(-mv.z, 0.1), 700.0);
  gl_Position = projectionMatrix * mv;
}`;
const FIRE_FS = `
uniform sampler2D tNoise; uniform float uTime, uPower; uniform vec3 uSmokeCol;
varying float vLife; varying float vKind; varying vec4 vSeed; varying float vFade;
void main(){
  vec2 uv = gl_PointCoord; uv.y = 1.0 - uv.y;
  vec2 q = uv - 0.5; float r = length(q) * 2.0;
  if (r > 1.0 || vFade < 0.003) discard;
  if (vKind < 0.5) {
    float n = texture2D(tNoise, uv * 0.3 + vec2(vSeed.z * 3.0, vSeed.y - uTime * 0.55)).r;
    float shape = smoothstep(1.0, 0.15, r + (n - 0.5) * 1.0 + (uv.y - 0.5) * 0.35);
    float heat = shape * (1.0 - vLife * 0.9);
    vec3 c = mix(vec3(1.0, 0.2, 0.02), vec3(1.0, 0.62, 0.16), smoothstep(0.2, 0.7, heat));
    c = mix(c, vec3(1.0, 0.92, 0.7), smoothstep(0.7, 1.0, heat));
    gl_FragColor = vec4(c * heat * 3.2 * uPower * vFade, heat * 0.25 * vFade);
  } else if (vKind < 1.5) {
    float a = smoothstep(1.0, 0.1, r) * (1.0 - vLife) * (0.6 + 0.4 * sin(uTime * 22.0 + vSeed.z * 40.0));
    gl_FragColor = vec4(vec3(1.0, 0.5, 0.14) * a * 7.0 * vFade, 0.0);
  } else {
    float n = texture2D(tNoise, uv * 0.42 + vec2(vSeed.z * 5.0, vSeed.w * 3.0 - vLife * 0.25)).r;
    float a = smoothstep(1.0, 0.1, r + (n - 0.5) * 0.9) * smoothstep(0.0, 0.08, vLife) * (1.0 - vLife) * (1.0 - vLife) * 0.5 * vFade;
    gl_FragColor = vec4(uSmokeCol * (0.75 + 0.5 * n) * a, a);
  }
}`;
function fireGeo(spec) {
  // spec: [{ kind, n, scale, base:[x,y,z] }]
  let total = 0; for (const s of spec) total += s.n;
  const base = new Float32Array(total * 3), seed = new Float32Array(total * 4), kind = new Float32Array(total * 2);
  let o = 0;
  for (const s of spec) for (let i = 0; i < s.n; i++) {
    const b = s.base || [0, 0, 0];
    base.set(b, o * 3); seed.set([Math.random(), (i + Math.random()) / s.n, Math.random(), Math.random()], o * 4); kind.set([s.kind, s.scale || 1], o * 2); o++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 2));
  return g;
}

// ---------------------------------------------------------------- 环境粒子（围着镜头的一个盒子里循环）
const AMB_VS = `
attribute vec4 aSeed; attribute float aKind;      // 0 落叶 1 浮尘 2 风吹雪 3 萤火虫
uniform vec3 uCam; uniform vec3 uWind; uniform float uTime, uPx, uFeetY; uniform vec4 uAmt;
varying float vKind; varying vec4 vSeed; varying float vA;
void main(){
  float k = aKind; vec3 box, vel, p = position;
  float amt, size;
  if (k < 0.5) {
    box = vec3(36.0, 18.0, 36.0); amt = uAmt.x;
    vel = vec3(uWind.x * 0.8, -(0.7 + aSeed.x * 0.8), uWind.z * 0.8);
    p += vel * uTime;
    p.x += sin(uTime * (0.9 + aSeed.y) + aSeed.z * 40.0) * 0.9; p.z += cos(uTime * (0.7 + aSeed.x) + aSeed.w * 30.0) * 0.9;
    size = 0.1 + aSeed.z * 0.08;
  } else if (k < 1.5) {
    box = vec3(11.0, 7.0, 11.0); amt = uAmt.y;
    vel = vec3(uWind.x * 0.25 + 0.05, 0.03, uWind.z * 0.25);
    p += vel * uTime + vec3(sin(uTime * 0.4 + aSeed.z * 30.0), cos(uTime * 0.31 + aSeed.w * 30.0), sin(uTime * 0.37 + aSeed.x * 30.0)) * 0.35;
    size = 0.012 + aSeed.x * 0.014;
  } else if (k < 2.5) {
    box = vec3(34.0, 2.4, 34.0); amt = uAmt.z;
    vel = vec3(uWind.x * 2.2, 0.0, uWind.z * 2.2);
    p += vel * uTime * (0.7 + aSeed.x * 0.6);
    p.y += sin(uTime * 2.0 + aSeed.z * 50.0) * 0.25;
    size = 0.05 + aSeed.y * 0.09;
  } else {
    box = vec3(30.0, 5.0, 30.0); amt = uAmt.w;
    p += vec3(sin(uTime * 0.23 + aSeed.x * 20.0), sin(uTime * 0.31 + aSeed.y * 20.0) * 0.5, cos(uTime * 0.19 + aSeed.z * 20.0)) * 2.2;
    size = 0.045;
  }
  vec3 org = k > 1.5 && k < 2.5 ? vec3(uCam.x, uFeetY + 1.1, uCam.z) : uCam;
  p = mod(p - org + box * 0.5, box) + org - box * 0.5;
  vec3 d = abs(p - org) / (box * 0.5);
  float edge = (1.0 - smoothstep(0.8, 1.0, max(d.x, d.z))) * (k < 0.5 || k > 2.5 ? 1.0 - smoothstep(0.75, 1.0, d.y) : 1.0);
  vA = step(aSeed.w * 0.999, amt) * edge;
  vKind = k; vSeed = aSeed;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vA *= smoothstep(0.25, 0.8, -mv.z);
  gl_PointSize = clamp(size * uPx / max(-mv.z, 0.1), 0.0, k > 0.5 && k < 1.5 ? 5.0 : 90.0);
  gl_Position = vA > 0.003 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const AMB_FS = `
uniform float uTime; uniform vec3 uLeafA, uLeafB, uLight, uSunCol; uniform float uGlow;
varying float vKind; varying vec4 vSeed; varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  if (vKind < 0.5) {
    // 落叶：一片旋转、翻面的小椭圆
    float a = vSeed.y * 6.2832 + uTime * (1.2 + vSeed.x * 2.0);
    vec2 r = vec2(cos(a) * q.x + sin(a) * q.y, -sin(a) * q.x + cos(a) * q.y);
    float flip = abs(cos(uTime * (1.6 + vSeed.z * 2.2) + vSeed.w * 6.2832));
    float e = length(r / vec2(0.46, 0.08 + 0.2 * flip));
    if (e > 1.0) discard;
    vec3 c = mix(uLeafA, uLeafB, vSeed.z) * (0.55 + 0.45 * flip) * (0.9 + 0.3 * smoothstep(0.1, 0.0, abs(r.y)));
    float al = vA * smoothstep(1.0, 0.8, e);
    gl_FragColor = vec4(c * uLight * al, al);
  } else if (vKind < 1.5) {
    float a = smoothstep(0.5, 0.0, length(q)) * vA * (0.5 + 0.5 * sin(uTime * (1.0 + vSeed.y * 2.0) + vSeed.z * 30.0));
    gl_FragColor = vec4(uSunCol * a * uGlow, 0.0);
  } else if (vKind < 2.5) {
    float a = smoothstep(0.5, 0.05, length(q)) * vA * 0.5;
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * uLight * a, a);
  } else {
    float bl = smoothstep(0.2, 1.0, sin(uTime * (0.8 + vSeed.x * 1.4) + vSeed.y * 30.0));
    float a = smoothstep(0.5, 0.0, length(q)); a = a * a * bl * vA;
    gl_FragColor = vec4(vec3(0.75, 1.0, 0.3) * a * 5.0, 0.0);
  }
}`;

// ---------------------------------------------------------------- 一次性的小团雾气（呵气、脚步扬尘）
const PUFF_VS = `
attribute vec4 aCol; attribute float aSize;
uniform float uPx; varying vec4 vCol;
void main(){
  vCol = aCol;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * uPx / max(-mv.z, 0.1), 500.0);
  gl_Position = aCol.a > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const PUFF_FS = `
uniform sampler2D tNoise; varying vec4 vCol;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float n = texture2D(tNoise, gl_PointCoord * 0.37 + vCol.rg * 3.0).r;
  float a = smoothstep(1.0, 0.1, r + (n - 0.5) * 0.8) * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, a);
}`;

// ---------------------------------------------------------------- 脚印
// 雪地、泥地上一步一个鞋印：贴在地面上的小面片，过一阵慢慢淡掉
const FP_VS = `
attribute float aFade; attribute vec4 aTint;
uniform float uFogD;
varying vec2 vUv; varying float vFade; varying vec4 vTint;
void main(){
  vUv = uv; vTint = aTint;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  float fd = -mv.z * uFogD;
  vFade = aFade * smoothstep(75.0, 45.0, -mv.z) * exp(-fd * fd * 2.0);     // 远了、雾里就看不见了
  gl_Position = vFade > 0.003 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FP_FS = `
varying vec2 vUv; varying float vFade; varying vec4 vTint;
void main(){
  // 鞋印的形状：前掌一块、脚跟一块，中间是足弓；里面有几道鞋底的横纹
  vec2 p = vUv - vec2(0.5, 0.0);
  float fore = 1.0 - length((p - vec2(0.0, 0.655)) / vec2(0.39, 0.285));
  float heel = 1.0 - length((p - vec2(0.0, 0.205)) / vec2(0.30, 0.165));
  float arch = 1.0 - length((p - vec2(0.035, 0.42)) / vec2(0.2, 0.2));
  float d = max(max(fore, heel), arch);
  float m = smoothstep(0.0, 0.2, d);
  float tread = 0.76 + 0.24 * smoothstep(0.35, 0.65, abs(fract(vUv.y * 7.0) - 0.5) * 2.0);
  // 坑里压暗（脚跟踩得更深），坑沿是被挤起来的一圈，略亮
  float a = m * tread * (0.82 + 0.18 * smoothstep(0.5, 0.15, vUv.y)) * vFade;
  float rim = smoothstep(-0.2, -0.05, d) * (1.0 - smoothstep(-0.05, 0.05, d)) * vTint.a * vFade;
  gl_FragColor = vec4(mix(vec3(1.0), vTint.rgb, a) * (1.0 + rim), 1.0);
}`;

const LEAF_COL = {
  spring: [[0.95, 0.75, 0.85], [1.0, 0.95, 0.95]],      // 春天飘的是花瓣
  summer: [[0.25, 0.42, 0.12], [0.4, 0.5, 0.15]],
  autumn: [[0.85, 0.55, 0.1], [0.7, 0.18, 0.06]],
  winter: [[0.35, 0.27, 0.18], [0.45, 0.36, 0.24]],
};

export class FX {
  constructor(scene) {
    this.scene = scene;
    const noise = tex('noise').a;
    // 营火
    this.fireU = { uPos: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() }, uTime: { value: 0 }, uPower: { value: 0 }, uPx: { value: 600 }, tNoise: { value: noise }, uSmokeCol: { value: new THREE.Color(0.3, 0.3, 0.32) } };
    this.fireMat = new THREE.ShaderMaterial({ uniforms: this.fireU, vertexShader: FIRE_VS, fragmentShader: FIRE_FS, ...PREMULT });
    this.fire = new THREE.Points(fireGeo([{ kind: 2, n: 14 }, { kind: 0, n: 26 }, { kind: 1, n: 26 }]), this.fireMat);
    this.fire.frustumCulled = false; this.fire.visible = false; this.fire.renderOrder = 6; scene.add(this.fire);
    // 炊烟 / 香火（位置写在每个粒子里）
    this.smokeU = { ...this.fireU, uPos: { value: new THREE.Vector3() }, uPower: { value: 1 } };
    this.smokeMat = new THREE.ShaderMaterial({ uniforms: this.smokeU, vertexShader: FIRE_VS, fragmentShader: FIRE_FS, ...PREMULT });
    this.smoke = null;
    // 环境粒子
    const N = [220, 160, 520, 50];
    const total = N.reduce((a, b) => a + b, 0);
    const pos = new Float32Array(total * 3), seed = new Float32Array(total * 4), kind = new Float32Array(total);
    let o = 0;
    N.forEach((n, k) => { for (let i = 0; i < n; i++) { pos.set([Math.random() * 40, Math.random() * 20, Math.random() * 40], o * 3); seed.set([Math.random(), Math.random(), Math.random(), (i + 0.5) / n], o * 4); kind[o] = k; o++; } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    this.ambU = { uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() }, uTime: { value: 0 }, uPx: { value: 600 }, uFeetY: { value: 0 }, uAmt: { value: new THREE.Vector4() },
      uLeafA: { value: new THREE.Color() }, uLeafB: { value: new THREE.Color() }, uLight: { value: new THREE.Color(1, 1, 1) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: 0 } };
    this.amb = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.ambU, vertexShader: AMB_VS, fragmentShader: AMB_FS, ...PREMULT }));
    this.amb.frustumCulled = false; this.amb.renderOrder = 4; scene.add(this.amb);
    // 小团雾气
    const M = this.M = 64;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(M * 4), 4).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(M), 1).setUsage(THREE.DynamicDrawUsage));
    this.puffU = { uPx: { value: 600 }, tNoise: { value: noise } };
    this.puffs = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: this.puffU, vertexShader: PUFF_VS, fragmentShader: PUFF_FS, ...PREMULT }));
    this.puffs.frustumCulled = false; this.puffs.renderOrder = 5; this.puffs.visible = false; scene.add(this.puffs);
    this.pool = []; for (let i = 0; i < M; i++) this.pool.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 0.1, s1: 0.4, c: [1, 1, 1], a: 0.4 });
    this.poolI = 0; this.breathT = 0;
    this._w = new THREE.Vector3();
    // 脚印
    const FN = this.FN = 96;
    const fg = new THREE.PlaneGeometry(0.17, 0.37); fg.rotateX(Math.PI / 2);      // 平放，贴图的“上”朝前
    this.fpFade = new THREE.InstancedBufferAttribute(new Float32Array(FN), 1).setUsage(THREE.DynamicDrawUsage);
    this.fpTint = new THREE.InstancedBufferAttribute(new Float32Array(FN * 4), 4).setUsage(THREE.DynamicDrawUsage);
    fg.setAttribute('aFade', this.fpFade); fg.setAttribute('aTint', this.fpTint);
    // 相乘混合：脚印只是把底下的地面压暗一点，所以向阳处、阴影里、夜里都自然跟着地面走
    this.fpU = { uFogD: { value: 0.001 } };
    this.prints = new THREE.InstancedMesh(fg, new THREE.ShaderMaterial({ uniforms: this.fpU, vertexShader: FP_VS, fragmentShader: FP_FS, ...PREMULT, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), FN);
    this.prints.frustumCulled = false; this.prints.renderOrder = 3; this.prints.visible = false; scene.add(this.prints);
    this.fpLife = new Float32Array(FN); this.fpMax = new Float32Array(FN); this.fpA = new Float32Array(FN); this.fpI = 0; this.fpAny = false;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._qy = new THREE.Quaternion(); this._up = new THREE.Vector3(0, 1, 0); this._s = new THREE.Vector3(1, 1, 1);
  }

  // 留一个脚印。normal：地面法线；side：'L' / 'R'；kind：'snow' 雪地（发蓝的浅坑）/ 'mud' 泥地（深色的湿印）
  footprint(x, y, z, yaw, normal, side, kind) {
    const i = this.fpI; this.fpI = (this.fpI + 1) % this.FN;
    this._qy.setFromAxisAngle(this._up, yaw + (side === 'L' ? -0.12 : 0.12));
    if (normal) this._q.setFromUnitVectors(this._up, normal).multiply(this._qy); else this._q.copy(this._qy);
    this._w.set(x, y + 0.025, z);
    this._s.set(side === 'L' ? -1 : 1, 1, 1);
    this._m.compose(this._w, this._q, this._s);
    this.prints.setMatrixAt(i, this._m); this.prints.instanceMatrix.needsUpdate = true;
    // 颜色是“乘到地面上”的倍数：雪坑发蓝发暗、坑沿略亮；泥印是一块深色的湿痕
    const c = kind === 'snow' ? [0.5, 0.6, 0.8, 0.16] : [0.36, 0.31, 0.27, 0];
    this.fpTint.setXYZW(i, c[0], c[1], c[2], c[3]); this.fpTint.needsUpdate = true;
    this.fpMax[i] = this.fpLife[i] = kind === 'snow' ? 50 : 28; this.fpA[i] = 1;
    this.fpAny = true;
  }
  clearPrints() { this.fpLife.fill(0); this.fpFade.array.fill(0); this.fpFade.needsUpdate = true; this.fpAny = false; this.prints.visible = false; }

  // 冒烟的固定地点（民居烟囱、寺庙香炉）
  setSmokes(list) {
    if (this.smoke) { this.scene.remove(this.smoke); this.smoke.geometry.dispose(); this.smoke = null; }
    if (!list || !list.length) return;
    const spec = [];
    for (const s of list) spec.push({ kind: 2, n: s.kind === 'chimney' ? 7 : 4, scale: s.kind === 'chimney' ? 0.6 : 0.14, base: [s.x, s.y, s.z] });
    this.smoke = new THREE.Points(fireGeo(spec), this.smokeMat);
    this.smoke.frustumCulled = false; this.smoke.renderOrder = 6; this.scene.add(this.smoke);
  }

  setFire(pos, power = 1) {
    this.fire.visible = !!pos && power > 0.01;
    if (pos) this.fireU.uPos.value.copy(pos);
    this.fireU.uPower.value = power;
  }

  // 放一小团雾气：呵气、脚步带起的尘土或雪沫
  puff(p, v, o = {}) {
    const q = this.pool[this.poolI]; this.poolI = (this.poolI + 1) % this.M;
    q.p.copy(p); q.v.copy(v); q.max = q.life = o.life || 1; q.s0 = o.s0 || 0.08; q.s1 = o.s1 || 0.4; q.c = o.c || [1, 1, 1]; q.a = o.a === undefined ? 0.35 : o.a;
  }
  step(pos, kind, speed = 1) {
    // kind: 'snow' 雪沫 / 'dust' 尘土
    const c = kind === 'snow' ? [0.93, 0.96, 1.0] : [0.5, 0.43, 0.33];
    const n = kind === 'snow' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      this._w.set((Math.random() - 0.5) * 0.6, 0.25 + Math.random() * 0.35, (Math.random() - 0.5) * 0.6);
      this.puff(pos, this._w, { life: 0.55 + Math.random() * 0.4, s0: 0.1, s1: 0.4 + Math.random() * 0.25, c, a: (kind === 'snow' ? 0.5 : 0.22) * Math.min(1, speed / 4) });
    }
  }

  // e: { time, dt, cam, camera, px, feetY, wind(Vector2), sunCol, light(Color), glow, leaves, motes, drift, fireflies, season, breath: {pos, dir, amount} | null }
  update(e) {
    const t = e.time % 3600, w = e.wind;
    for (const U of [this.fireU, this.smokeU]) { U.uTime.value = t; U.uPx.value = e.px; U.uWind.value.set(w.x * 0.35, 0, w.y * 0.35); }
    if (e.light) this.fireU.uSmokeCol.value.copy(e.light).multiplyScalar(0.42).addScalar(0.015);
    const A = this.ambU;
    A.uTime.value = t; A.uPx.value = e.px; A.uCam.value.copy(e.cam); A.uFeetY.value = e.feetY; A.uWind.value.set(w.x, 0, w.y);
    A.uAmt.value.set(e.leaves || 0, e.motes || 0, e.drift || 0, e.fireflies || 0);
    const LC = LEAF_COL[e.season] || LEAF_COL.autumn;
    A.uLeafA.value.setRGB(LC[0][0], LC[0][1], LC[0][2]); A.uLeafB.value.setRGB(LC[1][0], LC[1][1], LC[1][2]);
    if (e.light) A.uLight.value.copy(e.light);
    if (e.sunCol) A.uSunCol.value.copy(e.sunCol);
    A.uGlow.value = e.glow || 0;
    this.amb.visible = (e.leaves || 0) + (e.motes || 0) + (e.drift || 0) + (e.fireflies || 0) > 0.005;
    // 呵气：天冷时每隔几秒从嘴边吐出一团白气
    if (e.breath && e.breath.amount > 0.01) {
      this.breathT -= e.dt;
      if (this.breathT <= 0) {
        this.breathT = 2.6 + Math.random() * 1.2;
        for (let i = 0; i < 3; i++) {
          this._w.copy(e.breath.dir).multiplyScalar(0.35 + i * 0.12); this._w.y += 0.12; this._w.x += w.x * 0.15; this._w.z += w.y * 0.15;
          this.puff(e.breath.pos, this._w, { life: 1.1 + i * 0.25, s0: 0.05, s1: 0.3 + i * 0.08, c: [0.9, 0.93, 0.97], a: 0.3 * e.breath.amount });
        }
      }
    }
    // 小团雾气的生命周期
    const pos = this.puffs.geometry.attributes.position, col = this.puffs.geometry.attributes.aCol, sz = this.puffs.geometry.attributes.aSize;
    let any = false;
    const lit = e.light || { r: 1, g: 1, b: 1 };
    for (let i = 0; i < this.M; i++) {
      const q = this.pool[i];
      if (q.life <= 0) { if (col.array[i * 4 + 3] !== 0) { col.array[i * 4 + 3] = 0; col.needsUpdate = true; } continue; }
      q.life -= e.dt; any = true;
      const k = 1 - Math.max(q.life, 0) / q.max;
      q.p.addScaledVector(q.v, e.dt); q.v.multiplyScalar(1 - Math.min(1, e.dt * 1.6)); q.v.y += e.dt * 0.12;
      pos.array[i * 3] = q.p.x; pos.array[i * 3 + 1] = q.p.y; pos.array[i * 3 + 2] = q.p.z;
      const br = Math.min(1.2, 0.25 + lit.g);
      col.array[i * 4] = q.c[0] * br; col.array[i * 4 + 1] = q.c[1] * br; col.array[i * 4 + 2] = q.c[2] * br;
      col.array[i * 4 + 3] = q.a * Math.sin(Math.min(1, k * 4) * Math.PI / 2) * (1 - k) * (1 - k);
      sz.array[i] = q.s0 + (q.s1 - q.s0) * Math.sqrt(k);
      pos.needsUpdate = col.needsUpdate = sz.needsUpdate = true;
    }
    this.puffs.visible = any; this.puffU.uPx.value = e.px;
    // 脚印慢慢淡掉
    if (this.fpAny) {
      let left = false;
      for (let i = 0; i < this.FN; i++) {
        if (this.fpLife[i] <= 0) continue;
        this.fpLife[i] -= e.dt;
        const k = Math.max(0, this.fpLife[i] / this.fpMax[i]);
        this.fpFade.array[i] = this.fpA[i] * Math.min(1, k * 3.3);
        if (this.fpLife[i] > 0) left = true;
      }
      this.fpFade.needsUpdate = true; this.fpAny = left; this.prints.visible = left;
      this.fpU.uFogD.value = e.fogD || 0;
    }
  }

  dispose() {
    for (const o of [this.fire, this.amb, this.puffs, this.smoke, this.prints]) if (o) { this.scene.remove(o); o.geometry.dispose(); }
  }
}
