// ===================== 天空 / 光照 / 云海 / 地标建筑 / 路标 =====================
import * as THREE from 'three';
import { ROUTE, routeZ, routeDZ, altToY, ROUTE_LENGTH, season } from './data.js';
import { heightAt, LAKE, nearestWaypoint, STREAM } from './terrain.js';
import { mulberry32, clamp, lerp, smoothstep } from './noise.js';
import { surfMat, plainMat, tex, QUAL } from './materials.js';
import { bevelBox, lathe, tube, merge, paint, xf, crease, rockGeo, bakeGroup } from './geo.js';
import { humanMats, buildHuman, buildPack, poseHuman } from './human.js';

// ---------------- 天空 ----------------
const skyVS = `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFS = `
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunColor; uniform vec3 uFogSun;
uniform float uCloud; uniform vec3 uCloudColor; uniform float uTime; uniform float uNight; uniform float uFogMix; uniform float uFlash; uniform float uRainbow; uniform float uEnv;
uniform sampler2D tNoise;
varying vec3 vDir;
float h31(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
// 云的浓度：三层噪声贴图叠起来（大团 + 中等起伏 + 絮状边缘）
float cloudDens(vec2 q){
  return texture2D(tNoise, q).r * 0.62 + texture2D(tNoise, q * 2.9 + 0.71).b * 0.27 + texture2D(tNoise, q * 7.3 + 0.13).g * 0.11;
}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float mu = dot(d, uSunDir);
  float sd = max(mu, 0.0);
  float clear = 1.0 - uCloud * 0.85;
  // —— 晴空：地平线到天顶的渐变；朝太阳一侧亮一些，背着太阳一侧更深 ——
  float t = pow(smoothstep(-0.02, 1.0, h), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  col *= 1.0 + 0.3 * pow(sd, 3.0) * clear - 0.1 * (1.0 - sd) * smoothstep(0.0, 0.5, h);
  // 高处的蓝再浓一点（色调映射会把蓝天洗灰）
  { float sl = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = max(mix(vec3(sl), col, 1.0 + 0.4 * clear * smoothstep(0.0, 0.5, h)), vec3(0.0)); }
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.35, h));
  // 朝太阳方向地平线上的那层暖光（和远山上的雾同一个公式，山和天接得上）
  col += uFogSun * (pow(sd, 6.0) * 0.35 + pow(sd, 40.0) * 0.9) * exp(-max(h, 0.0) * 5.0);
  // 黄昏 / 清晨：太阳对面地平线上一条粉紫色的反暮光带
  float twi = smoothstep(-0.18, 0.02, uSunDir.y) * (1.0 - smoothstep(0.04, 0.3, uSunDir.y));
  col += vec3(0.32, 0.13, 0.2) * twi * exp(-pow((h - 0.1) / 0.09, 2.0)) * pow(max(-mu, 0.0), 2.0) * clear * 0.6;
  // 日晕：太阳周围几层由宽到窄的光
  col += uSunColor * (pow(sd, 6.0) * 0.16 + pow(sd, 40.0) * 0.32 + pow(sd, 400.0) * 0.9) * clear;
  // 月亮与星空
  vec3 md = normalize(vec3(-uSunDir.x, abs(uSunDir.y) * 0.8 + 0.25, -uSunDir.z + 0.3));
  float mdd = dot(d, md);
  float starK = uNight * (1.0 - uCloud) * (1.0 - uEnv);
  col += vec3(0.75, 0.8, 0.95) * (smoothstep(0.9991, 0.9995, mdd) * 2.4 * (1.0 - uEnv) + pow(max(mdd, 0.0), 200.0) * 0.18) * uNight * (1.0 - uCloud);
  if (h > 0.0 && starK > 0.01) {
    vec3 sp = floor(d * 420.0);
    float s = h31(sp);
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + s * 100.0);
    col += mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(s * 71.0)) * step(0.9975, s) * tw * starK * smoothstep(0.0, 0.2, h) * 2.2;
    float mw = exp(-pow(dot(d, normalize(vec3(0.3, 0.6, 0.75))) * 4.0, 2.0));
    col += vec3(0.25, 0.27, 0.35) * mw * (texture2D(tNoise, d.xz * 1.7).r * 0.7 + texture2D(tNoise, d.xz * 5.1).g * 0.5) * starK * 0.3;
  }
  // —— 云 ——
  float cov = 0.0;
  if (h > -0.04) {
    float hh = max(h + 0.09, 0.05);
    vec2 uv = d.xz / hh;
    // 高处的卷云：细长的丝缕，薄薄一层
    vec2 cq = uv * vec2(0.012, 0.045) + vec2(uTime * 0.0006, uTime * 0.0002);
    float cir = smoothstep(0.42, 0.78, texture2D(tNoise, cq).a * 0.7 + texture2D(tNoise, cq * 3.3 + 0.4).r * 0.5) * (1.0 - uCloud) * smoothstep(0.02, 0.25, h) * 0.34;
    col = mix(col, uCloudColor * 0.95 + uSunColor * pow(sd, 5.0) * 0.35, cir);
    // 低处的积云 / 层云
    vec2 q = uv * 0.034 + vec2(uTime * 0.0011, uTime * 0.0004);
    float warp = texture2D(tNoise, q * 0.55 + 0.3).g;
    vec2 qq = q + (warp - 0.5) * 0.11;
    float dens = cloudDens(qq);
    float lo = 0.655 - uCloud * 0.37;
    cov = smoothstep(lo, lo + 0.17, dens + uCloud * 0.05) * smoothstep(-0.04, 0.1, h);
    // 受光：朝太阳方向再采一次浓度，浓度下降的一侧就是迎光面
    vec2 sdir = normalize(uSunDir.xz + vec2(1e-4)) * 0.013;
    float relief = clamp((dens - cloudDens(qq + sdir)) * 7.0 + 0.5, 0.0, 1.0);
    float thick = smoothstep(lo + 0.04, lo + 0.4, dens);
    vec3 shade = uCloudColor * mix(vec3(0.7, 0.74, 0.82), vec3(0.36, 0.39, 0.46), thick * (0.5 + 0.5 * uCloud));
    vec3 lit = uCloudColor * (0.95 + 0.25 * relief) + uSunColor * 0.18 * relief * clear;
    vec3 cc = mix(shade, lit, relief * (1.0 - thick * 0.55));
    // 云边的银边 / 金边，薄云透出来的光
    float rim = cov * (1.0 - cov) * 4.0;
    cc += uSunColor * (rim * pow(sd, 5.0) * 1.3 + pow(sd, 9.0) * 0.5 * (1.0 - thick)) * clear;
    cc += vec3(0.6, 0.7, 1.0) * uFlash * (0.5 + 2.0 * dens * dens);                    // 云里的闪电
    cc = mix(cc, col, exp(-max(h, 0.0) * 8.0) * 0.85);                                  // 远处的云融进地平线
    col = mix(col, cc, cov * 0.97);
  }
  // 太阳本体：很亮（交给泛光去晕开），云后面看不见。环境光采样时不画（那边有平行光）
  float disk = smoothstep(0.99955, 0.99985, mu);
  col += uSunColor * disk * 26.0 * (1.0 - cov * 0.97) * (1.0 - uCloud) * (1.0 - uEnv);
  // 雨后彩虹（反日点 42°）
  if (uRainbow > 0.01 && h > -0.02) {
    float ang = acos(clamp(dot(d, -uSunDir), -1.0, 1.0));
    float t1 = (ang - 0.69) / 0.055;
    if (t1 > 0.0 && t1 < 1.0) {
      float hue = (1.0 - t1) * 0.78;
      vec3 rc = clamp(vec3(abs(hue * 6.0 - 3.0) - 1.0, 2.0 - abs(hue * 6.0 - 2.0), 2.0 - abs(hue * 6.0 - 4.0)), 0.0, 1.0);
      col += rc * sin(t1 * 3.14159) * uRainbow * 0.32 * smoothstep(-0.02, 0.12, h) * (1.0 - uCloud * 0.5);
    }
    float t2 = (ang - 0.88) / 0.06;
    if (t2 > 0.0 && t2 < 1.0) { float hue = t2 * 0.78; vec3 rc = clamp(vec3(abs(hue * 6.0 - 3.0) - 1.0, 2.0 - abs(hue * 6.0 - 2.0), 2.0 - abs(hue * 6.0 - 4.0)), 0.0, 1.0); col += rc * sin(t2 * 3.14159) * uRainbow * 0.1 * smoothstep(0.0, 0.12, h); }
  }
  col = mix(col, uHorizon + uFogSun * (pow(sd, 6.0) * 0.35 + pow(sd, 40.0) * 0.9), uFogMix);
  col += vec3(0.75, 0.8, 1.0) * uFlash * 0.35;
  if (uEnv > 0.5) {
    // 给环境光用的版本：天光去掉三分之一的蓝（不然阴影里一片冷蓝）；地平线以下是地面的暖色反光
    float el = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(el), 0.5);
    vec3 bounce = (uSunColor * max(uSunDir.y, 0.0) * 0.55 + uHorizon * 0.3) * vec3(0.36, 0.32, 0.25);
    col = mix(col, bounce, smoothstep(0.02, -0.22, h));
    col = min(col, vec3(8.0));
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

