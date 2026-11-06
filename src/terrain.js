// ===================== 地形：高度函数 + 分块流式加载 + 植被/岩石 =====================
import * as THREE from 'three';
import { ROUTE, routeZ, segIndexAt, altToY, yToAlt, ROUTE_LENGTH, WORLD } from './data.js';
import { makeNoise, hash2, mulberry32, clamp, smoothstep, lerp } from './noise.js';
import { patchWeatherMaterial } from './materials.js';

const N = makeNoise(20181026);
const N2 = makeNoise(777);

const CHUNK = 128;
const BLEND = 45;

// ---------- 剖面高度（沿路线） ----------
export function profileY(x) {
  if (x <= 0) return altToY(ROUTE[0].alt) - x * 0.02;
  if (x >= ROUTE_LENGTH) return altToY(ROUTE[ROUTE.length - 1].alt);
  const i = segIndexAt(x);
  const a = ROUTE[i], b = ROUTE[i + 1];
  const t = (x - a.x) / (b.x - a.x);
  // Catmull-Rom 插值保证平滑
  const p0 = altToY((ROUTE[i - 1] || a).alt), p1 = altToY(a.alt), p2 = altToY(b.alt), p3 = altToY((ROUTE[i + 2] || b).alt);
  const t2 = t * t, t3 = t2 * t;
  let y = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  // 防止过冲
  const lo = Math.min(p1, p2) - 6, hi = Math.max(p1, p2) + 6;
  y = clamp(y, lo, hi);
  // 段内起伏（地标处为 0）
  const und = Math.sin(Math.PI * t);
  y += und * (N.noise2(x * 0.012, 3.3) * 6 + N.noise2(x * 0.03, 9.1) * 1.5);
  return y;
}

// 截面形状（相对路线高度的偏移），d = 有符号横向距离
function cross(type, d, x) {
  const ad = Math.abs(d);
  switch (type) {
    case 'forest': case 'dead':
      return -Math.pow(Math.max(ad - 10, 0), 1.22) * 0.2;
    case 'meadow':
      return -Math.pow(Math.max(ad - 28, 0), 1.3) * 0.16;
    case 'ridge':
      return -Math.pow(Math.max(ad - 11, 0), 1.3) * 0.2;
    case 'cliff': {
      const side = Math.sin(x * 0.004) > 0 ? 1 : -1; // 悬崖在哪一侧
      if (d * side > 5.5) { const e = ad - 5.5; return -Math.min(e * 2.0, 130 + e * 0.6) - e * 0.05; }
      return -Math.pow(Math.max(ad - 7, 0), 1.3) * 0.26;
    }
    case 'stone': case 'pillars':
      return -Math.pow(Math.max(ad - 22, 0), 1.3) * 0.18;
    case 'gully':
      return Math.pow(Math.max(ad - 7, 0), 1.2) * 0.32;
    default: return 0;
  }
}

export function cliffSideAt(x) { return Math.sin(x * 0.004) > 0 ? 1 : -1; }

// 主脊两侧的断崖带：走偏到这里就是绝壁
const EDGE_BASE = { ridge: 27, cliff: 23, stone: 46, pillars: 44, meadow: 48, forest: 40, dead: 38, gully: 30 };
export function edgeAt(type, d, x) {
  const side = d >= 0 ? 1 : -1;
  return (EDGE_BASE[type] || 40) + N.noise2(x * 0.008, side * 13.7) * 8 + N.noise2(x * 0.03, side * 5.1) * 3;
}
function cliffBand(type, d, x) {
  if (x < 70 || x > ROUTE_LENGTH - 90 || type === 'gully') return 0;
  const k = Math.abs(d) - edgeAt(type, d, x);
  if (k <= 0) return 0;
  return -Math.min(k * 2.6, 80 + k * 0.25);
}

function typeAt(i) { return ROUTE[clamp(i, 0, ROUTE.length - 2)].seg; }

// 返回 {i, j, w}：当前段与相邻段的混合
function segBlend(x) {
  const i = segIndexAt(x);
  const a = ROUTE[i].x, b = ROUTE[i + 1] ? ROUTE[i + 1].x : a + 1;
  if (x - a < BLEND && i > 0) { const w = 0.5 + 0.5 * (x - a) / BLEND; return { i, j: i - 1, w: smoothstep(0, 1, w) }; }
  if (b - x < BLEND && i < ROUTE.length - 2) { const w = 0.5 + 0.5 * (b - x) / BLEND; return { i, j: i + 1, w: smoothstep(0, 1, w) }; }
  return { i, j: i, w: 1 };
}

// 大爷海湖盆
const LAKE_WP = ROUTE.findIndex(w => w.kind === 'lake');
export const LAKE = (() => {
  const w = ROUTE[LAKE_WP];
  const x = w.x + 20, z = routeZ(w.x + 20) + 36;
  return { x, z, r: 22, y: altToY(w.alt) - 10 };
})();

