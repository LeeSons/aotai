// ===================== 危险：羚牛 / 蛇 / 落石 / 阵风 / 雷击 / 失衡 / 湿滑结霜 / 蜱虫 / 幻觉 / 雾中怪事 =====================
import * as THREE from 'three';
import { heightAt, normalAt, terrainInfo, cliffSideAt } from './terrain.js';
import { surfMat, plainMat } from './materials.js';
import { rockGeo } from './geo.js';
import { ROUTE, routeZ, routeDZ, yToAlt, season } from './data.js';
import { clamp, lerp, smoothstep } from './noise.js';

// ---------------- 羚牛模型（金毛羚牛）----------------
function deform(geo, fn) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals(); return geo;
}
function vcolor(geo, fn) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), v = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, col); c.set([col.r, col.g, col.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}
function takinModel() {
  const g = new THREE.Group();
  // 毛：用草茎那张贴图当一绺绺的毛，贴图跟着身体走
  const fur = surfMat(null, { kind: 'ground', mapping: 'local', scale: 0.55, bump: 1.6, tex: 0.75, vertexColors: true, roughness: 1, snow: 0.35 });
  const dark = surfMat(null, { kind: 'ground', mapping: 'local', scale: 0.4, bump: 1.2, tex: 0.6, color: 0x3a2a1e, roughness: 1, snow: 0.3 });
  const horn = surfMat(null, { kind: 'bark', mapping: 'local', scale: 0.25, bump: 0.8, tex: 0.5, color: 0x2a2520, roughness: 0.55, snow: 0 });
  const add = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const gold = new THREE.Color(0.8, 0.64, 0.32), belly = new THREE.Color(0.42, 0.31, 0.17), brown = new THREE.Color(0.3, 0.21, 0.13);
  // 躯干：前高后低，肩部隆起
  const body = deform(new THREE.SphereGeometry(1, 28, 18), (v) => {
    v.x *= 0.6; v.y *= 0.62; v.z *= 1.18;
    const front = smoothstep(-0.3, 0.7, v.z / 1.18);
    if (v.y > 0) v.y += 0.24 * front * (v.y / 0.62);
    v.y -= (1 - front) * 0.08;
    v.x *= 1 + front * 0.12;
    const n = Math.sin(v.x * 23 + v.z * 17) * Math.sin(v.y * 19 + v.z * 13) * 0.025;
    v.multiplyScalar(1 + n);
  });
  vcolor(body, (v, c) => { c.copy(belly).lerp(gold, smoothstep(-0.45, 0.25, v.y)); if (v.z > 0.6) c.lerp(gold, 0.3); c.multiplyScalar(0.92 + Math.sin(v.x * 40 + v.z * 30) * 0.06); });
  add(body, fur, g, 0, 1.38, 0);
  // 颈部与头
  const neck = deform(new THREE.CylinderGeometry(0.34, 0.42, 0.7, 16), (v) => { v.z *= 1.1; });
  vcolor(neck, (v, c) => c.copy(gold).lerp(brown, smoothstep(0.1, -0.35, v.y)));
  const nk = add(neck, fur, g, 0, 1.42, 1.05); nk.rotation.x = 1.0;
  const head = new THREE.Group(); head.position.set(0, 1.25, 1.42); g.add(head);
  const skull = deform(new THREE.SphereGeometry(0.34, 20, 14), (v) => {
    v.x *= 0.95; v.z *= 1.6;
    if (v.z > 0) { v.y += v.z * 0.12; v.x *= 1 - v.z * 0.5; } // 罗马鼻
    if (v.z > 0.25 && v.y > 0) v.y += 0.06;
  });
  vcolor(skull, (v, c) => c.copy(brown).lerp(new THREE.Color(0.18, 0.13, 0.09), smoothstep(0.1, 0.5, v.z)));
  const sk = add(skull, fur, head, 0, -0.05, 0.25); sk.rotation.x = 0.55;
  add(new THREE.SphereGeometry(0.09, 10, 8), dark, head, 0, -0.38, 0.62);
  for (const s of [-1, 1]) {
    // 弯角：先向两侧伸出，再向后上方卷起
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.18, 0.06, 0.02), new THREE.Vector3(s * 0.36, 0.02, -0.08), new THREE.Vector3(s * 0.44, 0.16, -0.24), new THREE.Vector3(s * 0.4, 0.3, -0.34)]);
    const tube = new THREE.TubeGeometry(curve, 16, 0.05, 8, false);
    deform(tube, (v) => { const t = clamp(Math.hypot(v.x, v.y, v.z) / 0.6, 0, 1); v.x *= 1; }); // 保持
    add(tube, horn, head, s * 0.12, 0.18, 0.1);
    add(new THREE.SphereGeometry(0.075, 10, 8), horn, head, s * 0.12, 0.18, 0.1);
    const ear = add(new THREE.ConeGeometry(0.06, 0.2, 6), dark, head, s * 0.3, 0.06, 0.02); ear.rotation.z = -s * 1.4;
    add(new THREE.SphereGeometry(0.03, 6, 6), plainMat({ color: 0x050505, roughness: 0.2 }), head, s * 0.2, 0.05, 0.38);
  }
  g.userData.head = head;
  // 腿：粗壮，带膝关节
  g.userData.legs = [];
  for (const [x, z] of [[-0.3, 0.72], [0.3, 0.72], [-0.28, -0.78], [0.28, -0.78]]) {
    const L = new THREE.Group(); L.position.set(x, 1.12, z); g.add(L);
    const up = vcolor(new THREE.CapsuleGeometry(0.14, 0.4, 4, 10), (v, c) => c.copy(gold).lerp(brown, smoothstep(0.2, -0.3, v.y)));
    add(up, fur, L, 0, -0.25, 0);
    const K = new THREE.Group(); K.position.y = -0.55; L.add(K);
    add(new THREE.CapsuleGeometry(0.085, 0.38, 4, 8), dark, K, 0, -0.22, 0);
    add(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 8), plainMat({ color: 0x111111 }), K, 0, -0.5, 0.02);
    g.userData.legs.push({ L, K });
  }
  const tail = add(new THREE.ConeGeometry(0.07, 0.3, 6), dark, g, 0, 1.45, -1.18); tail.rotation.x = -2.6;
  return g;
}

