// ===================== 触屏操作（手机 / 平板） =====================
// 同一个入口：index.html 里的检测脚本给 <html> 加上 .touch 后，本模块才会创建这些控件；电脑端不受任何影响。
// 左手：浮动摇杆（推得越远走得越快）；右手：在画面上滑动转视角、双指捏合调整视距；
// 右下：跳跃 / 快跑 / 蹲 / 趴；底部：常用操作；右上：背包 / 地图 / 暂停。
// 按钮全部通过“模拟按键”复用电脑端的键盘逻辑，保证两端的游戏行为完全一致。
import { ITEMS } from './data.js';
import { clamp } from './noise.js';

export const IS_TOUCH = document.documentElement.classList.contains('touch');

const $ = (id) => document.getElementById(id);
const KEYNAME = { B: '背包', M: '地图', T: '扎营', R: '休息', E: '互动', F: '头灯', X: '登山杖', C: '蹲', Z: '趴', Q: '喷雾', H: '帮助', G: '小地图', J: '取暖', V: '视角', 1: '喝水', 2: '进食', 3: '急救' };

// 把提示里的键盘按键换成触屏按钮名：“按 B 打开背包” → “点「背包」打开背包”
export function touchText(s) {
  if (typeof s !== 'string') return s;
  const nm = (k) => KEYNAME[k];
  return s
    .replace(/按\s?\[?空格\]?\s?/g, '点击屏幕')
    .replace(/按住\s?([A-Z0-9])(?![A-Za-z0-9])\s?/g, (m, k) => nm(k) ? `按住「${nm(k)}」` : m)
    .replace(/按\s?Shift\s?/g, '点「快跑」')
    .replace(/按\s?([A-Z0-9])(?![A-Za-z0-9])\s?/g, (m, k) => nm(k) ? `点「${nm(k)}」` : m)
    .replace(/([\s/或、])([A-Z])(?=\s)\s?/g, (m, p, k) => nm(k) ? `${p.trim()}「${nm(k)}」` : m)
    // “展开登山杖(X)” → “展开「登山杖」”；其它 “(X)” → “（「名」）”
    .replace(/([^\s（(]*)[（(]([A-Z0-9])[）)]/g, (m, pre, k) => !nm(k) ? m
      : pre.endsWith(nm(k)) ? `${pre.slice(0, -nm(k).length)}「${nm(k)}」` : `${pre}（「${nm(k)}」）`);
}

// 模拟一次按键（走电脑端同一套 keydown / keyup 处理）
const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
const tap = (code) => { key(code); key(code, 'keyup'); };

const ACT = [
  { id: 'jump', lb: '跳', cp: '跳跃', hold: 'Space' }, // 按下即跳；按住不放（无敌模式）踏空飞行，松开发 keyup
  { id: 'sprint', lb: '跑', cp: '快跑', down: (t) => t.g.player.flying ? t.g.flySpeedStep(1) : t.toggleSprint() },   // 踏空时是「加速」
  { id: 'crouch', lb: '蹲', cp: '蹲下', hold: 'KeyC' },   // 按下切换蹲 / 站；踏空时按住是下降
  { id: 'prone', lb: '趴', cp: '趴下', down: (t) => t.g.player.flying ? t.g.flySpeedStep(-1) : tap('KeyZ') },   // 踏空时是「减速」
];
const QUICK = [
  { id: 'drink', lb: '喝水', code: 'Digit1' },
  { id: 'eat', lb: '进食', code: 'Digit2' },
  { id: 'aid', lb: '急救', code: 'Digit3' },
  { id: 'poles', lb: '登山杖', code: 'KeyX' },
  { id: 'lamp', lb: '头灯', code: 'KeyF' },
  { id: 'warm', lb: '取暖', hold: 'KeyJ' },
  { id: 'rest', lb: '休息', code: 'KeyR' },
  { id: 'camp', lb: '扎营', code: 'KeyT' },
  { id: 'spray', lb: '喷雾', code: 'KeyQ' },
  { id: 'more', lb: '更多', down: (t) => t.moreMenu() },
];
const SYS = [
  { id: 'inv', lb: '背包', code: 'KeyB' },
  { id: 'map', lb: '地图', code: 'KeyM' },
  { id: 'pause', lb: 'Ⅱ', code: 'Escape' },
];

const STICK_R = 56;   // 摇杆最大推动半径（px）
const DEAD = 0.14;    // 死区

export class TouchControls {
  constructor(game) {
    this.g = game;
    this.stick = { x: 0, y: 0 };
    this.stickId = null;
    this.looks = new Map();   // pointerId -> {x, y}
    this.pinchD = 0;
    this.shown = null;
    this.btn = {};
    this.cache = {};
    this.build();
    this.patchGame();
    this.homeStick();
    window.addEventListener('resize', () => this.homeStick());
    // iOS Safari：禁止双指缩放整个页面
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  // ---------------- DOM ----------------
  build() {
    const root = this.root = document.createElement('div');
    root.id = 'touch-ui'; root.className = 'off';
    root.innerHTML = `<div id="t-stick"><div id="t-knob"></div></div>
      <div id="t-act"></div><div id="t-quick"></div><div id="t-sys"></div>
      <div id="t-use" class="tb" data-b="use"><span class="cp">互动</span><span class="lb"></span></div>`;
    document.body.appendChild(root);
    const mk = (box, d, cls) => {
      const b = document.createElement('div');
      b.className = 'tb ' + cls; b.id = 'tb-' + d.id; b.dataset.b = d.id;
      b.innerHTML = cls === 'round' ? `<span class="lb">${d.lb}</span><span class="cp">${d.cp}</span>` : `<span class="lb">${d.lb}</span><span class="bd"></span>`;
      box.appendChild(b);
      this.btn[d.id] = b;
      this.bindButton(b, d);
    };
    ACT.forEach(d => mk($('t-act'), d, 'round'));
    QUICK.forEach(d => mk($('t-quick'), d, 'sq'));
    SYS.forEach(d => mk($('t-sys'), d, 'sq'));
    this.btn.use = $('t-use');
    this.bindButton(this.btn.use, { code: 'KeyE' });
    this.stickEl = $('t-stick'); this.knob = $('t-knob');

    root.addEventListener('pointerdown', (e) => this.onDown(e));
    root.addEventListener('pointermove', (e) => this.onMove(e));
    root.addEventListener('pointerup', (e) => this.onUp(e));
    root.addEventListener('pointercancel', (e) => this.onUp(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // 竖屏提示
    const rh = document.createElement('div');
    rh.id = 'rotate-hint';
    rh.innerHTML = '<div class="ico">⟲</div><div>请将手机横过来</div><div class="muted">横屏游玩体验更佳</div>';
    document.body.appendChild(rh);

    // HUD：左上角合并“时间天气”和“身体指标”，把左下角让给摇杆
    const left = document.createElement('div'); left.id = 'hud-left';
    $('hud-tl').before(left); left.append($('hud-tl'), $('hud-bl'));

    // 背包 / 地图：加关闭按钮，点击空白处也能关闭
    for (const id of ['screen-inv', 'screen-map']) {
      const scr = $(id), head = scr.querySelector('.inv-head');
      const c = document.createElement('button'); c.className = 'btn small t-close'; c.textContent = '关闭';
      c.onclick = () => { this.g.audio.ui(); this.g.ui.hide(id); };
      head.appendChild(c);
      scr.addEventListener('click', (e) => { if (e.target === scr) this.g.ui.hide(id); });
    }
    const invNote = $('screen-inv').querySelector('.inv-head .muted');
    if (invNote) invNote.textContent = '时间暂停中';
  }

  bindButton(b, d) {
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      b.classList.add('down');
      if (d.down) d.down(this);
      else if (d.hold) key(d.hold);
      else if (d.code) tap(d.code);
    };
    const up = (e) => {
      if (!b.classList.contains('down')) return;
      e && e.stopPropagation();
      b.classList.remove('down');
      if (d.hold) key(d.hold, 'keyup');
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  }

  // 只替换触屏下需要不同的部分：提示文字、操作说明、QTE 文案
  patchGame() {
    const g = this.g, ui = g.ui;
    const msg = ui.msg.bind(ui);
    ui.msg = (t, type) => msg(touchText(t), type);
    const help = ui.helpHTML.bind(ui);
    ui.helpHTML = () => {
      const tips = (help().match(/<p class="muted"[\s\S]*<\/p>/) || [''])[0];
      return `<div class="keys-table">
        <div>左侧摇杆</div><div>移动。推得越远走得越快；按住屏幕左半边任意位置都能拉出摇杆</div>
        <div>右侧滑动</div><div>转动视角；双指捏合 / 张开调整第三人称距离</div>
        <div>跳</div><div>跳跃 / 起身。脚下打滑时（QTE）点击屏幕任意处稳住。无敌模式下长按起飞：踏空后按住「跳」上升、按住「蹲」下降，「跑」/「趴」变成加速 / 减速（最快 3.5 马赫），按住「蹲」降到地面才落地</div>
        <div>跑</div><div>快跑开关（消耗大量体力；松开摇杆自动停下）</div>
        <div>蹲 / 趴</div><div>蹲下抵御阵风、石海更稳；趴下在狂风中最稳；打雷时要蹲，别趴</div>
        <div>互动</div><div>靠近水源、路牌、驴友、补给点时，画面下方会出现互动按钮；野外下雨、有积雪或雨后有水洼时，会出现“就地取水”（接雨水 / 融雪 / 舀积水）</div>
        <div>喝水 / 进食 / 急救</div><div>快速喝一口水（身上冷时优先喝保温壶）/ 吃零食 / 用急救包</div>
        <div>登山杖 / 头灯</div><div>展开收起登山杖（雷暴时记得收起）/ 开关头灯</div>
        <div>取暖（按住）</div><div>原地跳动取暖：产热但极耗体力</div>
        <div>休息 / 扎营</div><div>原地坐下恢复体力 / 搭帐篷睡觉、露宿、休息一小时，带了打火机可以捡柴生火</div>
        <div>喷雾</div><div>对冲过来的羚牛使用防兽喷雾</div>
        <div>更多</div><div>切换第一 / 第三人称、开关小地图、全屏</div>
        <div>背包 / 地图 / Ⅱ</div><div>吃喝穿衣用药求救 / 全线地图与海拔剖面 / 暂停（都会暂停时间；画质、无敌模式在暂停里）</div>
      </div>${tips}`;
    };
    const qte = g.startQTE.bind(g);
    g.startQTE = (text, ...rest) => qte(touchText(text), ...rest);
    for (const id in ITEMS) if (ITEMS[id].desc) ITEMS[id].desc = touchText(ITEMS[id].desc);
    // 在“开始 / 继续”时尝试进入全屏并锁定横屏（Android 有效；iPhone Safari 不支持网页全屏，可“添加到主屏幕”）
    for (const id of ['btn-start', 'btn-continue']) $(id).addEventListener('click', () => this.fullscreen(true));
  }

  fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
  fullscreen(on) {
    try {
      const d = document.documentElement;
      if (on && !this.fsElement()) {
        const p = (d.requestFullscreen || d.webkitRequestFullscreen || (() => null)).call(d, { navigationUI: 'hide' });
        const lock = () => { try { const q = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (q && q.catch) q.catch(() => {}); } catch (e) { /* 忽略 */ } };
        if (p && p.then) p.then(lock, () => {}); else lock();
      } else if (!on && this.fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch (e) { /* 不支持全屏 */ }
  }

  moreMenu() {
    const g = this.g;
    if (g.state !== 'play' || g.anyUI() || g.sleeping) return;
    const btns = [
      { label: g.player.firstPerson ? '切换到第三人称' : '切换到第一人称', action: () => tap('KeyV') },
      { label: '开关小地图', action: () => tap('KeyG') },
      { label: '操作说明', action: () => setTimeout(() => tap('KeyH'), 0) },
    ];
    if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
      const fs = !!this.fsElement();
      btns.push({ label: fs ? '退出全屏' : '全屏', action: () => this.fullscreen(!fs) });
    }
    btns.push({ label: '返回游戏' });
    g.ui.modal('更多操作', '<p class="muted">时间已暂停。</p>', btns);
  }

  toggleSprint() { const k = this.g.keys; k.sprint = !k.sprint; }

  // ---------------- 摇杆 / 视角 ----------------
  homeStick() {
    this.home = { x: 92 + this.safe('left'), y: window.innerHeight - 92 };
    if (this.stickId === null) this.placeStick(this.home.x, this.home.y);
  }
  safe(side) {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--s' + side[0]);
    return parseFloat(v) || 0;
  }
  placeStick(x, y) {
    this.cx = x; this.cy = y;
    this.stickEl.style.left = x + 'px'; this.stickEl.style.top = y + 'px';
    this.knob.style.transform = '';
  }
  playing() { const g = this.g; return g.state === 'play' && !g.sleeping && !g.anyUI(); }

  onDown(e) {
    if (e.target.closest('[data-b]')) return;
    e.preventDefault();
    const g = this.g;
    if (!this.playing()) return;
    g.audio.init();
    // QTE：点击屏幕任意处即可稳住
    if (g.qte) g.resolveQTE(true);
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    const W = window.innerWidth, H = window.innerHeight;
    if (this.stickId === null && e.clientX < W * 0.42 && e.clientY > H * 0.3) {
      this.stickId = e.pointerId;
      const m = STICK_R + 10;
      this.placeStick(clamp(e.clientX, m + this.safe('left'), W * 0.5), clamp(e.clientY, m, H - m));
      this.stickEl.classList.add('act');
      this.moveStick(e.clientX, e.clientY);
    } else {
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinchD = 0;
    }
  }

  onMove(e) {
    if (e.pointerId === this.stickId) { e.preventDefault(); this.moveStick(e.clientX, e.clientY); return; }
    const L = this.looks.get(e.pointerId);
    if (!L) return;
    e.preventDefault();
    const dx = e.clientX - L.x, dy = e.clientY - L.y;
    L.x = e.clientX; L.y = e.clientY;
    if (!this.playing()) return;
    const pl = this.g.player;
    if (this.looks.size >= 2) {
      // 双指捏合：调整第三人称视距
      const [a, b] = [...this.looks.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchD) pl.camDist = clamp(pl.camDist - (d - this.pinchD) * 0.03, 2.2, 11);
      this.pinchD = d;
      return;
    }
    const k = 5.2 / Math.max(window.innerWidth, window.innerHeight);   // 横扫一个屏宽 ≈ 转 300°
    pl.camYaw += dx * k;
    pl.camPitch = clamp(pl.camPitch - dy * k * 0.85, -1.25, 0.95);
  }

  onUp(e) {
    if (e.pointerId === this.stickId) this.endStick();
    if (this.looks.delete(e.pointerId)) this.pinchD = 0;
  }

  moveStick(x, y) {
    let dx = x - this.cx, dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(d / STICK_R, 1);
    const mm = m < DEAD ? 0 : (m - DEAD) / (1 - DEAD);
    this.stick.x = d > 0 ? dx / Math.min(d, STICK_R) * mm : 0;
    this.stick.y = d > 0 ? -dy / Math.min(d, STICK_R) * mm : 0;
  }

  endStick() {
    this.stickId = null;
    this.stick.x = 0; this.stick.y = 0;
    this.stickEl.classList.remove('act');
    this.placeStick(this.home.x, this.home.y);
    this.g.keys.sprint = false;   // 松开摇杆自动停止快跑
  }

  release() {
    if (this.stickId !== null) this.endStick();
    this.looks.clear(); this.pinchD = 0;
    for (const id in this.btn) this.btn[id].classList.remove('down');
    const k = this.g.keys; k.warm = false; k.sprint = false;
  }

  // ---------------- 每帧刷新按钮状态 ----------------
  set(id, cls, on) { const b = this.btn[id]; if (b && b.classList.contains(cls) !== !!on) b.classList.toggle(cls, !!on); }
  text(id, sel, t) {
    const k = id + sel;
    if (this.cache[k] === t) return;
    this.cache[k] = t;
    const e = this.btn[id].querySelector(sel); if (e) e.textContent = t;
  }

  update() {
    const g = this.g;
    const show = this.playing();
    if (show !== this.shown) { this.shown = show; this.root.classList.toggle('off', !show); if (!show) this.release(); }
    if (!show) return;
    const pl = g.player, inv = g.inv;
    this.set('sprint', 'on', g.keys.sprint && !pl.flying);
    this.text('sprint', '.cp', pl.flying ? '加速' : '快跑');
    this.text('prone', '.cp', pl.flying ? '减速' : '趴下');
    this.set('crouch', 'on', pl.stance === 'crouch');
    this.set('prone', 'on', pl.stance === 'prone');
    this.text('jump', '.cp', pl.flying ? '上升' : pl.stance !== 'stand' ? '起身' : '跳跃');
    this.text('crouch', '.cp', pl.flying ? '下降' : '蹲下');
    this.set('poles', 'on', pl.polesOut); this.set('poles', 'dim', !inv.has('poles'));
    this.set('lamp', 'on', g.lampOn); this.set('lamp', 'dim', !inv.has('lamp'));
    this.text('lamp', '.bd', inv.has('lamp') ? Math.round(inv.battery.lamp) + '%' : '');
    this.set('aid', 'dim', !inv.has('firstaid'));
    this.set('spray', 'dim', !inv.has('spray'));
    this.set('rest', 'on', pl.sitting);
    this.set('warm', 'on', pl.warming);
    this.set('drink', 'dim', inv.water < 0.02 && !(inv.flask > 0.02));
    this.text('drink', '.bd', inv.water.toFixed(1) + 'L');
    const near = g.nearInteract && !g.qte ? g.nearInteract.label : '';
    this.set('use', 'show', !!near);
    if (near) this.text('use', '.lb', near);
    this.root.classList.toggle('qte', !!g.qte);
  }
}
