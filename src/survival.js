// ===================== 背包 + 生存指标 =====================
import { ITEMS, ITEM_USES, SEC_PER_GAME_HOUR } from './data.js';
import { clamp, lerp } from './noise.js';

const PER_H = 1 / SEC_PER_GAME_HOUR; // 每游戏小时 → 每现实秒
const FOOD_SHARE = 0.5;               // 消耗里由胃里的食物承担的比例（其余靠身体脂肪）

// ---------------- 背包 ----------------
export class Inventory {
  constructor() {
    this.backpack = null;
    this.items = {};    // id -> 数量
    this.uses = {};     // id -> 剩余次数
    this.worn = new Set();
    this.water = 0;     // 升
    this.waterRaw = 0;  // 其中未处理的生水
    this.flask = 0;     // 保温壶里的水（升）
    this.flaskT = 0;    // 保温壶水温（℃）
    this.battery = { gps: 100, lamp: 100, phone: 100 };
    this.money = 0;
    this.tentDamaged = false;
    this.ponchoHP = 100;
  }
  serialize() { return { backpack: this.backpack && this.backpack.id, items: { ...this.items }, uses: { ...this.uses }, worn: [...this.worn], water: this.water, waterRaw: this.waterRaw, battery: { ...this.battery }, money: this.money, tentDamaged: this.tentDamaged, ponchoHP: this.ponchoHP, flask: this.flask, flaskT: this.flaskT }; }
  restore(s, BACKPACKS) {
    this.backpack = BACKPACKS.find(b => b.id === s.backpack) || null;
    this.items = { ...s.items }; this.uses = { ...s.uses }; this.worn = new Set(s.worn);
    this.water = s.water; this.waterRaw = s.waterRaw || 0; this.battery = { phone: 100, ...s.battery }; this.money = s.money; this.tentDamaged = s.tentDamaged; this.ponchoHP = s.ponchoHP;
    this.flask = s.flask || 0; this.flaskT = s.flaskT || 0;
  }
  has(id) { return (this.items[id] || 0) > 0; }
  add(id, n = 1) {
    this.items[id] = (this.items[id] || 0) + n;
    if (ITEM_USES[id]) this.uses[id] = (this.uses[id] || 0) + ITEM_USES[id] * n;
  }
  get waterCap() { return (this.items.bottle || 0) * 1.0; }
  get flaskCap() { return this.has('thermos') ? 1 : 0; }
  weight() {
    let w = this.backpack ? this.backpack.weight : 0;
    for (const id in this.items) { const it = ITEMS[id]; if (it) w += it.weight * this.items[id]; }
    return w + this.water + this.flask;
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
  // 燃气按“份”计：1 份 ≈ 融一锅雪（1.2 L）；一罐气 6 份。烧一杯热水只要 0.1 份，泡一份热食 0.12 份。
  useGas(amt = 1) {
    if (!this.has('stove') || !(this.gasLeft() > 0.001)) return false;
    let need = amt;
    const a = Math.min(this.uses.stove || 0, need); this.uses.stove = (this.uses.stove || 0) - a; need -= a;
    if (need > 0 && this.uses.gas > 0) {
      const b = Math.min(this.uses.gas, need); this.uses.gas -= b;
      this.items.gas = Math.ceil(this.uses.gas / ITEM_USES.gas - 1e-9);
      if (this.items.gas <= 0) { delete this.items.gas; delete this.uses.gas; }
    }
    return true;
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
  incub:    { name: '潜伏感染', bad: true, hidden: true },
  diamox:   { name: '抗高反', bad: false, desc: '乙酰唑胺生效中，高反累积大幅减缓。' },
  warmer:   { name: '暖宝宝', bad: false, desc: '贴在身上持续发热，手和胸口暖和些。' },
  blanket:  { name: '保温毯', bad: false, desc: '裹着保温毯，热量流失大幅减少。' },
  ibu:      { name: '布洛芬', bad: false, desc: '止痛中，伤痛与头痛的影响减轻。' },
  elec:     { name: '电解质', bad: false, desc: '电解质平衡，水分和精力消耗减缓。' },
  footbath: { name: '脚暖', bad: false, desc: '刚用热水泡过脚，脚是暖的，睡得也更香。' },
  hotmeal:  { name: '饱暖', bad: false, desc: '刚吃了热食 / 喝了热水，从里往外暖和。' },
};

// ---------------- 生存 ----------------
export class Survival {
  constructor(inv) {
    this.inv = inv;
    this.health = 100; this.stamina = 100; this.energy = 100; this.satiety = 85; this.hydration = 90;
    this.core = 37.0; this.fuel = 0; this.wet = 0; this.mental = 85; this.altSick = 0; this.acclim = 0;
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
    const o = {}; for (const k of ['health', 'stamina', 'energy', 'satiety', 'hydration', 'core', 'wet', 'mental', 'altSick', 'acclim', 'paradoxDone', 'coma', 'waterSat', 'fuel']) o[k] = this[k];
    o.status = JSON.parse(JSON.stringify(this.status)); o.stats = { ...this.stats }; return o;
  }
  restore(s) { Object.assign(this, s); this.status = JSON.parse(JSON.stringify(s.status)); this.stats = { ...s.stats }; this.cause = ''; }

  // 无敌模式下伤病一律不上身；返回是否真的加上了
  addStatus(k, data) { if (this.god && STATUS[k] && STATUS[k].bad) return false; this.status[k] = { ...(this.status[k] || {}), ...data }; return true; }
  hasStatus(k) { return !!this.status[k]; }
  clearStatus(k) { delete this.status[k]; }

  damage(v, cause) { if (this.god) return; this.health -= v; if (this.health <= 0) this.cause = cause; this.lastHitCause = cause; }

  // 无敌模式：所有指标拉满，伤病清空
  fill() {
    this.health = 100; this.energy = 100; this.satiety = 100; this.hydration = 100; this.stamina = 100;
    this.core = 37; this.wet = 0; this.mental = 100; this.altSick = 0; this.snowExposure = 0;
    this.exhausted = false; this.coma = false; this.cause = '';
    for (const k in this.status) if (STATUS[k] && STATUS[k].bad) delete this.status[k];
  }

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
    // 火堆的辐射热：坐在火边，前胸烤得发烫，后背还是凉的——整体相当于周围暖和了十几度
    if (env.nearFire && !env.inTent) air += 14;
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
      // 睡袋标的是“舒适温度”：只穿内衣、垫着防潮垫，帐篷里气温在舒适温度上下还能睡暖；再低 5℃ 左右是极限，
      // 更冷就得把抓绒、羽绒服都穿进睡袋里
      if (bag !== null) insul += (14 - bag) * (1 - 0.5 * wetF);
      insul += inv.has('pad') ? 5 : -5;
    }
    if (this.status.blanket) insul += 10;
    let act = 0;
    if (env.sleeping || this.coma) act = 0;
    else if (env.warming) act = 14;
    else if (env.sprint) act = 12;
    else if (env.moving) act = env.uphill > 0.15 || env.stone ? 9 : 6;
    // 身体的热量归根结底来自吃下去的东西，冷的热的都一样：
    // 刚吃下的食物在消化吸收的一两个小时里让身体多产热（高热量的巧克力 / 能量棒 / 牛肉干都算）；
    // 吃饱的人代谢旺盛、更扛冻，饿肚子的人产热不足，断粮时连寒战都打不起来。
    const food = this.coma ? 0 : this.digestHeat();
    const fed = this.coma ? 0 : this.fedHeat();
    const shiver = this.core < 36 && this.core > 31 && !this.coma ? (this.satiety > 5 ? 3 : 1.5) : 0; // 寒战产热
    // 暖宝宝一片只有几瓦，贴在胸口腋下暖的是局部；一杯热水的热量也就十来千卡——都只是锦上添花
    const gear = (this.status.warmer ? 1.5 : 0) + (this.status.hotmeal ? 1 : 0);
    const passiveHeat = gear + food + fed + shiver;
    const heat = act + passiveHeat + (this.status.fever ? 6 : 0);
    this.teff = teff; this.windBlock = windBlock; this.rainBlock = rainBlock;
    this.heatParts = { act, food, fed, shiver, gear };
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
      if (act > 0 && this.core > 36) dry *= 1.8;          // 走动时体温把湿气往外推，衣服干得快得多
      if (env.sleeping && env.inTent) dry = 0.22;
      if (env.nearFire) dry = Math.max(dry, 2);          // 火边烤衣服：湿透的衣服两个来小时就能烤干
      this.wet = Math.max(0, this.wet - dry * dt * (1 - precip * 3));
    }
    // 雨衣在大风里破损
    if (this.inv.worn.has('poncho') && th.wind > 6 && !env.inTent) {
      this.inv.ponchoHP -= (th.wind - 6) * 0.25 * dt;
      if (this.inv.ponchoHP <= 0) { this.inv.worn.delete('poncho'); this.inv.consume('poncho'); this.inv.ponchoHP = 100; hooks.msg('一阵狂风把一次性雨衣撕成了碎片！', 'danger'); hooks.gearChanged && hooks.gearChanged(); }
    }

