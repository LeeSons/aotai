// ===================== 界面：商店 / HUD / 背包 / 地图 / 弹窗 / 结局 =====================
import { ROUTE, ROUTE_LENGTH, ITEMS, BACKPACKS, CATEGORIES, RECOMMENDED, DIFFICULTY, ITEM_USES, SEASONS, routeZ, yToAlt, altToY, routeDist, fmtDist } from './data.js';
import * as THREE from 'three';
const _v = new THREE.Vector3();
import { STATUS } from './survival.js';
import { clamp } from './noise.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
export const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

export class UI {
  constructor(game) {
    this.g = game;
    this.msgList = [];
    this.alertT = 0;
    this.cardT = 0;
    this.buildBars();
    this.buildCompass();
    this.buildProgress();
  }

  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }

  // ---------------- 消息 ----------------
  msg(text, type = 'info') {
    const box = $('msgs');
    // 去重
    if (this.msgList.length && this.msgList[this.msgList.length - 1].text === text) return;
    const d = el('div', 'm ' + type, text);
    box.appendChild(d);
    const life = type === 'crit' ? 9 : type === 'danger' ? 8 : 6.5;
    const item = { el: d, t: life, text };
    this.msgList.push(item);
    while (this.msgList.length > 6) { const o = this.msgList.shift(); o.el.remove(); }
  }
  alert(text, t = 1.5) { const a = $('alert'); a.textContent = text; a.style.display = 'block'; this.alertT = t; }
  titleCard(sub, name, alt, desc) {
    const c = $('titlecard');
    c.querySelector('.tc-sub').textContent = sub;
    c.querySelector('.tc-name').textContent = name;
    c.querySelector('.tc-alt').textContent = alt;
    c.querySelector('.tc-desc').textContent = desc || '';
    c.classList.add('show');
    this.cardT = 6;
  }
  tick(dt) {
    for (const m of this.msgList) { m.t -= dt; if (m.t < 1) m.el.style.opacity = Math.max(0, m.t); }
    while (this.msgList.length && this.msgList[0].t <= 0) this.msgList.shift().el.remove();
    if (this.alertT > 0) { this.alertT -= dt; if (this.alertT <= 0) $('alert').style.display = 'none'; }
    if (this.cardT > 0) { this.cardT -= dt; if (this.cardT <= 0) $('titlecard').classList.remove('show'); }
  }
  clearMsgs() { for (const m of this.msgList) m.el.remove(); this.msgList = []; $('alert').style.display = 'none'; $('titlecard').classList.remove('show'); this.cardT = 0; }

  // ---------------- 弹窗 ----------------
  modal(title, html, buttons = [{ label: '确定' }], onClose) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = html;
    const bb = $('modal-btns'); bb.innerHTML = '';
    for (const b of buttons) {
      const btn = el('button', 'btn' + (b.cls ? ' ' + b.cls : ''), b.label);
      if (b.disabled) btn.disabled = true;
      btn.onclick = () => { this.g.audio.ui(); if (b.keep) { b.action && b.action(); return; } this.closeModal(); b.action && b.action(); };
      bb.appendChild(btn);
    }
    this.show('modal');
    this.modalOpen = true;
    this.onModalClose = onClose;
  }
  closeModal() { this.hide('modal'); this.modalOpen = false; const f = this.onModalClose; this.onModalClose = null; f && f(); }

  helpHTML() {
    return `<div class="keys-table">
      <div>W A S D</div><div>慢走（默认步行速度）</div>
      <div>Shift</div><div>快跑（消耗大量体力，加重高反；石海里奔跑极易摔倒）。无敌模式下 +/- 调快跑 / 行走速度（快跑 5 m/s 到 2 马赫，行走是快跑的 1/3）</div>
      <div>C</div><div>蹲下 / 蹲行：抵御阵风，不易被羚牛发现，石海更稳</div>
      <div>Z</div><div>趴下 / 匍匐：狂风中最稳，但很慢、贴地更冷更湿；打雷时别趴，要蹲</div>
      <div>X</div><div>展开 / 收起登山杖：更稳、更抗风、爬坡省力（雷暴时记得收起）</div>
      <div>J（按住）</div><div>原地跳动取暖：产热但极耗体力；环境太冷时只能延缓失温</div>
      <div>鼠标</div><div>转动视角（先点击画面锁定鼠标），滚轮调整第三人称距离</div>
      <div>空格</div><div>跳跃 / 起身 / 危险时稳住平衡（QTE）。无敌模式下长按起飞：踏空后 W 往视线方向飞（抬头往上、低头往下），A/D 左右平移，空格 / C 竖直升降，滚轮或 +/- 换速度档（5 m/s 到 3.5 马赫），最高飞到海拔 1 万米，按住 C 降到地面才落地</div>
      <div>V</div><div>切换 第一人称 / 第三人称</div>
      <div>B</div><div>打开背包：吃喝、穿脱衣物、用药、烧水、求救（时间暂停）</div>
      <div>M</div><div>查看全线地图与海拔剖面（需要纸质地图或导航设备）</div>
      <div>E</div><div>互动：取水、查看路牌、进庙避风、与驴友交谈、购买补给；野外下雨、有积雪或雨后有水洼时，按 E 就地取水（接雨水 / 融雪 / 舀积水）</div>
      <div>T</div><div>扎营：搭帐篷睡觉 / 露宿 / 休息一小时 / 带了打火机可以捡柴生火</div>
      <div>R</div><div>原地坐下休息（快速恢复体力，慢慢回一点精力和生命）</div>
      <div>1 / 2 / 3</div><div>快速喝水（身上冷时优先喝保温壶里的热水）/ 吃零食 / 用急救包</div>
      <div>F</div><div>开关头灯</div>
      <div>G</div><div>开关小地图（需要 GPS 或手机离线轨迹）</div>
      <div>Q</div><div>使用防兽喷雾</div>
      <div>Esc</div><div>暂停（画质、无敌模式也在这里）</div>
      <div>F9</div><div>（测试用）传送到下一个地标</div>
    </div>
    <p class="muted" style="margin-top:14px">生存要点：冷了及时加衣、出汗前减衣；下雨必须穿冲锋衣；石海慢慢走；起雾时别离开脚下的路迹，看不清就原地等；雷暴时远离山顶并蹲下；羚牛别靠近、别奔跑；在营地补水，水源可能干涸；天黑前扎营。</p>
    <p class="muted">身体：吃饱后能走大半天才会饿，断粮会越来越虚但不会马上倒下；空肚子喝点水能稍微压一压饿。体温靠身体自己产热：走路产热最多；身体的热量来自吃下去的东西，冷的热的都算——吃饱了更扛冻，冷的时候嚼块巧克力或能量棒，接下来一两个小时会多产热；饿着肚子产热不足，断粮时连寒战都打不起来。热食热水暖得更快，但不是必需。冷天水壶里的水接近冰点，别在身体发冷时猛灌。坐下休息能回一点精力；真正恢复要靠睡觉。生命在没有伤病、不太饿不太渴、身体不冷时会自己慢慢恢复：走路时约 +1/小时，坐下休息约 +2.5/小时，睡一觉约 +4/小时，吃饱喝足或刚吃过热食更快；急救包能处理擦伤（+15）。</p>`;
  }

  // ---------------- 难度 ----------------
  buildDiff(onPick) {
    const list = $('diff-list'); list.innerHTML = '';
    for (const k in DIFFICULTY) {
      const d = DIFFICULTY[k];
      const c = el('div', 'diff-card', `<h3>${d.name}</h3><div class="money">¥ ${d.money}</div><div class="muted">${d.desc}</div>`);
      c.onclick = () => { this.g.audio.ui(); onPick(k); };
      list.appendChild(c);
    }
  }

  // ---------------- 季节 ----------------
  buildSeason(money, wins, onPick) {
    const list = $('season-list'); list.innerHTML = '';
    $('season-money').innerHTML = `初始资金 <b>¥${money}</b>${wins ? `（已成功穿越 ${wins} 次）` : '　·　每成功穿越一次，下次初始资金 +¥1500'}`;
    const info = {
      spring: '夜间 -10℃ · 主脊积雪 · 冰面湿滑<br>融雪水源较多 · 杜鹃花季',
      summer: '夜间 3℃ · 雷暴/浓雾/冷雨频繁<br>水源充足 · 野花遍地 · 蛇虫最多',
      autumn: '夜间 -2℃ · 初雪与大风<br>旱季水源常干涸 · 红叶金杉',
      winter: '夜间 -25℃ · 白毛风 · 深雪<br>水源全部冻结 · 白昼不足 10 小时',
    };
    for (const k in SEASONS) {
      const S = SEASONS[k];
      const c = el('div', 'season-card ' + k, `<div class="big">${S.name}</div><div class="sub">${S.full}</div><div class="skulls">${'☠'.repeat(S.danger)}${'·'.repeat(5 - S.danger)}</div><div class="muted">${S.desc}</div><div class="stats">${info[k]}</div>`);
      c.onclick = () => { this.g.audio.ui(); onPick(k); };
      list.appendChild(c);
    }
  }

  // ---------------- 商店 ----------------
  openShop(money, seasonKey, onGo) {
    this.shopSeason = seasonKey;
    this.cart = { backpack: null, items: {} };
    this.shopMoney = money;
    this.shopCat = 'pack';
    this.onShopGo = onGo;
    const cats = $('shop-cats'); cats.innerHTML = '';
    for (const c of CATEGORIES) {
      const d = el('div', c.id === this.shopCat ? 'on' : '', c.name);
      d.onclick = () => { this.shopCat = c.id; this.g.audio.ui(); this.renderShop(); };
      d.dataset.cat = c.id;
      cats.appendChild(d);
    }
    $('shop-rec').onclick = () => { this.g.audio.ui(); this.recommend(); };
    $('shop-clear').onclick = () => { this.g.audio.ui(); this.cart = { backpack: null, items: {} }; this.renderShop(); };
    $('shop-go').onclick = () => { if (this.shopValid()) { this.g.audio.ui(); onGo(this.cart, this.shopMoney - this.cartCost()); } };
    this.show('screen-shop');
    this.renderShop();
  }
  cartCost(c = this.cart) {
    let s = 0;
    if (c.backpack) s += BACKPACKS.find(b => b.id === c.backpack).price;
    for (const id in c.items) s += ITEMS[id].price * c.items[id];
    return s;
  }
  cartWeight(c = this.cart) {
    let w = 0;
    if (c.backpack) w += BACKPACKS.find(b => b.id === c.backpack).weight;
    for (const id in c.items) w += ITEMS[id].weight * c.items[id];
    w += (c.items.bottle || 0) * 1.0; // 装满水
    return w;
  }
  cartCap(c = this.cart) { return c.backpack ? BACKPACKS.find(b => b.id === c.backpack).cap : 0; }
  shopValid() { return this.cart.backpack && this.cartWeight() <= this.cartCap() + 1e-6 && this.cartCost() <= this.shopMoney; }

  recommend() {
    const c = { backpack: null, items: {} };
    let money = this.shopMoney;
    const reserve = Math.min(300, this.shopMoney * 0.04);
    let REC = RECOMMENDED.map(r => [...r]);
    const sk = this.shopSeason;
    const swap = (a, b) => { const r = REC.find(x => x[0] === a); if (r) r[0] = b; };
    const early = (id, n = 1) => { REC = REC.filter(x => x[0] !== id); REC.splice(14, 0, [id, n]); };
    if (sk === 'winter') {
      // 冬季：保命优先（羽绒、睡袋、炉子、食物），钱多再升级高山帐
      REC = [['pack', 'bp30'], ['shell', 1], ['down', 1], ['bagm10', 1], ['boots', 1], ['stove', 1], ['tent3', 1], ['pad', 1], ['fleece', 1], ['base', 1], ['hat', 1],
        ['bottle', 3], ['meal', 6], ['biscuit', 5], ['choco', 5], ['lamp', 1], ['cramp', 1], ['gas', 2], ['firstaid', 1], ['compass', 1], ['bar', 5],
        ['warmer', 2], ['blanket', 1], ['glasses', 1], ['poles', 1], ['map', 1], ['jerky', 2], ['diamox', 1], ['gas', 1], ['meal', 4], ['bandage', 1], ['gps', 1], ['power', 1]];
      if (this.shopMoney >= 8000) REC.splice(7, 0, ['tent4', 1]);
      if (this.shopMoney < 8000) setTimeout(() => this.g.msg && this.g.ui.modal('冬季装备很贵', '<p>冬季穿越需要羽绒服、-10℃ 睡袋、冰爪、炉具和大量燃气，¥' + this.shopMoney + ' 的预算只能勉强凑齐保命装备（没有四季帐）。</p><p class="muted">成功穿越一次后，下次的初始资金会增加，届时再挑战冬季会从容得多。</p>'), 50);
    }
    if (sk === 'spring') { early('cramp'); early('glasses'); }
    if (sk === 'summer') { early('deet'); early('gaiter'); }
    if (sk === 'autumn') { const b = REC.find(x => x[0] === 'bottle'); if (b) b[1] = 5; }
    for (const [id, n] of REC) {
      if (id === 'pack') {
        // 按预算选背包
        let bp = BACKPACKS.find(b => b.id === n);
        if (money < 4500) bp = BACKPACKS.find(b => b.id === 'bp20');
        c.backpack = bp.id; money -= bp.price; continue;
      }
      for (let k = 0; k < n; k++) {
        const it = ITEMS[id];
        if (it.price > money - (sk === 'winter' ? 20 : reserve)) break;
        const test = { backpack: c.backpack, items: { ...c.items, [id]: (c.items[id] || 0) + 1 } };
        if (this.cartWeight(test) > this.cartCap(test)) break;
        if (!it.stack && c.items[id]) break;
        c.items[id] = (c.items[id] || 0) + 1; money -= it.price;
      }
    }
    // 预算紧张时用便宜货替代
    if (!c.items.tent3 && !c.items.tent4 && money < 499) { /* 无帐篷 */ }
    if (!c.items.shell && money >= 15) { c.items.poncho = 1; money -= 15; }
    if (!c.items.bag0 && !c.items.bagm10 && money >= 149) { c.items.bag10 = 1; money -= 149; }
    // 剩余的钱买食物
    for (const id of ['noodle', 'biscuit', 'bar']) {
      while (money >= ITEMS[id].price && (c.items[id] || 0) < 8) {
        const test = { backpack: c.backpack, items: { ...c.items, [id]: (c.items[id] || 0) + 1 } };
        if (this.cartWeight(test) > this.cartCap(test) - 0.5) break;
        c.items[id] = (c.items[id] || 0) + 1; money -= ITEMS[id].price;
      }
    }
    this.cart = c;
    this.renderShop();
  }

  renderShop() {
    const c = this.cart;
    document.querySelectorAll('#shop-cats div').forEach(d => d.classList.toggle('on', d.dataset.cat === this.shopCat));
    const box = $('shop-items'); box.innerHTML = '';
    const left = this.shopMoney - this.cartCost();
    if (this.shopCat === 'pack') {
      for (const bp of BACKPACKS) {
        const own = c.backpack === bp.id;
        const card = el('div', 'card' + (own ? ' owned' : ''));
        card.innerHTML = `<div class="nm">${bp.name}</div><div class="meta"><span class="p">¥${bp.price}</span><span>自重 ${bp.weight}kg</span><span>承重 ${bp.cap}kg</span></div><div class="ds">${bp.desc}<br>背负效率：${bp.eff <= 0.85 ? '极佳' : bp.eff <= 0.92 ? '优秀' : bp.eff <= 1 ? '一般' : '较差'}</div>`;
        const ctl = el('div', 'ctl');
        const b = el('button', 'btn small' + (own ? ' danger' : ''), own ? '已选择' : '选择');
        b.disabled = !own && bp.price - (c.backpack ? BACKPACKS.find(x => x.id === c.backpack).price : 0) > left;
        b.onclick = () => { this.g.audio.buy(); c.backpack = own ? null : bp.id; this.renderShop(); };
        ctl.appendChild(b); card.appendChild(ctl); box.appendChild(card);
      }
    } else {
      for (const id in ITEMS) {
        const it = ITEMS[id];
        if (it.cat !== this.shopCat) continue;
        const q = c.items[id] || 0;
        const card = el('div', 'card' + (q ? ' owned' : ''));
        const uses = ITEM_USES[id] && ITEM_USES[id] > 1 ? `<span>${ITEM_USES[id]}次</span>` : '';
        card.innerHTML = `<div class="nm">${it.name}</div><div class="meta"><span class="p">¥${it.price}</span><span>${it.weight}kg</span>${it.kcal ? `<span>${it.kcal}kcal</span>` : ''}${uses}</div><div class="ds">${it.desc}</div>`;
        const ctl = el('div', 'ctl');
        if (it.stack) {
          const minus = el('button', 'btn small', '−'); minus.disabled = q <= 0;
          const plus = el('button', 'btn small', '+'); plus.disabled = it.price > left || q >= (it.max || 99);
          const qq = el('span', 'q', String(q));
          minus.onclick = () => { this.g.audio.ui(); c.items[id]--; if (!c.items[id]) delete c.items[id]; this.renderShop(); };
          plus.onclick = () => { this.g.audio.buy(); c.items[id] = q + 1; this.renderShop(); };
          ctl.append(minus, qq, plus);
        } else {
          const b = el('button', 'btn small' + (q ? ' danger' : ''), q ? '移除' : '购买');
          b.disabled = !q && it.price > left;
          b.onclick = () => { this.g.audio.buy(); if (q) delete c.items[id]; else c.items[id] = 1; this.renderShop(); };
          ctl.appendChild(b);
        }
        card.appendChild(ctl); box.appendChild(card);
      }
    }
    // 侧栏
    $('shop-money').textContent = '¥ ' + left;
    const w = this.cartWeight(), cap = this.cartCap();
    const pct = cap ? clamp(w / cap, 0, 1) : (w > 0 ? 1 : 0);
    $('shop-wfill').style.width = (pct * 100) + '%';
    $('shop-wfill').style.background = !cap || w > cap ? 'var(--red)' : pct > 0.85 ? 'var(--orange)' : 'var(--green)';
    $('shop-wtext').innerHTML = `装满水后 <b>${fmt(w)}</b> / ${cap || '—'} kg（含水 ${(c.items.bottle || 0)} L）`;
    let kcal = 0; for (const id in c.items) if (ITEMS[id].kcal) kcal += ITEMS[id].kcal * c.items[id];
    $('shop-est').innerHTML = `食物总热量 <b>${kcal}</b> kcal ≈ ${fmt(kcal / 2700)} 天<br>携水 <b>${c.items.bottle || 0}</b> L · 穿越预计 4–6 天`;
    const list = $('shop-list'); list.innerHTML = '';
    if (c.backpack) { const bp = BACKPACKS.find(b => b.id === c.backpack); list.appendChild(el('div', '', `<span>${bp.name}</span><span>¥${bp.price}</span>`)); }
    for (const id in c.items) list.appendChild(el('div', '', `<span>${ITEMS[id].name}${c.items[id] > 1 ? ' ×' + c.items[id] : ''}</span><span>¥${ITEMS[id].price * c.items[id]}</span>`));
    const warn = $('shop-warn'); warn.innerHTML = '';
    const W = (t, ok) => warn.appendChild(el('div', ok ? 'ok' : '', (ok ? '✓ ' : '⚠ ') + t));
    if (!c.backpack) W('必须选择一个背包');
    else if (w > cap) W(`超重 ${fmt(w - cap)} kg！减少物资或换更大的背包`);
    const I = c.items;
    if (!I.tent3 && !I.tent4) W('没有帐篷：在主脊上露宿几乎等于送命');
    if (!I.bag10 && !I.bag0 && !I.bagm10) W('没有睡袋：夜里的低温会要了你的命');
    if (!I.shell) W(I.poncho ? '只有一次性雨衣：大风中会被撕碎' : '没有冲锋衣：一场冷雨就可能让你失温');
    if ((I.bottle || 0) < 3) W('携水量少于 3L：主脊上可能连续十几公里无水');
    if (kcal < 10000) W('食物热量不足 10000 kcal');
    if (!I.lamp) W('没有头灯：天黑后寸步难行');
    if (!I.gps && !I.app) W('没有 GPS 或手机轨迹：没有路引和小地图，看不到下一站在哪、还有多远');
    if (!I.compass && !I.gps && !I.app) W('没有指北针：大雾中会彻底失去方向，走偏就可能坠崖');
    if (!I.map) W('没有纸质地图：无法查看全线路线和水源');
    if (!I.firstaid) W('没有急救包：受伤出血将无法处理');
    if (!I.stove) W('没有炉具：无法吃热食、烧开生水、融雪取水');
    if (!I.boots) W('没有登山鞋：在石海中极易崴脚');
    if (!I.poles) W('没有登山杖：石海、湿滑岩面和大风中都更容易摔倒');
    const sk = this.shopSeason;
    if (sk === 'winter') {
      if (!I.bagm10) W('冬季：没有 -10℃ 高山睡袋，夜里会被活活冻死');
      if (!I.tent4) W('冬季：三季帐篷扛不住白毛风');
      if (!I.cramp) W('冬季：没有冰爪，冰雪坡寸步难行');
      if (!I.down) W('冬季：没有羽绒服几乎等于自杀');
      if (!I.stove) W('冬季：水源全部冻结，没有炉子就没有水！');
      if ((I.gas || 0) < 2) W('冬季：融雪取水非常耗气，建议多带气罐');
    } else if (sk === 'spring') {
      if (!I.cramp) W('春季：主脊积雪结冰，建议带冰爪');
      if (!I.bag0 && !I.bagm10) W('春季：夜间零下，需要 0℃ 以下的睡袋');
    } else if (sk === 'summer') {
      if (!I.deet) W('夏季：蜱虫和蚊虫最活跃，建议带驱虫喷雾');
    } else if (sk === 'autumn') {
      if ((I.bottle || 0) < 4) W('秋季：旱季水源大多干涸，至少带 4L 水');
    }
    if (!I.glasses && (sk === 'winter' || sk === 'spring')) W('积雪季节：没有太阳镜容易雪盲');
    if (this.shopValid() && warn.children.length === 0) W('装备齐全。祝你好运。', true);
    $('shop-go').disabled = !this.shopValid();
  }

  // ---------------- HUD ----------------
  buildBars() {
    const defs = [
      ['health', '生命', '#e0483c'], ['stamina', '体力', '#e8e2c8'], ['energy', '精力', '#a98ad8'], ['satiety', '饱食', '#e8913a'],
      ['hydration', '水分', '#5aa0e0'], ['core', '体温', '#6fbf73'], ['mental', '精神', '#4fc0b0'], ['altSick', '高反', '#d05ab0'], ['wet', '潮湿', '#7fb0d0'],
    ];
    const box = $('bars'); box.innerHTML = '';
    this.bars = {};
    for (const [k, n, c] of defs) {
      const b = el('div', 'bar', `<span class="lb">${n}</span><div class="tr"><div class="gh"></div><div class="fl" style="background:${c}"></div></div><span class="vl"></span>`);
      box.appendChild(b);
      this.bars[k] = { el: b, fl: b.querySelector('.fl'), gh: b.querySelector('.gh'), vl: b.querySelector('.vl'), color: c };
    }
  }
  buildCompass() {
    const s = $('compass-strip'); s.innerHTML = '';
    this.compassSpans = [];
    const names = { 0: '北', 45: '东北', 90: '东', 135: '东南', 180: '南', 225: '西南', 270: '西', 315: '西北' };
    for (let d = 0; d < 360; d += 15) {
      const sp = el('span', names[d] !== undefined ? 'c' + (d === 0 ? ' n' : '') : '', names[d] !== undefined ? names[d] : String(d));
      s.appendChild(sp); this.compassSpans.push([d, sp]);
    }
    this.wpSpan = el('span', 'wp', '▼'); s.appendChild(this.wpSpan);
  }
  buildProgress() {
    const p = $('progress'); p.innerHTML = '<div class="line"></div><div class="done"></div>';
    this.dots = [];
    ROUTE.forEach((w, i) => {
      const d = el('div', 'dot' + (w.minor ? ' minor' : ''));
      d.style.left = (w.x / ROUTE_LENGTH * 100) + '%';
      d.title = w.name;
      p.appendChild(d); this.dots.push(d);
    });
    this.meArrow = el('div', 'me'); p.appendChild(this.meArrow);
  }

  updateHUD(g) {
    const s = g.surv, inv = g.inv;
    const day = Math.floor(g.gameMin / 1440) + 1, hm = g.gameMin % 1440;
    const hh = String(Math.floor(hm / 60)).padStart(2, '0'), mm = String(Math.floor(hm % 60)).padStart(2, '0');
    $('hud-time').textContent = `第 ${day} 天  ${hh}:${mm}`;
    const W = g.wxLabel();
    const dirs =['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
    const wdir = g.windDirLocal || g.weather.windDir;
    const wa = Math.atan2(-wdir.y, -wdir.x); // 风来向
    const bearing = ((Math.atan2(Math.cos(wa), -Math.sin(wa)) * 180 / Math.PI) + 360) % 360;
    const wname = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(bearing / 45) % 8];
    $('hud-wx').innerHTML = `${W.icon} ${W.name}${W.ridge ? `<span style="opacity:.65">（主脊 ${W.ridge}）</span>` : ''} · 气温 <b>${fmt(g.airTemp, 0)}℃</b> · 体感 ${fmt(s.teff, 0)}℃ · ${wname}风 <b>${Math.round(g.windLocal)}</b> 级`;
    $('hud-alt').innerHTML = `海拔 <b>${Math.round(g.altitude)}</b> m${g.shelterNow ? ' · <span style="color:#6fbf73">避风处</span>' : ''}${g.lost ? ' · <span style="color:#e0483c">偏离路线</span>' : ''}`;
    const next = ROUTE[Math.min(g.reached + 1, ROUTE.length - 1)];
    const nav = g.navDevice();
    const hasGPS = nav === 'gps';
    const GP = g.gpsPos;
    const lateral = Math.abs(GP.z - routeZ(GP.x));
    const along = routeDist(Math.max(GP.x, 0), next.x) + Math.max(0, lateral - 10) + (GP.x < 0 ? -GP.x : 0);
    const nz = routeZ(next.x);
    const bearTo = Math.atan2(next.x - GP.x, -(nz - GP.z));
    const camB = Math.atan2(Math.cos(g.player.camYaw), -Math.sin(g.player.camYaw));
    let rel = ((bearTo - camB) * 180 / Math.PI + 540) % 360 - 180;
    const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    const arrow = arrows[((Math.round(rel / 45) % 8) + 8) % 8];
    const dAlt = next.alt - Math.round(g.altitude);
    this.navAlong = along;
    $('hud-next').innerHTML = g.reached >= ROUTE.length - 1 ? '已抵达终点' : nav
      ? `下一站：${next.name} · <span class="dir">${arrow}</span> ${hasGPS ? '' : '约 '}${fmtDist(along)} · ${dAlt >= 0 ? '↑' : '↓'}${Math.abs(dAlt)} m`
      : `下一站：${next.name}${inv.has('map') ? ' <span class="muted">（无路引，对照地图）</span>' : ' <span class="muted">（无路引）</span>'}`;
    if (nav) this.updateWaypointMarker(g, next, along, hasGPS); else $('wpmark').style.display = 'none';

    // 指标条
    const setBar = (k, v, max, txt, low) => {
      const b = this.bars[k];
      b.fl.style.width = clamp(v / max * 100, 0, 100) + '%';
      b.vl.textContent = txt;
      b.el.classList.toggle('low', !!low);
    };
    setBar('health', s.health, 100, Math.round(s.health), s.health < 25);
    const ms = s.maxStamina();
    setBar('stamina', s.stamina, 100, Math.round(s.stamina), s.exhausted);
    this.bars.stamina.gh.style.left = ms + '%'; this.bars.stamina.gh.style.right = '0';
    this.bars.stamina.gh.style.width = (100 - ms) + '%';
    setBar('energy', s.energy, 100, Math.round(s.energy), s.energy < 15);
    setBar('satiety', s.satiety, 100, Math.round(s.satiety), s.satiety < 15);
    setBar('hydration', s.hydration, 100, Math.round(s.hydration), s.hydration < 15);
    setBar('core', s.core - 30, 9, fmt(s.core) + '℃', s.core < 35 || s.core > 38.5);
    this.bars.core.fl.style.background = s.core < 34 ? '#5aa0e0' : s.core < 35.5 ? '#8fc8e8' : s.core > 38 ? '#e8913a' : '#6fbf73';
    setBar('mental', s.mental, 100, Math.round(s.mental), s.mental < 20);
    setBar('altSick', s.altSick, 100, Math.round(s.altSick), s.altSick > 60);
    this.bars.altSick.el.style.display = s.altSick > 1 || g.altitude > 2800 ? '' : 'none';
    setBar('wet', s.wet, 100, Math.round(s.wet), s.wet > 70);

    // 状态标签
    const chips = $('chips');
    const labels = s.labels();
    const key = labels.map(l => l[0] + l[1]).join('|');
    if (key !== this.chipKey) {
      this.chipKey = key;
      chips.innerHTML = '';
      for (const [n, cls] of labels) chips.appendChild(el('span', cls, n));
    }

    // 负重
    const w = inv.weight(), cap = inv.backpack.cap;
    const gps = (inv.has('gps') ? ` · GPS ${Math.round(inv.battery.gps)}%` : '') + (inv.has('app') ? ` · 手机 ${Math.round(inv.battery.phone)}%` : '');
    const lamp = inv.has('lamp') ? ` · 头灯 ${Math.round(inv.battery.lamp)}%${g.lampOn ? '（开）' : ''}` : '';
    const poles = inv.has('poles') ? ` · 登山杖<b>${g.player.polesOut ? '展开' : '收起'}</b>` : '';
    $('load').innerHTML = `姿态 <span id="stance">${g.stanceLabel || '慢走'}</span>${poles}<br>负重 <b>${fmt(w)}</b> / ${cap} kg · 饮水 <b>${fmt(inv.water, 2)}</b> / ${fmt(inv.waterCap, 0)} L<br><span class="muted">资金 ¥${inv.money}${gps}${lamp}</span>`;

    // 指南针：需要指北针或导航设备
    const hasCompass = inv.has('compass') || !!nav;
    $('compass').style.visibility = hasCompass ? 'visible' : 'hidden';
    if (hasCompass) {
      const f = g.player.camYaw + g.navJitter;
      const head = ((Math.atan2(Math.cos(f), -Math.sin(f)) * 180 / Math.PI) + 360) % 360;
      const wpx = $('compass').clientWidth / 2;
      for (const [d, sp] of this.compassSpans) {
        let diff = ((d - head + 540) % 360) - 180;
        sp.style.left = (wpx + diff * 4) + 'px';
        sp.style.display = Math.abs(diff) > 95 ? 'none' : '';
      }
      if (nav && g.reached < ROUTE.length - 1) {
        const dx = next.x - g.gpsPos.x, dz = routeZ(next.x) - g.gpsPos.z;
        const b = ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;
        let diff = ((b - head + 540) % 360) - 180;
        this.wpSpan.style.left = (wpx + clamp(diff, -90, 90) * 4) + 'px';
        this.wpSpan.style.display = '';
      } else this.wpSpan.style.display = 'none';
    }
    // 进度
    const prog = clamp(g.player.pos.x / ROUTE_LENGTH, 0, 1);
    $('progress').querySelector('.done').style.width = (ROUTE[g.reached].x / ROUTE_LENGTH * 100) + '%';
    this.meArrow.style.left = (prog * 100) + '%';
    this.dots.forEach((d, i) => d.classList.toggle('on', i <= g.reached));

    // 小地图：需要 GPS 或手机轨迹，按 G 开关
    const mm2 = $('hud-tr');
    const showMini = !!nav && g.gpsOn;
    mm2.style.display = showMini ? '' : 'none';
    if (showMini) this.drawMinimap(g);
  }

  // 屏幕路引：下一站在画面中的位置
  updateWaypointMarker(g, next, along, hasGPS) {
    const m = $('wpmark');
    if (g.reached >= ROUTE.length - 1) { m.style.display = 'none'; return; }
    m.style.display = '';
    const cam = g.camera;
    const off = g.gpsPos.clone().sub(g.player.pos);
    _v.set(next.x - off.x, altToY(next.alt) + 7, routeZ(next.x) - off.z);
    _v.project(cam);
    const W = window.innerWidth, H = window.innerHeight;
    let behind = _v.z > 1;
    let sx = _v.x, sy = _v.y;
    if (behind) { sx = -sx; sy = -sy; }
    const margin = 0.88;
    let edge = behind || Math.abs(sx) > margin || Math.abs(sy) > margin;
    if (edge) {
      const k = margin / Math.max(Math.abs(sx), Math.abs(sy), 1e-3);
      if (behind && Math.abs(sx) < 0.2) sx = sx < 0 ? -0.2 : 0.2;
      sx *= k; sy *= k;
      if (behind) sy = Math.min(sy, -0.2);
      sx = Math.max(-margin, Math.min(margin, sx));
    }
    sy = Math.max(-0.7, Math.min(0.72, sy)); // 避开顶部指南针和底部状态栏
    if (Math.abs(sy) >= 0.72) edge = true;
    const px = (sx * 0.5 + 0.5) * W, py = (-sy * 0.5 + 0.5) * H;
    m.style.left = px + 'px'; m.style.top = py + 'px';
    m.classList.toggle('edge', edge);
    if (edge) m.querySelector('.wp-arrow').style.transform = `rotate(${Math.atan2(-sy, sx)}rad)`;
    m.querySelector('.wp-name').textContent = next.name;
    m.querySelector('.wp-dist').textContent = (hasGPS ? '' : '约 ') + fmtDist(along);
    m.style.opacity = g.fogK > 0.6 && !hasGPS ? 0.55 : 1;
  }

  drawMinimap(g) {
    const c = $('minimap'), x = c.getContext('2d');
    const W = c.width, R = W / 2, scale = R / 160;
    const P = g.gpsPos;
    x.clearRect(0, 0, W, W);
    x.save();
    x.beginPath(); x.arc(R, R, R - 2, 0, Math.PI * 2); x.clip();
    x.fillStyle = 'rgba(12,18,14,0.6)'; x.fillRect(0, 0, W, W);
    const yaw = g.player.camYaw;
    x.translate(R, R);
    x.rotate(-yaw - Math.PI / 2);
    // 路线
    x.strokeStyle = 'rgba(216,180,106,0.85)'; x.lineWidth = 3; x.setLineDash([6, 4]);
    x.beginPath();
    for (let wx = P.x - 220; wx <= P.x + 220; wx += 6) {
      const px = (wx - P.x) * scale, pz = (routeZ(wx) - P.z) * scale;
      wx === P.x - 220 ? x.moveTo(px, pz) : x.lineTo(px, pz);
    }
    x.stroke(); x.setLineDash([]);
    // 轨迹
    x.strokeStyle = 'rgba(120,200,255,0.7)'; x.lineWidth = 2; x.beginPath();
    g.track.forEach((t, i) => { const px = (t[0] - P.x) * scale, pz = (t[1] - P.z) * scale; i ? x.lineTo(px, pz) : x.moveTo(px, pz); });
    x.stroke();
    // 地标
    for (const w of ROUTE) {
      const px = (w.x - P.x) * scale, pz = (routeZ(w.x) - P.z) * scale;
      if (Math.abs(px) > R * 1.5 || Math.abs(pz) > R * 1.5) continue;
      const isNext = w === ROUTE[Math.min(g.reached + 1, ROUTE.length - 1)];
      x.fillStyle = w.minor ? '#aaa' : '#f0d48a';
      x.beginPath(); x.arc(px, pz, w.minor ? 3 : 5, 0, Math.PI * 2); x.fill();
      if (isNext) { x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(px, pz, 9 + Math.sin(g.time * 4) * 2, 0, Math.PI * 2); x.stroke(); }
      x.save(); x.translate(px, pz); x.rotate(yaw + Math.PI / 2); x.fillStyle = '#fff'; x.font = '12px sans-serif'; x.textAlign = 'center'; x.fillText(w.name, 0, -9); x.restore();
    }
    x.restore();
    // 玩家
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(R, R - 9); x.lineTo(R - 6, R + 7); x.lineTo(R, R + 3); x.lineTo(R + 6, R + 7); x.closePath(); x.fill();
    const dev = g.navDevice();
    $('minimap-note').textContent = dev === 'gps' ? (g.fogK > 0.5 ? 'GPS 信号漂移中' : 'GPS 定位') : (g.fogK > 0.4 ? '手机定位漂移严重' : '手机定位');
    // 路线外的标识
    x.fillStyle = 'rgba(255,255,255,0.7)'; x.font = '11px sans-serif'; x.textAlign = 'center';
  }

  // ---------------- 背包 ----------------
  openInventory() { this.show('screen-inv'); this.renderInventory(); }
  renderInventory() {
    const g = this.g, s = g.surv, inv = g.inv;
    const st = $('inv-stats');
    const th = s.thermal(g.envNow || {});
    const row = (a, b) => `<div class="st"><span>${a}</span><span>${b}</span></div>`;
    let html = `<h4>身体状况</h4>`;
    html += row('生命', Math.round(s.health) + ' / 100' + (s.health >= 99.5 ? '' : s.regen > 0 ? ` <span style="color:#7fc77a">恢复中 +${fmt(s.regen, 1)}/小时</span>` : s.noRegen ? ` <span style="color:#e8913a">不恢复（${s.noRegen}）</span>` : ''));
    html += row('体力', `${Math.round(s.stamina)}（上限 ${Math.round(s.maxStamina())}）`);
    html += row('精力 / 疲劳', Math.round(s.energy) + ' / 100');
    html += row('饱食度', `${Math.round(s.satiety)}（约 ${Math.round(s.satiety * 20)} kcal 储备）`);
    html += row('水分', `${Math.round(s.hydration)}（缺水 ${fmt((100 - s.hydration) * 0.025, 2)} L）`);
    html += row('核心体温', fmt(s.core, 1) + ' ℃');
    html += row('热平衡', (s.balance >= 0 ? '+' : '') + fmt(s.balance, 1) + (s.balance < -2 ? ' <span style="color:#5aa0e0">正在失温</span>' : s.balance < 0 ? ' <span style="color:#8fc8e8">偏冷（手脚发凉，身体尚能维持）</span>' : s.balance > 14 ? ' <span style="color:#e8913a">出汗</span>' : ' 稳定'));
    { const hp = s.heatParts || {}, sg = v => (v >= 0 ? '+' : '') + fmt(v, 1), parts = [];
      if (hp.act) parts.push('活动 ' + sg(hp.act));
      if (hp.food > 0.05) parts.push('消化 ' + sg(hp.food));
      if (Math.abs(hp.fed) > 0.05) parts.push((hp.fed > 0 ? '吃饱 ' : '饥饿 ') + sg(hp.fed));
      if (hp.shiver) parts.push('寒战 ' + sg(hp.shiver));
      if (hp.gear) parts.push('暖宝宝 / 热食 ' + sg(hp.gear));
      html += row('产热', parts.length ? parts.join(' · ') : '只有基础代谢'); }
    html += row('体感温度', fmt(s.teff, 0) + ' ℃');
    html += row('衣物保暖值', fmt(th.insul || inv.insulation(), 1));
    html += row('防风 / 防水', `${Math.round((s.windBlock || 0) * 100)}% / ${Math.round((s.rainBlock || 0) * 100)}%`);
    html += row('潮湿度', Math.round(s.wet) + '%');
    html += row('精神', Math.round(s.mental) + ' / 100');
    html += row('高反', Math.round(s.altSick) + '（适应度 ' + Math.round(s.acclim / 0.6 * 100) + '%）');
    html += row('负重', `${fmt(inv.weight())} / ${inv.backpack.cap} kg（${inv.backpack.name}）`);
    html += row('饮水', `${fmt(inv.water, 2)} / ${fmt(inv.waterCap, 0)} L${inv.waterRaw > 0.01 ? `（其中 ${fmt(inv.waterRaw, 2)}L 未处理生水）` : ''}${inv.has('thermos') ? `；保温壶 ${fmt(inv.flask, 2)} L${inv.flask >= 0.02 ? ` ${Math.round(inv.flaskT)}℃` : ''}` : ''}`);
    { const gl = inv.gasLeft(); html += row('燃气', inv.has('stove') ? `${fmt(gl / 6, 1)} 罐（约能融 ${Math.floor(gl + 1e-6)} 锅雪，或烧 ${Math.floor(gl / 0.1 + 1e-6)} 杯热水）` : '无炉具'); }
    html += `<h4>伤病与状态</h4>`;
    const labels = s.labels();
    if (!labels.length) html += `<div class="tip">无</div>`;
    for (const [n, cls, d] of labels) html += `<div class="st"><span style="color:${cls === 'good' ? '#6fbf73' : cls === 'warn' ? '#e8913a' : '#ff8a7a'}">${n}</span><span class="tip">${d || ''}</span></div>`;
    html += `<div class="row-btns" style="justify-content:flex-start"><button class="btn small" id="inv-check">检查身体（蜱虫）</button>${inv.has('sat') ? '<button class="btn small danger" id="inv-sos">发送 SOS 求救</button>' : ''}</div>`;
    html += `<div class="tip" style="margin-top:10px">提示：行进时热平衡 > 14 会大量出汗，衣服被汗湿后一停下来就会迅速失温。爬坡时减衣，休息/山脊上加衣。</div>`;
    st.innerHTML = html;
    $('inv-check').onclick = () => { g.checkBody(); this.renderInventory(); };
    if ($('inv-sos')) $('inv-sos').onclick = () => g.sendSOS();

    const box = $('inv-items'); box.innerHTML = '';
    const sec = (t) => box.appendChild(el('div', 'sec', t));
    const card = (id, extra, buttons) => {
      const it = ITEMS[id];
      const q = inv.items[id];
      const worn = inv.worn.has(id);
      const c = el('div', 'card' + (worn ? ' worn' : ''));
      const uses = ITEM_USES[id] && inv.uses[id] !== undefined && ITEM_USES[id] > 1 ? ` · 剩 ${inv.uses[id]} 次` : '';
      c.innerHTML = `<div class="nm">${it.name}${q > 1 ? ' ×' + q : ''}${worn ? ' <span style="color:#6fbf73;font-size:12px">（穿着）</span>' : ''}</div><div class="meta"><span>${fmt(it.weight * q, 2)}kg${uses}</span>${extra || ''}</div><div class="ds">${it.desc}</div>`;
      const ctl = el('div', 'ctl');
      for (const [label, fn, dis] of buttons) { const b = el('button', 'btn small', label); b.disabled = !!dis; b.onclick = () => { fn(); this.renderInventory(); g.ui.updateHUD(g); }; ctl.appendChild(b); }
      const drop = el('button', 'btn small ghost', '丢弃');
      drop.onclick = () => { g.dropItem(id); this.renderInventory(); };
      ctl.appendChild(drop);
      c.appendChild(ctl); box.appendChild(c);
    };
    // 水
    sec('饮水');
    {
      const c = el('div', 'card');
      c.innerHTML = `<div class="nm">饮用水 ${fmt(inv.water, 2)} L</div><div class="meta"><span>容量 ${fmt(inv.waterCap, 0)} L</span></div><div class="ds">${inv.waterRaw > 0.01 ? '含有未处理的生水，喝了可能腹泻。可用净水片或烧开处理。' : '已处理的饮用水。'}</div>`;
      const ctl = el('div', 'ctl');
      const add = (l, fn, dis) => { const b = el('button', 'btn small', l); b.disabled = !!dis; b.onclick = () => { fn(); this.renderInventory(); }; ctl.appendChild(b); };
      add('喝一口 (0.25L)', () => g.drink(0.25), inv.water < 0.05);
      add('痛饮 (0.5L)', () => g.drink(0.5), inv.water < 0.05);
      if (inv.has('tablet')) add('净水片处理', () => g.purify(), inv.waterRaw < 0.01);
      if (inv.has('stove')) add('烧开生水', () => g.boilWater(), inv.waterRaw < 0.01 || inv.gasLeft() <= 0);
      if (inv.has('stove')) add('喝热水暖身', () => g.hotDrink(), inv.water < 0.3 || inv.gasLeft() <= 0);
      if (inv.has('stove') && (g.snowLocal || 0) > 0.25) add('融雪取水', () => g.meltSnow(), inv.gasLeft() <= 0 || inv.water >= inv.waterCap);
      if (g.fieldWater().any) add('就地取水…', () => { this.hide('screen-inv'); g.fieldWaterMenu(); }, inv.water >= inv.waterCap - 0.05);
      c.appendChild(ctl); box.appendChild(c);
    }
    if (inv.has('thermos')) {
      const c = el('div', 'card'), T = inv.flaskT;
      const feel = inv.flask < 0.02 ? '空的。' : T >= 65 ? '还很烫，能直接泡热食。' : T >= 48 ? '热乎乎的，喝着正好。' : T >= 33 ? '已经只是温水了。' : '已经凉透了。';
      c.innerHTML = `<div class="nm">保温壶 ${fmt(inv.flask, 2)} L${inv.flask >= 0.02 ? ` · 约 ${Math.round(T)}℃` : ''}</div><div class="meta"><span>容量 1 L</span></div><div class="ds">${feel}</div>`;
      const ctl = el('div', 'ctl');
      const add = (l, fn, dis) => { const b = el('button', 'btn small', l); b.disabled = !!dis; b.onclick = () => { fn(); this.renderInventory(); }; ctl.appendChild(b); };
      add('喝一口 (0.25L)', () => g.flaskDrink(0.25), inv.flask < 0.02);
      if (inv.has('stove')) add('烧开水灌满', () => g.fillFlask(), inv.gasLeft() <= 0 || inv.water < 0.05 || inv.flask > inv.flaskCap - 0.05);
      c.appendChild(ctl); box.appendChild(c);
    }
    const ids = Object.keys(inv.items);
    const cats = { cloth: '衣物（穿着时计入保暖）', food: '食物', med: '药品急救', cook: '炊具', nav: '导航通讯', gear: '技术装备', shelter: '宿营' };
    for (const cat in cats) {
      const list = ids.filter(id => ITEMS[id] && ITEMS[id].cat === cat);
      if (!list.length) continue;
      sec(cats[cat]);
      for (const id of list) {
        const it = ITEMS[id];
        const btns = [];
        if (it.wear) btns.push([inv.worn.has(id) ? '脱下' : '穿上', () => g.toggleWear(id)]);
        if (it.kcal) {
          btns.push(['吃', () => g.eat(id, false)]);
          if (it.hot && inv.has('stove')) btns.push(['热着吃', () => g.eat(id, true), inv.gasLeft() <= 0 || inv.water < 0.3]);
          if (it.hot && inv.has('thermos')) btns.push(['保温壶热水泡', () => g.eat(id, 'flask'), inv.flask < 0.3 || inv.flaskT < 65]);
        }
        if (id === 'elec') btns.push(['冲一杯', () => g.useItem(id), inv.water < 0.4]);
        if (['firstaid', 'bandage', 'ibu', 'diamox', 'smecta', 'warmer', 'blanket', 'power', 'deet'].includes(id) && id !== 'deet') btns.push(['使用', () => g.useItem(id)]);
        if (id === 'spray') btns.push(['喷射', () => g.useSpray()]);
        if (id === 'basin') btns.push(['烧水泡脚…', () => { this.hide('screen-inv'); g.footSoakMenu(); }]);
        if (id === 'sat') btns.push(['发送 SOS', () => g.sendSOS()]);
        card(id, it.kcal ? `<span>${it.kcal}kcal</span>` : '', btns);
      }
    }
  }

  // ---------------- 地图 ----------------
  openMap() {
    const g = this.g, inv = g.inv;
    const hasMap = inv.has('map') || !!g.navDevice();
    const hasGPS = !!g.navDevice();
    $('map-note').textContent = hasGPS ? '已定位（大雾中可能漂移）' : '纸质地形图 · 不显示你的位置';
    this.show('screen-map');
    const c = $('bigmap'), x = c.getContext('2d');
    const W = c.width, H = c.height;
    x.clearRect(0, 0, W, H);
    let minZ = 1e9, maxZ = -1e9;
    for (let wx = 0; wx <= ROUTE_LENGTH; wx += 20) { const z = routeZ(wx); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const pad = 50;
    const sx = (W - pad * 2) / ROUTE_LENGTH;
    const sz = Math.min(sx * 1.6, (H - 140) / (maxZ - minZ));
    const mz = (minZ + maxZ) / 2;
    const tx = (wx) => pad + wx * sx, tz = (z) => H / 2 + (z - mz) * sz;
    // 背景等高线感
    x.strokeStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 30; i++) { x.beginPath(); x.moveTo(0, i * 14); x.bezierCurveTo(W * 0.3, i * 14 + 10, W * 0.6, i * 14 - 10, W, i * 14); x.stroke(); }
    if (hasMap) {
      x.strokeStyle = '#d8b46a'; x.lineWidth = 2.5; x.setLineDash([8, 5]);
      x.beginPath();
      for (let wx = 0; wx <= ROUTE_LENGTH; wx += 10) { const px = tx(wx), pz = tz(routeZ(wx)); wx ? x.lineTo(px, pz) : x.moveTo(px, pz); }
      x.stroke(); x.setLineDash([]);
    }
    ROUTE.forEach((w, i) => {
      const known = hasMap || i <= g.reached;
      if (!known) return;
      const px = tx(w.x), pz = tz(routeZ(w.x));
      x.fillStyle = i <= g.reached ? '#d8b46a' : '#888';
      x.beginPath(); x.arc(px, pz, w.minor ? 3 : 6, 0, 7); x.fill();
      if (!w.minor) {
        x.fillStyle = '#eee'; x.font = '13px "PingFang SC", sans-serif'; x.textAlign = 'center';
        x.fillText(w.name, px, pz + (i % 2 ? 22 : -12));
        x.fillStyle = '#999'; x.font = '11px sans-serif'; x.fillText(w.alt + 'm', px, pz + (i % 2 ? 36 : -26));
      }
      if (w.water !== undefined && !w.safe && inv.has('map')) { x.fillStyle = '#5aa0e0'; x.fillText('💧', px + 10, pz + 4); }
    });
    if (hasGPS) {
      x.strokeStyle = 'rgba(120,200,255,0.8)'; x.lineWidth = 2; x.beginPath();
      g.trackAll.forEach((t, i) => { const px = tx(t[0]), pz = tz(t[1]); i ? x.lineTo(px, pz) : x.moveTo(px, pz); }); x.stroke();
      const px = tx(g.gpsPos.x), pz = tz(g.gpsPos.z);
      x.fillStyle = '#fff'; x.beginPath(); x.arc(px, pz, 6, 0, 7); x.fill();
      x.strokeStyle = '#e0483c'; x.lineWidth = 2; x.beginPath(); x.arc(px, pz, 11, 0, 7); x.stroke();
    }
    x.fillStyle = '#888'; x.font = '12px sans-serif'; x.textAlign = 'left'; x.fillText('西', 12, H / 2); x.textAlign = 'right'; x.fillText('东', W - 12, H / 2);
    x.textAlign = 'center'; x.fillText('北', W / 2, 16);
    // 海拔剖面
    const p = $('profile'), y = p.getContext('2d');
    const PW = p.width, PH = p.height;
    y.clearRect(0, 0, PW, PH);
    const ay = (alt) => PH - 20 - (alt - 900) / (3900 - 900) * (PH - 40);
    if (hasMap) {
      y.beginPath(); y.moveTo(tx(0), PH);
      for (let wx = 0; wx <= ROUTE_LENGTH; wx += 15) y.lineTo(tx(wx), ay(yToAlt(g.profileAt(wx))));
      y.lineTo(tx(ROUTE_LENGTH), PH); y.closePath();
      const grd = y.createLinearGradient(0, 0, 0, PH); grd.addColorStop(0, 'rgba(216,180,106,0.5)'); grd.addColorStop(1, 'rgba(216,180,106,0.05)');
      y.fillStyle = grd; y.fill();
      y.strokeStyle = 'rgba(255,255,255,0.15)'; y.setLineDash([3, 4]);
      for (const a of [1500, 2500, 3500]) { y.beginPath(); y.moveTo(0, ay(a)); y.lineTo(PW, ay(a)); y.stroke(); y.fillStyle = '#777'; y.font = '10px sans-serif'; y.textAlign = 'left'; y.fillText(a + 'm', 4, ay(a) - 3); }
      y.setLineDash([]);
      ROUTE.forEach((w) => { if (w.minor) return; y.fillStyle = '#ccc'; y.font = '10px sans-serif'; y.textAlign = 'center'; y.fillText(w.name.replace(/（.*）/, ''), tx(w.x), ay(w.alt) - 6); });
    }
    if (hasGPS) {
      const px = tx(g.gpsPos.x);
      y.strokeStyle = '#e0483c'; y.lineWidth = 2; y.beginPath(); y.moveTo(px, 0); y.lineTo(px, PH); y.stroke();
    }
  }

  // ---------------- 结局 ----------------
  showEnd({ kicker, title, cause, color, stats, text, buttons }) {
    $('end-kicker').textContent = kicker;
    $('end-title').textContent = title;
    $('end-title').style.color = color || '#fff';
    $('end-cause').textContent = cause || '';
    $('end-stats').innerHTML = stats.map(([a, b]) => `<div>${a}<span>${b}</span></div>`).join('');
    $('end-text').innerHTML = text;
    const bb = $('end-btns'); bb.innerHTML = '';
    for (const b of buttons) { const e = el('button', 'btn' + (b.big ? ' big' : ''), b.label); e.onclick = () => { this.g.audio.ui(); b.action(); }; bb.appendChild(e); }
    this.show('screen-end');
  }
}