class Takin {
  constructor(scene, x, z, rng) {
    this.mesh = takinModel(); scene.add(this.mesh);
    const s = 0.9 + rng() * 0.25; this.mesh.scale.setScalar(s);
    this.x = x; this.z = z; this.heading = rng() * 6.28; this.state = 'graze'; this.t = 0; this.rng = rng; this.phase = 0;
    this.speed = 0; this.cool = 0; this.home = { x, z }; this.dist = 999;
  }
  update(dt, game) {
    const P = game.player.pos, pl = game.player;
    const dx = P.x - this.x, dz = P.z - this.z, dist = Math.hypot(dx, dz);
    const toP = Math.atan2(dx, dz);
    this.t -= dt; this.cool -= dt;
    const H = game.diff.hazard;
    const stealth = pl.stance === 'prone' ? 0.45 : pl.stance === 'crouch' ? 0.65 : 1;
    let targetSpeed = 0;
    switch (this.state) {
      case 'graze': {
        if (this.t <= 0) { this.t = 3 + this.rng() * 5; this.heading += (this.rng() - 0.5) * 2; this.walk = this.rng() < 0.5; }
        const hd = Math.hypot(this.x - this.home.x, this.z - this.home.z);
        if (hd > 18) this.heading = Math.atan2(this.home.x - this.x, this.home.z - this.z);
        targetSpeed = this.walk ? 0.8 : 0;
        if (dist < 34 * stealth && this.cool <= 0 && (pl.sprinting || dist < 17 * stealth)) {
          this.state = 'alert'; this.t = 1.8 + this.rng() * 1.5;
          game.audio.snort();
          game.msg('一头羚牛猛地抬起头，喷着粗气死死盯着你……蹲下慢慢后退，绕开它，千万别跑！', 'danger');
          game.dangerCount++;
        }
        break;
      }
      case 'alert': {
        this.heading = lerpAngle(this.heading, toP, dt * 4);
        targetSpeed = 0;
        if (dist > 38) { this.state = 'graze'; this.cool = 6; break; }
        const provoke = dist < 11 * stealth || (pl.sprinting && dist < 28);
        if (provoke || (this.t <= 0 && dist < 20 * stealth && this.rng() < 0.55 * H)) {
          this.state = 'charge'; this.t = 2.8; this.chargeDir = toP; this.heading = lerpAngle(this.heading, toP, 0.85); game.audio.snort();
          game.msg('羚牛低头冲过来了！！向侧面闪避，或者按 Q 使用防兽喷雾！', 'crit');
        } else if (this.t <= 0) { this.t = 1.2; this.stamp = true; game.audio.burst({ f: 160, type: 'lowpass', dur: 0.3, vol: 0.4 }); }
        break;
      }
      case 'charge': {
        this.heading = lerpAngle(this.heading, this.chargeDir, dt * 5);
        this.chargeDir = lerpAngle(this.chargeDir, toP, dt * 0.45);
        targetSpeed = 14;
        if (dist < 2.2 && !this.hit && game.god) {
          this.hit = true; game.audio.impact(0.5);
          game.msg('羚牛一头撞在你身上，像撞上了一块石头——你纹丝未动。（无敌模式）', 'info');
        } else if (dist < 2.2 && !this.hit) {
          this.hit = true;
          const dmg = 34 + this.rng() * 32;
          game.surv.damage(dmg, '被羚牛顶撞');
          const dir = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
          pl.push.addScaledVector(dir, 10); pl.vel.y = 5.5; pl.onGround = false; pl.airborneFrom = pl.pos.y;
          pl.knockDown(2.2);
          if (this.rng() < 0.55) game.surv.addStatus('bleed', { t: 160 });
          if (this.rng() < 0.25) game.surv.addStatus('fracture', { splinted: false });
          game.hurt(1); game.audio.impact(1);
          game.msg('你被羚牛狠狠顶飞了出去！', 'crit');
        }
        if (this.t <= 0) { this.state = 'leave'; this.t = 5; this.heading = toP + Math.PI + (this.rng() - 0.5); this.hit = false; this.cool = 22; }
        break;
      }
      case 'flee': case 'leave': {
        targetSpeed = this.state === 'flee' ? 9 : 2.2;
        if (this.t <= 0) { this.state = 'graze'; this.home = { x: this.x, z: this.z }; this.cool = 18; }
        break;
      }
    }
    this.speed = lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * (this.state === 'charge' ? 3.2 : 2)));
    this.x += Math.sin(this.heading) * this.speed * dt; this.z += Math.cos(this.heading) * this.speed * dt;
    const y = heightAt(this.x, this.z);
    this.mesh.position.set(this.x, y, this.z);
    this.mesh.rotation.y = this.heading;
    // 顺应坡度
    const yf = heightAt(this.x + Math.sin(this.heading), this.z + Math.cos(this.heading));
    this.mesh.rotation.x = lerp(this.mesh.rotation.x, -Math.atan(yf - y) * 0.7, 0.1);
    this.phase += dt * (2 + this.speed * 1.3);
    const amp = Math.min(this.speed / 4, 1);
    const L = this.mesh.userData.legs;
    const gait = this.speed > 6 ? [0, 0.4, Math.PI, Math.PI + 0.4] : [0, Math.PI, Math.PI, 0];
    L.forEach((l, i) => { const s = Math.sin(this.phase + gait[i]); l.L.rotation.x = s * 0.55 * amp; l.K.rotation.x = Math.max(0, -Math.cos(this.phase + gait[i])) * 0.8 * amp; });
    const head = this.mesh.userData.head;
    const grazing = this.state === 'graze' && this.speed < 0.3;
    head.rotation.x = lerp(head.rotation.x, grazing ? 0.75 + Math.sin(this.phase * 0.3) * 0.08 : this.state === 'charge' ? 0.5 : this.state === 'alert' ? -0.1 : 0.1, 0.08);
    this.mesh.position.y += Math.abs(Math.sin(this.phase)) * 0.05 * amp;
    this.dist = dist;
  }
  spray() { this.state = 'flee'; this.t = 6; this.heading += Math.PI; this.cool = 40; }
}