    // ---- 饥饿 ----
    // kcal 是实际消耗；饱食度只反映胃里和血糖那一部分。徒步时身体会动用脂肪储备补上大约一半的缺口，
    // 所以人没那么容易饿：吃饱后要连续走大半天才会饿；断粮也不会马上要命，只是越来越虚、越来越怕冷。
    let kcal = env.sleeping ? 55 : act === 0 ? 70 : act >= 2 ? 280 : act > 1 ? 220 : 160;
    kcal *= 0.75 + lf * 0.25;
    if (this.core < 36) kcal += 90;
    this.satiety = Math.max(0, this.satiety - kcal * FOOD_SHARE / 20 * PER_H * dt);
    this.stats.kcal += kcal * PER_H * dt;
    this.waterSat = Math.max(0, (this.waterSat || 0) - 2 * PER_H * dt);
    this.fuel = Math.max(0, (this.fuel || 0) - 220 * PER_H * dt);   // 大约两三个小时消化完一顿

    // ---- 保温壶 ----
    // 真空壶也会慢慢凉：按牛顿冷却，时间常数满壶约 16 小时（装得越少凉得越快）。
    // 0℃ 的山上，92℃ 的开水 6 小时后约 63℃，12 小时后约 43℃。
    const inv = this.inv;
    if (inv.flask > 0.001) {
      const amb = env.airTemp + (env.inTent ? 7 : 4);
      const tau = 16 * (0.45 + 0.55 * Math.min(1, inv.flask / Math.max(inv.flaskCap, 0.1)));
      inv.flaskT = Math.max(0.5, amb + (inv.flaskT - amb) * Math.exp(-dt * PER_H / tau));
    }

