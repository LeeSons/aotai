// ===================== 背包 + 生存指标 =====================
import { ITEMS, ITEM_USES, SEC_PER_GAME_HOUR } from './data.js';
import { clamp, lerp } from './noise.js';

const PER_H = 1 / SEC_PER_GAME_HOUR; // 每游戏小时 → 每现实秒

// ---------------- 背包 ----------------
export class Inventory {
  constructor() {
    this.backpack = null;
    this.items = {};    // id -> 数量
    this.uses = {};     // id -> 剩余次数
    this.worn = new Set();
    this.water = 0;     // 升
    this.waterRaw = 0;  // 其中未处理的生水
    this.battery = { gps: 100, lamp: 100, phone: 100 };
    this.money = 0;
    this.tentDamaged = false;
    this.ponchoHP = 100;
  }
  serialize() { return { backpack: this.backpack && this.backpack.id, items: { ...this.items }, uses: { ...this.uses }, worn: [...this.worn], water: this.water, waterRaw: this.waterRaw, battery: { ...this.battery }, money: this.money, tentDamaged: this.tentDamaged, ponchoHP: this.ponchoHP }; }
  restore(s, BACKPACKS) {
    this.backpack = BACKPACKS.find(b => b.id === s.backpack) || null;
    this.items = { ...s.items }; this.uses = { ...s.uses }; this.worn = new Set(s.worn);
    this.water = s.water; this.waterRaw = s.waterRaw || 0; this.battery = { phone: 100, ...s.battery }; this.money = s.money; this.tentDamaged = s.tentDamaged; this.ponchoHP = s.ponchoHP;
  }
  has(id) { return (this.items[id] || 0) > 0; }
  add(id, n = 1) {
    this.items[id] = (this.items[id] || 0) + n;
    if (ITEM_USES[id]) this.uses[id] = (this.uses[id] || 0) + ITEM_USES[id] * n;
  }
  get waterCap() { return (this.items.bottle || 0) * 1.0; }
  weight() {
    let w = this.backpack ? this.backpack.weight : 0;
    for (const id in this.items) { const it = ITEMS[id]; if (it) w += it.weight * this.items[id]; }
    return w + this.water;
  }
  // 消耗一次“次数型”物品；返回是否成功
  use(id) {
    if (!(this.uses[id] > 0)) return false;
    this.uses[id]--;
    const per = ITEM_USES[id];
    if (ITEMS[id].stack) this.items[id] = Math.ceil(this.uses[id] / per);
    else if (id !== 'stove' && this.uses[id] <= 0) this.items[id] = 0;
    if (this.items[id] <= 0) { delete this.items[id]; delete this.uses[id]; }
    return true;
  }
  consume(id) { if (!this.has(id)) return false; this.items[id]--; if (this.items[id] <= 0) delete this.items[id]; return true; }
  gasLeft() { return (this.uses.stove || 0) + (this.uses.gas || 0); }
  useGas() {
    if (!this.has('stove')) return false;
    if (this.uses.stove > 0) { this.uses.stove--; return true; }
    return this.use('gas');
  }
  insulation() { let s = 4; for (const id of this.worn) s += ITEMS[id].insul || 0; return s; }
}

// ---------------- 状态效果定义 ----------------
export const STATUS = {
  sprain:   { name: '崴脚', bad: true, desc: '脚踝扭伤，行走变慢。用弹性绷带固定可以缓解。' },
  fracture: { name: '骨折', bad: true, desc: '小腿骨折。几乎无法行走，需要用急救包固定。' },
  bleed:    { name: '出血', bad: true, desc: '伤口在流血，生命持续下降。需要急救包止血。' },
  poison:   { name: '蛇毒', bad: true, desc: '被蛇咬伤，生命持续下降。需要急救包处理。' },
  diarrhea: { name: '腹泻', bad: true, desc: '喝了生水导致急性腹泻，大量流失水分。蒙脱石散可治疗。' },
  fever:    { name: '高烧', bad: true, desc: '蜱虫叮咬引发的感染性高烧。布洛芬可暂时缓解。' },
  snowblind:{ name: '雪盲', bad: true, desc: '雪地强光灼伤了眼睛，视线模糊刺痛。' },
  tick:     { name: '蜱虫', bad: true, hidden: true },
  diamox:   { name: '抗高反', bad: false, desc: '乙酰唑胺生效中，高反累积大幅减缓。' },
  warmer:   { name: '暖宝宝', bad: false, desc: '持续发热中。' },
  blanket:  { name: '保温毯', bad: false, desc: '裹着保温毯，热量流失大幅减少。' },
  ibu:      { name: '布洛芬', bad: false, desc: '止痛中，伤痛与头痛的影响减轻。' },
  elec:     { name: '电解质', bad: false, desc: '电解质平衡，水分和精力消耗减缓。' },
  hotmeal:  { name: '饱暖', bad: false, desc: '刚吃了热食，身体暖和。' },
};