export class Sky {
  constructor(scene, U) {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color(1, 0.9, 0.7) }, uCloud: { value: 0.2 }, uCloudColor: { value: new THREE.Color(1, 1, 1) },
      uTime: { value: 0 }, uNight: { value: 0 }, uFogMix: { value: 0 }, uFlash: { value: 0 }, uRainbow: { value: 0 },
      uFogSun: U ? U.uFogSun : { value: new THREE.Color(0, 0, 0) }, tNoise: { value: tex('noise').a }, uEnv: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: skyVS, fragmentShader: skyFS, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
    this.mesh.renderOrder = 1000;      // 不透明物体都画完再画天：被山挡住的部分直接跳过
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.scene = scene;
    // 把天空拍成环境贴图：环境光和反光都来自天——阴影里偏蓝，夕阳一侧偏暖，湿地、冰面、金属映出天色
    this.envU = { ...this.uniforms, uEnv: { value: 1 } };
    const envMat = new THREE.ShaderMaterial({ vertexShader: skyVS, fragmentShader: skyFS, uniforms: this.envU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    this.envScene = new THREE.Scene();
    const em = new THREE.Mesh(this.mesh.geometry, envMat); em.frustumCulled = false; this.envScene.add(em);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(QUAL.lite ? 64 : 128, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(1, 4000, this.cubeRT);
    this.pmrem = null; this.pmremRT = null; this.envKey = null; this.envT = 0; this.envOK = true;
  }
  // 天色变了才重拍（太阳走了一两度、云量变了、闪电）。返回是否更新了
  updateEnv(renderer, dt, force) {
    if (!this.envOK) return false;
    this.envT -= dt;
    const u = this.uniforms, s = u.uSunDir.value, z = u.uZenith.value, hc = u.uHorizon.value, sc = u.uSunColor.value;
    const key = [s.x, s.y, s.z].map(v => Math.round(v * 40)).join(',') + '|' + [z.r, z.g, z.b, hc.r, hc.g, hc.b, sc.r, sc.g, sc.b].map(v => Math.round(v * 24)).join(',') + '|' + Math.round(u.uCloud.value * 12) + '|' + Math.round(u.uFogMix.value * 8) + '|' + (u.uFlash.value > 0.3 ? 1 : 0);
    if (!force && (key === this.envKey || this.envT > 0)) return false;
    this.envKey = key; this.envT = QUAL.lite ? 2.5 : 0.7;
    try {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
      const prev = renderer.getRenderTarget();
      this.cubeCam.update(renderer, this.envScene);
      this.pmremRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.pmremRT);
      renderer.setRenderTarget(prev);
      if (this.scene.environment !== this.pmremRT.texture) this.scene.environment = this.pmremRT.texture;
    } catch (e) { console.error('[gfx] 天空环境光采样失败，改用半球光', e); this.envOK = false; this.scene.environment = null; return false; }
    return true;
  }
}

// ---------------- 云海 ----------------
const seaVS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const seaFS = `
uniform float uTime; uniform vec3 uCol; uniform vec3 uShade; uniform float uAlpha; uniform vec3 uCam; uniform vec3 uFogC; uniform float uLo; uniform float uNear;
uniform vec3 uSunDir; uniform vec3 uFogSun; uniform sampler2D tNoise;
varying vec3 vW;
float fbm(vec2 p){ return texture2D(tNoise, p * 0.22).r * 0.62 + texture2D(tNoise, p * 0.64 + 0.37).b * 0.27 + texture2D(tNoise, p * 1.7 + 0.11).g * 0.11; }
void main(){
  vec2 p = vW.xz * 0.004 + vec2(uTime * 0.004, uTime * 0.0015);
  float n = fbm(p) * 0.7 + fbm(p * 3.1 - uTime * 0.01) * 0.3;
  float a = smoothstep(uLo, uLo + 0.22, n) * uAlpha;
  float dist = length(vW.xz - uCam.xz);
  a *= (uNear > 0.5 ? smoothstep(uNear, uNear * 4.0, dist) : 1.0) * smoothstep(2600.0, 1200.0, dist);
  // 云顶的起伏：朝太阳一侧亮、背面暗，一团团鼓起来
  vec2 sdir = normalize(uSunDir.xz + vec2(1e-4)) * 0.035;
  float nS = fbm(p + sdir) * 0.7 + fbm((p + sdir) * 3.1 - uTime * 0.01) * 0.3;
  float relief = clamp((n - nS) * 5.0 + 0.5, 0.0, 1.0);
  vec3 c = mix(uShade * 0.86, uCol * 1.05, smoothstep(0.2, 0.9, relief * 0.75 + smoothstep(uLo, uLo + 0.5, n) * 0.35));
  if (uNear < 0.5) {
    float n3 = fbm(vW.xz * 0.022 + vec2(uTime * 0.003, -uTime * 0.002));
    c = mix(uShade * 0.82, uCol, smoothstep(0.32, 0.68, relief * 0.6 + n3 * 0.5));
  }
  vec3 vd = normalize(vW - uCam);
  float mu = max(dot(vd, uSunDir), 0.0);
  c += uFogSun * (pow(mu, 5.0) * 0.5 + pow(mu, 30.0) * 0.8);
  c = mix(c, uFogC + uFogSun * pow(mu, 6.0) * 0.35, smoothstep(600.0, 2400.0, dist) * 0.7);
  gl_FragColor = vec4(c, a);
}`;

let SHARED_U = null;
export class CloudSea {
  constructor(scene, U) {
    this.uniforms = { uTime: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.7, 0.72, 0.78) }, uAlpha: { value: 0.9 }, uCam: { value: new THREE.Vector3() }, uFogC: { value: new THREE.Color() }, uLo: { value: 0.35 }, uNear: { value: 30 },
      uSunDir: U ? U.uSunDir : { value: new THREE.Vector3(0, 1, 0) }, uFogSun: U ? U.uFogSun : { value: new THREE.Color() }, tNoise: { value: tex('noise').a } };
    const mat = new THREE.ShaderMaterial({ vertexShader: seaVS, fragmentShader: seaFS, uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false, toneMapped: false });
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
  uSunCol: { value: new THREE.Color() }, uFogC: { value: new THREE.Color() }, uFogD: { value: 0.001 }, uDay: { value: 1 }, uRain: { value: 0 },
  tWater: { value: null },
};
const waterVS = `varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const waterFS = `
uniform float uTime; uniform float uFogD; uniform float uDay; uniform float uFlow; uniform float uRain;
uniform vec3 uSkyH; uniform vec3 uSkyZ; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uFogC; uniform vec3 uDeep;
uniform vec4 uShore;      // 圆形水面：xy 圆心(x,z)  z 半径；w > 0 表示启用岸边渐变
uniform sampler2D tWater;
varying vec3 vW; varying vec2 vUv;
vec2 ripple(vec2 p, float t){
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++){
    vec2 q = p * (k == 0 ? 1.3 : 2.1) + float(k) * 17.3;
    vec2 ci = floor(q), cf = q - ci;
    float h1 = fract(sin(dot(ci, vec2(127.1, 311.7))) * 43758.5453), h2 = fract(h1 * 57.31), h3 = fract(h1 * 113.7);
    float ph = fract(t * (0.7 + h3 * 0.5) + h1);
    vec2 dd = cf - (0.25 + 0.5 * vec2(h2, h3));
    float l = length(dd) + 1e-4;
    acc += dd / l * sin((l - ph * 0.45) * 60.0) * smoothstep(0.06, 0.0, abs(l - ph * 0.45)) * (1.0 - ph);
  }
  return acc;
}
void main(){
  // 两层朝不同方向流动的波纹法线
  vec2 n2;
  float foam = 0.0;
  if (uFlow > 0.0) {
    vec2 p = vec2(vUv.x * 1.2, vUv.y * 0.35 - uTime * uFlow * 0.22);
    vec4 a = texture2D(tWater, p), b = texture2D(tWater, p * vec2(2.3, 1.7) + vec2(0.3, -uTime * uFlow * 0.13));
    n2 = ((a.xy + b.xy) - 1.0) * 1.6;
    // 溪水：两岸和石头后面的白沫
    float ed = abs(vUv.x - 0.5) * 2.0;
    foam = smoothstep(0.55, 1.0, ed + (b.a - 0.5) * 0.6) * 0.55 + smoothstep(0.78, 0.98, texture2D(tWater, p * 0.7 + 0.2).b + a.b * 0.35) * 0.5;
  } else {
    vec2 p = vW.xz * 0.11;
    vec4 a = texture2D(tWater, p + vec2(uTime * 0.012, uTime * 0.007)), b = texture2D(tWater, p * 2.7 - vec2(uTime * 0.016, -uTime * 0.01));
    vec4 c = texture2D(tWater, p * 0.31 + vec2(-uTime * 0.004, uTime * 0.006));
    n2 = ((a.xy - 0.5) * 0.9 + (b.xy - 0.5) * 0.6 + (c.xy - 0.5) * 0.7) * 0.9;
  }
  if (uRain > 0.02) n2 += ripple(vW.xz, uTime) * uRain * 0.6;
  vec3 N = normalize(vec3(n2.x, 1.0, n2.y));
  vec3 V = normalize(cameraPosition - vW);
  float nv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  float sd = max(dot(R, uSunDir), 0.0);
  vec3 sky = mix(uSkyH, uSkyZ, pow(clamp(R.y, 0.0, 1.0), 0.5));
  sky += uSunCol * (pow(sd, 12.0) * 0.12 + pow(sd, 90.0) * 0.5);
  // 水体本身的颜色：浅处透出水底，深处发暗发青
  float shore = 1.0, depthK = 1.0;
  if (uShore.w > 0.5) {
    float rr = length(vW.xz - uShore.xy) / uShore.z;
    float wob = (texture2D(tWater, vW.xz * 0.05).b - 0.5) * 0.08;
    shore = 1.0 - smoothstep(0.86, 1.0, rr + wob);
    depthK = 1.0 - smoothstep(0.35, 0.98, rr + wob);
    foam += smoothstep(0.9, 0.99, rr + wob + (texture2D(tWater, vW.xz * 0.35 + uTime * 0.01).a - 0.5) * 0.08) * 0.35 * shore;
  }
  vec3 body = mix(uDeep * vec3(1.6, 2.1, 1.9) + vec3(0.02, 0.035, 0.03), uDeep, depthK) * (0.12 + 0.88 * uDay);
  vec3 col = mix(body, sky, fres);
  // 太阳在水面上碎成一片的反光
  col += uSunCol * (pow(sd, 380.0) * 14.0 + pow(sd, 60.0) * 0.35);
  col = mix(col, vec3(0.85, 0.88, 0.9) * (0.25 + 0.75 * uDay), clamp(foam, 0.0, 1.0));
  float dist = length(cameraPosition - vW);
  col = mix(col, uFogC, 1.0 - exp(-uFogD * uFogD * dist * dist));
  float alpha = (uFlow > 0.0 ? 0.86 : mix(0.55, 0.96, max(depthK, fres))) * shore;
  gl_FragColor = vec4(col, alpha);
}`;
export function waterMaterial(deep, flow = 0, shore = null) {
  WATER_U.tWater.value = tex('water').b;
  return new THREE.ShaderMaterial({
    uniforms: { ...WATER_U, uDeep: { value: new THREE.Color(deep) }, uFlow: { value: flow }, uShore: { value: shore ? new THREE.Vector4(shore[0], shore[1], shore[2], 1) : new THREE.Vector4(0, 0, 1, 0) } },
    vertexShader: waterVS, fragmentShader: waterFS, transparent: true, depthWrite: true, toneMapped: false,
  });
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
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: gloryFS, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
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
export function textTexture(lines, { w = 512, h = 256, bg = '#6b4a2b', fg = '#f3e6c8', font = '"Kaiti SC","STKaiti","KaiTi","Songti SC",serif', sizes = [84, 40], border = '#3d2814', carve = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // 底纹：木牌是顺纹的细线，石碑是凿痕和斑驳
  const r = mulberry32((w * 31 + h * 17 + lines.join('').length * 7) | 0);
  if (carve) {
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + r() * 0.05})`; const s = 1 + r() * 5; g.fillRect(r() * w, r() * h, s, s * (0.4 + r())); }
    for (let i = 0; i < 6; i++) { const gr = g.createRadialGradient(r() * w, r() * h, 2, r() * w, r() * h, 60 + r() * 90); gr.addColorStop(0, 'rgba(40,60,30,0.14)'); gr.addColorStop(1, 'rgba(40,60,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  } else {
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(0,0,0,${0.03 + r() * 0.07})`; g.lineWidth = 0.6 + r() * 2.2; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 8 * (r() - 0.5) * 2, w * 0.6, y - 8 * (r() - 0.5) * 2, w, y + 4); g.stroke(); }
    for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(255,240,210,${0.02 + r() * 0.04})`; g.lineWidth = 0.6 + r(); g.beginPath(); const y = r() * h; g.moveTo(0, y); g.lineTo(w, y + (r() - 0.5) * 10); g.stroke(); }
  }
  g.strokeStyle = border; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const total = lines.length;
  lines.forEach((t, i) => {
    const s = sizes[Math.min(i, sizes.length - 1)];
    let fs = s; g.font = `bold ${fs}px ${font}`;
    while (g.measureText(t).width > w - 40 && fs > 16) { fs -= 4; g.font = `bold ${fs}px ${font}`; }
    const y = total === 1 ? h / 2 : (i === 0 ? h * 0.42 : h * 0.78);
    // 阴刻：字的左上是暗边、右下是亮边
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText(t, w / 2 - 1.5, y - 1.5);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillText(t, w / 2 + 1.5, y + 1.5);
    g.fillStyle = fg; g.fillText(t, w / 2, y);
  });
  const tex2 = new THREE.CanvasTexture(c);
  tex2.colorSpace = THREE.SRGBColorSpace;
  tex2.anisotropy = 8;
  return tex2;
}