    // ---- 口渴 ----
    // 升/游戏小时。山上气温低，稳步徒步每小时只需 0.12–0.16 L：喝足水后连续爬坡半天不喝会很渴，但远不致命；
    // 身体储水 2.5 L（水分 100 → 0），口渴时喝一口（0.25 L）就能再顶一个半小时以上。
    let L = env.sleeping ? 0.025 : act === 0 ? 0.045 : act >= 2 ? 0.3 : act > 1 ? 0.16 : 0.12;
    if (env.airTemp > 18) L *= 1.35;
    if (env.altitude > 3000) L *= 1.1;
    if (st.elec) L *= 0.75;
    if (st.diarrhea) L += 0.4;
    if (st.fever) L += 0.1;
    this.hydration = Math.max(0, this.hydration - L / 0.025 * PER_H * dt);

    // ---- 精力 ----
    // 一整天的徒步会把精力耗掉一大半，睡一觉才能补回来；坐下歇着能慢慢回一点（远不如睡觉）
    if (env.sleeping) {
      this.energy = Math.min(100, this.energy + 11 * (env.sleepQ || 1) * PER_H * dt);
    } else if (env.resting) {
      this.energy = Math.min(100, this.energy + (this.satiety > 8 ? 3 : 1.2) * PER_H * dt);
    } else {
      let e = act === 0 ? 1.5 : act >= 2 ? 7 : act > 1 ? 4.2 : 3.2;
      if (st.elec) e *= 0.8;
      if (this.satiety <= 0) e *= 1.3;
      this.energy = Math.max(0, this.energy - e * PER_H * dt);
    }