export function heightAt(x, z) {
  const zc = routeZ(x);
  const d = z - zc;
  const ad = Math.abs(d);
  const base = profileY(x);
  const sb = segBlend(x);
  let off = cross(typeAt(sb.i), d, x) + cliffBand(typeAt(sb.i), d, x);
  if (sb.w < 1) off = lerp(cross(typeAt(sb.j), d, x) + cliffBand(typeAt(sb.j), d, x), off, sb.w);
  // 起点和终点之外：平缓谷地
  if (x < -20) off *= smoothstep(-200, -20, x);
  // 远处群山
  const far = smoothstep(180, 900, ad);
  off = Math.max(off, -260 - ad * 0.05);
  if (far > 0) {
    const mtn = N.ridged(x * 0.0016 + 4.0, z * 0.0016, 5) * 420 + N.fbm(x * 0.0007, z * 0.0007, 3) * 180;
    off = lerp(off, off * 0.4 + mtn - 120, far);
  }
  // 细节噪声（路上小，远处大）
  const st = typeAt(sb.i);
  const nearT = smoothstep(3, 22, ad); // 路迹附近地面更平顺
  const amp = 0.45 + nearT * 0.9 + Math.min(ad, 120) * 0.05;
  let det = N.fbm(x * 0.035, z * 0.035, 4) * amp + N.fbm(x * 0.008, z * 0.008, 3) * (2.5 + nearT * 1.5 + Math.min(ad, 300) * 0.08);
  if (st === 'stone' || st === 'pillars') det += N2.ridged(x * 0.09, z * 0.09, 2) * (0.5 + nearT * 1.1);
  let y = base + off + det;
  // 湖盆
  const lx = x - LAKE.x, lz = z - LAKE.z;
  const ld = Math.sqrt(lx * lx + lz * lz);
  if (ld < LAKE.r * 2.2) {
    const bowl = LAKE.y - 3 + Math.pow(Math.max(ld - LAKE.r * 0.7, 0) / (LAKE.r * 1.5), 2) * 14;
    y = lerp(bowl, y, smoothstep(LAKE.r * 1.1, LAKE.r * 2.1, ld));
  }
  // 地标处修整一块平地
  const wi = nearestWaypoint(x);
  const wp = ROUTE[wi];
  const wdx = x - wp.x, wdz = z - routeZ(wp.x);
  const wd = Math.sqrt(wdx * wdx + wdz * wdz);
  const flatR = wp.kind === 'village' ? 45 : wp.camp ? 22 : 13;
  if (wd < flatR * 1.6) {
    const fy = altToY(wp.alt) + (wp.kind === 'village' ? 0 : 0.3);
    y = lerp(fy + det * 0.15, y, smoothstep(flatR * 0.5, flatR * 1.6, wd));
  }
  // 下撤段的溪流河道
  if (x > STREAM.x0 && x < STREAM.x1) {
    const k = smoothstep(STREAM.x0, STREAM.x0 + 60, x) * (1 - smoothstep(STREAM.x1 - 60, STREAM.x1, x));
    const e = (d - STREAM.off) / 2.4;
    y -= 1.7 * Math.exp(-e * e) * k;
  }
  return y;
}
export const STREAM = { x0: ROUTE[27].x + 15, x1: ROUTE[29].x - 25, off: 8 };

export function nearestWaypoint(x) {
  const i = segIndexAt(x);
  if (i + 1 < ROUTE.length && Math.abs(ROUTE[i + 1].x - x) < Math.abs(x - ROUTE[i].x)) return i + 1;
  return i;
}

export function normalAt(x, z, e = 0.8) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const n = new THREE.Vector3(-hx, 2 * e, -hz);
  return n.normalize();
}

// 当前位置所在地形类型（含悬崖侧判断）
export function terrainInfo(x, z) {
  const i = segIndexAt(x);
  const type = ROUTE[i].seg;
  const d = z - routeZ(x);
  return { seg: i, type, d, ad: Math.abs(d) };
}

// ---------- 颜色（随季节变化） ----------
const col3 = (a) => new THREE.Color(a[0], a[1], a[2]);
const PAL = {
  spring: { forest: [0.17, 0.24, 0.1], forest2: [0.24, 0.26, 0.13], meadow: [0.32, 0.35, 0.16], meadow2: [0.26, 0.3, 0.13], dead: [0.3, 0.28, 0.2] },
  summer: { forest: [0.11, 0.21, 0.07], forest2: [0.17, 0.26, 0.09], meadow: [0.2, 0.32, 0.1], meadow2: [0.15, 0.27, 0.08], dead: [0.25, 0.26, 0.16] },
  autumn: { forest: [0.2, 0.18, 0.09], forest2: [0.28, 0.2, 0.1], meadow: [0.42, 0.33, 0.14], meadow2: [0.33, 0.28, 0.12], dead: [0.32, 0.27, 0.19] },
  winter: { forest: [0.21, 0.2, 0.17], forest2: [0.25, 0.23, 0.19], meadow: [0.36, 0.32, 0.25], meadow2: [0.3, 0.28, 0.22], dead: [0.3, 0.28, 0.24] },
};
const C = {
  rock: new THREE.Color(0.3, 0.295, 0.285), rock2: new THREE.Color(0.24, 0.235, 0.23), lichen: new THREE.Color(0.34, 0.33, 0.22),
  path: new THREE.Color(0.33, 0.27, 0.2), snow: new THREE.Color(0.9, 0.92, 0.95), cliffDark: new THREE.Color(0.22, 0.215, 0.21),
};
let PC = null, PCkey = '';
function pal() {
  if (PCkey !== WORLD.season) { const p = PAL[WORLD.season]; PC = {}; for (const k in p) PC[k] = col3(p[k]); PCkey = WORLD.season; }
  return PC;
}
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();

function colorAt(x, z, y, ny, out) {
  const ti = terrainInfo(x, z);
  const alt = yToAlt(y);
  const P = pal();
  const n1 = N.noise2(x * 0.05, z * 0.05), n2 = N2.noise2(x * 0.2, z * 0.2);
  let t = ti.type;
  if (ti.ad > 260) t = alt < 2900 ? 'forest' : alt < 3350 ? 'meadow' : 'rockfar';
  switch (t) {
    case 'forest': case 'gully': out.copy(P.forest).lerp(P.forest2, 0.5 + 0.5 * n1); break;
    case 'dead': out.copy(P.dead).lerp(P.forest2, 0.5 + 0.5 * n1); break;
    case 'meadow': out.copy(P.meadow).lerp(P.meadow2, 0.5 + 0.5 * n1); if (alt > 3450) out.lerp(C.rock, 0.25); break;
    case 'ridge': out.copy(P.meadow2).lerp(C.rock, smoothstep(-0.3, 0.6, n1) * 0.8); break;
    case 'cliff': out.copy(C.rock).lerp(P.meadow2, smoothstep(0.2, 0.8, n1) * 0.6); break;
    case 'stone': case 'pillars': out.copy(C.rock).lerp(C.lichen, smoothstep(0.1, 0.9, n1) * 0.5); break;
    case 'rockfar': out.copy(C.rock2).lerp(P.meadow2, smoothstep(0, 1, n1) * 0.5); break;
    default: out.copy(P.meadow);
  }
  const steep = smoothstep(0.82, 0.6, ny);
  out.lerp(ny < 0.5 ? C.cliffDark : C.rock2, steep);
  if (ti.ad < 2.2 && t !== 'stone' && t !== 'pillars' && x > -10) out.lerp(C.path, (1 - ti.ad / 2.2) * 0.7);
  if (alt > 3550 && ti.ad > 150) out.lerp(C.snow, smoothstep(0.75, 0.95, ny) * smoothstep(3550, 3800, alt) * 0.7);
  if (x < -5 || x > ROUTE_LENGTH - 30) out.lerp(P.meadow2, 0.4);
  // 溪流河床
  if (x > STREAM.x0 && x < STREAM.x1 && Math.abs(ti.d - STREAM.off) < 3.2) out.lerp(C.rock2, 0.6);
  const v = 1 + n2 * 0.07;
  out.r *= v; out.g *= v; out.b *= v;
  return out;
}

