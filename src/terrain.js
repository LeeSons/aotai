// ===================== 地形：高度函数 + 分块流式加载 + 植被/岩石 =====================
import * as THREE from 'three';
import { ROUTE, routeZ, segIndexAt, altToY, yToAlt, ROUTE_LENGTH, WORLD } from './data.js';
import { makeNoise, hash2, mulberry32, clamp, smoothstep, lerp } from './noise.js';
import { surfMat, tex, QUAL } from './materials.js';
import { merge, weld, paint, crease, puff, displace, xf, rockGeo } from './geo.js';

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
  const pkSeg = a.peak || b.peak;
  const und = Math.sin(Math.PI * t) * (1 - openAt(x) * 0.55) * (pkSeg ? 0.3 : 1);   // 开阔台地上是稳稳的缓坡，没有忽上忽下
  y += und * (N.noise2(x * 0.012, 3.3) * 6 + N.noise2(x * 0.03, 9.1) * 1.5);
  if (pkSeg) y -= peakDip(a, b, t);
  return y;
}

// ---------- 一连串石头尖峰（飞机梁·梁1/2/3） ----------
// 地标就是峰顶；两峰之间压下去一个垭口。sin 在两端斜率不为 0，所以峰顶是个尖（约 38°，手脚并用能上），垭口是圆的。
const PEAK_D = 22;
function peakDip(a, b, t) {
  const s = Math.sin(Math.PI * t);
  if (a.peak && b.peak) return PEAK_D * s;
  if (b.peak) return PEAK_D * s * smoothstep(0.45, 0.9, t);        // 从台地过来：台面保持平，快到峰前才落下一个垭口，再直冲峰顶
  return PEAK_D * 0.7 * s * (1 - smoothstep(0, 1, t));              // 下最后一座峰：先陡后缓
}
const PEAKS = ROUTE.filter(w => w.peak);
// 尖峰链的横向收窄：整条链都是窄脊，峰顶附近更窄更陡
function spireAt(x) {
  if (!PEAKS.length) return 0;
  const x0 = PEAKS[0].x, x1 = PEAKS[PEAKS.length - 1].x;
  if (x < x0 - 40 || x > x1 + 40) return 0;
  const chain = smoothstep(x0 - 40, x0 - 8, x) * (1 - smoothstep(x1 + 8, x1 + 40, x));
  let near = 0;
  for (const p of PEAKS) near = Math.max(near, 1 - smoothstep(0, 32, Math.abs(x - p.x)));
  return chain * (0.6 + 0.4 * near);
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
export function edgeAt(type, d, x, op = openAt(x)) {
  const side = d >= 0 ? 1 : -1;
  return (EDGE_BASE[type] || 40) + op * 420 + N.noise2(x * 0.008, side * 13.7) * 8 + N.noise2(x * 0.03, side * 5.1) * 3;
}
function cliffBand(type, d, x, op) {
  if (x < 70 || x > ROUTE_LENGTH - 90 || type === 'gully') return 0;
  const k = Math.abs(d) - edgeAt(type, d, x, op);
  if (k <= 0) return 0;
  return -Math.min(k * 2.6, 80 + k * 0.25);
}

function typeAt(i) { return ROUTE[clamp(i, 0, ROUTE.length - 2)].seg; }
function openOf(i) { return ROUTE[clamp(i, 0, ROUTE.length - 2)].open || 0; }

// 开阔台地程度（盆景园、西塬、东塬……），在段与段之间平滑过渡
export function openAt(x) {
  const sb = segBlend(x);
  return sb.w < 1 ? lerp(openOf(sb.j), openOf(sb.i), sb.w) : openOf(sb.i);
}
// 满地石块的程度（九重石海），在段与段之间平滑过渡
function seaOf(i) { return ROUTE[clamp(i, 0, ROUTE.length - 2)].sea || 0; }
export function seaAt(x) {
  const sb = segBlend(x);
  return sb.w < 1 ? lerp(seaOf(sb.j), seaOf(sb.i), sb.w) : seaOf(sb.i);
}
// 具体到某一点：营地周围留出一块碎石地，不铺石块（要有地方扎营、生火）
export function seaXZ(x, z) {
  const s = seaAt(x);
  if (s <= 0) return 0;
  const wp = ROUTE[nearestWaypoint(x)];
  return wp.camp ? s * smoothstep(15, 34, Math.hypot(x - wp.x, z - routeZ(wp.x))) : s;
}
// 这块地（x0 起、一块地宽）沾不沾得上符合条件的路段
function chunkTouches(x0, fn) {
  for (let i = 0; i < ROUTE.length - 1; i++) if (ROUTE[i + 1].x > x0 - BLEND && ROUTE[i].x < x0 + CHUNK + BLEND && fn(ROUTE[i])) return true;
  return false;
}
// 开阔台地的截面：几百米宽，两侧几乎感觉不到坡度，远处才圆滑地落下去——站在上面看不到边
function crossOpen(d) {
  const ad = Math.abs(d);
  return -Math.pow(ad / 160, 2) * 6 - Math.pow(Math.max(ad - 190, 0), 1.35) * 0.06;
}

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
  const op = sb.w < 1 ? lerp(openOf(sb.j), openOf(sb.i), sb.w) : openOf(sb.i);
  let off = cross(typeAt(sb.i), d, x) + cliffBand(typeAt(sb.i), d, x, op);
  if (sb.w < 1) off = lerp(cross(typeAt(sb.j), d, x) + cliffBand(typeAt(sb.j), d, x, op), off, sb.w);
  if (op > 0) off = lerp(off, crossOpen(d), op);
  // 石头尖峰：两侧陡落（放在开阔台地混合之后，这样紧挨主台的梁1 也是尖的）
  const sp = spireAt(x);
  // 脊顶留一条四五米宽的走线；往外越来越陡的部分交给原来的截面，两者叠加不超过 40° 左右，失足不至于一路滑进深渊
  if (sp > 0) off -= sp * 17 * (1 - Math.exp(-(Math.hypot(ad, 4) - 4) / 22));
  // 起点和终点之外：平缓谷地
  if (x < -20) off *= smoothstep(-200, -20, x);
  // 远处群山
  const far = smoothstep(180 + op * 220, 900 + op * 200, ad);
  off = Math.max(off, -260 - ad * 0.05);
  if (far > 0) {
    const mtn = N.ridged(x * 0.0016 + 4.0, z * 0.0016, 5) * 420 + N.fbm(x * 0.0007, z * 0.0007, 3) * 180;
    off = lerp(off, off * 0.4 + mtn - 120, far);
  }
  // 细节噪声（路上小，远处大）
  const st = typeAt(sb.i);
  const nearT = smoothstep(3, 22, ad); // 路迹附近地面更平顺
  // 开阔台地上只有平缓的起伏，没有越往外越大的坑坑洼洼
  const grow = 1 - op * 0.85;
  const amp = 0.45 + nearT * 0.9 * (1 - op * 0.4) + Math.min(ad, 120) * 0.05 * grow;
  let det = N.fbm(x * 0.035, z * 0.035, 4) * amp + N.fbm(x * 0.008, z * 0.008, 3) * (2.5 + nearT * 1.5 + Math.min(ad, 300) * 0.08 * grow) * (1 - op * 0.3);
  if (st === 'stone' || st === 'pillars') det += N2.ridged(x * 0.09, z * 0.09, 2) * (0.5 + nearT * 1.1);
  if (sp > 0) det += sp * (N2.ridged(x * 0.055, z * 0.055, 3) - 0.35) * (0.6 + nearT * 2.6);   // 尖峰上的花岗岩棱角
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
  if (wd < flatR * 1.6 && !wp.peak) {   // 尖峰顶不削平
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
const STREAM_WP = ROUTE.findIndex(w => w.name === '平安寺');
export const STREAM = { x0: ROUTE[STREAM_WP].x + 15, x1: ROUTE[STREAM_WP + 2].x - 25, off: 8 };

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
  autumn: { forest: [0.25, 0.19, 0.08], forest2: [0.36, 0.22, 0.09], meadow: [0.42, 0.33, 0.14], meadow2: [0.33, 0.28, 0.12], dead: [0.32, 0.27, 0.19] },
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
  if (ti.ad > 260 + openAt(x) * 260) t = alt < 2900 ? 'forest' : alt < 3350 ? 'meadow' : 'rockfar';
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
  // 石头尖峰：整条峰链都是裸露的花岗岩，只在石缝里有点地衣
  const spk = spireAt(x);
  if (spk > 0) out.lerp(tmpC2.copy(C.rock).lerp(C.lichen, smoothstep(0.2, 0.9, n1) * 0.4), smoothstep(0.05, 0.55, spk) * 0.9);
  const steep = smoothstep(0.82, 0.6, ny);
  out.lerp(ny < 0.5 ? C.cliffDark : C.rock2, steep);
  if (alt > 3550 && ti.ad > 150) out.lerp(C.snow, smoothstep(0.75, 0.95, ny) * smoothstep(3550, 3800, alt) * 0.7);
  if (x < -5 || x > ROUTE_LENGTH - 30) out.lerp(P.meadow2, 0.4);
  // 溪流河床
  if (x > STREAM.x0 && x < STREAM.x1 && Math.abs(ti.d - STREAM.off) < 3.2) out.lerp(C.rock2, 0.6);
  const v = 1 + n2 * 0.07;
  out.r *= v; out.g *= v; out.b *= v;
  return out;
}

// ---------- 几何体资源 ----------
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
// 贴图本身带明暗，树干的底色要比以前亮一倍才是原来的深浅
const TRUNK = new THREE.Color(0.36, 0.25, 0.15), TRUNK_GREY = new THREE.Color(0.52, 0.47, 0.42), BIRCH = new THREE.Color(1.5, 1.46, 1.38);

export function initTerrainAssets(U) {
  MAT.terrain = surfMat(U, { kind: 'ground', terrain: true, vertexColors: true, roughness: 1, metalness: 0 });
  MAT.rock = surfMat(U, { kind: 'rock', vertexColors: true, roughness: 1, scale: 3.4, bump: 1.6, macro: 0.25, lichen: 1 });
  MAT.bark = surfMat(U, { kind: 'bark', vertexColors: true, roughness: 1, scale: 1.0, bump: 1.3, sway: 0.05, snow: 0.5, macro: 0.2 });
  // 树冠内核和远处的简化树冠：实心的一团，带树叶贴图
  MAT.leaf = surfMat(U, { kind: 'leaf', vertexColors: true, roughness: 1, scale: 1.25, bump: 1.6, sway: 0.05, trans: 0.9, macro: 0.4, fastShadow: true });
  // 枝叶面片：贴图自带叶片轮廓（镂空），法线不随正反面翻转；阴影也按轮廓镂空
  const cardMat = (kind) => surfMat(U, { kind: 'ground', plain: true, tex: 0, bump: 0, macro: 0, vertexColors: true, roughness: 0.78, side: THREE.DoubleSide, sway: 0.05, trans: 1.0, noflip: true, map: tex(kind).a, alphaTest: 0.34, alphaToCoverage: !QUAL.lite, fastShadow: true });
  MAT.spray = cardMat('spray'); MAT.bough = cardMat('bough');
  MAT.tree = MAT.leaf;
  MAT.grass = surfMat(U, { kind: 'ground', plain: true, tex: 0, bump: 0, macro: 0, vertexColors: true, roughness: 0.82, side: THREE.DoubleSide, sway: 0.35, grass: true, trans: 1.0, snow: 0.8, fastShadow: true });
  MAT.flower = surfMat(U, { kind: 'ground', plain: true, tex: 0, bump: 0, macro: 0, vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, sway: 0.3, grass: true, trans: 0.8, emissive: 0x0a0a0a, fastShadow: true });
  // 岩石：三种形状 × 两档细节。归一化成“半径 1、顶高 0.75”，和碰撞用的椭球对得上
  const normRock = (g, hard = 30) => {
    const pos = g.attributes.position; let maxY = 0, rr = 0;
    for (let i = 0; i < pos.count; i++) { maxY = Math.max(maxY, pos.getY(i)); rr += Math.hypot(pos.getX(i), pos.getZ(i)); }
    rr /= pos.count; const kx = 0.78 / rr;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * kx, pos.getY(i) * 0.75 / maxY, pos.getZ(i) * kx);
    crease(g, hard);
    g.computeBoundingSphere();
    // 顶点色：贴地的一圈发暗（泥、潮气），顶上略亮
    return paint(g, new THREE.Color(1, 1, 1), (c, x, y, z, nx, ny) => { c.multiplyScalar(0.62 + smoothstep(-0.25, 0.35, y) * 0.3 + Math.max(ny, 0) * 0.14); });
  };
  GEO.rocks = [0, 1, 2].map(s => [2, 1].map(detail => normRock(rockGeo(100 + s * 17, detail, { cuts: 11 + s * 2, rough: 0.2 + s * 0.04 }))));
  // 石海里的石块：数量多得多，所以面数少一档；切面多、起伏小，棱角分明
  GEO.blocks = [0, 1, 2, 3].map(s => [1, 0].map(detail => weld(normRock(rockGeo(300 + s * 23, detail, { cuts: 16 + s * 2, rough: 0.1 + s * 0.03 }), 17))));
  // 万仙阵的石塔
  GEO.cairns = CAIRN_KINDS.map((K, k) => [false, true].map(lo => cairnGeo(700 + k * 37, K, lo)));
  buildGrassGeo();
}

