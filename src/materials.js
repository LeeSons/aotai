// ===================== 材质系统 =====================
// 1) 开局在显卡上烘焙一套可平铺的程序化 PBR 贴图（颜色 + 高度 / 法线 + 粗糙度 + 缝隙遮蔽）
// 2) 给标准材质注入：三平面贴图（不需要 UV）、法线细节、大尺度色差、积雪、雨湿、风中摆动、
//    叶片透光、随太阳方向变化的大气雾
import * as THREE from 'three';

// 画质相关的全局开关（开局定下来，换档后要刷新页面才会换材质精度）
export const QUAL = { lite: false, texSize: 512, grassHi: true };

export const SHARED = { U: null };
export function makeWeatherUniforms() {
  return SHARED.U = {
    uSnow: { value: 0 },        // 积雪 0..1
    uWet: { value: 0 },         // 地面湿润 0..1
    uRain: { value: 0 },        // 正在下的雨 0..1（水洼涟漪）
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.3, 0) },
    uSnowLine: { value: 500 },  // 积雪起始高度（游戏 y）
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },     // 主光方向（白天太阳，夜里月亮）
    uFogSun: { value: new THREE.Color(0, 0, 0) },       // 朝太阳方向看时雾里多出来的那层暖光
    uHaze: { value: new THREE.Vector4(0, 0.012, 0, 0) }, // 谷底的霾：x 霾顶高度 y 衰减 z 浓度
    tNoise: { value: null },
    // 远距离地形阴影（山体投下的影子）：深度图、世界坐标 → 阴影图坐标的矩阵、x 像素大小 y 深度偏移 z 强度 w 沿法线外推的距离（米）
    tFarSh: { value: null }, uFarShM: { value: new THREE.Matrix4() }, uFarSh: { value: new THREE.Vector4(1 / 1024, 0.0002, 0, 2.4) },
    // 云影：x 云量阈值 y 强度 zw 随风漂移
    uCloudSh: { value: new THREE.Vector4(0.6, 0, 0, 0) },
    // 中距离阴影（近处那张精细阴影图够不着的树、石头、建筑的影子）：用法同上；uMidC = 中心 xyz + 从多远开始接手
    tMidSh: { value: null }, uMidShM: { value: new THREE.Matrix4() }, uMidSh: { value: new THREE.Vector4(1 / 2048, 0.0003, 0, 0.3) }, uMidC: { value: new THREE.Vector4(0, 0, 0, 58) },
  };
}

