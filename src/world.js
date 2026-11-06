// ===================== 天空 / 光照 / 云海 / 地标建筑 / 路标 =====================
import * as THREE from 'three';
import { ROUTE, routeZ, routeDZ, altToY, ROUTE_LENGTH, season } from './data.js';
import { heightAt, LAKE, nearestWaypoint, STREAM } from './terrain.js';
import { mulberry32, clamp, lerp, smoothstep } from './noise.js';

// ---------------- 天空 ----------------
const skyVS = `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFS = `
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunColor;
uniform float uCloud; uniform vec3 uCloudColor; uniform float uTime; uniform float uNight; uniform float uFogMix; uniform float uFlash; uniform float uRainbow;
varying vec3 vDir;
float h31(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, h));
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.35, h));
  float sd = max(dot(d, uSunDir), 0.0);
  float clear = 1.0 - uCloud * 0.85;
  col += uSunColor * (pow(sd, 5.0) * 0.28 + pow(sd, 48.0) * 0.5) * clear;
  col += uSunColor * smoothstep(0.99935, 0.99965, sd) * 6.0 * (1.0 - uCloud);
  // 月亮与星空
  vec3 md = normalize(vec3(-uSunDir.x, abs(uSunDir.y) * 0.8 + 0.25, -uSunDir.z + 0.3));
  float mdd = dot(d, md);
  col += vec3(0.75, 0.8, 0.95) * (smoothstep(0.9991, 0.9995, mdd) * 1.2 + pow(max(mdd,0.0), 200.0) * 0.15) * uNight * (1.0 - uCloud);
  if (h > 0.0) {
    vec3 sp = floor(d * 420.0);
    float s = h31(sp);
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + s * 100.0);
    col += vec3(0.9, 0.92, 1.0) * step(0.9975, s) * tw * uNight * (1.0 - uCloud) * smoothstep(0.0, 0.2, h) * 1.4;
    // 银河
    float mw = exp(-pow(dot(d, normalize(vec3(0.3, 0.6, 0.75))) * 4.0, 2.0));
    col += vec3(0.25, 0.27, 0.35) * mw * fbm(d.xz * 9.0) * uNight * (1.0 - uCloud) * 0.35;
  }
  // 云层
  if (h > -0.05) {
    vec2 uv = d.xz / max(h + 0.08, 0.05) * 0.7 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(uv * 1.3);
    float c = smoothstep(0.75 - uCloud * 0.55, 0.95 - uCloud * 0.35, n + uCloud * 0.25);
    c *= smoothstep(-0.05, 0.12, h);
    float lit = 0.75 + 0.35 * pow(sd, 3.0) - (n - 0.5) * 0.5;
    vec3 cc = uCloudColor * lit + uSunColor * pow(sd, 8.0) * 0.4 * clear;
    col = mix(col, cc, c * 0.96);
  }
  // 雨后彩虹（反日点 42°）
  if (uRainbow > 0.01 && h > -0.02) {
    float ang = acos(clamp(dot(d, -uSunDir), -1.0, 1.0));
    float t = (ang - 0.69) / 0.055;
    if (t > 0.0 && t < 1.0) {
      float hue = (1.0 - t) * 0.78;
      vec3 rc = clamp(vec3(abs(hue * 6.0 - 3.0) - 1.0, 2.0 - abs(hue * 6.0 - 2.0), 2.0 - abs(hue * 6.0 - 4.0)), 0.0, 1.0);
      col += rc * sin(t * 3.14159) * uRainbow * 0.32 * smoothstep(-0.02, 0.12, h) * (1.0 - uCloud * 0.5);
    }
    float t2 = (ang - 0.88) / 0.06;
    if (t2 > 0.0 && t2 < 1.0) { float hue = t2 * 0.78; vec3 rc = clamp(vec3(abs(hue * 6.0 - 3.0) - 1.0, 2.0 - abs(hue * 6.0 - 2.0), 2.0 - abs(hue * 6.0 - 4.0)), 0.0, 1.0); col += rc * sin(t2 * 3.14159) * uRainbow * 0.1 * smoothstep(0.0, 0.12, h); }
  }
  col = mix(col, uHorizon, uFogMix);
  col += vec3(0.75, 0.8, 1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color(1, 0.9, 0.7) }, uCloud: { value: 0.2 }, uCloudColor: { value: new THREE.Color(1, 1, 1) },
      uTime: { value: 0 }, uNight: { value: 0 }, uFogMix: { value: 0 }, uFlash: { value: 0 }, uRainbow: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: skyVS, fragmentShader: skyFS, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
}