function lerpAngle(a, b, t) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * clamp(t, 0, 1); }

// ---------------- 蛇 ----------------
class Snake {
  constructor(scene, x, z) {
    const mat = plainMat({ color: 0x4f4a2c, roughness: 0.5 });
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 30; i++) { const a = i / 30 * Math.PI * 3.2; const r = 0.26 - i * 0.006; pts.push(new THREE.Vector3(Math.cos(a) * r, 0.05 + i * 0.008, Math.sin(a) * r)); }
    pts.push(new THREE.Vector3(0.05, 0.32, 0.12));
    const body = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.045, 7, false), mat); body.castShadow = true; g.add(body);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat); h.position.set(0.06, 0.33, 0.15); h.scale.set(1, 0.7, 1.5); g.add(h);
    this.head = h;
    this.mesh = g; scene.add(g);
    this.x = x; this.z = z; this.hissed = false; this.done = false;
    g.position.set(x, heightAt(x, z), z);
  }
  update(dt, game) {
    if (this.done) { this.mesh.position.y -= dt * 0.3; return; }
    const P = game.player.pos;
    const d = Math.hypot(P.x - this.x, P.z - this.z);
    this.head.position.y = 0.33 + Math.sin(performance.now() * 0.01) * 0.02;
    if (d < 5 && !this.hissed) { this.hissed = true; this.mesh.lookAt(P.x, this.mesh.position.y, P.z); game.audio.hiss(); game.msg('脚边的草丛里传来“嘶嘶”声——有蛇！慢慢绕开！', 'danger'); game.dangerCount++; }
    if (d < 1.3) {
      this.done = true;
      const chance = game.inv.has('gaiter') ? 0.35 : 0.9;
      if (game.god) game.msg('蛇在你小腿上咬了一口，连个牙印都没留下。（无敌模式）', 'info');
      else if (Math.random() < chance) {
        game.surv.damage(14, '蛇毒'); game.surv.addStatus('poison', { t: 120 }); game.hurt(0.5);
        game.msg('你的小腿被蛇咬了一口！伤口火辣辣地疼——尽快用急救包处理！', 'crit');
      } else game.msg('蛇咬在了绑腿上，没有咬穿。好险！', 'info');
    }
  }
}

