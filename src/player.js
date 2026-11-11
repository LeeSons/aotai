// ===================== 主角：带关节的人物模型 / 多种姿态动作 / 移动物理 / 相机 =====================
import * as THREE from 'three';
import { groundAt, heightAt, treeCollide } from './terrain.js';
import { humanMats, buildHuman } from './human.js';
import { clamp, lerp, smoothstep } from './noise.js';
import { altToY } from './data.js';

// 速度（游戏单位/秒）
export const SPEED = { walk: 3.3, run: 7.0, crouch: 1.6, prone: 0.7 };
const GRAVITY = 22;
// 无敌模式：快跑 10 m/s；起跳初速 √(2gh) → 跳起 2 米
const GOD_RUN = 10, GOD_JUMP_V = Math.sqrt(2 * GRAVITY * 2.0);
// 无敌模式：长按空格（超过 0.25 秒）起飞，之后一直踏空悬停；按住下降落到地面才退出飞行
// 踏空时前进 / 后退沿视线方向（抬头往上飞、低头往下飞），左右水平平移，空格 / C 竖直升降
// 飞行速度分档：低速按 m/s，高速按马赫，最快 3.5 马赫。声速随气温变：c = 331.3 + 0.606·T（m/s）
export const FLY_GEARS = [5, 10, 20, 30, 50, 80, 120, 200, 'M1', 'M1.5', 'M2', 'M2.5', 'M3', 'M3.5'];
export const FLY_GEAR0 = 3;   // 默认 30 m/s
// 无敌模式在地面上：快跑速度也分档，最快 2 马赫；行走是快跑的 1/3（不低于正常步行 3.3 m/s）。默认档 = 快跑 10 m/s
export const RUN_GEARS = [5, 7, 10, 15, 20, 30, 50, 80, 120, 200, 'M1', 'M1.5', 'M2'];
export const RUN_GEAR0 = RUN_GEARS.indexOf(10);
export const soundSpeed = (tC) => 331.3 + 0.606 * tC;
export const gearSpeed = (g, tC) => typeof g === 'string' ? parseFloat(g.slice(1)) * soundSpeed(tC) : g;
export const gearLabel = (g, tC) => typeof g === 'string' ? `马赫 ${g.slice(1)}（约 ${Math.round(gearSpeed(g, tC))} m/s）` : `${g} m/s`;
// 飞行上限：海拔 1 万米（民航巡航高度，再往上就接近对流层顶）
export const FLY_CEIL_ALT = 10000;
const FLY_HOLD = 0.25, FLY_CEIL_Y = altToY(FLY_CEIL_ALT);
const PITCH_WALK = [-1.25, 0.95], PITCH_FLY = [-1.5, 1.5];   // 飞行时可以几乎垂直地仰视 / 俯视
export const STANCE_NAME = { stand: '慢走', run: '快跑', crouch: '蹲行', prone: '匍匐', sit: '坐下休息', ko: '倒地', slide: '滑坠', warm: '跳动取暖', coma: '昏迷', fly: '踏空飞行' };