// ---------------- 生存 ----------------
export class Survival {
  constructor(inv) {
    this.inv = inv;
    this.health = 100; this.stamina = 100; this.energy = 100; this.satiety = 85; this.hydration = 90;
    this.core = 37.0; this.wet = 0; this.mental = 85; this.altSick = 0; this.acclim = 0;
    this.status = {};
    this.exhausted = false;
    this.cause = '';
    this.balance = 0;
    this.teff = 15;
    this.vomitTimer = 60;
    this.paradoxDone = false;
    this.coma = false;
    this.snowExposure = 0;
    this.stats = { minCore: 37, maxAlt: 0, kcal: 0, water: 0, dangers: 0, falls: 0 };
  }
  serialize() {
    const o = {}; for (const k of ['health', 'stamina', 'energy', 'satiety', 'hydration', 'core', 'wet', 'mental', 'altSick', 'acclim', 'paradoxDone', 'coma']) o[k] = this[k];
    o.status = JSON.parse(JSON.stringify(this.status)); o.stats = { ...this.stats }; return o;
  }
  restore(s) { Object.assign(this, s); this.status = JSON.parse(JSON.stringify(s.status)); this.stats = { ...s.stats }; this.cause = ''; }

  addStatus(k, data) { this.status[k] = { ...(this.status[k] || {}), ...data }; }
  hasStatus(k) { return !!this.status[k]; }
  clearStatus(k) { delete this.status[k]; }

  damage(v, cause) { this.health -= v; if (this.health <= 0) this.cause = cause; this.lastHitCause = cause; }

  loadFactor() {
    const bp = this.inv.backpack;
    const w = this.inv.weight();
    return 1 + Math.pow(w / 25, 1.4) * (bp ? bp.eff : 1.2);
  }

  // 由环境计算热平衡
  thermal(env) {
    const inv = this.inv;
    let windBlock = 0, rainBlock = 0;
    for (const id of inv.worn) {
      const it = ITEMS[id];
      if (it.windBlock) windBlock = Math.max(windBlock, it.windBlock);
      if (it.rainBlock) rainBlock = 1 - (1 - rainBlock) * (1 - (id === 'poncho' ? it.rainBlock * inv.ponchoHP / 100 : it.rainBlock));
    }
    let air = env.airTemp, wind = env.wind, rain = env.rain, snow = env.snow;
    if ((env.stance === 'prone' || this.coma) && !env.inTent && !env.sleeping) { air -= 3; wind *= 0.6; }
    else if (env.stance === 'crouch') wind *= 0.85;
    if (env.inTent) {
      const dmg = inv.tentDamaged;
      air += dmg ? 3 : (inv.has('tent4') ? 9 : 7);
      wind *= dmg ? 0.5 : (inv.has('tent4') ? 0 : (wind > 8 ? 0.15 : 0));
      rain *= dmg ? 0.5 : 0; snow *= dmg ? 0.5 : 0;
    } else if (env.shelter) {
      const weak = env.shelter.weak;
      wind *= weak ? 0.6 : 0.3; rain *= weak ? 1 : 0.15; snow *= weak ? 1 : 0.15;
      if (!weak) air += 2;
    }
    const chill = Math.pow(Math.max(wind - 1, 0), 1.45) * 0.6 * (1 - windBlock);
    const teff = air - chill - this.wet * 0.06;
    // 保温
    let insul = 4;
    const wetF = this.wet / 100;
    for (const id of inv.worn) {
      const it = ITEMS[id];
      if (!it.insul) continue;
      insul += it.insul * (1 - (it.wetLoss || 0.55) * wetF);
    }
    if (env.sleeping) {
      const bag = inv.has('bagm10') ? -10 : inv.has('bag0') ? 0 : inv.has('bag10') ? 10 : null;
      if (bag !== null) insul += (25 - bag) * (1 - 0.5 * wetF);
      insul += inv.has('pad') ? 5 : -5;
    }
    if (this.status.blanket) insul += 10;
    let heat = 0;
    if (env.sleeping || this.coma) heat = 0;
    else if (env.warming) heat = 14;
    else if (env.sprint) heat = 12;
    else if (env.moving) heat = env.uphill > 0.15 || env.stone ? 9 : 6;
    if (this.status.warmer) heat += 4;
    if (this.status.hotmeal) heat += 3;
    let passiveHeat = (this.status.warmer ? 4 : 0) + (this.status.hotmeal ? 3 : 0);
    if (this.core < 36 && this.core > 31 && !this.coma) { heat += 3; passiveHeat += 3; } // 寒战产热
    if (this.status.fever) heat += 6;
    this.teff = teff; this.windBlock = windBlock; this.rainBlock = rainBlock;
    return { balance: teff + insul + heat - 21, passive: teff + insul + passiveHeat - 21, rain, snow, wind, air, windBlock, rainBlock, insul, heat };
  }