// ---------- 几何体资源 ----------
function jitterGeo(geo, amt, seed, freq = 0) {
  const r = mulberry32(seed);
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, [1 + (r() - 0.5) * amt, 1 + (r() - 0.5) * amt, 1 + (r() - 0.5) * amt]);
    const j = map.get(k);
    let x = pos.getX(i) * j[0], y = pos.getY(i) * j[1], z = pos.getZ(i) * j[2];
    if (freq) { const n = N2.noise2(x * freq + seed, z * freq) * 0.18 + N2.noise2(y * freq * 1.7, x * freq) * 0.1; x *= 1 + n; y *= 1 + n; z *= 1 + n; }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}
function colorGeo(geo, color, shadeFn) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color(), pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    c.copy(color);
    if (shadeFn) shadeFn(c, pos.getX(i), pos.getY(i), pos.getZ(i));
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function mergeGeos(list) {
  const geos = list.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0; for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.computeBoundingSphere();
  return m;
}

export const GEO = {};
export const MAT = {};

// 叶色（随季节）
const FOL = {
  fir:   { spring: [0.1, 0.2, 0.11], summer: [0.08, 0.18, 0.1], autumn: [0.09, 0.17, 0.1], winter: [0.1, 0.17, 0.13] },
  larch: { spring: [0.36, 0.5, 0.18], summer: [0.17, 0.33, 0.11], autumn: [0.78, 0.55, 0.13], winter: null },
  birch: { spring: [0.45, 0.58, 0.2], summer: [0.22, 0.4, 0.12], autumn: [0.88, 0.66, 0.14], winter: null },
  maple: { spring: [0.34, 0.5, 0.16], summer: [0.17, 0.34, 0.1], autumn: [0.8, 0.22, 0.07], winter: null },
  maple2:{ spring: [0.4, 0.52, 0.18], summer: [0.2, 0.36, 0.11], autumn: [0.9, 0.48, 0.1], winter: null },
  rhodo: { spring: [0.1, 0.22, 0.09], summer: [0.1, 0.22, 0.09], autumn: [0.22, 0.2, 0.09], winter: [0.12, 0.18, 0.11] },
  shrub: { spring: [0.28, 0.4, 0.14], summer: [0.17, 0.32, 0.1], autumn: [0.62, 0.28, 0.1], winter: [0.3, 0.24, 0.17] },
};
const TRUNK = new THREE.Color(0.26, 0.17, 0.1), TRUNK_GREY = new THREE.Color(0.38, 0.34, 0.3);

export function initTerrainAssets(weatherUniforms) {
  MAT.terrain = patchWeatherMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), weatherUniforms, { detail: true });
  MAT.rock = patchWeatherMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true }), weatherUniforms, {});
  MAT.tree = patchWeatherMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), weatherUniforms, { sway: 0.05 });
  MAT.grass = patchWeatherMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), weatherUniforms, { sway: 0.35, grass: true });
  MAT.flower = patchWeatherMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x111111 }), weatherUniforms, { sway: 0.3, grass: true });
  // 岩石：多频率扰动的花岗岩
  GEO.rocks = [0, 1].map(s => {
    const g = jitterGeo(new THREE.IcosahedronGeometry(1, 2), 0.35, 100 + s, 1.3);
    g.translate(0, -0.15, 0);
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    return colorGeo(ng, new THREE.Color(1, 1, 1), (c, x, y) => { c.multiplyScalar(0.8 + y * 0.15 + N2.noise2(x * 3, y * 3) * 0.08); });
  });
  // 草
  {
    const g = new THREE.BufferGeometry();
    const pos = [], col = [];
    const r = mulberry32(77);
    for (let k = 0; k < 7; k++) {
      const a = r() * Math.PI * 2, ox = (r() - 0.5) * 0.35, oz = (r() - 0.5) * 0.35;
      const w = 0.05 + r() * 0.04, h = 0.55 + r() * 0.5, lean = 0.15 + r() * 0.3;
      const cx = Math.cos(a) * w, cz = Math.sin(a) * w;
      const tx = ox + Math.cos(a + 1.57) * lean, tz = oz + Math.sin(a + 1.57) * lean;
      pos.push(ox - cx, 0, oz - cz, ox + cx, 0, oz + cz, tx, h, tz);
      col.push(0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1, 1, 1);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const nor = g.attributes.normal; for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
    GEO.grass = g;
  }
  // 野花：花瓣盘 + 花心 + 细茎
  {
    const parts = [];
    const petals = new THREE.CircleGeometry(0.11, 6); petals.rotateX(-Math.PI / 2); petals.translate(0, 0.32, 0);
    parts.push(colorGeo(petals, new THREE.Color(1, 1, 1), (c, x, y, z) => { const r = Math.hypot(x, z); if (r < 0.03) c.setRGB(1.6, 1.3, 0.2); }));
    const petals2 = new THREE.CircleGeometry(0.08, 5); petals2.rotateX(-Math.PI / 2 + 0.5); petals2.translate(0.08, 0.22, 0.03);
    parts.push(colorGeo(petals2, new THREE.Color(0.95, 0.95, 0.95)));
    const stem = new THREE.CylinderGeometry(0.008, 0.01, 0.32, 3); stem.translate(0, 0.16, 0);
    parts.push(colorGeo(stem, new THREE.Color(0.25, 0.5, 0.15)));
    GEO.flower = mergeGeos(parts);
  }
}