// ---------------- 落石 ----------------
let RockMat = null;
class RollingRock {
  constructor(scene, pos, vel, r) {
    const mat = RockMat || (RockMat = surfMat(null, { kind: 'rock', mapping: 'local', scale: 1.6, bump: 1.5, color: 0x8a8782, roughness: 1, snow: 0.3 }));
    const geo = rockGeo(900 + ((r * 97) | 0), 1, { cuts: 12, rough: 0.2 }); geo.scale(r, r, r);
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.p = pos.clone(); this.v = vel.clone(); this.r = r; this.life = 9; this.hit = false;
  }
  update(dt, game) {
    this.life -= dt;
    const n = normalAt(this.p.x, this.p.z, 1.0);
    this.v.x += n.x * 26 * dt; this.v.z += n.z * 26 * dt;
    this.v.y -= 22 * dt;
    this.p.addScaledVector(this.v, dt);
    const gy = heightAt(this.p.x, this.p.z) + this.r * 0.8;
    if (this.p.y < gy) { this.p.y = gy; if (this.v.y < 0) { if (this.v.y < -6) game.audio.burst({ f: 900, q: 2, dur: 0.12, vol: 0.25 }); this.v.y = -this.v.y * 0.35 + Math.random() * 3; } this.v.x *= 0.985; this.v.z *= 0.985; }
    this.mesh.position.copy(this.p);
    this.mesh.rotation.x += this.v.z * dt / this.r; this.mesh.rotation.z -= this.v.x * dt / this.r;
    const P = game.player.pos;
    const d = Math.hypot(P.x - this.p.x, P.y + 0.9 - this.p.y, P.z - this.p.z);
    const sp = this.v.length();
    if (!this.hit && d < this.r + 0.55 && sp > 3 && game.god) {
      this.hit = true; game.audio.impact(0.5);
      game.msg('一块落石砸在你身上弹开了，你毫发无伤。（无敌模式）', 'info');
    } else if (!this.hit && d < this.r + 0.55 && sp > 3) {
      this.hit = true;
      const dmg = clamp(sp * 2.4 * this.r, 14, 75);
      game.surv.damage(dmg, '被落石砸中');
      if (Math.random() < 0.5) game.surv.addStatus('bleed', { t: 130 });
      if (Math.random() < 0.2) game.surv.addStatus('fracture', { splinted: false });
      game.player.push.addScaledVector(this.v.clone().setY(0).normalize(), 4);
      if (sp > 8) game.player.knockDown(1.5);
      game.hurt(0.9); game.audio.impact(0.9);
      game.msg('一块落石狠狠砸在你身上！', 'crit');
    }
    return this.life > 0 && sp > 0.3;
  }
  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

// ---------------- 幻影 ----------------
function phantomFigure() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x15171a, transparent: true, opacity: 0.8 });
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.6, 4, 8), mat); b.position.y = 1.25; g.add(b);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mat); h.position.y = 1.8; g.add(h);
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.7, 4, 6), mat); l.position.set(s * 0.12, 0.45, 0); g.add(l); }
  const pk = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.22), mat); pk.position.set(0, 1.3, -0.2); g.add(pk);
  return g;
}
// 雾里一顶亮着灯的帐篷（幻觉）
function phantomTent() {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.3, 4), new THREE.MeshBasicMaterial({ color: 0xffa64a, transparent: true, opacity: 0.85 }));
  t.rotation.y = Math.PI / 4; t.scale.z = 1.5; t.position.y = 0.65; g.add(t);
  return g;
}

// ---------------- 管理器 ----------------
export class Hazards {
  constructor(scene, rng, diff) {
    this.scene = scene; this.rng = rng; this.diff = diff;
    this.takins = []; this.snakes = []; this.rocks = []; this.phantoms = [];
    this.gust = { state: 'idle', t: 8, dir: new THREE.Vector2(), mag: 0 };
    this.strike = { state: 'idle', t: 15 };
    this.qteCool = 6; this.rockfallT = 35; this.tickHint = 30; this.phantomT = 20; this.eerieT = 30; this.frostMsg = false;
    this.spawnFauna();
  }