// ---- 万仙阵的石塔：人用石片一块块垒起来的，下大上小，每块都略歪 ----
// n 垒几块；r 最底下那块的半径（米）；lean 垒歪的程度；base 底下先围一圈大石头垫着（几块）；tier 垫两层
const CAIRN_KINDS = [
  { n: 5, r: 0.21 },                         // 四五块的小堆，到小腿
  { n: 9, r: 0.26 },                         // 细细的一摞，齐腰
  { n: 14, r: 0.33 },                        // 齐胸到一人高的石塔
  { n: 11, r: 0.29, lean: 1 },               // 垒歪了的
  { n: 10, r: 0.28, base: 6 },               // 底下一圈石头垫着，上面再垒
  { n: 14, r: 0.34, base: 7, tier: 4 },      // 大石堆：两层底座，上面的塔比人还高
];
const _cv = new THREE.Vector3(), _ce = new THREE.Euler();
function cairnGeo(seed, K, lo) {
  const r = mulberry32(seed);
  const pos = [], col = [];
  // 一块石片：不规则多边形的扁石板，顶面略小一圈（棱是斜的）。rad 半径，th 厚，底面放在 (x, y, z)
  const slab = (rad, th, x, y, z, tiltK = 1) => {
    const n = 5 + ((r() * 3) | 0), a0 = r() * 6.283, el = 0.72 + r() * 0.28, ea = r() * 3.14;
    const tone = 0.9 + r() * 0.42, warm = r();
    const ce = Math.cos(ea), se = Math.sin(ea);
    const bot = [], mid = [], top = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i + (r() - 0.5) * 0.5) / n * 6.283, d = rad * (0.8 + r() * 0.32);
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      const u = px * ce + pz * se, v = (-px * se + pz * ce) * el;          // 略呈长条
      const qx = u * ce - v * se, qz = u * se + v * ce;
      const kb = 0.84 + r() * 0.12, yb = (r() - 0.5) * th * 0.1, yt = th * (0.9 + r() * 0.2);
      bot.push([qx * kb, yb, qz * kb]); mid.push([qx, yt * 0.7, qz]); top.push([qx * 0.8, yt, qz * 0.8]);
    }
    _ce.set((r() - 0.5) * 0.24 * tiltK, 0, (r() - 0.5) * 0.24 * tiltK);
    const cx = 0, cy = th * 0.5, cz = 0;
    const tri = (A, B, C) => {
      // 朝外的那一面才是正面
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (A[0] + B[0] + C[0]) / 3 - cx, my = (A[1] + B[1] + C[1]) / 3 - cy, mz = (A[2] + B[2] + C[2]) / 3 - cz;
      const flip = nx * mx + ny * my + nz * mz < 0;
      for (const P of flip ? [A, C, B] : [A, B, C]) {
        _cv.set(P[0], P[1], P[2]).applyEuler(_ce);
        pos.push(_cv.x + x, _cv.y + y, _cv.z + z);
        const sh = tone * (0.72 + 0.28 * smoothstep(0, th * 0.75, P[1]));      // 压在下面那块上的一圈发暗
        col.push(sh * (1 + (warm - 0.5) * 0.1), sh, sh * (1 - (warm - 0.5) * 0.14));
      }
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (lo) { tri(bot[i], bot[j], top[j]); tri(bot[i], top[j], top[i]); }
      else { tri(bot[i], bot[j], mid[j]); tri(bot[i], mid[j], mid[i]); tri(mid[i], mid[j], top[j]); tri(mid[i], top[j], top[i]); }
    }
    for (let i = 1; i < n - 1; i++) { tri(top[0], top[i], top[i + 1]); if (!lo) tri(bot[0], bot[i], bot[i + 1]); }
  };
  let y = 0, ox = 0, oz = 0, maxR = K.r;
  if (K.base) {
    // 底座：围一圈敦实的石头，中间填一块
    const br = K.r * 1.2;
    for (let i = 0; i < K.base; i++) {
      const a = (i + r() * 0.5) / K.base * 6.283, d = br * (0.85 + r() * 0.3), sr = K.r * (0.72 + r() * 0.4);
      slab(sr, sr * (0.8 + r() * 0.5), Math.cos(a) * d, -sr * 0.2, Math.sin(a) * d, 1.6);
    }
    slab(K.r * 1.25, K.r * 0.85, 0, 0, 0);
    y = K.r * 0.72; maxR = br + K.r * 0.8;
    if (K.tier) {
      for (let i = 0; i < K.tier; i++) {
        const a = (i + r() * 0.5) / K.tier * 6.283, d = br * 0.55, sr = K.r * (0.66 + r() * 0.3);
        slab(sr, sr * (0.7 + r() * 0.4), Math.cos(a) * d, y - sr * 0.12, Math.sin(a) * d, 1.4);
      }
      y += K.r * 0.5;
    }
  }
  const la = r() * 6.283, lean = K.lean || 0;
  for (let i = 0; i < K.n; i++) {
    const t = i / (K.n - 1);
    const rad = K.r * (1 - 0.62 * Math.pow(t, 0.85)) * (0.86 + r() * 0.28);
    const th = Math.max(0.05, rad * (0.42 + r() * 0.4));
    ox += (r() - 0.5) * rad * 0.26 + Math.cos(la) * lean * rad * 0.13; oz += (r() - 0.5) * rad * 0.26 + Math.sin(la) * lean * rad * 0.13;
    slab(rad, th, ox, y - th * 0.1, oz);
    y += th * 0.86;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();          // 不带索引：每个面一条法线，石片的棱是硬的
  g.computeBoundingSphere(); g.computeBoundingBox();
  K.h = y; K.rad = maxR;
  return g;
}