// ---------------- 材质 ----------------
const M = {};
let WU = null;
export function initWorldMats(U) { WU = U; }
function mats() {
  if (M.stone) return M;
  const S = (o) => surfMat(WU, o);
  // 石：毛石墙、条石、深色基座
  M.stone = S({ kind: 'masonry', color: 0xb9b2a6, scale: 1.7, bump: 1.5, macro: 0.18 });
  M.stoneDark = S({ kind: 'masonry', color: 0x8f897f, scale: 1.9, bump: 1.5, macro: 0.2 });
  M.slab = S({ kind: 'rock', color: 0xaaa69e, scale: 2.2, bump: 0.7, macro: 0.15 });
  M.stele = S({ kind: 'rock', color: 0x9a968f, scale: 1.4, bump: 0.6, macro: 0.2 });
  M.rock = S({ kind: 'rock', color: 0x9d9a94, scale: 2.6, bump: 1.5, macro: 0.22, vertexColors: true, lichen: 1 });
  // 墙：白灰墙、朱红墙、山墙
  M.wall = S({ kind: 'plaster', color: 0xe6dfd0, scale: 2.4, bump: 1.0, macro: 0.16 });
  M.wallRed = S({ kind: 'plaster', color: 0x9c4a3a, scale: 2.4, bump: 1.2, macro: 0.3 });
  M.gable = S({ kind: 'plaster', color: 0xb0a898, scale: 2.2, bump: 1.0, macro: 0.18, side: THREE.DoubleSide });
  // 木：原木、深色旧木、朱漆柱、彩画额枋、门板
  M.wood = S({ kind: 'wood', color: 0xa87648, scale: 0.9, bump: 1.3, macro: 0.15 });
  M.woodDark = S({ kind: 'wood', color: 0x5e4028, scale: 0.8, bump: 1.3, macro: 0.15 });
  M.log = S({ kind: 'bark', color: 0x7a5a3c, scale: 0.5, bump: 1.2, mapping: 'local', snow: 0.4 });
  M.pillar = S({ kind: 'wood', color: 0xa23a2a, scale: 0.9, bump: 0.6, tex: 0.6, roughness: 0.66 });
  M.beam = S({ kind: 'wood', color: 0x3d7f78, scale: 0.9, bump: 0.6, tex: 0.6, roughness: 0.75 });
  M.beamGold = S({ kind: 'wood', color: 0xd0a542, scale: 0.9, bump: 0.5, tex: 0.5, roughness: 0.5, metalness: 0.35 });
  M.door = S({ kind: 'wood', color: 0x7a2a1c, scale: 0.8, bump: 1.0, tex: 0.8, roughness: 0.8 });
  // 瓦：灰瓦、红瓦、蓝色彩钢瓦（瓦垄是真的几何起伏，贴图管一片压一片和青苔）
  M.roof = S({ kind: 'tile', mapping: 'uv', color: 0x8d9198, scale: 1, bump: 1.2, side: THREE.DoubleSide, snow: 1.15 });
  M.roofRed = S({ kind: 'tile', mapping: 'uv', color: 0xb86a48, scale: 1, bump: 1.2, side: THREE.DoubleSide, snow: 1.15 });
  M.roofBlue = S({ kind: 'tile', mapping: 'uv', color: 0x4f78a8, scale: 1, bump: 0.8, tex: 0.6, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide, snow: 1.15 });
  M.ridge = S({ kind: 'masonry', color: 0x6c6f75, scale: 1.2, bump: 0.8, macro: 0.1 });
  // 金属：锈铁、旧铝皮、铜香炉
  M.metal = S({ kind: 'metal', color: 0x9a6e4e, scale: 1.2, bump: 1.4, metalness: 0.55, roughness: 1.25 });
  M.alu = S({ kind: 'metal', color: 0xc4c9cf, scale: 1.6, bump: 1.6, metalness: 0.85, roughness: 0.95, side: THREE.DoubleSide });
  M.bronze = S({ kind: 'metal', color: 0x6a5a3a, scale: 0.8, bump: 1.2, metalness: 0.7, roughness: 1.1 });
  // 布：经幡、对联、帐篷
  const cloth = (color, extra = {}) => S({ kind: 'fabric', mapping: 'local', color, scale: 0.2, bump: 1.0, tex: 0.7, roughness: 0.95, side: THREE.DoubleSide, ...extra });
  M.red = cloth(0xc8261c, { emissive: 0x300404 });
  M.yellow = cloth(0xd8a81c);
  M.tentO = cloth(0xe0701c, { snow: 0.9 });
  M.tentG = cloth(0x5a8a42, { snow: 0.9 });
  M.tentTorn = cloth(0x66748a, { snow: 0.9 });
  M.tentFly = cloth(0x2c3038);
  M.rope = S({ kind: 'fabric', mapping: 'local', color: 0xd8d0b8, scale: 0.1, bump: 0.6, snow: 0 });
  // 发光的：窗、灯笼、香头
  M.window = S({ kind: 'wood', plain: true, color: 0x1c1a14, emissive: 0xffb050, emissiveIntensity: 0, roughness: 0.3, snow: 0 });
  M.lantern = S({ kind: 'fabric', mapping: 'local', color: 0xc82420, scale: 0.15, bump: 0.8, emissive: 0xff3a1a, emissiveIntensity: 0.3, snow: 0.3 });
  M.incense = S({ kind: 'wood', plain: true, color: 0xb02a1a, emissive: 0x601000, snow: 0 });
  M.ember = new THREE.MeshBasicMaterial({ color: 0xff7a30 });
  // 地面上的东西
  M.mud = S({ kind: 'ground', color: 0x5a4532, scale: 1.4, bump: 1.3, roughness: 0.75 });
  M.ice = S({ kind: 'rock', color: 0xc6dce8, scale: 3, bump: 0.35, tex: 0.25, roughness: 0.22, metalness: 0.1, snow: 0.6 });
  M.road = S({ kind: 'gravel', color: 0x4a4a4c, scale: 1.1, bump: 0.7, tex: 0.8 });
  M.snowOnly = null;
  return M;
}

