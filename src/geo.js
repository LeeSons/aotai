// ===================== 建模工具 =====================
// 倒角方块、旋转体、管子、折痕法线、蓬松法线、顶点着色、按材质合并——全部程序化，不依赖外部模型
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

// 平移 / 旋转 / 缩放一个几何体（返回自身）
export function xf(geo, { p = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  _m.compose(_p.set(p[0], p[1], p[2]), _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

// 顶点色：整体一个颜色，可再用函数逐点调整 fn(color, x, y, z, nx, ny, nz)
export function paint(geo, color, fn) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
  const arr = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.copy(color);
    if (fn) fn(c, pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// 合并几何体（位置 / 法线 / 颜色 / uv）。groups：[[geo...], [geo...]] 时按组生成 material groups
export function merge(list, groups = null) {
  const sets = groups || [list];
  const flat = [];
  const ranges = [];
  for (const set of sets) {
    const start = flat.reduce((s, g) => s + g.attributes.position.count, 0);
    for (const g0 of set) { if (!g0) continue; flat.push(g0.index ? g0.toNonIndexed() : g0); }
    const end = flat.reduce((s, g) => s + g.attributes.position.count, 0);
    ranges.push([start, end - start]);
  }
  let total = 0; for (const g of flat) total += g.attributes.position.count;
  const hasUv = flat.some(g => g.attributes.uv), hasCol = flat.some(g => g.attributes.color);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  const col = hasCol ? new Float32Array(total * 3).fill(1) : null, uv = hasUv ? new Float32Array(total * 2) : null;
  let o = 0;
  for (const g of flat) {
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    nor.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (col && g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), o * 3);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), o * 2);
    o += n;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (groups) ranges.forEach(([s, c], i) => { if (c > 0) m.addGroup(s, c, i); });
  m.computeBoundingSphere(); m.computeBoundingBox();
  return m;
}

// 折痕法线：夹角小于 angle 的相邻面共用平滑法线，大于的保留硬边（返回不带索引的几何体）
export function crease(geo, angle = 40) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, n = pos.count;
  const cosT = Math.cos(angle * Math.PI / 180);
  const fn = new Float32Array(n * 3), fa = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    _a.fromBufferAttribute(pos, i); _b.fromBufferAttribute(pos, i + 1); _c.fromBufferAttribute(pos, i + 2);
    _v.subVectors(_c, _b).cross(_a.sub(_b));
    const ar = _v.length(); if (ar > 0) _v.multiplyScalar(1 / ar);
    for (let k = 0; k < 3; k++) { fn[(i + k) * 3] = _v.x; fn[(i + k) * 3 + 1] = _v.y; fn[(i + k) * 3 + 2] = _v.z; fa[i + k] = ar; }
  }
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 2000) + ',' + Math.round(pos.getY(i) * 2000) + ',' + Math.round(pos.getZ(i) * 2000);
    let l = map.get(k); if (!l) { l = []; map.set(k, l); } l.push(i);
  }
  const out = new Float32Array(n * 3);
  for (const l of map.values()) {
    for (const i of l) {
      let x = 0, y = 0, z = 0;
      const ax = fn[i * 3], ay = fn[i * 3 + 1], az = fn[i * 3 + 2];
      for (const j of l) {
        const bx = fn[j * 3], by = fn[j * 3 + 1], bz = fn[j * 3 + 2];
        if (ax * bx + ay * by + az * bz >= cosT) { const w = fa[j]; x += bx * w; y += by * w; z += bz * w; }
      }
      const len = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / len; out[i * 3 + 1] = y / len; out[i * 3 + 2] = z / len;
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}

// 蓬松法线：法线向“从中心往外”的方向偏，树冠、灌丛受光像一整团而不是一个个小面
export function puff(geo, cx, cy, cz, k = 0.6) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    _v.set(pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz).normalize();
    _a.fromBufferAttribute(nor, i).lerp(_v, k).normalize();
    nor.setXYZ(i, _a.x, _a.y, _a.z);
  }
  return geo;
}

// 逐顶点位移 fn(v, i)（共用位置的顶点得到同样的位移，不会裂开）
export function displace(geo, fn) {
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 2000) + ',' + Math.round(pos.getY(i) * 2000) + ',' + Math.round(pos.getZ(i) * 2000);
    let p = map.get(k);
    if (!p) { _v.fromBufferAttribute(pos, i); fn(_v, i); p = [_v.x, _v.y, _v.z]; map.set(k, p); }
    pos.setXYZ(i, p[0], p[1], p[2]);
  }
  pos.needsUpdate = true;
  return geo;
}