// ---- 草丛：一丛十来片弯弯的草叶，根部颜色深、叶尖亮 ----
function buildGrassGeo() {
  const mk = (blades, segs, seed) => {
    const r = mulberry32(seed);
    const pos = [], col = [], nor = [];
    for (let k = 0; k < blades; k++) {
      const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 0.34, pa = r() * 6.28, ox = Math.cos(pa) * rad, oz = Math.sin(pa) * rad;
      const w = 0.022 + r() * 0.022, h = (0.3 + r() * 0.5) * (1.15 - rad * 1.2), lean = 0.08 + r() * 0.3 + rad * 0.5, la = (rad > 0.08 ? pa : a + 1.57) + (r() - 0.5) * 1.2;
      const cx = Math.cos(a) * w, cz = Math.sin(a) * w, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
      const tone = 0.8 + r() * 0.4;
      // 每片草叶：自下而上几段，越往上越窄、越往外弯
      const ring = (t) => { const b = t * t; return [ox + lx * b, h * (t - 0.12 * b), oz + lz * b, 1 - t * 0.82]; };
      const nx = Math.cos(la) * 0.35, nz = Math.sin(la) * 0.35;
      const push = (x, y, z, t) => { pos.push(x, y, z); const c = (0.34 + 0.66 * t) * tone; col.push(c * (1 - 0.1 * t), c, c * (0.9 - 0.25 * t)); const nl = Math.hypot(nx, 1, nz); nor.push(nx / nl, 1 / nl, nz / nl); };
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const [x0, y0, z0, k0] = ring(t0), [x1, y1, z1, k1] = ring(t1);
        if (s === segs - 1) {
          push(x0 - cx * k0, y0, z0 - cz * k0, t0); push(x0 + cx * k0, y0, z0 + cz * k0, t0); push(x1, y1, z1, t1);
        } else {
          push(x0 - cx * k0, y0, z0 - cz * k0, t0); push(x0 + cx * k0, y0, z0 + cz * k0, t0); push(x1 + cx * k1, y1, z1 + cz * k1, t1);
          push(x0 - cx * k0, y0, z0 - cz * k0, t0); push(x1 + cx * k1, y1, z1 + cz * k1, t1); push(x1 - cx * k1, y1, z1 - cz * k1, t1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    return weld(g);
  };
  // 脚下这一块用密的草丛，周围八块用稀一半的（三角面数差一倍多，远看分不出来）
  GEO.grassLo = mk(9, 2, 77);
  GEO.grass = QUAL.grassHi ? mk(18, 2, 77) : GEO.grassLo;
  // 野花：五片花瓣 + 花心 + 细茎 + 两片小叶
  const parts = [];
  const petalC = new THREE.Color(1, 1, 1);
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2;
    const p = new THREE.CircleGeometry(0.055, 5); p.scale(1, 1.5, 1); p.translate(0, 0.07, 0);
    p.rotateX(-Math.PI / 2 + 0.45); p.rotateY(a); p.translate(0, 0.34, 0);
    parts.push(paint(p, petalC, (c, x, y, z) => { const rr = Math.hypot(x, z); c.multiplyScalar(0.8 + rr * 2.2); }));
  }
  const core = new THREE.SphereGeometry(0.03, 6, 4); core.scale(1, 0.6, 1); core.translate(0, 0.345, 0);
  parts.push(paint(core, new THREE.Color(1.7, 1.3, 0.15)));
  const stem = new THREE.CylinderGeometry(0.006, 0.009, 0.34, 4); stem.translate(0, 0.17, 0);
  parts.push(paint(stem, new THREE.Color(0.22, 0.45, 0.13)));
  for (const s of [-1, 1]) { const lf = new THREE.CircleGeometry(0.05, 4); lf.scale(0.5, 1.6, 1); lf.rotateX(-1.0); lf.rotateY(s * 1.4 + 0.5); lf.translate(s * 0.03, 0.1, 0); parts.push(paint(lf, new THREE.Color(0.2, 0.42, 0.12))); }
  const fl = merge(parts); fl.scale(0.55, 0.62, 0.55);
  const fn = fl.attributes.normal; for (let i = 0; i < fn.count; i++) fn.setXYZ(i, 0, 1, 0);
  GEO.flower = fl;
}

// ---- 树的零件 ----
// 树干：下粗上细、根部外撇、略带弯曲。返回带顶点色的几何体
function trunkGeo(h, r0, r1, color, { seg = 8, rings = 6, bend = 0.12, seed = 1, flare = 0.55, shade = null } = {}) {
  const r = mulberry32(seed);
  const bx = (r() - 0.5) * 2, bz = (r() - 0.5) * 2, ph = r() * 6.28;
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = Math.pow(i / rings, 1.25), y = h * t;
    const rad = (r0 + (r1 - r0) * t) * (1 + flare * Math.exp(-t * 16));
    const ox = bend * bx * Math.sin(t * 2.2 + ph) * h * 0.1 * t, oz = bend * bz * Math.sin(t * 1.7 + ph * 1.3) * h * 0.1 * t;
    for (let j = 0; j <= seg; j++) {
      const a = j / seg * Math.PI * 2;
      const k = 1 + 0.12 * Math.sin(a * 3 + ph + t * 3) * (1 - t);
      pos.push(ox + Math.cos(a) * rad * k, y, oz + Math.sin(a) * rad * k);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // 接缝处两列顶点法线对齐
  const nor = g.attributes.normal;
  for (let i = 0; i <= rings; i++) { const a = i * (seg + 1), b = a + seg; const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b), l = Math.hypot(x, y, z) || 1; nor.setXYZ(a, x / l, y / l, z / l); nor.setXYZ(b, x / l, y / l, z / l); }
  const ng = g.toNonIndexed();
  return paint(ng, color, (c, x, y, z) => { c.multiplyScalar(0.72 + smoothstep(0, h * 0.25, y) * 0.28); if (shade) shade(c, x, y, z); });
}
const _la = new THREE.Vector3(), _lb = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _lq = new THREE.Quaternion();
// 一根枝条：从 a 到 b 的锥形圆管
function limb(a, b, ra, rb, color, seg = 5) {
  _la.set(a[0], a[1], a[2]); _lb.set(b[0], b[1], b[2]);
  const len = _la.distanceTo(_lb);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, true); g.translate(0, len / 2, 0);
  _lq.setFromUnitVectors(_up, _lb.clone().sub(_la).normalize());
  g.applyQuaternion(_lq); g.translate(a[0], a[1], a[2]);
  return paint(g.toNonIndexed(), color);
}
// 一团树叶：抖动过的球，法线向外鼓——受光像一整团蓬松的叶子；底部和朝里的一面压暗（自遮蔽）
function blob(radius, detail, seed, color, { jit = 0.3, s = [1, 1, 1], p = [0, 0, 0], k = 0.45, dark = 0.38 } = {}) {
  const r = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(radius, detail);
  displace(g, (v) => { const m = 1 + (r() - 0.5) * jit * 2; v.multiplyScalar(m); });
  g.scale(s[0], s[1], s[2]);
  const sm = crease(g, 80);
  puff(sm, 0, -radius * s[1] * 0.4, 0, k);
  sm.translate(p[0], p[1], p[2]);
  const tone = 0.76 + r() * 0.44, hue = r();
  const cc = color.clone(); cc.r *= 0.9 + hue * 0.22; cc.g *= 0.96 + (1 - hue) * 0.1; cc.b *= 1.1 - hue * 0.22;
  return paint(sm, cc, (c, x, y, z, nx, ny) => {
    const up = ny * 0.5 + 0.5;                       // 朝天的面亮，朝地的面暗
    c.multiplyScalar(tone * (dark + (1 - dark) * up * up) * (0.9 + 0.2 * ((Math.sin(x * 9.1 + z * 7.3 + y * 5.7) + 1) * 0.5)));
  });
}
// 冷杉的一层枝：伞状、边缘分瓣下垂，下表面是深色的
function skirt(R, h, droop, lobes, seg, seed, color, y0) {
  const r = mulberry32(seed), ph = r() * 6.28;
  const prof = [[0.1, h, 1.05], [0.5, h * 0.52, 1.0], [0.82, h * 0.2, 0.92], [1.0, -droop, 0.8], [0.52, -droop * 0.25 - 0.02, 0.3], [0.1, h * 0.12, 0.22]];
  const pos = [], shade = [], idx = [];
  const jit = []; for (let j = 0; j < seg; j++) jit.push(0.85 + r() * 0.3);
  prof.forEach(([pr, py, sh], i) => {
    for (let j = 0; j <= seg; j++) {
      const a = j / seg * Math.PI * 2;
      const lobe = (0.76 + 0.24 * Math.cos(lobes * a + ph)) * jit[j % seg];
      const k = i === 3 ? lobe : i === 2 ? 0.5 + 0.5 * lobe : i === 4 ? 0.7 + 0.3 * lobe : 1;
      const rad = R * pr * k;
      pos.push(Math.cos(a) * rad, y0 + py - (i === 3 ? droop * (lobe - 0.76) * 1.5 : 0), Math.sin(a) * rad);
      shade.push(sh);
    }
  });
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const nor = g.attributes.normal;
  for (let i = 0; i < prof.length; i++) { const a = i * (seg + 1), b = a + seg; const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b), l = Math.hypot(x, y, z) || 1; nor.setXYZ(a, x / l, y / l, z / l); nor.setXYZ(b, x / l, y / l, z / l); }
  const arr = new Float32Array(shade.length * 3);
  const tone = 0.9 + r() * 0.25;
  for (let i = 0; i < shade.length; i++) { const s = shade[i] * tone; arr[i * 3] = color.r * s; arr[i * 3 + 1] = color.g * s; arr[i * 3 + 2] = color.b * s; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g.toNonIndexed();
}

// ---- 枝叶面片 ----
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3();
// 一片枝叶：从 base 沿 dir 伸出去的一条弯曲面片（贴图的 v 方向沿着枝条，根部在 v=0）。
// side 是面片的横向；droop > 0 末端下垂、< 0 上翘。nrm(x,y,z,out) 给每个顶点一个法线（让整团树冠受光连成一片）
function card(base, dir, side, len, wid, droop, c0, c1, nrm, rows = 3) {
  const pos = [], uv = [], col = [], nor = [], idx = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const cx = base[0] + dir[0] * len * t, cy = base[1] + dir[1] * len * t - droop * len * t * t, cz = base[2] + dir[2] * len * t;
    for (const s of [-0.5, 0.5]) {
      const x = cx + side[0] * wid * s, y = cy + side[1] * wid * s, z = cz + side[2] * wid * s;
      pos.push(x, y, z); uv.push(s + 0.5, 0.015 + t * 0.97);
      col.push(c0.r + (c1.r - c0.r) * t, c0.g + (c1.g - c0.g) * t, c0.b + (c1.b - c0.b) * t);
      nrm(x, y, z, _c1); nor.push(_c1.x, _c1.y, _c1.z);
    }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// 一团树冠：从团心往四面八方伸出去的十来片枝叶 + 团心一个深色的实心核（挡住透光的窟窿）
// 返回 { cards, core }。flat < 1 时压扁成一层（盆景、杜鹃）；droopK 叶片下垂的程度
function lobe(center, R, n, color, seed, { flat = 1, droopK = 0.22, size = 1, upBias = 0.25, coreK = 0.5 } = {}) {
  const r = mulberry32(seed);
  const cards = [];
  const [cx, cy, cz] = center;
  const nrm = (x, y, z, out) => out.set(x - cx, (y - cy) / flat + R * 0.45, z - cz).normalize();
  for (let i = 0; i < n; i++) {
    // 方向：均匀撒在球面上，略偏上
    const u = (i + r()) / n, th = r() * 6.2832 + i * 2.39996;
    let dy = 1 - 2 * u * (1 - upBias) - upBias * 0.3; dy = Math.max(-0.75, Math.min(1, dy));
    const rr = Math.sqrt(Math.max(0, 1 - dy * dy));
    const d = _c2.set(Math.cos(th) * rr, dy * flat, Math.sin(th) * rr).normalize();
    const inner = 0.12 + r() * 0.3;
    const base = [cx + d.x * R * inner, cy + d.y * R * inner, cz + d.z * R * inner];
    const dir = [d.x + (r() - 0.5) * 0.5, d.y + (r() - 0.5) * 0.35, d.z + (r() - 0.5) * 0.5];
    const dl = Math.hypot(dir[0], dir[1], dir[2]); dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;
    // 面片朝向：绕枝条随机转一个角度
    _c3.set(r() - 0.5, r() - 0.5, r() - 0.5).cross(_c1.set(dir[0], dir[1], dir[2])).normalize();
    const side = [_c3.x, _c3.y, _c3.z];
    const len = R * (0.82 + r() * 0.42) * size, wid = len * (0.78 + r() * 0.2);
    const tone = 0.78 + r() * 0.44, hue = r();
    const up = 0.5 + 0.5 * d.y;                       // 朝天的亮，朝地的暗
    const k1 = tone * (0.55 + 0.45 * up), k0 = k1 * 0.5;
    const c1 = new THREE.Color(color.r * k1 * (0.92 + hue * 0.18), color.g * k1, color.b * k1 * (1.08 - hue * 0.2));
    const c0 = new THREE.Color(color.r * k0, color.g * k0, color.b * k0);
    cards.push(card(base, dir, side, len, wid, droopK * (0.5 + r()), c0, c1, nrm));
  }
  const core = coreK > 0 ? blob(R * coreK, 0, seed + 7, color.clone().multiplyScalar(0.42), { jit: 0.3, s: [1, flat, 1], p: center, dark: 0.6 }) : null;
  return { cards, core };
}
// 针叶树的一根枝：一片平着的（俯视看得见）+ 一片立着的（侧面看有厚度）
function boughPair(base, ang, len, pitch, color, tone, r, finK = 0.5, droop = 0.12) {
  const cp = Math.cos(pitch), dir = [Math.cos(ang) * cp, Math.sin(pitch), Math.sin(ang) * cp];
  const sideH = [-Math.sin(ang), 0, Math.cos(ang)];
  const nrm = (x, y, z, out) => out.set(Math.cos(ang) * 0.55, 0.9, Math.sin(ang) * 0.55).normalize();
  const k1 = tone, k0 = tone * 0.45;
  const c1 = new THREE.Color(color.r * k1, color.g * k1, color.b * k1), c0 = new THREE.Color(color.r * k0, color.g * k0, color.b * k0);
  const out = [card(base, dir, sideH, len, len * (0.62 + r() * 0.12), droop, c0, c1, nrm)];
  if (finK > 0) {
    const nrm2 = (x, y, z, o) => o.set(Math.cos(ang) * 0.75 + sideH[0] * 0.3, 0.6, Math.sin(ang) * 0.75 + sideH[2] * 0.3).normalize();
    const c1b = c1.clone().multiplyScalar(0.82), c0b = c0.clone().multiplyScalar(0.82);
    out.push(card([base[0], base[1] - len * 0.04, base[2]], dir, [0, 1, 0], len * 0.96, len * finK, droop, c0b, c1b, nrm2));
  }
  return out;
}
const HI_MATS = {};
const HI_DIST = () => (QUAL.lite ? 0 : 1);      // 精细的石头用到第几圈地块：手机只用脚下这一块
// 树按“每一棵离人多远”分三档：精细（树干 + 全部枝叶面片）/ 中等（面片减半、树干简化）/ 简化（几团叶子）。[精细到多少米, 中等到多少米]
const TREE_LOD = () => (QUAL.lite ? [34, 80] : [58, 135]);
const lodGeo = (kind, lod) => GEO[kind][lod === 0 ? 0 : lod === 1 ? 2 : 1];
const lodMat = (kind, lod) => (lod < 2 ? HI_MATS[kind] : MAT.leaf);

// 每局开始时按季节生成树木几何。GEO[kind] = [近处精细版（树干 / 枝叶面片 / 树冠内核 三组材质）, 远处简化版（单材质）, 中距离版（同样三组材质）]
export function buildVegetation(seasonKey) {
  const sk = seasonKey;
  for (const k of ['fir', 'larch', 'birch', 'maple', 'maple2', 'bonsai', 'rhodo', 'shrub', 'dead']) if (GEO[k]) for (const g of GEO[k]) g.dispose();
  if (GEO.bloom) GEO.bloom.dispose();
  const fc = (kind, k = 1.2) => FOL[kind][sk] ? col3(FOL[kind][sk]).multiplyScalar(k) : null;
  const pack = (kind, bark, cards, cores, lo, conifer) => {
    const cs = cores.filter(Boolean), cm = conifer ? MAT.bough : MAT.spray;
    const hi = weld(merge(null, [bark, cards, cs]));
    // 中距离版（材质分组和精细版一样）：枝叶面片减半——层层叠叠的面片是最费的；阔叶树隔一片留一片，
    // 针叶树的枝是“平 + 立”成对的，平的全留、立的隔一根留一根。树冠内核露得多了，提亮一点免得树冠发黑。
    // 树干枝杈不多的照旧，枝杈太多的（落叶松）只留主干。没有叶子的树（枯树、冬天的落叶树）本来就省，直接用精细版
    let mid = hi;
    if (cards.length) {
      const tris = (list) => list.reduce((n, g) => n + (g.index ? g.index.count : g.attributes.position.count) / 3, 0);
      const mc = cs.map(g => { const c = g.clone(), a = c.attributes.color; for (let i = 0; i < a.array.length; i++) a.array[i] *= 1.3; return c; });
      mid = weld(merge(null, [tris(bark) <= 300 ? bark : [lo[0]], cards.filter((_, i) => (conifer ? i % 4 !== 3 : i % 2 === 0)), mc]));
      for (const c of mc) c.dispose();
    }
    GEO[kind] = [hi, weld(merge(lo)), mid];
    HI_MATS[kind] = [MAT.bark, cm, MAT.leaf];
  };

  // 冷杉：一轮轮向外平伸、末端下垂的枝；中间一根深色的锥芯挡住透光
  {
    const f = fc('fir', 1.75), fl = fc('fir'); f.r *= 1.12; f.b *= 0.72;
    const r0 = mulberry32(11);
    const bark = [trunkGeo(7.5, 0.22, 0.03, TRUNK, { seed: 11, bend: 0.05 })];
    const cards = [], cores = [], lo = [trunkGeo(3, 0.2, 0.08, TRUNK, { seg: 5, rings: 2, seed: 11, bend: 0 })];
    const tiers = 11;
    for (let k = 0; k < tiers; k++) {
      const u = k / (tiers - 1);
      const R = lerp(2.05, 0.42, Math.pow(u, 0.85)), y = 1.15 + k * 0.6;
      const nb = k < 4 ? 7 : k < 8 ? 6 : 5;
      for (let b = 0; b < nb; b++) {
        const a = b / nb * 6.2832 + k * 0.77 + (r0() - 0.5) * 0.35;
        const len = R * (0.88 + r0() * 0.26);
        cards.push(...boughPair([Math.cos(a) * 0.05, y + (r0() - 0.5) * 0.18, Math.sin(a) * 0.05], a, len, -0.16 - r0() * 0.14 + u * 0.3, f, 0.72 + r0() * 0.36 + u * 0.2, r0, 0.46, 0.16 * (1 - u)));
      }
    }
    // 树尖
    for (let b = 0; b < 3; b++) cards.push(...boughPair([0, 7.45, 0], b * 2.094, 0.7, 1.15, f, 1.15, r0, 0, 0));
    cores.push(paint(xf(new THREE.ConeGeometry(0.62, 6.3, 7, 3, true), { p: [0, 4.4, 0] }).toNonIndexed(), fl.clone().multiplyScalar(0.36)));
    for (let k = 0; k < 4; k++) { const u = k / 3; lo.push(skirt(lerp(1.95, 0.5, u), lerp(2.3, 1.7, u), 0.3, 5, 7, 320 + k, fl.clone().multiplyScalar(0.9 + u * 0.3), 1.3 + k * 1.6)); }
    pack('fir', bark, cards, cores, lo, true);
  }
  // 太白红杉（落叶松）：稀疏通透，枝条略上扬，一簇簇短针
  {
    const f = fc('larch', 1.7), fl = fc('larch');
    const r0 = mulberry32(31);
    const bark = [trunkGeo(7.6, 0.2, 0.03, TRUNK, { seed: 31, bend: 0.1 })];
    const cards = [], lo = [trunkGeo(7.4, 0.2, 0.04, TRUNK, { seg: 5, rings: 3, seed: 31, bend: 0.1 })];
    const NT = 13;
    for (let k = 0; k < NT; k++) {
      const u = k / (NT - 1), y = 1.6 + k * 0.47, rad = lerp(1.8, 0.4, Math.pow(u, 0.9));
      const nb = k < 8 ? 6 : 5;
      for (let b = 0; b < nb; b++) {
        const a = b / nb * 6.2832 + k * 0.9 + r0() * 0.5, len = rad * (0.8 + r0() * 0.4), pitch = -0.04 + r0() * 0.2 + u * 0.25;
        bark.push(limb([0, y, 0], [Math.cos(a) * len * 0.8, y + Math.sin(pitch) * len * 0.8, Math.sin(a) * len * 0.8], 0.035, 0.008, TRUNK, 3));
        if (f) cards.push(...boughPair([Math.cos(a) * 0.04, y + (r0() - 0.5) * 0.15, Math.sin(a) * 0.04], a, len, pitch, f, 0.72 + r0() * 0.42, r0, 0.44, 0.24));
        else if (b % 2 === 0) { const e = [Math.cos(a) * len * 0.8, y + Math.sin(pitch) * len * 0.8, Math.sin(a) * len * 0.8]; for (let q = -1; q <= 1; q += 2) bark.push(limb(e, [e[0] + Math.cos(a + q * 0.6) * 0.5, e[1] + 0.12, e[2] + Math.sin(a + q * 0.6) * 0.5], 0.01, 0.003, TRUNK, 3)); }
      }
      // 远处的简化版：一层层压扁的圆盘
      if (k % 2 === 0) { const c2 = fl || TRUNK.clone().multiplyScalar(0.8); lo.push(blob(rad * 0.92, 0, 430 + k, c2, { jit: 0.35, s: [1.0, fl ? 0.3 : 0.08, 1.0], p: [0, y + 0.05, 0], dark: 0.6 })); }
    }
    pack('larch', bark, cards, [], lo, true);
  }
  // 白桦：白树皮带黑色横纹，细高的树干，枝梢下垂的小叶
  {
    const f = fc('birch', 1.55), fl = fc('birch');
    const mark = (c, x, y, z) => { const hh = Math.sin(y * 7.3 + Math.atan2(z, x) * 2) * Math.sin(y * 3.1 + x * 9); if (hh > 0.5) c.setRGB(0.16, 0.15, 0.14); else if (y < 0.5) c.multiplyScalar(0.55); };
    const bark = [trunkGeo(6.4, 0.15, 0.035, BIRCH, { seed: 41, bend: 0.25, rings: 9, seg: 8, flare: 0.3, shade: mark })];
    const cards = [], cores = [], lo = [trunkGeo(4.6, 0.15, 0.07, BIRCH, { seg: 5, rings: 3, seed: 41, bend: 0.25, flare: 0.3 })];
    const r0 = mulberry32(41);
    for (let b = 0; b < 7; b++) {
      const a = b * 2.2 + r0() * 0.6, y = 2.7 + b * 0.5, len = 1.55 - b * 0.1;
      const e = [Math.cos(a) * len, y + len * 0.8, Math.sin(a) * len];
      const m = [e[0] * 0.55, y + len * 0.5, e[2] * 0.55];
      bark.push(limb([0, y, 0], m, 0.05, 0.03, BIRCH, 4)); bark.push(limb(m, e, 0.03, 0.01, BIRCH, 4));
      if (f) {
        const L1 = lobe(e, 0.78 + r0() * 0.18, 12, f, 60 + b, { droopK: 0.5, size: 0.95, coreK: 0.5 }); cards.push(...L1.cards); cores.push(L1.core);
        const L2 = lobe([m[0] * 1.15, m[1] + 0.2, m[2] * 1.15], 0.6, 6, f.clone().multiplyScalar(0.9), 80 + b, { droopK: 0.5, size: 0.95, coreK: 0 }); cards.push(...L2.cards);
      } else {
        for (let q = 0; q < 4; q++) { const a2 = a + (q - 1.5) * 0.6; bark.push(limb(e, [e[0] + Math.cos(a2) * 0.7, e[1] + 0.5 - q * 0.2, e[2] + Math.sin(a2) * 0.7], 0.012, 0.003, BIRCH, 3)); }
      }
    }
    if (f) {
      const Lt = lobe([0.1, 6.5, 0], 0.85, 10, f.clone().multiplyScalar(1.08), 77, { droopK: 0.4, coreK: 0.4 }); cards.push(...Lt.cards); cores.push(Lt.core);
      for (let b = 0; b < 4; b++) { const a = b * 1.7 + 0.3; lo.push(blob(0.78 + (b % 2) * 0.16, 0, 66 + b, fl.clone().multiplyScalar(0.88 + (b % 3) * 0.12), { jit: 0.5, s: [1, 1.1, 1], p: [Math.cos(a) * 0.85, 3.9 + b * 0.62, Math.sin(a) * 0.85], dark: 0.5 })); }
      lo.push(blob(0.85, 0, 71, fl.clone().multiplyScalar(1.1), { jit: 0.5, s: [1, 1.2, 1], p: [0.1, 6.5, 0] }));
    }
    pack('birch', bark, cards, cores, lo, false);
  }
  // 槭树（秋天红 / 橙两种）：粗干、四五根大杈、每根杈头一团叶子，合起来是个宽阔的树冠
  for (const kind of ['maple', 'maple2']) {
    const f = fc(kind, 1.55), fl = fc(kind);
    const sd = kind === 'maple' ? 17 : 23;
    const r0 = mulberry32(sd);
    const bark = [trunkGeo(3.2, 0.3, 0.17, TRUNK, { seed: sd, bend: 0.3, rings: 5, flare: 0.7 })];
    const cards = [], cores = [], lo = [trunkGeo(3.2, 0.3, 0.14, TRUNK, { seg: 5, rings: 2, seed: sd, bend: 0.3 })];
    const nl = 5;
    for (let b = 0; b < nl; b++) {
      const a = b / nl * 6.2832 + r0() * 0.5, len = 2.0 + r0() * 0.7, rise = 0.62 + r0() * 0.25;
      const m = [Math.cos(a) * len * 0.42, 3.0 + len * rise * 0.5, Math.sin(a) * len * 0.42];
      const e = [Math.cos(a) * len * 0.82, 3.0 + len * rise, Math.sin(a) * len * 0.82];
      bark.push(limb([0, 2.85, 0], m, 0.14, 0.08, TRUNK, 5)); bark.push(limb(m, e, 0.08, 0.03, TRUNK, 5));
      // 杈上再分两根细枝
      const subs = [];
      for (let q = 0; q < 2; q++) { const a2 = a + (q ? 0.9 : -0.9) + (r0() - 0.5) * 0.4; const se = [m[0] + Math.cos(a2) * 1.1, m[1] + 0.5 + r0() * 0.5, m[2] + Math.sin(a2) * 1.1]; bark.push(limb(m, se, 0.045, 0.012, TRUNK, 4)); subs.push(se); }
      if (f) {
        const L1 = lobe(e, 1.15 + r0() * 0.3, 17, f.clone().multiplyScalar(0.92 + r0() * 0.2), sd * 10 + b, { coreK: 0.56 }); cards.push(...L1.cards); cores.push(L1.core);
        for (const se of subs) { const L2 = lobe(se, 0.85 + r0() * 0.2, 11, f.clone().multiplyScalar(0.85 + r0() * 0.25), sd * 20 + b * 3 + (se === subs[0] ? 1 : 2), { coreK: 0.52 }); cards.push(...L2.cards); cores.push(L2.core); }
      } else {
        for (const se of [e, ...subs]) for (let q = 0; q < 3; q++) { const a2 = a + (q - 1) * 0.8; bark.push(limb(se, [se[0] + Math.cos(a2) * 0.7, se[1] + 0.35 + r0() * 0.4, se[2] + Math.sin(a2) * 0.7], 0.02, 0.005, TRUNK, 3)); }
      }
    }
    if (f) {
      const Lt = lobe([0, 5.9, 0], 1.3, 18, f.clone().multiplyScalar(1.1), sd * 30, { coreK: 0.58 }); cards.push(...Lt.cards); cores.push(Lt.core);
      // 远处的简化版：也按“几根大杈各顶一团”来摆，轮廓是凹凸不平的一丛，不是一个圆球
      for (let b = 0; b < nl; b++) { const a = b / nl * 6.2832 + 0.4; lo.push(blob(1.25 + (b % 2) * 0.25, 0, 98 + sd + b, fl.clone().multiplyScalar(0.85 + (b % 3) * 0.14), { jit: 0.5, s: [1.15, 0.78, 1.15], p: [Math.cos(a) * 1.75, 4.5 + (b % 2) * 0.5, Math.sin(a) * 1.75], dark: 0.45 })); }
      lo.push(blob(1.35, 0, 97 + sd, fl.clone().multiplyScalar(1.1), { jit: 0.5, s: [1.1, 0.8, 1.1], p: [0.1, 5.9, -0.1], dark: 0.5 }));
    }
    pack(kind, bark, cards, cores, lo, false);
  }
  // 盆景园：虬曲矮冷杉，枝叶一层层平展
  {
    const f = fc('fir', 1.9), fl = fc('fir'); f.r *= 1.12; f.b *= 0.72;
    const r0 = mulberry32(9);
    const bark = [], cards = [], cores = [], lo = [];
    let p = [0, 0, 0];
    const pad = (c, R, seed) => {
      const n = 7;
      for (let b = 0; b < n; b++) { const a = b / n * 6.2832 + r0(); cards.push(...boughPair([c[0], c[1], c[2]], a, R * (0.85 + r0() * 0.3), 0.04 + r0() * 0.1, f, 1.0 + r0() * 0.4, r0, 0.3, 0.08)); }
      cores.push(blob(R * 0.6, 0, seed, fl.clone().multiplyScalar(0.8), { jit: 0.3, s: [1.2, 0.22, 1.2], p: [c[0], c[1] - 0.03, c[2]], dark: 0.6 }));
    };
    for (let s = 0; s < 4; s++) {
      const q = [p[0] + (r0() - 0.5) * 0.9, p[1] + 0.62, p[2] + (r0() - 0.5) * 0.9];
      bark.push(limb(p, q, 0.2 - s * 0.04, 0.16 - s * 0.04, TRUNK_GREY, 6));
      if (s > 0) {
        const a = r0() * 6.28, l = 0.9 + r0() * 0.5, e = [q[0] + Math.cos(a) * l, q[1] + 0.08, q[2] + Math.sin(a) * l];
        bark.push(limb(q, e, 0.05, 0.02, TRUNK_GREY, 4));
        pad(e, 0.85 + r0() * 0.25, 20 + s);
      }
      p = q;
    }
    pad([p[0], p[1] + 0.12, p[2]], 1.0, 29);
    lo.push(limb([0, 0, 0], p, 0.2, 0.06, TRUNK_GREY, 4));
    lo.push(blob(1.25, 0, 28, fl.clone().multiplyScalar(1.2), { jit: 0.3, s: [1.4, 0.3, 1.4], p: [p[0], p[1] + 0.1, p[2]], dark: 0.5 }));
    lo.push(blob(0.9, 0, 27, fl.clone().multiplyScalar(1.1), { jit: 0.3, s: [1.3, 0.3, 1.3], p: [p[0] * 0.3 + 0.7, p[1] * 0.6, p[2] * 0.3 - 0.4], dark: 0.5 }));
    pack('bonsai', bark, cards, cores, lo, true);
  }
  // 杜鹃灌丛 + 花簇
  {
    const f = fc('rhodo', 1.7), fl = fc('rhodo');
    const r0 = mulberry32(13);
    const bark = [], cards = [], cores = [], lo = [], bloomPts = [];
    for (let k = 0; k < 5; k++) {
      const ox = (r0() - 0.5) * 1.2, oz = (r0() - 0.5) * 1.2, oy = 0.42 + r0() * 0.3, rad = 0.5 + r0() * 0.2;
      bark.push(limb([ox * 0.2, 0, oz * 0.2], [ox, oy, oz], 0.04, 0.02, TRUNK, 4));
      const L1 = lobe([ox, oy, oz], rad, 9, f.clone().multiplyScalar(0.88 + r0() * 0.3), 40 + k, { flat: 0.75, droopK: 0.15, upBias: 0.5, coreK: 0.62 }); cards.push(...L1.cards); cores.push(L1.core);
      for (let b = 0; b < 5; b++) { const a = r0() * 6.28, rr = r0() * rad * 0.9; bloomPts.push([ox + Math.cos(a) * rr, oy + rad * 0.62 * Math.sqrt(Math.max(0, 1 - (rr / (rad * 1.2)) ** 2)) + 0.05, oz + Math.sin(a) * rr]); }
    }
    lo.push(blob(1.0, 0, 46, fl, { jit: 0.3, s: [1.3, 0.62, 1.3], p: [0, 0.55, 0], dark: 0.5 }));
    pack('rhodo', bark, cards, cores, lo, false);
    const bl = bloomPts.map(([x, y, z], i) => paint(xf(crease(new THREE.IcosahedronGeometry(0.1 + (i % 3) * 0.02, 0), 80), { p: [x, y, z], s: [1, 0.7, 1] }), new THREE.Color(1, 1, 1), (c, px, py) => c.multiplyScalar(py > y ? 1.15 : 0.8)));
    GEO.bloom = merge(bl);
  }
  // 灌木 / 箭竹
  {
    const f = fc('shrub', 1.6), fl = fc('shrub');
    const r0 = mulberry32(53);
    const bark = [], cards = [], cores = [], lo = [];
    for (let k = 0; k < 4; k++) {
      const ox = (r0() - 0.5) * 1.0, oz = (r0() - 0.5) * 1.0, oy = 0.36 + r0() * 0.18;
      bark.push(limb([ox * 0.3, 0, oz * 0.3], [ox, oy, oz], 0.03, 0.015, TRUNK, 3));
      const L1 = lobe([ox, oy, oz], 0.46 + r0() * 0.2, 8, f.clone().multiplyScalar(0.88 + r0() * 0.3), 140 + k, { flat: 0.85, upBias: 0.45, coreK: 0.55 }); cards.push(...L1.cards); cores.push(L1.core);
    }
    lo.push(blob(0.9, 0, 48, fl, { jit: 0.4, s: [1.1, 0.7, 1.1], p: [0, 0.45, 0], dark: 0.5 }));
    pack('shrub', bark, cards, cores, lo, false);
  }
  // 火烧坡枯树：烧黑的树桩、风化发白的树干、折断的枝
  {
    const dc = new THREE.Color(0.86, 0.82, 0.76);
    const char = (c, x, y) => { if (y < 1.4) c.multiplyScalar(lerp(0.22, 1, smoothstep(0.5, 1.4, y))); };
    const r = mulberry32(5);
    const bark = [trunkGeo(6.8, 0.22, 0.05, dc, { seed: 5, bend: 0.3, rings: 7, flare: 0.5, shade: char })];
    const lo = [trunkGeo(6.8, 0.22, 0.05, dc, { seg: 5, rings: 3, seed: 5, bend: 0.3, shade: char })];
    for (let k = 0; k < 7; k++) {
      const a = r() * 6.28, y = 2 + k * 0.68, len = 0.7 + r() * 1.1;
      const e = [Math.cos(a) * len, y + len * (0.2 + r() * 0.5), Math.sin(a) * len];
      bark.push(limb([0, y, 0], e, 0.05, 0.012, dc, 4));
      if (k % 2) bark.push(limb(e, [e[0] * 1.3, e[1] + 0.35, e[2] * 1.3 + 0.2], 0.012, 0.004, dc, 3));
      if (k % 3 === 0) lo.push(limb([0, y, 0], e, 0.05, 0.012, dc, 3));
    }
    pack('dead', bark, [], [], lo, false);
  }
  // 远山上的林子：五百米开外的地块只铺极简的树（针叶是两层锥，阔叶是一丛），数量少一些、个头大一些
  if (!GEO.farCone) {
    const shade = (c, x, y) => c.multiplyScalar(0.5 + 0.5 * smoothstep(0.3, 3.2, y));
    GEO.farCone = merge([
      paint(xf(new THREE.ConeGeometry(1.0, 2.3, 6, 1, true), { p: [0, 1.6, 0] }).toNonIndexed(), new THREE.Color(1, 1, 1), shade),
      paint(xf(new THREE.ConeGeometry(0.64, 2.0, 6, 1, true), { p: [0, 3.0, 0], r: [0, 0.5, 0] }).toNonIndexed(), new THREE.Color(1, 1, 1), shade),
    ]);
    const rb = mulberry32(71), bg = new THREE.IcosahedronGeometry(1, 0);
    displace(bg, (v) => v.multiplyScalar(0.8 + rb() * 0.45));
    GEO.farBlob = paint(xf(crease(bg, 80), { s: [1, 0.72, 1], p: [0, 1.9, 0] }), new THREE.Color(1, 1, 1), (c, x, y) => c.multiplyScalar(0.5 + 0.5 * smoothstep(1.3, 2.6, y)));
  }
  FAR_COL = {};
  for (const k of ['fir', 'larch', 'birch', 'maple', 'maple2']) FAR_COL[k] = FOL[k][sk] ? col3(FOL[k][sk]).multiplyScalar(1.25) : null;
  VEG_SEASON = sk;
}
let VEG_SEASON = null;
let FAR_COL = {};

// 给远处的地块（树木实例还没生成的那几圈）铺一层极简的树。规则和近处一致：什么海拔长什么树，陡坡和路上不长
function buildFarTrees(chunk) {
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
  const rnd = mulberry32((chunk.cx * 40503) ^ (chunk.cz * 69069) ^ 0x2f6e2b1);
  const cones = [], blobs = [];
  const tries = QUAL.lite ? 260 : 420;
  for (let n = 0; n < tries; n++) {
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    const r1 = rnd(), r2 = rnd(), r3 = rnd();
    const ti = terrainInfo(x, z);
    if (ti.ad < 4) continue;
    let t = ti.type; if (ti.ad > 260 + openAt(x) * 260) t = 'far';
    const y = heightAt(x, z), alt = yToAlt(y);
    let tp = 0, kind = null;
    if (t === 'forest' || t === 'far') {
      if (alt < 2300) { tp = 0.45; kind = r2 < 0.3 ? 'maple' : r2 < 0.5 ? 'maple2' : r2 < 0.72 ? 'birch' : 'fir'; }
      else if (alt < 2700) { tp = 0.42; kind = r2 < 0.35 ? 'birch' : r2 < 0.45 ? 'maple2' : 'fir'; }
      else if (alt < 3050) { tp = 0.38; kind = r2 < 0.65 ? 'fir' : 'larch'; }
      else if (alt < 3350) { tp = 0.16; kind = 'larch'; }
    } else if (t === 'dead') { tp = 0.1; kind = 'fir'; }
    else if (t === 'gully') { tp = 0.5; kind = r2 < 0.45 ? 'maple' : r2 < 0.75 ? 'birch' : 'maple2'; }
    else if (t === 'meadow' && alt < 3250) { tp = 0.1; kind = 'larch'; }
    if (!kind || r1 > tp) continue;
    const col = FAR_COL[kind];
    if (!col) continue;                        // 冬天落了叶的树：远看只剩细枝，不画
    if (slopeNY(x, z) < 0.72) continue;
    const s = (0.85 + r3 * 0.6) * 1.55, v = 0.8 + rnd() * 0.4;
    (kind === 'fir' || kind === 'larch' ? cones : blobs).push({ x, y: y - 0.3, z, s, sy: kind === 'birch' ? 1.5 : kind === 'larch' ? 1.15 : 1, sx: kind === 'birch' ? 0.62 : kind === 'larch' ? 0.8 : 1, rot: rnd() * 6.28, r: col.r * v, g: col.g * v, b: col.b * (v * 0.9 + 0.1) });
  }
  const group = new THREE.Group();
  for (const [list, geo, k] of [[cones, GEO.farCone, 1.9], [blobs, GEO.farBlob, 2.5]]) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, MAT.leaf, list.length);
    list.forEach((t, i) => {
      _q.setFromEuler(_e.set(0, t.rot, 0));
      _s.set(t.s * k * t.sx, t.s * k * t.sy, t.s * k * t.sx);
      _p.set(t.x, t.y, t.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      im.setColorAt(i, tmpC2.setRGB(t.r, t.g, t.b));
    });
    im.castShadow = false; im.receiveShadow = false;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group.children.length ? group : null;
}

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
  constructor(cx, cz) { this.cx = cx; this.cz = cz; this.res = 0; this.mesh = null; this.objs = null; this.grass = null; this.rocks = []; this.trees = []; this.treeSets = []; }
}

function buildTerrainGeo(cx, cz, res) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const step = CHUNK / res;
  const vn = res + 3; // 含裙边
  const count = vn * vn;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3), ter = new Float32Array(count * 4);
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
    // 给着色器的分层信息：x 碎石覆盖度  y 离路迹中线的横向距离  z 这里有没有踩出来的小路  w 石海（满地石块）
    const ti = terrainInfo(x, z), tt = ti.type, alt = yToAlt(y), k4 = (j * vn + i) * 4;
    let stone = tt === 'stone' || tt === 'pillars' ? 0.95 : tt === 'ridge' ? 0.42 : tt === 'cliff' ? 0.5 : tt === 'meadow' ? (alt > 3400 ? 0.3 : 0.12) : tt === 'dead' ? 0.2 : 0.05;
    if (ti.ad > 260 + openAt(x) * 260) stone = alt > 3350 ? 0.6 : alt > 2900 ? 0.25 : 0.05;
    stone = Math.max(stone, spireAt(x) * 0.95);
    if (x > STREAM.x0 && x < STREAM.x1 && Math.abs(ti.d - STREAM.off) < 3.4) stone = 1;      // 溪床全是卵石
    const sea = seaXZ(x, z) * (1 - smoothstep(200, 260, ti.ad));
    if (sea > 0) stone = lerp(stone, 1, smoothstep(0, 0.4, sea));
    ter[k4] = stone; ter[k4 + 1] = clamp(ti.d, -60, 60);
    ter[k4 + 2] = ((tt !== 'stone' && tt !== 'pillars' && x > -10 && x < ROUTE_LENGTH + 30) ? 1 : 0.35) * (1 - sea);      // 石海里没有路迹
    ter[k4 + 3] = sea;
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
  g.setAttribute('aTer', new THREE.BufferAttribute(ter, 4));
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

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _e2 = new THREE.Euler(0, 0, 0, 'YXZ');
// 石头：近处的地块用精细模型，远处换成简化模型（只换引用，不重建实例）
function setChunkLod(chunk, lod) {
  if (!chunk.objs || chunk.lod === lod) return;
  chunk.lod = lod;
  for (const o of chunk.objs.children) {
    const L = o.userData.lods; if (!L) continue;
    o.geometry = L[lod];
  }
}

