// ===================== 鸟语花香：鸟群 / 蝴蝶 / 高空盘旋的鹰 =====================
import * as THREE from 'three';
import { heightAt, terrainInfo } from './terrain.js';
import { season } from './data.js';

const birdMat = new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 0.8, side: THREE.DoubleSide });
const eagleMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8, side: THREE.DoubleSide });
const eagleHead = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.8 });

function wingGeo(span, chord) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, chord * 0.5, span, 0, chord * 0.1, span * 0.9, 0, -chord * 0.35, 0, 0, -chord * 0.4], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g;
}

function makeBird(scale = 1, mat = birdMat, eagle = false) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat); body.scale.set(0.8, 0.7, 2); g.add(body);
  if (eagle) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), eagleHead); h.position.z = 0.26; g.add(h); }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 4), mat); tail.rotation.x = Math.PI / 2; tail.position.z = -0.3; tail.scale.x = 2; g.add(tail);
  const wl = new THREE.Group(), wr = new THREE.Group();
  const span = eagle ? 1.1 : 0.45, chord = eagle ? 0.42 : 0.22;
  const ml = new THREE.Mesh(wingGeo(span, chord), mat); wl.add(ml);
  const mr = new THREE.Mesh(wingGeo(span, chord), mat); mr.scale.x = -1; wr.add(mr);
  g.add(wl); g.add(wr);
  g.userData = { wl, wr };
  g.scale.setScalar(scale);
  return g;
}

function makeButterfly(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.15 });
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(0.08, 0.12, 0.2, 0.1, 0.16, -0.02); shape.bezierCurveTo(0.18, -0.1, 0.06, -0.12, 0, 0);
  const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
  const wl = new THREE.Group(), wr = new THREE.Group();
  wl.add(new THREE.Mesh(geo, mat)); const r = new THREE.Mesh(geo, mat); r.scale.x = -1; wr.add(r);
  g.add(wl); g.add(wr);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4).rotateX(Math.PI / 2), birdMat));
  g.userData = { wl, wr };
  return g;
}

const BUTTERFLY_COLORS = [0xf2c94c, 0xffffff, 0xe76f51, 0x6fa8dc, 0xf4a6c6, 0xff9f1c];

