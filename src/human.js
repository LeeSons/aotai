// ===================== 人物模型 =====================
// 主角和路人共用的一套人形：骨架还是那几个关节（骨盆、脊柱、颈、头、肩肘腕、髋膝踝），
// 每一节的外形用放样曲面做出来——躯干有肩有腰，四肢有粗细变化，关节处是球形端头（弯起来不露缝），
// 头有下颌、鼻子、眼睛、耳朵；冲锋衣有立领、拉链、口袋；背包有顶包、侧袋、压缩带、背负系统；登山鞋有鞋帮、鞋带、大底。
import * as THREE from 'three';
import { surfMat, plainMat } from './materials.js';
import { loft, loftPoint, loftStrap, ribbon, bevelBox, lathe, paint, merge, xf, crease, displace } from './geo.js';
import { mulberry32 } from './noise.js';

const WHITE = new THREE.Color(1, 1, 1);
function mk(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = !mat.userData.noShadow; m.receiveShadow = true; parent.add(m); return m;
}
function joint(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
// 球形端头的截面：圆心在 y0、半径 r；up = true 是朝上的半球（自下而上列出），否则朝下
const ballUp = (y0, r, n = 3) => { const o = []; for (let i = 1; i <= n; i++) { const t = i / n * Math.PI / 2 * 0.96; o.push([y0 + r * Math.sin(t), r * Math.cos(t)]); } return o; };
const ballDn = (y0, r, n = 3) => { const o = []; for (let i = n; i >= 1; i--) { const t = i / n * Math.PI / 2 * 0.96; o.push([y0 - r * Math.sin(t), r * Math.cos(t)]); } return o; };

// 一身衣物的材质。jacket / boot 的颜色之后可以直接改 .color
export function humanMats(jacket = 0x8a8f96, o = {}) {
  const cloth = (color, roughness = 0.9, extra = {}) => surfMat(null, { kind: 'fabric', mapping: 'local', scale: 0.14, bump: 0.9, tex: 0.6, color, roughness, snow: 0.25, ...extra });
  const M = {
    jacket: cloth(jacket, 0.82),
    jacketDark: cloth(0x24272b, 0.9),
    pants: cloth(o.pants || 0x3a3f46, 0.98),
    skin: plainMat({ color: o.skin || 0xc9977c, roughness: 0.62, vertexColors: true }),
    hair: cloth(0x1b1612, 1.0, { scale: 0.05, bump: 1.4 }),
    eye: plainMat({ color: 0x1a120c, roughness: 0.25 }),
    eyeWhite: plainMat({ color: 0xe8e4de, roughness: 0.35 }),
    lip: plainMat({ color: 0x9a5a50, roughness: 0.55 }),
    glove: cloth(0x23262a, 0.95),
    boot: surfMat(null, { kind: 'wood', mapping: 'local', scale: 0.3, bump: 0.6, tex: 0.4, color: 0x5b3b22, roughness: 0.75, snow: 0.5 }),
    sole: cloth(0x1a1a1a, 1.05),
    pack: cloth(o.pack || 0x3f7256, 0.86, { scale: 0.18, bump: 1.2 }),
    packAccent: cloth(o.packAccent || 0x27382e, 0.9, { scale: 0.18, bump: 1.2 }),
    strap: cloth(0x1c1f23, 1.0, { scale: 0.06 }),
    pad: cloth(0xd27a26, 0.8, { scale: 0.3, bump: 0.5 }),
    bottle: plainMat({ color: 0x2c6fb0, roughness: 0.3, metalness: 0.25 }),
    hat: cloth(o.hat || 0x9b2424, 1.05, { scale: 0.07, bump: 1.6 }),
    pole: surfMat(null, { kind: 'metal', mapping: 'local', scale: 0.4, bump: 0.5, tex: 0.4, color: 0xb8bec6, roughness: 0.6, metalness: 0.85, snow: 0 }),
    grip: cloth(0x111111, 0.8, { scale: 0.04 }),
    buckle: plainMat({ color: 0x8a8d90, roughness: 0.4, metalness: 0.7 }),
    lamp: plainMat({ color: 0x1a1a1a, emissive: 0xfff2c0, emissiveIntensity: 0 }),
  };
  for (const k of ['eye', 'eyeWhite', 'lip', 'buckle', 'lamp']) M[k].userData.noShadow = true;      // 太小的零件不投影
  return M;
}

// ---------------- 各部位的截面 ----------------
const TORSO = [[-0.13, 0.178, 0.124, 0.122], [-0.08, 0.176, 0.126, 0.12], [0.02, 0.163, 0.116, 0.11], [0.12, 0.178, 0.124, 0.118], [0.22, 0.198, 0.134, 0.124], [0.31, 0.206, 0.132, 0.127], [0.37, 0.19, 0.112, 0.12], [0.41, 0.13, 0.086, 0.096], [0.445, 0.08, 0.068, 0.072]];
const TORSO_SQ = 0.3;
const PELVIS = [[-0.17, 0.06, 0.07, 0.07], [-0.13, 0.12, 0.1, 0.105], [-0.06, 0.166, 0.115, 0.126], [0.02, 0.168, 0.118, 0.12], [0.1, 0.156, 0.108, 0.11], [0.14, 0.12, 0.09, 0.09]];
const HEAD = [[-0.094, 0.02, 0.026, 0.02, 0, 0.036], [-0.078, 0.044, 0.05, 0.04, 0, 0.03], [-0.052, 0.061, 0.068, 0.062, 0, 0.018], [-0.022, 0.07, 0.08, 0.082, 0, 0.008], [0.014, 0.075, 0.088, 0.094, 0, 0], [0.05, 0.0765, 0.09, 0.102, 0, -0.004], [0.09, 0.0755, 0.088, 0.104, 0, -0.006], [0.124, 0.066, 0.076, 0.092, 0, -0.008], [0.148, 0.046, 0.052, 0.064, 0, -0.008], [0.161, 0.018, 0.02, 0.026, 0, -0.008]];

// 头：脸、五官、耳朵、头发
function buildHead(M, head) {
  const lids = [];
  const skinTint = (c, x, y, z) => {
    // 脸颊、鼻尖、耳朵冻得发红；眼窝略深
    const cheek = Math.exp(-((Math.abs(x) - 0.045) ** 2 / 0.0006 + (y + 0.005) ** 2 / 0.0008)) * (z > 0.03 ? 1 : 0);
    c.setRGB(1 + cheek * 0.07, 1 - cheek * 0.13, 1 - cheek * 0.13);
    const socket = Math.exp(-((Math.abs(x) - 0.031) ** 2 / 0.0003 + (y - 0.05) ** 2 / 0.00022)) * (z > 0.05 ? 1 : 0);
    c.multiplyScalar(1 - socket * 0.22);
  };
  mk(paint(loft(HEAD, { seg: 22, sq: 0.12 }), WHITE, skinTint), M.skin, head);
  // 脖子
  mk(paint(loft([[-0.12, 0.05, 0.05, 0.052, 0, -0.012], [-0.06, 0.046, 0.046, 0.05, 0, -0.006], [-0.02, 0.047, 0.048, 0.052, 0, 0.002]], { seg: 12 }), WHITE), M.skin, head);
  // 鼻子：从眉心到鼻尖的一道楔形
  const nose = loft([[0.004, 0.013, 0.012, 0.004], [0.013, 0.0165, 0.025, 0.004], [0.03, 0.0115, 0.017, 0.004], [0.056, 0.008, 0.007, 0.004]], { seg: 10 });
  mk(paint(nose, WHITE, (c, x, y, z) => { const t = Math.max(0, 1 - (y - 0.004) / 0.02) * (z > 0.01 ? 1 : 0); c.setRGB(1 + t * 0.05, 1 - t * 0.12, 1 - t * 0.12); }), M.skin, head, 0, 0, 0.083);
  // 眼睛：眼白、瞳仁、上眼睑、眉毛
  for (const s of [-1, 1]) {
    const ex = s * 0.0315, ey = 0.05, ez = 0.0775;
    const w = mk(new THREE.SphereGeometry(0.0125, 12, 8), M.eyeWhite, head, ex, ey, ez); w.scale.set(1.22, 0.78, 0.62); w.castShadow = false;
    const iris = mk(new THREE.SphereGeometry(0.0074, 10, 8), M.eye, head, ex - s * 0.001, ey - 0.0006, ez + 0.0052); iris.scale.set(1, 1, 0.55); iris.castShadow = false;
    const lid = mk(paint(new THREE.SphereGeometry(0.0138, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.3), WHITE, (c) => c.multiplyScalar(0.9)), M.skin, head, ex, ey + 0.0008, ez); lid.scale.set(1.26, 0.86, 0.68); lid.rotation.x = 0.22; lid.castShadow = false;
    lid.userData.keep = true; lids.push(lid);      // 眼睑单独留着：眨眼要转它
    const brow = mk(bevelBox(0.03, 0.0065, 0.008, 0.003), M.hair, head, s * 0.033, 0.0725, 0.083); brow.rotation.set(0.1, s * 0.32, -s * 0.12); brow.castShadow = false;
    // 耳朵
    const ear = mk(paint(new THREE.SphereGeometry(0.026, 10, 8), WHITE, (c) => c.setRGB(1.06, 0.88, 0.88)), M.skin, head, s * 0.0765, 0.034, -0.006); ear.scale.set(0.34, 1, 0.66); ear.rotation.set(0, -s * 0.35, s * 0.12);
  }
  // 嘴
  const lip = mk(new THREE.SphereGeometry(0.02, 12, 6), M.lip, head, 0, -0.036, 0.0835); lip.scale.set(1, 0.17, 0.36); lip.castShadow = false;
  // 头发：头顶后脑一片 + 鬓角后颈一片
  const hairTop = mk(new THREE.SphereGeometry(0.092, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), M.hair, head, 0, 0.082, -0.013); hairTop.scale.set(0.87, 0.92, 1.12); hairTop.rotation.x = -0.24;
  const hairBack = mk(new THREE.SphereGeometry(0.085, 14, 10), M.hair, head, 0, 0.062, -0.04); hairBack.scale.set(0.91, 0.82, 0.8);
  return lids;
}

// 毛线帽：翻边 + 罗纹帽身 + 绒球
function buildBeanie(M, hatG) {
  const cz = -0.008;
  mk(loft([[0.02, 0.0825, 0.0935, 0.108, 0, cz], [0.034, 0.0865, 0.0975, 0.112, 0, cz], [0.058, 0.0865, 0.0975, 0.112, 0, cz], [0.072, 0.083, 0.094, 0.108, 0, cz]], { seg: 28, ripple: 0.018, rippleN: 28, capB: false, capT: false }), M.hat, hatG);
  mk(loft([[0.064, 0.082, 0.092, 0.106, 0, cz], [0.09, 0.077, 0.086, 0.099, 0, cz], [0.114, 0.064, 0.071, 0.083, 0, cz - 0.004], [0.134, 0.043, 0.048, 0.058, 0, cz - 0.008], [0.147, 0.017, 0.02, 0.025, 0, cz - 0.012]], { seg: 28, ripple: 0.012, rippleN: 28, capB: false }), M.hat, hatG);
  const r = mulberry32(3);
  const pom = new THREE.IcosahedronGeometry(0.03, 1); displace(pom, (v) => v.multiplyScalar(0.85 + r() * 0.35));
  mk(crease(pom, 80), M.hat, hatG, 0, 0.166, cz - 0.014);
}
// 护林员的宽檐帽
function buildBrimHat(M, hatG) {
  mk(lathe([[0.09, 0.002], [0.2, 0.0], [0.205, 0.006], [0.1, 0.014], [0.098, 0.06], [0.09, 0.095], [0.06, 0.108], [0.0, 0.11]], 22), M.hat, hatG, 0, 0.022, -0.008).scale.set(0.95, 1, 1.08);
  mk(lathe([[0.101, 0.014], [0.101, 0.034]], 22), M.strap, hatG, 0, 0.022, -0.008).scale.set(0.95, 1, 1.08);
}
// 头灯：一圈松紧带 + 灯头
function buildLamp(M, lampG) {
  mk(loft([[0.012, 0.09, 0.101, 0.115, 0, -0.008], [0.032, 0.09, 0.101, 0.115, 0, -0.008]], { seg: 24, capB: false, capT: false }), M.strap, lampG);
  mk(bevelBox(0.052, 0.036, 0.026, 0.008), M.strap, lampG, 0, 0.022, 0.103);
  const lens = mk(new THREE.CylinderGeometry(0.0135, 0.0135, 0.006, 14), M.lamp, lampG, 0, 0.022, 0.118); lens.rotation.x = Math.PI / 2; lens.castShadow = false;
}

// 上身：冲锋衣（立领、拉链、胸袋、下摆）+ 背负系统（肩带、胸带、腰带）
function buildTorso(M, spine, o) {
  mk(loft(TORSO, { seg: 20, sq: TORSO_SQ }), M.jacket, spine);
  // 立领 + 卷在领后的帽兜
  mk(loft([[0.405, 0.088, 0.078, 0.084, 0, 0.002], [0.445, 0.084, 0.076, 0.08, 0, 0.004], [0.485, 0.077, 0.071, 0.074, 0, 0.006], [0.492, 0.07, 0.064, 0.068, 0, 0.006]], { seg: 16, capB: false }), M.jacket, spine);
  mk(loft([[0.385, 0.1, 0.02, 0.05, 0, -0.06], [0.42, 0.115, 0.03, 0.062, 0, -0.064], [0.455, 0.1, 0.03, 0.05, 0, -0.06], [0.475, 0.06, 0.02, 0.03, 0, -0.056]], { seg: 12, sq: 0.2 }), M.jacket, spine);
  const F = Math.PI / 2;
  // 门襟拉链、拉链头
  mk(loftStrap(TORSO, [[F, -0.125], [F, -0.05], [F, 0.03], [F, 0.12], [F, 0.22], [F, 0.31], [F, 0.37], [F, 0.41]], 0.02, 0.006, TORSO_SQ), M.jacketDark, spine);
  mk(bevelBox(0.012, 0.03, 0.008, 0.003), M.buckle, spine, 0, 0.392, 0.101);
  // 两个斜插的胸袋拉链、下摆收口
  for (const s of [-1, 1]) mk(loftStrap(TORSO, [[F - s * 0.34, 0.285], [F - s * 0.52, 0.255], [F - s * 0.7, 0.225]], 0.009, 0.004, TORSO_SQ), M.jacketDark, spine);
  const hem = []; for (let i = 0; i <= 24; i++) hem.push([i / 24 * Math.PI * 2, -0.118]);
  mk(loftStrap(TORSO, hem, 0.026, 0.006, TORSO_SQ), M.jacketDark, spine);
  if (!o.pack) return;
  // 肩带：从胸前绕过肩头到背后
  for (const s of [-1, 1]) {
    const a = F - s * 0.6;
    const pts = [], nr = [];
    for (const y of [0.0, 0.08, 0.16, 0.24, 0.31, 0.36]) { const p = loftPoint(TORSO, y, a, TORSO_SQ, 0.008), q = loftPoint(TORSO, y, a, TORSO_SQ, 0.05); pts.push(new THREE.Vector3(...p)); nr.push(new THREE.Vector3(q[0] - p[0], 0, q[2] - p[2]).normalize()); }
    const sx = s * 0.118;
    pts.push(new THREE.Vector3(sx, 0.408, 0.062)); nr.push(new THREE.Vector3(0, 0.6, 0.8).normalize());
    pts.push(new THREE.Vector3(sx, 0.428, 0.0)); nr.push(new THREE.Vector3(0, 1, 0));
    pts.push(new THREE.Vector3(sx, 0.405, -0.075)); nr.push(new THREE.Vector3(0, 0.6, -0.8).normalize());
    pts.push(new THREE.Vector3(sx, 0.34, -0.128)); nr.push(new THREE.Vector3(0, 0.15, -1).normalize());
    mk(ribbon(pts, nr, 0.05, 0.012), M.strap, spine);
    mk(bevelBox(0.03, 0.02, 0.012, 0.004), M.buckle, spine, pts[0].x, 0.005, pts[0].z + 0.004);
  }
  // 胸带、腰带（带插扣）
  const chest = []; for (let i = 0; i <= 6; i++) chest.push([F - 0.6 + i * 0.2, 0.285]);
  mk(loftStrap(TORSO, chest, 0.02, 0.008, TORSO_SQ), M.strap, spine);
  mk(bevelBox(0.03, 0.026, 0.012, 0.004), M.buckle, spine, 0, 0.285, loftPoint(TORSO, 0.285, F, TORSO_SQ, 0.012)[2]);
  const belt = []; for (let i = 0; i <= 24; i++) belt.push([i / 24 * Math.PI * 2, -0.03 + Math.cos(i / 24 * Math.PI * 2 - F) * 0.012]);
  mk(loftStrap(TORSO, belt, 0.05, 0.012, TORSO_SQ), M.strap, spine);
  mk(bevelBox(0.05, 0.04, 0.014, 0.005), M.buckle, spine, 0, -0.018, loftPoint(TORSO, -0.018, F, TORSO_SQ, 0.016)[2]);
}

// 手臂：上臂（肩头宽、肘部收）、前臂（带袖口）、手套
function buildArm(M, spine, s) {
  const sh = joint(spine, s * 0.215, 0.36, -0.01);
  mk(loft([...ballDn(-0.28, 0.05), [-0.28, 0.05], [-0.2, 0.054, 0.056, 0.057], [-0.1, 0.063, 0.065, 0.066], [-0.02, 0.07, 0.07, 0.073], [0.03, 0.066, 0.066, 0.069], [0.062, 0.045, 0.046, 0.05], [0.078, 0.015]], { seg: 14 }), M.jacket, sh);
  const el = joint(sh, 0, -0.28, 0);
  mk(loft([[-0.262, 0.036, 0.033], [-0.2, 0.042, 0.04], [-0.1, 0.05, 0.048, 0.05], [-0.02, 0.052, 0.052], [0, 0.05], ...ballUp(0, 0.05)], { seg: 14 }), M.jacket, el);
  // 袖口的魔术贴收紧带
  mk(loft([[-0.268, 0.0385, 0.0355], [-0.238, 0.0425, 0.0395]], { seg: 14, capT: false }), M.jacketDark, el);
  mk(bevelBox(0.008, 0.022, 0.034, 0.003), M.jacketDark, el, s * 0.042, -0.25, 0.0);
  const hand = joint(el, 0, -0.27, 0);
  // 手套：手掌扁、指尖略向前弯，拇指朝前
  mk(loft([[-0.148, 0.01, 0.016, 0.016, 0, 0.02], [-0.135, 0.016, 0.03, 0.028, 0, 0.016], [-0.098, 0.02, 0.04, 0.038, 0, 0.008], [-0.058, 0.023, 0.044, 0.04, 0, 0.002], [-0.02, 0.027, 0.036, 0.034], [0.012, 0.034, 0.036, 0.034], [0.024, 0.036, 0.038, 0.036]], { seg: 12, sq: 0.15 }), M.glove, hand);
  const thumb = mk(new THREE.CapsuleGeometry(0.013, 0.036, 3, 8), M.glove, hand, -s * 0.006, -0.052, 0.046); thumb.rotation.set(0.7, 0, 0);
  return { sh, el, hand };
}

// 登山杖：手柄 + 腕带、两节杖杆 + 锁扣、杖尖 + 泥托
function buildPole(M, hand) {
  const pole = joint(hand, 0, -0.01, 0.02);
  mk(lathe([[0.016, -0.07], [0.019, -0.05], [0.017, -0.01], [0.02, 0.03], [0.022, 0.06], [0.016, 0.075], [0.0, 0.078]], 10), M.grip, pole);
  mk(new THREE.TorusGeometry(0.036, 0.004, 4, 12, Math.PI * 1.3), M.strap, pole, 0, 0.03, -0.02).rotation.set(0, Math.PI / 2, 2.2);
  mk(new THREE.CylinderGeometry(0.0095, 0.0095, 0.56, 8), M.pole, pole, 0, -0.35, 0);
  mk(new THREE.CylinderGeometry(0.0075, 0.007, 0.56, 8), M.pole, pole, 0, -0.9, 0);
  mk(new THREE.CylinderGeometry(0.014, 0.013, 0.04, 8), M.grip, pole, 0, -0.63, 0);
  mk(lathe([[0.0, -1.055], [0.036, -1.05], [0.034, -1.04], [0.01, -1.025], [0.008, -1.0]], 12), M.grip, pole);
  mk(new THREE.ConeGeometry(0.007, 0.05, 6), M.buckle, pole, 0, -1.2, 0).rotation.x = Math.PI;
  pole.visible = false;
  return pole;
}

// 腿：大腿、小腿（小腿肚在后）、登山鞋
function buildLeg(M, pelvis, s) {
  const hip = joint(pelvis, s * 0.1, -0.04, 0);
  hip.rotation.order = 'ZXY';       // 先外展再前后摆：整条腿始终在一个平面里，反向运动学好解
  mk(loft([...ballDn(-0.43, 0.06), [-0.43, 0.06, 0.062, 0.06], [-0.34, 0.066, 0.07, 0.068], [-0.2, 0.08, 0.088, 0.085], [-0.08, 0.088, 0.096, 0.095], [0.0, 0.086, 0.09, 0.093], [0.05, 0.07, 0.07, 0.076], [0.085, 0.03]], { seg: 14 }), M.pants, hip);
  const kn = joint(hip, 0, -0.43, 0);
  mk(loft([[-0.42, 0.05, 0.055, 0.056], [-0.4, 0.052, 0.056, 0.057], [-0.355, 0.047, 0.05, 0.053], [-0.26, 0.052, 0.05, 0.067], [-0.14, 0.058, 0.056, 0.07], [-0.03, 0.06, 0.064, 0.062], [0, 0.06], ...ballUp(0, 0.06)], { seg: 14, capB: false }), M.pants, kn);
  // 膝盖的立体剪裁缝线
  mk(loftStrap([[-0.1, 0.06, 0.066, 0.064], [0.02, 0.062, 0.066, 0.064]], [[Math.PI / 2 - 0.9, -0.04], [Math.PI / 2 - 0.45, -0.052], [Math.PI / 2, -0.056], [Math.PI / 2 + 0.45, -0.052], [Math.PI / 2 + 0.9, -0.04]], 0.006, 0.004), M.jacketDark, kn);
  const an = joint(kn, 0, -0.43, 0);
  // 鞋帮（高帮，垫厚的鞋口）
  mk(loft([[-0.075, 0.05, 0.062, 0.052], [-0.03, 0.047, 0.052, 0.05], [0.03, 0.049, 0.051, 0.054], [0.068, 0.054, 0.054, 0.058], [0.08, 0.05, 0.05, 0.054]], { seg: 14 }), M.boot, an);
  mk(loft([[0.066, 0.056, 0.056, 0.06], [0.086, 0.055, 0.054, 0.058]], { seg: 14, capB: false, capT: false }), M.strap, an);
  // 鞋面：沿脚长方向放样（鞋跟 → 鞋头），转成水平
  const foot = loft([[-0.086, 0.022, 0.018, 0.022], [-0.076, 0.04, 0.03, 0.046], [-0.04, 0.05, 0.032, 0.06], [0.02, 0.052, 0.032, 0.06], [0.08, 0.056, 0.032, 0.05], [0.14, 0.058, 0.032, 0.04], [0.185, 0.051, 0.03, 0.032], [0.208, 0.034, 0.026, 0.022], [0.216, 0.012, 0.014, 0.012]], { seg: 14, sq: 0.15 });
  foot.rotateX(Math.PI / 2);
  mk(foot, M.boot, an, 0, -0.034, 0);
  // 鞋头的橡胶包头、鞋带、鞋舌
  const toe = loft([[0.15, 0.06, 0.034, 0.03], [0.19, 0.053, 0.032, 0.03], [0.212, 0.036, 0.028, 0.02], [0.221, 0.012, 0.014, 0.01]], { seg: 14, sq: 0.15, capB: false }); toe.rotateX(Math.PI / 2);
  mk(toe, M.sole, an, 0, -0.034, 0);
  for (let k = 0; k < 4; k++) { const lz = 0.012 + k * 0.03; const lace = mk(bevelBox(0.07 - k * 0.004, 0.006, 0.008, 0.003), M.strap, an, 0, -0.034 + 0.061 - k * 0.0045, lz); lace.rotation.x = 0.12 + k * 0.05; lace.castShadow = false; }
  // 大底：比鞋面宽一圈，鞋跟加厚
  const soleG = loft([[-0.09, 0.026, 0.016, 0.014], [-0.078, 0.045, 0.016, 0.014], [-0.04, 0.054, 0.016, 0.014], [0.02, 0.055, 0.016, 0.014], [0.08, 0.059, 0.016, 0.014], [0.14, 0.061, 0.016, 0.014], [0.19, 0.054, 0.016, 0.012], [0.214, 0.036, 0.014, 0.01], [0.223, 0.014, 0.012, 0.008]], { seg: 14, sq: 0.5 }); soleG.rotateX(Math.PI / 2);
  const sole = mk(soleG, M.sole, an, 0, -0.068, 0);
  mk(bevelBox(0.094, 0.014, 0.075, 0.005), M.sole, an, 0, -0.083, -0.04);
  mk(bevelBox(0.104, 0.01, 0.11, 0.004), M.sole, an, 0, -0.082, 0.13);
  return { hip, kn, an, sole };
}

// 背包：主袋（可随容量缩放）、顶包、前袋、侧袋水壶、压缩带、底部的防潮垫
export function buildPack(M, pk) {
  const BAG = [[-0.3, 0.1, 0.1, 0.1], [-0.275, 0.14, 0.14, 0.14], [-0.16, 0.152, 0.15, 0.15], [0.04, 0.15, 0.148, 0.15], [0.19, 0.142, 0.14, 0.145], [0.27, 0.125, 0.12, 0.13], [0.305, 0.08, 0.07, 0.085]];
  const packBody = mk(loft(BAG, { seg: 18, sq: 0.42 }), M.pack, pk, 0, 0, -0.1);
  // 跟着主袋一起缩放的零件：两道压缩带、背面的挂点织带、两侧的网兜
  for (const y of [-0.12, 0.1]) { const ring = []; for (let i = 0; i <= 20; i++) ring.push([i / 20 * Math.PI * 2, y]); mk(loftStrap(BAG, ring, 0.018, 0.008, 0.42), M.strap, packBody); }
  const B = -Math.PI / 2;
  mk(loftStrap(BAG, [[B, -0.24], [B, -0.12], [B, 0.0], [B, 0.12], [B, 0.24]], 0.03, 0.008, 0.42), M.strap, packBody);
  for (const s of [-1, 1]) mk(loft([[-0.27, 0.03, 0.07, 0.07], [-0.2, 0.04, 0.085, 0.085], [-0.08, 0.042, 0.085, 0.085], [-0.06, 0.036, 0.08, 0.08]], { seg: 10, sq: 0.4 }), M.packAccent, packBody, s * 0.135, 0, -0.01);
  // 顶包 + 两根扣带
  const packLid = mk(loft([[-0.035, 0.15, 0.12, 0.13], [0.0, 0.156, 0.126, 0.134], [0.035, 0.135, 0.105, 0.115], [0.056, 0.08, 0.06, 0.07]], { seg: 16, sq: 0.5 }), M.packAccent, pk, 0, 0.27, -0.1);
  for (const s of [-1, 1]) mk(bevelBox(0.018, 0.1, 0.008, 0.003), M.strap, packLid, s * 0.07, -0.06, -0.128);
  // 前袋（带一道拉链）
  const packPocket = mk(loft([[-0.11, 0.08, 0.035, 0.04], [-0.07, 0.1, 0.04, 0.05], [0.05, 0.1, 0.04, 0.05], [0.1, 0.075, 0.03, 0.036]], { seg: 14, sq: 0.5 }), M.packAccent, pk, 0, -0.06, -0.24);
  mk(bevelBox(0.13, 0.008, 0.006, 0.002), M.strap, packPocket, 0, 0.055, -0.048);
  // 水壶
  const bottle = mk(lathe([[0.0, -0.1], [0.032, -0.098], [0.035, -0.08], [0.035, 0.05], [0.03, 0.07], [0.017, 0.082], [0.017, 0.095]], 12), M.bottle, pk, 0.2, -0.08, -0.1);
  mk(new THREE.CylinderGeometry(0.021, 0.021, 0.024, 12), M.strap, bottle, 0, 0.105, 0);
  // 防潮垫：一卷，两道捆带
  const padRoll = mk(new THREE.CylinderGeometry(0.075, 0.075, 0.48, 16), M.pad, pk, 0, -0.3, -0.12); padRoll.rotation.z = Math.PI / 2;
  for (const y of [-0.13, 0.13]) mk(new THREE.CylinderGeometry(0.0775, 0.0775, 0.022, 16, 1, true), M.strap, padRoll, 0, y, 0);
  for (const y of [-0.241, 0.241]) { const end = mk(new THREE.TorusGeometry(0.04, 0.012, 4, 14), M.pad, padRoll, 0, y, 0); end.rotation.x = Math.PI / 2; end.castShadow = false; }
  for (const m of [packBody, packLid, packPocket, bottle, padRoll]) m.userData.keep = true;
  return { packBody, packLid, packPocket, bottle, padRoll };
}

// 同一个关节下、同一种材质的零件合并成一个网格，省绘制调用。标了 keep 的（要单独缩放 / 开关的部件）不动，但它的子零件照样合并
function compact(node) {
  const buckets = new Map();
  for (const ch of [...node.children]) {
    if (ch.isMesh && !ch.userData.keep && ch.children.length === 0) {
      const key = ch.material.uuid + (ch.castShadow ? 'c' : 'n');
      let b = buckets.get(key); if (!b) { b = { mat: ch.material, cast: ch.castShadow, list: [] }; buckets.set(key, b); }
      b.list.push(ch);
    } else compact(ch);
  }
  for (const b of buckets.values()) {
    if (b.list.length < 2) continue;
    const geos = b.list.map(m => { m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); return g; });
    const merged = new THREE.Mesh(merge(geos), b.mat); merged.castShadow = b.cast; merged.receiveShadow = true;
    for (const m of b.list) { node.remove(m); m.geometry.dispose(); }
    for (const g of geos) g.dispose();
    node.add(merged);
  }
}