// ---------- 树：一块地里的一种树 = 一份实例数据 + 最多三个实例网格（精细 / 中等 / 简化）----------
// 画阴影图时只画阴影相机照得到的那几棵（排在每个网格的最前面）
function beforeShadow() { this.count = this.userData.cast; }
function afterShadow() { this.count = this.userData.all; }
function treeMesh(set, lod) {
  const im = new THREE.InstancedMesh(lodGeo(set.kind, lod), lodMat(set.kind, lod), set.n);
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(set.n * 3), 3);
  im.userData.all = 0; im.userData.cast = 0; im.userData.treeLod = lod;
  im.layers.enable(2);                                   // 第 2 层：会被画进中距离阴影图
  im.receiveShadow = true; im.castShadow = false; im.count = 0; im.visible = false;
  im.onBeforeShadow = beforeShadow; im.onAfterShadow = afterShadow;
  return im;
}
// 按 set.lod / set.cast 把实例分发到三个网格里：每个网格里“会投影的”排前面，各自再由近到远（近的先画，挡住后面的就不用再算）
function fillTreeSet(set, group) {
  const { n, lod, cast, d2, order, mat, col } = set;
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => d2[a] - d2[b]);
  for (let L = 0; L < 3; L++) {
    let nc = 0, nr = 0;
    for (let i = 0; i < n; i++) if (lod[i] === L) { if (cast[i]) nc++; else nr++; }
    let im = set.meshes[L];
    if (!nc && !nr) { if (im) { im.count = 0; im.visible = false; im.castShadow = false; im.userData.all = 0; im.userData.cast = 0; } continue; }
    if (!im) { im = set.meshes[L] = treeMesh(set, L); group.add(im); }
    const M = im.instanceMatrix.array, C = im.instanceColor.array;
    let a = 0, b = nc;
    for (let q = 0; q < n; q++) {
      const i = order[q]; if (lod[i] !== L) continue;
      const j = cast[i] ? a++ : b++;
      for (let k = 0; k < 16; k++) M[j * 16 + k] = mat[i * 16 + k];
      C[j * 3] = col[i * 3]; C[j * 3 + 1] = col[i * 3 + 1]; C[j * 3 + 2] = col[i * 3 + 2];
    }
    im.count = im.userData.all = nc + nr; im.userData.cast = nc;
    im.visible = true; im.castShadow = nc > 0;
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }
}