export class Fauna {
  constructor(scene) {
    this.scene = scene;
    this.flocks = []; this.butterflies = []; this.eagles = [];
    this.flockT = 5; this.t = 0;
  }
  dispose() {
    for (const f of this.flocks) for (const b of f.birds) this.scene.remove(b);
    for (const b of this.butterflies) this.scene.remove(b.mesh);
    for (const e of this.eagles) this.scene.remove(e.mesh);
    this.flocks = []; this.butterflies = []; this.eagles = [];
  }
  update(dt, game) {
    this.t += dt;
    const P = game.player.pos, S = season();
    const W = game.weather.p;
    const good = (W.key === 'clear' || W.key === 'cloudy') && !game.night && game.fogK < 0.4;
    const ti = terrainInfo(P.x, P.z);
    const alt = game.altitude;
    const lush = ['forest', 'dead', 'meadow', 'gully'].includes(ti.type);
    // 鸟群
    this.flockT -= dt;
    if (this.flockT <= 0) {
      this.flockT = 18 + Math.random() * 30;
      if (good && S.fauna > 0.5 && alt < 3500 && this.flocks.length < 2) {
        const n = 5 + (Math.random() * 8 | 0);
        const a = Math.random() * Math.PI * 2;
        const start = new THREE.Vector3(P.x + Math.cos(a) * 90, 0, P.z + Math.sin(a) * 90);
        const vel = new THREE.Vector3(-Math.cos(a + (Math.random() - 0.5)), 0, -Math.sin(a + (Math.random() - 0.5))).multiplyScalar(9 + Math.random() * 5);
        const baseY = Math.max(heightAt(start.x, start.z), P.y) + 18 + Math.random() * 18;
        const birds = [];
        for (let i = 0; i < n; i++) { const b = makeBird(0.9 + Math.random() * 0.3); b.userData.off = new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 10); b.userData.ph = Math.random() * 6; this.scene.add(b); birds.push(b); }
        this.flocks.push({ c: start.setY(baseY), vel, birds, life: 22 });
        if (Math.random() < 0.5) game.audio.birdSong(1);
      }
    }
    this.flocks = this.flocks.filter(f => {
      f.life -= dt; f.c.addScaledVector(f.vel, dt);
      f.vel.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(this.t * 0.4) * dt * 0.3);
      const dir = Math.atan2(f.vel.x, f.vel.z);
      for (const b of f.birds) {
        const u = b.userData; u.ph += dt * 14;
        const o = u.off;
        b.position.set(f.c.x + o.x + Math.sin(this.t * 1.3 + u.ph * 0.1) * 1.5, f.c.y + o.y + Math.sin(u.ph * 0.15) * 0.8, f.c.z + o.z + Math.cos(this.t * 1.1 + u.ph * 0.1) * 1.5);
        b.rotation.y = dir;
        const flap = Math.sin(u.ph) * 0.9; u.wl.rotation.z = flap; u.wr.rotation.z = -flap;
      }
      if (f.life <= 0) { for (const b of f.birds) this.scene.remove(b); return false; }
      return true;
    });
    // 蝴蝶
    const wantBf = good && lush && alt < 3400 && game.airTemp > 8 && S.fauna >= 0.9 && (game.seasonKey !== 'winter') ? (game.seasonKey === 'autumn' ? 4 : 9) : 0;
    while (this.butterflies.length < wantBf) {
      const m = makeButterfly(BUTTERFLY_COLORS[(Math.random() * BUTTERFLY_COLORS.length) | 0]);
      const a = Math.random() * 6.28, r = 4 + Math.random() * 14;
      const anchor = new THREE.Vector3(P.x + Math.cos(a) * r, 0, P.z + Math.sin(a) * r);
      this.scene.add(m);
      this.butterflies.push({ mesh: m, anchor, ph: Math.random() * 10, dir: Math.random() * 6.28 });
    }
    if (this.butterflies.length > wantBf) { const b = this.butterflies.pop(); this.scene.remove(b.mesh); }
    for (const b of this.butterflies) {
      b.ph += dt;
      b.dir += (Math.sin(b.ph * 1.7) + Math.sin(b.ph * 0.6 + 2)) * dt * 1.5;
      b.anchor.x += Math.cos(b.dir) * dt * 1.2; b.anchor.z += Math.sin(b.dir) * dt * 1.2;
      if (b.anchor.distanceTo(new THREE.Vector3(P.x, 0, P.z).setY(0)) > 26) { const a = Math.random() * 6.28; b.anchor.set(P.x + Math.cos(a) * 10, 0, P.z + Math.sin(a) * 10); }
      const y = heightAt(b.anchor.x, b.anchor.z) + 0.5 + Math.abs(Math.sin(b.ph * 0.9)) * 1.1;
      b.mesh.position.set(b.anchor.x, y, b.anchor.z);
      b.mesh.rotation.y = -b.dir + Math.PI / 2;
      const f = Math.sin(b.ph * 28) * 1.1; b.mesh.userData.wl.rotation.z = f; b.mesh.userData.wr.rotation.z = -f;
    }
    // 鹰
    const wantE = good && alt > 2900 && S.fauna > 0.3 ? 1 : 0;
    if (this.eagles.length < wantE && Math.random() < dt * 0.05) {
      const m = makeBird(2.6, eagleMat, true); this.scene.add(m);
      this.eagles.push({ mesh: m, c: new THREE.Vector3(P.x + 40, P.y + 55 + Math.random() * 30, P.z + (Math.random() - 0.5) * 60), r: 35 + Math.random() * 40, a: Math.random() * 6.28, life: 70, cry: 8 });
    }
    this.eagles = this.eagles.filter(e => {
      e.life -= dt; e.a += dt * 0.25; e.c.x += dt * 2;
      e.mesh.position.set(e.c.x + Math.cos(e.a) * e.r, e.c.y + Math.sin(e.a * 2) * 3, e.c.z + Math.sin(e.a) * e.r);
      e.mesh.rotation.set(0, -e.a, 0); e.mesh.rotateZ(0.35);
      const glide = Math.sin(this.t * 0.8) * 0.12; e.mesh.userData.wl.rotation.z = glide; e.mesh.userData.wr.rotation.z = -glide;
      e.cry -= dt; if (e.cry <= 0) { e.cry = 15 + Math.random() * 20; game.audio.eagle(); }
      if (e.life <= 0 || !good) { this.scene.remove(e.mesh); return false; }
      return true;
    });
  }
}
