// ===================== 主角：带关节的人物模型 / 多种姿态动作 / 移动物理 / 相机 =====================
import * as THREE from 'three';
import { groundAt, heightAt, treeCollide } from './terrain.js';
import { clamp, lerp } from './noise.js';

// 速度（游戏单位/秒）
export const SPEED = { walk: 3.3, run: 7.0, crouch: 1.6, prone: 0.7 };
export const STANCE_NAME = { stand: '慢走', run: '快跑', crouch: '蹲行', prone: '匍匐', sit: '坐下休息', ko: '倒地', slide: '滑坠', warm: '跳动取暖', coma: '昏迷' };

function mk(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function joint(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 5, 12);

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.push = new THREE.Vector3();
    this.yaw = Math.PI / 2;
    this.camYaw = 0;
    this.camPitch = -0.2;
    this.camDist = 5.6;
    this.firstPerson = false;
    this.onGround = true;
    this.stance = 'stand';     // stand / crouch / prone
    this.polesOut = false;
    this.hasPoles = false;
    this.sitting = false;
    this.sliding = false;
    this.slideSpeed = 0;
    this.ko = 0;               // 被吹倒/撞倒后爬起的倒计时
    this.rise = 0;             // 起身过渡
    this.stepAcc = 0;
    this.phase = 0;
    this.moving = false;
    this.sprinting = false;
    this.speedNow = 0;
    this.uphill = 0;
    this.onRock = false;
    this.airborneFrom = 0;
    this.events = [];
    this.shiver = 0;
    this.tired = 0;
    this.stagger = 0;
    this.buildModel();
  }

  get crouch() { return this.stance === 'crouch'; }
  get prone() { return this.stance === 'prone'; }
  stanceLabel() {
    if (this.coma) return STANCE_NAME.coma;
    if (this.ko > 0) return STANCE_NAME.ko;
    if (this.warming) return STANCE_NAME.warm;
    if (this.sliding) return STANCE_NAME.slide;
    if (this.sitting) return STANCE_NAME.sit;
    if (this.sprinting) return STANCE_NAME.run;
    return STANCE_NAME[this.stance];
  }

  // ---------------- 模型 ----------------
  buildModel() {
    const M = this.mats = {
      jacket: new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.72 }),
      jacketDark: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 }),
      pants: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.88 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc8957a, roughness: 0.65 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x1b1612, roughness: 0.9 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.85 }),
      boot: new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 0.85 }),
      sole: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }),
      pack: new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 0.8 }),
      packAccent: new THREE.MeshStandardMaterial({ color: 0x1c2621, roughness: 0.8 }),
      strap: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 }),
      pad: new THREE.MeshStandardMaterial({ color: 0xd27a26, roughness: 0.7 }),
      bottle: new THREE.MeshStandardMaterial({ color: 0x2c6fb0, roughness: 0.35, metalness: 0.2 }),
      hat: new THREE.MeshStandardMaterial({ color: 0x9b2424, roughness: 0.95 }),
      pole: new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.3, metalness: 0.85 }),
      grip: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xfff2c0, emissiveIntensity: 0 }),
    };
    const root = this.model = new THREE.Group();
    this.scene.add(root);
    // 骨盆
    const pelvis = this.pelvis = joint(root, 0, 0.96, 0);
    const hipM = mk(cap(0.12, 0.14), M.pants, pelvis, 0, -0.02, 0); hipM.rotation.z = Math.PI / 2; hipM.scale.set(1, 1, 0.78);
    // 脊柱 / 躯干
    const spine = this.spine = joint(pelvis, 0, 0.06, 0);
    const torso = mk(cap(0.16, 0.3), M.jacket, spine, 0, 0.2, 0); torso.scale.set(1.2, 1, 0.74);
    const belly = mk(cap(0.14, 0.08), M.jacket, spine, 0, 0.02, 0.01); belly.scale.set(1.18, 1, 0.8);
    mk(new THREE.BoxGeometry(0.018, 0.4, 0.02), M.jacketDark, spine, 0, 0.17, 0.122); // 拉链
    const collar = mk(new THREE.TorusGeometry(0.085, 0.04, 8, 16), M.jacket, spine, 0, 0.42, -0.005); collar.rotation.x = Math.PI / 2; collar.scale.set(1.1, 1, 1);
    // 头
    const neck = this.neck = joint(spine, 0, 0.44, 0);
    mk(cap(0.045, 0.06), M.skin, neck, 0, 0.03, 0);
    const head = this.head = joint(neck, 0, 0.1, 0.01);
    const skull = mk(new THREE.SphereGeometry(0.115, 18, 14), M.skin, head, 0, 0.04, 0); skull.scale.set(0.9, 1.06, 0.98);
    const jaw = mk(new THREE.SphereGeometry(0.085, 14, 10), M.skin, head, 0, -0.03, 0.03); jaw.scale.set(1, 0.8, 1);
    const nose = mk(new THREE.ConeGeometry(0.018, 0.05, 6), M.skin, head, 0, 0.03, 0.115); nose.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) {
      mk(new THREE.SphereGeometry(0.012, 6, 6), M.eye, head, s * 0.038, 0.06, 0.098);
      mk(new THREE.SphereGeometry(0.022, 8, 6), M.skin, head, s * 0.103, 0.04, 0).scale.set(0.5, 1, 0.8);
    }
    mk(new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M.hair, head, 0, 0.05, -0.01).scale.set(0.92, 1.05, 1);
    // 毛线帽
    this.hatG = joint(head, 0, 0.06, 0);
    mk(new THREE.SphereGeometry(0.124, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.hat, this.hatG, 0, 0.02, -0.005).scale.set(0.95, 1.1, 1.02);
    const cuff = mk(new THREE.TorusGeometry(0.112, 0.025, 8, 20), M.hat, this.hatG, 0, 0.02, -0.005); cuff.rotation.x = Math.PI / 2;
    mk(new THREE.SphereGeometry(0.04, 10, 8), M.hat, this.hatG, 0, 0.16, -0.01);
    // 头灯
    this.lampG = joint(head, 0, 0.09, 0);
    const band = mk(new THREE.TorusGeometry(0.118, 0.008, 4, 24), M.strap, this.lampG, 0, 0, 0); band.rotation.x = Math.PI / 2 - 0.15;
    mk(new THREE.BoxGeometry(0.06, 0.038, 0.03), M.lamp, this.lampG, 0, 0.0, 0.118);

    // 手臂
    this.arm = {};
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const sh = joint(spine, s * 0.215, 0.36, -0.01);
      mk(new THREE.SphereGeometry(0.07, 12, 10), M.jacket, sh, 0, 0, 0);
      mk(cap(0.056, 0.2), M.jacket, sh, 0, -0.14, 0);
      const el = joint(sh, 0, -0.28, 0);
      mk(cap(0.05, 0.17), M.jacket, el, 0, -0.12, 0);
      const hand = joint(el, 0, -0.27, 0);
      const glove = mk(new THREE.SphereGeometry(0.05, 10, 8), M.glove, hand, 0, -0.01, 0.01); glove.scale.set(0.85, 1.15, 1);
      // 登山杖
      const pole = joint(hand, 0, -0.01, 0.02);
      mk(new THREE.CylinderGeometry(0.021, 0.021, 0.13, 8), M.grip, pole, 0, 0.0, 0);
      mk(new THREE.CylinderGeometry(0.011, 0.009, 1.12, 6), M.pole, pole, 0, -0.6, 0);
      mk(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 10), M.grip, pole, 0, -1.04, 0);
      mk(new THREE.ConeGeometry(0.008, 0.04, 5), M.grip, pole, 0, -1.18, 0).rotation.x = Math.PI;
      pole.visible = false;
      this.arm[side] = { sh, el, hand, pole };
    }
    // 腿
    this.leg = {};
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const hip = joint(pelvis, s * 0.1, -0.04, 0);
      mk(cap(0.083, 0.3), M.pants, hip, 0, -0.21, 0);
      const kn = joint(hip, 0, -0.43, 0);
      mk(cap(0.068, 0.3), M.pants, kn, 0, -0.2, 0);
      const an = joint(kn, 0, -0.43, 0);
      const boot = mk(cap(0.062, 0.15), M.boot, an, 0, -0.05, 0.045); boot.rotation.x = Math.PI / 2; boot.scale.set(1.15, 1, 0.85);
      mk(cap(0.065, 0.08), M.boot, an, 0, -0.02, 0).scale.set(1.05, 1, 1.05);
      const sole = mk(new THREE.BoxGeometry(0.13, 0.03, 0.29), M.sole, an, 0, -0.1, 0.045);
      this.leg[side] = { hip, kn, an, sole };
    }
    // 背包（挂在脊柱上）
    const pk = this.packG = joint(spine, 0, 0.18, -0.13);
    this.packBody = mk(cap(0.16, 0.3), M.pack, pk, 0, 0, -0.1); this.packBody.scale.set(1.2, 1, 0.68);
    this.packLid = mk(new THREE.SphereGeometry(0.17, 14, 10), M.packAccent, pk, 0, 0.27, -0.1); this.packLid.scale.set(1.05, 0.38, 0.72);
    this.packPocket = mk(cap(0.1, 0.12), M.packAccent, pk, 0, -0.06, -0.24); this.packPocket.scale.set(1.3, 1, 0.5);
    this.bottle = mk(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), M.bottle, pk, 0.2, -0.08, -0.1);
    this.padRoll = mk(new THREE.CylinderGeometry(0.075, 0.075, 0.48, 14), M.pad, pk, 0, -0.3, -0.12); this.padRoll.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) {
      const st = mk(new THREE.BoxGeometry(0.045, 0.42, 0.02), M.strap, spine, s * 0.1, 0.2, 0.125); st.rotation.z = s * 0.06;
      const st2 = mk(new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI), M.strap, spine, s * 0.11, 0.39, 0.02); st2.rotation.y = Math.PI / 2;
    }
    mk(new THREE.BoxGeometry(0.2, 0.022, 0.02), M.strap, spine, 0, 0.27, 0.128); // 胸带
    const belt = mk(new THREE.TorusGeometry(0.15, 0.022, 6, 18), M.strap, pelvis, 0, 0.05, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1.08, 0.8, 1);

    // 头灯光
    this.lamp = new THREE.SpotLight(0xfff1d6, 0, 60, 0.5, 0.45, 1.2);
    this.lampTarget = new THREE.Object3D();
    this.scene.add(this.lamp); this.scene.add(this.lampTarget);
    this.lamp.target = this.lampTarget;
  }

  setGear(inv) {
    const worn = inv.worn;
    const outer = worn.has('shell') ? 0xb3282d : worn.has('poncho') ? 0x3f86c8 : worn.has('down') ? 0xd9a21b : worn.has('fleece') ? 0x2f5d9a : worn.has('base') ? 0x56606b : 0x8a8f96;
    this.mats.jacket.color.setHex(outer);
    this.mats.jacket.roughness = worn.has('shell') || worn.has('poncho') ? 0.5 : 0.85;
    this.hatG.visible = worn.has('hat');
    this.mats.boot.color.setHex(inv.items.boots ? 0x5b3b22 : 0xc9c9c9);
    const c = inv.backpack ? inv.backpack.cap : 20;
    const s = 0.65 + c / 50 * 0.75;
    this.packBody.scale.set(1.0 + c / 120, s, 0.55 + c / 110);
    this.packBody.position.set(0, (s - 1) * 0.12, -0.08 - c / 500);
    this.packLid.position.set(0, 0.24 * s + 0.04, this.packBody.position.z);
    this.packPocket.position.set(0, -0.04, this.packBody.position.z - 0.12 - c / 600);
    this.bottle.visible = (inv.items.bottle || 0) > 0;
    this.bottle.position.set(0.17 + c / 400, -0.06, this.packBody.position.z);
    this.padRoll.visible = !!(inv.items.pad || inv.items.tent3 || inv.items.tent4);
    this.padRoll.position.set(0, -0.22 * s - 0.08, this.packBody.position.z);
    this.hasPoles = !!inv.items.poles;
    if (!this.hasPoles) this.polesOut = false;
    this.lampG.visible = !!inv.items.lamp;
    this.updatePoleVis();
  }
  updatePoleVis() { for (const k of ['L', 'R']) this.arm[k].pole.visible = this.polesOut; }
  togglePoles() { if (!this.hasPoles) return false; this.polesOut = !this.polesOut; this.updatePoleVis(); return true; }

  setStance(s) {
    if (this.stance === s) return;
    if (this.stance === 'prone' && s !== 'prone') this.rise = 0.55;
    this.stance = s;
  }

  knockDown(t = 1.6) { this.ko = t; this.stance = 'stand'; this.sitting = false; this.events.push({ type: 'knockdown' }); }

  terrainNormal(x, z) {
    const e = 0.7;
    const hx = heightAt(x + e, z) - heightAt(x - e, z);
    const hz = heightAt(x, z + e) - heightAt(x, z - e);
    return new THREE.Vector3(-hx, 2 * e, -hz).normalize();
  }

  // ---------------- 移动 ----------------
  update(dt, input, mods) {
    this.events.length = 0;
    const p = this.pos;
    this.ko = Math.max(0, this.ko - dt);
    this.rise = Math.max(0, this.rise - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    const fwd = new THREE.Vector3(Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    this.coma = !!mods.coma;
    if (this.coma) { this.ko = Math.max(this.ko, 1.2); this.sitting = false; }
    const locked = mods.locked || this.ko > 0 || this.rise > 0;
    let back = false, strafe = false;
    // 触屏摇杆给的是模拟量（ax 右 / ay 前，0–1）；键盘时两者都为 0，走原来的 WASD 逻辑
    const analog = !!(input.ax || input.ay);
    const aMag = analog ? Math.min(1, Math.hypot(input.ax, input.ay)) : 1;
    const fwdIn = analog ? input.ay > 0.5 : input.f;
    if (!locked) {
      if (analog) {
        wish.addScaledVector(fwd, input.ay).addScaledVector(right, input.ax);
        back = input.ay < 0 && -input.ay > Math.abs(input.ax) * 1.4;   // 摇杆往正后方拉 = 后退（同 S 键）
        strafe = Math.abs(input.ax) > Math.abs(input.ay);
      } else {
        if (input.f) wish.add(fwd);
        if (input.b) { wish.sub(fwd); back = !input.f; }
        if (input.r) { wish.add(right); strafe = true; }
        if (input.l) { wish.sub(right); strafe = true; }
      }
    }
    // 鬼打墙：方向感偏移
    if (mods.drift) wish.applyAxisAngle(new THREE.Vector3(0, 1, 0), mods.drift);
    const wantMove = wish.lengthSq() > 0;
    if (wantMove) wish.normalize();
    if (wantMove || this.sliding) this.sitting = false;
    // 原地跳动取暖
    this.warming = !!input.warm && !wantMove && !locked && this.onGround && !this.sliding && mods.canSprint;
    if (this.warming) { this.sitting = false; if (this.stance !== 'stand') this.setStance('stand'); }
    if (this.warming) { this.stompT = (this.stompT || 0) - dt; if (this.stompT <= 0) { this.stompT = 0.36; this.events.push({ type: 'stomp' }); } }
    // 快跑会让人站起来
    if (input.sprint && wantMove && this.stance === 'crouch' && mods.canSprint) this.setStance('stand');
    this.sprinting = input.sprint && wantMove && mods.canSprint && this.stance === 'stand' && !this.sliding && fwdIn && !locked;
    const base = this.sprinting ? SPEED.run : this.stance === 'crouch' ? SPEED.crouch : this.stance === 'prone' ? SPEED.prone : SPEED.walk;
    let speed = base * mods.speedMult * (back ? 0.6 : strafe && !fwdIn ? 0.85 : 1);
    if (analog && !this.sprinting) speed *= lerp(0.4, 1, aMag);   // 摇杆推得越远走得越快
    if (this.polesOut && !this.sprinting && this.stance === 'stand') speed *= 1.04;

    const gNow = groundAt(p.x, p.z);
    const n = this.terrainNormal(p.x, p.z);
    this.slopeNY = n.y;
    let uphill = 0;
    if (wantMove) {
      const ah = groundAt(p.x + wish.x * 1.2, p.z + wish.z * 1.2).y;
      uphill = (ah - gNow.y) / 1.2;
      speed *= clamp(1 - Math.max(uphill, 0) * (this.polesOut ? 0.45 : 0.55), 0.4, 1) * (uphill < -0.15 ? 1.04 : 1);
      if (mods.stone && !this.sprinting) speed *= this.polesOut ? 0.8 : 0.7;
    }
    this.uphill = uphill;

    // ------- 滑坠 -------
    const grip = this.stance === 'prone' ? -0.12 : this.stance === 'crouch' ? -0.05 : 0;
    const slideNY = mods.slideNY + grip;
    const steep = !gNow.onRock && n.y < slideNY;
    if (this.onGround && steep && !this.sliding) { this.sliding = true; this.slideSpeed = Math.max(this.slideSpeed, 2); this.events.push({ type: 'slideStart' }); }
    if (this.sliding) {
      const sinT = Math.sqrt(1 - n.y * n.y), cosT = n.y;
      const arrest = (this.stance !== 'stand' || input.crouch) && n.y > 0.6;
      const mu = arrest ? 0.95 : 0.25;
      const a = 20 * (sinT - mu * cosT);
      this.slideSpeed = Math.max(0, this.slideSpeed + a * dt);
      const down = new THREE.Vector3(n.x, 0, n.z).normalize();
      const hs = this.slideSpeed * cosT;
      this.vel.x = down.x * hs + wish.x * 1.2; this.vel.z = down.z * hs + wish.z * 1.2;
      if (!steep && n.y > slideNY + 0.05) {
        if (this.slideSpeed > 13) this.events.push({ type: 'impact', speed: this.slideSpeed, from: 'slide' });
        this.sliding = false; this.slideSpeed = 0;
      } else if (this.slideSpeed < 0.5 && n.y > slideNY - 0.08) { this.sliding = false; this.slideSpeed = 0; }
    } else {
      const target = wish.clone().multiplyScalar(locked ? 0 : speed);
      const acc = this.onGround ? (this.stance === 'prone' ? 6 : 11) : 1.5;
      this.vel.x = lerp(this.vel.x, target.x, 1 - Math.exp(-acc * dt));
      this.vel.z = lerp(this.vel.z, target.z, 1 - Math.exp(-acc * dt));
    }
    // 外力（阵风、撞击）
    this.vel.x += this.push.x * dt * 6; this.vel.z += this.push.z * dt * 6;
    this.push.multiplyScalar(Math.exp(-dt * 1.6));

    // 跳跃 / 起身
    if (input.jump && !locked) {
      if (this.stance !== 'stand') { this.setStance('stand'); }
      else if (this.onGround && !this.sliding && mods.canJump) { this.vel.y = 6.0; this.onGround = false; this.airborneFrom = p.y; this.events.push({ type: 'jump' }); }
    }

    // ------- 水平移动 + 台阶 -------
    const maxStep = this.onGround ? (this.stance === 'prone' ? 0.6 : 0.95) : 1.6;
    const tryMove = (dx, dz) => {
      const nx = p.x + dx, nz = p.z + dz;
      const g2 = groundAt(nx, nz);
      const footY = this.onGround ? gNow.y : p.y;
      if (g2.y - footY > maxStep && g2.onRock) return false;
      p.x = nx; p.z = nz; return true;
    };
    const dx = this.vel.x * dt, dz = this.vel.z * dt;
    if (!tryMove(dx, dz)) { if (!tryMove(dx, 0)) this.vel.x = 0; if (!tryMove(0, dz)) this.vel.z = 0; }
    const tc = treeCollide(p.x, p.z, 0.35);
    if (tc) { p.x = tc.x; p.z = tc.z; }

    // ------- 竖直 -------
    const g = groundAt(p.x, p.z);
    this.onRock = g.onRock;
    if (this.onGround) {
      const drop = p.y - g.y;
      if (drop > 0.6 && !this.sliding) { this.onGround = false; this.airborneFrom = p.y; this.vel.y = 0; }
      else {
        p.y = g.y > p.y ? lerp(p.y, g.y, 1 - Math.exp(-22 * dt)) : g.y;
        if (g.y - p.y > 0.25) p.y = g.y - 0.25;
        this.vel.y = 0;
      }
    }
    if (!this.onGround) {
      this.vel.y -= 22 * dt;
      p.y += this.vel.y * dt;
      if (p.y <= g.y) {
        const impact = -this.vel.y;
        p.y = g.y; this.onGround = true;
        this.events.push({ type: 'land', speed: impact, height: this.airborneFrom - g.y });
        if (impact > 12.5) this.events.push({ type: 'impact', speed: impact, from: 'fall' });
        this.vel.y = 0;
      }
    }

    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    this.speedNow = hspeed;
    this.moving = hspeed > 0.35;
    if (this.moving && this.onGround && !this.sliding) {
      this.stepAcc += hspeed * dt;
      const stride = this.sprinting ? 1.2 : this.stance === 'crouch' ? 0.55 : this.stance === 'prone' ? 0.5 : 0.8;
      if (this.stepAcc > stride) { this.stepAcc = 0; this.events.push({ type: 'step', rock: g.onRock, speed: hspeed, stance: this.stance, pole: this.polesOut }); }
    }
    if (wantMove && !this.sliding && !locked) {
      const targetYaw = Math.atan2(wish.x, wish.z);
      let dd = (back ? targetYaw + Math.PI : targetYaw) - this.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      this.yaw += dd * (1 - Math.exp(-(this.stance === 'prone' ? 4 : 10) * dt));
    }
    if (this.firstPerson && !locked) this.yaw = Math.atan2(fwd.x, fwd.z);
    this.shiver = mods.shiver || 0;
    this.tired = mods.tired || 0;
    this.animate(dt, hspeed, mods, back);
  }

  // ---------------- 动画 ----------------
  animate(dt, hs, mods, back) {
    const m = this.model;
    m.position.copy(this.pos);
    m.rotation.y = this.yaw;
    const T = this._t = (this._t || 0) + dt;
    const P = {}; // 目标姿态
    const set = (k, x = 0, y = 0, z = 0) => { P[k] = [x, y, z]; };
    const run = this.sprinting;
    const k = clamp(hs / (run ? SPEED.run : SPEED.walk), 0, 1.3);
    const rate = run ? 9.5 : this.stance === 'crouch' ? 7 : this.stance === 'prone' ? 4.5 : 6.4;
    this.phase += dt * rate * Math.max(k, this.moving ? 0.5 : 0) * (back ? -1 : 1);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const mv = this.moving ? 1 : 0;
    const poles = this.polesOut;
    let pelvisY = 0.96, pelvisX = 0, pelvisZ = 0, pelvisYaw = 0;
    const lean = clamp(this.uphill, -0.3, 0.6) * 0.35;

    if (this.ko > 0 && this.ko > 0.5) {
      // 倒地（仰面）
      pelvisY = 0.18; pelvisX = -1.45;
      set('spine', 0.1); set('neck', 0.5);
      set('shL', -0.4, 0, -1.1); set('shR', -0.4, 0, 1.1); set('elL', -0.3); set('elR', -0.3);
      set('hipL', 0.1, 0, -0.15); set('hipR', -0.2, 0, 0.15); set('knL', 0.3); set('knR', 0.6); set('anL'); set('anR');
    } else if (this.ko > 0) {
      // 挣扎着爬起来
      pelvisY = 0.5; pelvisX = 0.6;
      set('spine', 0.6); set('neck', -0.5);
      set('shL', -0.9, 0, -0.2); set('shR', -0.9, 0, 0.2); set('elL', -0.2); set('elR', -0.2);
      set('hipL', -1.5); set('hipR', -0.6); set('knL', 1.8); set('knR', 1.2); set('anL', -0.3); set('anR', -0.3);
    } else if (this.sliding) {
      pelvisY = 0.42; pelvisX = -0.35;
      set('spine', -0.2); set('neck', 0.3);
      set('shL', -0.6, 0, -1.2); set('shR', -0.6, 0, 1.2); set('elL', -0.4); set('elR', -0.4);
      set('hipL', -1.2); set('hipR', -0.9); set('knL', 0.9); set('knR', 0.5); set('anL', 0.3); set('anR', 0.3);
    } else if (!this.onGround) {
      pelvisY = 0.96;
      set('spine', 0.1); set('neck', -0.1);
      set('shL', -0.6, 0, -0.5); set('shR', -0.4, 0, 0.5); set('elL', -0.9); set('elR', -0.9);
      set('hipL', -0.8); set('hipR', -0.1); set('knL', 1.3); set('knR', 0.5); set('anL', -0.2); set('anR', 0.1);
    } else if (this.sitting) {
      pelvisY = 0.22;
      set('spine', 0.25 + Math.sin(T * 1.4) * 0.015); set('neck', 0.15);
      set('shL', -0.7, 0, -0.1); set('shR', -0.7, 0, 0.1); set('elL', -1.0); set('elR', -1.0);
      set('hipL', -1.45, 0, -0.15); set('hipR', -1.45, 0, 0.15); set('knL', 1.75); set('knR', 1.75); set('anL', -0.2); set('anR', -0.2);
    } else if (this.stance === 'prone') {
      // 匍匐：身体贴地，手肘和膝盖交替前进
      pelvisY = 0.17; pelvisX = 1.47; pelvisZ = s * 0.06 * mv;
      set('spine', -0.04); set('neck', -1.15);
      const a = mv * 0.45;
      set('shL', -2.55 + s * a, 0, -0.35); set('shR', -2.55 - s * a, 0, 0.35);
      set('elL', -1.2 - Math.max(0, c) * 0.6 * mv); set('elR', -1.2 - Math.max(0, -c) * 0.6 * mv);
      set('hipL', -0.05 - Math.max(0, -s) * 0.6 * mv, 0, -0.25 - Math.max(0, -s) * 0.3 * mv); set('hipR', -0.05 - Math.max(0, s) * 0.6 * mv, 0, 0.25 + Math.max(0, s) * 0.3 * mv);
      set('knL', 0.15 + Math.max(0, -s) * 1.1 * mv); set('knR', 0.15 + Math.max(0, s) * 1.1 * mv);
      set('anL', 0.6); set('anR', 0.6);
    } else if (this.stance === 'crouch') {
      // 蹲行：重心压低，小步前进
      const A = 0.32 * k;
      pelvisY = 0.6 - Math.abs(c) * 0.02 * mv; pelvisYaw = s * 0.05 * mv;
      set('spine', 0.5 + lean); set('neck', -0.45);
      const hipBase = -1.05, knBase = 1.55;
      set('hipL', hipBase - s * A); set('hipR', hipBase + s * A);
      set('knL', knBase + Math.max(0, c) * 0.35 * mv); set('knR', knBase + Math.max(0, -c) * 0.35 * mv);
      set('anL', -0.5 + s * A * 0.4); set('anR', -0.5 - s * A * 0.4);
      if (poles) { set('shL', -0.55 + s * 0.2 * mv, 0, -0.15); set('shR', -0.55 - s * 0.2 * mv, 0, 0.15); set('elL', -0.7); set('elR', -0.7); }
      else { set('shL', -0.35 + s * 0.2 * mv, 0, -0.25); set('shR', -0.35 - s * 0.2 * mv, 0, 0.25); set('elL', -0.9); set('elR', -0.9); }
    } else if (this.moving) {
      // 慢走 / 快跑
      const A = (run ? 0.72 : 0.42) * Math.min(k, 1.1);
      const K = run ? 1.25 : 0.62;
      pelvisY = 0.96 - (run ? 0.05 : 0.015) * (1 - Math.abs(c)) - (run ? 0.03 : 0) + Math.abs(s) * 0.0;
      pelvisYaw = s * (run ? 0.14 : 0.08);
      set('spine', (run ? 0.28 : 0.08) + lean + mods.load * 0.12, -pelvisYaw * 1.2);
      set('neck', -(run ? 0.22 : 0.06) - lean * 0.6);
      set('hipL', -s * A - (run ? 0.15 : 0)); set('hipR', s * A - (run ? 0.15 : 0));
      set('knL', 0.08 + Math.max(0, c) * K + (run ? 0.15 : 0)); set('knR', 0.08 + Math.max(0, -c) * K + (run ? 0.15 : 0));
      set('anL', -0.15 * s + Math.max(0, c) * -0.2); set('anR', 0.15 * s + Math.max(0, -c) * -0.2);
      if (poles && !run) {
        // 撑杖行走：手臂前伸，杖尖交替点地
        set('shL', -0.42 + s * 0.32, 0, -0.12); set('shR', -0.42 - s * 0.32, 0, 0.12);
        set('elL', -0.75 - Math.max(0, -s) * 0.25); set('elR', -0.75 - Math.max(0, s) * 0.25);
      } else {
        const Aa = run ? 0.95 : 0.38;
        set('shL', s * Aa, 0, -0.08); set('shR', -s * Aa, 0, 0.08);
        set('elL', (run ? -1.45 : -0.3) - Math.max(0, -s) * 0.25); set('elR', (run ? -1.45 : -0.3) - Math.max(0, s) * 0.25);
      }
    } else {
      // 站立：呼吸、发抖、扶膝喘气
      const br = Math.sin(T * (1.4 + this.tired * 1.6)) * (0.015 + this.tired * 0.03);
      pelvisY = 0.96;
      set('spine', 0.04 + br + this.tired * 0.55); set('neck', -0.02 - this.tired * 0.35);
      set('hipL', -0.02 - this.tired * 0.35, 0, -0.04); set('hipR', 0.02 - this.tired * 0.35, 0, 0.04);
      set('knL', 0.05 + this.tired * 0.5); set('knR', 0.05 + this.tired * 0.5); set('anL', -this.tired * 0.15); set('anR', -this.tired * 0.15);
      if (this.warming) { // 原地蹦跳、甩臂、拍打身体
        const bj = Math.abs(Math.sin(T * 8.7));
        pelvisY = 0.9 + bj * 0.14;
        set('spine', 0.08 + bj * 0.05); set('neck', -0.05);
        set('hipL', -0.25 * (1 - bj), 0, -0.05); set('hipR', -0.25 * (1 - bj), 0, 0.05);
        set('knL', 0.5 * (1 - bj)); set('knR', 0.5 * (1 - bj)); set('anL', -0.25 * (1 - bj)); set('anR', -0.25 * (1 - bj));
        const sw = Math.sin(T * 8.7);
        set('shL', -0.9 - sw * 0.5, 0.2, -0.3 + sw * 0.5); set('shR', -0.9 + sw * 0.5, -0.2, 0.3 + sw * 0.5);
        set('elL', -1.4); set('elR', -1.4);
      } else if (this.shiver > 0.2) { // 抱臂发抖
        set('shL', -0.5, 0.3, -0.05); set('shR', -0.5, -0.3, 0.05); set('elL', -1.9, 0.4); set('elR', -1.9, -0.4);
      } else if (this.tired > 0.3) { // 双手撑膝
        set('shL', -0.75, 0, 0.05); set('shR', -0.75, 0, -0.05); set('elL', -0.15); set('elR', -0.15);
      } else if (poles) {
        set('shL', -0.3, 0, -0.18); set('shR', -0.3, 0, 0.18); set('elL', -0.6); set('elR', -0.6);
      } else {
        set('shL', 0.03 + br, 0, -0.1); set('shR', 0.03 - br, 0, 0.1); set('elL', -0.2); set('elR', -0.2);
      }
    }
    // 起身过渡（从匍匐爬起）
    if (this.rise > 0) { pelvisY = lerp(pelvisY, 0.45, this.rise / 0.55); pelvisX = lerp(pelvisX, 0.7, this.rise / 0.55); }
    // 发抖 & 阵风踉跄
    const shv = this.shiver * 0.03 * Math.sin(T * 47);
    const stg = this.stagger > 0 ? Math.sin(T * 9) * 0.12 * this.stagger : 0;
    pelvisZ += (mods.sway || 0) + stg;

    // 应用
    const r = 1 - Math.exp(-dt * (this.ko > 0 ? 8 : 16));
    const sm = (o, x, y, z) => { o.rotation.x += (x - o.rotation.x) * r; o.rotation.y += (y - o.rotation.y) * r; o.rotation.z += (z - o.rotation.z) * r; };
    this.pelvis.position.y += (pelvisY - this.pelvis.position.y) * r;
    sm(this.pelvis, pelvisX, pelvisYaw, pelvisZ);
    const g = (key) => P[key] || [0, 0, 0];
    const sp = g('spine'); sm(this.spine, sp[0], sp[1], sp[2] + shv);
    // 头部看向相机方向（第三人称）
    let look = 0;
    if (!this.firstPerson && this.stance !== 'prone' && this.ko <= 0) { let d = Math.atan2(Math.cos(this.camYaw), Math.sin(this.camYaw)) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); look = clamp(d, -0.9, 0.9) * 0.6; }
    const nk = g('neck'); sm(this.neck, nk[0] - this.camPitch * 0.25, look, nk[2]);
    for (const side of ['L', 'R']) {
      const A = this.arm[side], L = this.leg[side];
      const sh = g('sh' + side), el = g('el' + side);
      sm(A.sh, sh[0], sh[1], sh[2] + shv * (side === 'L' ? 1 : -1));
      sm(A.el, el[0], el[1], el[2]);
      const hp = g('hip' + side), kn = g('kn' + side), an = g('an' + side);
      sm(L.hip, hp[0], hp[1], hp[2]); sm(L.kn, kn[0], kn[1], kn[2]); sm(L.an, an[0], an[1], an[2]);
      // 杖身尽量保持朝下、略向前
      if (A.pole.visible) {
        const world = A.sh.rotation.x + A.el.rotation.x + this.spine.rotation.x + this.pelvis.rotation.x;
        A.pole.rotation.x = -world + (this.moving ? 0.28 : 0.12);
        A.pole.rotation.z = (side === 'L' ? 1 : -1) * 0.06;
      }
    }
    this.model.visible = !this.firstPerson && !this.hidden;
  }

  headHeight() {
    if (this.ko > 0) return 0.45;
    if (this.sitting) return 0.85;
    if (this.stance === 'prone') return 0.42;
    if (this.stance === 'crouch') return 1.05;
    return 1.62;
  }

  // ---------------- 相机 ----------------
  updateCamera(camera, dt, shake = 0, wobble = 0, t = 0) {
    const hh = this._hh = lerp(this._hh || 1.62, this.headHeight(), 1 - Math.exp(-8 * dt));
    const head = new THREE.Vector3(this.pos.x, this.pos.y + hh, this.pos.z);
    const tpHead = head.clone(); tpHead.y += 0.42;
    const dir = new THREE.Vector3(Math.cos(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.sin(this.camYaw) * Math.cos(this.camPitch));
    if (this.firstPerson) {
      const amp = this.sprinting ? 0.07 : this.stance === 'prone' ? 0.03 : 0.04;
      const bob = this.moving && this.onGround ? Math.sin(this.phase * 2) * amp * Math.min(this.speedNow / 3, 1.5) : 0;
      const sway = this.moving ? Math.cos(this.phase) * amp * 0.6 : 0;
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      camera.position.copy(head).add(new THREE.Vector3(0, bob, 0)).addScaledVector(side, sway).addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), this.stance === 'prone' ? 0.45 : 0.12);
    } else {
      const shoulder = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.65);
      const target = tpHead.add(shoulder);
      let dist = this.camDist * (this.stance === 'prone' ? 0.75 : 1);
      for (let i = 1; i <= 6; i++) {
        const tt = i / 6;
        const q = target.clone().addScaledVector(dir, -dist * tt);
        if (q.y < groundAt(q.x, q.z).y + 0.35) { dist = dist * (tt - 1 / 6) + 0.4; break; }
      }
      const camPos = target.clone().addScaledVector(dir, -dist);
      const gy = groundAt(camPos.x, camPos.z).y + 0.35;
      if (camPos.y < gy) camPos.y = gy;
      camera.position.lerp(camPos, 1 - Math.exp(-25 * dt));
      if (camera.position.distanceTo(camPos) > 3) camera.position.copy(camPos);
    }
    const look = camera.position.clone().add(dir);
    if (shake > 0) { look.x += (Math.random() - 0.5) * shake * 0.02; look.y += (Math.random() - 0.5) * shake * 0.02; }
    camera.lookAt(look);
    if (wobble > 0) camera.rotateZ(Math.sin(t * 0.9) * wobble * 0.06 + Math.sin(t * 2.3) * wobble * 0.02);
    this.lamp.position.copy(head).add(new THREE.Vector3(0, 0.12, 0));
    const ld = this.firstPerson ? dir.clone() : new THREE.Vector3(Math.sin(this.yaw), Math.max(-0.35, this.camPitch * 0.6 - 0.15), Math.cos(this.yaw));
    this.lampTarget.position.copy(this.lamp.position).addScaledVector(ld.normalize(), 10);
  }
}