const sh = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };
function box(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0, bevel = 0.03) {
  const m = new THREE.Mesh(bevelBox(w, h, d, bevel), mat);
  m.position.set(x, y, z); m.rotation.y = ry; return sh(m);
}
function cyl(rt, rb, h, mat, seg = 10) { return sh(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)); }
function at(m, x, y, z, rx = 0, ry = 0, rz = 0) { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; }

// 中式曲面瓦顶：屋脊沿 x，前后坡下凹，四角起翘；瓦垄是真的一垄垄隆起
function curvedRoof(L, D, H, mat, over = 0.6, up = 0.55) {
  const m = mats();
  const g = new THREE.Group();
  const hx = L / 2 + over, hz = D / 2 + over * 0.9;
  const surf = (u, v, s) => [u * hx * (1 + 0.05 * v * Math.pow(Math.abs(u), 3)), H * Math.pow(1 - v, 1.5) + up * Math.pow(Math.abs(u), 7) * v * v + 0.06 * H * v * v * v, s * v * hz];
  const cols = Math.max(8, Math.round(hx * 2 / 0.3)), nu = cols * 4, nv = 8;
  const slope = Math.hypot(hz, H), rows = slope / 0.3;
  const amp = 0.05;
  for (const s of [-1, 1]) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv + 1; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu * 2 - 1, v = Math.min(j, nv) / nv;
      const p = surf(u, v, s);
      const ridge = amp * (0.5 - 0.5 * Math.cos(i / 4 * Math.PI * 2));
      // 最后一排往下折一道：檐口有厚度
      pos.push(p[0], p[1] + ridge - (j > nv ? 0.1 : 0), p[2] - (j > nv ? s * 0.02 : 0));
      uv.push(i / 16, v * rows / 6 + (j > nv ? 0.05 : 0));
    }
    for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (s > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    g.add(sh(new THREE.Mesh(geo, mat)));
    // 垂脊：沿两端坡边压一道
    for (const e of [-1, 1]) {
      const pts = []; for (let k = 0; k <= 6; k++) { const p = surf(e * 0.985, k / 6, s); pts.push([p[0], p[1] + 0.09, p[2]]); }
      g.add(sh(new THREE.Mesh(tube(pts, (t) => 0.085 - t * 0.02, 6, 3), m.ridge)));
    }
  }
  // 正脊与鸱吻
  g.add(box(L + over * 1.2, 0.26, 0.3, m.ridge, 0, H + 0.08, 0, 0, 0.06));
  for (const s of [-1, 1]) {
    const x0 = s * (L / 2 + over * 0.6);
    const horn = new THREE.Mesh(tube([[x0, H + 0.1, 0], [x0 + s * 0.16, H + 0.32, 0], [x0 + s * 0.08, H + 0.56, 0], [x0 - s * 0.1, H + 0.6, 0]], (t) => 0.1 - t * 0.06, 6, 4), m.ridge);
    g.add(sh(horn));
    // 山墙三角
    const shape = new THREE.Shape(); shape.moveTo(-D / 2, 0); shape.lineTo(D / 2, 0); shape.lineTo(0, H * 0.92); shape.closePath();
    const tri = new THREE.Mesh(new THREE.ShapeGeometry(shape), m.gable); tri.rotation.y = Math.PI / 2; tri.position.set(s * L / 2 * 0.985, 0, 0); g.add(sh(tri, false));
    // 悬鱼：山墙顶下挂的一块木饰
    g.add(box(0.06, 0.5, 0.28, m.woodDark, s * (L / 2 + 0.02), H * 0.72, 0, 0, 0.02));
  }
  return g;
}

// 红灯笼：鼓肚、金色上下盖、穗子
function lantern(r = 0.26) {
  const m = mats(); const g = new THREE.Group();
  const body = new THREE.Mesh(lathe([[0.05, 0], [0.16, 0.03], [0.24, 0.14], [0.26, 0.28], [0.24, 0.42], [0.16, 0.53], [0.05, 0.56]].map(([a, b]) => [a * r / 0.26, b * r / 0.26]), 14), m.lantern);
  g.add(sh(body));
  for (const y of [0, 0.56]) g.add(at(cyl(0.07 * r / 0.26, 0.07 * r / 0.26, 0.05, m.beamGold, 10), 0, y * r / 0.26, 0));
  const tas = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 6), m.red); tas.position.y = -0.14; tas.rotation.x = Math.PI; g.add(tas);
  g.add(at(cyl(0.006, 0.006, 0.3, m.woodDark, 4), 0, 0.56 * r / 0.26 + 0.17, 0));
  return g;
}