  spawnFauna() {
    const rng = this.rng, S = season();
    const takinSegs = [2, 3, 5, 16, 18, 24, 25, 26, 28];
    for (const s of takinSegs) {
      if (rng() > (0.6 * this.diff.hazard + 0.05) * S.fauna) continue;
      const a = ROUTE[s], b = ROUTE[s + 1];
      const n = rng() < 0.3 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const x = lerp(a.x, b.x, 0.25 + rng() * 0.5);
        const z = routeZ(x) + (rng() > 0.5 ? 1 : -1) * (6 + rng() * 14);
        this.takins.push(new Takin(this.scene, x, z, rng));
      }
    }
    if (S.bugs <= 0) return;
    const snakeSegs = [0, 1, 26, 27, 28];
    for (const s of snakeSegs) {
      const n = Math.round((1 + (rng() < 0.6 * this.diff.hazard ? 1 : 0)) * S.bugs);
      for (let k = 0; k < n; k++) {
        const a = ROUTE[s], b = ROUTE[s + 1];
        const x = lerp(a.x, b.x, 0.1 + rng() * 0.8);
        const z = routeZ(x) + (rng() - 0.5) * 2.5;
        this.snakes.push(new Snake(this.scene, x, z));
      }
    }
  }

  dispose() {
    for (const t of this.takins) this.scene.remove(t.mesh);
    for (const s of this.snakes) this.scene.remove(s.mesh);
    for (const r of this.rocks) r.dispose(this.scene);
    for (const p of this.phantoms) this.scene.remove(p.mesh);
  }

  nearestTakin(range) {
    let best = null, bd = range;
    for (const t of this.takins) if (t.dist < bd && (t.state === 'alert' || t.state === 'charge')) { bd = t.dist; best = t; }
    return best;
  }

  update(dt, game) {
    const P = game.player.pos;
    const surv = game.surv, inv = game.inv, pl = game.player, H = this.diff.hazard;
    const ti = terrainInfo(P.x, P.z);
    const alt = yToAlt(P.y);
    const exposed = ['ridge', 'cliff', 'stone', 'pillars', 'meadow'].includes(ti.type) && !game.shelterNow && !game.sleeping;

    // 远处的羚牛和蛇不更新、也不画（一头羚牛二十多个零件，全线十来头）
    for (const t of this.takins) { const dx = Math.abs(t.x - P.x); if (dx < 250) t.update(dt, game); t.mesh.visible = dx < 700 && Math.abs(t.z - P.z) < 700; }
    for (const s of this.snakes) { const dx = Math.abs(s.x - P.x); if (dx < 60) s.update(dt, game); s.mesh.visible = dx < 160 && Math.abs(s.z - P.z) < 160; }
    this.rocks = this.rocks.filter(r => { const alive = r.update(dt, game); if (!alive) r.dispose(this.scene); return alive; });

    // ---- 阵风（姿态决定能否站稳）----
    const wl = game.windLocal;
    const G = this.gust;
    G.t -= dt;
    const stanceK = pl.stance === 'prone' ? 0 : pl.stance === 'crouch' ? 0.2 : pl.sprinting ? 1.3 : 1;
    const poleK = pl.polesOut ? 0.6 : 1;
    if (G.state === 'idle') {
      if (G.t <= 0) {
        G.t = 5 + this.rng() * 8;
        if (exposed && wl >= 4.5 && !pl.flying) {   // 阵风是贴着山脊的乱流；飞到空中就是稳定的高空风了
          G.state = 'warn'; G.t = 1.1 + this.rng() * 0.5;
          G.mag = (wl - 3.5) * 0.85 * (0.7 + this.rng() * 0.6) * (0.8 + H * 0.2);
          if (ti.type === 'cliff') { const side = cliffSideAt(P.x); const dz = routeDZ(P.x); G.dir.set(-dz, 1).normalize().multiplyScalar(side); }
          else G.dir.copy(game.weather.windDir).rotateAround(new THREE.Vector2(), (this.rng() - 0.5) * 0.8);
          game.audio.gustWarn();
          if (G.mag > 2.5) game.ui.alert(G.mag > 4 ? '狂风！按 Z 趴下 / C 蹲下！' : '强阵风！按 C 蹲下稳住', 1.4);
        }
      }
    } else if (G.state === 'warn') {
      if (G.t <= 0) {
        G.state = 'gust'; G.t = 1.5 + this.rng() * 1.3;
        // 站着硬抗可能被吹倒
        if (wl >= 6.5 && pl.stance === 'stand' && pl.ko <= 0 && !game.god) {
          const ch = 0.3 * H * clamp((wl - 6) / 4, 0, 1.2) * (pl.polesOut ? 0.4 : 1) * (surv.exhausted ? 1.6 : 1) * (pl.sprinting ? 1.5 : 1);
          if (this.rng() < ch) {
            pl.knockDown(1.6); pl.push.x += G.dir.x * G.mag * 1.5; pl.push.z += G.dir.y * G.mag * 1.5;
            surv.damage(4 + this.rng() * 9, '被狂风吹倒摔伤');
            if (this.rng() < 0.3) surv.addStatus('sprain', { t: 700, bandaged: false });
            game.hurt(0.6); game.audio.impact(0.7); game.dangerCount++;
            game.msg('一阵狂风把你整个人掀翻在地！' + (ti.type === 'cliff' ? '你离悬崖边只有几步！' : ''), 'crit');
          }
        }
      }
    } else if (G.state === 'gust') {
      const k = stanceK * poleK * (surv.exhausted ? 1.4 : 1);
      pl.push.x += G.dir.x * G.mag * k * dt * 3;
      pl.push.z += G.dir.y * G.mag * k * dt * 3;
      if (k > 0.5) pl.stagger = 0.6;
      game.camShake = Math.max(game.camShake, G.mag * 0.6 * Math.max(k, 0.2));
      if (G.t <= 0) { G.state = 'idle'; G.t = 4 + this.rng() * 9; }
    }

    // ---- 雷击 ----
    const S = this.strike;
    S.t -= dt;
    const thunder = game.weather.p.thunder;
    if (S.state === 'idle' && S.t <= 0) {
      S.t = 11 + this.rng() * 14;
      if (thunder && exposed && alt > 3100) {
        S.state = 'warn'; S.t = 3.6;
        game.audio.buzz();
        game.ui.alert('头发竖了起来，登山杖嗡嗡作响！立刻蹲下！', 3);
        game.msg('空气里弥漫着臭氧味，你的头发根根竖起——雷电即将落下！按 C 蹲下（双脚并拢、低头抱膝），别趴下——雷击的地面电流会流过全身。收起登山杖，尽快离开山脊高处！', 'crit');
        game.dangerCount++;
      }
    } else if (S.state === 'warn' && S.t <= 0) {
      S.state = 'idle'; S.t = 16 + this.rng() * 18;
      // 蹲着（双脚并拢）最安全：人最矮、和地面只有两脚一个接触点；趴着虽矮，但地面电流会从头到脚流过全身
      const base = game.shelterNow ? 0 : pl.stance === 'crouch' ? 0.07 : pl.stance === 'prone' ? 0.16 : 0.4;
      const chance = game.god ? 0 : base * H * (pl.polesOut ? 1.2 : 1);
      game.weather.flash = 2; game.weather.spawnBolt(new THREE.Vector3(P.x + (this.rng() - 0.5) * 30, 0, P.z + (this.rng() - 0.5) * 30), P.y);
      game.audio.thunder(30);
      if (this.rng() < chance) {
        game.weather.spawnBolt(P.clone(), P.y);
        surv.damage(60 + this.rng() * 40, '雷击'); surv.addStatus('bleed', { t: 90 });
        pl.knockDown(2.5);
        game.hurt(1); game.msg('一道闪电劈在你身边！你被巨大的冲击掀翻在地……', 'crit');
      } else game.msg('闪电在不远处炸开，震得耳朵嗡嗡作响。', 'danger');
    }

    // ---- 失衡 / 湿滑 / 结霜 QTE ----
    this.qteCool -= dt;
    const hour = game.hour();
    const frost = (hour > 3.5 && hour < 9.5) && alt > 3150 && game.airTemp < 1.5;
    if (frost && !this.frostMsg && pl.onRock) { this.frostMsg = true; game.msg(`${hour < season().sunrise - 0.3 ? '夜里' : '清晨'}的岩石表面结了一层薄薄的霜，脚下像抹了油。`, 'warn'); }
    if (!frost) this.frostMsg = false;
    if (!game.qte && !game.god && this.qteCool <= 0 && pl.moving && pl.onGround && pl.ko <= 0 && !pl.sliding) {
      const stanceQ = pl.stance === 'prone' ? 0.05 : pl.stance === 'crouch' ? 0.4 : 1;
      const poleQ = pl.polesOut ? 0.45 : 1;
      const bootQ = inv.has('boots') ? 0.55 : 1.35;
      const fatigue = (surv.energy < 30 ? 1.5 : 1) * (surv.status.sprain ? 1.4 : 1) * (surv.core < 34.5 ? 1.5 : 1);
      const vis = game.fogK > 0.5 || game.darkness > 0.6 ? 1.35 : 1;
      if ((ti.type === 'stone' || ti.type === 'pillars') && pl.onRock) {
        const p = 0.065 * (pl.sprinting ? 3 : 1) * bootQ * poleQ * stanceQ * vis * fatigue * H;
        if (this.rng() < p * dt) this.startLooseRock(game);
      }
      const wet = game.weather.wetGround > 0.35 || (game.wxLocal ? game.wxLocal.rain : 0) > 0.2;
      if ((wet || frost) && (pl.onRock || Math.abs(pl.uphill) > 0.2)) {
        const p = 0.035 * (pl.sprinting ? 3 : 1) * bootQ * poleQ * stanceQ * fatigue * (frost ? 1.4 : 1) * H;
        if (this.rng() < p * dt) this.startWetSlip(game, frost);
      }
      if ((game.snowLocal || 0) > 0.35 && !inv.has('cramp') && Math.abs(pl.uphill) > 0.14 && !pl.onRock) {
        if (this.rng() < 0.07 * H * dt * (pl.sprinting ? 2 : 1) * stanceQ * poleQ) this.startIceSlip(game);
      }
    }

    // ---- 落石 ----
    this.rockfallT -= dt;
    if (this.rockfallT <= 0) {
      this.rockfallT = (28 + this.rng() * 32) / H;
      if (['stone', 'pillars', 'cliff', 'gully', 'ridge'].includes(ti.type) && !game.sleeping) this.trySpawnRockfall(game);
    }

    // ---- 蜱虫 ----
    const bugs = season().bugs;
    if (bugs > 0 && pl.moving && alt < 3050 && ['forest', 'gully', 'meadow', 'dead'].includes(ti.type)) {
      const p = 0.004 * bugs * (inv.has('deet') ? 0.12 : 1) * (inv.has('gaiter') ? 0.5 : 1) * (ti.ad > 3 ? 2.2 : 1) * (pl.stance === 'prone' ? 4 : 1) * H;
      if (!surv.status.tick && !surv.status.fever && this.rng() < p * dt) surv.addStatus('tick', { t: 260 });
    }
    if (surv.status.tick) {
      this.tickHint -= dt;
      if (this.tickHint <= 0) { this.tickHint = 50 + this.rng() * 40; game.msg('你感觉小腿和后颈有点痒……也许该检查一下身体（背包 → 检查身体）。', 'warn'); }
    }

    // ---- 雾中怪事 ----
    this.eerieT -= dt;
    if (this.eerieT <= 0) {
      this.eerieT = 22 + this.rng() * 35;
      if ((game.fogK > 0.5 || game.darkness > 0.7) && alt > 2700 && !game.sleeping) this.eerie(game);
    }

    // ---- 幻觉 ----
    this.phantomT -= dt;
    if (this.phantomT <= 0) {
      this.phantomT = 12 + this.rng() * 18;
      if (surv.mental < 45 && (game.fogK > 0.4 || game.darkness > 0.6) && this.phantoms.length < 2) {
        const fig = this.rng() < 0.55;
        const fwd = new THREE.Vector3(Math.cos(pl.camYaw), 0, Math.sin(pl.camYaw));
        const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar((this.rng() > 0.5 ? 1 : -1) * (10 + this.rng() * 14));
        const pos = P.clone().addScaledVector(fwd, 18 + this.rng() * 10).add(side);
        const mesh = fig ? phantomFigure() : phantomTent();
        mesh.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
        this.scene.add(mesh);
        this.phantoms.push({ mesh, t: 14, fig });
        if (fig) game.audio.burst({ f: 300, q: 4, dur: 2.5, vol: 0.06, attack: 1 });
      }
    }
    this.phantoms = this.phantoms.filter(ph => {
      ph.t -= dt;
      const d = ph.mesh.position.distanceTo(P);
      if (ph.fig) ph.mesh.lookAt(P.x, ph.mesh.position.y, P.z);
      if (d < 7 || ph.t <= 0) {
        this.scene.remove(ph.mesh);
        if (d < 7) { surv.mental = Math.max(0, surv.mental - 5); game.msg(ph.fig ? '你追上去想喊住那个人影……可那里什么都没有。只有风。' : '你朝那顶亮着灯的帐篷走过去……它消失了。你根本不确定自己刚才看到了什么。', 'warn'); }
        return false;
      }
      return true;
    });
  }

  eerie(game) {
    const s = game.surv, a = game.audio;
    const r = Math.floor(this.rng() * 5);
    // 这类怪事在浓雾里和黑夜里都会发生：没有雾的夜里就不说“雾里”
    if (r === 0) { a.voice(); s.mental -= 4; game.msg(`${game.fogK > 0.5 ? '雾里' : '黑暗里'}好像有人在喊……“喂——”声音忽远忽近，分不清从哪个方向传来。`, 'warn'); }
    else if (r === 1) { a.footBehind(); s.mental -= 5; game.msg('身后传来踩在碎石上的脚步声，一步、两步……你猛地回头，什么也没有。', 'warn'); }
    else if (r === 2) { a.bell(); s.mental -= 3; game.msg('不知哪里传来一声悠长的钟声。附近根本没有寺庙。', 'warn'); }
    else if (r === 3) { a.rockRoll(); s.mental -= 2; game.msg('远处的石海里传来一阵石块滚落的声音，然后又归于死寂。', 'info'); }
    else { a.whistle(); s.mental -= 3; game.msg('风里夹着一声尖细的口哨声，像是有人在给你打信号。', 'warn'); }
  }

  startQTEBase(game, text, win, ok, fail) {
    const s = game.surv;
    const w = clamp(win - (s.energy < 30 ? 0.25 : 0) - (s.mental < 30 ? 0.2 : 0) - (s.core < 34 ? 0.25 : 0) - (game.player.sprinting ? 0.2 : 0), 0.5, 1.4);
    game.startQTE(text, w, ok, fail);
  }

  startLooseRock(game) {
    this.qteCool = 8;
    game.audio.burst({ f: 1200, q: 2, dur: 0.25, vol: 0.4 });
    this.startQTEBase(game, '脚下的石头松动了！按 [空格] 稳住', 1.05, () => {
      game.msg('你及时稳住了重心。脚下的石块翻滚着落进了石缝。', 'info');
    }, () => {
      const r = this.rng();
      const s = game.surv;
      game.dangerCount++;
      game.player.knockDown(1.1);
      if (r < 0.5) {
        if (s.status.sprain && this.rng() < 0.4) { s.addStatus('fracture', { splinted: false }); s.damage(18, '石海摔伤'); game.msg('已经受伤的脚再次踩空——你听到“咔”的一声。小腿骨折了！', 'crit'); }
        else { s.addStatus('sprain', { t: 750, bandaged: false }); s.damage(8, '石海摔伤'); game.msg('脚踝一歪，剧痛钻心——你崴脚了！', 'danger'); }
      } else if (r < 0.88) {
        s.damage(12 + this.rng() * 16, '石海摔伤');
        if (this.rng() < 0.5) { s.addStatus('bleed', { t: 110 }); game.msg('你重重摔在锋利的花岗岩上，膝盖和手掌血流不止！', 'crit'); }
        else game.msg('你失去平衡摔倒在乱石中，浑身剧痛。', 'danger');
      } else {
        s.addStatus('fracture', { splinted: false }); s.damage(22, '石海摔伤');
        game.msg('一条腿卡进石缝，身体却继续前倾——骨折了！', 'crit');
      }
      game.hurt(0.7); game.audio.impact(0.7);
      game.camShake = 6;
    });
  }

  startWetSlip(game, frost) {
    this.qteCool = 9;
    this.startQTEBase(game, frost ? '霜冻的岩石！按 [空格] 稳住' : '脚下打滑！按 [空格] 稳住', 0.95, () => game.msg('你一个趔趄，好歹稳住了。', 'info'), () => {
      const s = game.surv, pl = game.player;
      game.dangerCount++;
      pl.knockDown(1.2);
      s.damage(6 + this.rng() * 10, frost ? '冰霜滑倒摔伤' : '湿滑摔伤');
      if (this.rng() < 0.35) s.addStatus('sprain', { t: 700, bandaged: false });
      if (Math.abs(pl.uphill) > 0.3 && this.rng() < 0.5) { pl.sliding = true; pl.slideSpeed = 5; }
      game.hurt(0.5); game.audio.impact(0.6);
      game.msg(frost ? '你踩在结霜的石头上，整个人摔了出去！' : '湿滑的岩石让你重重摔了一跤！', 'danger');
    });
  }

  startIceSlip(game) {
    this.qteCool = 10;
    this.startQTEBase(game, '冰面打滑！按 [空格] 稳住', 0.9, () => game.msg('你在结冰的坡面上稳住了身体。冰爪会让这一切轻松很多。', 'info'), () => {
      game.player.sliding = true; game.player.slideSpeed = 7;
      game.surv.damage(6, '冰面滑坠');
      game.msg('你在冰雪上滑倒，顺着坡面向下滑去！按住 C 或 Z 尝试制动！', 'crit');
      game.dangerCount++;
    });
  }

  trySpawnRockfall(game) {
    const P = game.player.pos;
    let best = null, bh = P.y + 7;
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * Math.PI * 2, r = 20 + this.rng() * 16;
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      const h = heightAt(x, z);
      if (h > bh) { bh = h; best = new THREE.Vector3(x, h + 1.5, z); }
    }
    if (!best) return;
    const n = 1 + (this.rng() < 0.55 ? 1 : 0) + (this.rng() < 0.3 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const p = best.clone().add(new THREE.Vector3((this.rng() - 0.5) * 4, k * 1.2, (this.rng() - 0.5) * 4));
      const toward = P.clone().sub(p).setY(0).normalize().multiplyScalar(5 + this.rng() * 3);
      this.rocks.push(new RollingRock(this.scene, p, toward, 0.5 + this.rng() * 0.7));
    }
    game.audio.rockRoll();
    game.msg('上方传来“咔啦啦”的滚石声——落石！快躲开！', 'crit');
    game.ui.alert('落石！', 1.5);
    game.dangerCount++;
  }
}