// ---------------------------------------------------------------- 贴图烘焙
const BAKE_VS = `in vec3 position; out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BAKE_LIB = `precision highp float; precision highp int;
in vec2 vUv; uniform float uTexel; uniform float uBump; uniform float uRaw;
layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;
#define sat(x) clamp(x, 0.0, 1.0)
vec3 hash3(vec2 c, vec2 per, float s){
  c = mod(c, per);
  vec3 p = fract(vec3(c.x, c.y, s) * vec3(0.1031, 0.1030, 0.0973) + vec3(0.11, 0.37, 0.71));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float gn(vec2 p, vec2 per, float s){
  vec2 i = floor(p), f = p - i; vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash3(i, per, s).xy * 2.0 - 1.0, f);
  float b = dot(hash3(i + vec2(1.0, 0.0), per, s).xy * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash3(i + vec2(0.0, 1.0), per, s).xy * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash3(i + vec2(1.0, 1.0), per, s).xy * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// 分形噪声，约 0..1，中心 0.5
float fbm(vec2 uv, vec2 f, int oct, float s){
  float a = 0.5, v = 0.0, t = 0.0;
  for (int i = 0; i < oct; i++){ v += a * gn(uv * f, f, s + float(i) * 7.0); t += a; a *= 0.5; f *= 2.0; }
  return sat(v / t * 1.8 + 0.5);
}
// 细胞噪声：x = 最近距离 y = 次近距离 z、w = 这个格子的两个随机数
vec4 vor(vec2 p, vec2 per, float s){
  vec2 i = floor(p), f = p - i; float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y)); vec3 r = hash3(i + o, per, s); vec2 d = o + r.xy - f; float dd = dot(d, d);
    if (dd < d1){ d2 = d1; d1 = dd; id = vec2(r.z, fract(r.z * 37.0 + r.x * 11.0)); } else if (dd < d2) d2 = dd;
  }
  return vec4(sqrt(d1), sqrt(d2), id);
}
`;
const BAKE_MAIN = `
void main(){
  vec3 c; float h, r, ao; surf(vUv, c, h, r, ao);
  if (uRaw > 0.5) { oA = vec4(c, h); oB = vec4(0.5, 0.5, r, ao); return; }
  vec3 c2; float hx, hy, r2, a2;
  surf(vUv + vec2(uTexel, 0.0), c2, hx, r2, a2);
  surf(vUv + vec2(0.0, uTexel), c2, hy, r2, a2);
  vec3 n = normalize(vec3((h - hx) * uBump, (h - hy) * uBump, 1.0));
  oA = vec4(sqrt(sat(c)), sat(h));
  oB = vec4(n.xy * 0.5 + 0.5, clamp(r, 0.03, 1.0), sat(ao));
}`;

// 每种贴图：tile 一块贴图对应多少米，relief 高低差多少米（决定法线强度）
const KINDS = {};
// 通用噪声：四个通道是四张互不相关的分形噪声（大尺度色差、天空的云都用它）
KINDS.noise = { tile: 1, relief: 0, raw: true, size: 0.5, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  c = vec3(fbm(uv, vec2(4.0), 6, 1.0), fbm(uv, vec2(4.0), 6, 31.0), fbm(uv, vec2(6.0), 5, 61.0));
  float b = 0.0, a = 0.5; vec2 f = vec2(5.0);
  for (int i = 0; i < 5; i++){ b += a * abs(gn(uv * f, f, 91.0 + float(i) * 5.0)); a *= 0.5; f *= 2.0; }
  h = sat(b * 2.6); r = 0.5; ao = 1.0;
}` };
// 花岗岩：晶粒斑点、节理裂隙、一块块高低不同的岩面、铁锈色水渍
KINDS.rock = { tile: 4.2, relief: 0.2, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float big = fbm(uv, vec2(3.0), 5, 1.0), mid = fbm(uv, vec2(9.0), 5, 2.0), fine = fbm(uv, vec2(64.0), 4, 3.0);
  vec2 w = uv + (vec2(fbm(uv, vec2(5.0), 3, 7.0), fbm(uv, vec2(5.0), 3, 8.0)) - 0.5) * 0.045;
  vec4 c1 = vor(w * 3.0, vec2(3.0), 9.0);
  vec4 c2 = vor(w * 7.0 + 3.0, vec2(7.0), 10.0);
  float crack1 = smoothstep(0.028, 0.0, c1.y - c1.x);
  float crack2 = smoothstep(0.02, 0.0, c2.y - c2.x) * smoothstep(0.5, 0.7, mid);
  vec4 g1 = vor(uv * 90.0, vec2(90.0), 11.0);
  vec4 g2 = vor(uv * 210.0 + 5.0, vec2(210.0), 12.0);
  h = 0.48 + (big - 0.5) * 0.45 + (mid - 0.5) * 0.4 + (c1.z - 0.5) * 0.34 + (c2.z - 0.5) * 0.1 + (fine - 0.5) * 0.2 + (0.3 - g1.x) * 0.07;
  h -= crack1 * 0.3 + crack2 * 0.14;
  vec3 col = vec3(0.5, 0.492, 0.478) * (0.74 + 0.46 * big + 0.3 * (mid - 0.5) + (c1.w - 0.5) * 0.16);
  col = mix(col, vec3(0.76, 0.72, 0.66), step(0.74, g1.z) * 0.5);        // 长石（浅色）
  col = mix(col, vec3(0.13, 0.125, 0.125), step(g1.z, 0.13) * 0.75);     // 黑云母
  float quartz = step(0.5, g2.z) * step(g2.z, 0.62);
  col = mix(col, vec3(0.66, 0.67, 0.69), quartz * 0.3);
  float stain = smoothstep(0.56, 0.82, fbm(uv, vec2(4.0, 2.0), 4, 14.0));
  col = mix(col, col * vec3(1.2, 0.97, 0.74), stain * 0.55);              // 铁锈色水渍
  col *= 1.0 - crack1 * 0.5 - crack2 * 0.3;
  c = col; r = 0.9 - quartz * 0.22 + crack1 * 0.08; ao = 1.0 - crack1 * 0.6 - crack2 * 0.3;
}` };
// 草皮 / 土：一丛丛草根、倒伏的草茎、土块、零星小石子（颜色接近中性灰，由地形顶点色来上色）
KINDS.ground = { tile: 2.7, relief: 0.07, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float big = fbm(uv, vec2(3.0), 4, 21.0), mid = fbm(uv, vec2(12.0), 4, 22.0), fine = fbm(uv, vec2(90.0), 3, 23.0);
  // 倒伏的草茎：三个方向各一层短而弯的细丝（先把坐标扭一下，免得出现笔直的长条纹）
  vec2 wq = uv + (vec2(fbm(uv, vec2(9.0), 3, 20.0), fbm(uv, vec2(9.0), 3, 19.0)) - 0.5) * 0.09;
  float fa = fbm(wq, vec2(24.0, 62.0), 3, 24.0);
  float fb = fbm(wq.yx, vec2(27.0, 70.0), 3, 25.0);
  float fc = fbm(vec2(wq.x + wq.y, wq.x - wq.y), vec2(19.0, 52.0), 3, 29.0);
  float fibre = 0.5 + (max(max(fa, fb), fc) - 0.5) * 0.75;
  vec4 cl = vor(uv * 16.0 + (vec2(mid, big) - 0.5) * 2.0, vec2(16.0), 26.0);
  float clump = smoothstep(0.6, 0.1, cl.x) * (0.4 + 0.6 * cl.z);
  vec4 pb = vor(uv * 34.0, vec2(34.0), 27.0);
  float peb = step(pb.z, 0.12) * smoothstep(0.36, 0.2, pb.x);
  h = 0.4 + (big - 0.5) * 0.3 + (mid - 0.5) * 0.3 + clump * 0.24 + (fibre - 0.5) * 0.3 + (fine - 0.5) * 0.1;
  h = mix(h, 0.66 + (1.0 - pb.x * 2.5) * 0.2, peb);
  vec3 col = vec3(0.5) * (0.66 + 0.4 * big + 0.3 * (mid - 0.5) + 0.42 * (fibre - 0.5) + clump * 0.2);
  col *= mix(vec3(1.07, 1.0, 0.88), vec3(0.93, 1.02, 1.05), fbm(uv, vec2(5.0), 3, 28.0));
  float soil = smoothstep(0.42, 0.24, h);
  col = mix(col, col * vec3(0.7, 0.6, 0.5), soil * 0.75);
  col = mix(col, vec3(0.5, 0.49, 0.47) * (0.8 + 0.5 * pb.w), peb * 0.9);
  c = col; r = 0.96 - peb * 0.2; ao = mix(0.55, 1.0, smoothstep(0.18, 0.6, h));
}` };
// 碎石 / 石海地面：沙土里半埋着大小悬殊、带棱角的碎石，大块稀、小块密
KINDS.gravel = { tile: 2.3, relief: 0.16, glsl: `
// 一层碎石：每格一块随机朝向的多边形石头（用三个方向的切面夹出来）。返回 x 石头形状 y 高度 z、w 随机数
vec4 stones(vec2 uv, float f, float seed, float dens){
  vec2 p = uv * f; vec2 i = floor(p), fr = p - i;
  float best = 0.0, bh = 0.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y)); vec3 r = hash3(i + o, vec2(f), seed); vec3 r2 = hash3(i + o, vec2(f), seed + 17.0);
    if (r2.x > dens) continue;
    vec2 d = o + 0.2 + r.xy * 0.6 - fr;
    float sz = 0.2 + 0.42 * r2.y * r2.y;
    float a = r.z * 6.2832; float m = 0.0;
    for (int k = 0; k < 3; k++){ float ak = a + float(k) * 2.0944 + (r2.z - 0.5) * 0.9 * float(k); m = max(m, abs(dot(d, vec2(cos(ak), sin(ak)))) / (sz * (0.75 + 0.5 * fract(r.z * (7.0 + float(k) * 3.0))))); }
    float sh = smoothstep(1.0, 0.82, m);
    float hh = sh * (0.45 + 0.5 * r2.y) * (1.0 - 0.3 * m) + sh * dot(d, vec2(cos(a), sin(a))) * 0.5;       // 顶面略斜
    if (hh > bh){ bh = hh; best = sh; id = vec2(r.z, r2.z); }
  }
  return vec4(best, bh, id);
}
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float fine = fbm(uv, vec2(130.0), 3, 35.0), big = fbm(uv, vec2(3.0), 4, 36.0), mid = fbm(uv, vec2(18.0), 4, 37.0);
  vec4 A = stones(uv, 7.0, 33.0, 0.5);            // 拳头到脸盆大的石块，稀
  vec4 B = stones(uv + 0.31, 17.0, 34.0, 0.7);    // 鸡蛋大的
  vec4 C2 = stones(uv + 0.63, 41.0, 38.0, 0.8);   // 砂砾
  float hs = max(A.y, max(B.y * 0.55, C2.y * 0.22));
  h = 0.12 + (mid - 0.5) * 0.14 + (fine - 0.5) * 0.06 + hs * 0.9;
  vec3 dirt = vec3(0.34, 0.3, 0.25) * (0.7 + 0.5 * fine + 0.3 * (mid - 0.5));
  vec3 cA = mix(vec3(0.4, 0.4, 0.395), vec3(0.66, 0.64, 0.61), A.z) * (0.85 + 0.3 * fbm(uv, vec2(60.0), 3, 39.0));
  cA = mix(cA, cA * vec3(1.14, 1.0, 0.82), step(0.78, A.w));
  cA = mix(cA, cA * vec3(0.9, 1.0, 0.8), step(A.w, 0.16) * 0.8);
  vec3 cB = mix(vec3(0.36), vec3(0.6, 0.59, 0.57), B.z);
  vec3 cC = mix(vec3(0.32), vec3(0.55), C2.z);
  vec3 col = dirt;
  col = mix(col, cC, C2.x * 0.85); col = mix(col, cB, B.x * step(A.y, B.y * 0.55 + 0.001)); col = mix(col, cA, A.x);
  col *= 0.82 + 0.36 * big;
  float st = max(A.x, max(B.x, C2.x * 0.6));
  c = col; r = mix(0.98, 0.84, st); ao = mix(0.5, 1.0, smoothstep(0.1, 0.5, h));
}` };
// 石海：石块一块挨一块把地面盖满——一米多的大块、半米上下的、填缝的碎块，三层叠在一起；石头之间是又深又黑的缝
KINDS.blocks = { tile: 6.1, relief: 0.5, glsl: `
// 一层石块：细胞噪声的每一格是一块石头。keep 以外的格子空着，留给小一号的石头去填。
// 返回 x 石面（0 在石头边上 → 1 在石面上）y 高度 z、w 这块石头的两个随机数
vec4 blk(vec2 uv, float f, float seed, float keep){
  vec2 p = uv * f; vec2 i = floor(p), fr = p - i;
  float d1 = 9.0, d2 = 9.0; vec2 c1 = vec2(0.0); vec3 r1 = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y)); vec3 r = hash3(i + o, vec2(f), seed);
    vec2 d = o + 0.14 + r.xy * 0.72 - fr; float dd = dot(d, d);
    if (dd < d1){ d2 = d1; d1 = dd; c1 = d; r1 = r; } else if (dd < d2) d2 = dd;
  }
  float e = sqrt(d2) - sqrt(d1);
  float on = step(fract(r1.z * 13.7 + r1.x * 3.1), keep);
  float sh = smoothstep(0.03, 0.13, e) * on;
  float a = r1.z * 6.2832;
  float tilt = dot(c1, vec2(cos(a), sin(a))) * (0.2 + 0.5 * fract(r1.x * 5.3));       // 顶面是斜的，每块歪的方向不一样
  float hh = sh * max(0.36 + 0.36 * fract(r1.z * 7.9) + tilt, 0.08);
  return vec4(sh, hh, r1.z, fract(r1.x * 9.1 + r1.y * 5.7));
}
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float fine = fbm(uv, vec2(120.0), 3, 71.0), mid = fbm(uv, vec2(22.0), 4, 72.0), big = fbm(uv, vec2(3.0), 4, 73.0);
  vec2 w = uv + (vec2(fbm(uv, vec2(9.0), 3, 74.0), fbm(uv, vec2(9.0), 3, 75.0)) - 0.5) * 0.014;
  vec4 A = blk(w, 4.0, 76.0, 0.6);             // 一米多的大石块
  vec4 B = blk(w + 0.37, 9.0, 77.0, 0.8);      // 半米上下的
  vec4 C2 = blk(w + 0.71, 21.0, 78.0, 1.0);    // 填缝的碎块
  float hA = A.y, hB = B.y * 0.6, hC = C2.y * 0.32;
  float hs = max(hA, max(hB, hC));
  vec4 S = hA >= hs ? A : (hB >= hs ? B : C2);
  h = sat(0.03 + hs * 0.95 + ((mid - 0.5) * 0.06 + (fine - 0.5) * 0.03) * S.x);
  // 花岗岩：每块深浅不一，少数发黄发锈，少数偏青
  vec3 col = mix(vec3(0.34, 0.34, 0.335), vec3(0.6, 0.59, 0.57), S.z) * (0.84 + 0.3 * (mid - 0.5) + 0.2 * (fine - 0.5));
  col = mix(col, col * vec3(1.16, 1.0, 0.8), step(0.8, S.w) * 0.8);
  col = mix(col, col * vec3(0.88, 0.93, 1.0), step(S.w, 0.2) * 0.7);
  vec4 g1 = vor(uv * 160.0, vec2(160.0), 79.0);
  col = mix(col, vec3(0.72, 0.7, 0.66), step(0.8, g1.z) * 0.3);          // 长石
  col = mix(col, vec3(0.13), step(g1.z, 0.1) * 0.5);                     // 黑云母
  col *= 0.86 + 0.28 * big;
  // 石头的棱边和石头之间的缝：越低越黑（照不到光）
  col *= mix(0.3, 1.0, smoothstep(0.1, 0.6, S.x)) * mix(0.42, 1.0, smoothstep(0.06, 0.42, hs));
  c = col; r = mix(0.98, 0.86, S.x); ao = mix(0.3, 1.0, smoothstep(0.04, 0.45, hs));
}` };
// 树皮：竖向开裂的鳞片状沟槽
KINDS.bark = { tile: 1.1, relief: 0.05, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float warp = fbm(uv, vec2(4.0, 2.0), 3, 41.0) - 0.5;
  vec2 q = vec2(uv.x + warp * 0.11, uv.y);
  vec4 v = vor(q * vec2(16.0, 4.0), vec2(16.0, 4.0), 42.0);
  float furrow = smoothstep(0.0, 0.11, v.y - v.x + (fbm(uv, vec2(30.0, 9.0), 2, 46.0) - 0.5) * 0.05);
  float fine = fbm(uv, vec2(70.0, 9.0), 4, 43.0), flake = fbm(uv, vec2(22.0, 8.0), 3, 44.0);
  h = furrow * (0.5 + 0.3 * v.z) + (fine - 0.5) * 0.3 + (flake - 0.5) * 0.2;
  vec3 col = vec3(0.5) * (0.68 + 0.36 * furrow + 0.46 * (fine - 0.5) + 0.3 * (v.w - 0.5) + 0.2 * (flake - 0.5));
  float moss = smoothstep(0.6, 0.86, fbm(uv, vec2(3.0), 4, 45.0));
  col = mix(col, col * vec3(0.86, 1.12, 0.72), moss * 0.6);
  c = col; r = 0.93; ao = mix(0.4, 1.0, furrow);
}` };
// 树冠：三层朝向各异的椭圆小叶片叠在一起，叶片之间留空（高度低于阈值的地方会被镂空）
KINDS.leaf = { tile: 1.5, relief: 0.1, glsl: `
// 一层叶片：每格一片随机朝向的椭圆叶子。返回 x 叶片形状 0..1  y 明暗  z 色相  w 沿叶脉的坐标
vec4 leafLayer(vec2 uv, float f, float seed){
  vec2 p = uv * f; vec2 i = floor(p), fr = p - i;
  float best = 9.0; vec3 id = vec3(0.0); float mid = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y)); vec3 r = hash3(i + o, vec2(f), seed);
    vec2 d = o + 0.15 + r.xy * 0.7 - fr;
    float a = r.z * 6.2832; vec2 q = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
    float e = length(q / vec2(0.62, 0.3)) + 0.25 * abs(q.x) * abs(q.x);
    if (e < best){ best = e; id = r; mid = q.y; }
  }
  return vec4(smoothstep(1.0, 0.72, best), 0.72 + 0.56 * fract(id.z * 7.1), fract(id.x * 5.3), mid);
}
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float hh = 0.0, tone = 0.6, hue = 0.5, rib = 0.0;
  for (int k = 0; k < 3; k++){
    float f = k == 0 ? 8.0 : (k == 1 ? 11.0 : 15.0);
    vec4 L = leafLayer(uv + float(k) * 0.37, f, 61.0 + float(k) * 9.0);
    float lf = L.x * (1.0 - float(k) * 0.2);
    if (lf > hh){ hh = lf; tone = L.y * (1.0 - float(k) * 0.14); hue = L.z; rib = smoothstep(0.035, 0.0, abs(L.w)); }
  }
  float fine = fbm(uv, vec2(70.0), 3, 66.0);
  h = hh * 0.9 + rib * hh * 0.08 + (fine - 0.5) * 0.06;
  vec3 col = vec3(0.5) * tone * mix(vec3(1.14, 1.03, 0.74), vec3(0.86, 1.0, 1.08), hue) * (1.0 + rib * 0.18);
  col *= mix(0.5, 1.0, smoothstep(0.1, 0.6, hh));
  c = col; r = 0.72; ao = mix(0.3, 1.0, smoothstep(0.0, 0.5, hh));
}` };
// 阔叶枝：一根小枝带两根侧枝，叶子互生、有叶柄和叶脉。透明通道是叶片轮廓（当面片贴图用，不平铺）
KINDS.spray = { tile: 1, relief: 0, raw: true, glsl: `
// 一片叶子：p0 叶柄根部，a 朝向，L 长，W 半宽。返回 x 轮廓 y 沿叶长 0..1 z 横向 -1..1
vec3 leafAt(vec2 uv, vec2 p0, float a, float L, float W){
  vec2 d = uv - p0; float ca = cos(a), sa = sin(a);
  vec2 q = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
  float t = q.x / L;
  if (t < -0.02 || t > 1.02) return vec3(0.0);
  float tt = clamp(t, 0.0, 1.0);
  float w = W * pow(sin(3.14159 * pow(tt, 0.72)), 0.8) * smoothstep(0.0, 0.16, tt) + 0.0045;
  return vec3(smoothstep(0.006, -0.006, abs(q.y) - w), tt, q.y / max(w, 1e-4));
}
float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float mask = 0.0; vec3 col = vec3(0.62, 0.66, 0.5);
  // 三根枝：主枝往上，左右各一根侧枝
  vec2 b0 = vec2(0.5, 0.0), e0 = vec2(0.52, 0.8);
  vec2 b1 = mix(b0, e0, 0.24), e1 = b1 + vec2(-0.3, 0.3);
  vec2 b2 = mix(b0, e0, 0.42), e2 = b2 + vec2(0.29, 0.27);
  float tw = min(segDist(uv, b0, e0), min(segDist(uv, b1, e1), segDist(uv, b2, e2)));
  float twig = smoothstep(0.011, 0.006, tw);
  col = mix(col, vec3(0.42, 0.34, 0.26), twig); mask = twig;
  for (int i = 0; i < 30; i++){
    float fi = float(i); vec3 rn = hash3(vec2(fi, 5.0), vec2(64.0), 131.0);
    int k = i < 13 ? 0 : (i < 22 ? 1 : 2);
    float n = k == 0 ? 13.0 : 9.0, j = k == 0 ? fi : (k == 1 ? fi - 13.0 : fi - 22.0);
    vec2 ba = k == 0 ? b0 : (k == 1 ? b1 : b2), en = k == 0 ? e0 : (k == 1 ? e1 : e2);
    float sgn = mod(j, 2.0) < 0.5 ? 1.0 : -1.0;
    float s2 = (j + 0.8) / n; bool tip = j > n - 1.5;
    vec2 dir = normalize(en - ba); float ta = atan(dir.y, dir.x);
    vec2 p0 = mix(ba, en, tip ? 1.0 : s2);
    float la = tip ? ta + (rn.x - 0.5) * 0.3 : ta + sgn * (1.05 - 0.45 * s2) + (rn.x - 0.5) * 0.35;
    float L = (0.2 + 0.07 * rn.y) * (1.0 - 0.38 * s2) * (k == 0 ? 1.0 : 0.82);
    vec3 lf = leafAt(uv, p0, la, L, L * (0.27 + 0.06 * rn.z));
    if (lf.x > 0.01){
      float tone = 0.66 + 0.34 * rn.z;
      vec3 lc = vec3(tone * (0.9 + 0.16 * rn.x), tone, tone * (0.72 + 0.26 * rn.y));
      lc *= 0.86 + 0.14 * lf.y;                                              // 叶根略深
      lc *= 1.0 + 0.16 * smoothstep(0.1, 0.0, abs(lf.z));                    // 主脉
      lc *= 1.0 - 0.1 * smoothstep(0.75, 0.55, abs(fract(lf.y * 6.0 + abs(lf.z) * 1.6) - 0.5) * 2.0) * step(0.12, abs(lf.z));   // 侧脉
      col = mix(col, lc, lf.x); mask = max(mask, lf.x);
    }
  }
  c = col; h = mask; r = 0.7; ao = 1.0;
}` };
// 针叶枝：羽状的一枝，主轴两侧一排排小枝，小枝上密生针叶
KINDS.bough = { tile: 1, relief: 0, raw: true, glsl: `
// 一根带针叶的小枝：返回 x 轮廓 y 明暗
vec2 needles(vec2 uv, vec2 a, vec2 b, float nl){
  vec2 ba = b - a; float L = length(ba); vec2 dir = ba / L; vec2 pa = uv - a;
  float u = dot(pa, dir), d = abs(dot(pa, vec2(-dir.y, dir.x)));
  if (u < -0.01 || u > L + nl * 0.6) return vec2(0.0);
  float t = clamp(u / L, 0.0, 1.0);
  float len = nl * (1.0 - 0.55 * t * t) * smoothstep(-0.01, 0.05, u);
  float tip = u > L ? smoothstep(nl * 0.6, 0.0, u - L) : 1.0;
  float st = abs(fract((u - d * 0.75) * 46.0) - 0.5) * 2.0;                // 斜向前的一根根针
  float m = smoothstep(len, len * 0.55, d) * tip * smoothstep(0.95, 0.5, st);
  float twig = smoothstep(0.007, 0.003, d) * step(0.0, u) * step(u, L);
  return vec2(max(m, twig), mix(0.62 + 0.38 * st, 0.5, twig));
}
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  vec2 b0 = vec2(0.5, 0.0), e0 = vec2(0.5, 0.9);
  vec2 best = needles(uv, b0, e0, 0.06);
  for (int k = 0; k < 8; k++){
    float fk = float(k), s2 = 0.08 + fk * 0.105;
    vec3 rn = hash3(vec2(fk, 2.0), vec2(32.0), 141.0);
    vec2 p0 = mix(b0, e0, s2);
    float L = (0.44 * (1.0 - s2 * 0.8) + 0.06) * (0.9 + 0.2 * rn.x);
    for (int sd = 0; sd < 2; sd++){
      float sg = sd == 0 ? -1.0 : 1.0;
      float a = 1.5708 + sg * (0.95 - 0.22 * s2 + (rn.y - 0.5) * 0.16);
      vec2 n2 = needles(uv, p0, p0 + vec2(cos(a), sin(a)) * L, 0.05 * (1.0 - 0.3 * s2));
      if (n2.x > best.x) best = n2;
    }
  }
  float fine = fbm(uv, vec2(40.0), 2, 143.0);
  c = vec3(0.86, 1.0, 0.82) * best.y * (0.9 + 0.2 * fine); h = best.x; r = 0.7; ao = 1.0;
  if (best.x < 0.02) c = vec3(0.6, 0.7, 0.56);
}` };
// 旧木板：竖排木板，顺纹、年轮、木节、干裂、风化发灰
KINDS.wood = { tile: 1.3, relief: 0.022, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float n = 6.0; float px = uv.x * n; float id = floor(px); float fx = px - id;
  vec3 rr = hash3(vec2(id, 0.0), vec2(n, 1.0), 51.0);
  float seam = smoothstep(0.0, 0.04, fx) * smoothstep(1.0, 0.96, fx);
  vec2 g = vec2(fx * 0.25 + rr.x * 3.0, uv.y);
  float grain = fbm(g, vec2(48.0, 3.0), 4, 53.0 + id);
  float wav = fbm(g, vec2(6.0, 2.0), 3, 54.0 + id) - 0.5;
  float ring = sin((fx + wav * 0.8) * 38.0) * 0.5 + 0.5;
  vec2 kd = vec2(fx - (0.3 + rr.z * 0.4), fract(uv.y - rr.x + 0.5) - 0.5) * vec2(1.0, 2.6);
  float knot = smoothstep(0.17, 0.02, length(kd)) * step(0.5, rr.y);
  float crackW = smoothstep(0.8, 0.92, grain) * smoothstep(0.45, 0.75, fbm(uv, vec2(3.0, 2.0), 2, 55.0));
  h = 0.55 + (grain - 0.5) * 0.34 + (ring - 0.5) * 0.1 - crackW * 0.32 - knot * 0.12 + (rr.z - 0.5) * 0.12;
  h = mix(0.06, h, seam);
  float t = 0.6 + 0.5 * grain + 0.16 * ring + (rr.z - 0.5) * 0.34;
  vec3 col = vec3(0.5) * t;
  col = mix(col, col * vec3(0.55, 0.5, 0.46), max(knot, crackW));
  float grey = smoothstep(0.4, 0.75, fbm(uv, vec2(2.0, 3.0), 4, 56.0));
  col = mix(col, vec3(dot(col, vec3(0.333))) * vec3(1.06, 1.05, 1.02), grey * 0.5);  // 风化发灰
  col *= mix(0.45, 1.0, seam);
  c = col; r = 0.84 + grey * 0.1; ao = mix(0.4, 1.0, seam) * (1.0 - crackW * 0.5);
}` };
// 抹灰土墙：细砂粒、水渍、发丝裂缝、剥落露出的夯土
KINDS.plaster = { tile: 2.6, relief: 0.03, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float big = fbm(uv, vec2(2.0), 5, 71.0), mid = fbm(uv, vec2(10.0), 4, 72.0), fine = fbm(uv, vec2(140.0), 3, 73.0);
  vec2 w = uv + (vec2(fbm(uv, vec2(6.0), 3, 74.0), fbm(uv, vec2(6.0), 3, 75.0)) - 0.5) * 0.12;
  vec4 cr = vor(w * 3.0, vec2(3.0), 76.0);
  float crack = smoothstep(0.012, 0.002, cr.y - cr.x) * smoothstep(0.42, 0.6, fbm(uv, vec2(3.0), 2, 77.0));
  float chip = smoothstep(0.8, 0.85, fbm(uv, vec2(4.0), 4, 78.0) + (mid - 0.5) * 0.16 + (fine - 0.5) * 0.06);
  float streak = fbm(uv, vec2(40.0, 2.0), 3, 79.0);
  h = 0.62 + (mid - 0.5) * 0.14 + (fine - 0.5) * 0.14 - crack * 0.3;
  h = mix(h, 0.32 + (fine - 0.5) * 0.4 + (mid - 0.5) * 0.2, chip);
  vec3 col = vec3(0.5) * (0.84 + 0.26 * big + 0.12 * (mid - 0.5));
  col *= 1.0 - smoothstep(0.55, 0.85, streak) * 0.16;                     // 雨水冲刷的竖向水渍
  col = mix(col, vec3(0.36, 0.3, 0.24) * (0.8 + 0.5 * fine), chip);        // 剥落后露出的夯土
  col *= 1.0 - crack * 0.55;
  c = col; r = mix(0.9, 0.98, chip); ao = 1.0 - crack * 0.5 - chip * 0.15;
}` };
// 毛石墙：大小不一的石块 + 凹进去的灰缝
KINDS.masonry = { tile: 2.2, relief: 0.1, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  vec2 w = uv + (vec2(fbm(uv, vec2(7.0), 2, 81.0), fbm(uv, vec2(7.0), 2, 82.0)) - 0.5) * 0.035;
  vec4 a = vor(w * vec2(5.0, 9.0), vec2(5.0, 9.0), 83.0);
  float e = a.y - a.x;
  float st = smoothstep(0.035, 0.13, e);
  float fine = fbm(uv, vec2(110.0), 3, 84.0), mid = fbm(uv, vec2(18.0), 4, 85.0), big = fbm(uv, vec2(2.0), 4, 86.0);
  float face = 0.6 + (a.z - 0.5) * 0.3 + (mid - 0.5) * 0.3 + (fine - 0.5) * 0.12;
  h = mix(0.12 + fine * 0.1, face, st);
  vec3 stone = mix(vec3(0.38, 0.37, 0.36), vec3(0.62, 0.6, 0.56), a.w) * (0.84 + 0.32 * mid);
  stone = mix(stone, stone * vec3(1.14, 1.0, 0.82), step(0.75, fract(a.w * 5.3)));
  stone = mix(stone, stone * vec3(0.84, 1.02, 0.76), smoothstep(0.62, 0.85, big) * 0.5);   // 背阴处的青苔
  vec3 mortar = vec3(0.34, 0.31, 0.27) * (0.8 + 0.4 * fine);
  c = mix(mortar, stone, st) * (0.86 + 0.28 * big);
  r = mix(0.98, 0.86, st); ao = mix(0.4, 1.0, smoothstep(0.0, 0.5, st));
}` };
// 屋瓦：一垄垄筒瓦，一片压一片（u 横向 4 垄，v 沿坡 6 片）
KINDS.tile = { tile: 1.0, relief: 0.06, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float cols = 4.0, rows = 6.0;
  float cx = uv.x * cols, ci = floor(cx), fx = cx - ci;
  float ry = uv.y * rows, ri = floor(ry), fy = ry - ri;
  vec3 rr = hash3(vec2(ci, ri), vec2(cols, rows), 91.0);
  float ridge = sin(fx * 3.14159);                                        // 筒瓦隆起
  float lap = fy;                                                          // 上一片压着下一片：越往下越厚
  float fine = fbm(uv, vec2(90.0), 3, 92.0), mid = fbm(uv, vec2(12.0), 4, 93.0);
  h = 0.25 + ridge * 0.45 + lap * 0.2 + (fine - 0.5) * 0.08 + (rr.x - 0.5) * 0.06;
  h *= smoothstep(0.0, 0.05, fy);                                          // 片与片之间的台阶
  vec3 col = vec3(0.5) * (0.74 + 0.4 * rr.y + 0.2 * (mid - 0.5) + ridge * 0.14);
  float moss = smoothstep(0.62, 0.86, fbm(uv, vec2(3.0, 4.0), 4, 94.0) + (1.0 - ridge) * 0.14);
  col = mix(col, col * vec3(0.78, 1.08, 0.62), moss * 0.6);
  col *= mix(0.5, 1.0, smoothstep(0.0, 0.12, fy)) * mix(0.7, 1.0, smoothstep(0.0, 0.3, ridge));
  c = col; r = 0.72 + moss * 0.2 - ridge * 0.1; ao = mix(0.5, 1.0, smoothstep(0.0, 0.4, ridge)) * mix(0.6, 1.0, smoothstep(0.0, 0.15, fy));
}` };
// 布料：细密的平纹 + 防撕裂格
KINDS.fabric = { tile: 0.22, relief: 0.004, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float n = 48.0;
  float wx = sin(uv.x * n * 6.28318), wy = sin(uv.y * n * 6.28318);
  float chk = step(0.0, sin(uv.x * n * 3.14159) * sin(uv.y * n * 3.14159));
  float weave = mix(wx, wy, chk) * 0.5 + 0.5;
  vec2 gq = abs(fract(uv * 6.0) - 0.5);
  float rip = smoothstep(0.46, 0.49, max(gq.x, gq.y));
  float fine = fbm(uv, vec2(40.0), 3, 101.0), mid = fbm(uv, vec2(5.0), 3, 102.0);
  h = 0.4 + weave * 0.3 + rip * 0.25 + (fine - 0.5) * 0.1;
  c = vec3(0.5) * (0.9 + 0.12 * weave + 0.12 * (mid - 0.5) + rip * 0.08 + (fine - 0.5) * 0.08);
  r = 0.8 - rip * 0.1; ao = 0.82 + weave * 0.18;
}` };
// 旧铝皮 / 铁件：蒙皮接缝、成排铆钉、划痕、凹坑、氧化斑
KINDS.metal = { tile: 1.6, relief: 0.012, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  vec2 pg = uv * vec2(2.0, 4.0); vec2 pf = fract(pg); vec2 pe = min(pf, 1.0 - pf);
  float seam = smoothstep(0.0, 0.018, min(pe.x * 0.5, pe.y * 0.25));
  vec2 rq = fract(uv * vec2(24.0, 4.0)) - 0.5; vec2 rq2 = fract(uv * vec2(2.0, 32.0)) - 0.5;
  float rivet = max(smoothstep(0.16, 0.08, length(rq * vec2(1.0, 6.0))) * step(abs(pf.y - 0.5), 0.47) * step(0.42, abs(pf.y - 0.5)),
                    smoothstep(0.16, 0.08, length(rq2 * vec2(12.0, 1.0))) * step(0.44, abs(pf.x - 0.5)));
  float big = fbm(uv, vec2(2.0), 5, 111.0), mid = fbm(uv, vec2(9.0), 4, 112.0), fine = fbm(uv, vec2(160.0), 2, 113.0);
  float scr = smoothstep(0.78, 0.9, fbm(uv, vec2(3.0, 150.0), 3, 114.0)) + smoothstep(0.82, 0.92, fbm(uv, vec2(120.0, 5.0), 3, 115.0));
  float ox = smoothstep(0.55, 0.8, fbm(uv, vec2(5.0), 5, 116.0) + (1.0 - seam) * 0.25);
  h = 0.5 + (big - 0.5) * 0.4 + rivet * 0.4 - (1.0 - seam) * 0.35 - scr * 0.06 + ox * (fine - 0.5) * 0.3;
  vec3 col = vec3(0.5) * (0.9 + 0.2 * (mid - 0.5) + scr * 0.2);
  col = mix(col, col * vec3(0.78, 0.74, 0.7), ox * 0.6);
  col *= mix(0.5, 1.0, seam);
  c = col; r = 0.42 + ox * 0.4 + (mid - 0.5) * 0.2 - scr * 0.1; ao = mix(0.5, 1.0, seam);
}` };
// 水面：几层尖峰的小波浪（只用法线）
KINDS.water = { tile: 3.0, relief: 0.12, glsl: `
void surf(vec2 uv, out vec3 c, out float h, out float r, out float ao){
  float s = 0.0, a = 0.5; vec2 f = vec2(4.0);
  for (int i = 0; i < 5; i++){
    vec2 q = uv + vec2(float(i) * 0.37, float(i) * 0.11);
    float v = 1.0 - abs(gn(q * f, f, 121.0 + float(i) * 3.0) * 2.0);
    s += a * v * v; a *= 0.5; f *= 2.0;
  }
  h = sat(s); c = vec3(fbm(uv, vec2(6.0), 4, 127.0)); r = 0.05; ao = 1.0;
}` };

const TEX = {};
function flatTex(r, g, b, a) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
const FLAT_A = flatTex(181, 181, 181, 128), FLAT_B = flatTex(128, 128, 217, 255);
export function tex(kind) { return TEX[kind] || { a: FLAT_A, b: FLAT_B }; }

export function bakeTextures(renderer, U) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(geo); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const aniso = Math.min(QUAL.lite ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  const prev = renderer.getRenderTarget();
  try {
    for (const kind in KINDS) {
      const K = KINDS[kind];
      const sz = Math.max(64, Math.round(QUAL.texSize * (K.size || 1)));
      const rt = new THREE.WebGLRenderTarget(sz, sz, {
        count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
        generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: aniso, colorSpace: THREE.NoColorSpace,
      });
      const mat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: BAKE_VS, fragmentShader: BAKE_LIB + K.glsl + BAKE_MAIN,
        uniforms: { uTexel: { value: 1 / sz }, uBump: { value: K.relief ? K.relief * sz / K.tile : 1 }, uRaw: { value: K.raw ? 1 : 0 } },
        depthTest: false, depthWrite: false,
      });
      mesh.material = mat;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      TEX[kind] = { a: rt.textures[0], b: rt.textures[1], rt };
      mat.dispose();
    }
  } catch (e) {
    console.error('[gfx] 贴图烘焙失败，改用纯色材质', e);
  }
  renderer.setRenderTarget(prev);
  geo.dispose();
  if (U) U.tNoise.value = tex('noise').a;
  return TEX;
}

// ---------------------------------------------------------------- 着色器片段
const VERT_PARS = `
uniform float uTime; uniform vec2 uWind;
varying vec3 vAtW; varying vec3 vAtP;
#ifdef AT_LOCAL
varying vec3 vAtAx; varying vec3 vAtAy;
#endif
#ifdef AT_UV
varying vec2 vAtUv;
#endif
#ifdef AT_TERRAIN
attribute vec4 aTer; varying vec4 vAtT;
#endif
`;
const FRAG_PARS = `
uniform float uSnow, uWet, uSnowLine, uTime, uRain;
uniform vec3 uSunDir; uniform vec3 uFogSun; uniform vec4 uHaze;
uniform sampler2D tA, tB, tNoise;
uniform vec4 uAt;      // x 每米多少块贴图  y 法线强度  z 贴图颜色的权重  w 大尺度色差
uniform vec4 uAt2;     // x 积雪系数  y 雨湿系数  z 透光  w 备用
varying vec3 vAtW; varying vec3 vAtP;
#ifdef AT_LOCAL
varying vec3 vAtAx; varying vec3 vAtAy;
#endif
#ifdef AT_UV
varying vec2 vAtUv;
#endif
#ifdef AT_TERRAIN
uniform sampler2D tRA, tRB, tGA, tGB, tKA, tKB;
varying vec4 vAtT;
#endif
uniform sampler2D tFarSh; uniform mat4 uFarShM; uniform vec4 uFarSh; uniform vec4 uCloudSh;
uniform sampler2D tMidSh; uniform mat4 uMidShM; uniform vec4 uMidSh; uniform vec4 uMidC;
vec3 atN = vec3(0.0, 0.0, 1.0); float atAO = 1.0; float atRough = 1.0; float atSnow = 0.0; float atPud = 0.0; float atSun = 1.0;
// 这一点照不照得到太阳：被远处的山挡住了没有（远距离地形阴影图）、头顶有没有云飘过（云影）
float atSunVis(vec3 wp, vec3 n){
  float lit = 1.0;
  if (uFarSh.z > 0.003) {
    vec4 sc = uFarShM * vec4(wp + n * uFarSh.w, 1.0);
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      float z = sc.z - uFarSh.y;
      #ifdef AT_LITE
        float s = step(z, texture2D(tFarSh, sc.xy).r);
      #else
        vec2 st = sc.xy / uFarSh.x - 0.5; vec2 f = fract(st); vec2 b = (floor(st) + 0.5) * uFarSh.x;
        float s00 = step(z, texture2D(tFarSh, b).r), s10 = step(z, texture2D(tFarSh, b + vec2(uFarSh.x, 0.0)).r);
        float s01 = step(z, texture2D(tFarSh, b + vec2(0.0, uFarSh.x)).r), s11 = step(z, texture2D(tFarSh, b + vec2(uFarSh.x)).r);
        float s = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
      #endif
      vec2 e = min(sc.xy, 1.0 - sc.xy);
      lit = mix(1.0, s, uFarSh.z * smoothstep(0.0, 0.06, min(e.x, e.y)));
    }
  }
  #ifndef AT_LITE
  if (uMidSh.z > 0.003) {
    // 近处（精细阴影图管得到的范围）不用它，往外渐渐接手
    float dk = smoothstep(uMidC.w * 0.78, uMidC.w, distance(wp.xz, uMidC.xz));
    vec4 sc = uMidShM * vec4(wp + n * uMidSh.w, 1.0);
    if (dk > 0.003 && sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      float z = sc.z - uMidSh.y;
      vec2 st = sc.xy / uMidSh.x - 0.5; vec2 f = fract(st); vec2 b = (floor(st) + 0.5) * uMidSh.x;
      float s00 = step(z, texture2D(tMidSh, b).r), s10 = step(z, texture2D(tMidSh, b + vec2(uMidSh.x, 0.0)).r);
      float s01 = step(z, texture2D(tMidSh, b + vec2(0.0, uMidSh.x)).r), s11 = step(z, texture2D(tMidSh, b + vec2(uMidSh.x)).r);
      float s = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
      vec2 e = min(sc.xy, 1.0 - sc.xy);
      lit *= mix(1.0, s, uMidSh.z * dk * smoothstep(0.0, 0.1, min(e.x, e.y)));
    }
  }
  #endif
  if (uCloudSh.y > 0.003) {
    vec2 q = (wp.xz + uSunDir.xz * (900.0 / max(uSunDir.y, 0.25))) * 0.00034 + uCloudSh.zw;
    float dens = texture2D(tNoise, q).r * 0.62 + texture2D(tNoise, q * 2.9 + 0.71).b * 0.27 + 0.055;
    lit *= 1.0 - uCloudSh.y * smoothstep(uCloudSh.x, uCloudSh.x + 0.14, dens);
  }
  return lit;
}
float atH13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// 雨点打在水洼里的一圈圈涟漪：返回水面法线在 xz 上的偏移
vec2 atRipple(vec2 p, float t){
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++){
    vec2 q = p * (k == 0 ? 3.1 : 4.7) + float(k) * 17.3;
    vec2 ci = floor(q), cf = q - ci;
    float h1 = fract(sin(dot(ci, vec2(127.1, 311.7))) * 43758.5453), h2 = fract(h1 * 57.31), h3 = fract(h1 * 113.7);
    float ph = fract(t * (0.7 + h3 * 0.5) + h1);
    vec2 d = cf - (0.25 + 0.5 * vec2(h2, h3));
    float l = length(d) + 1e-4;
    float ring = sin((l - ph * 0.45) * 60.0) * smoothstep(0.06, 0.0, abs(l - ph * 0.45)) * (1.0 - ph);
    acc += d / l * ring;
  }
  return acc;
}
`;
const FOG_FN = `
#ifdef USE_FOG
vec3 atFog(vec3 c){
  #ifdef FOG_EXP2
    float fd = fogDensity * vFogDepth;
    // 谷底的空气更浑：霾顶以下，越往下越浓
    float hz = exp(-max(vAtW.y - uHaze.x, 0.0) * uHaze.y);
    float f = 1.0 - exp(-fd * fd - uHaze.z * vFogDepth * hz * hz);
  #else
    float f = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  vec3 vdir = normalize(vAtW - cameraPosition);
  float mu = max(dot(vdir, uSunDir), 0.0);
  vec3 fc = fogColor + uFogSun * (pow(mu, 6.0) * 0.35 + pow(mu, 40.0) * 0.9);
  return mix(c, fc, f);
}
#endif
`;
// 三平面采样：算出 ta（颜色+高度）、tb（法线+粗糙度+遮蔽）和扰动后的世界法线 pN
const SAMPLE_TRI = `
  vec4 ta, tb; vec3 pN;
  #if defined(AT_UV)
  {
    vec2 uv0 = vAtUv * uAt.x;
    ta = texture2D(tA, uv0); tb = texture2D(tB, uv0);
    vec2 tn = (tb.xy * 2.0 - 1.0) * uAt.y;
    vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition); vec2 st0 = dFdx(uv0), st1 = dFdy(uv0);
    vec3 q1p = cross(q1, gVN), q0p = cross(gVN, q0);
    vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
    float det = max(dot(T, T), dot(B, B)); float sc = det == 0.0 ? 0.0 : inversesqrt(det);
    pN = inverseTransformDirection(normalize(T * (tn.x * sc) + B * (tn.y * sc) + gVN), viewMatrix);
  }
  #else
  {
    #ifdef AT_LOCAL
      vec3 ax = normalize(vAtAx), ay = normalize(vAtAy), az = normalize(cross(ax, ay));
      vec3 mN = vec3(dot(gWN, ax), dot(gWN, ay), dot(gWN, az));
    #else
      vec3 mN = gWN;
    #endif
    vec3 q = vAtP * uAt.x;
    vec3 mP;
    #ifdef AT_LITE
    {
      vec3 an = abs(mN); vec3 dpx = dFdx(q), dpy = dFdy(q); vec2 t2;
      if (an.x > an.y && an.x > an.z) { ta = textureGrad(tA, q.zy, dpx.zy, dpy.zy); tb = textureGrad(tB, q.zy, dpx.zy, dpy.zy); t2 = (tb.xy * 2.0 - 1.0) * uAt.y; mP = mN + vec3(0.0, t2.y, t2.x); }
      else if (an.y > an.z) { ta = textureGrad(tA, q.xz, dpx.xz, dpy.xz); tb = textureGrad(tB, q.xz, dpx.xz, dpy.xz); t2 = (tb.xy * 2.0 - 1.0) * uAt.y; mP = mN + vec3(t2.x, 0.0, t2.y); }
      else { ta = textureGrad(tA, q.xy, dpx.xy, dpy.xy); tb = textureGrad(tB, q.xy, dpx.xy, dpy.xy); t2 = (tb.xy * 2.0 - 1.0) * uAt.y; mP = mN + vec3(t2.x, t2.y, 0.0); }
      mP = normalize(mP);
    }
    #else
    {
      vec3 w3 = pow(abs(mN), vec3(4.0)); w3 /= (w3.x + w3.y + w3.z);
      vec4 xa = texture2D(tA, q.zy), ya = texture2D(tA, q.xz), za = texture2D(tA, q.xy);
      vec4 xb = texture2D(tB, q.zy), yb = texture2D(tB, q.xz), zb = texture2D(tB, q.xy);
      ta = xa * w3.x + ya * w3.y + za * w3.z;
      tb = xb * w3.x + yb * w3.y + zb * w3.z;
      vec2 tx = (xb.xy * 2.0 - 1.0) * uAt.y, ty = (yb.xy * 2.0 - 1.0) * uAt.y, tz = (zb.xy * 2.0 - 1.0) * uAt.y;
      mP = normalize(mN + vec3(0.0, tx.y, tx.x) * w3.x + vec3(ty.x, 0.0, ty.y) * w3.y + vec3(tz.x, tz.y, 0.0) * w3.z);
    }
    #endif
    #ifdef AT_LOCAL
      pN = normalize(ax * mP.x + ay * mP.y + az * mP.z);
    #else
      pN = mP;
    #endif
  }
  #endif