// 倒角方块：棱和角都切掉一道斜面，法线在斜面上渐变——受光时棱上有一条高光，不再是“纸盒”
export function bevelBox(w, h, d, r = 0.03, anchor = 'center') {
  r = Math.min(r, w * 0.45, h * 0.45, d * 0.45);
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const H = [w / 2, h / 2, d / 2];
  const p = [0, 0, 0], inner = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i); p[1] = pos.getY(i); p[2] = pos.getZ(i);
    let dx = 0, dy = 0, dz = 0;
    for (let k = 0; k < 3; k++) {
      const a = Math.abs(p[k]), sgn = Math.sign(p[k]);
      // 三等分的内圈顶点挪到“离边 r”的位置，外圈留在表面
      const v = a > H[k] * 0.9 ? H[k] : H[k] - r;
      p[k] = sgn * v;
      inner[k] = sgn * Math.min(v, H[k] - r);
    }
    dx = p[0] - inner[0]; dy = p[1] - inner[1]; dz = p[2] - inner[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    pos.setXYZ(i, inner[0] + dx / len * r, inner[1] + dy / len * r, inner[2] + dz / len * r);
    nor.setXYZ(i, dx / len, dy / len, dz / len);
  }
  if (anchor === 'bottom') g.translate(0, h / 2, 0);
  return g;
}

// 旋转体：pts = [[半径, 高度], ...] 自下而上
export function lathe(pts, seg = 12) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg);
  return g;
}

// 沿一串点走的管子（树枝、绳子、蛇）。radius 可以是函数 t → 半径
export function tube(points, radius = 0.03, radial = 6, segPer = 4, closedEnds = true) {
  const pts = points.map(p => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const seg = Math.max(2, (pts.length - 1) * segPer);
  const rf = typeof radius === 'function' ? radius : () => radius;
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  // 按 t 改半径
  const pos = g.attributes.position;
  const P = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; curve.getPointAt(t, P); const r = rf(t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      _v.fromBufferAttribute(pos, k).sub(P).multiplyScalar(r).add(P);
      pos.setXYZ(k, _v.x, _v.y, _v.z);
    }
  }
  g.computeVertexNormals();
  if (!closedEnds) return g;
  // 两头封口
  const caps = [];
  for (const t of [0, 1]) {
    const c = new THREE.CircleGeometry(rf(t), radial);
    curve.getPointAt(t, P); const tan = curve.getTangentAt(t);
    _q.setFromUnitVectors(_a.set(0, 0, 1), t === 0 ? tan.clone().negate() : tan);
    c.applyQuaternion(_q); c.translate(P.x, P.y, P.z); caps.push(c);
  }
  return merge([g, ...caps]);
}

// 放样：沿 y 轴把一圈圈截面连成光滑的曲面（躯干、四肢、头、背包都用它）。
// secs 自下而上：[y, rx, rzF = rx, rzB = rzF, cx = 0, cz = 0]——rx 是半宽，rzF / rzB 是往前（+z）/ 往后的半厚。
// sq：截面的方正程度（0 椭圆 … 1 接近圆角矩形）；ripple / rippleN：一圈上的棱纹（毛线帽的罗纹）
export function loftAt(secs, y) {
  let i = 0; while (i < secs.length - 2 && y > secs[i + 1][0]) i++;
  const a = secs[i], b = secs[i + 1], t = Math.max(0, Math.min(1, (y - a[0]) / (b[0] - a[0] || 1)));
  const g = (s, k, d) => (s[k] === undefined ? d : s[k]);
  const L = (k, da, db) => da + (db - da) * t;
  const rxa = a[1], rxb = b[1], fa = g(a, 2, rxa), fb = g(b, 2, rxb);
  return [L(0, rxa, rxb), L(0, fa, fb), L(0, g(a, 3, fa), g(b, 3, fb)), L(0, g(a, 4, 0), g(b, 4, 0)), L(0, g(a, 5, 0), g(b, 5, 0))];
}
// 截面上角度 a 处的点（a = π/2 是正前方 +z，a = 0 是 +x）
export function loftPoint(secs, y, a, sq = 0, off = 0) {
  const [rx, rf, rb, cx, cz] = loftAt(secs, y);
  const n = 2 + sq * 4, cs = Math.cos(a), sn = Math.sin(a);
  const k = Math.pow(Math.pow(Math.abs(cs), n) + Math.pow(Math.abs(sn), n), -1 / n);
  const rz = sn >= 0 ? rf : rb;
  return [cx + cs * k * (rx + off), y, cz + sn * k * (rz + off)];
}
export function loft(secs, { seg = 14, sq = 0, ripple = 0, rippleN = 0, capB = true, capT = true } = {}) {
  const n = 2 + sq * 4, N = secs.length;
  const pos = [], idx = [];
  for (let i = 0; i < N; i++) {
    const s = secs[i], y = s[0], rx = s[1], rf = s[2] === undefined ? rx : s[2], rb = s[3] === undefined ? rf : s[3], cx = s[4] || 0, cz = s[5] || 0;
    for (let j = 0; j <= seg; j++) {
      const a = j / seg * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      const k = Math.pow(Math.pow(Math.abs(cs), n) + Math.pow(Math.abs(sn), n), -1 / n) * (1 + ripple * Math.cos(rippleN * a));
      pos.push(cx + cs * k * rx, y, cz + sn * k * (sn >= 0 ? rf : rb));
    }
  }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (capB) { const c = pos.length / 3; pos.push(secs[0][4] || 0, secs[0][0], secs[0][5] || 0); for (let j = 0; j < seg; j++) idx.push(c, j, j + 1); }
  if (capT) { const c = pos.length / 3, o = (N - 1) * (seg + 1); pos.push(secs[N - 1][4] || 0, secs[N - 1][0], secs[N - 1][5] || 0); for (let j = 0; j < seg; j++) idx.push(c, o + j + 1, o + j); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // 接缝两列的法线对齐
  const nor = g.attributes.normal;
  for (let i = 0; i < N; i++) { const a = i * (seg + 1), b = a + seg; const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b), l = Math.hypot(x, y, z) || 1; nor.setXYZ(a, x / l, y / l, z / l); nor.setXYZ(b, x / l, y / l, z / l); }
  return g;
}
// 贴着放样曲面走的一条带子（背带、拉链、腰带）。pts = [[角度, y], ...]；w 宽，t 厚
export function loftStrap(secs, pts, w, t = 0.006, sq = 0) {
  const P = pts.map(([a, y]) => new THREE.Vector3(...loftPoint(secs, y, a, sq, t * 0.5)));
  return ribbon(P, P.map((p, i) => { const q = loftPoint(secs, pts[i][1], pts[i][0], sq, 0.05); return new THREE.Vector3(q[0] - p.x, 0, q[2] - p.z).normalize(); }), w, t);
}
// 一条有厚度的带子：沿 pts 走，nrm 是每个点处带子朝外的方向
export function ribbon(pts, nrm, w, t = 0.006) {
  const pos = [], idx = [];
  const tan = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    tan.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    side.crossVectors(tan, nrm[i]).normalize();
    const p = pts[i], n = nrm[i];
    for (const [sw, st] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) pos.push(p.x + side.x * w * 0.5 * sw + n.x * t * 0.5 * st, p.y + side.y * w * 0.5 * sw + n.y * t * 0.5 * st, p.z + side.z * w * 0.5 * sw + n.z * t * 0.5 * st);
    if (i) { const a = (i - 1) * 4, b = i * 4; for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; idx.push(a + k, a + k2, b + k, a + k2, b + k2, b + k); } }
  }
  const e = (pts.length - 1) * 4; idx.push(0, 2, 1, 0, 3, 2, e, e + 1, e + 2, e, e + 2, e + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  return ng;
}