// ---------------- 云海 ----------------
const seaVS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const seaFS = `
uniform float uTime; uniform vec3 uCol; uniform vec3 uShade; uniform float uAlpha; uniform vec3 uCam; uniform vec3 uFogC;
varying vec3 vW;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.07; a*=0.5; } return s; }
void main(){
  vec2 p = vW.xz * 0.004 + vec2(uTime * 0.004, uTime * 0.0015);
  float n = fbm(p) * 0.7 + fbm(p * 3.1 - uTime * 0.01) * 0.3;
  float a = smoothstep(0.35, 0.65, n) * uAlpha;
  float dist = length(vW.xz - uCam.xz);
  a *= smoothstep(30.0, 120.0, dist) * smoothstep(2600.0, 1200.0, dist);
  vec3 c = mix(uShade, uCol, smoothstep(0.4, 0.8, n));
  c = mix(c, uFogC, smoothstep(600.0, 2400.0, dist) * 0.7);
  gl_FragColor = vec4(c, a);
}`;

export class CloudSea {
  constructor(scene) {
    this.uniforms = { uTime: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.7, 0.72, 0.78) }, uAlpha: { value: 0.9 }, uCam: { value: new THREE.Vector3() }, uFogC: { value: new THREE.Color() } };
    const mat = new THREE.ShaderMaterial({ vertexShader: seaVS, fragmentShader: seaFS, uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false });
    const g = new THREE.PlaneGeometry(5200, 5200, 1, 1); g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
}