// 铜香炉：三足鼎，插着三炷香
function burner() {
  const m = mats(); const g = new THREE.Group();
  g.add(sh(new THREE.Mesh(lathe([[0.0, 0.2], [0.2, 0.2], [0.3, 0.28], [0.38, 0.45], [0.42, 0.6], [0.45, 0.63], [0.41, 0.66], [0.36, 0.64], [0.0, 0.62]], 16), m.bronze)));
  for (let k = 0; k < 3; k++) { const a = k / 3 * 6.28; g.add(at(cyl(0.05, 0.035, 0.24, m.bronze, 6), Math.cos(a) * 0.24, 0.12, Math.sin(a) * 0.24)); }
  for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 6, 10, Math.PI), m.bronze); ear.position.set(s * 0.43, 0.66, 0); ear.rotation.y = Math.PI / 2; g.add(sh(ear)); }
  for (let k = 0; k < 3; k++) {
    const st = cyl(0.008, 0.008, 0.42, m.incense, 4); st.position.set(-0.1 + k * 0.1, 0.84, (k - 1) * 0.03); st.rotation.z = (k - 1) * 0.08; st.castShadow = false; g.add(st);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), m.ember); tip.position.set(-0.1 + k * 0.1 - (k - 1) * 0.017, 1.05, (k - 1) * 0.03); g.add(tip);
  }
  g.userData.smoke = [0, 1.08, 0];
  return g;
}

// 檐柱：石础 + 上细下粗的朱漆柱 + 柱头
function column(h, r, mat) {
  const m = mats(); const g = new THREE.Group();
  g.add(sh(new THREE.Mesh(lathe([[r * 1.9, 0], [r * 1.9, 0.06], [r * 1.5, 0.14], [r * 1.3, 0.2]], 12), m.slab)));
  g.add(sh(new THREE.Mesh(lathe([[r * 1.08, 0.2], [r * 1.1, h * 0.3], [r, h * 0.75], [r * 0.9, h - 0.14]], 12), mat)));
  g.add(at(box(r * 3.2, 0.14, r * 3.2, m.beam, 0, 0, 0, 0, 0.02), 0, h - 0.07, 0));
  return g;
}

function temple(size = 1, roofMat, opts = {}) {
  const m = mats();
  const g = new THREE.Group();
  const w = 4.6 * size, d = 3.6 * size, h = 2.5 * size, b = 0.55;
  const wall = opts.red ? m.wallRed : m.stone;
  // 台基：毛石砌 + 一圈压面条石 + 三级踏步
  g.add(box(w + 1.6, b - 0.1, d + 1.8, m.stoneDark, 0, (b - 0.1) / 2, 0.1, 0, 0.05));
  g.add(box(w + 1.76, 0.12, d + 1.96, m.slab, 0, b - 0.06, 0.1, 0, 0.03));
  for (let k = 0; k < 3; k++) g.add(box(w * 0.42 + k * 0.24, 0.18, 0.4, m.slab, 0, 0.09 + (2 - k) * 0.17 - 0.05, d / 2 + 1.12 + k * 0.34, 0, 0.03));
  // 墙：墙脚一道石裙，上面是墙面
  for (const [ww, dd, x, z] of [[w, 0.3, 0, -d / 2 + 0.15], [0.3, d - 0.8, -w / 2 + 0.15, -0.4], [0.3, d - 0.8, w / 2 - 0.15, -0.4]]) {
    g.add(box(ww + 0.06, 0.5, dd + 0.06, m.stoneDark, x, b + 0.25, z, 0, 0.03));
    g.add(box(ww, h - 0.5, dd, wall, x, b + 0.5 + (h - 0.5) / 2, z, 0, 0.02));
  }
  // 前墙（退进成檐廊）带门洞
  const fz = d / 2 - 0.85;
  g.add(box(w * 0.34, h, 0.25, wall, -w * 0.33, b + h / 2, fz, 0, 0.02));
  g.add(box(w * 0.34, h, 0.25, wall, w * 0.33, b + h / 2, fz, 0, 0.02));
  g.add(box(w * 0.32, h * 0.3, 0.25, wall, 0, b + h * 0.85, fz, 0, 0.02));
  // 门框、门槛、两扇半开的门（带门钉和门环）
  g.add(box(w * 0.34, 0.14, 0.3, m.woodDark, 0, b + h * 0.7, fz, 0, 0.02));
  g.add(box(w * 0.34, 0.12, 0.3, m.woodDark, 0, b + 0.06, fz, 0, 0.02));
  for (const s of [-1, 1]) g.add(box(0.12, h * 0.7, 0.3, m.woodDark, s * w * 0.165, b + h * 0.35, fz, 0, 0.02));
  const leaf = (s, ang) => {
    const L = new THREE.Group(); L.position.set(s * w * 0.155, b + 0.12, fz + 0.06); L.rotation.y = s * ang;
    const dw = w * 0.15, dh = h * 0.64;
    L.add(at(box(dw, dh, 0.07, m.door, 0, 0, 0, 0, 0.015), -s * dw / 2, dh / 2, 0));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { const st = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), m.beamGold); st.position.set(-s * dw * (0.25 + i * 0.25), dh * (0.3 + j * 0.16), 0.04); L.add(st); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 5, 10), m.beamGold); ring.position.set(-s * dw * 0.82, dh * 0.5, 0.05); L.add(ring);
    return L;
  };
  g.add(leaf(-1, 0.55)); g.add(leaf(1, 0.25));
  // 檐柱、额枋（彩画）、斗拱（简化成一摞出挑的木块）、檐椽
  const cz = d / 2 - 0.1, cr = 0.11 * size + 0.03;
  for (const px of [-0.42, -0.15, 0.15, 0.42]) {
    const c = column(h, cr, m.pillar); c.position.set(px * w, b, cz); g.add(c);
    for (let k = 0; k < 2; k++) g.add(box(0.2 + k * 0.16, 0.1, 0.26 + k * 0.2, k ? m.beam : m.beamGold, px * w, b + h + 0.05 + k * 0.1, cz + k * 0.08, 0, 0.015));
  }
  g.add(box(w * 0.95, 0.26, 0.2, m.beam, 0, b + h - 0.28, cz, 0, 0.02));
  g.add(box(w * 0.95, 0.07, 0.22, m.beamGold, 0, b + h - 0.45, cz, 0, 0.015));
  g.add(box(w * 0.98, 0.14, 0.22, m.woodDark, 0, b + h + 0.22, cz + 0.12, 0, 0.02));
  const nr = Math.round(w / 0.36);
  for (let k = 0; k <= nr; k++) g.add(box(0.08, 0.08, 0.7 * size, m.woodDark, -w * 0.48 + k * (w * 0.96 / nr), b + h + 0.2, cz + 0.42 * size, 0, 0.012));
  if (opts.name) {
    const tx = textTexture([opts.name], { w: 512, h: 160, bg: '#1d2b3c', fg: '#e9c46a', border: '#b8913a', sizes: [92] });
    const pw = w * 0.3, ph = w * 0.095;
    g.add(box(pw + 0.1, ph + 0.1, 0.06, m.beamGold, 0, b + h * 0.86, fz + 0.15, 0, 0.015));
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), plainMat({ map: tx, roughness: 0.55 }));
    plaque.position.set(0, b + h * 0.86, fz + 0.185); g.add(plaque);
  }
  const r = curvedRoof(w, d, 1.25 * size, roofMat || m.roof, 0.75 * size, 0.55 * size);
  r.position.y = b + h + 0.28; g.add(r);
  const bn = burner(); bn.position.set(0, 0, d / 2 + 2.3); g.add(bn);
  g.userData.smoke = [0, 1.1, d / 2 + 2.3];
  // 柱上的经幡和对联
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.3, 1, 4), m.red); ribbon.position.set(w * 0.42, b + h * 0.55, d / 2 + 0.08); g.add(ribbon);
  const rib2 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 1.1, 1, 4), m.yellow); rib2.position.set(-w * 0.42, b + h * 0.58, d / 2 + 0.08); g.add(rib2);
  if (opts.lanterns) for (const s of [-1, 1]) { const l = lantern(0.28); l.position.set(s * w * 0.28, b + h - 1.0, d / 2 + 0.3); g.add(l); }
  return g;
}