// 一块石头：细分的二十面体 → 分形起伏 → 随机切几刀（花岗岩的节理面）→ 压扁底部 → 折痕法线
export function rockGeo(seed, detail = 2, { cuts = 12, rough = 0.22, squash = 1 } = {}) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const planes = [];
  for (let i = 0; i < cuts; i++) {
    const n = new THREE.Vector3(rnd() * 2 - 1, (rnd() * 2 - 1) * 0.8 + 0.15, rnd() * 2 - 1).normalize();
    planes.push([n, 0.5 + rnd() * 0.34]);
  }
  const ph = [rnd() * 9, rnd() * 9, rnd() * 9];
  displace(g, (v) => {
    const d = v.clone().normalize();
    // 低频起伏（让轮廓不是球）
    const n1 = Math.sin(d.x * 2.1 + ph[0]) * Math.sin(d.y * 1.7 + ph[1]) * Math.sin(d.z * 2.3 + ph[2]);
    const n2 = Math.sin(d.x * 5.3 + ph[1] * 2) * Math.sin(d.y * 4.7 + ph[2] * 2) * Math.sin(d.z * 4.1 + ph[0] * 2);
    v.copy(d).multiplyScalar(1 + n1 * rough + n2 * rough * 0.35);
    for (const [n, dist] of planes) { const k = v.dot(n) - dist; if (k > 0) v.addScaledVector(n, -k); }
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.35;      // 底部压平：坐在地上
    v.y *= squash;
  });
  return crease(g, 30);
}

// 把一个 Group 里材质相同的静态网格合并成一个（大幅减少绘制调用）。标了 userData.keep 的不合并
export function bakeGroup(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(), keep = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    let p = o, skip = false;
    while (p && p !== group) { if (p.userData && p.userData.keep) { skip = true; break; } p = p.parent; }
    if (skip || Array.isArray(o.material) || o.isInstancedMesh) { keep.push(o); return; }
    const key = o.material.uuid + (o.castShadow ? 'c' : 'n') + (o.receiveShadow ? 'r' : 'n');
    let b = buckets.get(key); if (!b) { b = { mat: o.material, geos: [], cast: o.castShadow, recv: o.receiveShadow }; buckets.set(key, b); }
    const g = o.geometry.clone();
    g.applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld));
    b.geos.push(g);
  });
  const out = new THREE.Group();
  out.position.copy(group.position); out.quaternion.copy(group.quaternion); out.scale.copy(group.scale);
  out.userData = group.userData;
  for (const b of buckets.values()) {
    const m = new THREE.Mesh(merge(b.geos), b.mat);
    m.castShadow = b.cast; m.receiveShadow = b.recv; out.add(m);
    for (const g of b.geos) g.dispose();
  }
  for (const o of keep) {
    const mw = _m.multiplyMatrices(inv, o.matrixWorld).clone();
    out.add(o); mw.decompose(o.position, o.quaternion, o.scale);
  }
  return out;
}