// 拼出整个人。返回各关节和可以开关的部件；o.pack / o.poles / o.hat（'beanie' | 'brim' | false）/ o.lamp
export function buildHuman(M, o = {}) {
  o = { pack: true, poles: true, hat: 'beanie', lamp: true, ...o };
  const root = new THREE.Group();
  // 骨盆（裤子的臀胯部分）
  const pelvis = joint(root, 0, 0.96, 0);
  mk(loft(PELVIS, { seg: 18, sq: 0.22 }), M.pants, pelvis);
  // 脊柱 / 躯干
  const spine = joint(pelvis, 0, 0.06, 0);
  buildTorso(M, spine, o);
  // 颈、头
  const neck = joint(spine, 0, 0.44, 0);
  const head = joint(neck, 0, 0.1, 0.01);
  const lids = buildHead(M, head);
  const hatG = joint(head, 0, 0.06, 0);
  if (o.hat === 'brim') buildBrimHat(M, hatG); else if (o.hat) buildBeanie(M, hatG);
  const lampG = joint(head, 0, 0.09, 0);
  if (o.lamp) buildLamp(M, lampG);
  // 四肢
  const arm = {}, leg = {};
  for (const [side, s] of [['L', -1], ['R', 1]]) {
    const A = buildArm(M, spine, s);
    A.pole = o.poles ? buildPole(M, A.hand) : joint(A.hand);
    arm[side] = A;
    leg[side] = buildLeg(M, pelvis, s);
  }
  // 背包（挂在脊柱上）
  const packG = joint(spine, 0, 0.18, -0.13);
  const P = o.pack ? buildPack(M, packG) : {};
  compact(root);
  return { root, pelvis, spine, neck, head, hatG, lampG, arm, leg, packG, lids, ...P };
}

// 给一个人摆固定姿势（路人用）。pose：{ pelvisY, spine, neck, shL, shR, elL, elR, hipL, hipR, knL, knR, anL, anR }，值是 [x, y, z] 或一个数（绕 x）
export function poseHuman(H, pose) {
  const set = (o, v) => { if (v === undefined) return; if (typeof v === 'number') o.rotation.set(v, 0, 0); else o.rotation.set(v[0] || 0, v[1] || 0, v[2] || 0); };
  if (pose.pelvisY !== undefined) H.pelvis.position.y = pose.pelvisY;
  set(H.pelvis, pose.pelvis); set(H.spine, pose.spine); set(H.neck, pose.neck);
  for (const s of ['L', 'R']) { set(H.arm[s].sh, pose['sh' + s]); set(H.arm[s].el, pose['el' + s]); set(H.leg[s].hip, pose['hip' + s]); set(H.leg[s].kn, pose['kn' + s]); set(H.leg[s].an, pose['an' + s]); }
}