function buildObjects(chunk) {
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
  const rnd = mulberry32((chunk.cx * 73856093) ^ (chunk.cz * 19349663) ^ 0x5bd1e995);
  const group = new THREE.Group();
  const rocks = [], trees = { fir: [], larch: [], birch: [], maple: [], maple2: [], bonsai: [], rhodo: [], shrub: [], dead: [] };
  const ccx = x0 + CHUNK / 2, ccz = z0 + CHUNK / 2;
  const tries = Math.abs(ccz - routeZ(ccx)) < 220 + openAt(ccx) * 260 ? 1400 : 450;
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
    if (wd < (wp.kind === 'village' ? 40 : wp.peak ? 6 : 14)) continue;
    let t = ti.type; if (ti.ad > 260 + openAt(x) * 260) t = 'far';
    // ---- 岩石 ----
    let rockP = 0, rmin = 0.5, rmax = 1.6;
    if (t === 'stone') { rockP = ti.ad < 45 ? 0.55 : 0.2; rmin = 0.6; rmax = 2.0; }
    else if (t === 'pillars') { rockP = ti.ad < 45 ? 0.2 : 0.15; rmin = 0.5; rmax = 1.5; }      // 万仙阵：地上是碎石和零星的矮石头，立着的全是人垒的石塔
    else if (t === 'ridge' || t === 'cliff') rockP = 0.07;
    else if (t === 'meadow') rockP = 0.03;
    else if (t === 'far') rockP = alt > 3300 ? 0.02 : 0;
    else rockP = 0.015;
    // 石头尖峰：乱石和一根根竖起的石牙
    const spk = spireAt(x);
    if (spk > 0.3 && ti.ad < 70) { rockP = Math.max(rockP, 0.5 * spk); rmin = 0.7; rmax = 2.2; }
    if (ny < 0.55) rockP *= 0.3;
    if (r1 < rockP) {
      const r = rmin + Math.pow(r2, 2.2) * (rmax - rmin) * (ti.ad > 60 ? 2 : 1);
      let h = r * (0.55 + r3 * 0.4);
      if (spk > 0.3 && ti.ad > 3.5 && r3 > 0.4) h = r * (1.5 + r3 * 2.6); // 尖峰上的花岗岩石牙（不挡在走线上）
      if (ti.ad < 1.5 && t !== 'stone' && t !== 'pillars') continue;
      const lich = rnd();
      const rock = { x, z, y: y - r * 0.25, r: r * 1.0, h: h * 0.95, v: (r2 * 2.999) | 0, rot: rnd() * 6.28, c: 0.5 + rnd() * 0.24, l: lich < 0.2 ? 1 : lich < 0.28 ? 2 : 0 };
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
  // ---- 石海：石块一块挨一块，把地面盖住（九重石海）----
  if (chunkTouches(x0, w => w.sea)) {
    const rs = mulberry32((chunk.cx * 40503) ^ (chunk.cz * 65599) ^ 0x51ea);
    const want = QUAL.lite ? 2600 : 5200;
    for (let n = 0; n < want; n++) {
      const x = x0 + rs() * CHUNK, z = z0 + rs() * CHUNK, r1 = rs(), r2 = rs(), r3 = rs(), r4 = rs(), r5 = rs(), r6 = rs();
      const sea = seaXZ(x, z); if (sea < 0.03) continue;
      const ti = terrainInfo(x, z); if (ti.ad > 130) continue;
      // 走线两侧二十多米铺满，再往外渐渐稀下去（远处靠地面贴图）
      const p = sea * (ti.ad < 24 ? 1 : lerp(1, 0.3, smoothstep(24, 55, ti.ad)) * (1 - smoothstep(85, 130, ti.ad)));
      if (r1 > p) continue;
      const wp = ROUTE[nearestWaypoint(x)];
      if (Math.hypot(x - wp.x, z - routeZ(wp.x)) < 14) continue;
      const ny = slopeNY(x, z); if (ny < 0.6) continue;
      const g = Math.sqrt(1 - ny * ny) / ny;                                         // 坡度（每走一米升高多少米）
      // 比别处的石头扁：踩着走，不用爬。坡上的石头按坡度往下埋：朝下坡那一侧的石沿不能高出地面一截，否则上坡时迎面就是一堵迈不上去的墙
      const r = 0.5 + Math.pow(r2, 1.9) * 1.8, h = r * (0.42 + r3 * 0.3 + g * 0.5);
      rocks.push({ x, z, y: heightAt(x, z) - r * Math.max(0.3 - 0.22 * r4, g * 1.08 - 0.06), r, h, v: (r5 * 3.999) | 0, rot: r6 * 6.283, c: 0.5 + r3 * 0.24, l: r4 < 0.2 ? 1 : r4 < 0.28 ? 2 : 0, sea: 1, tx: (r5 * 7.3 % 1 - 0.5) * 0.36, tz: (r6 * 5.7 % 1 - 0.5) * 0.36 });
    }
  }
  // ---- 万仙阵：满坡人垒的石塔，一丛一丛的 ----
  const cairns = [];
  if (chunkTouches(x0, w => w.seg === 'pillars')) {
    const rc = mulberry32((chunk.cx * 92821) ^ (chunk.cz * 68917) ^ 0x7a3f);
    const cell = new Map(), ck = (x, z) => Math.floor(x / 2.5) * 4099 + Math.floor(z / 2.5);
    for (let n = 0; n < 7400; n++) {
      const x = x0 + rc() * CHUNK, z = z0 + rc() * CHUNK, r1 = rc(), r2 = rc(), r3 = rc(), r4 = rc(), r5 = rc();
      const ti = terrainInfo(x, z);
      if (ti.type !== 'pillars' || ti.ad > 80 || ti.ad < 1.7) continue;
      const clump = smoothstep(-0.3, 0.3, N2.noise2(x * 0.04, z * 0.04) + N.noise2(x * 0.13, z * 0.13) * 0.35);
      if (r1 > (0.12 + 0.88 * clump) * (1 - smoothstep(26, 80, ti.ad)) * 0.62) continue;
      const wp = ROUTE[nearestWaypoint(x)];
      if (Math.hypot(x - wp.x, z - routeZ(wp.x)) < 12) continue;
      if (slopeNY(x, z) < 0.86) continue;
      // 小堆最多，一人高的少；大石堆只有零星几座
      const k = r2 < 0.22 ? 0 : r2 < 0.5 ? 1 : r2 < 0.66 ? 3 : r2 < 0.86 ? 2 : r2 < 0.95 ? 4 : 5;
      const K = CAIRN_KINDS[k], s = 0.8 + r3 * r3 * 0.75, rad = K.rad * s;
      // 不和别的石塔、石头挤在一起
      let ok = true;
      const cx = Math.floor(x / 2.5), cz = Math.floor(z / 2.5);
      for (let i = -1; i <= 1 && ok; i++) for (let j = -1; j <= 1 && ok; j++) {
        const l = cell.get((cx + i) * 4099 + cz + j);
        if (l) for (const o of l) if (Math.hypot(o.x - x, o.z - z) < o.r + rad + 0.25) { ok = false; break; }
      }
      if (ok) for (const o of rocks) if (Math.hypot(o.x - x, o.z - z) < o.r * 0.9 + rad) { ok = false; break; }
      if (!ok) continue;
      const c = { x, z, y: heightAt(x, z) - 0.05 * s, s, k, rot: r4 * 6.283, r: rad * 0.82, c: 0.5 + r5 * 0.26 };
      cairns.push(c);
      const key = ck(x, z); let l = cell.get(key); if (!l) { l = []; cell.set(key, l); } l.push({ x, z, r: rad });
    }
  }
  // 岩石实例
  const lod = chunk.lod = chunk.dist <= HI_DIST() ? 0 : 1;
  const byV = [[], [], [], [], [], [], []];           // 0–2 普通石头，3–6 石海里的石块
  for (const r of rocks) byV[r.sea ? 3 + r.v : r.v].push(r);
  byV.forEach((list, v) => {
    if (!list.length) return;
    const lods = v < 3 ? GEO.rocks[v] : GEO.blocks[v - 3];
    const im = new THREE.InstancedMesh(lods[lod], MAT.rock, list.length);
    im.userData.lods = lods; im.layers.enable(2);      // 第 2 层：会被画进中距离阴影图
    list.forEach((r, k) => {
      _q.setFromEuler(_e2.set(r.tx || 0, r.rot, r.tz || 0));
      _s.set(r.r, r.h / 0.85, r.r);
      _p.set(r.x, r.y + 0.12 * r.h, r.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(k, _m);
      if (r.l === 1) tmpC2.setRGB(r.c * 1.0, r.c * 1.0, r.c * 0.9); else if (r.l === 2) tmpC2.setRGB(r.c * 1.07, r.c * 0.97, r.c * 0.87); else tmpC2.setRGB(r.c, r.c * 0.985, r.c * (0.94 + (k % 3) * 0.02));
      im.setColorAt(k, tmpC2);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  // 石塔实例
  CAIRN_KINDS.forEach((K, k) => {
    const list = cairns.filter(c => c.k === k);
    if (!list.length) return;
    const im = new THREE.InstancedMesh(GEO.cairns[k][lod], MAT.rock, list.length);
    im.userData.lods = GEO.cairns[k]; im.layers.enable(2);
    list.forEach((c, i) => {
      _q.setFromEuler(_e.set(0, c.rot, 0));
      _s.set(c.s, c.s * (0.92 + (c.rot % 0.16)), c.s);
      _p.set(c.x, c.y, c.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      im.setColorAt(i, tmpC2.setRGB(c.c * 1.02, c.c, c.c * 0.96));
    });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  const bloomOn = WORLD.season === 'spring' ? 1 : WORLD.season === 'summer' ? 0.35 : 0;
  const blooms = [], sets = [];
  for (const kind in trees) {
    const list = trees[kind];
    if (!list.length || !GEO[kind]) continue;
    const n = list.length;
    const set = { kind, n, mat: new Float32Array(n * 16), col: new Float32Array(n * 3), pos: new Float32Array(n * 4), lod: new Uint8Array(n).fill(2), cast: new Uint8Array(n), d2: new Float32Array(n), order: new Uint16Array(n), meshes: [null, null, null], far: true, sx: 1e9, sz: 1e9 };
    list.forEach((t, k) => {
      _q.setFromEuler(_e.set(0, t.rot, 0));
      _s.set(t.s, t.s * (0.85 + (t.rot % 0.3)), t.s);
      _p.set(t.x, t.y, t.z);
      _m.compose(_p, _q, _s);
      _m.toArray(set.mat, k * 16);
      const v = 0.85 + t.v * 0.3;
      set.col[k * 3] = v * (0.96 + t.v * 0.08); set.col[k * 3 + 1] = v; set.col[k * 3 + 2] = v * (1.04 - t.v * 0.08);
      set.pos[k * 4] = t.x; set.pos[k * 4 + 1] = t.y; set.pos[k * 4 + 2] = t.z; set.pos[k * 4 + 3] = t.s;
      if (kind === 'rhodo' && t.v < bloomOn) blooms.push([_m.clone(), BLOOM_COLORS[(t.v * 97 | 0) % BLOOM_COLORS.length]]);
    });
    fillTreeSet(set, group);            // 先全部按简化版放上去；下一帧 updateTrees 再按距离分档
    sets.push(set);
  }
  chunk.treeSets = sets;
  if (blooms.length) {
    const im = new THREE.InstancedMesh(GEO.bloom, MAT.flower, blooms.length);
    blooms.forEach(([m, c], k) => { im.setMatrixAt(k, m); im.setColorAt(k, tmpC2.setRGB(c[0], c[1], c[2])); });
    im.computeBoundingSphere(); group.add(im);
  }
  chunk.rocks = rocks;
  chunk.trees = Object.values(trees).flat().filter(t => t.r > 0).concat(cairns);      // 石塔和树干一样挡路，得绕着走
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
  const want = sk === 'winter' ? 2200 : (QUAL.lite ? 4200 : 6400);
  const fwant = FLOWER_DENSITY[sk];
  const fcols = FLOWER_COLORS[sk];
  for (let n = 0; n < want + fwant; n++) {
    const isF = n >= want;
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    const ti = terrainInfo(x, z);
    if (ti.ad > 200 + openAt(x) * 220) continue;
    const t = ti.type;
    const r = rnd();
    let p = 0;
    if (t === 'meadow') p = 0.9; else if (t === 'forest' || t === 'gully') p = 0.6; else if (t === 'ridge' || t === 'cliff') p = 0.45; else if (t === 'dead') p = 0.7; else p = 0.08;
    if (ti.ad < 1.2 && t !== 'stone') p *= 0.2;
    p *= 1 - spireAt(x) * 0.85;   // 石头尖峰上几乎没有草
    p *= 1 - seaXZ(x, z) * 0.92;  // 石海里只有石缝里偶尔冒出一两丛
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
    const im = new THREE.InstancedMesh(chunk.dist === 0 ? GEO.grass : GEO.grassLo, MAT.grass, list.length);
    im.userData.grass = true;
    list.forEach((g, k) => {
      _q.setFromEuler(_e.set(0, g.rot, 0));
      const hs = sk === 'winter' ? 0.6 : 1;
      _s.set(g.s * 1.9, g.s * (g.alt > 3300 ? 0.72 : 1.05) * hs, g.s * 1.9);
      _p.set(g.x, g.y - 0.05, g.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(k, _m);
      const gold = smoothstep(2800, 3500, g.alt) * 0.6 + g.n * 0.4;
      const gv = 1.05 + (g.n - 0.5) * 0.3;
      c.setRGB(lerp(GT[0][0], GT[1][0], gold) * gv, lerp(GT[0][1], GT[1][1], gold) * gv, lerp(GT[0][2], GT[1][2], gold) * gv);
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
    this.treeDirty = false;     // 有新的树生成了，下一帧要重新分档
    this.objVersion = 0;        // 树 / 石头每增减一次加一（中距离阴影图据此决定要不要重画）
    this.treeLodR = null;       // [精细到多少米, 中等到多少米]；不设就用默认值（最高画质档会设得远一些）
  }
  key(cx, cz) { return cx + ',' + cz; }
  // fast：高速飞行，近处只要中等精度，而且不降已有的精度
  wantedRes(dist, fast) { return fast ? (dist <= 1 ? 28 : 12) : dist <= 1 ? 56 : dist <= 3 ? 28 : 12; }
  update(px, pz, budgetMs = 6, force = false, fast = false) {
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
      const res = this.wantedRes(dist, fast);
      const needObj = dist <= 3 && !fast, needGrass = dist <= 1 && !fast, needFar = dist > 3 && !c.objs && !c.farDone;
      const resBad = fast ? c.res < res : c.res !== res;
      c.resBad = resBad;
      if (resBad || (needObj && !c.objs) || (needGrass && !c.grassDone) || needFar) tasks.push(c);
    }
    tasks.sort((a, b) => a.dist - b.dist);
    for (const c of tasks) {
      if (!force && performance.now() - t0 > budgetMs) break;
      const res = this.wantedRes(c.dist, fast);
      if (c.resBad) {
        const g = buildTerrainGeo(c.cx, c.cz, res);
        if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.geometry = g; }
        else { c.mesh = new THREE.Mesh(g, MAT.terrain); c.mesh.receiveShadow = true; c.mesh.castShadow = false; c.mesh.layers.enable(1); this.scene.add(c.mesh); }      // 第 1 层：会被画进远距离地形阴影图
        c.res = res;
        if (!force) continue; // 每块只做一件事，下一帧再继续
      }
      if (c.dist > 3 && !c.objs && !c.farDone) { c.far = buildFarTrees(c); c.farDone = true; if (c.far) this.scene.add(c.far); continue; }
      if (fast) continue;
      if (c.dist <= 3 && !c.objs) { c.objs = buildObjects(c); this.scene.add(c.objs); this.dropFar(c); this.treeDirty = true; this.objVersion++; if (!force) continue; }
      if (c.dist <= 1 && !c.grassDone) { c.grass = buildGrass(c); c.grassDone = true; if (c.grass) this.scene.add(c.grass); }
    }
    // 卸载
    for (const [k, c] of this.chunks) {
      const dist = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (dist > R + 1) { this.disposeChunk(c); this.chunks.delete(k); continue; }
      if (dist > 4 && c.objs) this.disposeObjs(c);
      else if (c.objs) { setChunkLod(c, dist <= HI_DIST() ? 0 : 1); if (c.farDone) this.dropFar(c); }
      if (dist > 2 && c.grassDone) { if (c.grass) this.disposeGroup(c.grass); c.grass = null; c.grassDone = false; }
      else if (c.grass) { const gg = dist === 0 ? GEO.grass : GEO.grassLo; for (const o of c.grass.children) if (o.userData.grass && o.geometry !== gg) o.geometry = gg; }
    }
  }
  disposeObjs(c) {
    this.scene.remove(c.objs);
    c.objs.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    for (const r of c.rocks) hashRemove(rockHash, r);
    for (const t of c.trees) hashRemove(treeHash, t);
    c.objs = null; c.rocks = []; c.trees = []; c.treeSets = []; this.objVersion++;
  }
  // 树按距离分档 + 挑出会投影的那些。人走出几米、太阳转了一度左右、或者有新地块生成时才重新分（平时什么都不做）。
  // light：投影的平行光（阴影相机以 light.target 为中心、±shadowHalf 米见方）；没有阴影就传 null
  updateTrees(px, py, pz, light, shadowHalf = 64, force = false) {
    const st = this.treeSt || (this.treeSt = { x: 1e9, y: 0, z: 1e9, l: new THREE.Vector3(0, 1, 0), X: new THREE.Vector3(), Y: new THREE.Vector3(), L: new THREE.Vector3(), lite: null });
    const L = st.L.set(0, 1, 0); let tx = px, ty = py, tz = pz, shadows = false;
    if (light && light.castShadow && light.intensity > 0.004) { L.copy(light.position).sub(light.target.position).normalize(); tx = light.target.position.x; ty = light.target.position.y; tz = light.target.position.z; shadows = true; }
    const moved = (px - st.x) ** 2 + (py - st.y) ** 2 + (pz - st.z) ** 2;
    if (!force && !this.treeDirty && moved < 16 && st.l.dot(L) > 0.99985 && st.sh === shadows && st.lite === QUAL.lite) return;
    this.treeDirty = false; st.x = px; st.y = py; st.z = pz; st.l.copy(L); st.sh = shadows; st.lite = QUAL.lite;
    // 阴影相机的横轴 / 纵轴（和 three 的 lookAt 一致）
    const X = st.X.set(0, 1, 0).cross(L); if (X.lengthSq() < 1e-6) X.set(1, 0, 0); X.normalize();
    const Y = st.Y.copy(L).cross(X);
    const [rHi, rMid] = this.treeLodR || TREE_LOD();
    const hiIn = (rHi - 3) ** 2, hiOut = (rHi + 3) ** 2, midIn = (rMid - 4) ** 2, midOut = (rMid + 4) ** 2;
    const SU = shadowHalf + 15, SW = shadowHalf + 15;      // 树冠半径 + 人还能再走几米、太阳还能再转一点的余量
    for (const [, c] of this.chunks) {
      if (!c.treeSets.length) continue;
      // 整块地离得太远、也投不进阴影图：全部用简化版，不用逐棵算
      const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
      const ddx = Math.max(x0 - px, 0, px - x0 - CHUNK), ddz = Math.max(z0 - pz, 0, pz - z0 - CHUNK);
      let near = ddx * ddx + ddz * ddz < midOut;
      if (!near && shadows) {
        const vx = x0 + CHUNK / 2 - tx, vz = z0 + CHUNK / 2 - tz;        // 高度差先不管：沿光线方向的那一维本来就不裁
        const uu = vx * X.x + vz * X.z, slack = CHUNK * 0.71 + 60;
        near = Math.abs(uu) < SU + slack;
      }
      for (const set of c.treeSets) {
        const { n, pos, lod, cast, d2 } = set;
        if (!near) {
          if (set.far) continue;
          lod.fill(2); cast.fill(0); d2.fill(0); set.far = true; fillTreeSet(set, c.objs); continue;
        }
        let changed = set.far, any = false;
        for (let i = 0; i < n; i++) {
          const x = pos[i * 4], y = pos[i * 4 + 1], z = pos[i * 4 + 2], s = pos[i * 4 + 3];
          const dx = x - px, dy = y + 3 - py, dz = z - pz, d = dx * dx + dy * dy + dz * dz;
          d2[i] = d;
          const cur = lod[i];
          const nl = d < (cur === 0 ? hiOut : hiIn) ? 0 : d < (cur <= 1 ? midOut : midIn) ? 1 : 2;
          let nc = 0;
          if (shadows) {
            const vx = x - tx, vy = y - ty, vz = z - tz;
            const u = vx * X.x + vy * X.y + vz * X.z, w = vx * Y.x + vy * Y.y + vz * Y.z;
            nc = Math.abs(u) < SU && w < SW && w > -SW - 9 * s * Y.y ? 1 : 0;       // 树有七八米高：树根在范围外、树梢也可能探进来
          }
          if (nl !== cur || nc !== cast[i]) { lod[i] = nl; cast[i] = nc; changed = true; }
          if (nl < 2 || nc) any = true;
        }
        // 成员没变也隔一段路重排一次：让“由近到远”的顺序大致保持
        if (changed || (any && (px - set.sx) ** 2 + (pz - set.sz) ** 2 > 400)) { fillTreeSet(set, c.objs); set.sx = px; set.sz = pz; }
        set.far = !any;
      }
    }
  }
  // 画中距离阴影图时用：所有的树和石头临时换成简化模型（影子只要个大概轮廓），画完换回来
  withLowLod(fn) {
    const saved = [], trees = [];
    for (const [, c] of this.chunks) {
      if (!c.objs) continue;
      if (c.lod === 0) { saved.push(c); setChunkLod(c, 1); }
      for (const set of c.treeSets) for (let L = 0; L < 2; L++) {
        const im = set.meshes[L];
        if (im && im.visible) { trees.push(im, im.geometry, im.material); im.geometry = lodGeo(set.kind, 2); im.material = MAT.leaf; }
      }
    }
    try { fn(); } finally {
      for (const c of saved) setChunkLod(c, 0);
      for (let i = 0; i < trees.length; i += 3) { trees[i].geometry = trees[i + 1]; trees[i].material = trees[i + 2]; }
    }
  }
  // 撤掉远景树（近处的完整树木已经生成，或者整块卸载）
  dropFar(c) { if (c.far) this.disposeGroup(c.far); c.far = null; c.farDone = false; }
  disposeChunk(c) {
    if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (c.objs) this.disposeObjs(c);
    if (c.grass) this.disposeGroup(c.grass);
    this.dropFar(c);
  }
  disposeGroup(g) { this.scene.remove(g); g.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
  clearAll() { for (const [, c] of this.chunks) this.disposeChunk(c); this.chunks.clear(); }
}