`;
// 普通物体的表面
const SURF_GENERIC = `
{
  #ifdef FLAT_SHADED
    vec3 gVN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  #else
    vec3 gVN = normalize(vNormal);
    #if defined(DOUBLE_SIDED) && !defined(AT_NOFLIP)
      gVN *= gl_FrontFacing ? 1.0 : -1.0;
    #endif
  #endif
  #if defined(USE_ALPHATEST) && !defined(ALPHA_TO_COVERAGE)
    if (diffuseColor.a < alphaTest) discard;        // 镂空的像素尽早丢掉，后面的光照就不用算了
  #endif
  vec3 gWN = inverseTransformDirection(gVN, viewMatrix);
  #ifdef AT_PLAIN
    vec4 ta = vec4(0.7071, 0.7071, 0.7071, 0.5), tb = vec4(0.5, 0.5, 1.0, 1.0); vec3 pN = gWN;
  #else
  ${SAMPLE_TRI}
  #endif
  #ifdef AT_CUT
    // 叶片之间镂空：近处看得见一片片叶子的轮廓，远处贴图糊成一片就自然闭合了
    if (ta.a < uAt2.w) discard;
    // 从叶缝里看到的是树冠另一侧的背面：压暗，像树冠内部
    if (!gl_FrontFacing) diffuseColor.rgb *= 0.5;
  #endif
  diffuseColor.rgb *= mix(vec3(1.0), ta.rgb * ta.rgb * 2.0, uAt.z);
  #ifndef AT_NOMACRO
  {
    vec2 mq = vAtP.xz + vAtP.y * 0.37;
    float m1 = texture2D(tNoise, mq * 0.013).r, m2 = texture2D(tNoise, mq * 0.071 + 0.31).g;
    diffuseColor.rgb *= 1.0 + (m1 * 0.65 + m2 * 0.35 - 0.5) * 2.0 * uAt.w;
  }
  #endif
  atRough = tb.b; atAO = tb.a;
  #ifdef AT_LICHEN
  {
    vec2 lq = vAtP.xz + vAtP.y * vec2(0.31, 0.57);
    float ln = texture2D(tNoise, lq * 0.19).r * 0.55 + texture2D(tNoise, lq * 0.83 + 0.4).g * 0.45;
    float lm = smoothstep(0.55, 0.62, ln + (ta.a - 0.5) * 0.12) * smoothstep(-0.25, 0.45, gWN.y);
    float lw = smoothstep(0.52, 0.58, texture2D(tNoise, lq * 0.47 + 0.7).b + (ta.a - 0.5) * 0.1) * smoothstep(0.1, 0.7, gWN.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.5, 0.44) * (0.75 + 0.5 * ta.a), lw * 0.5);          // 灰白地衣
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4, 0.4, 0.14) * (0.7 + 0.6 * ta.a), lm * 0.62);          // 黄绿地衣
  }
  #endif
  #ifdef AT_SNOW
  {
    float up = smoothstep(0.55, 0.85, gWN.y * 0.7 + pN.y * 0.3);
    float line = smoothstep(uSnowLine - 25.0, uSnowLine + 25.0, vAtW.y);
    float sn = clamp(uSnow * 1.3 - (1.0 - up) * 0.9, 0.0, 1.0) * line;
    sn *= smoothstep(0.25, 0.6, texture2D(tNoise, vAtW.xz * 0.017).b * 0.6 + uSnow * 0.7);
    sn = clamp(sn * (1.25 - ta.a * 0.5 * (1.0 - sn)), 0.0, 1.0) * uAt2.x;      // 先填低处，凸起的地方最后才盖住
    atSnow = sn;
    diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - uWet * 0.38 * uAt2.y), vec3(0.9, 0.93, 0.98), sn);
    pN = normalize(mix(pN, gWN, sn * 0.7));
    atRough = mix(atRough, 0.62, sn); atAO = mix(atAO, 1.0, sn * 0.7);
  }
  #else
    diffuseColor.rgb *= 1.0 - uWet * 0.3 * uAt2.y;
  #endif
  atN = normalize((viewMatrix * vec4(pN, 0.0)).xyz);
  atSun = atSunVis(vAtW, gWN);
}
`;
// 地形：草皮、碎石、岩壁三层按坡度 / 地段 / 贴图高度混合，再加水洼
const SURF_TERRAIN = `
{
  vec3 gVN = normalize(vNormal);
  vec3 gWN = inverseTransformDirection(gVN, viewMatrix);
  vec3 wp = vAtW;
  float vd = length(vViewPosition);
  float nearK = 1.0 - smoothstep(60.0, 220.0, vd);
  vec4 nz1 = texture2D(tNoise, wp.xz * 0.0031), nz2 = texture2D(tNoise, wp.xz * 0.027 + 0.37);
  float n1 = nz1.r, n2 = nz2.g, n3 = nz2.b, n4 = nz1.a;
  // —— 草皮 / 土 ——
  vec2 gu = wp.xz / 2.7;
  vec4 ga = texture2D(tA, gu), gb = texture2D(tB, gu);
  vec3 gAlb = ga.rgb * ga.rgb * 2.0;
  #ifndef AT_LITE
    vec4 ga2 = texture2D(tA, gu * 0.131 + 0.5);                 // 二十米一轮的大色块：远看不重复
    gAlb = mix(vec3(1.0), gAlb, 0.35 + 0.65 * nearK) * mix(vec3(1.0), ga2.rgb * ga2.rgb * 2.0, 0.6);
  #endif
  // —— 碎石 ——
  vec2 su = wp.xz / 2.3 + 0.21;
  vec4 sa = texture2D(tGA, su), sb = texture2D(tGB, su);
  // —— 石海：石块一块挨一块，把地面盖满（只在石海里才取这几张图）——
  float bk = 0.0; vec3 kC = vec3(0.0);
  vec2 kdx = dFdx(wp.xz), kdy = dFdy(wp.xz);
  vec2 lq = wp.xz + wp.y * vec2(0.31, 0.57); vec2 ldx = dFdx(lq), ldy = dFdy(lq);
  if (vAtT.w > 0.004) {
    vec2 ku = wp.xz / 6.1 + 0.13;
    vec4 ka = textureGrad(tKA, ku, kdx / 6.1, kdy / 6.1), kb = textureGrad(tKB, ku, kdx / 6.1, kdy / 6.1);
    #ifndef AT_LITE
    {
      // 转个角度、换个大小再铺一层，按大尺度噪声在两层之间切换：看不出贴图在重复，石头也有大有小
      mat2 kr = mat2(0.8, -0.6, 0.6, 0.8);
      vec2 ku2 = kr * wp.xz / 8.3 + 0.61, k2x = kr * kdx / 8.3, k2y = kr * kdy / 8.3;
      vec4 ka2 = textureGrad(tKA, ku2, k2x, k2y), kb2 = textureGrad(tKB, ku2, k2x, k2y);
      kb2.xy = (kb2.xy - 0.5) * kr + 0.5;
      float km = smoothstep(0.42, 0.58, n3 + (ka2.a - ka.a) * 0.3);
      ka = mix(ka, ka2, km); kb = mix(kb, kb2, km);
    }
    #endif
    bk = smoothstep(0.2, 0.7, vAtT.w + (ka.a - 0.5) * 0.5 + (n2 - 0.5) * 0.3);
    kC = ka.rgb * ka.rgb * 2.0 * (diffuseColor.rgb * 0.55 + vec3(0.3, 0.297, 0.29)) * (0.84 + 0.32 * n2);
    #ifndef AT_LITE
    {
      // 石面上的地衣：和散落的大石头用同一张分布图，地上的石块和立起来的石头连成一片
      float ln = textureGrad(tNoise, lq * 0.19, ldx * 0.19, ldy * 0.19).r * 0.55 + textureGrad(tNoise, lq * 0.83 + 0.4, ldx * 0.83, ldy * 0.83).g * 0.45;
      float face = smoothstep(0.25, 0.5, ka.a);
      float lm = smoothstep(0.55, 0.62, ln + (ka.a - 0.5) * 0.12) * face;
      float lw = smoothstep(0.52, 0.58, textureGrad(tNoise, lq * 0.47 + 0.7, ldx * 0.47, ldy * 0.47).b + (ka.a - 0.5) * 0.1) * face;
      kC = mix(kC, vec3(0.5, 0.5, 0.44) * (0.75 + 0.5 * ka.a), lw * 0.5);
      kC = mix(kC, vec3(0.4, 0.4, 0.14) * (0.7 + 0.6 * ka.a), lm * 0.62);
    }
    #endif
    sa.a = mix(sa.a, ka.a, bk); sb = mix(sb, vec4((kb.xy - 0.5) * 1.5 + 0.5, kb.zw), bk);
  }
  // —— 岩壁（两个侧面 + 顶面投影）——
  vec3 rq = wp / 4.2;
  vec4 ra, rb; vec3 rN;
  #ifdef AT_LITE
  {
    // 轻量模式：只按朝向取一个侧面投影（陡坡才用得上岩壁）
    vec3 dpx = dFdx(rq), dpy = dFdy(rq); vec2 t2;
    if (abs(gWN.x) > abs(gWN.z)) { ra = textureGrad(tRA, rq.zy, dpx.zy, dpy.zy); rb = textureGrad(tRB, rq.zy, dpx.zy, dpy.zy); t2 = rb.xy * 2.0 - 1.0; rN = normalize(gWN + vec3(0.0, t2.y, t2.x) * 1.5); }
    else { ra = textureGrad(tRA, rq.xy, dpx.xy, dpy.xy); rb = textureGrad(tRB, rq.xy, dpx.xy, dpy.xy); t2 = rb.xy * 2.0 - 1.0; rN = normalize(gWN + vec3(t2.x, t2.y, 0.0) * 1.5); }
  }
  #else
  {
    vec3 w3 = pow(abs(gWN), vec3(4.0)); w3 /= (w3.x + w3.y + w3.z);
    vec4 rxa = texture2D(tRA, rq.zy), rza = texture2D(tRA, rq.xy), rya = texture2D(tRA, rq.xz);
    vec4 rxb = texture2D(tRB, rq.zy), rzb = texture2D(tRB, rq.xy), ryb = texture2D(tRB, rq.xz);
    ra = rxa * w3.x + rya * w3.y + rza * w3.z; rb = rxb * w3.x + ryb * w3.y + rzb * w3.z;
    vec2 rtx = rxb.xy * 2.0 - 1.0, rty = ryb.xy * 2.0 - 1.0, rtz = rzb.xy * 2.0 - 1.0;
    rN = normalize(gWN + (vec3(0.0, rtx.y, rtx.x) * w3.x + vec3(rty.x, 0.0, rty.y) * w3.y + vec3(rtz.x, rtz.y, 0.0) * w3.z) * 1.5);
  }
  #endif
  #ifndef AT_LITE
    // 远山的大块岩面：几十米一轮的法线，远处的山不再是光溜溜的
    vec4 rfar = texture2D(tRB, wp.xz / 61.0 + 0.3);
    vec2 rf = rfar.xy * 2.0 - 1.0;
  #endif
  // —— 各层的比例 ——
  float slope = 1.0 - clamp(gWN.y, 0.0, 1.0);
  float rk = smoothstep(0.2, 0.36, slope + (n1 - 0.5) * 0.2 + (n3 - 0.5) * 0.08 + (ra.a - ga.a) * 0.14 * nearK);
  float st = smoothstep(0.3, 0.62, vAtT.x + (sa.a - 0.45) * 0.55 + (n2 - 0.5) * 0.35) * (1.0 - rk);
  st = mix(st, 1.0 - rk, bk);
  float path = (1.0 - smoothstep(0.55, 1.9 + (n2 - 0.5) * 1.6, abs(vAtT.y) + (ga.a - 0.5) * 0.9)) * vAtT.z * (1.0 - rk);
  vec3 vc = diffuseColor.rgb;
  float dn = n2 * 0.45 + n3 * 0.35 + n1 * 0.2;
  vec3 base = vc * (0.8 + dn * 0.38);
  base = mix(base, base * vec3(1.25, 1.12, 0.8), smoothstep(0.62, 0.85, n3) * 0.5);       // 枯草 / 新绿斑块
  base *= gAlb;
  // 踩出来的小路：踩实的黄土，嵌着小石子
  vec3 pathC = vec3(0.36, 0.295, 0.215) * (0.75 + 0.5 * n2) * (0.55 + 0.9 * sa.rgb * sa.rgb) * mix(vec3(1.0), gAlb, 0.5);
  base = mix(base, pathC, path * 0.85);
  vec3 stC = mix(sa.rgb * sa.rgb * 2.0 * (vc * 0.5 + vec3(0.15, 0.148, 0.142)), kC, bk);
  base = mix(base, stC, st);
  vec3 rockC = vec3(0.29, 0.285, 0.275) * (0.72 + n2 * 0.35 + n4 * 0.2) * (ra.rgb * ra.rgb * 2.0);
  rockC = mix(rockC, rockC * vec3(1.05, 1.03, 0.82), smoothstep(0.55, 0.8, n1) * 0.6);     // 地衣
  rockC = mix(rockC, vc * 0.8, 0.22);
  diffuseColor.rgb = mix(base, rockC, rk);
  // —— 法线 ——
  vec2 gt = (gb.xy * 2.0 - 1.0) * (0.9 + 0.5 * (1.0 - path)), stn = (sb.xy * 2.0 - 1.0) * 1.3;
  vec2 fl = mix(gt, stn, st) * (0.25 + 0.75 * nearK);
  vec3 pN = normalize(gWN + vec3(fl.x, 0.0, fl.y));
  pN = normalize(mix(pN, rN, rk));
  #ifndef AT_LITE
    pN = normalize(pN + vec3(rf.x, 0.0, rf.y) * (0.25 + 0.6 * rk) * smoothstep(20.0, 160.0, vd));
  #endif
  atRough = mix(mix(gb.b, sb.b, st), rb.b, rk);
  atAO = mix(1.0, mix(mix(ga.a * 0.8 + 0.45, sb.a, st), rb.a, rk), 0.4 + 0.6 * nearK);
  // —— 积雪 ——
  {
    float up = smoothstep(0.55, 0.85, gWN.y * 0.75 + pN.y * 0.25);
    float line = smoothstep(uSnowLine - 25.0, uSnowLine + 25.0, wp.y);
    float sn = clamp(uSnow * 1.3 - (1.0 - up) * 0.9, 0.0, 1.0) * line;
    sn *= smoothstep(0.25, 0.6, texture2D(tNoise, wp.xz * 0.017).b * 0.6 + uSnow * 0.7);
    float hgt = mix(mix(ga.a, sa.a, st), ra.a, rk);
    sn = clamp(sn * (1.3 - hgt * 0.7 * (1.0 - sn) * nearK), 0.0, 1.0);
    atSnow = sn;
    // —— 雨后的水洼：平地、低洼处先积水 ——
    float pud = 0.0;
    #ifndef AT_LITE
      float low = 1.0 - smoothstep(0.34, 0.5, mix(ga.a, sa.a * 0.8, st) + (n2 - 0.5) * 0.5);
      pud = low * smoothstep(0.45, 0.95, uWet) * smoothstep(0.93, 0.985, gWN.y) * (1.0 - rk) * (1.0 - sn) * (1.0 - smoothstep(40.0, 90.0, vd));
      atPud = pud;
    #endif
    vec3 wetC = diffuseColor.rgb * (1.0 - uWet * 0.38);
    wetC = mix(wetC, wetC * vec3(0.5, 0.52, 0.56), pud);
    diffuseColor.rgb = mix(wetC, vec3(0.9, 0.93, 0.98), sn);
    pN = normalize(mix(pN, gWN, max(sn * 0.72, pud)));
    #ifndef AT_LITE
      if (pud > 0.02 && uRain > 0.02) { vec2 rp = atRipple(wp.xz, uTime) * uRain * pud * 0.7; pN = normalize(pN + vec3(rp.x, 0.0, rp.y)); }
    #endif
    atRough = mix(mix(atRough, 0.62, sn), 0.04, pud); atAO = mix(atAO, 1.0, max(sn * 0.7, pud));
  }
  atN = normalize((viewMatrix * vec4(pN, 0.0)).xyz);
  atSun = atSunVis(wp, gWN);
}
`;
const ROUGH_FRAG = `
  roughnessFactor = clamp(roughnessFactor * atRough * mix(1.0, 0.5, uWet * uAt2.y * (1.0 - atSnow)), 0.03, 1.0);
  #if defined(AT_SNOW) || defined(AT_TERRAIN)
  if (atSnow > 0.25) {
    // 雪面的冰晶闪光：只在近处，随视角一闪一闪
    vec3 sp = floor(vAtW * 70.0);
    float gl = atH13(sp), fw = length(fwidth(vAtW)) * 70.0;
    roughnessFactor = mix(roughnessFactor, 0.1, step(0.972, gl) * atSnow * clamp(1.6 - fw, 0.0, 1.0));
  }
  #endif
  #ifdef AT_TERRAIN
    roughnessFactor = mix(roughnessFactor, 0.035, atPud);
  #endif