// 每局开始时按季节生成树木几何
export function buildVegetation(seasonKey) {
  const sk = seasonKey;
  const fc = (kind) => FOL[kind][sk] ? col3(FOL[kind][sk]) : null;
  const leafShade = (amt) => (c, x, y, z) => { const v = 0.75 + (y % 1.0) * 0.1 + N2.noise2(x * 4 + y, z * 4) * amt; c.multiplyScalar(v); };
  // 冷杉：一层层下垂的枝层
  {
    const parts = [colorGeo(new THREE.CylinderGeometry(0.1, 0.24, 3.2, 7).translate(0, 1.6, 0), TRUNK)];
    const f = fc('fir');
    const tiers = 7;
    for (let k = 0; k < tiers; k++) {
      const u = k / (tiers - 1);
      const r = lerp(1.75, 0.32, Math.pow(u, 0.9)), h = lerp(1.35, 0.9, u);
      const cone = jitterGeo(new THREE.ConeGeometry(r, h, 10, 2), 0.22, 300 + k);
      const p = cone.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -h * 0.3) p.setY(i, y - 0.18 * Math.hypot(p.getX(i), p.getZ(i)) / r); }
      cone.computeVertexNormals();
      cone.translate(0, 1.4 + k * 0.72 + h / 2, 0); cone.rotateY(k * 0.9);
      parts.push(colorGeo(cone, f.clone().multiplyScalar(0.85 + u * 0.35), leafShade(0.18)));
    }
    const tip = new THREE.ConeGeometry(0.15, 0.7, 6); tip.translate(0, 1.4 + tiers * 0.72 + 0.2, 0);
    parts.push(colorGeo(tip, f.clone().multiplyScalar(1.2)));
    GEO.fir = mergeGeos(parts);
  }
  // 太白红杉（落叶松）：稀疏通透
  {
    const parts = [colorGeo(new THREE.CylinderGeometry(0.07, 0.2, 7, 6).translate(0, 3.5, 0), TRUNK)];
    const f = fc('larch');
    const r0 = mulberry32(31);
    for (let k = 0; k < 9; k++) {
      const y = 1.6 + k * 0.62, rad = lerp(1.4, 0.25, k / 8);
      for (let b = 0; b < 4; b++) {
        const a = b / 4 * Math.PI * 2 + k * 0.7;
        const br = new THREE.CylinderGeometry(0.02, 0.04, rad, 4); br.translate(0, rad / 2, 0); br.rotateZ(-1.25); br.rotateY(a); br.translate(0, y, 0);
        parts.push(colorGeo(br, TRUNK));
        if (f) {
          const tuft = jitterGeo(new THREE.IcosahedronGeometry(0.34 + rad * 0.18, 0), 0.5, 400 + k * 4 + b);
          tuft.scale(1.5, 0.5, 1); tuft.rotateY(a); tuft.translate(Math.cos(a) * rad * 0.7, y + 0.05 + (r0() - 0.5) * 0.15, -Math.sin(a) * rad * 0.7);
          parts.push(colorGeo(tuft, f.clone().multiplyScalar(0.85 + r0() * 0.3), leafShade(0.15)));
        }
      }
    }
    GEO.larch = mergeGeos(parts);
  }
  // 白桦：白色树皮带黑纹
  {
    const bark = new THREE.Color(0.86, 0.84, 0.8);
    const trunk = new THREE.CylinderGeometry(0.08, 0.14, 5.5, 8, 8); trunk.translate(0, 2.75, 0);
    const parts = [colorGeo(trunk, bark, (c, x, y, z) => { const h = Math.sin(y * 7.3 + Math.atan2(z, x) * 2) * Math.sin(y * 3.1); if (h > 0.55) c.setRGB(0.12, 0.11, 0.1); })];
    const f = fc('birch');
    const r0 = mulberry32(41);
    for (let b = 0; b < 4; b++) {
      const br = new THREE.CylinderGeometry(0.025, 0.05, 1.6, 4); br.translate(0, 0.8, 0); br.rotateZ(0.7 + r0() * 0.3); br.rotateY(b * 1.6); br.translate(0, 3.2 + b * 0.5, 0);
      parts.push(colorGeo(br, bark));
    }
    if (f) for (let k = 0; k < 6; k++) {
      const g = jitterGeo(new THREE.IcosahedronGeometry(0.85 + r0() * 0.4, 1), 0.35, 60 + k);
      g.scale(1, 1.15, 1); g.translate((r0() - 0.5) * 1.8, 4.4 + r0() * 1.8, (r0() - 0.5) * 1.8);
      parts.push(colorGeo(g, f.clone().multiplyScalar(0.85 + r0() * 0.3), leafShade(0.2)));
    }
    GEO.birch = mergeGeos(parts);
  }
  // 槭树（秋天红/橙两种）
  for (const kind of ['maple', 'maple2']) {
    const parts = [colorGeo(new THREE.CylinderGeometry(0.14, 0.3, 3.4, 7).translate(0, 1.7, 0), TRUNK)];
    const r0 = mulberry32(kind === 'maple' ? 17 : 23);
    for (let b = 0; b < 3; b++) { const br = new THREE.CylinderGeometry(0.05, 0.1, 2, 5); br.translate(0, 1, 0); br.rotateZ(0.6); br.rotateY(b * 2.1); br.translate(0, 2.8, 0); parts.push(colorGeo(br, TRUNK)); }
    const f = fc(kind);
    if (f) for (let k = 0; k < 7; k++) {
      const g = jitterGeo(new THREE.IcosahedronGeometry(1.15 + r0() * 0.6, 1), 0.3, 80 + k + (kind === 'maple' ? 0 : 20));
      g.translate((r0() - 0.5) * 2.6, 4.0 + r0() * 1.6, (r0() - 0.5) * 2.6);
      parts.push(colorGeo(g, f.clone().multiplyScalar(0.8 + r0() * 0.35), leafShade(0.2)));
    }
    GEO[kind] = mergeGeos(parts);
  }
  // 盆景园：虬曲矮冷杉，枝叶成平台状
  {
    const parts = [];
    let p = new THREE.Vector3(0, 0, 0);
    const r0 = mulberry32(9);
    for (let s = 0; s < 3; s++) {
      const q = p.clone().add(new THREE.Vector3((r0() - 0.5) * 0.8, 0.8, (r0() - 0.5) * 0.8));
      const len = p.distanceTo(q);
      const c = new THREE.CylinderGeometry(0.12 - s * 0.03, 0.2 - s * 0.04, len, 6); c.translate(0, len / 2, 0);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), q.clone().sub(p), new THREE.Vector3(0, 0, 1));
      c.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize())));
      c.translate(p.x, p.y, p.z);
      parts.push(colorGeo(c, TRUNK_GREY));
      p = q;
    }
    const f = fc('fir');
    for (let k = 0; k < 5; k++) {
      const g = jitterGeo(new THREE.IcosahedronGeometry(0.75 + r0() * 0.4, 1), 0.4, 20 + k);
      g.scale(1.5, 0.38, 1.5); g.translate((r0() - 0.5) * 1.8, 1.0 + k * 0.35, (r0() - 0.5) * 1.8);
      parts.push(colorGeo(g, f.clone().multiplyScalar(1.1 + r0() * 0.3), leafShade(0.2)));
    }
    GEO.bonsai = mergeGeos(parts);
  }
  // 杜鹃灌丛 + 花簇
  {
    const parts = [colorGeo(new THREE.CylinderGeometry(0.05, 0.08, 0.6, 5).translate(0, 0.3, 0), TRUNK)];
    const f = fc('rhodo');
    const r0 = mulberry32(13);
    const bloomPts = [];
    for (let k = 0; k < 4; k++) {
      const g = jitterGeo(new THREE.IcosahedronGeometry(0.55 + r0() * 0.25, 1), 0.35, 40 + k);
      const ox = (r0() - 0.5) * 1.1, oz = (r0() - 0.5) * 1.1, oy = 0.6 + r0() * 0.3;
      g.scale(1.2, 0.72, 1.2); g.translate(ox, oy, oz);
      parts.push(colorGeo(g, f.clone().multiplyScalar(0.85 + r0() * 0.3), leafShade(0.15)));
      for (let b = 0; b < 5; b++) { const a = r0() * 6.28, rr = r0() * 0.5; bloomPts.push([ox + Math.cos(a) * rr, oy + 0.32 + r0() * 0.1, oz + Math.sin(a) * rr]); }
    }
    GEO.rhodo = mergeGeos(parts);
    const bl = bloomPts.map(([x, y, z], i) => { const s = new THREE.IcosahedronGeometry(0.11 + (i % 3) * 0.02, 0); s.translate(x, y, z); return colorGeo(s, new THREE.Color(1, 1, 1), (c, px, py) => c.multiplyScalar(py > y ? 1.1 : 0.85)); });
    GEO.bloom = mergeGeos(bl);
  }
  // 灌木 / 箭竹
  {
    const r0 = mulberry32(53);
    const parts = [];
    const f = fc('shrub');
    for (let k = 0; k < 3; k++) {
      const g = jitterGeo(new THREE.IcosahedronGeometry(0.55 + r0() * 0.3, 1), 0.5, 40 + k);
      g.scale(1, 0.75, 1); g.translate((r0() - 0.5) * 0.9, 0.38, (r0() - 0.5) * 0.9);
      parts.push(colorGeo(g, f.clone().multiplyScalar(0.85 + r0() * 0.3), leafShade(0.2)));
    }
    GEO.shrub = mergeGeos(parts);
  }
  // 火烧坡枯树
  {
    const dc = new THREE.Color(0.5, 0.48, 0.45);
    const parts = [colorGeo(new THREE.CylinderGeometry(0.08, 0.22, 7, 6).translate(0, 3.5, 0), dc, (c, x, y) => { if (y < 1.2) c.multiplyScalar(0.35); })];
    const r = mulberry32(5);
    for (let k = 0; k < 6; k++) {
      const b = new THREE.CylinderGeometry(0.025, 0.06, 1.3 + r(), 4);
      b.translate(0, 0.65, 0); b.rotateZ(0.9 + r() * 0.5); b.rotateY(r() * 6.28); b.translate(0, 2 + k * 0.75, 0);
      parts.push(colorGeo(b, dc));
    }
    GEO.dead = mergeGeos(parts);
  }
  VEG_SEASON = sk;
}
let VEG_SEASON = null;