// ---------------- 水面 ----------------
export const WATER_U = {
  uTime: { value: 0 }, uSkyH: { value: new THREE.Color() }, uSkyZ: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color() }, uFogC: { value: new THREE.Color() }, uFogD: { value: 0.001 }, uDay: { value: 1 },
};
const waterVS = `varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const waterFS = `
uniform float uTime; uniform float uFogD; uniform float uDay; uniform float uFlow; uniform vec3 uSkyH; uniform vec3 uSkyZ; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uFogC; uniform vec3 uDeep;
varying vec3 vW; varying vec2 vUv;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float wave(vec2 p){ return vn(p * 2.0) + vn(p * 5.3 + 3.1) * 0.5 + vn(p * 13.0 - 1.7) * 0.2; }
void main(){
  vec2 p = uFlow > 0.0 ? vec2(vUv.x * 3.0, vUv.y * 0.6 - uTime * uFlow) : vW.xz * 0.3 + vec2(uTime * 0.04, uTime * 0.025);
  float e = 0.04;
  float h0 = wave(p), hx = wave(p + vec2(e, 0.0)), hz = wave(p + vec2(0.0, e));
  float k = uFlow > 0.0 ? 2.6 : 1.4;
  vec3 N = normalize(vec3((h0 - hx) * k, 1.0, (h0 - hz) * k));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyH, uSkyZ, clamp(R.y * 1.6, 0.0, 1.0));
  vec3 col = mix(uDeep * (0.15 + 0.85 * uDay), sky, 0.12 + fres * 0.82);
  col += uSunCol * pow(max(dot(R, uSunDir), 0.0), 220.0) * 3.0;
  if (uFlow > 0.0) col += vec3(0.6) * smoothstep(0.82, 1.0, h0 / 1.4) * 0.5 * uDay;
  float dist = length(cameraPosition - vW);
  col = mix(col, uFogC, 1.0 - exp(-uFogD * uFogD * dist * dist));
  gl_FragColor = vec4(col, uFlow > 0.0 ? 0.85 : 0.93);
}`;
export function waterMaterial(deep, flow = 0) {
  return new THREE.ShaderMaterial({ uniforms: { ...WATER_U, uDeep: { value: new THREE.Color(deep) }, uFlow: { value: flow } }, vertexShader: waterVS, fragmentShader: waterFS, transparent: true, depthWrite: true });
}

// ---------------- 佛光（布罗肯幽灵）----------------
const gloryFS = `
uniform float uAlpha; varying vec2 vUv;
vec3 hue(float h){ return clamp(vec3(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), 0.0, 1.0); }
void main(){
  vec2 q = vUv - 0.5; float r = length(q) * 2.0;
  float rings = 0.0; vec3 c = vec3(0.0);
  for (int i = 0; i < 3; i++) { float r0 = 0.32 + float(i) * 0.2; float t = (r - r0) / 0.14; if (t > 0.0 && t < 1.0) { c += hue((1.0 - t) * 0.75) * sin(t * 3.14159) * (1.0 - float(i) * 0.28); rings = max(rings, sin(t * 3.14159)); } }
  float halo = smoothstep(0.35, 0.0, r) * 0.6;
  // 中心人影
  float head = smoothstep(0.045, 0.035, length(q - vec2(0.0, 0.06)));
  float body = smoothstep(0.05, 0.035, length((q - vec2(0.0, -0.05)) * vec2(1.7, 0.8)));
  float sil = max(head, body);
  vec3 col = c * 0.9 + vec3(1.0, 0.98, 0.9) * halo;
  float a = (rings * 0.55 + halo * 0.5) * uAlpha;
  col = mix(col, vec3(0.1, 0.1, 0.12), sil);
  a = max(a, sil * 0.6 * uAlpha);
  gl_FragColor = vec4(col, a * smoothstep(1.0, 0.85, r));
}`;
export class Glory {
  constructor(scene) {
    this.u = { uAlpha: { value: 0 } };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: gloryFS, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    this.mesh.renderOrder = 5; this.mesh.visible = false; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(camera, sunDir, a) {
    this.u.uAlpha.value = a;
    this.mesh.visible = a > 0.01;
    if (!this.mesh.visible) return;
    const anti = sunDir.clone().negate();
    this.mesh.position.copy(camera.position).addScaledVector(anti, 80);
    this.mesh.scale.setScalar(26);
    this.mesh.lookAt(camera.position);
  }
}

// ---------------- 文字贴图 ----------------
export function textTexture(lines, { w = 512, h = 256, bg = '#6b4a2b', fg = '#f3e6c8', font = '"Kaiti SC","STKaiti","KaiTi","Songti SC",serif', sizes = [84, 40], border = '#3d2814' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // 木纹
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.06})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 8, w * 0.6, y - 8, w, y + 4); g.stroke(); }
  g.strokeStyle = border; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const total = lines.length;
  lines.forEach((t, i) => {
    const s = sizes[Math.min(i, sizes.length - 1)];
    let fs = s; g.font = `bold ${fs}px ${font}`;
    while (g.measureText(t).width > w - 40 && fs > 16) { fs -= 4; g.font = `bold ${fs}px ${font}`; }
    const y = total === 1 ? h / 2 : (i === 0 ? h * 0.42 : h * 0.78);
    g.fillText(t, w / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------- 材质 ----------------
const M = {};
function mats() {
  if (M.stone) return M;
  M.stone = new THREE.MeshStandardMaterial({ color: 0x5e5a54, roughness: 0.95, flatShading: true });
  M.stoneDark = new THREE.MeshStandardMaterial({ color: 0x4e4a45, roughness: 0.95, flatShading: true });
  M.roof = new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.8, flatShading: true });
  M.roofRed = new THREE.MeshStandardMaterial({ color: 0x6e2a1e, roughness: 0.8, flatShading: true });
  M.roofBlue = new THREE.MeshStandardMaterial({ color: 0x2c4a6e, roughness: 0.6, metalness: 0.3, flatShading: true });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.9 });
  M.woodDark = new THREE.MeshStandardMaterial({ color: 0x2e1e12, roughness: 0.9 });
  M.wall = new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.95 });
  M.metal = new THREE.MeshStandardMaterial({ color: 0x7a5a42, roughness: 0.6, metalness: 0.6 });
  M.alu = new THREE.MeshStandardMaterial({ color: 0xa9aeb3, roughness: 0.45, metalness: 0.75, flatShading: true });
  M.red = new THREE.MeshStandardMaterial({ color: 0xc0201a, roughness: 0.8, emissive: 0x400505, side: THREE.DoubleSide });
  M.yellow = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.8, side: THREE.DoubleSide });
  M.window = new THREE.MeshStandardMaterial({ color: 0x222018, emissive: 0xffb050, emissiveIntensity: 0 });
  M.lantern = new THREE.MeshStandardMaterial({ color: 0xc02020, emissive: 0xff3a1a, emissiveIntensity: 0.3 });
  M.water = new THREE.MeshStandardMaterial({ color: 0x0d2533, roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.92 });
  M.mud = new THREE.MeshStandardMaterial({ color: 0x3a2d20, roughness: 1 });
  M.ice = new THREE.MeshStandardMaterial({ color: 0xb8d0dc, roughness: 0.15, metalness: 0.2 });
  M.tentO = new THREE.MeshStandardMaterial({ color: 0xd86a1c, roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
  M.tentG = new THREE.MeshStandardMaterial({ color: 0x4c7a3a, roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
  M.tentTorn = new THREE.MeshStandardMaterial({ color: 0x5d6b80, roughness: 0.8, flatShading: true, side: THREE.DoubleSide });
  M.road = new THREE.MeshStandardMaterial({ color: 0x2b2b2d, roughness: 0.85 });
  M.roof = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.7, vertexColors: true, side: THREE.DoubleSide });
  M.roofRed = new THREE.MeshStandardMaterial({ color: 0x7a3a22, roughness: 0.65, vertexColors: true, side: THREE.DoubleSide });
  M.roofBlue = new THREE.MeshStandardMaterial({ color: 0x2c4a6e, roughness: 0.5, metalness: 0.3, vertexColors: true, side: THREE.DoubleSide });
  M.ridge = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7 });
  M.gable = new THREE.MeshStandardMaterial({ color: 0x8e8679, roughness: 0.95, side: THREE.DoubleSide });
  M.wallRed = new THREE.MeshStandardMaterial({ color: 0x8c3b2a, roughness: 0.9 });
  M.pillar = new THREE.MeshStandardMaterial({ color: 0x8e2a1e, roughness: 0.6 });
  M.beam = new THREE.MeshStandardMaterial({ color: 0x2f5f5a, roughness: 0.7 });
  M.beamGold = new THREE.MeshStandardMaterial({ color: 0xb8913a, roughness: 0.5, metalness: 0.3 });
  M.door = new THREE.MeshStandardMaterial({ color: 0x5a1e14, roughness: 0.75 });
  M.incense = new THREE.MeshStandardMaterial({ color: 0xc0201a, emissive: 0x501000 });
  return M;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; return m;
}
function cyl(rt, rb, h, mat, seg = 8) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = true; m.receiveShadow = true; return m; }

// 中式曲面瓦顶：屋脊沿 x，前后坡下凹，四角起翘
function curvedRoof(L, D, H, mat, over = 0.6, up = 0.55) {
  const m = mats();
  const g = new THREE.Group();
  const nu = 28, nv = 9;
  const hx = L / 2 + over, hz = D / 2 + over * 0.9;
  for (const s of [-1, 1]) {
    const pos = [], col = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu * 2 - 1, v = j / nv;
      let y = H * Math.pow(1 - v, 1.5) + up * Math.pow(Math.abs(u), 7) * v * v + 0.06 * H * v * v * v;
      const x = u * hx * (1 + 0.05 * v * Math.pow(Math.abs(u), 3));
      const z = s * v * hz;
      pos.push(x, y, z);
      const tile = (i % 2 ? 0.78 : 1) * (j === nv ? 0.7 : 1);
      col.push(tile, tile, tile);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (s > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
  }
  // 正脊与鸱吻
  const ridge = box(L + over * 1.1, 0.32, 0.3, m.ridge, 0, H + 0.08, 0); g.add(ridge);
  for (const s of [-1, 1]) {
    const orn = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 10, Math.PI * 1.2), m.ridge);
    orn.position.set(s * (L / 2 + over * 0.55), H + 0.35, 0); orn.rotation.set(0, Math.PI / 2, s > 0 ? 0.4 : Math.PI - 0.4); orn.castShadow = true; g.add(orn);
    // 山墙三角
    const shape = new THREE.Shape(); shape.moveTo(-D / 2, 0); shape.lineTo(D / 2, 0); shape.lineTo(0, H * 0.92); shape.closePath();
    const tri = new THREE.Mesh(new THREE.ShapeGeometry(shape), m.gable); tri.rotation.y = Math.PI / 2; tri.position.set(s * L / 2 * 0.985, 0, 0); g.add(tri);
  }
  return g;
}

function temple(size = 1, roofMat, opts = {}) {
  const m = mats();
  const g = new THREE.Group();
  const w = 4.6 * size, d = 3.6 * size, h = 2.5 * size, b = 0.55;
  const wall = opts.red ? m.wallRed : m.stone;
  g.add(box(w + 1.6, b, d + 1.8, m.stoneDark, 0, b / 2, 0.1));
  for (let k = 0; k < 2; k++) g.add(box(w * 0.42, 0.18, 0.45, m.stoneDark, 0, 0.09 + k * 0.18, d / 2 + 1.25 - k * 0.4));
  g.add(box(w, h, 0.3, wall, 0, b + h / 2, -d / 2 + 0.15));
  g.add(box(0.3, h, d - 0.8, wall, -w / 2 + 0.15, b + h / 2, -0.4));
  g.add(box(0.3, h, d - 0.8, wall, w / 2 - 0.15, b + h / 2, -0.4));
  // 前墙（退进成檐廊）带门洞
  const fz = d / 2 - 0.85;
  g.add(box(w * 0.34, h, 0.25, wall, -w * 0.33, b + h / 2, fz));
  g.add(box(w * 0.34, h, 0.25, wall, w * 0.33, b + h / 2, fz));
  g.add(box(w * 0.32, h * 0.3, 0.25, wall, 0, b + h * 0.85, fz));
  const door = box(w * 0.15, h * 0.68, 0.08, m.door, -w * 0.08, b + h * 0.34, fz + 0.05, 0.35); g.add(door);
  g.add(box(w * 0.15, h * 0.68, 0.08, m.door, w * 0.09, b + h * 0.34, fz + 0.12, -0.2));
  // 檐柱与彩画额枋
  for (const px of [-0.42, -0.15, 0.15, 0.42]) { const c = cyl(0.11 * size + 0.03, 0.13 * size + 0.03, h, m.pillar, 10); c.position.set(px * w, b + h / 2, d / 2 - 0.1); g.add(c); }
  g.add(box(w * 0.95, 0.28, 0.24, m.beam, 0, b + h - 0.12, d / 2 - 0.1));
  g.add(box(w * 0.95, 0.1, 0.26, m.beamGold, 0, b + h - 0.3, d / 2 - 0.1));
  if (opts.name) {
    const tex = textTexture([opts.name], { w: 512, h: 160, bg: '#1d2b3c', fg: '#e9c46a', border: '#b8913a', sizes: [92] });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.3, w * 0.095), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    plaque.position.set(0, b + h * 0.86, fz + 0.14); g.add(plaque);
  }
  const r = curvedRoof(w, d, 1.25 * size, roofMat || m.roof, 0.75 * size, 0.55 * size);
  r.position.y = b + h; g.add(r);
  const burner = cyl(0.42, 0.32, 0.65, m.metal, 10); burner.position.set(0, 0.85, d / 2 + 2.1); g.add(burner);
  for (let k = 0; k < 3; k++) { const st = cyl(0.012, 0.012, 0.5, m.incense, 4); st.position.set(-0.12 + k * 0.12, 1.4, d / 2 + 2.1); g.add(st); }
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.3), m.red); ribbon.position.set(w * 0.42, b + h * 0.55, d / 2 + 0.05); g.add(ribbon);
  if (opts.lanterns) {
    for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), m.lantern); l.scale.y = 1.25; l.position.set(s * w * 0.28, b + h - 0.6, d / 2 + 0.05); g.add(l); }
  }
  return g;
}

function house(w, d, h, opts = {}) {
  const m = mats();
  const g = new THREE.Group();
  g.add(box(w + 0.1, 0.5, d + 0.1, m.stoneDark, 0, 0.25, 0));
  g.add(box(w, h - 0.5, d, opts.stone ? m.stone : m.wall, 0, 0.5 + (h - 0.5) / 2, 0));
  const r = curvedRoof(w, d, h * 0.42, opts.roof || m.roof, 0.55, 0.22); r.position.y = h; g.add(r);
  for (const s of [-1, 1]) {
    const win = box(0.9, 0.75, 0.08, m.window, s * w * 0.27, h * 0.58, d / 2 + 0.03); win.castShadow = false; g.add(win);
    for (let k = -1; k <= 1; k++) g.add(box(0.04, 0.75, 0.1, m.woodDark, s * w * 0.27 + k * 0.22, h * 0.58, d / 2 + 0.05));
    g.add(box(0.95, 0.06, 0.12, m.woodDark, s * w * 0.27, h * 0.58 + 0.4, d / 2 + 0.05));
  }
  g.add(box(0.9, 1.75, 0.08, m.door, 0, 0.5 + 0.87, d / 2 + 0.03));
  for (const s of [-1, 1]) g.add(box(0.16, 1.3, 0.04, m.red, s * 0.62, 0.5 + 0.95, d / 2 + 0.05));
  g.add(box(1.1, 0.22, 0.04, m.red, 0, 0.5 + 1.95, d / 2 + 0.05));
  if (opts.lantern !== false) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), m.lantern); l.scale.y = 1.25; l.position.set(0.75, h - 0.35, d / 2 + 0.4); g.add(l); }
  const ch = box(0.4, 1.0, 0.4, m.stone, w * 0.3, h + 0.6, -d * 0.2); g.add(ch);
  return g;
}

function navTower() {
  const m = mats();
  const g = new THREE.Group();
  const H = 9, B = 2.4;
  const apex = new THREE.Vector3(0, H, 0);
  const corners = [[-B, -B], [B, -B], [B, B], [-B, B]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const beam = (a, b, r = 0.07) => {
    const len = a.distanceTo(b);
    const c = cyl(r, r, len, m.metal, 5);
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(c);
  };
  for (const c of corners) beam(c, apex, 0.09);
  for (let lv = 1; lv <= 3; lv++) {
    const t = lv / 4;
    const pts = corners.map(c => c.clone().lerp(apex, t));
    for (let i = 0; i < 4; i++) beam(pts[i], pts[(i + 1) % 4], 0.05);
  }
  const pole = cyl(0.05, 0.05, 3, m.metal, 5); pole.position.y = H + 1.5; g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), m.red); flag.position.set(0.55, H + 2.6, 0); g.add(flag);
  g.userData.flag = flag;
  return g;
}

function cairn(s = 1) {
  const m = mats();
  const g = new THREE.Group();
  const r = mulberry32((s * 1000) | 0);
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const sz = (0.55 - i * 0.1) * s;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(sz, 0), m.stone);
    st.scale.y = 0.6; st.position.set((r() - 0.5) * 0.1, y + sz * 0.5, (r() - 0.5) * 0.1); st.rotation.y = r() * 3; st.castShadow = true;
    g.add(st); y += sz * 0.9;
  }
  return g;
}

function signPost(name, alt) {
  const m = mats();
  const g = new THREE.Group();
  const post = cyl(0.09, 0.11, 2.6, m.wood, 6); post.position.y = 1.3; g.add(post);
  const tex = textTexture([name, alt ? `海拔 ${alt} m` : ''].filter(Boolean));
  const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 0.08), [m.wood, m.wood, m.wood, m.wood, boardMat, boardMat]);
  board.position.y = 2.25; board.castShadow = true; g.add(board);
  return g;
}

function stele(lines) {
  const m = mats();
  const g = new THREE.Group();
  const tex = textTexture(lines, { w: 256, h: 512, bg: '#5d5a55', fg: '#e8e2d0', border: '#3a3835', sizes: [70, 34] });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  const s = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.35), [m.stone, m.stone, m.stone, m.stone, face, face]);
  s.position.y = 1.3; s.castShadow = true; g.add(s);
  g.add(box(1.5, 0.3, 0.7, m.stoneDark, 0, 0.15, 0));
  return g;
}

function tent(mat) {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(1.3, 1.25, 4, 1, true); geo.rotateY(Math.PI / 4); geo.scale(1.1, 1, 1.6);
  const t = new THREE.Mesh(geo, mat); t.position.y = 0.62; t.castShadow = true; g.add(t);
  return g;
}

function windbreak(radius, arc = Math.PI) {
  const m = mats(); const g = new THREE.Group(); const r = mulberry32(radius * 77 | 0);
  const n = Math.round(radius * arc * 1.2);
  for (let i = 0; i < n; i++) {
    const a = -arc / 2 + (i / (n - 1)) * arc;
    for (let k = 0; k < 2; k++) {
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45 + r() * 0.2, 0), m.stone);
      st.position.set(Math.sin(a) * radius, 0.3 + k * 0.55, Math.cos(a) * radius); st.scale.y = 0.7; st.rotation.set(r(), r(), r());
      st.castShadow = true; g.add(st);
    }
  }
  return g;
}

function planeWreck() {
  const m = mats(); const g = new THREE.Group();
  const fus = cyl(1.2, 1.1, 7, m.alu, 10); fus.rotation.z = Math.PI / 2; fus.rotation.y = 0.4; fus.position.set(0, 0.8, 0); fus.scale.set(1, 1, 0.85); g.add(fus);
  const wing = box(6, 0.15, 1.8, m.alu, 3, 0.4, 3, 0.9); wing.rotation.z = 0.25; g.add(wing);
  const tail = box(0.15, 2, 1.6, m.alu, -4.5, 1.5, -2, 0.4); tail.rotation.x = 0.4; g.add(tail);
  const r = mulberry32(99);
  for (let i = 0; i < 9; i++) { const p = box(0.4 + r() * 1.2, 0.08, 0.3 + r() * 0.8, m.alu, (r() - 0.5) * 14, 0.1, (r() - 0.5) * 12, r() * 3); p.rotation.z = r() - 0.5; g.add(p); }
  return g;
}

// ---------------- 世界：地标与可交互物 ----------------
export class World {
  constructor(scene, rng) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.interactables = [];
    this.shelters = [];
    this.flags = [];
    this.markers = [];
    this.waterState = {};
    this.npcs = [];
    this.rng = rng;
    mats();
    this.build();
  }

  place(obj, x, z, ry = 0, yOff = 0) {
    obj.position.set(x, heightAt(x, z) + yOff, z); obj.rotation.y = ry; this.group.add(obj); return obj;
  }

  build() {
    const m = mats();
    const rng = this.rng;
    ROUTE.forEach((w, i) => {
      const x = w.x, zc = routeZ(x);
      const dir = Math.atan2(-routeDZ(x), 1); // 路线朝向（绕 Y）
      const side = i % 2 === 0 ? 1 : -1;
      const nx = -Math.sin(dir), nz = Math.cos(dir); // 路线法向（z 方向近似）
      const lx = x + nx * 0, lz = zc + side * 9;
      // 标牌
      this.place(signPost(w.name, w.alt), x + 2, zc - side * 4.5, side > 0 ? 0 : Math.PI);
      this.interactables.push({ x: x + 2, z: zc - side * 4.5, r: 3.5, type: 'sign', wp: i, label: `查看：${w.name}` });

      // 水源
      if (w.water !== undefined && w.kind !== 'village' && w.kind !== 'lake') {
        const frozen = season().water <= 0;
        const dry = !frozen && rng() > Math.min(1, w.water * season().water);
        this.waterState[i] = !dry;
        const wx = x - 6, wz = zc + side * 7;
        const pond = new THREE.Mesh(new THREE.CircleGeometry(dry ? 1.6 : 1.9, 20), dry ? m.mud : (season().water <= 0 ? m.ice : waterMaterial(0x13303a)));
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(wx, heightAt(wx, wz) + 0.08, wz);
        this.group.add(pond);
        const c = cairn(0.6); this.place(c, wx + 2.2, wz + 0.5);
        this.interactables.push({ x: wx, z: wz, r: 3.2, type: 'water', wp: i, dry, frozen, label: frozen ? '水源已冻结（凿冰化水）' : dry ? '水源（已干涸）' : '取水' });
      }
      if (w.kind === 'village' || w.kind === 'lake') this.waterState[i] = true;

      switch (w.kind) {
        case 'village': {
          const r = mulberry32(i * 31 + 7);
          for (let k = 0; k < 9; k++) {
            const hx = x + (r() - 0.5) * 70 + (w.end ? 15 : -15), hz = zc + (r() > 0.5 ? 1 : -1) * (14 + r() * 22);
            const hs = house(5 + r() * 3, 4 + r() * 2, 2.8 + r() * 0.6);
            this.place(hs, hx, hz, (r() - 0.5) * 0.6 + (hz > zc ? Math.PI : 0), -0.2);
          }
          // 道路
          const road = new THREE.Mesh(new THREE.PlaneGeometry(120, 5), m.road);
          road.rotation.x = -Math.PI / 2; road.position.set(x + (w.end ? 40 : -50), heightAt(x + (w.end ? 40 : -50), zc) + 0.15, zc);
          this.group.add(road);
          const st = stele(w.end ? ['鹦鸽镇', '终点'] : ['塘口村', '鳌太线严禁穿越']);
          this.place(st, x + (w.end ? -6 : 6), zc + 6, Math.PI / 2);
          if (w.end) {
            // 牌坊
            const gate = new THREE.Group();
            gate.add(box(0.6, 6, 0.6, m.roofRed, -4, 3, 0)); gate.add(box(0.6, 6, 0.6, m.roofRed, 4, 3, 0));
            gate.add(box(10, 0.8, 1, m.roofRed, 0, 6, 0));
            const tex = textTexture(['鹦鸽镇'], { w: 512, h: 128, bg: '#1a2a4a', fg: '#f0d48a', border: '#c9a24a', sizes: [86] });
            const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.1), new THREE.MeshStandardMaterial({ map: tex, emissive: 0x222222, emissiveMap: tex }));
            plate.position.set(0, 5, 0.32); gate.add(plate);
            const plate2 = plate.clone(); plate2.rotation.y = Math.PI; plate2.position.z = -0.32; gate.add(plate2);
            const r2 = curvedRoof(10, 1.4, 0.9, m.roof, 0.5, 0.45); r2.position.y = 6.4; gate.add(r2);
            this.place(gate, x - 12, zc, Math.PI / 2 - dir);
          }
          break;
        }
        case 'temple': {
          const big = w.name === '平安寺';
          const t = temple(big ? 1.5 : 0.85 + (i % 3) * 0.1, big ? m.roofRed : m.roof, { lanterns: big || w.name === '大文公庙', name: w.name, red: big || i % 2 === 0 });
          this.place(t, lx, lz, side > 0 ? Math.PI : 0, -0.25);
          if (big) {
            const t2 = temple(1.1, m.roofRed, { red: true, name: '大雄宝殿', lanterns: true }); this.place(t2, lx + 11, lz + side * 3, side > 0 ? Math.PI : 0, -0.25);
            for (let k = 0; k < 6; k++) this.place(box(3, 1.6, 0.6, m.wall, 0, 0.8, 0), lx - 8 + k * 4, lz - side * 6, 0, 0);
          }
          this.shelters.push({ x: lx, z: lz, r: big ? 6 : 4.2, name: w.name, wp: i });
          this.interactables.push({ x: lx, z: lz, r: big ? 7 : 5, type: 'temple', wp: i, label: big ? '进入平安寺（补给/休息）' : `进入${w.name}避风` });
          if (w.shop) this.interactables.push({ x: lx, z: lz - side * 3, r: 6, type: 'shop', wp: i, label: '向僧人购买补给' });
          break;
        }
        case 'camp': {
          const wb = windbreak(3.4, Math.PI * 1.2); this.place(wb, lx - 4, lz, side > 0 ? 0 : Math.PI);
          const ring = windbreak(0.8, Math.PI * 2); ring.scale.set(0.5, 0.4, 0.5); this.place(ring, lx + 3, lz - side * 2);
          this.shelters.push({ x: lx - 4, z: lz, r: 4, name: w.name, wp: i, weak: true });
          // 其他驴友
          if (rng() < 0.75) {
            const tx = lx + 6, tz = lz + side * 2;
            this.place(tent(rng() > 0.5 ? m.tentO : m.tentG), tx, tz, rng() * 3);
            this.npcs.push({ x: tx + 1.8, z: tz - 1.2, wp: i });
          }
          break;
        }
        case 'tower': {
          const t = navTower(); this.place(t, x + 1, zc + side * 6, 0.3);
          this.flags.push(t.userData.flag);
          for (let k = 0; k < 5; k++) this.place(cairn(0.8 + k * 0.1), x - 4 + k * 2, zc - side * 6);
          break;
        }
        case 'lake': {
          const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r * 1.05, 48), waterMaterial(0x0a2a38));
          water.rotation.x = -Math.PI / 2; water.position.set(LAKE.x, LAKE.y + 0.2, LAKE.z); water.receiveShadow = true;
          this.group.add(water); this.lakeMesh = water;
          const hx = x - 8, hz = zc - 13;
          const hs = house(8, 5, 3, { stone: true, roof: m.roofBlue }); this.place(hs, hx, hz, 0.2, -0.3);
          const st = stele(['大爷海', '海拔 3590 m']); this.place(st, x + 5, zc + 8, Math.PI);
          this.shelters.push({ x: hx, z: hz, r: 6, name: '大爷海', wp: i });
          const fz = season().water <= 0;
          if (fz) water.material = m.ice;
          this.interactables.push({ x: LAKE.x - LAKE.r * 0.35, z: LAKE.z - LAKE.r * 0.8, r: 9, type: 'water', wp: i, dry: false, frozen: fz, label: fz ? '湖面冰封（凿冰化水）' : '在湖边取水' });
          this.interactables.push({ x: hx, z: hz, r: 7, type: 'shop', wp: i, label: '大爷海小卖部（补给）' });
          this.npcs.push({ x: hx + 4, z: hz - 4, wp: i, ranger: true });
          break;
        }
        case 'summit': {
          const plat = cyl(7, 8, 1.2, m.stoneDark, 10); this.place(plat, x, zc, 0, -0.4);
          const t = temple(0.7, m.roof, { name: '太白庙', red: true }); this.place(t, x - 2, zc + 3.5, Math.PI, 0.2);
          const st = stele(['拔仙台', '3771.2 m']); this.place(st, x + 3, zc - 2.5, -Math.PI / 2, 0.2);
          for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28; this.place(cairn(0.7 + (k % 3) * 0.2), x + Math.cos(a) * 9, zc + Math.sin(a) * 9); }
          this.shelters.push({ x: x - 2, z: zc + 3.5, r: 3, name: '拔仙台', wp: i, weak: true });
          break;
        }
        case 'wreck': {
          const pw = planeWreck(); this.place(pw, x + 6, zc + side * 14, 0.7, 0.3);
          this.interactables.push({ x: x + 6, z: zc + side * 14, r: 8, type: 'lore', wp: i, label: '查看飞机残骸', text: '扭曲的铝合金蒙皮上，还能辨认出模糊的编号。几十年来，它一直躺在这里，提醒着每一个路过的人：这座山不讲情面。' });
          break;
        }
        default: {
          for (let k = 0; k < 3; k++) this.place(cairn(0.9 + k * 0.15), x - 3 + k * 2.5, zc + side * 5);
        }
      }
    });

    // 下撤段溪流
    {
      const pts = [];
      for (let x = STREAM.x0 + 30; x <= STREAM.x1 - 30; x += 3) pts.push(x);
      const pos = [], uv = [], idx = [];
      const frozen = season().water <= 0;
      pts.forEach((x, i) => {
        const zc = routeZ(x) + STREAM.off;
        const y = heightAt(x, zc) + (frozen ? 0.5 : 0.55);
        const dz = routeDZ(x); const n = new THREE.Vector2(-dz, 1).normalize();
        for (const s of [-1, 1]) { pos.push(x + n.x * 0 , y, zc + s * 1.45); uv.push(s * 0.5 + 0.5, i * 0.6); }
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const stream = new THREE.Mesh(g, frozen ? m.ice : waterMaterial(0x1a3a3a, 0.9));
      this.group.add(stream);
    }

    // 路标石堆 + 红布条
    const rr = mulberry32(4242);
    for (let x = 12; x < ROUTE_LENGTH - 10; x += 26 + rr() * 14) {
      const wi = nearestWaypoint(x);
      if (Math.abs(ROUTE[wi].x - x) < 14) continue;
      const z = routeZ(x) + (rr() - 0.5) * 4;
      const c = cairn(0.7 + rr() * 0.3);
      this.place(c, x, z, 0, -0.1);
      const stick = cyl(0.03, 0.03, 1.4, m.wood, 4); stick.position.set(x, heightAt(x, z) + 1.2, z); this.group.add(stick);
      const rib = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.14), m.red);
      rib.geometry.translate(0.35, 0, 0);
      rib.position.set(x, heightAt(x, z) + 1.8, z);
      this.group.add(rib);
      this.flags.push(rib);
      this.markers.push({ x, z });
    }

    // 废弃帐篷（遇难者遗物）
    const spots = [0.28, 0.52, 0.66].map(f => ROUTE_LENGTH * (f + (rng() - 0.5) * 0.04));
    for (const sx of spots) {
      const sz = routeZ(sx) + (rng() > 0.5 ? 1 : -1) * (8 + rng() * 10);
      const t = tent(m.tentTorn); t.scale.set(1, 0.55, 1); t.rotation.z = 0.3;
      this.place(t, sx, sz, rng() * 3, -0.2);
      this.interactables.push({ x: sx, z: sz, r: 3.5, type: 'abandoned', label: '查看破损的帐篷', used: false });
    }
  }

  setNight(n) {
    const m = mats();
    m.window.emissiveIntensity = n * 1.6;
    m.lantern.emissiveIntensity = 0.3 + n * 1.8;
  }

  update(dt, t, wind, camPos) {
    // 布条随风飘
    const ang = Math.atan2(wind.y, wind.x);
    const str = Math.min(1, wind.length() / 8);
    for (const f of this.flags) {
      const dx = f.position.x - camPos.x, dz = f.position.z - camPos.z;
      if (dx * dx + dz * dz > 6400) continue;
      f.rotation.y = -ang + Math.sin(t * (4 + str * 8) + f.position.x) * (0.5 - str * 0.35);
      f.rotation.x = Math.sin(t * 6 + f.position.z) * 0.3 * str;
      f.rotation.z = -0.9 * (1 - str) + Math.sin(t * 9 + f.position.x * 2) * 0.12;
    }
  }
}