// 腿的尺寸（和 human.js 里的骨架一致）：大腿、小腿长度，脚踝离鞋底的高度，髋关节在骨盆里的位置，腿最长能伸多远
const L1 = 0.43, L2 = 0.43, ANK_H = 0.085, HIP_X = 0.1, HIP_Y = -0.04, REACH = 0.852;
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _e1 = new THREE.Euler();

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
    // 脚的落点（相对身体、平地基准）、脚掌俯仰、脚下地面比身体中心高多少；反向运动学的权重；骨盆被腿“拉低”了多少
    this.footT = { L: new THREE.Vector3(-HIP_X, ANK_H, 0), R: new THREE.Vector3(HIP_X, ANK_H, 0) };
    this.footP = { L: 0, R: 0 }; this.footG = { L: 0, R: 0 }; this._u = { L: 0, R: 0.5 };
    this.ikW = 0; this.pelvisBaseY = 0.96; this.pelvisDrop = 0; this.packLag = 0.96; this.blinkT = 2;
    this.buildModel();
  }

  get crouch() { return this.stance === 'crouch'; }
  get prone() { return this.stance === 'prone'; }
  stanceLabel() {
    if (this.coma) return STANCE_NAME.coma;
    if (this.flying) {
      const v = this.speed3 || 0;
      return `${STANCE_NAME.fly} ${v < 10 ? v.toFixed(1) : Math.round(v)} m/s · 马赫 ${(v / soundSpeed(this.airT ?? 10)).toFixed(2)}`;
    }
    if (this.ko > 0) return STANCE_NAME.ko;
    if (this.warming) return STANCE_NAME.warm;
    if (this.sliding) return STANCE_NAME.slide;
    if (this.sitting) return STANCE_NAME.sit;
    const v = this.speedNow || 0;
    const fast = this.god && v > 12 ? ` ${Math.round(v)} m/s · 马赫 ${(v / soundSpeed(this.airT ?? 10)).toFixed(2)}` : '';
    if (this.sprinting) return STANCE_NAME.run + fast;
    return STANCE_NAME[this.stance] + fast;
  }

  // ---------------- 模型 ----------------
  buildModel() {
    // 人形在 human.js 里拼（主角和路人共用），这里只接上各个关节和可开关的部件
    const M = this.mats = humanMats(0x8a8f96);
    const H = buildHuman(M);
    this.model = H.root;
    this.scene.add(H.root);
    Object.assign(this, { pelvis: H.pelvis, spine: H.spine, neck: H.neck, head: H.head, hatG: H.hatG, lampG: H.lampG, arm: H.arm, leg: H.leg,
      packG: H.packG, packBody: H.packBody, packLid: H.packLid, packPocket: H.packPocket, bottle: H.bottle, padRoll: H.padRoll, lids: H.lids });

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
    // 背包按容量缩放：20 升的小包到 65 升的大包
    const sy = 0.68 + c / 50 * 0.5, sx = 1.0 + c / 160, sz = 0.52 + c / 170;
    this.packBody.scale.set(sx, sy, sz);
    const bz = -0.005 - 0.15 * sz;                      // 主袋中心：前面贴着后背
    this.packBody.position.set(0, (sy - 1) * 0.1, bz);
    this.packLid.scale.set(sx, 1, Math.max(0.8, sz));
    this.packLid.position.set(0, this.packBody.position.y + 0.3 * sy + 0.01, bz - 0.01);
    this.packPocket.position.set(0, this.packBody.position.y - 0.04, bz - 0.15 * sz - 0.01);
    this.bottle.visible = (inv.items.bottle || 0) > 0;
    this.bottle.position.set(0.15 * sx + 0.012, this.packBody.position.y - 0.14 * sy, bz - 0.01);
    this.padRoll.visible = !!(inv.items.pad || inv.items.tent3 || inv.items.tent4);
    this.padRoll.position.set(0, this.packBody.position.y - 0.3 * sy - 0.07, bz - 0.02);
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

  pitchRange() { return this.flying ? PITCH_FLY : PITCH_WALK; }

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
    const [plo, phi] = this.pitchRange();   // 落地后视角慢慢回到步行时的范围
    if (this.camPitch > phi || this.camPitch < plo) this.camPitch = lerp(this.camPitch, clamp(this.camPitch, plo, phi), 1 - Math.exp(-6 * dt));
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
    // 无敌模式：快跑按档位（默认 10 m/s，最快 2 马赫），行走是快跑的 1/3；不受负重、地形、坡度拖慢
    this.god = !!mods.god;
    if (this.runGear === undefined) this.runGear = RUN_GEAR0;
    const godRun = mods.god ? gearSpeed(RUN_GEARS[this.runGear], mods.airT ?? 10) : GOD_RUN;
    const base = this.sprinting ? (mods.god ? godRun : SPEED.run) : this.stance === 'crouch' ? SPEED.crouch : this.stance === 'prone' ? SPEED.prone : mods.god ? Math.max(SPEED.walk, godRun / 3) : SPEED.walk;
    let speed = base * (mods.god ? 1 : mods.speedMult) * (back ? 0.6 : strafe && !fwdIn ? 0.85 : 1);
    if (analog && !this.sprinting) speed *= lerp(0.4, 1, aMag);   // 摇杆推得越远走得越快
    if (this.polesOut && !this.sprinting && this.stance === 'stand') speed *= 1.04;
    this.airT = mods.airT ?? 10;
    if (this.flyGear === undefined) this.flyGear = FLY_GEAR0;
    const flyV = gearSpeed(FLY_GEARS[this.flyGear], this.airT);
    if (this.flying) speed = flyV * (analog ? lerp(0.4, 1, aMag) : 1);   // 踏空：前后左右按当前档位

    const gNow = groundAt(p.x, p.z);
    const n = this.terrainNormal(p.x, p.z);
    this.slopeNY = n.y; this.groundN = n;
    let uphill = 0;
    if (wantMove) {
      const ah = groundAt(p.x + wish.x * 1.2, p.z + wish.z * 1.2).y;
      uphill = (ah - gNow.y) / 1.2;
      if (!mods.god) {
        speed *= clamp(1 - Math.max(uphill, 0) * (this.polesOut ? 0.45 : 0.55), 0.4, 1) * (uphill < -0.15 ? 1.04 : 1);
        if (mods.stone && !this.sprinting) speed *= this.polesOut ? 0.8 : 0.7;
      }
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
    } else if (!this.flying) {
      const target = wish.clone().multiplyScalar(locked ? 0 : speed);
      const acc = this.onGround ? (this.stance === 'prone' ? 6 : 11) : mods.god ? 6 : 1.5;   // 无敌模式在空中也能自如转向
      this.vel.x = lerp(this.vel.x, target.x, 1 - Math.exp(-acc * dt));
      this.vel.z = lerp(this.vel.z, target.z, 1 - Math.exp(-acc * dt));
    }
    // 外力（阵风、撞击）
    this.vel.x += this.push.x * dt * 6; this.vel.z += this.push.z * dt * 6;
    this.push.multiplyScalar(Math.exp(-dt * 1.6));

    // 跳跃 / 起身
    if (input.jump && !locked) {
      if (this.stance !== 'stand') { this.setStance('stand'); }
      else if (this.onGround && !this.sliding && mods.canJump) { this.vel.y = mods.god ? GOD_JUMP_V : 6.0; this.onGround = false; this.airborneFrom = p.y; this.events.push({ type: 'jump' }); }
    }
    // 无敌模式：长按空格起飞（短按仍是普通的 2 米跳）；起飞后一直踏空，直到按住下降落回地面
    if (this.flying && !mods.god) { this.flying = false; this.safeFall = true; }   // 半空中关掉无敌：掉下去不摔伤
    this.jumpHoldT = input.jumpHold && !locked ? (this.jumpHoldT || 0) + dt : 0;
    if (!this.flying && mods.god && this.jumpHoldT > FLY_HOLD && this.stance === 'stand' && !this.sliding) {
      this.flying = true; this.onGround = false; this.airborneFrom = p.y; this.events.push({ type: 'takeoff' });
    }
    if (this.flying) {
      this.sliding = false; this.slideSpeed = 0; this.sitting = false;
      // 前进 / 后退沿视线方向：抬头往上飞、低头往下飞；左右水平平移；空格上升、C 下降（竖直）；都不按就悬停
      const cp = Math.cos(this.camPitch);
      const want = new THREE.Vector3(fwd.x * cp, Math.sin(this.camPitch), fwd.z * cp);
      const fIn = locked ? 0 : analog ? input.ay : (input.f ? 1 : 0) - (input.b ? 1 : 0);
      const rIn = locked ? 0 : analog ? input.ax : (input.r ? 1 : 0) - (input.l ? 1 : 0);
      want.multiplyScalar(fIn).addScaledVector(right, rIn);
      if (!locked) want.y += (input.jumpHold ? 1 : 0) - (input.crouch ? 1 : 0);
      if (want.lengthSq() > 1e-6) want.normalize().multiplyScalar(speed);
      const kh = 1 - Math.exp(-4 * dt), kv = 1 - Math.exp(-6 * dt);
      this.vel.x = lerp(this.vel.x, want.x, kh); this.vel.z = lerp(this.vel.z, want.z, kh);
      this.vel.y = lerp(this.vel.y, want.y, kv);
    }

    // ------- 水平移动 + 台阶 -------
    const maxStep = this.onGround ? (this.stance === 'prone' ? 0.6 : 0.95) : 1.6;
    let footY = this.onGround ? gNow.y : p.y;
    const tryMove = (dx, dz) => {
      const nx = p.x + dx, nz = p.z + dz;
      const g2 = groundAt(nx, nz);
      if (g2.y - footY > maxStep && g2.onRock) return false;
      p.x = nx; p.z = nz;
      if (this.onGround) footY = g2.y;
      return true;
    };
    // 高速时一帧走好几米：拆成每段不超过 0.35 米（正常快跑一帧走的距离）逐段判断岩石台阶，
    // 这样高速和低速爬同一块岩石的结果一样（低速时就是一段，和原来一样）
    const dx = this.vel.x * dt, dz = this.vel.z * dt;
    const nSub = Math.min(96, Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.35)));
    for (let i = 0; i < nSub; i++) {
      const sx = dx / nSub, sz = dz / nSub;
      if (!tryMove(sx, sz)) {
        const okX = tryMove(sx, 0), okZ = tryMove(0, sz);
        if (!okX) this.vel.x = 0; if (!okZ) this.vel.z = 0;
        if (!okX && !okZ) break;
      }
    }
    const tc = this.onGround || p.y - gNow.y < 4 ? treeCollide(p.x, p.z, 0.35) : null;   // 飞在树梢以上不会撞树
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
    if (this.flying) {
      p.y += this.vel.y * dt;
      if (p.y > FLY_CEIL_Y) {
        p.y = FLY_CEIL_Y; if (this.vel.y > 0) this.vel.y = 0;
        if (!this.atCeil) { this.atCeil = true; this.events.push({ type: 'ceiling' }); }
      } else if (p.y < FLY_CEIL_Y - 30) this.atCeil = false;
      if (p.y <= g.y) {
        p.y = g.y;
        if (input.crouch) {   // 主动降到地面：落地，退出飞行
          this.flying = false; this.onGround = true; this.vel.y = 0;
          this.events.push({ type: 'land', speed: 0, height: 0 });
        } else if (this.vel.y < 0) this.vel.y = 0;   // 贴着地面掠过，仍然踏空
      }
    } else if (!this.onGround) {
      this.vel.y -= GRAVITY * dt;
      p.y += (this.vel.y + 0.5 * GRAVITY * dt) * dt;   // 匀加速的精确积分，跳跃高度不随帧率变化
      if (p.y <= g.y) {
        const impact = -this.vel.y;
        p.y = g.y; this.onGround = true;
        this.events.push({ type: 'land', speed: impact, height: this.airborneFrom - g.y });
        if (impact > 12.5 && !this.safeFall) this.events.push({ type: 'impact', speed: impact, from: 'fall' });
        this.safeFall = false;
        this.vel.y = 0;
      }
    }

    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    this.speedNow = hspeed;
    // 飞行速度（含竖直）与音障
    const v3 = this.flying ? Math.hypot(hspeed, this.vel.y) : hspeed;
    const c = soundSpeed(this.airT);
    if (v3 >= c && (this.speed3 || 0) < c) this.events.push({ type: 'boom' });   // 飞行或无敌模式快跑突破音障
    this.speed3 = v3;
    this.moving = hspeed > 0.35;
    if (this.moving && this.onGround && !this.sliding && this.stance === 'prone') {
      this.stepAcc += hspeed * dt;
      const stride = Math.max(this.sprinting ? 1.2 : this.stance === 'crouch' ? 0.55 : this.stance === 'prone' ? 0.5 : 0.8, (hspeed - 6) / 4);   // 无敌模式高速时步频封顶，脚步声不连成一片
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
    // 站姿的步态跟着实际速度变：慢的时候是走（两脚交替着地），快起来变成小跑（有腾空），冲刺时步频更高。
    // 这样脚在地上“蹬过”的距离和身体前进的距离对得上，不滑步。
    const onFeet = this.onGround && !this.sliding && !this.sitting && this.ko <= 0 && !this.flying;
    const upright = this.stance === 'stand' && onFeet, crouching = this.stance === 'crouch' && onFeet;
    let G = null;
    if (upright || crouching) {
      const gr = crouching ? 0 : smoothstep(1.8, 3.3, hs), sp = crouching ? 0 : smoothstep(4.6, 6.6, hs);
      const f = Math.min(4.3, lerp(1.55 + 0.42 * hs, 2.75 + 0.07 * hs, gr) + sp * 0.75);      // 每秒几步
      const d = lerp(0.62, 0.36, gr) - sp * 0.05;                                            // 一条腿一个周期里着地的比例
      const S = Math.min(hs * d * 2 / f, crouching ? 0.92 : lerp(0.84, 1.0, gr) + sp * 0.06);  // 着地期间脚相对身体往后走多远
      G = { gr, sp, f, d, S, low: crouching ? 1 : 0 };
      if (this.moving) this.phase += dt * Math.PI * f * (back ? -1 : 1);
    } else this.phase += dt * rate * Math.max(k, this.moving ? 0.5 : 0) * (back ? -1 : 1);
    const gaitOn = (upright || crouching) && this.moving && !this.warming;
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
      pelvisY = 0.6 - Math.abs(s) * 0.015 * mv; pelvisYaw = c * 0.06 * mv;
      set('spine', 0.5 + lean); set('neck', -0.45);
      const hipBase = -1.05, knBase = 1.55;
      set('hipL', hipBase - s * A); set('hipR', hipBase + s * A);
      set('knL', knBase + Math.max(0, c) * 0.35 * mv); set('knR', knBase + Math.max(0, -c) * 0.35 * mv);
      set('anL', -0.5 + s * A * 0.4); set('anR', -0.5 - s * A * 0.4);
      if (poles) { set('shL', -0.55 + s * 0.2 * mv, 0, -0.15); set('shR', -0.55 - s * 0.2 * mv, 0, 0.15); set('elL', -0.7); set('elR', -0.7); }
      else { set('shL', -0.35 + s * 0.2 * mv, 0, -0.25); set('shR', -0.35 - s * 0.2 * mv, 0, 0.25); set('elL', -0.9); set('elR', -0.9); }
    } else if (this.moving && G) {
      // 走 / 小跑 / 冲刺：腿由后面的反向运动学按落脚点来解，这里只管骨盆、上身和手臂
      const { gr, sp, d } = G;
      const c2 = Math.cos(2 * (this.phase - Math.PI * d));
      // 重心起伏：走的时候单脚撑地时最高，跑的时候撑地时最低、腾空时最高
      pelvisY = lerp(0.945, 0.9, gr) - sp * 0.02 + lerp(0.02, -0.03, gr) * c2 - mods.load * 0.012;
      pelvisYaw = c * lerp(0.07, 0.12, gr);                 // 迈哪条腿，哪边的胯往前送
      pelvisZ = -s * lerp(0.03, 0.02, gr);                  // 摆动腿一侧的胯略低
      const fl = lerp(0.06, 0.15, gr) + sp * 0.1 + lean + mods.load * 0.1;
      set('spine', fl, -pelvisYaw * 1.7, -pelvisZ * 0.9);   // 肩和胯反着拧
      set('neck', -fl * 0.55 - lean * 0.2);
      // 腿的大致姿态（只在反向运动学淡入淡出时用得上）
      const A = lerp(0.4, 0.7, gr), K = lerp(0.6, 1.2, gr);
      set('hipL', -c * A - gr * 0.12); set('hipR', c * A - gr * 0.12);
      set('knL', 0.1 + Math.max(0, -s) * K); set('knR', 0.1 + Math.max(0, s) * K);
      set('anL'); set('anR');
      if (poles && !run) {
        // 撑杖行走：手臂前伸，杖尖和对侧的脚一起落地
        set('shL', -0.42 + c * 0.3, 0, -0.12); set('shR', -0.42 - c * 0.3, 0, 0.12);
        set('elL', -0.75 - Math.max(0, -c) * 0.25); set('elR', -0.75 - Math.max(0, c) * 0.25);
      } else {
        // 摆臂：和对侧的腿同步；跑起来肘弯得更多、摆幅更大
        const Aa = lerp(0.4, 0.8, gr) + sp * 0.2, eb = lerp(-0.35, -1.4, gr);
        set('shL', c * Aa + gr * 0.1, 0, -0.08 - gr * 0.06); set('shR', -c * Aa + gr * 0.1, 0, 0.08 + gr * 0.06);
        set('elL', eb - Math.max(0, -c) * 0.3); set('elR', eb - Math.max(0, c) * 0.3);
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
    this.pelvisBaseY += (pelvisY - this.pelvisBaseY) * r;
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
    }

    // ---------- 脚贴地：腿的反向运动学 ----------
    // 站、走、跑、蹲这些直立的姿势：先定下每只脚该落在哪（走跑时按步态算，其他时候取当前姿势的脚位），
    // 再查那只脚正下方的地面有多高（含石头），把脚踝放到地面上，反过来解出髋和膝该弯多少；
    // 够不着就把骨盆往下带一点。脚掌顺着坡度放平。坐、趴、滑坠、腾空、倒地不走这一套。
    const ikWant = (upright || (this.stance === 'crouch' && this.onGround && !this.sliding && !this.sitting && this.ko <= 0 && !this.flying)) && !this.warming && this.rise <= 0;
    this.ikW += ((ikWant ? 1 : 0) - this.ikW) * (1 - Math.exp(-dt * (ikWant ? 9 : 16)));
    let drop = 0;
    const FT = {};
    if (this.ikW > 0.002) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      _q1.setFromEuler(this.pelvis.rotation); _q2.copy(_q1).invert();
      for (const side of ['L', 'R']) {
        const sd = side === 'L' ? -1 : 1, ft = this.footT[side];
        let tx, ty, tz, pitch;
        if (gaitOn && G) {
          const u0 = this.phase / (Math.PI * 2) + (side === 'R' ? 0.5 : 0), u = u0 - Math.floor(u0);
          const { gr, d, S, low } = G, heel = -0.3 * (1 - gr * 0.6) * (1 - low * 0.6);
          let z, lift;
          if (u < d) {
            // 着地：脚跟先落（脚尖翘起），随身体前移向后蹬，最后脚跟抬起、脚尖蹬地
            const t = u / d, ho = smoothstep(0.6, 1.0, t);
            z = S * (0.5 - t) + 0.05 * ho; lift = 0.075 * ho;
            pitch = heel * (1 - smoothstep(0.0, 0.2, t)) + 0.6 * ho;
          } else {
            // 摆动：抬脚、前摆、落地前脚尖翘起
            const t = (u - d) / (1 - d), e = t * t * (3 - 2 * t);
            const H = lerp(0.1, 0.24, gr) + G.sp * 0.1 - low * 0.03;
            z = S * (-0.5 + e) + 0.05 * (1 - e);
            lift = H * Math.pow(Math.sin(Math.PI * Math.pow(t, lerp(0.85, 0.62, gr))), 0.9) + 0.075 * (1 - t) * (1 - t);
            pitch = lerp(0.6, heel, smoothstep(0.15, 0.9, t));
          }
          tx = sd * (0.088 - 0.025 * gr); ty = ANK_H + lift; tz = z - 0.03 * gr;
          // 脚落地的一刻：脚步声、扬尘、脚印都从这里发
          const up = this._u[side];
          if (Math.abs(u - up) > 0.5) this.stepSide = side;
          this._u[side] = u;
        } else {
          // 取当前姿势（目标姿态）下脚踝的位置
          const hp = g('hip' + side), kn = g('kn' + side), an = g('an' + side);
          _q3.setFromEuler(_e1.set(hp[0], hp[1], hp[2], 'ZXY'));
          _v3.set(0, -L1, 0).applyQuaternion(_q3);
          _v4.set(0, -L2 * Math.cos(kn[0]), -L2 * Math.sin(kn[0])).applyQuaternion(_q3);
          _v3.add(_v4); _v3.x += sd * HIP_X; _v3.y += HIP_Y;
          _v3.applyEuler(_e1.set(pelvisX, pelvisYaw, pelvisZ, 'XYZ'));
          tx = _v3.x; ty = Math.max(_v3.y + pelvisY, ANK_H); tz = _v3.z;
          pitch = hp[0] + kn[0] + an[0] + pelvisX;
          this._u[side] = side === 'R' ? 0.5 : 0;
        }
        const rf = 1 - Math.exp(-dt * (gaitOn ? 30 : 12));
        ft.x += (tx - ft.x) * rf; ft.y += (ty - ft.y) * rf; ft.z += (tz - ft.z) * rf;
        this.footP[side] += (pitch - this.footP[side]) * rf;
        // 这只脚正下方的地面（相对身体中心的地面）
        const wx = this.pos.x + ft.x * cy + ft.z * sy, wz = this.pos.z - ft.x * sy + ft.z * cy;
        const gnd = groundAt(wx, wz), gy = clamp(gnd.y - this.pos.y, -0.45, 0.45);
        this.footG[side] += (gy - this.footG[side]) * (1 - Math.exp(-dt * (gnd.onRock || Math.abs(gy - this.footG[side]) > 0.12 ? 26 : 120)));
        const T = FT[side] = { x: ft.x, y: ft.y + this.footG[side], z: ft.z, wx, wz };
        // 腿够不够长：不够就要把骨盆带低
        _v1.set(sd * HIP_X, HIP_Y, 0).applyQuaternion(_q1);
        const hx = T.x - _v1.x, hz = T.z - _v1.z;
        const maxHipY = T.y + Math.sqrt(Math.max(0.03, REACH * REACH - hx * hx - hz * hz));
        drop = Math.max(drop, this.pelvisBaseY + _v1.y - maxHipY);
      }
      drop = clamp(drop, 0, 0.4) * this.ikW;
    }
    this.pelvisDrop += (drop - this.pelvisDrop) * (1 - Math.exp(-dt * 20));
    this.pelvis.position.y = this.pelvisBaseY - this.pelvisDrop;
    if (this.ikW > 0.002) {
      const w = this.ikW, py = this.pelvis.position.y;
      // 脚下的坡度（沿面朝方向）：上坡脚尖抬、下坡脚尖压
      const n = this.groundN, fwdN = n ? n.x * Math.sin(this.yaw) + n.z * Math.cos(this.yaw) : 0;
      const slope = n ? clamp(Math.atan2(-fwdN, n.y), -0.6, 0.6) : 0;
      for (const side of ['L', 'R']) {
        const sd = side === 'L' ? -1 : 1, L = this.leg[side], T = FT[side];
        _v2.set(T.x, T.y - py, T.z).applyQuaternion(_q2);
        const dx = _v2.x - sd * HIP_X, dy = _v2.y - HIP_Y, dz = _v2.z;
        const ab = Math.atan2(dx, -dy), dyp = -Math.hypot(dx, dy);
        const Ld = clamp(Math.hypot(dyp, dz), 0.3, L1 + L2 - 0.004);
        const a = Math.atan2(-dz, -dyp);
        const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - Ld * Ld) / (2 * L1 * L2), -1, 1));
        const alpha = Math.acos(clamp((L1 * L1 + Ld * Ld - L2 * L2) / (2 * L1 * Ld), -1, 1));
        const hipX = a - alpha;
        const hr = L.hip.rotation, kr = L.kn.rotation, ar = L.an.rotation;
        hr.x += (hipX - hr.x) * w; hr.y *= 1 - w; hr.z += (ab - hr.z) * w;
        kr.x += (knee - kr.x) * w; kr.y *= 1 - w; kr.z *= 1 - w;
        // 脚掌：抵消掉腿和骨盆的转动，再加上步态的俯仰和坡度
        const stance = T.y - this.footG[side] < ANK_H + 0.03 ? 1 : 0.4;
        const anX = this.footP[side] - slope * stance - (this.pelvis.rotation.x + hipX + knee);
        ar.x += (anX - ar.x) * w; ar.y *= 1 - w; ar.z += (-ab - this.pelvis.rotation.z - ar.z) * w;
      }
    }
    // 走 / 跑时脚落地：发一次脚步事件（带落脚点，脚印和扬尘用）
    if (this.stepSide) {
      const T = FT[this.stepSide];
      if (T && gaitOn) this.events.push({ type: 'step', rock: groundAt(T.wx, T.wz).onRock, speed: hs, stance: this.stance, pole: this.polesOut, x: T.wx, y: this.pos.y + this.footG[this.stepSide], z: T.wz, side: this.stepSide, yaw: this.yaw });
      this.stepSide = null;
    }
    for (const side of ['L', 'R']) {
      const A = this.arm[side];
      // 杖身尽量保持朝下、略向前
      if (A.pole.visible) {
        const world = A.sh.rotation.x + A.el.rotation.x + this.spine.rotation.x + this.pelvis.rotation.x;
        A.pole.rotation.x = -world + (this.moving ? 0.28 : 0.12);
        A.pole.rotation.z = (side === 'L' ? 1 : -1) * 0.06;
      }
    }
    // ---------- 随动 ----------
    // 背包：比身体的起伏慢半拍，走起来一颠一颠
    const pyNow = this.pelvis.position.y;
    this.packLag += (pyNow - this.packLag) * (1 - Math.exp(-dt * 13));
    const lag = clamp(this.packLag - pyNow, -0.04, 0.04);
    this.packG.position.y = 0.18 + lag * 0.7; this.packG.rotation.x = lag * 1.6;
    this.hatG.rotation.x = lag * 0.8;
    // 眨眼：隔几秒闭一下
    if (this.lids) {
      this.blinkT -= dt;
      if (this.blinkT < -0.13) this.blinkT = 2 + Math.random() * 3.5;
      const closed = this.blinkT < 0 ? Math.sin(Math.min(1, -this.blinkT / 0.13) * Math.PI) : (this.sitting && this.tired > 0.5 ? 0.6 : 0);
      for (const lid of this.lids) lid.rotation.x = 0.22 + closed * 1.0;
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