// 山里的民居：石头墙脚、抹灰土墙、露明的木构架、花格窗、对联、柴垛
function house(w, d, h, opts = {}) {
  const m = mats();
  const g = new THREE.Group();
  const wallM = opts.stone ? m.stone : m.wall;
  g.add(box(w + 0.16, 0.6, d + 0.16, m.stoneDark, 0, 0.3, 0, 0, 0.04));
  g.add(box(w, h - 0.6, d, wallM, 0, 0.6 + (h - 0.6) / 2, 0, 0, 0.025));
  // 木构架：四角立柱、檐下横梁、前墙中间的立柱
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.2, h - 0.5, 0.2, m.woodDark, sx * (w / 2 - 0.04), 0.55 + (h - 0.5) / 2, sz * (d / 2 - 0.04), 0, 0.02));
  for (const sz of [-1, 1]) g.add(box(w + 0.1, 0.2, 0.2, m.woodDark, 0, h - 0.1, sz * (d / 2 - 0.02), 0, 0.02));
  for (const sx of [-1, 1]) g.add(box(0.2, 0.2, d + 0.1, m.woodDark, sx * (w / 2 - 0.02), h - 0.1, 0, 0, 0.02));
  const r = curvedRoof(w, d, h * 0.42, opts.roof || m.roof, 0.55, 0.22); r.position.y = h; g.add(r);
  // 檐椽头
  const nr = Math.round(w / 0.45);
  for (let k = 0; k <= nr; k++) g.add(box(0.07, 0.07, 0.5, m.woodDark, -w * 0.47 + k * (w * 0.94 / nr), h - 0.02, d / 2 + 0.3, 0, 0.01));
  for (const s of [-1, 1]) {
    const wx = s * w * 0.27, wy = h * 0.58;
    const win = box(0.9, 0.75, 0.06, m.window, wx, wy, d / 2 + 0.01, 0, 0.01); win.castShadow = false; g.add(win);
    // 窗框 + 花格
    g.add(box(1.06, 0.08, 0.14, m.woodDark, wx, wy + 0.42, d / 2 + 0.04, 0, 0.015));
    g.add(box(1.14, 0.08, 0.2, m.woodDark, wx, wy - 0.42, d / 2 + 0.06, 0, 0.015));
    for (const e of [-1, 1]) g.add(box(0.08, 0.84, 0.14, m.woodDark, wx + e * 0.49, wy, d / 2 + 0.04, 0, 0.015));
    for (let k = -1; k <= 1; k++) g.add(box(0.035, 0.75, 0.05, m.wood, wx + k * 0.22, wy, d / 2 + 0.06, 0, 0.008));
    for (let k = -1; k <= 1; k += 2) g.add(box(0.9, 0.035, 0.05, m.wood, wx, wy + k * 0.19, d / 2 + 0.06, 0, 0.008));
  }
  // 门：门框、两扇门板、门槛、对联和横批
  g.add(box(0.94, 1.75, 0.06, m.door, 0, 0.6 + 0.87, d / 2 + 0.02, 0, 0.012));
  g.add(box(0.03, 1.7, 0.02, m.woodDark, 0, 0.6 + 0.87, d / 2 + 0.06, 0, 0.004));
  for (const e of [-1, 1]) g.add(box(0.1, 1.9, 0.16, m.woodDark, e * 0.52, 0.6 + 0.93, d / 2 + 0.04, 0, 0.015));
  g.add(box(1.16, 0.1, 0.18, m.woodDark, 0, 0.6 + 1.9, d / 2 + 0.04, 0, 0.015));
  g.add(box(1.3, 0.14, 0.4, m.slab, 0, 0.62, d / 2 + 0.22, 0, 0.02));
  for (const s of [-1, 1]) { const cp = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 1.3), m.red); cp.position.set(s * 0.68, 0.6 + 0.95, d / 2 + 0.03); g.add(cp); }
  { const cp = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.2), m.red); cp.position.set(0, 0.6 + 2.08, d / 2 + 0.03); g.add(cp); }
  if (opts.lantern !== false) { const l = lantern(0.2); l.position.set(0.78, h - 0.78, d / 2 + 0.42); g.add(l); }
  // 烟囱
  g.add(box(0.44, 1.1, 0.44, m.stone, w * 0.3, h + 0.6, -d * 0.2, 0, 0.03));
  g.add(box(0.56, 0.1, 0.56, m.slab, w * 0.3, h + 1.18, -d * 0.2, 0, 0.02));
  g.userData.smoke = [w * 0.3, h + 1.3, -d * 0.2];
  // 墙根的柴垛
  const rr = mulberry32((w * 100 + d * 10) | 0);
  if (rr() < 0.75) {
    const sx = (rr() < 0.5 ? -1 : 1) * (w / 2 + 0.38);
    for (let row = 0; row < 3; row++) for (let k = 0; k < 5 - row; k++) {
      const lg = cyl(0.085, 0.09, 0.8 + rr() * 0.15, m.log, 7); lg.rotation.z = Math.PI / 2;      // 横着码，木头截面朝外
      lg.position.set(sx, 0.1 + row * 0.16, -d * 0.3 + (k + row * 0.5) * 0.19); g.add(lg);
    }
  }
  return g;
}

// 导航架：角钢搭的四棱锥铁塔，带斜撑；顶上一面旗
function navTower() {
  const m = mats();
  const g = new THREE.Group();
  const H = 9, B = 2.4;
  const apex = new THREE.Vector3(0, H, 0);
  const corners = [[-B, -B], [B, -B], [B, B], [-B, B]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const up = new THREE.Vector3(0, 1, 0);
  const beam = (a, b, r = 0.07) => {
    const len = a.distanceTo(b);
    const c = sh(new THREE.Mesh(bevelBox(r * 2, len, r * 2, r * 0.3), m.metal));
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    g.add(c);
  };
  for (const c of corners) { beam(c, apex, 0.085); g.add(box(0.7, 0.4, 0.7, m.stoneDark, c.x, 0.1, c.z, 0, 0.05)); }
  let prev = corners;
  for (let lv = 1; lv <= 3; lv++) {
    const t = lv / 4;
    const pts = corners.map(c => c.clone().lerp(apex, t));
    for (let i = 0; i < 4; i++) { beam(pts[i], pts[(i + 1) % 4], 0.05); beam(prev[i], pts[(i + 1) % 4], 0.035); }
    prev = pts;
  }
  const pole = cyl(0.045, 0.05, 3, m.metal, 6); pole.position.y = H + 1.5; g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6, 6, 2), m.red); flag.position.set(0.55, H + 2.6, 0); g.add(flag);
  g.userData.flag = flag; g.userData.keepFlag = true; flag.userData.keep = true;
  return g;
}

// 一摞玛尼堆 / 路标石堆：大石在下、小石在上，每块都略歪
function cairn(s = 1) {
  const m = mats();
  const r = mulberry32((s * 1000) | 0);
  const parts = [];
  let y = 0;
  const n = 5 + ((s * 10) | 0) % 2;
  for (let i = 0; i < n; i++) {
    const sz = (0.52 - i * 0.075) * s;
    const st = ROCKS()[(i + ((s * 7) | 0)) % 3].clone();
    xf(st, { s: [sz * (0.95 + r() * 0.3), sz * 0.6, sz * (0.95 + r() * 0.3)], r: [(r() - 0.5) * 0.25, r() * 6.28, (r() - 0.5) * 0.25], p: [(r() - 0.5) * 0.1 * s, y + sz * 0.16, (r() - 0.5) * 0.1 * s] });
    const tone = 0.8 + r() * 0.35;
    parts.push(paint(st, new THREE.Color(tone, tone * 0.98, tone * 0.95), (c, px, py) => c.multiplyScalar(0.8 + Math.min(0.3, (py - y) * 0.6))));
    y += sz * 0.52;
  }
  const g = new THREE.Group();
  g.add(sh(new THREE.Mesh(merge(parts), m.rock)));
  return g;
}
let _rocks = null;
function ROCKS() { if (!_rocks) _rocks = [0, 1, 2].map(k => rockGeo(500 + k * 13, 1, { cuts: 10 + k * 2, rough: 0.2 })); return _rocks; }

// 路牌：歪斜的旧木桩 + 带边框的木牌 + 牌顶一道小披檐
function signPost(name, alt) {
  const m = mats();
  const g = new THREE.Group();
  g.add(box(0.15, 2.7, 0.13, m.woodDark, 0, 1.35, -0.03, 0, 0.02));
  g.add(box(0.5, 0.26, 0.5, m.rock, 0, 0.08, -0.02, 0.4, 0.08));
  const tx = textTexture([name, alt ? `海拔 ${alt} m` : ''].filter(Boolean));
  const boardMat = plainMat({ map: tx, roughness: 0.85 });
  g.add(box(2.04, 1.04, 0.07, m.wood, 0, 2.25, 0.06, 0, 0.02));
  for (const s of [1, -1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(1.92, 0.92), boardMat); f.position.set(0, 2.25, 0.06 + s * 0.037); if (s < 0) f.rotation.y = Math.PI; g.add(f); }
  g.add(at(box(2.3, 0.05, 0.34, m.woodDark, 0, 0, 0, 0, 0.012), 0, 2.84, 0.06, 0.12, 0, 0));
  for (const s of [-1, 1]) { const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), m.metal); bolt.position.set(s * 0.04, 2.25 + s * 0.3, 0.105); g.add(bolt); }
  g.rotation.z = 0.025;
  return g;
}