  update(dt, env, hooks) {
    const st = this.status;
    // ---- 状态计时 ----
    for (const k in st) {
      if (st[k].t !== undefined) { st[k].t -= dt; if (st[k].t <= 0) { const was = k; delete st[k]; hooks.onExpire && hooks.onExpire(was); } }
    }
    const lf = this.loadFactor();
    const act = env.sleeping || this.coma ? -1 : env.sprint || env.warming ? 2 : env.moving ? ((env.uphill > 0.15 || env.stone) ? 1.4 : 1) : 0;

    // ---- 体温 ----
    const th = this.thermal(env);
    this.balance = th.balance;
    const b = th.balance;
    // 轻微的热量亏空靠外周血管收缩就能扛住（手脚发凉，核心体温不掉）；亏空超过这个余量才真正失温
    const VASO = 2;
    // 环境越冷，靠运动能维持的体温上限越低（运动只能延缓失温，无法逆转）
    const pas = th.passive + VASO;
    this.coreCap = pas >= 0 ? 37.2 : clamp(37 + pas * 0.065, 30.5, 37);
    if (b < -VASO) this.core -= (-b - VASO) * 0.003 * dt;
    else if (b < 0) { if (this.core > 37 && !st.fever) this.core -= 0.012 * dt; }
    else {
      if (this.core < Math.min(37, this.coreCap)) this.core = Math.min(this.coreCap, this.core + Math.min(b, 15) * (env.warming ? 0.0016 : 0.0022) * dt + 0.002 * dt);
      else if (this.core > this.coreCap + 0.05 && pas < 0) this.core -= Math.min(0.01, (this.core - this.coreCap) * 0.004) * dt;
      if (b > 14 && act > 0) {
        this.wet = Math.min(100, this.wet + (b - 14) * 0.05 * dt * (this.inv.worn.has('base') ? 0.45 : 1));
        if (this.core < 38.3) this.core += (b - 14) * 0.0003 * dt;
      } else if (this.core > 37 && !st.fever) this.core -= 0.012 * dt;
    }
    if (st.fever && this.core < 38.8) this.core += 0.01 * dt;
    this.core = clamp(this.core, 20, 41);
    this.stats.minCore = Math.min(this.stats.minCore, this.core);

    // ---- 潮湿 ----
    const ground = env.stance === 'prone' && !env.inTent ? (env.wetGround || 0) * 0.6 + (env.snowCover || 0) * 0.35 : 0;
    const precip = ground + th.rain * 1.7 * (1 - th.rainBlock) + th.snow * 0.45 * (1 - th.rainBlock * 0.9) + (env.hail || 0) * 0.3 * (1 - th.rainBlock) + (env.damp || 0) * (1 - th.rainBlock * 0.5);
    if (precip > 0.02) this.wet = Math.min(100, this.wet + precip * dt);
    if (precip < 0.3) {
      let dry = (0.1 + th.wind * 0.015) * (env.airTemp > 8 ? 1.4 : 0.8) * (this.inv.worn.has('base') ? 1.5 : 1);
      if (env.sleeping && env.inTent) dry = 0.22;
      this.wet = Math.max(0, this.wet - dry * dt * (1 - precip * 3));
    }
    // 雨衣在大风里破损
    if (this.inv.worn.has('poncho') && th.wind > 6 && !env.inTent) {
      this.inv.ponchoHP -= (th.wind - 6) * 0.25 * dt;
      if (this.inv.ponchoHP <= 0) { this.inv.worn.delete('poncho'); this.inv.consume('poncho'); this.inv.ponchoHP = 100; hooks.msg('一阵狂风把一次性雨衣撕成了碎片！', 'danger'); hooks.gearChanged && hooks.gearChanged(); }
    }

    // ---- 饥饿 ----
    let kcal = env.sleeping ? 55 : act === 0 ? 70 : act >= 2 ? 280 : act > 1 ? 220 : 160;
    kcal *= 0.75 + lf * 0.25;
    if (this.core < 36) kcal += 90;
    this.satiety = Math.max(0, this.satiety - kcal / 20 * PER_H * dt);
    this.stats.kcal += kcal * PER_H * dt;

    // ---- 口渴 ----
    let L = env.sleeping ? 0.045 : act === 0 ? 0.075 : act >= 2 ? 0.42 : act > 1 ? 0.3 : 0.22;
    if (env.airTemp > 18) L *= 1.4;
    if (env.altitude > 3000) L *= 1.15;
    if (st.elec) L *= 0.75;
    if (st.diarrhea) L += 0.4;
    if (st.fever) L += 0.1;
    this.hydration = Math.max(0, this.hydration - L / 0.025 * PER_H * dt);

    // ---- 精力 ----
    if (env.sleeping) {
      this.energy = Math.min(100, this.energy + 11 * (env.sleepQ || 1) * PER_H * dt);
    } else {
      let e = act === 0 ? 2.5 : act >= 2 ? 8 : act > 1 ? 6 : 4.5;
      if (st.elec) e *= 0.8;
      if (env.resting) e = 1.2;
      this.energy = Math.max(0, this.energy - e * PER_H * dt);
    }

    // ---- 体力 ----
    const maxSta = this.maxStamina();
    if (env.warming) this.stamina -= 10 * lf * dt;
    else if (env.sprint) this.stamina -= 9 * lf * dt * (this.mental < 15 ? 1.3 : 1);
    else if (env.moving) {
      let d = Math.max(0, env.uphill - 0.1) * 7.2 * lf + (env.stone ? 1.8 * lf : 0) + (env.mud ? env.mud * (0.8 + Math.abs(env.uphill) * 2) * lf : 0) + (lf > 1.8 ? (lf - 1.8) * 1.3 : 0);
      if (env.stance === 'crouch') d += 0.9 * lf;
      if (env.stance === 'prone') d += 1.7 * lf;
      if (env.poles) d *= 0.75;
      if (env.altitude > 3200) d *= 1.12;
      this.stamina += (d > 0 ? -d : 2.2) * dt;
    } else if (!env.sleeping) this.stamina += (env.resting ? 14 : 8) * dt * clamp(0.4 + this.energy / 120, 0.4, 1);
    else this.stamina = maxSta;
    this.stamina = clamp(this.stamina, 0, maxSta);
    if (this.stamina <= 0.5) this.exhausted = true;
    if (this.exhausted && this.stamina > 30) this.exhausted = false;

    // ---- 高反 ----
    if (env.altitude > 2800) {
      const g = (env.altitude - 2800) / 1000 * 0.09 * (act >= 2 ? 2.2 : act > 0 ? 1.25 : env.sleeping ? 0.5 : 0.7) * (1 - this.acclim) * (st.diamox ? 0.3 : 1);
      this.altSick += g * dt;
      this.acclim = Math.min(0.6, this.acclim + 0.00022 * dt);
      if (env.sleeping || env.resting) this.altSick -= 0.02 * dt;
    } else this.altSick -= 0.06 * dt;
    this.altSick = clamp(this.altSick, 0, 100);
    this.stats.maxAlt = Math.max(this.stats.maxAlt, this.altSick);
    if (this.altSick > 60 && !env.sleeping) {
      this.vomitTimer -= dt;
      if (this.vomitTimer <= 0) {
        this.vomitTimer = 35 + Math.random() * 50;
        this.hydration = Math.max(0, this.hydration - 7); this.satiety = Math.max(0, this.satiety - 6); this.mental -= 4;
        hooks.msg('高反导致你剧烈呕吐，头痛欲裂……', 'danger'); hooks.vomit && hooks.vomit();
      }
    }

    // ---- 雪盲 ----
    if (env.snowGlare && !this.inv.has('glasses') && !env.sleeping) {
      this.snowExposure += dt;
      if (this.snowExposure > 70 && !st.snowblind) { this.addStatus('snowblind', { t: 150 }); hooks.msg('雪地的反光像刀子一样刺进眼睛——你雪盲了！', 'danger'); }
    } else this.snowExposure = Math.max(0, this.snowExposure - dt * 0.5);

    // ---- 精神 ----
    let m = 0;
    if (env.fog > 0.5) m -= 0.06;
    if (env.night && !env.sleeping && !env.shelter) m -= 0.04;
    if (env.severe && !env.inTent) m -= 0.07;
    if (env.lost) m -= 0.22;
    if (st.sprain || st.fracture || st.bleed) m -= 0.04;
    if (this.core < 35) m -= 0.08;
    if (this.satiety < 15) m -= 0.03;
    if (this.hydration < 15) m -= 0.04;
    if (this.energy < 15) m -= 0.04;
    if (this.health < 30) m -= 0.05;
    if (this.altSick > 50) m -= 0.03;
    if (env.goodWeather && !env.night) m += 0.05;
    if (env.shelter || env.inTent) m += 0.03;
    if (env.sleeping) m += 0.04 * (env.sleepQ || 1);
    m -= 0.008; // 孤独
    this.mental = clamp(this.mental + m * dt, 0, 100);

    // ---- 生命 ----
    let dh = 0; const causes = [];
    const add = (v, c) => { dh -= v; causes.push([v, c]); };
    if (st.bleed) add(0.22, '失血过多');
    if (st.poison) add(0.15, '蛇毒');
    if (this.satiety <= 0) add(0.06, '饥饿与低血糖');
    if (this.hydration <= 0) add(0.15, '严重脱水');
    if (this.core < 32) add((32 - this.core) * 0.09 + 0.05, '失温');
    if (!this.coma && !env.sleeping && (this.core < 30.3 || (this.core < 31.4 && Math.random() < dt * 0.07))) { this.coma = true; hooks.coma && hooks.coma(); }
    if (this.coma) {
      add(1.2 + Math.max(0, 31 - this.core) * 0.25, '重度失温昏迷');
      if (this.core > 32.5) { this.coma = false; hooks.wake && hooks.wake(); }
    }
    if (this.altSick >= 85) add(0.12 + (this.altSick - 85) * 0.012, '高原肺水肿');
    if (st.fever) add(0.035, '蜱虫叮咬引发的森林脑炎');
    if (this.mental <= 0) add(0.05, '精神崩溃');
    if (this.energy <= 0) add(0.03, '极度疲劳衰竭');
    if (env.hail > 0.3 && !env.inTent && !env.shelter) add(0.06, '冰雹砸伤');
    if (dh === 0 && this.satiety > 25 && this.hydration > 25 && this.core > 35.5) {
      dh = (env.sleeping ? 0.12 : 0.025);
    }
    this.health = clamp(this.health + dh * dt, 0, 100);
    if (this.core <= 27) { this.health = 0; this.cause = '失温'; }
    if (this.health <= 0 && !this.cause) {
      causes.sort((a, b) => b[0] - a[0]);
      this.cause = causes.length ? causes[0][1] : (this.lastHitCause || '体力衰竭');
    }

    // ---- 反常脱衣（重度失温）----
    if (this.core < 31.2 && !this.paradoxDone && this.inv.worn.size > 0 && !env.sleeping) {
      this.paradoxDone = true;
      const order = ['shell', 'down', 'fleece', 'hat', 'poncho'];
      const off = order.find(id => this.inv.worn.has(id));
      if (off) { this.inv.worn.delete(off); hooks.msg(`你突然感到浑身燥热……不知不觉脱下了${ITEMS[off].name}。（反常脱衣：重度失温的致命征兆）`, 'danger'); hooks.gearChanged && hooks.gearChanged(); }
    }
    if (this.core > 34) this.paradoxDone = false;
  }