const FLOWER_COLORS = {
  spring: [[0.95, 0.75, 0.85], [1, 1, 0.95], [0.75, 0.55, 0.95]],
  summer: [[1, 0.85, 0.15], [0.7, 0.35, 0.95], [1, 1, 1], [0.35, 0.55, 1], [1, 0.45, 0.55], [1, 0.6, 0.15]],
  autumn: [[0.55, 0.35, 0.9], [0.95, 0.8, 0.2]],
  winter: [],
};
const FLOWER_DENSITY = { spring: 700, summer: 1800, autumn: 300, winter: 0 };
const BLOOM_COLORS = [[0.96, 0.42, 0.62], [0.88, 0.16, 0.24], [0.97, 0.9, 0.92], [0.95, 0.6, 0.75]];

// ---------- 碰撞空间哈希 ----------
const CELL = 8;
const rockHash = new Map();   // key -> [rock]
const treeHash = new Map();
const keyOf = (cx, cz) => cx * 100003 + cz;
function hashAdd(map, o) {
  const cx = Math.floor(o.x / CELL), cz = Math.floor(o.z / CELL);
  const rr = Math.ceil(o.r / CELL);
  o._keys = [];
  for (let i = -rr; i <= rr; i++) for (let j = -rr; j <= rr; j++) {
    const k = keyOf(cx + i, cz + j);
    let l = map.get(k); if (!l) { l = []; map.set(k, l); }
    l.push(o); o._keys.push(k);
  }
}
function hashRemove(map, o) {
  for (const k of o._keys) { const l = map.get(k); if (!l) continue; const idx = l.indexOf(o); if (idx >= 0) l.splice(idx, 1); if (!l.length) map.delete(k); }
}