// 石碑：圆首碑身 + 碑座
function stele(lines) {
  const m = mats();
  const g = new THREE.Group();
  const W = 1.1, Hh = 2.2, T = 0.3;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, Hh - 0.42);
  shape.absarc(0, Hh - 0.42, W / 2, 0, Math.PI, false); shape.lineTo(-W / 2, 0);
  const body = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
  body.translate(0, 0.32, -T / 2);
  g.add(sh(new THREE.Mesh(body, m.stele)));
  const tx = textTexture(lines, { w: 256, h: 512, bg: '#6f6c66', fg: '#ece6d4', border: '#4a4844', sizes: [70, 34], carve: true });
  const face = plainMat({ map: tx, roughness: 0.9 });
  for (const s of [1, -1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.84, Hh * 0.74), face); f.position.set(0, 0.32 + Hh * 0.43, s * (T / 2 + 0.034)); if (s < 0) f.rotation.y = Math.PI; g.add(f); }
  g.add(box(1.5, 0.22, 0.7, m.stoneDark, 0, 0.11, 0, 0, 0.04));
  g.add(box(1.3, 0.14, 0.52, m.slab, 0, 0.28, 0, 0, 0.03));
  return g;
}

// 帐篷：两根交叉帐杆撑起的穹顶，带门厅、防风绳和地钉
function tent(mat, opts = {}) {
  const m = mats();
  const g = new THREE.Group();
  const A = 1.25, B = 1.75, H = 1.18;                      // 半宽、半长、高
  const pos = [], idx = [];
  const nu = 20, nv = 7;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = i / nu * Math.PI * 2, t = j / nv, e = Math.sin(t * Math.PI / 2), c = Math.cos(t * Math.PI / 2);
    // 帐杆之间的布面略微内凹（被拉紧的样子）
    const sag = 1 - 0.07 * Math.pow(Math.abs(Math.sin(a * 2)), 1.5) * Math.sin(t * Math.PI);
    pos.push(Math.cos(a) * A * c * sag, H * e, Math.sin(a) * B * c * sag);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const dome = new THREE.BufferGeometry();
  dome.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); dome.setIndex(idx); dome.computeVertexNormals();
  g.add(sh(new THREE.Mesh(dome, mat)));
  // 两根交叉的帐杆
  for (const s of [-1, 1]) {
    const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8 * Math.PI; pts.push([Math.cos(t) * A * 0.72 * 1.0, Math.sin(t) * H * 1.02 + 0.01, s * Math.cos(t) * B * 0.72]); }
    g.add(sh(new THREE.Mesh(tube(pts, 0.014, 5, 3), m.tentFly), false));
  }
  // 门厅：一块深色的门帘 + 拉链
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.62, 12, 0, Math.PI), m.tentFly); door.scale.set(1, 1.35, 1);
  door.position.set(0, 0.02, B * 0.93); door.rotation.x = -0.42; g.add(door);
  // 防风绳和地钉
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const a = [sx * A * 0.6, H * 0.62, sz * B * 0.6], b = [sx * (A + 0.8), 0.02, sz * (B + 0.7)];
    g.add(new THREE.Mesh(tube([a, b], 0.006, 4, 1, false), m.rope));
    const peg = cyl(0.012, 0.006, 0.16, m.alu, 4); peg.position.set(b[0], 0.06, b[2]); peg.rotation.z = sx * 0.4; g.add(peg);
  }
  if (opts.glow) g.userData.glow = true;
  return g;
}

// 挡风墙：一圈垒起来的石头
function windbreak(radius, arc = Math.PI) {
  const m = mats(); const r = mulberry32(radius * 77 | 0);
  const n = Math.round(radius * arc * 1.5);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = -arc / 2 + (i / Math.max(1, n - 1)) * arc;
    for (let k = 0; k < 3; k++) {
      const sz = (0.42 - k * 0.07) + r() * 0.16;
      const st = ROCKS()[(i + k) % 3].clone();
      const rr = radius + (r() - 0.5) * 0.25;
      xf(st, { s: [sz, sz * 0.62, sz], r: [(r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4], p: [Math.sin(a + (k % 2) * 0.5 * arc / n) * rr, 0.18 + k * 0.36, Math.cos(a + (k % 2) * 0.5 * arc / n) * rr] });
      const tone = 0.78 + r() * 0.36;
      parts.push(paint(st, new THREE.Color(tone, tone * 0.98, tone * 0.94)));
    }
  }
  const g = new THREE.Group();
  g.add(sh(new THREE.Mesh(merge(parts), m.rock)));
  return g;
}

// 飞机残骸：撕裂的机身筒段（带隔框）、折断的机翼、垂尾、散落的蒙皮碎片
function planeWreck() {
  const m = mats(); const g = new THREE.Group();
  const r = mulberry32(99);
  // 机身：缺了一截弧面的筒，边缘参差
  const fus = new THREE.CylinderGeometry(1.2, 1.08, 7, 22, 6, true, 0.5, Math.PI * 1.55);
  const fp = fus.attributes.position;
  for (let i = 0; i < fp.count; i++) { const k = 1 + (r() - 0.5) * 0.06; fp.setX(i, fp.getX(i) * k); fp.setZ(i, fp.getZ(i) * k * 0.86); if (Math.abs(fp.getY(i)) > 3.4) fp.setY(i, fp.getY(i) + (r() - 0.5) * 0.7); }
  fus.computeVertexNormals();
  const fm = sh(new THREE.Mesh(fus, m.alu)); fm.rotation.set(0, 0.4, Math.PI / 2); fm.position.set(0, 0.85, 0); g.add(fm);
  for (let k = -2; k <= 2; k++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.045, 5, 20, Math.PI * 1.5), m.alu); rib.scale.set(1, 0.86, 1); rib.rotation.set(0, 0.4 + Math.PI / 2, 0.6); rib.position.set(Math.cos(0.4) * k * 1.3, 0.85, -Math.sin(0.4) * k * 1.3); g.add(sh(rib)); }
  // 机翼：前缘圆、越往翼尖越薄，折了一段
  const wing = new THREE.Mesh(bevelBox(6, 0.2, 1.8, 0.09), m.alu); wing.position.set(3, 0.45, 3); wing.rotation.set(0, 0.9, 0.25); g.add(sh(wing));
  const tip = new THREE.Mesh(bevelBox(2.2, 0.14, 1.3, 0.06), m.alu); tip.position.set(5.3, 0.25, 6.2); tip.rotation.set(0.3, 1.5, -0.2); g.add(sh(tip));
  const tail = new THREE.Mesh(bevelBox(0.14, 2.2, 1.6, 0.06), m.alu); tail.position.set(-4.5, 1.4, -2); tail.rotation.set(0.4, 0.4, 0.1); g.add(sh(tail));
  // 发动机整流罩
  const eng = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 1.4, 14, 1, true), m.alu)); eng.rotation.set(0.2, 0, 1.4); eng.position.set(2.2, 0.5, -3.6); g.add(eng);
  for (let i = 0; i < 12; i++) {
    const p = new THREE.Mesh(bevelBox(0.4 + r() * 1.2, 0.05, 0.3 + r() * 0.8, 0.02), m.alu);
    p.position.set((r() - 0.5) * 14, 0.08 + r() * 0.08, (r() - 0.5) * 12); p.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.6); g.add(sh(p));
  }
  return g;
}