  maxStamina() {
    let m = 100 * clamp(0.35 + 0.65 * this.energy / 100, 0.35, 1);
    if (this.satiety < 8) m *= 0.6;
    if (this.hydration < 10) m *= 0.7;
    if (this.core < 35) m *= 0.7;
    if (this.altSick > 35) m *= this.status.ibu ? 0.92 : 0.82;
    if (this.status.fever) m *= 0.75;
    return Math.max(10, m);
  }

  speedMult(env) {
    let s = 1;
    const w = this.inv.weight();
    if (w > 8) s *= 1 - Math.min(0.42, (w - 8) * 0.011 * (this.inv.backpack ? this.inv.backpack.eff : 1.2));
    const pain = this.status.ibu ? 0.5 : 1;
    if (this.status.sprain) s *= 1 - (this.status.sprain.bandaged ? 0.16 : 0.36) * pain;
    if (this.status.fracture) s *= this.status.fracture.splinted ? 0.48 : 0.3;
    if (this.core < 34) s *= 0.75;
    if (this.core < 32) s *= 0.65;
    if (this.energy < 15) s *= 0.8;
    if (this.exhausted) s *= 0.55;
    if (this.altSick > 70) s *= 0.85;
    if (env.snowCover > 0.3 && !this.inv.has('cramp')) s *= 1 - env.snowCover * 0.25;
    if (env.mud) s *= 1 - env.mud * 0.14;
    if (env.dark) s *= 0.6;
    return s;
  }