`;
// 叶片 / 草：背光透亮 + 漫反射包裹
const TRANS_FN = `
#ifdef AT_TRANS
void RE_Direct_AT( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float nl = dot( geometryNormal, directLight.direction );
  float wrap = clamp( ( nl + 0.55 ) / 1.55, 0.0, 1.0 ) - clamp( nl, 0.0, 1.0 );      // 明暗交界处软一点
  float back = pow( clamp( dot( geometryViewDir, - directLight.direction ), 0.0, 1.0 ), 3.0 );
  float thru = clamp( - nl * 0.6 + 0.4, 0.0, 1.0 );
  vec3 tc = material.diffuseColor * vec3( 1.25, 1.2, 0.6 );                             // 透过叶子的光偏黄绿
  reflectedLight.directDiffuse += directLight.color * ( material.diffuseColor * wrap * 0.6 + tc * thru * ( 0.25 + 1.6 * back ) * uAt2.z ) * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_AT
#endif
`;

// 风中摆动（树：整株晃 + 枝叶抖；草：贴地不动、草尖摆）
function swayCode(o) {
  if (!o.sway) return '';
  const s = o.sway.toFixed(3), s8 = (o.sway * 0.8).toFixed(3);
  return `
  {
    vec3 ip = vec3(0.0);
    #ifdef USE_INSTANCING
      ip = instanceMatrix[3].xyz;
    #endif
    float wl = length(uWind);
    float hgt = max(position.y, 0.0) ${o.grass ? '' : '* 0.15'};
    float ph = uTime * (1.6 + wl * 0.8) + ip.x * 0.37 + ip.z * 0.29;
    float s = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.4) * ${s} * (0.4 + wl);
    transformed.x += (s + uWind.x * ${s8}) * hgt;
    transformed.z += (s * 0.6 + uWind.y * ${s8}) * hgt;
    ${o.grass ? `transformed.y -= abs(s + uWind.x * ${s8}) * hgt * 0.25;` : `
    // 枝叶的细碎抖动：离树干越远、越高，抖得越厉害
    float rad = length(position.xz);
    float fl = sin(uTime * (5.0 + wl * 2.0) + position.x * 3.1 + position.y * 2.3 + position.z * 2.7 + ip.x) * (0.25 + wl) * ${(o.sway * 0.5).toFixed(3)};
    transformed.y += fl * rad * 0.35 * smoothstep(0.6, 2.5, position.y);
    transformed.xz += fl * rad * 0.2 * smoothstep(0.6, 2.5, position.y);`}
  }`;
}

// 平行光（太阳 / 月亮）乘上“照不照得到”；营火、头灯这些点光源不受山影和云影影响
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= atSun;');
if (LIGHTS_BEGIN === THREE.ShaderChunk.lights_fragment_begin) console.warn('[gfx] 光照着色器结构与预期不符，山影和云影不会生效');
// 不贴图的普通材质，但同样吃大气雾、山影和云影（皮肤、眼睛、扣件、字牌、鸟……）
export function plainMat(o = {}) { return surfMat(null, { kind: 'ground', plain: true, tex: 0, bump: 0, macro: 0, snow: 0, wet: 0, ...o }); }
let matId = 0;
/**
 * 做一个带细节贴图的标准材质。
 * o.kind 贴图种类；o.mapping 'world'（默认，静止物体）/ 'local'（会动的物体）/ 'uv'；
 * o.scale 一块贴图多少米；o.bump 法线强度；o.tex 贴图颜色权重；o.macro 大尺度色差；
 * o.snow / o.wet 积雪、雨湿系数（0 关闭）；o.sway 风摆；o.trans 叶片透光；o.terrain 地形专用；
 * o.fastShadow 接收阴影时少取几个点（枝叶、草这类细碎的东西）
 */
export function surfMat(U, o = {}) {
  U = U || SHARED.U;
  const P = { ...o };
  for (const k of ['kind', 'mapping', 'scale', 'bump', 'tex', 'macro', 'snow', 'wet', 'sway', 'grass', 'trans', 'terrain', 'plain', 'cut', 'lichen', 'noflip', 'fastShadow']) delete P[k];
  const mat = new THREE.MeshStandardMaterial(P);
  const kind = o.kind || 'rock';
  const T = tex(kind);
  const mapping = o.terrain ? 'world' : (o.mapping || 'world');
  const snow = o.snow === undefined ? 1 : o.snow, wet = o.wet === undefined ? 1 : o.wet;
  const scale = o.scale || KINDS[kind].tile;
  const uni = {
    tA: { value: T.a }, tB: { value: T.b },
    uAt: { value: new THREE.Vector4(1 / scale, o.bump === undefined ? 1 : o.bump, o.tex === undefined ? 1 : o.tex, o.macro === undefined ? 0.12 : o.macro) },
    uAt2: { value: new THREE.Vector4(snow, wet, o.trans || 0, o.cut || 0) },
  };
  if (o.terrain) { const R = tex('rock'), G = tex('gravel'), K = tex('blocks'); uni.tRA = { value: R.a }; uni.tRB = { value: R.b }; uni.tGA = { value: G.a }; uni.tGB = { value: G.b }; uni.tKA = { value: K.a }; uni.tKB = { value: K.b }; }
  mat.userData.at = uni;
  const defs = [
    QUAL.lite ? '#define AT_LITE' : '',
    mapping === 'local' ? '#define AT_LOCAL' : mapping === 'uv' ? '#define AT_UV' : '',
    o.terrain ? '#define AT_TERRAIN' : '',
    snow > 0 && !o.terrain ? '#define AT_SNOW' : '',
    o.trans ? '#define AT_TRANS' : '',
    o.macro === 0 || mapping !== 'world' ? '#define AT_NOMACRO' : '',
    o.plain ? '#define AT_PLAIN' : '',
    o.cut ? '#define AT_CUT' : '',
    o.lichen ? '#define AT_LICHEN' : '',
    o.noflip ? '#define AT_NOFLIP' : '',
    o.fastShadow ? '#define AT_SHADOW_FAST' : '',
  ].filter(Boolean).join('\n') + '\n';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U || SHARED.U, uni);      // 有的材质在模块加载时就建了，那时共用参数还没准备好：编译时再取
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defs}${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 atP0 = transformed;
        ${swayCode(o)}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          mat4 atM = modelMatrix;
          #ifdef USE_INSTANCING
            atM = modelMatrix * instanceMatrix;
          #endif
          vAtW = (atM * vec4(transformed, 1.0)).xyz;
          #ifdef AT_LOCAL
            vec3 atS = vec3(length(atM[0].xyz), length(atM[1].xyz), length(atM[2].xyz));
            vAtP = atP0 * atS;
            vAtAx = atM[0].xyz / atS.x; vAtAy = atM[1].xyz / atS.y;
          #else
            vAtP = (atM * vec4(atP0, 1.0)).xyz;
          #endif
          #ifdef AT_UV
            vAtUv = uv;
          #endif
          #ifdef AT_TERRAIN
            vAtT = aTer;
          #endif
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${defs}${FRAG_PARS}`)
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${FOG_FN}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TRANS_FN}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${o.terrain ? SURF_TERRAIN : SURF_GENERIC}`)
      .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH_FRAG}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n normal = atN;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= atAO; reflectedLight.indirectSpecular *= atAO * atAO;`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG\n gl_FragColor.rgb = atFog(gl_FragColor.rgb);\n#endif`);
  };
  const key = 'at' + [kind, mapping, o.terrain ? 't' : '', snow > 0 ? 's' : '', o.trans ? 'x' : '', o.sway || 0, o.grass ? 'g' : '', o.macro === 0 ? 'm' : '', o.plain ? 'p' : '', o.cut ? 'c' : '', o.lichen ? 'l' : '', o.noflip ? 'n' : '', o.fastShadow ? 'f' : '', QUAL.lite ? 'L' : 'H'].join('|');
  mat.customProgramCacheKey = () => key;
  mat.userData.atId = ++matId;
  return mat;
}