// 营火：一圈熏黑的石头、斜搭成锥的柴、底下一摊发红的炭（火舌和烟由粒子特效来画）
export function campfireModel() {
  const m = mats(); const g = new THREE.Group(); const r = mulberry32(7);
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * 6.28 + r() * 0.3, sz = 0.13 + r() * 0.06;
    const st = ROCKS()[i % 3].clone();
    xf(st, { s: [sz, sz * 0.75, sz], r: [0, r() * 6, 0], p: [Math.cos(a) * 0.52, 0.04, Math.sin(a) * 0.52] });
    const tone = 0.7 + r() * 0.3;
    parts.push(paint(st, new THREE.Color(tone, tone * 0.97, tone * 0.93), (c, x, y, z) => { if (Math.hypot(x, z) < 0.5) c.multiplyScalar(0.4); }));     // 朝火的一面熏黑
  }
  g.add(sh(new THREE.Mesh(merge(parts), m.rock)));
  for (let i = 0; i < 6; i++) {
    const arm = new THREE.Group(); arm.rotation.y = i / 6 * Math.PI * 2 + r() * 0.5;
    const lg = cyl(0.03 + r() * 0.02, 0.05 + r() * 0.02, 0.72 + r() * 0.2, m.log, 6);
    lg.position.set(0.19, 0.28, 0); lg.rotation.z = 0.6 + r() * 0.15; arm.add(lg); g.add(arm);
  }
  const ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.6, 0.1) });
  const bed = new THREE.Mesh(new THREE.CircleGeometry(0.3, 14), ember); bed.rotation.x = -Math.PI / 2; bed.position.y = 0.05; g.add(bed);
  g.userData.ember = ember;
  return g;
}

// 驴友 / 护林员：和主角同一套人形。驴友盘腿坐在地上、背包立在身边；护林员站着，戴宽檐帽
export function hikerModel(color, ranger) {
  const g = new THREE.Group();
  if (ranger) {
    const M = humanMats(color, { pants: 0x2c3a30, hat: 0x2a3a2a });
    const H = buildHuman(M, { pack: false, poles: false, hat: 'brim', lamp: false });
    poseHuman(H, { pelvisY: 0.96, spine: 0.03, neck: -0.02, shL: [0.05, 0, -0.1], shR: [0.05, 0, 0.1], elL: -0.25, elR: -0.25, hipL: [-0.02, 0, -0.05], hipR: [0.02, 0, 0.05], knL: 0.05, knR: 0.05 });
    g.add(H.root);
  } else {
    const M = humanMats(color, { hat: [0x8a2a22, 0x2a4a6a, 0x3a3a3a][((color >> 4) & 0xff) % 3], pack: 0x3a5a44 });
    const H = buildHuman(M, { pack: false, poles: false, lamp: false });
    // 坐姿：和主角坐下休息是同一个姿势
    poseHuman(H, { pelvisY: 0.2, spine: 0.3, neck: 0.12, shL: [-0.72, 0, -0.12], shR: [-0.6, 0, 0.12], elL: -1.05, elR: -0.9, hipL: [-1.45, 0, -0.18], hipR: [-1.4, 0, 0.16], knL: 1.75, knR: 1.6, anL: -0.2, anR: -0.2 });
    g.add(H.root);
    // 卸下来的背包立在身边
    const pk = new THREE.Group(); pk.position.set(0.62, 0.34, -0.25); pk.rotation.set(-0.16, 0.5, 0.05);
    const P = buildPack(M, pk);
    P.packBody.position.set(0, 0, 0); P.packLid.position.set(0, 0.31, -0.01); P.packPocket.position.set(0, -0.04, -0.16); P.bottle.position.set(0.165, -0.14, 0); P.padRoll.position.set(0, -0.36, -0.02);
    g.add(pk);
  }
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
    this.waterState = {};
    this.npcs = [];
    this.smokes = [];      // 冒烟的地方：民居烟囱、寺庙香炉（给粒子特效用）
    this.rng = rng;
    mats();
    this.build();
    this.group.traverse(o => { if (o.isMesh && o.castShadow) o.layers.enable(2); });      // 第 2 层：会被画进中距离阴影图
  }

  // 摆一个物件到地面上。静态的建筑会把同材质的零件合并成一个网格，省绘制调用
  place(obj, x, z, ry = 0, yOff = 0, bake = true) {
    const sm = obj.userData.smoke;
    if (bake && obj.children.length > 3) obj = bakeGroup(obj);
    obj.position.set(x, heightAt(x, z) + yOff, z); obj.rotation.y = ry; this.group.add(obj);
    if (sm) { obj.updateMatrixWorld(true); const p = new THREE.Vector3(sm[0], sm[1], sm[2]).applyMatrix4(obj.matrixWorld); this.smokes.push({ x: p.x, y: p.y, z: p.z, kind: sm[1] > 2 ? 'chimney' : 'incense' }); }
    return obj;
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
        const pond = new THREE.Mesh(new THREE.CircleGeometry(dry ? 1.6 : 2.1, 24), dry ? m.mud : (season().water <= 0 ? m.ice : waterMaterial(0x13303a, 0, [wx, wz, 2.1])));
        pond.receiveShadow = true;
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
          road.receiveShadow = true;
          this.group.add(road);
          const st = stele(w.end ? ['鹦鸽镇', '终点'] : ['塘口村', '鳌太线严禁穿越']);
          this.place(st, x + (w.end ? -6 : 6), zc + 6, Math.PI / 2);
          if (w.end) {
            // 牌坊
            const gate = new THREE.Group();
            for (const s of [-1, 1]) {
              const c = column(6, 0.26, m.pillar); c.position.set(s * 4, 0, 0); gate.add(c);
              gate.add(box(1.1, 0.7, 1.1, m.slab, s * 4, 0.3, 0, 0, 0.06));
              gate.add(box(0.5, 0.5, 0.2, m.beam, s * 3.5, 5.3, 0, 0, 0.03));
            }
            gate.add(box(10, 0.55, 0.5, m.beam, 0, 5.75, 0, 0, 0.04));
            gate.add(box(9.4, 0.14, 0.56, m.beamGold, 0, 5.4, 0, 0, 0.02));
            gate.add(box(10.4, 0.3, 0.8, m.woodDark, 0, 6.2, 0, 0, 0.04));
            gate.add(box(4.8, 1.3, 0.3, m.woodDark, 0, 4.9, 0, 0, 0.03));
            const tex = textTexture(['鹦鸽镇'], { w: 512, h: 128, bg: '#1a2a4a', fg: '#f0d48a', border: '#c9a24a', sizes: [86] });
            const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.1), plainMat({ map: tex, emissive: 0x222222, emissiveMap: tex }));
            plate.position.set(0, 4.9, 0.16); gate.add(plate);
            const plate2 = plate.clone(); plate2.rotation.y = Math.PI; plate2.position.z = -0.16; gate.add(plate2);
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
            for (let k = 0; k < 6; k++) {
              const seg = new THREE.Group();
              seg.add(box(3.9, 1.5, 0.5, m.wallRed, 0, 0.75, 0, 0, 0.03)); seg.add(box(4.0, 0.3, 0.62, m.stoneDark, 0, 0.15, 0, 0, 0.03));
              const cap = curvedRoof(3.9, 0.5, 0.26, m.roof, 0.05, 0.02); cap.position.y = 1.5; seg.add(cap);
              this.place(seg, lx - 8 + k * 4, lz - side * 6, 0, -0.1);
            }
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
            this.place(tent(rng() > 0.5 ? m.tentO : m.tentG), tx, tz, rng() * 3, 0, false);
            this.npcs.push({ x: tx + 1.8, z: tz - 1.2, wp: i });
          }
          break;
        }
        case 'tower': {
          const t = this.place(navTower(), x + 1, zc + side * 6, 0.3);
          this.flags.push(t.userData.flag);
          for (let k = 0; k < 5; k++) this.place(cairn(0.8 + k * 0.1), x - 4 + k * 2, zc - side * 6);
          break;
        }
        case 'lake': {
          const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r * 1.08, 64), waterMaterial(0x0a2a38, 0, [LAKE.x, LAKE.z, LAKE.r * 1.08]));
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
          const plat = new THREE.Group();
          plat.add(at(cyl(7, 7.9, 1.2, m.stoneDark, 28), 0, 0.6, 0)); plat.add(at(cyl(7.25, 7.25, 0.14, m.slab, 28), 0, 1.24, 0));
          this.place(plat, x, zc, 0, -1.0, false);
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
        for (const s of [-1, 1]) { pos.push(x + n.x * 0 , y, zc + s * 1.6); uv.push(s * 0.5 + 0.5, i * 0.6); }
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const stream = new THREE.Mesh(g, frozen ? m.ice : waterMaterial(0x1a3a3a, 0.9));
      this.group.add(stream);
    }

    // 废弃帐篷（遇难者遗物）
    const spots = [0.28, 0.52, 0.66].map(f => ROUTE_LENGTH * (f + (rng() - 0.5) * 0.04));
    for (const sx of spots) {
      const sz = routeZ(sx) + (rng() > 0.5 ? 1 : -1) * (8 + rng() * 10);
      const t = tent(m.tentTorn); t.scale.set(1, 0.5, 1.05); t.rotation.z = 0.22;
      this.place(t, sx, sz, rng() * 3, -0.12, false);
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