export const dynamicRocks = []; // 落石等临时物体不参与

// 地面高度（含岩石顶部）
export function groundAt(x, z) {
  let y = heightAt(x, z);
  const l = rockHash.get(keyOf(Math.floor(x / CELL), Math.floor(z / CELL)));
  let onRock = false;
  if (l) for (const r of l) {
    const dx = x - r.x, dz = z - r.z;
    const d2 = (dx * dx + dz * dz) / (r.r * r.r);
    if (d2 < 1) { const top = r.y + r.h * Math.sqrt(1 - d2); if (top > y) { y = top; onRock = true; } }
  }
  return { y, onRock };
}

export function treeCollide(x, z, rad) {
  const l = treeHash.get(keyOf(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!l) return null;
  let px = x, pz = z, hit = false;
  for (const t of l) {
    const dx = px - t.x, dz = pz - t.z;
    const m = t.r + rad;
    const d2 = dx * dx + dz * dz;
    if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2); px = t.x + dx / d * m; pz = t.z + dz / d * m; hit = true; }
  }
  return hit ? { x: px, z: pz } : null;
}

// ---------- 分块 ----------
class Chunk {
  constructor(cx, cz) { this.cx = cx; this.cz = cz; this.res = 0; this.mesh = null; this.objs = null; this.grass = null; this.rocks = []; this.trees = []; }
}