  canSprint() { return !this.exhausted && !this.status.fracture && this.core > 33 && this.stamina > 5 && !this.coma; }

  // 状态标签（显示在 HUD）
  labels() {
    const out = [];
    const c = this.core;
    if (this.coma) out.push(['昏迷', 'crit']);
    if (c < 32) out.push(['重度失温', 'crit']); else if (c < 34) out.push(['中度失温', 'crit']); else if (c < 35) out.push(['轻度失温', 'bad']); else if (c < 36) out.push(['寒战', 'warn']);
    if (c > 38 && !this.status.fever) out.push(['过热出汗', 'warn']);
    if (this.wet > 70) out.push(['湿透', 'bad']); else if (this.wet > 35) out.push(['潮湿', 'warn']);
    if (this.altSick >= 85) out.push(['高原肺水肿', 'crit']); else if (this.altSick > 60) out.push(['严重高反', 'bad']); else if (this.altSick > 35) out.push(['高反头痛', 'warn']);
    if (this.exhausted) out.push(['力竭', 'bad']);
    if (this.satiety < 10) out.push(['低血糖', 'bad']); else if (this.satiety < 25) out.push(['饥饿', 'warn']);
    if (this.hydration < 10) out.push(['脱水', 'bad']); else if (this.hydration < 25) out.push(['口渴', 'warn']);
    if (this.energy < 15) out.push(['疲惫不堪', 'bad']);
    if (this.mental < 15) out.push(['精神恍惚', 'crit']); else if (this.mental < 30) out.push(['焦虑恐惧', 'bad']);
    for (const k in this.status) {
      const d = STATUS[k]; if (!d || d.hidden) continue;
      let n = d.name;
      if (k === 'sprain' && this.status[k].bandaged) n += '(已包扎)';
      if (k === 'fracture' && this.status[k].splinted) n += '(已固定)';
      out.push([n, d.bad ? 'bad' : 'good', d.desc]);
    }
    return out;
  }
}