    // ---- 体力 ----
    const maxSta = this.maxStamina();
    if (env.warming) this.stamina -= 10 * lf * dt;
    else if (env.sprint) this.stamina -= 9 * lf * dt * (this.mental < 15 ? 1.3 : 1);
    else if (env.moving) {
      // 稳步徒步是有氧运动：健康的成年人慢慢走、慢慢爬，可以走很久。
      // 体力会降到与坡度 / 负重 / 地形相称的水平然后稳住（越陡越累，但不会走着走着就力竭）；
      // 只有超负荷——负重过重 + 陡坡乱石 + 高海拔叠在一起——才会持续透支直到力竭。
      let e = Math.max(0, env.uphill - 0.08) * 1.5 + (env.stone ? 0.22 : 0) + (env.mud ? env.mud * (0.25 + Math.abs(env.uphill)) : 0);
      if (env.stance === 'crouch') e += 0.25;
      if (env.stance === 'prone') e += 0.45;
      e = e * lf + Math.max(0, lf - 1.5) * 0.6;
      if (env.poles) e *= 0.8;
      if (env.altitude > 3200) e *= 1.1;
      this.effort = lerp(this.effort || 0, e, 1 - Math.exp(-1.5 * dt));   // 平滑掉乱石上一步一跳的坡度
      const ef = this.effort;
      const target = maxSta * clamp(1 - ef * 0.55, 0.2, 1);
      const over = Math.max(0, ef - 1.15) * 3;   // 超负荷部分：在平衡点之下继续透支
      if (this.stamina > target) this.stamina -= Math.min(this.stamina - target, 0.9 * dt);
      else if (!over) this.stamina += Math.min(target - this.stamina, 1.6 * dt);
      this.stamina -= over * dt;
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
    if (env.nearFire) m += 0.06;
    if (env.sleeping) m += 0.04 * (env.sleepQ || 1);
    m -= 0.008; // 孤独
    this.mental = clamp(this.mental + m * dt, 0, 100);

    // ---- 生命 ----
    let dh = 0; const causes = [];
    const add = (v, c) => { dh -= v; causes.push([v, c]); };
    if (st.bleed) add(0.22, '失血过多');
    if (st.poison) add(0.15, '蛇毒');
    // 断粮不会几天就饿死（人不吃东西能撑几周），它要命的方式是：没力气、产热不足、扛不住冷。
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
    // 生命自然恢复：没有伤病在掉血、不太饿不太渴、身体不冷时，生命会慢慢长回来。
    // 走路时很慢，坐下休息快一些，睡一觉恢复最多；吃饱喝足、刚吃过热食恢复更快。
    this.regen = 0; this.noRegen = '';
    if (dh !== 0) this.noRegen = causes.sort((a, b) => b[0] - a[0])[0][1];
    else if (this.satiety <= 15) this.noRegen = '太饿';
    else if (this.hydration <= 15) this.noRegen = '太渴';
    else if (this.core <= 35.5) this.noRegen = '太冷';
    else {
      let r = env.sleeping ? 4 * clamp(env.sleepQ || 1, 0.3, 1.2) : env.resting ? 2.5 : 1;   // 每游戏小时
      if (this.satiety > 50 && this.hydration > 50) r *= 1.25;
      if (st.hotmeal) r *= 1.5;
      this.regen = r;
      dh = r * PER_H;
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
    if (this.god) this.fill();
  }

  // 喝水能暂时压一压饥饿感（“水饱”），但只能顶一点点：0.25 L ≈ 2.5 点饱食度，
  // 消化产热：刚吃下的热量在接下来一两个小时里慢慢释放（最多 +2）
  digestHeat() { return Math.min(2, (this.fuel || 0) / 250); }
  // 营养状态：吃饱 +1.5，半饱 0，饿到底 −3
  fedHeat() { const s = this.satiety; return s <= 0 ? -3 : clamp((s - 25) / 25, -1, 1) * 1.5; }
  // 吃东西（kcal）：除了饱食度，还进入“消化池”持续产热
  ingest(kcal) { this.fuel = Math.min(900, (this.fuel || 0) + kcal); }

  // 最多垫到 45，而且一小时里通过喝水补的饱食度总共也就两三点——不能拿水当饭吃。
  drinkFill(L) {
    const g = Math.min(L * 10, 6 - (this.waterSat || 0), 45 - this.satiety);
    if (!(g > 0)) return 0;
    this.satiety += g; this.waterSat = (this.waterSat || 0) + g;
    return g;
  }

  // 喝下低温的水，身体要花热量把它焐到体温：0.25 L 接近 0℃ 的水 ≈ 核心体温 −0.25℃。
  // 天暖时这点热量很快就补回来；冷天、尤其已经在失温的时候，一大口冰水会把人往下拽。
  coldDrink(L, tw) {
    const d = L * Math.max(0, 36 - tw) * 0.028 * (this.core < 36 ? 1.4 : 1);
    this.core -= d;
    return d;
  }

  maxStamina() {
    let m = 100 * clamp(0.35 + 0.65 * this.energy / 100, 0.35, 1);
    if (this.satiety < 8) m *= 0.7;
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
    if (this.satiety <= 0) s *= 0.85;   // 低血糖“撞墙”：腿发软
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
    if (this.god) out.push(['无敌模式', 'good', '所有指标锁满，不会受伤生病；快跑 10 米/秒，能跳 2 米高，长按跳跃起飞、踏空自由飞行（大气层里最快 3.5 马赫，太空里 0.3 倍光速），按住下降落回地面。暂停菜单里可以关闭。']);
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