function buildTerrainGeo(cx, cz, res) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const step = CHUNK / res;
  const vn = res + 3; // 含裙边
  const count = vn * vn;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const hgt = new Float32Array((res + 3) * (res + 3));
  // 先算高度（含外圈用于法线）
  for (let j = 0; j < vn; j++) for (let i = 0; i < vn; i++) {
    const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
    hgt[j * vn + i] = heightAt(x, z);
  }
  for (let j = 0; j < vn; j++) for (let i = 0; i < vn; i++) {
    const ii = clamp(i, 1, res + 1), jj = clamp(j, 1, res + 1);
    const x = x0 + (ii - 1) * step, z = z0 + (jj - 1) * step;
    let y = hgt[jj * vn + ii];
    const skirt = i === 0 || j === 0 || i === vn - 1 || j === vn - 1;
    const hl = hgt[jj * vn + Math.max(ii - 1, 0)], hr = hgt[jj * vn + Math.min(ii + 1, vn - 1)];
    const hd = hgt[Math.max(jj - 1, 0) * vn + ii], hu = hgt[Math.min(jj + 1, vn - 1) * vn + ii];
    let nx = (hl - hr), ny = 2 * step, nz = (hd - hu);
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const k = (j * vn + i) * 3;
    pos[k] = x; pos[k + 1] = skirt ? y - step * 1.5 : y; pos[k + 2] = z;
    nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
    colorAt(x, z, y, ny, tmpC);
    col[k] = tmpC.r; col[k + 1] = tmpC.g; col[k + 2] = tmpC.b;
  }
  const idx = new Uint32Array((vn - 1) * (vn - 1) * 6);
  let p = 0;
  for (let j = 0; j < vn - 1; j++) for (let i = 0; i < vn - 1; i++) {
    const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function slopeNY(x, z) {
  const e = 1.0;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return 2 * e / Math.hypot(hx, 2 * e, hz);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

function buildObjects(chunk) {
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
  const rnd = mulberry32((chunk.cx * 73856093) ^ (chunk.cz * 19349663) ^ 0x5bd1e995);
  const group = new THREE.Group();
  const rocks = [], trees = { fir: [], larch: [], birch: [], maple: [], maple2: [], bonsai: [], rhodo: [], shrub: [], dead: [] };
  const ccx = x0 + CHUNK / 2, ccz = z0 + CHUNK / 2;
  const tries = Math.abs(ccz - routeZ(ccx)) < 220 ? 1400 : 450;
  for (let n = 0; n < tries; n++) {
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    const ti = terrainInfo(x, z);
    const y = heightAt(x, z);
    const alt = yToAlt(y);
    const ny = slopeNY(x, z);
    const r1 = rnd(), r2 = rnd(), r3 = rnd();
    // 地标附近空出来
    const wi = nearestWaypoint(x); const wp = ROUTE[wi];
    const wd = Math.hypot(x - wp.x, z - routeZ(wp.x));
    if (wd < (wp.kind === 'village' ? 40 : 14)) continue;
    let t = ti.type; if (ti.ad > 260) t = 'far';
    // ---- 岩石 ----
    let rockP = 0, rmin = 0.5, rmax = 1.6;
    if (t === 'stone') { rockP = ti.ad < 45 ? 0.55 : 0.2; rmin = 0.6; rmax = 2.0; }
    else if (t === 'pillars') { rockP = ti.ad < 45 ? 0.32 : 0.15; rmin = 0.6; rmax = 1.8; }
    else if (t === 'ridge' || t === 'cliff') rockP = 0.07;
    else if (t === 'meadow') rockP = 0.03;
    else if (t === 'far') rockP = alt > 3300 ? 0.02 : 0;
    else rockP = 0.015;
    if (ny < 0.55) rockP *= 0.3;
    if (r1 < rockP) {
      const r = rmin + Math.pow(r2, 2.2) * (rmax - rmin) * (ti.ad > 60 ? 2 : 1);
      let h = r * (0.55 + r3 * 0.4);
      if (t === 'pillars' && r3 > 0.55 && ti.ad > 4) h = r * (3 + r3 * 4.5); // 石柱
      if (ti.ad < 1.5 && t !== 'stone' && t !== 'pillars') continue;
      const lich = rnd();
      const rock = { x, z, y: y - r * 0.25, r: r * 1.0, h: h * 0.95, v: (r2 * 2) | 0, rot: rnd() * 6.28, c: 0.38 + rnd() * 0.2, l: lich < 0.2 ? 1 : lich < 0.28 ? 2 : 0 };
      rocks.push(rock);
      continue;
    }
    // ---- 树 ----
    if (ny < 0.72 || ti.ad < 3.2) continue;
    if (x > STREAM.x0 && x < STREAM.x1 && Math.abs(ti.d - STREAM.off) < 3) continue;
    let tp = 0, kind = null;
    if (t === 'forest' || t === 'far') {
      if (alt < 2300) { tp = 0.45; kind = r2 < 0.3 ? 'maple' : r2 < 0.5 ? 'maple2' : r2 < 0.72 ? 'birch' : 'fir'; }
      else if (alt < 2700) { tp = 0.42; kind = r2 < 0.35 ? 'birch' : r2 < 0.45 ? 'maple2' : 'fir'; }
      else if (alt < 3050) { tp = 0.38; kind = r2 < 0.65 ? 'fir' : 'larch'; }
      else if (alt < 3350) { tp = 0.2; kind = r2 < 0.65 ? 'larch' : 'bonsai'; }
      else if (alt < 3450) { tp = 0.05; kind = 'rhodo'; }
    } else if (t === 'dead') { tp = 0.32; kind = r2 < 0.75 ? 'dead' : 'fir'; }
    else if (t === 'gully') { tp = 0.6; kind = r2 < 0.4 ? 'shrub' : r2 < 0.6 ? 'maple' : r2 < 0.8 ? 'birch' : 'maple2'; }
    else if (t === 'meadow') {
      if (alt < 3250) { tp = 0.26; kind = r2 < 0.35 ? 'bonsai' : r2 < 0.75 ? 'rhodo' : 'larch'; }
      else if (alt < 3500) { tp = 0.08; kind = r2 < 0.7 ? 'rhodo' : 'shrub'; }
    } else if ((t === 'ridge' || t === 'cliff') && alt < 3420) { tp = 0.06; kind = r2 < 0.6 ? 'rhodo' : 'bonsai'; }
    if (kind && r1 < rockP + tp) {
      const s = (kind === 'rhodo' || kind === 'shrub' ? 0.8 : 0.75) + r3 * 0.7;
      trees[kind].push({ x, z, y: y - 0.1, s, rot: rnd() * 6.28, r: kind === 'shrub' || kind === 'rhodo' ? 0 : 0.32 * s, v: rnd() });
    }
  }
  // 岩石实例
  const byV = [[], []];
  for (const r of rocks) byV[r.v].push(r);
  byV.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(GEO.rocks[v], MAT.rock, list.length);
    list.forEach((r, k) => {
      _q.setFromEuler(_e.set(0, r.rot, 0));
      _s.set(r.r, r.h / 0.85, r.r);
      _p.set(r.x, r.y + 0.12 * r.h, r.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(k, _m);
      if (r.l === 1) tmpC2.setRGB(r.c * 1.02, r.c * 1.02, r.c * 0.78); else if (r.l === 2) tmpC2.setRGB(r.c * 1.15, r.c * 0.92, r.c * 0.7); else tmpC2.setRGB(r.c, r.c * 0.97, r.c * (0.9 + (k % 3) * 0.04));
      im.setColorAt(k, tmpC2);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  const bloomOn = WORLD.season === 'spring' ? 1 : WORLD.season === 'summer' ? 0.35 : 0;
  const blooms = [];
  for (const kind in trees) {
    const list = trees[kind];
    if (!list.length || !GEO[kind]) continue;
    const im = new THREE.InstancedMesh(GEO[kind], MAT.tree, list.length);
    list.forEach((t, k) => {
      _q.setFromEuler(_e.set(0, t.rot, 0));
      _s.set(t.s, t.s * (0.85 + (t.rot % 0.3)), t.s);
      _p.set(t.x, t.y, t.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(k, _m);
      const v = 0.85 + t.v * 0.3;
      im.setColorAt(k, tmpC2.setRGB(v * (0.96 + t.v * 0.08), v, v * (1.04 - t.v * 0.08)));
      if (kind === 'rhodo' && t.v < bloomOn) blooms.push([_m.clone(), BLOOM_COLORS[(t.v * 97 | 0) % BLOOM_COLORS.length]]);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  if (blooms.length) {
    const im = new THREE.InstancedMesh(GEO.bloom, MAT.flower, blooms.length);
    blooms.forEach(([m, c], k) => { im.setMatrixAt(k, m); im.setColorAt(k, tmpC2.setRGB(c[0], c[1], c[2])); });
    im.computeBoundingSphere(); group.add(im);
  }
  chunk.rocks = rocks;
  chunk.trees = Object.values(trees).flat().filter(t => t.r > 0);
  for (const r of rocks) hashAdd(rockHash, r);
  for (const t of chunk.trees) hashAdd(treeHash, t);
  return group;
}

const GRASS_TINT = {
  spring: [[0.26, 0.4, 0.12], [0.42, 0.44, 0.2]], summer: [[0.16, 0.34, 0.08], [0.28, 0.4, 0.12]],
  autumn: [[0.36, 0.34, 0.12], [0.62, 0.46, 0.18]], winter: [[0.38, 0.33, 0.22], [0.5, 0.44, 0.3]],
};
function buildGrass(chunk) {
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
  const rnd = mulberry32((chunk.cx * 9176) ^ (chunk.cz * 3517) ^ 0x1234);
  const sk = WORLD.season;
  const list = [], flowers = [];
  const want = sk === 'winter' ? 1600 : 4200;
  const fwant = FLOWER_DENSITY[sk];
  const fcols = FLOWER_COLORS[sk];
  for (let n = 0; n < want + fwant; n++) {
    const isF = n >= want;
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    const ti = terrainInfo(x, z);
    if (ti.ad > 200) continue;
    const t = ti.type;
    const r = rnd();
    let p = 0;
    if (t === 'meadow') p = 0.9; else if (t === 'forest' || t === 'gully') p = 0.6; else if (t === 'ridge' || t === 'cliff') p = 0.45; else if (t === 'dead') p = 0.7; else p = 0.08;
    if (ti.ad < 1.2 && t !== 'stone') p *= 0.2;
    if (isF) { const patch = N.noise2(x * 0.045, z * 0.045); p *= smoothstep(0.05, 0.45, patch) * (t === 'meadow' || t === 'ridge' ? 1.4 : 0.6); }
    if (r > p) continue;
    if (x > STREAM.x0 && x < STREAM.x1 && Math.abs(ti.d - STREAM.off) < 2.2) continue;
    const y = heightAt(x, z);
    const ny = slopeNY(x, z);
    if (ny < 0.7) continue;
    const alt = yToAlt(y);
    (isF ? flowers : list).push({ x, y, z, s: 0.35 + rnd() * 0.5, rot: rnd() * 6.28, alt, n: rnd() });
  }
  const group = new THREE.Group();
  const c = new THREE.Color();
  const GT = GRASS_TINT[sk];
  if (list.length) {
    const im = new THREE.InstancedMesh(GEO.grass, MAT.grass, list.length);
    list.forEach((g, k) => {
      _q.setFromEuler(_e.set(0, g.rot, 0));
      const hs = sk === 'winter' ? 0.6 : 1;
      _s.set(g.s * 1.6, g.s * (g.alt > 3300 ? 0.8 : 1.15) * hs, g.s * 1.6);
      _p.set(g.x, g.y - 0.05, g.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(k, _m);
      const gold = smoothstep(2800, 3500, g.alt) * 0.6 + g.n * 0.4;
      c.setRGB(lerp(GT[0][0], GT[1][0], gold) * 0.85, lerp(GT[0][1], GT[1][1], gold) * 0.85, lerp(GT[0][2], GT[1][2], gold) * 0.85);
      im.setColorAt(k, c);
    });
    im.receiveShadow = true; im.computeBoundingSphere(); group.add(im);
  }
  if (flowers.length && fcols.length) {
    const im = new THREE.InstancedMesh(GEO.flower, MAT.flower, flowers.length);
    flowers.forEach((g, k) => {
      _q.setFromEuler(_e.set((g.n - 0.5) * 0.3, g.rot, (g.n - 0.5) * 0.3));
      const s = 0.8 + g.s * 0.9;
      _s.set(s, s * (0.8 + g.n * 0.6), s);
      _p.set(g.x, g.y - 0.03, g.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(k, _m);
      // 同一片花丛颜色接近
      const ci = Math.abs(Math.floor(N2.noise2(g.x * 0.03, g.z * 0.03) * 7 + g.n * 1.6)) % fcols.length;
      const fc = fcols[ci];
      im.setColorAt(k, c.setRGB(fc[0], fc[1], fc[2]));
    });
    im.computeBoundingSphere(); group.add(im);
  }
  return group.children.length ? group : null;
}

export class TerrainManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.queue = [];
    this.radius = 6;
  }
  key(cx, cz) { return cx + ',' + cz; }
  wantedRes(dist) { return dist <= 1 ? 56 : dist <= 3 ? 28 : 12; }
  update(px, pz, budgetMs = 6, force = false) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.radius;
    const t0 = performance.now();
    const tasks = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dz));
      if (dist > R) continue;
      const cx = pcx + dx, cz = pcz + dz;
      const k = this.key(cx, cz);
      let c = this.chunks.get(k);
      if (!c) { c = new Chunk(cx, cz); this.chunks.set(k, c); }
      c.dist = dist; c.alive = true;
      const res = this.wantedRes(dist);
      const needObj = dist <= 3, needGrass = dist <= 1;
      if (c.res !== res || (needObj && !c.objs) || (needGrass && !c.grassDone)) tasks.push(c);
    }
    tasks.sort((a, b) => a.dist - b.dist);
    for (const c of tasks) {
      if (!force && performance.now() - t0 > budgetMs) break;
      const res = this.wantedRes(c.dist);
      if (c.res !== res) {
        const g = buildTerrainGeo(c.cx, c.cz, res);
        if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.geometry = g; }
        else { c.mesh = new THREE.Mesh(g, MAT.terrain); c.mesh.receiveShadow = true; c.mesh.castShadow = false; this.scene.add(c.mesh); }
        c.res = res;
        if (!force) continue; // 每块只做一件事，下一帧再继续
      }
      if (c.dist <= 3 && !c.objs) { c.objs = buildObjects(c); this.scene.add(c.objs); if (!force) continue; }
      if (c.dist <= 1 && !c.grassDone) { c.grass = buildGrass(c); c.grassDone = true; if (c.grass) this.scene.add(c.grass); }
    }
    // 卸载
    for (const [k, c] of this.chunks) {
      const dist = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (dist > R + 1) { this.disposeChunk(c); this.chunks.delete(k); continue; }
      if (dist > 4 && c.objs) this.disposeObjs(c);
      if (dist > 2 && c.grassDone) { if (c.grass) this.disposeGroup(c.grass); c.grass = null; c.grassDone = false; }
    }
  }
  disposeObjs(c) {
    this.scene.remove(c.objs);
    c.objs.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    for (const r of c.rocks) hashRemove(rockHash, r);
    for (const t of c.trees) hashRemove(treeHash, t);
    c.objs = null; c.rocks = []; c.trees = [];
  }
  disposeChunk(c) {
    if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (c.objs) this.disposeObjs(c);
    if (c.grass) this.disposeGroup(c.grass);
  }
  disposeGroup(g) { this.scene.remove(g); g.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
  clearAll() { for (const [, c] of this.chunks) this.disposeChunk(c); this.chunks.clear(); }
}
