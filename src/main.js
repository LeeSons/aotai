// ===================== 鳌太 · 九死一生 =====================
import * as THREE from 'three';
import { ROUTE, ROUTE_LENGTH, ITEMS, ITEM_USES, BACKPACKS, DIFFICULTY, GAME_MIN_PER_SEC, SEC_PER_GAME_HOUR, SHOP_STOCK, SEASONS, WORLD, routeZ, yToAlt, altToY, segIndexAt, moneyForWins, WIN_BONUS } from './data.js';
import { mulberry32, clamp, lerp, smoothstep, makeNoise } from './noise.js';
import { makeWeatherUniforms, bakeTextures, QUAL } from './materials.js';
import { Post, installSoftShadows, FarShadow } from './post.js';
import { TerrainManager, initTerrainAssets, buildVegetation, heightAt, groundAt, terrainInfo, profileY, edgeAt, openAt, STREAM } from './terrain.js';
import { Sky, CloudSea, World, Glory, WATER_U, initWorldMats, hikerModel, campfireModel } from './world.js';
import { FX } from './fx.js';
import { Fauna } from './fauna.js';
import { Weather } from './weather.js';
import { Player, FLY_GEARS, FLY_GEAR0, RUN_GEARS, RUN_GEAR0, gearLabel, gearSpeed } from './player.js';
import { Inventory, Survival } from './survival.js';
import { Hazards } from './hazards.js';
import { Audio } from './audio.js';
import { UI, fmt } from './ui.js';
import { IS_TOUCH, TouchControls } from './touch.js';

const $ = (id) => document.getElementById(id);
const DN = makeNoise(31337);
// 高空西风（m/s）：主脊高度、500 hPa（约 5.5 km）、300 hPa（约 9 km）、200 hPa（约 11 km）。
// 秦岭在北纬 34°，冬天正好压在副热带西风急流底下，万米高空风速五六十米每秒；夏天急流北移，弱得多
const JET = { winter: [14, 28, 50, 60], spring: [11, 22, 38, 45], autumn: [10, 18, 32, 38], summer: [6, 10, 18, 22] };
const JET_ALT = [3500, 5500, 9000, 11000];
function jetLevel(alt, season) {
  const v = JET[season] || JET.autumn;
  let ms = v[0];
  for (let i = 1; i < 4; i++) if (alt > JET_ALT[i - 1]) ms = lerp(v[i - 1], v[i], clamp((alt - JET_ALT[i - 1]) / (JET_ALT[i] - JET_ALT[i - 1]), 0, 1));
  return Math.min(17, Math.pow(ms / 0.836, 2 / 3));   // 换算成风级（蒲福风级，中国扩展到 17 级）
}
// 树冠遮蔽（挡风雨、挡冰雹）；土质地表（雨后成泥）
const CANOPY = { forest: 1, gully: 1, dead: 0.4 };
// 附近能捡到多少柴：林子里最多，枯木林的站杆最好烧；林线以上只有零星灌木，石海山脊几乎没有
const FUEL = { forest: 1, dead: 1.15, gully: 0.85, meadow: 0.3, ridge: 0.08, pillars: 0.06, stone: 0.03, cliff: 0.05 };
const SOIL = { forest: 1, gully: 1, dead: 0.85, meadow: 0.6 };

const C = (r, g, b) => new THREE.Color(r, g, b);
const SKY = {
  dayZ: C(0.13, 0.3, 0.68), dayH: C(0.55, 0.68, 0.85),
  setZ: C(0.18, 0.22, 0.45), setH: C(0.98, 0.52, 0.28),
  nightZ: C(0.003, 0.006, 0.018), nightH: C(0.012, 0.018, 0.032),
  grey: C(0.5, 0.53, 0.57), fogGrey: C(0.64, 0.67, 0.7),
};

const NPC_LINES = [
  '前面全是石海，崴了脚就麻烦了。慢点走，别逞能。',
  '下午容易起雷暴，尽量趁上午过山脊。打雷的时候千万别站在高处。',
  '冷了就加衣服，别等发抖了再穿。衣服湿了一定要换，湿衣服比不穿还冷。',
  '羚牛看着憨，冲起来能把人顶下山崖。离远点，绕开走，千万别跑。',
  '起雾的时候四周都长一个样，看不清路就原地等雾散，千万别乱下沟。',
  '去年有个人在这附近失温，发现的时候外套都脱了……说是重度失温的人会觉得热。',
  '水要省着喝，但别等渴了才喝。前面的水源不一定有水。',
  '你一个人走？胆子真大。手机在这儿没信号的，出了事谁也找不到你。',
];

// ===================== 画质 =====================
// 渲染倍率（相对屏幕的 CSS 像素，不超过设备像素比）在 min–max 之间按帧率自动调整
const GFX = {
  low:   { name: '流畅', desc: '帧率优先。分辨率最低、关闭抗锯齿和泛光，适合发热或较旧的手机', min: 0.6, max: 1.0, shadow: 1024, msaa: 0 },
  mid:   { name: '均衡', desc: '清晰度和流畅度兼顾，有泛光和镜头光晕，卡顿时自动降低分辨率', min: 0.85, max: 1.5, start: 1.25, shadow: 1024, msaa: 2 },
  high:  { name: '高清', desc: '全套光影：软阴影、环境光遮蔽、体积光（太阳光柱）、精细材质。帧率不够时会自动降一点分辨率', min: 0.75, max: 2.0, shadow: 2048, msaa: 4 },
  ultra: { name: '极致', desc: '按屏幕原生分辨率渲染，不自动降低，光影采样也最密。最清晰也最耗电发热', min: 9, max: 3.0, shadow: 4096, msaa: 4 },
};
function loadGfx() {
  try { const k = localStorage.getItem('aotai_gfx'); if (GFX[k]) return k; } catch (e) { /* 无存储 */ }
  return IS_TOUCH ? 'mid' : 'high';
}
function gfxRange(key) {
  const L = GFX[key], dpr = window.devicePixelRatio || 1;
  const max = Math.min(dpr, L.max), min = Math.min(max, L.min);
  return { max, min, start: L.start ? clamp(L.start, min, max) : max };
}

// 阴影相机：以玩家为中心 ±SHADOW_HALF 米；光源在 300 米外
const SHADOW_HALF = 64, SHADOW_NEAR = 60, SHADOW_FAR = 620;

class Game {
  constructor() {
    this.canvas = $('gl');
    const R = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    // 画质：手机默认「均衡」、电脑默认「高清」，可在标题画面 / 暂停菜单里切换
    this.gfxKey = loadGfx();
    // 无敌模式：在暂停菜单里开关，设置会记住
    try { this.god = localStorage.getItem('aotai_god') === '1'; } catch (e) { this.god = false; }
    const GR = gfxRange(this.gfxKey);
    this.perf = { acc: 0, n: 0, max: GR.max, min: GR.min, pr: GR.start };
    R.setPixelRatio(GR.start);
    R.setSize(window.innerWidth, window.innerHeight);
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
    R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.0;
    R.outputColorSpace = THREE.SRGBColorSpace;
    // 材质精度开局定档：手机和低两档用轻量版（单方向贴图投影、256 贴图、自带的阴影过滤）
    QUAL.lite = IS_TOUCH || this.gfxKey === 'low' || this.gfxKey === 'mid';
    QUAL.texSize = QUAL.lite ? 256 : 512;
    QUAL.grassHi = !QUAL.lite;
    this.liteAtBoot = QUAL.lite;
    this.wxU = makeWeatherUniforms();
    bakeTextures(R, this.wxU);
    // 软阴影：影子离遮挡物越远越虚（阴影相机范围见下面 sun.shadow.camera）
    if (!QUAL.lite) { if (installSoftShadows({ width: SHADOW_HALF * 2, height: SHADOW_HALF * 2, depth: SHADOW_FAR - SHADOW_NEAR }, { taps: this.gfxKey === 'ultra' ? 20 : 14, searchTaps: 8 })) R.shadowMap.type = THREE.PCFShadowMap; }

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9fb0c0, 0.001);
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 5000);

    // 后期
    const sz = R.getDrawingBufferSize(new THREE.Vector2());
    this.post = new Post(R, this.gfxKey, GFX[this.gfxKey].msaa);
    this.post.setSize(sz.x, sz.y);
    this.postU = this.post.u;
    // 远距离地形阴影：山体投下的影子（方圆 800 米，只画地形，几帧更新一次）
    this.farSh = new FarShadow(QUAL.lite ? 512 : 1024, 800, 1);
    this.wxU.tFarSh.value = this.farSh.depth; this.wxU.uFarShM.value = this.farSh.matrix;
    this.wxU.uFarSh.value.set(1 / this.farSh.size, 0.6 / 2600, 0, this.farSh.texel * 1.6);
    this.cloudDrift = new THREE.Vector2(); this.frameNo = 0;
    // 中距离阴影：近处那张精细阴影图只管 64 米内，再往外 190 米内的树、石头、建筑由这张图投影（位置或太阳变了才重画）
    this.midSh = QUAL.lite ? null : new FarShadow(2048, 190, 2, 420, 20, 900);
    if (this.midSh) {
      this.wxU.tMidSh.value = this.midSh.depth; this.wxU.uMidShM.value = this.midSh.matrix;
      this.wxU.uMidSh.value.set(1 / this.midSh.size, 0.3 / this.midSh.range, 0, this.midSh.texel * 1.7);
      this.midState = { c: new THREE.Vector3(1e9, 0, 0), d: new THREE.Vector3(), t: 0 };
    }

    // 光照
    initTerrainAssets(this.wxU);
    this.seasonKey = 'autumn'; WORLD.season = 'autumn';
    buildVegetation('autumn');
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(GFX[this.gfxKey].shadow);
    const sc = this.sun.shadow.camera; sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF; sc.near = SHADOW_NEAR; sc.far = SHADOW_FAR;
    this.sun.shadow.bias = QUAL.lite ? -0.0004 : -0.00016; this.sun.shadow.normalBias = 0.04; this.sun.shadow.radius = 1.25;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a3020, 0.6); this.scene.add(this.hemi);
    this.flashLight = new THREE.AmbientLight(0xdde6ff, 0); this.scene.add(this.flashLight);
    initWorldMats(this.wxU);
    this.sky = new Sky(this.scene, this.wxU);
    this.cloudSea = new CloudSea(this.scene, this.wxU);
    this.cloudDeck = new CloudSea(this.scene, this.wxU);   // 飞到云顶以上时脚下的云层
    this.glory = new Glory(this.scene);
    this.fx = new FX(this.scene);
    this.fauna = new Fauna(this.scene);
    this.terrain = new TerrainManager(this.scene);

    this.audio = new Audio();
    this.ui = new UI(this);
    this.player = new Player(this.scene);
    this.player.model.visible = false;

    this.state = 'title';
    this.keys = {};
    this.time = 0;
    this.gameMin = 6 * 60 + 20;
    this.camShake = 0;
    this.hurtFx = 0;
    this.lampOn = false;
    this.gpsOn = true;
    this.paused = false;
    this.qte = null;
    this.dangerCount = 0;
    this.tips = {};
    this.npcMeshes = [];
    this.campTent = null;

    // 标题画面用的预览世界
    this.rng = mulberry32(12345);
    this.diff = DIFFICULTY.normal;
    this.weather = new Weather(this.scene, this.rng, this.diff);
    this.world = new World(this.scene, this.rng);
    this.fx.setSmokes(this.world.smokes);
    this.titleX = ROUTE[4].x - 60;

    this.bindInput();
    this.bindMenus();
    if (IS_TOUCH) this.touch = new TouchControls(this);
    window.addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.terrain.update(this.titleX, routeZ(this.titleX), 0, true);
    this.renderer.setAnimationLoop(() => this.frame());
    try { if (localStorage.getItem('aotai_save')) $('btn-continue').style.display = ''; } catch (e) { /* 无存储 */ }
    window.game = this;
  }

  resize() {
    const R = this.renderer;
    R.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
    const sz = R.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(sz.x, sz.y);
  }

  // ===================== 菜单 =====================
  bindMenus() {
    const ui = this.ui;
    $('btn-start').onclick = () => { this.audio.init(); this.audio.ui(); ui.hide('screen-title'); this.toSeason(); };
    $('btn-help').onclick = () => { this.audio.init(); ui.modal('操作说明', ui.helpHTML()); };
    $('btn-gfx').onclick = () => { this.audio.init(); this.gfxMenu(); };
    $('btn-about').onclick = () => {
      this.audio.init();
      ui.modal('关于鳌太线', `<p>鳌太线是指从秦岭鳌山到太白山拔仙台的高海拔山脊穿越线路，全程约 170 公里，主脊海拔 3200–3700 米，被称为“中国十大最危险徒步路线”之一。</p>
        <p>这里有“一日四季”的极端天气：浓雾、暴雨、冰雹、暴雪随时降临，大风 5–7 级是常态。失温、迷路、坠崖、石海摔伤、羚牛袭击、高原反应……自本世纪初以来，已有数十人在此遇难或失踪。</p>
        <p>2018 年起，陕西省明令禁止任何单位和个人穿越鳌太线，违者将被处罚，遇险救援费用由当事人承担。</p>
        <p style="color:#e0483c">本游戏仅为虚构的模拟体验。现实中请勿尝试。</p>`);
    };
    $('btn-continue').onclick = () => {
      this.audio.init();
      try { const s = JSON.parse(localStorage.getItem('aotai_save')); ui.hide('screen-title'); this.loadRun(s); } catch (e) { ui.modal('无法读取存档', '<p>存档损坏或不存在。</p>'); }
    };
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => { ui.hide('screen-diff'); ui.hide('screen-season'); ui.show(b.dataset.back === 'diff' ? 'screen-diff' : 'screen-title'); });
  }

  setSeason(k) {
    this.seasonKey = k; WORLD.season = k;
    buildVegetation(k);
  }

  wins() { try { return +(localStorage.getItem('aotai_wins') || 0); } catch (e) { return 0; } }
  startMoney() { return moneyForWins(this.wins()); }

  toSeason() {
    this.diffKey = 'normal'; this.diff = DIFFICULTY.normal;
    this.ui.buildSeason(this.startMoney(), this.wins(), (s) => { this.ui.hide('screen-season'); this.setSeason(s); this.toShop(); });
    this.ui.show('screen-season');
  }

  toShop() {
    this.diffKey = 'normal'; this.diff = DIFFICULTY.normal;
    this.ui.openShop(this.startMoney(), this.seasonKey, (cart, left) => { this.ui.hide('screen-shop'); this.startRun(cart, left); });
  }

  // ===================== 一局游戏 =====================
  setupRun(seed) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    // 清理旧对象
    this.clearFire(); this.woodPile = null;
    if (this.world) { this.scene.remove(this.world.group); }
    if (this.hazards) this.hazards.dispose();
    for (const m of this.npcMeshes) this.scene.remove(m);
    this.npcMeshes = [];
    if (this.weather) this.weather.dispose(this.scene);
    this.fauna.dispose();
    this.weather = new Weather(this.scene, this.rng, this.diff, this.seasonKey);
    this.weather.timeLeft = 2 * SEC_PER_GAME_HOUR;
    this.world = new World(this.scene, this.rng);
    this.fx.setSmokes(this.world.smokes);
    this.hazards = new Hazards(this.scene, this.rng, this.diff);
    for (const n of this.world.npcs) {
      const m = hikerModel(n.ranger ? 0x2a4a7a : [0xd86a1c, 0x3a7a4a, 0x8a3a8a, 0x2a6aa0][(n.x | 0) % 4], n.ranger);
      m.position.set(n.x, heightAt(n.x, n.z), n.z);
      m.rotation.y = this.rng() * 6.28;
      this.scene.add(m); this.npcMeshes.push(m);
      n.talked = false;
    }
    this.inv = new Inventory();
    this.surv = new Survival(this.inv);
    this.surv.god = this.god;
    this.godUsed = false;
    this.reached = 0;
    this.track = []; this.trackAll = [];
    this.dangerCount = 0;
    this.tips = {};
    this.rescue = null;
    this.sleeping = false;
    this.shopVisited = {};
    this.checkpoint = null;
    this.lastTrack = null;
    this.gpsPos = new THREE.Vector3(); this.navJitter = 0;
    this.player.sliding = false; this.player.slideSpeed = 0; this.player.vel.set(0, 0, 0); this.player.push.set(0, 0, 0);
    this.player.hidden = false; this.player.sitting = false; this.player.stance = 'stand'; this.player.ko = 0; this.player.polesOut = false;
    this.gloryCool = 60;
    this.lampOn = false;
    this.deadT = 0;
    this.endShown = false;
  }

  startRun(cart, moneyLeft) {
    this.setupRun((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    const inv = this.inv;
    inv.backpack = BACKPACKS.find(b => b.id === cart.backpack);
    for (const id in cart.items) inv.add(id, cart.items[id]);
    inv.water = inv.waterCap;
    inv.flask = inv.flaskCap; inv.flaskT = 95;   // 塘口村的农家乐给保温壶灌满了开水
    inv.money = moneyLeft;
    this.gameMin = Math.round(SEASONS[this.seasonKey].sunrise * 60 + 50);
    // 出发前按山下的气温穿衣：没有人会穿着一件速干衣走出冬天的塘口村
    const h0 = this.gameMin / 60;
    const t0 = 18 + SEASONS[this.seasonKey].temp + 4.8 * Math.cos((h0 - 15) / 24 * Math.PI * 2) + 1;
    for (const [id, below] of [['base', 99], ['fleece', 13], ['hat', 6], ['shell', 3], ['down', -6]]) if (inv.has(id) && t0 < below) inv.worn.add(id);
    const dressed = [...inv.worn].map(id => ITEMS[id].name).join('、');
    this.startMin = this.gameMin;
    this.player.pos.set(-22, 0, routeZ(-22));
    this.player.pos.y = groundAt(this.player.pos.x, this.player.pos.z).y;
    this.player.camYaw = 0; this.player.camPitch = -0.2; this.player.yaw = Math.PI / 2;
    this.player.setGear(inv);
    this.enterPlay(() => {
      const S = SEASONS[this.seasonKey];
      this.ui.titleCard(`第 1 天 · ${S.full}`, '塘口村', '海拔 1750 m', ROUTE[0].desc);
      setTimeout(() => this.msg(S.desc, 'warn'), 1200);
      setTimeout(() => this.msg('鳌太线整体自西向东，沿着主脊走。脚下踩出来的小路就是路线；到了石海和开阔的草甸，路迹会变淡甚至消失，要对照地图和方向。', 'info'), 2500);
      setTimeout(() => this.msg(`${dressed ? `出发前你按山下的气温穿好了：${dressed}。` : ''}山下林子里风小、天气温和；上了林线、到了山脊，风雨会狠得多——冷了按 B 打开背包加衣，爬坡出汗时减衣。`, 'info'), 6500);
      setTimeout(() => this.msg(this.touch
        ? '左手摇杆移动，右手在画面上滑动转视角、双指捏合调整视距。右下角跳 / 跑 / 蹲 / 趴，底部是常用操作，Ⅱ 暂停里有全部说明。'
        : '点击画面锁定鼠标控制视角。Shift 快跑、C 蹲行、Z 匍匐、X 登山杖，按 H 查看全部操作。', 'info'), 10500);
      this.saveCheckpoint();
    });
  }

  loadRun(save) {
    this.diffKey = save.diffKey; this.diff = DIFFICULTY[save.diffKey] || DIFFICULTY.normal;
    this.setSeason(save.season || 'autumn');
    this.setupRun(save.seed);
    this.applySnapshot(save.snap);
    this.checkpoint = save.snap;
    this.enterPlay(() => {
      const w = ROUTE[this.reached];
      this.ui.titleCard(`第 ${Math.floor(this.gameMin / 1440) + 1} 天 · 重新出发`, w.name, `海拔 ${w.alt} m`, '');
    });
  }

  enterPlay(after) {
    this.ui.clearMsgs();
    $('loading').classList.remove('hidden');
    $('load-tip').textContent = ['失温是鳌太线上致死最多的原因。', '石海中慢慢走，别奔跑。', '雾中迷路时，原地等待比乱走安全。', '湿衣服比不穿还冷。'][Math.random() * 4 | 0];
    $('load-fill').style.width = '20%';
    this.state = 'loading';
    setTimeout(() => {
      this.terrain.clearAll();
      this.terrain.update(this.player.pos.x, this.player.pos.z, 0, true);
      $('load-fill').style.width = '80%';
      this.updateEnvironment(0.016);
      this.updateLighting();
      this.renderer.compile(this.scene, this.camera);
      setTimeout(() => {
        $('loading').classList.add('hidden');
        this.ui.show('hud');
        this.state = 'play';
        this.paused = false;
        this.player.model.visible = true;
        this.ui.updateHUD(this);
        $('lockhint').style.display = 'block';
        after && after();
      }, 60);
    }, 60);
  }

  snapshot() {
    return {
      pos: this.player.pos.toArray(), camYaw: this.player.camYaw, gameMin: this.gameMin, startMin: this.startMin, reached: this.reached, rv: 2,
      inv: this.inv.serialize(), surv: this.surv.serialize(), weather: this.weather.serialize(), danger: this.dangerCount,
      npcTalked: this.world.npcs.map(n => n.talked), used: this.world.interactables.map(i => !!i.used), shopVisited: { ...this.shopVisited },
    };
  }
  applySnapshot(s) {
    this.player.pos.fromArray(s.pos);
    this.player.camYaw = s.camYaw; this.player.yaw = Math.PI / 2 - s.camYaw + Math.PI / 2;
    this.gameMin = s.gameMin; this.reached = s.reached; this.startMin = s.startMin || 7 * 60;
    if (!(s.rv >= 2) && this.reached >= 9) this.reached++;   // 旧存档：水窝子之后新加了「飞机梁（主台）」，地标序号后移一位
    this.inv.restore(s.inv, BACKPACKS);
    this.surv.restore(s.surv);
    this.weather.restore(s.weather);
    this.dangerCount = s.danger || 0;
    (s.npcTalked || []).forEach((t, i) => { if (this.world.npcs[i]) this.world.npcs[i].talked = t; });
    (s.used || []).forEach((u, i) => { if (this.world.interactables[i]) this.world.interactables[i].used = u; });
    this.shopVisited = { ...(s.shopVisited || {}) };
    this.player.setGear(this.inv);
    this.player.vel.set(0, 0, 0); this.player.push.set(0, 0, 0);
  }
  saveCheckpoint() {
    this.checkpoint = this.snapshot();
    try { localStorage.setItem('aotai_save', JSON.stringify({ seed: this.seed, diffKey: this.diffKey, season: this.seasonKey, snap: this.checkpoint })); } catch (e) { /* 忽略 */ }
  }

  // ===================== 输入 =====================
  bindInput() {
    const map = { KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyC: 'crouch', ControlLeft: 'crouch', KeyZ: 'crouch', KeyJ: 'warm', Space: 'jump', ArrowLeft: 'yl', ArrowRight: 'yr', ArrowUp: 'pu', ArrowDown: 'pd' };
    this.input = { f: false, b: false, l: false, r: false, sprint: false, crouch: false, jump: false };
    window.addEventListener('keydown', (e) => {
      if (map[e.code]) { this.keys[map[e.code]] = true; if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); }
      if (e.code === 'Space') this.keys.jumpHeld = true;   // 按住空格（无敌模式下长按飞行）
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => { if (map[e.code]) this.keys[map[e.code]] = false; if (e.code === 'Space') this.keys.jumpHeld = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    this.canvas.addEventListener('click', () => {
      this.audio.init();
      if (this.state === 'play' && !this.anyUI() && document.pointerLockElement !== this.canvas) {
        const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      $('lockhint').style.display = locked || this.state !== 'play' ? 'none' : 'block';
    });
    let drag = false, lx = 0, ly = 0;
    this.canvas.addEventListener('mousedown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => { drag = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.state !== 'play' || this.anyUI()) return;
      let dx = 0, dy = 0;
      if (document.pointerLockElement === this.canvas) { dx = e.movementX; dy = e.movementY; }
      else if (drag) { dx = e.clientX - lx; dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; }
      else return;
      this.player.camYaw += dx * 0.0022;
      this.player.camPitch = clamp(this.player.camPitch - dy * 0.0022, ...this.player.pitchRange());
    });
    let wheelAcc = 0, wheelT = 0;
    window.addEventListener('wheel', (e) => {
      if (this.state !== 'play' || this.anyUI()) return;
      if (this.player.flying) {   // 踏空时滚轮调飞行速度：往上滚加速、往下滚减速（触控板一次会发很多小事件，攒够一格再换档）
        wheelAcc += e.deltaY;
        const now = performance.now();
        if (Math.abs(wheelAcc) >= 40 && now - wheelT > 90) { this.flySpeedStep(wheelAcc < 0 ? 1 : -1); wheelAcc = 0; wheelT = now; }
        return;
      }
      this.player.camDist = clamp(this.player.camDist + Math.sign(e.deltaY) * 0.5, 2.2, 11);
    }, { passive: true });
  }

  anyUI() {
    return ['screen-inv', 'screen-map', 'modal', 'screen-end', 'screen-shop', 'loading'].some(id => !$(id).classList.contains('hidden'));
  }

  onKey(code, e) {
    if (this.state !== 'play') return;
    const ui = this.ui;
    const invOpen = !$('screen-inv').classList.contains('hidden');
    const mapOpen = !$('screen-map').classList.contains('hidden');
    if (code === 'Escape') {
      if (invOpen) { ui.hide('screen-inv'); return; }
      if (mapOpen) { ui.hide('screen-map'); return; }
      if (ui.modalOpen) { ui.closeModal(); return; }
      this.pauseMenu(); return;
    }
    if (code === 'KeyB' || code === 'Tab') {
      if (invOpen) { ui.hide('screen-inv'); return; }
      if (this.anyUI() || this.sleeping) return;
      document.exitPointerLock && document.exitPointerLock();
      ui.openInventory(); return;
    }
    if (code === 'KeyM') {
      if (mapOpen) { ui.hide('screen-map'); return; }
      if (this.anyUI() || this.sleeping) return;
      if (!this.inv.has('map') && !this.navDevice()) { this.msg('你没有地图。只能凭记忆和路标前进。', 'warn'); return; }
      document.exitPointerLock && document.exitPointerLock();
      ui.openMap(); return;
    }
    if (this.anyUI() || this.sleeping) return;
    if (code === 'Space' && this.qte) { this.resolveQTE(true); return; }
    switch (code) {
      case 'KeyC': case 'ControlLeft': {
        const pl = this.player; if (pl.ko > 0 || pl.sliding || pl.flying) break;   // 踏空时 C 是下降
        pl.sitting = false; pl.setStance(pl.stance === 'crouch' ? 'stand' : 'crouch'); break;
      }
      case 'KeyZ': {
        const pl = this.player; if (pl.ko > 0 || pl.sliding || pl.flying) break;
        pl.sitting = false; pl.setStance(pl.stance === 'prone' ? 'crouch' : 'prone');
        if (pl.stance === 'prone') this.msg('你趴在地上匍匐前进。', 'info'); break;
      }
      case 'Equal': case 'NumpadAdd': case 'Minus': case 'NumpadSubtract':
        if (this.player.flying || this.god) this.speedStep(code === 'Equal' || code === 'NumpadAdd' ? 1 : -1);
        break;
      case 'KeyX':
        if (this.player.togglePoles()) { this.audio.pole(); this.msg(this.player.polesOut ? '你展开了登山杖。' : '你收起了登山杖。', 'info'); }
        else this.msg('你没有登山杖。', 'warn');
        break;
      case 'KeyV': this.player.firstPerson = !this.player.firstPerson; this.msg(this.player.firstPerson ? '第一人称视角' : '第三人称视角', 'info'); break;
      case 'KeyF': this.toggleLamp(); break;
      case 'KeyG': if (this.inv.has('gps') || this.inv.has('app')) this.gpsOn = !this.gpsOn; else this.msg('你没有 GPS 或手机轨迹，没有小地图。', 'warn'); break;
      case 'KeyE': this.interact(); break;
      case 'KeyR': if (!this.player.sliding && this.player.onGround) { this.player.sitting = !this.player.sitting; if (this.player.sitting) this.msg('你坐下来喘口气。', 'info'); } break;
      case 'KeyT': this.campMenu(); break;
      case 'KeyQ': this.useSpray(); break;
      case 'KeyH': document.exitPointerLock && document.exitPointerLock(); ui.modal('操作说明', ui.helpHTML()); break;
      case 'Digit1': this.quickDrink(); break;
      case 'Digit2': this.quickEat(); break;
      case 'Digit3': if (this.inv.has('firstaid')) this.useItem('firstaid'); else this.msg('你没有急救包。', 'warn'); break;
      case 'F9': this.debugNext(); break;
    }
  }

  // 切换画质：分辨率范围、阴影贴图、抗锯齿
  setGfx(key) {
    if (!GFX[key]) return;
    this.gfxKey = key;
    try { localStorage.setItem('aotai_gfx', key); } catch (e) { /* */ }
    const L = GFX[key], GR = gfxRange(key);
    Object.assign(this.perf, { acc: 0, n: 0, max: GR.max, min: GR.min, pr: GR.start });
    this.renderer.setPixelRatio(GR.start);
    if (this.sun.shadow.mapSize.x !== L.shadow) {
      this.sun.shadow.mapSize.setScalar(L.shadow);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.post.setMsaa(L.msaa);
    this.post.setTier(key);
    this.resize();
  }

  // 无敌模式换档：踏空时调飞行速度，在地面上调快跑 / 行走速度
  speedStep(d) { if (this.player.flying) this.flySpeedStep(d); else if (this.god) this.runSpeedStep(d); }
  runSpeedStep(d) {
    const pl = this.player;
    const g0 = pl.runGear ?? RUN_GEAR0;
    pl.runGear = clamp(g0 + d, 0, RUN_GEARS.length - 1);
    const g = RUN_GEARS[pl.runGear], walk = Math.max(3.3, gearSpeed(g, this.airTemp) / 3);
    const top = pl.runGear === RUN_GEARS.length - 1, low = pl.runGear === 0;
    this.ui.alert(`快跑速度：${gearLabel(g, this.airTemp)} · 行走 ${walk < 10 ? walk.toFixed(1) : Math.round(walk)} m/s${top && d > 0 && g0 === pl.runGear ? '（已是最快）' : low && d < 0 && g0 === pl.runGear ? '（已是最慢）' : ''}`, 1.3);
    if (pl.runGear > RUN_GEAR0 + 3) this.tip('godrun', '跑得太快时，翻过山脊会被甩到半空，按物理规律抛出去再落下来（无敌模式不会摔伤）。高速撞上陡峭的岩壁会被挡住。');
  }
  // 飞行换档：d = +1 加速 / −1 减速
  flySpeedStep(d) {
    const pl = this.player;
    const g0 = pl.flyGear ?? FLY_GEAR0;
    pl.flyGear = clamp(g0 + d, 0, FLY_GEARS.length - 1);
    const top = pl.flyGear === FLY_GEARS.length - 1, low = pl.flyGear === 0;
    this.ui.alert(`飞行速度：${gearLabel(FLY_GEARS[pl.flyGear], this.airTemp)}${top && d > 0 && g0 === pl.flyGear ? '（已是最快）' : low && d < 0 && g0 === pl.flyGear ? '（已是最慢）' : ''}`, 1.3);
  }

  setGod(on) {
    this.god = !!on;
    try { localStorage.setItem('aotai_god', this.god ? '1' : '0'); } catch (e) { /* */ }
    const s = this.surv;
    if (!s) return;
    s.god = this.god;
    if (this.god) {
      s.fill();
    }
    if (this.state === 'play') this.msg(this.god ? IS_TOUCH ? '无敌模式已开启：所有指标锁满，不会受伤生病。快跑 10 米/秒（点「＋」「－」调速，最快 2 马赫），能跳 2 米高；长按「跳」起飞，踏空后摇杆往视线方向飞（抬头往上、低头往下），按住「跳」/「蹲」竖直升降，点「加速」/「减速」换档（最快 3.5 马赫），按住「蹲」降到地面才落地。' : '无敌模式已开启：所有指标锁满，不会受伤生病。快跑 10 米/秒（+/- 调速，最快 2 马赫），能跳 2 米高；长按空格起飞，踏空后 W 往视线方向飞（抬头往上、低头往下），空格 / C 竖直升降，滚轮或 +/- 换速度档（最快 3.5 马赫），按住 C 降到地面才落地。' : '无敌模式已关闭。', this.god ? 'good' : 'info');
  }

  gfxMenu(back) {
    document.exitPointerLock && document.exitPointerLock();
    const dpr = window.devicePixelRatio || 1;
    const cur = GFX[this.gfxKey];
    const rows = Object.entries(GFX).map(([k, L]) => `<p${k === this.gfxKey ? ' style="color:#d8b46a"' : ''}><b>${L.name}</b>${k === this.gfxKey ? '（当前）' : ''}：${L.desc}</p>`).join('');
    const btns = Object.entries(GFX).map(([k, L]) => ({ label: (k === this.gfxKey ? '✓ ' : '') + L.name, cls: k === this.gfxKey ? 'on' : '', action: () => { this.setGfx(k); this.gfxMenu(back); } }));
    btns.push({ label: '完成', action: back });
    const liteNow = IS_TOUCH || this.gfxKey === 'low' || this.gfxKey === 'mid';
    const note = liteNow !== this.liteAtBoot ? '<p style="color:#d8b46a">光影特效已经切换；材质精度、软阴影和草的密度要刷新页面后才会跟着换档。</p>' : '';
    this.ui.modal('画质', `${rows}${note}<p class="muted">当前：${cur.name} · 渲染倍率 ${fmt(this.perf.pr, 2)}×（屏幕 ${fmt(dpr, 1)}×）。画面糊就往上调，发烫卡顿就往下调。设置会自动保存。</p>`, btns);
  }

  pauseMenu() {
    document.exitPointerLock && document.exitPointerLock();
    this.ui.modal('暂停', `<p class="muted">时间已暂停。</p>`, [
      { label: '继续' },
      { label: '操作说明', action: () => setTimeout(() => this.ui.modal('操作说明', this.ui.helpHTML()), 0) },
      { label: `画质：${GFX[this.gfxKey].name}`, action: () => setTimeout(() => this.gfxMenu(() => this.pauseMenu()), 0) },
      { label: `无敌模式：${this.god ? '开' : '关'}`, cls: this.god ? 'on' : '', action: () => { this.setGod(!this.god); setTimeout(() => this.pauseMenu(), 0); } },
      { label: this.audio.master && this.audio.master.gain.value > 0 ? '静音' : '开启声音', action: () => { if (this.audio.master) this.audio.setMaster(this.audio.master.gain.value > 0 ? 0 : 0.8); } },
      { label: '返回标题', cls: 'danger', action: () => this.toTitle() },
    ]);
  }

  toTitle() {
    this.state = 'title';
    this.ui.hide('hud'); this.ui.hide('screen-end'); this.ui.hide('screen-inv'); this.ui.hide('screen-map');
    if (this.ui.modalOpen) this.ui.closeModal();
    this.ui.clearMsgs();
    this.player.model.visible = false;
    this.player.lamp.intensity = 0;
    if (this.campTent) { this.scene.remove(this.campTent); this.campTent = null; }
    this.clearFire();
    this.gameMin = 6 * 60 + 20;
    this.weather.cur = 'clear'; this.weather.next = null; this.weather.recompute(); this.weather.snowCover = 0;
    this.terrain.clearAll();
    this.terrain.update(this.titleX, routeZ(this.titleX), 0, true);
    $('fx-black').style.opacity = 0;
    this.ui.show('screen-title');
    try { $('btn-continue').style.display = localStorage.getItem('aotai_save') ? '' : 'none'; } catch (e) { /* */ }
  }

  msg(t, type) { this.ui.msg(t, type); if (type === 'crit') this.audio.warn(); }
  tip(key, text) { if (this.tips[key]) return; this.tips[key] = true; this.msg('💡 ' + text, 'warn'); }
  hurt(k) { this.hurtFx = Math.max(this.hurtFx, k); this.camShake = Math.max(this.camShake, k * 8); }

  // ===================== QTE =====================
  startQTE(text, win, ok, fail) {
    if (this.qte) return;
    this.qte = { t: win, total: win, ok, fail };
    $('qte-text').textContent = text;
    $('qte').style.display = 'block';
  }
  resolveQTE(success) {
    const q = this.qte; if (!q) return;
    this.qte = null;
    $('qte').style.display = 'none';
    success ? q.ok() : q.fail();
  }

  // ===================== 环境 =====================
  hour() { return (this.gameMin / 60) % 24; }

  // 脚下实际感受到的天气；山下时附带主脊上的天气（“山下下雨，山上下雪”）
  wxLabel() {
    const p = this.weather.p, L = this.wxLocal;
    const same = { icon: p.icon, name: p.name, ridge: null };
    if (L && (this.aboveCloud || 0) > 0.5) return { icon: this.night ? '🌙' : '☀', name: '云层之上', ridge: p.key === 'clear' ? null : p.icon + ' ' + p.name };
    if (!L || L.k > 0.6 || (!p.severe && p.key !== 'fog' && p.key !== 'rain')) return same;
    let icon = '☁', name = '阴';
    if (p.key === 'fog') { if (this.fogK > 0.5) return same; icon = '🌫'; name = '薄雾'; }
    else if (L.snow > 0.12 && L.snow >= L.rain) { icon = '🌨'; name = L.rain > 0.05 ? '雨夹雪' : '小雪'; }
    else if (L.rain > 0.06) { icon = p.thunder ? '⛈' : '🌧'; name = p.thunder ? '雷阵雨' : L.rain > 0.3 ? '中雨' : '小雨'; }
    else if (this.windLocal > 3.5) { icon = '🌬'; name = '起风降温'; }
    if (name === p.name) return same;
    return { icon, name, ridge: p.icon + ' ' + p.name };
  }

  updateEnvironment(dt) {
    const P = this.player.pos, W = this.weather;
    const hour = this.hour();
    const alt = this.altitude = yToAlt(P.y);
    const ti = terrainInfo(P.x, P.z);
    this.ti = ti;
    const sunY = this.sunDir ? this.sunDir.y : 0.5;
    const night = sunY < -0.04;
    const SS = SEASONS[this.seasonKey];
    // —— 天气的“在地强度” ——
    // 鳌太的一日四季来自南北气流在主脊上的对冲：越高、越开阔，天气越狠。
    // 山下林中同一场天气只是阴雨降温——风被山体挡住，雨雪被树冠截掉一部分，冰雹大多打不到林下，云雾压在主脊上。
    const altK = smoothstep(2200, 3350, alt);
    const inVillage = P.x < 0 || P.x > ROUTE_LENGTH - 40;
    const canopy = inVillage ? 0.5 : (CANOPY[ti.type] || 0);
    const wxK = this.wxK = lerp(0.3, 1, altK) * (1 - canopy * 0.25);
    const pK = lerp(0.55, 1, altK) * (1 - canopy * 0.4);
    const hK = lerp(0.12, 1, altK) * (1 - canopy * 0.7);
    const fK = lerp(0.18, 1, smoothstep(2350, 3150, alt));
    // 风雨雪雾都在云里：飞到云顶以上就没有了（云顶高度见 weather.js）
    const top = W.p.top || 4500;
    const above = this.aboveCloud = smoothstep(top - 100, top + 150, alt);
    const inK = 1 - above;
    this.wxLocal = { k: wxK, rain: (W.p.rainEff || 0) * pK * inK, snow: (W.p.snowEff || 0) * pK * inK, hail: (W.p.hailEff || 0) * hK * inK, fog: W.p.fog * fK * inK };
    if (above > 0.7 && !this.wasAbove) {
      this.wasAbove = true;
      if (W.p.cloud > 0.5) this.msg(`你钻出了云顶（海拔约 ${Math.round(top / 100) * 100} 米）：头顶一下子晴空万里，脚下是翻滚的云海。${W.p.key !== 'cloudy' && W.p.key !== 'fog' ? `主脊上的${W.p.name}都在云里，云层之上不会下。` : ''}`, 'good');
    } else if (above < 0.2) this.wasAbove = false;
    // 积雪只在雪线以上（与地表着色的雪线一致）：五月的塘口村不会有冰雪
    const snowLine = SS.snowLine - ((W.p.snowEff || 0) > 0.2 ? 350 : 0);
    this.snowLocal = W.snowCover * smoothstep(snowLine - 115, snowLine + 115, alt);
    let air = 18 + SS.temp - (alt - 1750) * 0.0063 + 4.8 * Math.cos((hour - 15) / 24 * Math.PI * 2) + W.p.temp * lerp(0.45, 1, altK);
    if (night) air -= W.p.cloud < 0.4 ? 3.5 : 1.2;
    this.airTemp = air;
    // 局部风力
    const EXP = { forest: 0.35, dead: 0.55, gully: 0.3, meadow: 0.85, ridge: 1, cliff: 1.12, stone: 0.95, pillars: 0.82 };
    let ex = EXP[ti.type] || 0.5;
    if (P.x < 0 || P.x > ROUTE_LENGTH - 40) ex = 0.3;
    if (ti.ad > 60) ex *= 0.8;
    ex *= 0.75 + clamp((alt - 2500) / 1000, 0, 1) * 0.35;
    let wind = W.p.windLevel * ex + DN.noise2(this.time * 0.15, 3) * 0.9 + (alt > 3300 && ex > 0.8 ? 0.8 : 0);
    if (this.hazards && this.hazards.gust.state === 'gust') wind += this.hazards.gust.mag * 1.2;
    // 离地越高越接近自由大气：主脊上乱窜的阵风、对冲气流没了，换成稳定的高空西风，越往上越大
    const free = this.freeAir = smoothstep(250, 1500, alt - yToAlt(groundAt(P.x, P.z).y));
    this.windRidge = Math.max(0, wind);   // 地面（树、草）感受到的风
    if (free > 0) wind = lerp(wind, jetLevel(alt, this.seasonKey), free);
    const wd = W.windDir;
    this.windDirLocal = (this.windDirLocal || new THREE.Vector2()).set(lerp(wd.x, 1, free), lerp(wd.y, 0, free)).normalize();   // +x 是东：西风往东吹
    // 避风处
    let shelter = null;
    if (this.world) for (const s of this.world.shelters) { if (Math.hypot(P.x - s.x, P.z - s.z) < s.r) { shelter = s; break; } }
    this.shelterNow = shelter;
    this.windLocal = Math.max(0, wind);
    this.fogK = smoothstep(0.004, 0.03, this.wxLocal.fog);
    this.night = night;
    const lamp = this.lampOn && this.inv && this.inv.battery.lamp > 0;
    this.darkness = smoothstep(0.02, -0.12, sunY) * (W.p.cloud > 0.8 ? 1 : 0.85);
    const nearFire = this.nearFire();
    const dark = this.darkness > 0.7 && !lamp && !nearFire && P.x > 5 && P.x < ROUTE_LENGTH - 30;
    // 开阔台地上可以离开路迹走一段，但走远了照样会迷失方向（起雾时四面八方都一样）
    const flying = this.player.flying;   // 飞在空中：不算迷路，也不会走到悬崖边
    const lost = !flying && ti.ad > (ti.type === 'cliff' || ti.type === 'ridge' ? 18 : 30 + openAt(P.x) * 45) && P.x > 15 && P.x < ROUTE_LENGTH - 20;
    // 断崖边缘提示（大雾中只能靠声音）
    const toEdge = edgeAt(ti.type, ti.d, P.x) - ti.ad;
    if (P.x > 70 && P.x < ROUTE_LENGTH - 90 && ti.type !== 'gully' && !flying) {
      if (toEdge < 6 && !this.edgeWarned) {
        this.edgeWarned = true;
        if (this.fogK > 0.5 || (this.darkness || 0) > 0.7) { this.audio.rockRoll(); this.msg('脚边踢落的碎石滚了下去，过了好几秒才传来回声……你可能正站在悬崖边上！', 'crit'); }
        else this.msg('前方地面陡然下切——那是悬崖！立刻往回走！', 'crit');
      }
      if (toEdge > 12) this.edgeWarned = false;
    }
    if (lost && !this.lost) { this.msg('你偏离了主脊！周围的一切都变得陌生……回到主脊的路迹上去，千万别往沟里走！', 'crit'); this.dangerCount++; }
    this.lost = lost;
    const key = W.p.key;
    const pl = this.player;
    const L = this.wxLocal;
    // 雨后的林间土路、火烧坡和草甸变成烂泥：陷脚打滑，体力消耗明显加大
    const mud = SOIL[ti.type] && !pl.onRock && !inVillage ? smoothstep(0.3, 0.85, W.wetGround) * SOIL[ti.type] : 0;
    this.envNow = {
      airTemp: air, wind: this.windLocal, rain: L.rain, snow: L.snow, hail: L.hail, damp: W.p.damp * this.fogK,
      fog: this.fogK, night, altitude: alt, moving: pl.moving && !this.sleeping, sprint: pl.sprinting, uphill: pl.uphill,
      stone: (ti.type === 'stone' || ti.type === 'pillars') && pl.moving, mud, sleeping: false, inTent: false, shelter, resting: pl.sitting,
      stance: pl.stance, wetGround: W.wetGround, warming: pl.warming, nearFire,
      lost, severe: !!W.p.severe && wxK > 0.6 && above < 0.5, goodWeather: key === 'clear' || key === 'cloudy',
      snowGlare: this.snowLocal > 0.4 && sunY > 0.15 && W.p.cloud < 0.6, poles: pl.polesOut, dark, snowCover: this.snowLocal,
    };
    return this.envNow;
  }

  updateLighting() {
    const W = this.weather.p;
    const hour = this.hour();
    const SS = SEASONS[this.seasonKey];
    const t = ((hour - SS.sunrise + 24) % 24) / 24;
    const D = (SS.sunset - SS.sunrise) / 24;
    const phi = t < D ? t / D * Math.PI : Math.PI + (t - D) / (1 - D) * Math.PI;
    const sunDir = this.sunDir = new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0.38).normalize();
    const sy = sunDir.y;
    const dayK = smoothstep(-0.12, 0.22, sy);
    const twi = smoothstep(-0.18, 0.02, sy) * (1 - smoothstep(0.04, 0.32, sy));
    // 飞到云顶以上：头顶没有云，阳光直射；越高天越蓝越深（空气稀薄，散射少）
    const flyAlt = this.state === 'play' ? yToAlt(this.player.pos.y) : 0;
    const ab = this.state === 'play' ? (this.aboveCloud || 0) : 0, hiK = smoothstep(4200, 10000, flyAlt);
    const light = lerp(W.light, 1, ab);
    const cloud = W.cloud * (1 - ab);
    const fogK = this.fogK || 0;
    const z = SKY.nightZ.clone().lerp(SKY.dayZ, dayK).lerp(SKY.setZ, twi * 0.7);
    const h = SKY.nightH.clone().lerp(SKY.dayH, dayK).lerp(SKY.setH, twi * 0.85);
    const grey = SKY.grey.clone().multiplyScalar(lerp(0.035, 1, dayK) * lerp(0.5, 1, light));
    z.lerp(grey, cloud * 0.8); h.lerp(grey, cloud * 0.75);
    if (hiK > 0) z.lerp(new THREE.Color(0.05, 0.13, 0.4).multiplyScalar(lerp(0.06, 1, dayK)), hiK * 0.6);
    const fogC = h.clone().lerp(SKY.fogGrey.clone().multiplyScalar(lerp(0.03, 1, dayK) * lerp(0.45, 1, light)), fogK);
    const U = this.sky.uniforms;
    U.uSunDir.value.copy(sunDir); U.uZenith.value.copy(z); U.uHorizon.value.copy(fogC);
    U.uSunColor.value.setRGB(1, lerp(0.55, 0.92, smoothstep(0, 0.4, sy)), lerp(0.3, 0.8, smoothstep(0, 0.4, sy))).multiplyScalar(smoothstep(-0.1, 0.05, sy));
    U.uCloud.value = cloud; U.uNight.value = 1 - smoothstep(-0.2, 0.0, sy);
    U.uCloudColor.value.setRGB(1, 1, 1).multiplyScalar(lerp(0.04, 1, dayK) * lerp(0.45, 1, light)).lerp(SKY.setH, twi * 0.5);
    U.uFogMix.value = clamp(fogK * 1.1, 0, 1);
    U.uTime.value = this.time;
    U.uFlash.value = this.weather.flash * 0.6;
    U.uRainbow.value = this.weather.rainbow * dayK;
    WATER_U.uTime.value = this.time; WATER_U.uSkyH.value.copy(fogC); WATER_U.uSkyZ.value.copy(z); WATER_U.uSunDir.value.copy(sunDir);
    WATER_U.uSunCol.value.copy(U.uSunColor.value).multiplyScalar(light * (1 - cloud * 0.8)); WATER_U.uFogC.value.copy(fogC); WATER_U.uDay.value = lerp(0.08, 1, dayK);
    this.scene.fog.color.copy(fogC);
    let dens = this.wxLocal ? this.wxLocal.fog : W.fog;
    if (this.state === 'title') dens = 0.0006;
    if (hiK > 0) dens = Math.max(dens, 0.0006 + hiK * 0.0011);   // 从高空往下看，地面隐进蓝灰色的霾里
    this.scene.fog.density = dens + (this.darkness || 0) * 0.002;
    WATER_U.uFogD.value = this.scene.fog.density;
    // 主光源：白天太阳，夜晚月亮
    const P = this.state === 'play' ? this.player.pos : this.camera.position;
    let ld = sunDir.clone(), li, lc;
    if (sy > -0.03) {
      li = 2.7 * smoothstep(-0.03, 0.15, sy) * lerp(0.15, 1, light) * (1 - fogK * 0.5);
      lc = new THREE.Color(1, lerp(0.6, 0.95, smoothstep(0, 0.35, sy)), lerp(0.4, 0.88, smoothstep(0, 0.35, sy)));
    } else {
      ld.set(-sunDir.x, Math.abs(sy) * 0.8 + 0.25, -sunDir.z + 0.3).normalize();
      li = 0.25 * (1 - cloud * 0.8) * smoothstep(-0.03, -0.2, sy);
      lc = new THREE.Color(0.55, 0.65, 0.95);
    }
    this.sun.intensity = li; this.sun.color.copy(lc);
    // 太阳贴着地平线时光线几乎平行于地面，阴影图会在坡上打出一道道条纹：这时把影子淡掉（直射光本来也很弱了）
    this.sun.shadow.intensity = smoothstep(0.012, 0.085, ld.y);
    // 阴影相机按阴影图的像素对齐着走：人移动时影子边缘不会一格一格地爬
    {
      const q = this._shq || (this._shq = { m: new THREE.Matrix4(), inv: new THREE.Matrix4(), v: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), o: new THREE.Vector3() });
      q.m.lookAt(ld, q.o, q.up); q.inv.copy(q.m).invert();
      const tex = SHADOW_HALF * 2 / this.sun.shadow.mapSize.x;
      q.v.copy(P).applyMatrix4(q.inv);
      q.v.x = Math.round(q.v.x / tex) * tex; q.v.y = Math.round(q.v.y / tex) * tex;
      q.v.applyMatrix4(q.m);
      this.sun.position.copy(q.v).addScaledVector(ld, 300);
      this.sun.target.position.copy(q.v);
    }
    // 材质共用的大气参数：主光方向、朝太阳看时雾里的暖光、谷底的霾、水洼涟漪
    {
      const WU = this.wxU, day = sy > -0.03;
      WU.uSunDir.value.copy(ld);
      const glowK = day ? smoothstep(-0.05, 0.1, sy) * lerp(0.2, 1, light) * (1 - cloud * 0.75) * (1 - fogK * 0.55) : 0.05 * (1 - cloud);
      WU.uFogSun.value.copy(day ? U.uSunColor.value : lc).multiplyScalar(glowK * 0.5);
      const baseY = profileY(clamp(P.x, 0, ROUTE_LENGTH));
      WU.uHaze.value.set(baseY - 95, 0.011, 0.0009 * lerp(0.3, 1, dayK) * (1 - fogK) * (1 - hiK), 0);
      WU.uRain.value = this.wxLocal && this.state === 'play' ? this.wxLocal.rain : 0;
      const E = this.postEnv || (this.postEnv = {});
      E.sun = this.sun; E.sunDir = sunDir; E.sunCol = U.uSunColor.value;
      E.sunOn = smoothstep(-0.02, 0.07, sy) * Math.pow(1 - cloud, 1.5) * (1 - fogK);
      E.fogD = this.scene.fog.density;
      // 体积光：有太阳、空气里有点水汽时最明显；浓雾里太阳本身就弱了
      E.vol = day ? smoothstep(-0.02, 0.12, sy) * (1 - cloud * 0.55) : 0.35;
      this.post.tune.volSigma = 0.0011 + Math.min(this.scene.fog.density * 0.22, 0.006) + (day ? (1 - smoothstep(0.05, 0.45, sy)) * 0.0012 : 0);
      // 自动曝光的范围：白天眼睛能适应明暗，夜里不许把黑夜提亮（黑就是黑，得开头灯）
      E.autoRange = [lerp(0.92, 0.68, dayK), lerp(1.12, 1.55, dayK)];
      // 山影：强度跟近处的阴影一起在地平线附近淡出；光太弱（阴天深夜）就不必算了
      const farK = li > 0.015 ? this.sun.shadow.intensity : 0;
      WU.uFarSh.value.z = this.farSh.ready ? farK : 0;
      E.far = this.farSh; E.farK = farK;
      if (this.midSh) WU.uMidSh.value.z = this.midSh.ready ? farK : 0;
      // 云影：云量适中时最明显（晴天零星几块，多云时大片阴影里漏下几块阳光），阴天整体已经暗了就不再叠；飞到云上面没有
      const csK = (day ? 0.62 : 0.35) * smoothstep(0.04, 0.14, cloud) * (1 - smoothstep(0.55, 1.0, cloud)) * (1 - fogK);
      const dtc = Math.min(this.postEnv.dt || 0.016, 0.1), wsp = (5 + (this.windLocal || 4) * 1.4) * 0.00034;
      const wdr = this.windDirLocal || this.weather.windDir;
      this.cloudDrift.x = (this.cloudDrift.x - wdr.x * wsp * dtc) % 1; this.cloudDrift.y = (this.cloudDrift.y - wdr.y * wsp * dtc) % 1;
      WU.uCloudSh.value.set(0.655 - cloud * 0.42, csK, this.cloudDrift.x, this.cloudDrift.y);
    }
    this.hemi.color.copy(z.clone().lerp(new THREE.Color(1, 1, 1), 0.3));
    this.hemi.groundColor.setRGB(0.22, 0.18, 0.12).multiplyScalar(lerp(0.1, 1, dayK));
    this.hemi.intensity = lerp(0.1, 1.0, dayK) * lerp(0.55, 1, light) + (1 - dayK) * 0.05;
    // 天空拍成环境贴图后，环境光主要来自它；半球光只留一点地面的反光补底
    const envOn = this.sky.updateEnv(this.renderer, this.postEnv && this.postEnv.dt || 0.016) || !!this.scene.environment;
    if (envOn) { this.hemi.intensity *= 0.3; this.scene.environmentIntensity = 0.5; }
    WATER_U.uRain.value = this.wxLocal && this.state === 'play' ? this.wxLocal.rain : 0;
    this.flashLight.intensity = this.weather.flash * 2.2;
    this.world && this.world.setNight(1 - dayK);
    // 云海
    const cs = this.cloudSea;
    const base = profileY(clamp(P.x, 0, ROUTE_LENGTH));
    cs.mesh.position.set(P.x, base - 95 - (this.state === 'title' ? 20 : 0), P.z);
    cs.uniforms.uTime.value = this.time; cs.uniforms.uCam.value.copy(this.camera.position);
    cs.uniforms.uCol.value.setRGB(1, 1, 1).multiplyScalar(lerp(0.05, 1.05, dayK) * lerp(0.5, 1, light)).lerp(SKY.setH, twi * 0.45);
    cs.uniforms.uShade.value.copy(cs.uniforms.uCol.value).multiplyScalar(0.62);
    cs.uniforms.uFogC.value.copy(fogC);
    const alt = yToAlt(P.y);
    // 云顶：飞上来时脚下的云层（云量越大越连成一片）
    const top = W.top || 4500, cd = this.cloudDeck;
    const deck = this.state === 'play' && this.player.flying ? smoothstep(top - 250, top + 50, alt) : 0;
    cs.uniforms.uAlpha.value = smoothstep(2500, 3100, alt) * (1 - fogK) * (1 - W.rain * 0.5) * (1 - deck);
    cs.mesh.visible = cs.uniforms.uAlpha.value > 0.02;
    cd.mesh.visible = deck > 0.01;
    if (cd.mesh.visible) {
      const U2 = cd.uniforms;
      cd.mesh.position.set(P.x, altToY(top), P.z);
      U2.uAlpha.value = deck; U2.uLo.value = lerp(0.68, 0.05, W.cloud); U2.uNear.value = 0;
      U2.uTime.value = this.time; U2.uCam.value.copy(this.camera.position);
      U2.uCol.value.copy(cs.uniforms.uCol.value); U2.uShade.value.copy(cs.uniforms.uShade.value); U2.uFogC.value.copy(fogC);
    }
    // 天气 uniform
    this.wxU.uTime.value = this.time;
    this.wxU.uSnow.value = this.weather.snowCover;
    this.wxU.uWet.value = this.weather.wetGround;
    this.wxU.uSnowLine.value = altToY(SEASONS[this.seasonKey].snowLine - ((this.weather.p.snowEff || 0) > 0.2 ? 350 : 0));
    const wl = (this.windLocal || W.windLevel) / 10;
    this.wxU.uWind.value.copy(this.weather.windDir).multiplyScalar(wl);
  }

  // ===================== 主循环 =====================
  frame() {
    const raw = this.clock.getDelta();
    let dt = Math.min(raw, 0.05);
    // 自适应分辨率：帧率低时自动降低渲染分辨率
    const P = this.perf;
    if (raw < 0.25) { P.acc += raw; P.n++; }
    if (P.acc > 2.5) {
      const avg = P.acc / P.n;
      let npr = P.pr;
      if (avg > 1 / 42 && P.pr > P.min) npr = Math.max(P.min, P.pr - 0.15);
      else if (avg < 1 / 58 && P.pr < P.max) npr = Math.min(P.max, P.pr + 0.1);
      if (npr !== P.pr) { P.pr = npr; this.renderer.setPixelRatio(npr); this.resize(); }
      P.acc = 0; P.n = 0;
    }
    this.time += dt;
    if (this.postEnv) this.postEnv.dt = raw;
    this.postU.uTime.value = this.time;
    this.postU.uFlash.value = this.weather ? this.weather.flash * 0.25 : 0;
    if (this.state === 'title') this.titleFrame(dt);
    else if (this.state === 'play') this.playFrame(dt);
    else if (this.state === 'dead' || this.state === 'end') this.endFrame(dt);
    this.ui.tick(dt);
    if (this.touch) this.touch.update();
    this.render();
  }

  titleFrame(dt) {
    this.titleX += dt * 6;
    if (this.titleX > ROUTE[7].x) this.titleX = ROUTE[4].x - 60;
    const x = this.titleX, z = routeZ(x) - 26;
    const y = Math.max(heightAt(x, z), profileY(x)) + 14;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(x + 60, profileY(x + 60) + 2, routeZ(x + 60) + 25);
    this.gameMin = 6 * 60 + 25;
    this.fogK = 0; this.darkness = 0; this.windLocal = 4;
    this.weather.update(dt, 6, 3000, 10);
    this.weather.p.cloud = 0.35; this.weather.p.light = 1;
    this.weather.updateVisuals(this.time % 600, this.camera.position, this.weather.windDir, false);
    this.terrain.update(x, z, 3);
    this.updateLighting();
    this.world.update(dt, this.time, new THREE.Vector2(3, 1), this.camera.position);
    this.updateParticles(dt);
    this.postU.uBlur.value = 0; this.postU.uDesat.value = 0; this.postU.uCold.value = 0; this.postU.uAber.value = 0; this.postU.uRed.value = 0; this.postU.uPulse.value = 0; this.postU.uExposure.value = 1;
    if (this.audio.ctx) { this.audio.env({ wind: 4, rain: 0, stream: 0, inside: 0 }); this.audio.update(dt, { heart: 0, breath: 0, forest: false, day: true, calm: 1 }); }
  }

  endFrame(dt) {
    this.deadT += dt;
    this.camera.position.y += dt * 0.6;
    this.camera.lookAt(this.player.pos);
    this.updateLighting();
    this.weather.updateVisuals(this.time % 600, this.camera.position, this.weather.windDir, false);
  }

  playFrame(dt) {
    const ui = this.ui;
    const paused = this.anyUI();
    if (paused) { this.updateLighting(); return; }
    const s = this.surv, inv = this.inv, pl = this.player;
    s.god = this.god;
    if (this.god) this.godUsed = true;
    // QTE 子弹时间
    let sdt = dt;
    if (this.qte) {
      sdt = dt * 0.35;
      this.qte.t -= dt;
      $('qte-fill').style.width = clamp(this.qte.t / this.qte.total * 100, 0, 100) + '%';
      if (this.qte.t <= 0) this.resolveQTE(false);
    }
    this.gameMin += sdt * GAME_MIN_PER_SEC;
    const hour = this.hour();
    const env = this.updateEnvironment(sdt);
    this.weather.update(sdt, hour, this.altitude, this.airTemp, (t, ty) => { if ((this.aboveCloud || 0) < 0.5) this.msg(t, ty); }, this.wxK);
    for (const ev of this.weather.events) {
      if (ev.type === 'rainbow') { this.msg('雨停了。一道彩虹横跨山谷，美得让人忘记了寒冷。', 'good'); this.surv.mental = Math.min(100, this.surv.mental + 8); }
      if (ev.type === 'windshift' && this.windLocal > 5 && (this.freeAir || 0) < 0.5) this.msg('风向突然变了，狂风从另一侧扑了过来！', 'warn');
    }
    for (const ev of this.weather.events) if (ev.type === 'lightning') {
      this.audio.thunder(ev.dist);
      const a = Math.random() * 6.28;
      this.weather.spawnBolt(new THREE.Vector3(pl.pos.x + Math.cos(a) * ev.dist, 0, pl.pos.z + Math.sin(a) * ev.dist), pl.pos.y - 50);
    }

    // 玩家
    const k = this.keys;
    this.input.f = !!k.f; this.input.b = !!k.b; this.input.l = !!k.l; this.input.r = !!k.r;
    this.input.sprint = !!k.sprint; this.input.crouch = !!k.crouch; this.input.jump = !!k.jump && !this.qte; this.input.jumpHold = !!k.jumpHeld && !this.qte; this.input.warm = !!k.warm;
    // 触屏摇杆：模拟量方向（电脑端恒为 0，走原来的 WASD 逻辑）
    const st = this.touch && this.touch.stick;
    this.input.ax = st ? st.x : 0; this.input.ay = st ? st.y : 0;
    if (k.yl) pl.camYaw -= dt * 1.8; if (k.yr) pl.camYaw += dt * 1.8;
    const [plo, phi] = pl.pitchRange();
    if (k.pu) pl.camPitch = clamp(pl.camPitch + dt * 1.2, plo, phi); if (k.pd) pl.camPitch = clamp(pl.camPitch - dt * 1.2, plo, phi);
    const coldSway = s.core < 34 ? Math.sin(this.time * 7) * (34 - s.core) * 0.04 : 0;
    // 鬼打墙：浓雾中没有指北针/GPS，方向感会慢慢偏移
    const navDev = this.navDevice();
    const fogDis = smoothstep(0.35, 0.85, Math.max(this.fogK, (this.darkness || 0) * (this.lampOn ? 0.4 : 0.8)));
    const lostSense = fogDis > 0.4 && !inv.has('compass') && !navDev;
    const senseK = inv.has('compass') ? 0.3 : navDev ? 0.45 : 1;
    const ghost = (DN.noise2(this.time * 0.045, 21) * 0.55 * fogDis * senseK) + (s.mental < 25 ? DN.noise2(this.time * 0.08, 33) * 0.35 : 0);
    // 视角在雾中缓慢偏转，你以为在走直线，其实在拐弯
    if (pl.moving) pl.camYaw += DN.noise2(this.time * 0.06, 47) * dt * 0.17 * fogDis * senseK;
    if (lostSense) this.tip('ghostwall', '浓雾里四周一模一样……你总觉得自己在绕圈子。没有指北针，方向感会慢慢偏移（鬼打墙）。');
    const mods = {
      drift: ghost, coma: s.coma, shiver: s.coma ? 0 : clamp((36.2 - s.core) / 1.5, 0, 1), tired: s.stamina < 18 && !pl.moving ? 1 : 0, load: clamp(inv.weight() / 30, 0, 1.2),
      locked: this.sleeping, speedMult: s.speedMult(env), canSprint: this.god || s.canSprint(), canJump: this.god || (s.stamina > 8 && !s.status.fracture), god: this.god, airT: this.airTemp,
      slideNY: (this.ti.ad < 9 ? 0.6 : 0.745) + (this.snowLocal > 0.35 && !inv.has('cramp') ? 0.08 : 0) + (this.weather.wetGround > 0.5 ? 0.03 : 0), stone: env.stone || ['stone', 'pillars'].includes(this.ti.type),
      poles: pl.polesOut, lean: 0, sway: coldSway,
    };
    // 低体温时操控漂移
    if (s.core < 33.5 || s.mental <= 0) { pl.camYaw += Math.sin(this.time * 0.7) * dt * 0.25; }
    pl.update(sdt, this.input, mods);
    k.jump = false;
    // 飞行 / 无敌模式边界：再往外就出了秦岭
    if (pl.flying || this.god) {
      const X0 = -2500, X1 = ROUTE_LENGTH + 2500, DZ = 4000;
      const zc = routeZ(clamp(pl.pos.x, X0, X1)), d = pl.pos.z - zc;
      if (pl.pos.x < X0 || pl.pos.x > X1 || Math.abs(d) > DZ) {
        pl.pos.x = clamp(pl.pos.x, X0, X1); pl.pos.z = zc + clamp(d, -DZ, DZ);
        pl.vel.x *= 0.2; pl.vel.z *= 0.2;
        this.tip('flyedge', '再往外就出了秦岭——这里是边界，掉头吧。');
      }
    }
    this.handlePlayerEvents();
    // 定位：GPS 精确；没有 GPS 时大雾/黑夜中估算偏差很大；没有指北针时方向也会乱
    const hasGPS = inv.has('gps') && inv.battery.gps > 0;
    const vis = Math.max(this.fogK, this.darkness * 0.7);
    const drift = hasGPS ? this.fogK * 8 : navDev === 'app' ? this.fogK * 20 + 2 : vis * 40 + 3;
    this.gpsPos.set(pl.pos.x + DN.noise2(this.time * 0.05, 1) * drift, pl.pos.y, pl.pos.z + DN.noise2(this.time * 0.05, 7) * drift);
    this.navJitter = !hasGPS && !inv.has('compass') ? DN.noise2(this.time * 0.3, 11) * vis * 1.2 : 0;
    if (!this.lastTrack || Math.hypot(pl.pos.x - this.lastTrack[0], pl.pos.z - this.lastTrack[1]) > 8) {
      this.lastTrack = [this.gpsPos.x, this.gpsPos.z];
      this.track.push(this.lastTrack); if (this.track.length > 90) this.track.shift();
      if (!this.trackAll.length || Math.hypot(this.gpsPos.x - this.trackAll[this.trackAll.length - 1][0], this.gpsPos.z - this.trackAll[this.trackAll.length - 1][1]) > 25) this.trackAll.push([this.gpsPos.x, this.gpsPos.z]);
    }
    this.updateFire(sdt, (t) => this.msg(t, 'info'));
    // 电量
    const coldBat = this.airTemp < 0 ? 1.5 : 1;
    if (inv.has('gps') && this.gpsOn) inv.battery.gps = Math.max(0, inv.battery.gps - 1.6 / SEC_PER_GAME_HOUR * sdt * coldBat);
    else if (inv.has('app') && this.gpsOn) {
      const before = inv.battery.phone;
      inv.battery.phone = Math.max(0, inv.battery.phone - 4.2 / SEC_PER_GAME_HOUR * sdt * (this.airTemp < 0 ? 2 : 1));
      if (before > 15 && inv.battery.phone <= 15) this.msg('手机电量只剩 15%，低温让电池掉得飞快。', 'warn');
      if (before > 0 && inv.battery.phone <= 0) this.msg('手机没电关机了——路引和轨迹全部消失。', 'crit');
    }
    if (this.lampOn && inv.has('lamp')) {
      inv.battery.lamp = Math.max(0, inv.battery.lamp - 5 / SEC_PER_GAME_HOUR * sdt * coldBat);
      if (inv.battery.lamp <= 0) { this.lampOn = false; this.msg('头灯没电了！四周陷入一片漆黑。', 'crit'); }
    }
    this.stanceLabel = pl.stanceLabel();
    pl.lamp.intensity = this.lampOn && inv.battery.lamp > 0 ? 45 * (inv.battery.lamp < 15 ? 0.5 + Math.random() * 0.2 : 1) : 0;
    pl.mats.lamp.emissiveIntensity = pl.lamp.intensity > 0 ? 3 : 0;

    // 危险
    this.hazards.update(sdt, this);
    this.fauna.update(sdt, this);
    this.updateGlory(sdt);
    // 生存
    s.update(sdt, env, {
      coma: () => { this.msg('你的意识越来越模糊……双腿一软，倒在了冰冷的地上。（重度失温昏迷）', 'crit'); this.audio.impact(0.6); this.hurt(0.5); },
      wake: () => this.msg('你挣扎着恢复了意识，浑身僵硬得几乎动不了。', 'warn'),
      msg: (t, ty) => this.msg(t, ty), gearChanged: () => pl.setGear(inv), vomit: () => { this.camShake = 4; this.audio.burst({ f: 300, q: 1, dur: 0.6, vol: 0.4 }); },
      onExpire: (kk) => {
        if (kk === 'tick') this.tickDropped(s, (t) => this.msg(t, 'warn'));
        if (kk === 'incub') { s.addStatus('fever', { t: 520 }); this.msg('你开始发高烧，浑身发冷、关节酸痛……想起一个多星期前那只蜱虫。（森林脑炎）', 'crit'); }
        if (kk === 'diarrhea') this.msg('肚子终于消停了。', 'good');
        if (kk === 'sprain') this.msg('脚踝的伤基本好了。', 'good');
        if (kk === 'snowblind') this.msg('眼睛的刺痛减轻了，视线渐渐清晰。', 'good');
      },
    });
    if (s.status.bleed && s.status.bleed.t < 2 && !inv.has('firstaid')) s.status.bleed.t = 2; // 无急救包时不会自止
    this.contextTips(env);
    // 救援
    if (this.rescue) this.updateRescue(sdt);
    // NPC 朝向、互动提示
    this.updatePrompt();
    // 到达
    this.checkArrival();
    // 死亡
    if (s.health <= 0) { this.die(s.cause || '体力衰竭'); return; }
    // 世界动态
    this.world.update(dt, this.time, this.weather.windDir.clone().multiplyScalar(this.windRidge ?? this.windLocal), this.camera.position);
    // 高速飞行时地形来不及细化：多给点时间，先保证脚下有地，石头和草等慢下来再补
    const fastFly = (pl.speed3 || 0) > 60;   // 高速飞行或无敌模式高速奔跑
    this.terrain.update(pl.pos.x, pl.pos.z, fastFly ? 9 : 4, false, fastFly);
    // 相机
    this.camShake = Math.max(0, this.camShake - dt * 6);
    const wob = (s.core < 34 ? (34 - s.core) * 0.4 : 0) + (s.altSick > 60 ? (s.altSick - 60) / 40 : 0) + (s.mental < 15 ? 0.5 : 0);
    pl.updateCamera(this.camera, dt, this.camShake + (this.windLocal > 7 && !pl.crouch && !pl.flying ? (this.windLocal - 7) * 0.4 : 0), wob, this.time);
    this.updateLighting();
    this.weather.updateVisuals(this.time % 600, this.camera.position, (this.windDirLocal || this.weather.windDir).clone().multiplyScalar(this.windLocal / 3), !!this.shelterNow && !this.shelterNow.weak, this.wxLocal);
    this.updateFX(dt);
    this.updateParticles(dt);
    this.updateAudio(dt);
    ui.updateHUD(this);
  }

  // 环境粒子：林子里的落叶、阳光里的浮尘、风吹雪、夏夜的萤火虫、天冷时呵出的白气
  updateParticles(dt) {
    const pl = this.player, W = this.weather, cam = this.camera;
    const E = this._fxE || (this._fxE = { wind: new THREE.Vector2(), light: new THREE.Color(), breath: { pos: new THREE.Vector3(), dir: new THREE.Vector3(), amount: 0 } });
    const play = this.state === 'play';
    const ti = this.ti || {}, alt = play ? (this.altitude || 0) : 3000, sy = this.sunDir ? this.sunDir.y : 1;
    const dayK = smoothstep(-0.05, 0.15, sy), cloud = W.p.cloud, fogK = this.fogK || 0, rain = play && this.wxLocal ? this.wxLocal.rain : 0;
    const forest = !play ? 0 : ti.type === 'forest' || ti.type === 'gully' ? 1 : ti.type === 'dead' ? 0.3 : 0;
    const sk = this.seasonKey, windL = this.windLocal || 0;
    E.time = this.time; E.dt = dt; E.cam = cam.position; E.season = sk;
    E.px = this.post.h * 0.5 * cam.projectionMatrix.elements[5];
    E.feetY = play ? pl.pos.y : cam.position.y - 3;
    E.wind.copy(this.windDirLocal || W.windDir).multiplyScalar(Math.min(windL, 12) * 0.55);
    E.leaves = forest * ({ autumn: 1, spring: 0.4, summer: 0.12, winter: 0 }[sk] || 0) * (1 - smoothstep(2700, 3100, alt)) * (0.35 + Math.min(1, windL / 7) * 0.65) * (1 - rain * 0.7);
    E.motes = dayK * (1 - cloud) * (1 - fogK) * (0.4 + forest * 0.6) * (1 - (this.aboveCloud || 0));
    E.glow = 1.5 * dayK;
    E.drift = play && (this.snowLocal || 0) > 0.25 && !pl.flying ? smoothstep(4.5, 9, windL) * Math.min(1, this.snowLocal * 1.5) : 0;
    E.fireflies = sk === 'summer' && forest > 0.5 ? (1 - dayK) * (1 - smoothstep(2600, 3000, alt)) * (1 - rain) : 0;
    E.sunCol = this.sky.uniforms.uSunColor.value;
    E.light.copy(this.scene.fog.color).multiplyScalar(1.15);
    const cold = play && !this.sleeping && !pl.hidden ? smoothstep(5, -6, this.airTemp ?? 10) * (1 - Math.min(1, (pl.speed3 || 0) / 30)) : 0;
    E.breath.amount = cold;
    if (cold > 0) {
      if (pl.firstPerson) { cam.getWorldDirection(E.breath.dir); E.breath.pos.copy(cam.position).addScaledVector(E.breath.dir, 0.4); E.breath.pos.y -= 0.14; }
      else { E.breath.dir.set(Math.sin(pl.yaw), 0, Math.cos(pl.yaw)); E.breath.pos.copy(pl.pos).addScaledVector(E.breath.dir, 0.2); E.breath.pos.y += pl.stance === 'prone' ? 0.3 : pl.stance === 'crouch' ? 1.05 : pl.sitting ? 1.0 : 1.6; }
    }
    this.fx.update(E);
  }

  updateGlory(dt) {
    this.gloryCool -= dt;
    const sy = this.sunDir ? this.sunDir.y : 0;
    const W = this.weather;
    const cond = sy > 0.04 && sy < 0.5 && this.altitude > 3250 && (W.p.key === 'cloudy' || (W.next === 'clear' && W.cur === 'fog') || (W.next === 'fog' && W.cur !== 'fog') || (this.fogK > 0.15 && this.fogK < 0.6));
    if (cond && this.gloryCool <= 0 && this.rng() < dt * 0.04) {
      this.gloryCool = 300; W.glory = 1;
      this.msg('你的影子投在脚下翻涌的云雾上，周围环绕着一圈圈七彩光环——佛光！你一动，光环里的人影也跟着动。', 'good');
      this.surv.mental = Math.min(100, this.surv.mental + 15);
      this.audio.bell();
    }
    this.glory.update(this.camera, this.sunDir || new THREE.Vector3(0, 1, 0), W.glory * (cond ? 1 : 0.4));
  }

  handlePlayerEvents() {
    const pl = this.player, s = this.surv;
    for (const ev of pl.events) {
      if (ev.type === 'step') {
        const surf = ev.rock ? 'rock' : this.snowLocal > 0.3 ? 'snow' : this.weather.wetGround > 0.5 ? 'wet' : 'grass';
        this.audio.step(surf, ev.speed * (ev.stance === 'stand' ? 1 : 0.5));
        if (surf === 'snow') this.fx.step(pl.pos, 'snow', Math.max(ev.speed, 2.5));
        else if (surf === 'grass' && ev.speed > 4.2 && this.weather.wetGround < 0.25 && !ev.rock) this.fx.step(pl.pos, 'dust', ev.speed);
        if (ev.pole && Math.random() < 0.6) this.audio.pole();
      } else if (ev.type === 'stomp') {
        this.audio.step(this.snowLocal > 0.3 ? 'snow' : 'grass', 5);
      } else if (ev.type === 'takeoff') {
        this.tip('fly2', IS_TOUCH ? '你踏空飞了起来！摇杆往前就朝视线方向飞——抬头往上、低头往下；按住「跳」/「蹲」竖直升降。点「加速」/「减速」换速度档，最快 3.5 马赫。按住「蹲」一直降到地面才会落地。'
          : '你踏空飞了起来！W 朝视线方向飞——抬头往上、低头往下，A/D 左右平移；空格 / C 竖直升降。滚轮或 +/- 换速度档，最快 3.5 马赫。按住 C 一直降到地面才会落地。');
      } else if (ev.type === 'ceiling') {
        this.tip('flyceil', `海拔 1 万米——飞行上限。这里气温零下四五十度，空气只有地面的三分之一，再往上就是平流层了。`);
      } else if (ev.type === 'boom') {
        this.audio.thunder(2); this.camShake = Math.max(this.camShake, 5);
        this.tip('boom', '「轰」的一声——你突破了音障！（音爆）');
      } else if (ev.type === 'knockdown') {
        this.camShake = Math.max(this.camShake, 6);
      } else if (ev.type === 'jump') {
        s.stamina = Math.max(0, s.stamina - 7 * s.loadFactor());
      } else if (ev.type === 'slideStart') {
        if (!this._slideMsgT || this.time - this._slideMsgT > 6) { this._slideMsgT = this.time; this.msg('脚下一滑——你正顺着陡坡向下滑坠！按住 C 尝试制动！', 'crit'); this.dangerCount++; }
      } else if (ev.type === 'land') {
        if (ev.speed > (this.god ? 10.5 : 7)) this.audio.impact(Math.min(0.8, ev.speed / 20));
      } else if (ev.type === 'impact') {
        if (this.god) { this.audio.impact(0.5); continue; }   // 无敌：摔多狠都没事
        const sp = ev.speed;
        const cliff = this.ti && (this.ti.type === 'cliff' || this.ti.ad > 30);
        const cause = sp > 26 ? '坠崖' : '滑坠摔伤';
        const dmg = sp > 30 ? 200 : (sp - 11) * 4.6;
        s.damage(dmg, cause);
        s.stats.falls++;
        this.hurt(Math.min(1, dmg / 50)); this.audio.impact(1);
        if (s.health > 0) {
          if (sp > 17 && Math.random() < 0.4) { s.addStatus('fracture', { splinted: false }); this.msg('你重重摔在乱石上——腿骨折了！', 'crit'); }
          else if (Math.random() < 0.45) { s.addStatus('sprain', { t: 700, bandaged: false }); this.msg('落地时扭伤了脚踝！', 'danger'); }
          if (Math.random() < 0.4) s.addStatus('bleed', { t: 100 });
          this.msg(cliff ? '你从陡坡上滚落下去，浑身是伤……' : '你摔得很重。', 'danger');
        }
      }
    }
  }

  contextTips(env) {
    const s = this.surv, inv = this.inv;
    if (s.core < 36.2 && s.balance < 0) this.tip('cold', '你在发抖。按 B 打开背包穿上保暖衣物，或者找个避风处。按住 J 原地跳动也能产热，但很耗体力。');
    if (s.core < 35.5 && s.coreCap < 36) this.tip('cap', '环境实在太冷了，靠运动只能勉强维持体温，暖不回来。必须加衣、扎营钻睡袋或找避风处！');
    if ((env.rain > 0.2 || env.snow > 0.2) && !inv.worn.has('shell') && !inv.worn.has('poncho')) this.tip('rain', '下雨了！立刻按 B 穿上冲锋衣/雨衣，否则很快会被淋透。');
    if (s.balance > 14 && this.player.moving) this.tip('sweat', '你出了很多汗。脱掉一层衣服，汗湿的衣服停下来后会让你迅速失温。');
    if (s.hydration < 35) this.tip('thirst', '口渴了。按 1 喝水。');
    if (inv.waterCap > 0 && (env.rain > 0.25 || this.snowLocal > 0.15) && inv.water < inv.waterCap * 0.7) this.tip('fieldwater', env.rain > 0.25
      ? '下雨了——这也是水源。停下来按 E 可以接雨水；有帐篷的话能躲在里面边避雨边接。'
      : '有积雪的地方就有水。停下来按 E 可以融雪取水（有炉子最快）。');
    if (inv.waterCap > 0 && inv.water < 0.5 && this.weather.wetGround > 0.55) this.tip('puddle', '水快喝完了。雨后的水洼也能舀水（按 E），但那是生水，要处理过再喝。');
    if (s.satiety < 35) this.tip('hunger', '肚子饿了。按 2 吃点东西，或在背包里选择食物。');
    if (s.exhausted) this.tip('exhaust', '体力耗尽了。按 R 坐下休息，或者放慢脚步。负重越大体力消耗越快。');
    if (this.altitude > 3000) this.tip('alt', '海拔已超过 3000 米。避免奔跑，注意高原反应。');
    const h = this.hour();
    const sset = SEASONS[this.seasonKey].sunset;
    if (h > sset - 1.5 && h < sset) this.tip('dusk' + Math.floor(this.gameMin / 1440), '天快黑了。尽快赶到营地，按 T 扎营过夜。');
    if (this.windLocal > 7 && this.player.stance === 'stand' && !this.player.polesOut && !this.player.flying) this.tip('gale', '风太大了！按 C 蹲行或 Z 匍匐降低重心，展开登山杖(X)能站得更稳。');
    if (this.darkness > 0.7 && !this.lampOn && inv.has('lamp')) this.tip('lamp' + Math.floor(this.gameMin / 1440), '天黑了，按 F 打开头灯。');
    if (s.status.bleed) this.tip('bleed' + Math.floor(this.gameMin / 600), '你在流血！按 3 使用急救包止血。');
    if (s.status.sprain && !s.status.sprain.bandaged && inv.has('bandage')) this.tip('sprain', '崴脚了。在背包里使用弹性绷带固定。');
    if (s.status.fracture && !s.status.fracture.splinted) this.tip('fracture', '骨折了！用急救包固定（按 3）。如果有卫星通讯器，考虑发送 SOS。');
    if (env.mud > 0.5 && this.player.moving) this.tip('mud', '雨后的土路变成了烂泥，每一步都陷脚、打滑，体力消耗明显变大。展开登山杖(X)，慢慢走。');
    if (s.wet > 60 && this.airTemp < 10) this.tip('wet', '你浑身湿透了。湿衣服会急剧加速失温——尽快找避风处，或扎营钻进睡袋。');
    if (s.health < 70) this.tip('heal', '生命不会一下子补满：只要没在流血 / 中毒、不太饿不太渴、身体不冷，它会自己慢慢恢复——走路时很慢，按 R 坐下休息快一些，扎营睡一觉恢复最多，吃热食更快。急救包能处理擦伤（+15）。');
  }

  updatePrompt() {
    const P = this.player.pos;
    let best = null, bd = 1e9;
    for (const it of this.world.interactables) {
      if (it.type === 'abandoned' && it.used) continue;
      const d = Math.hypot(P.x - it.x, P.z - it.z);
      if (d < it.r && d < bd) { bd = d; best = it; }
    }
    this.world.npcs.forEach((n, i) => {
      const d = Math.hypot(P.x - n.x, P.z - n.z);
      if (d < 4 && d < bd) { bd = d; best = { type: 'npc', npc: n, label: n.ranger ? '与管理站工作人员交谈' : '与驴友交谈' }; }
      const m = this.npcMeshes[i]; if (m && d < 20) m.rotation.y = Math.atan2(P.x - n.x, P.z - n.z);
    });
    if (this.fire && this.fire.left > 0) {
      const d = Math.hypot(P.x - this.fire.x, P.z - this.fire.z);
      if (d < 3.2 && d < bd) { bd = d; best = { type: 'fire', label: `火堆（还能烧约 ${fmt(Math.max(0.1, this.fire.left), 1)} 小时）` }; }
    }
    // 下撤段溪流：沿着整条溪都能取水
    if (P.x > STREAM.x0 + 30 && P.x < STREAM.x1 - 30) {
      const d = Math.abs(P.z - (routeZ(P.x) + STREAM.off));
      const frozen = SEASONS[this.seasonKey].water <= 0;
      if (d < 3.6 && d < bd) { bd = d; best = { type: 'water', dry: false, frozen, label: frozen ? '溪流已冻结（凿冰化水）' : '在溪边取水' }; }
    }
    // 野外就地取水：水壶没满、而且下着雨 / 有积雪 / 雨后有水洼时才提示
    const inv = this.inv;
    if (!best && (inv.waterCap > 0 ? inv.water < inv.waterCap - 0.15 : this.surv.hydration < 70)) {
      const fw = this.fieldWater();
      if (fw.any) best = { type: 'field', label: '就地取水：' + fw.primary };
    }
    this.nearInteract = best;
    const pr = $('prompt');
    if (best && !this.qte) { pr.innerHTML = `<b>E</b>${best.label}`; pr.style.display = 'block'; }
    else pr.style.display = 'none';
  }

  checkArrival() {
    const P = this.player.pos;
    while (this.reached < ROUTE.length - 1) {
      const i = this.reached + 1, w = ROUTE[i];
      if (P.x >= w.x - 6 && Math.abs(P.z - routeZ(w.x)) < 70) this.arrive(i); else break;
    }
  }

  arrive(i) {
    this.reached = i;
    const w = ROUTE[i], s = this.surv;
    this.audio.arrival();
    s.mental = Math.min(100, s.mental + (w.minor ? 4 : 10));
    const day = Math.floor(this.gameMin / 1440) + 1;
    this.ui.titleCard(`第 ${day} 天`, w.name, `海拔 ${w.alt} m`, w.minor ? '' : w.desc);
    if (w.end) { this.victory(); return; }
    if (w.name === '导航架') this.msg('你登上了鳌山之巅。真正的鳌太主脊在眼前铺展开来——而这只是开始。', 'good');
    if (w.name === '拔仙台') { s.mental = Math.min(100, s.mental + 15); this.msg('你站在了太白之巅，海拔 3771 米。眼泪不知道什么时候流了下来。接下来，是同样危险的下撤。', 'good'); }
    if (w.water !== undefined && !w.safe && this.world.waterState[i] === false) setTimeout(() => this.msg(`${w.name}的水源好像干涸了……`, 'warn'), 3000);
    if (!w.minor) this.saveCheckpoint();
  }

  // ===================== 动作 =====================
  toggleLamp() {
    if (!this.inv.has('lamp')) { this.msg('你没有头灯。', 'warn'); return; }
    if (this.inv.battery.lamp <= 0) { this.msg('头灯没电了。', 'warn'); return; }
    this.lampOn = !this.lampOn; this.audio.ui();
  }

  drink(L) {
    const inv = this.inv, s = this.surv;
    if (inv.water < 0.02) { this.msg('水壶已经空了！', 'danger'); return; }
    const a = Math.min(L, inv.water);
    const rawFrac = inv.water > 0 ? inv.waterRaw / inv.water : 0;
    const raw = a * rawFrac;
    inv.water -= a; inv.waterRaw = Math.max(0, inv.waterRaw - raw);
    s.hydration = Math.min(100, s.hydration + a / 0.025);
    s.stats.water += a;
    const tw = this.bottleTemp();
    const chill = s.coldDrink(a, tw);
    const fill = s.drinkFill(a);
    this.audio.drink();
    if (raw > 0.05 && !s.status.diarrhea && Math.random() < raw * 0.45 * this.diff.hazard) {
      setTimeout(() => { if (this.state === 'play' && s.addStatus('diarrhea', { t: 150 })) this.msg('肚子一阵绞痛……喝下去的生水不干净，你开始急性腹泻！', 'crit'); }, 6000);
    }
    const left = `你喝了 ${fmt(a, 2)} L 水。剩余 ${fmt(inv.water, 2)} L。`;
    if (tw < 8 && chill >= 0.08) {
      const cold = s.core < 35.5;
      this.msg(`${left}水冰得扎牙，灌下去浑身一激灵（核心体温 −${fmt(chill, 1)}℃）。${cold ? '你本来就在失温，这口冰水让你抖得更厉害了！' : ''}`, cold ? 'danger' : 'warn');
      this.tip('coldwater', '天冷时水壶里的水接近冰点，一大口灌下去会拉低核心体温。小口慢慢喝，别在身体发冷时猛灌；冷的时候吃点高热量的东西（巧克力、能量棒）更能暖身' + (inv.has('thermos') ? '，保温壶里有热水就喝热的（按 1 时身上冷会优先喝保温壶）。' : inv.has('stove') ? '，有炉子也可以在背包里选「喝热水暖身」。' : '。'));
    } else this.msg(left + (fill > 0.5 ? '空肚子灌点水，饿得没那么慌了。' : ''), 'info');
  }

  // 水壶里的水：背包里比气温稍暖，但冷天仍接近冰点
  bottleTemp() { return clamp((this.airTemp ?? 10) + 4, 0.5, 30); }

  quickEat() {
    const order = ['bar', 'choco', 'jerky', 'biscuit', 'meal', 'noodle'];
    const id = order.find(i => this.inv.has(i));
    if (!id) { this.msg('你没有食物了……', 'crit'); return; }
    this.eat(id, false);
  }

  eat(id, hot) {
    const inv = this.inv, s = this.surv, it = ITEMS[id];
    if (!inv.has(id)) return;
    if (s.satiety > 96) { this.msg('你吃不下了。', 'info'); return; }
    if (hot === 'flask') {
      if (inv.flask < 0.3 || inv.flaskT < 65) { this.msg(inv.flask < 0.3 ? '保温壶里的水不够泡一份了。' : `保温壶里的水只有 ${Math.round(inv.flaskT)}℃，泡不开了。`, 'warn'); return; }
      inv.flask -= 0.3;
    } else if (hot === 'fire') {
      if (inv.water < 0.3) { this.msg('水不够煮一份了。', 'warn'); return; }
      if (!this.heatUse('fire', 0, 15)) { this.msg('火已经灭了。', 'warn'); return; }
      inv.water -= 0.3; inv.waterRaw = Math.max(0, Math.min(inv.waterRaw, inv.water));
    } else if (hot) {
      if (inv.gasLeft() <= 0 || inv.water < 0.3) { this.msg('没有足够的燃气或水。', 'warn'); return; }
      inv.useGas(0.12); inv.water -= 0.3; inv.waterRaw = Math.max(0, Math.min(inv.waterRaw, inv.water));
    }
    inv.consume(id);
    const cold = s.core < 36.5 || s.balance < 0;
    s.satiety = Math.min(100, s.satiety + it.kcal / 20 * (hot || !it.hot ? 1 : 0.85));
    s.ingest(it.kcal);
    if (it.dry) s.hydration = Math.max(0, s.hydration - 4);
    if (it.quick) s.stamina = Math.min(s.maxStamina(), s.stamina + 25);
    if (id === 'jerky') s.mental = Math.min(100, s.mental + 3);
    if (hot) {
      s.core = Math.min(37.2, s.core + 0.3); s.mental = Math.min(100, s.mental + 9); s.hydration = Math.min(100, s.hydration + 8);
      s.addStatus('hotmeal', { t: 2 * SEC_PER_GAME_HOUR });
      this.msg(hot === 'flask' ? `你用保温壶里的热水泡了一份${it.name}，等了几分钟，热乎乎地吃了下去。` : hot === 'fire' ? `你在火上煮了一份热腾腾的${it.name}，带着一股柴烟味，一股暖流从胃里蔓延开来。` : `你烧水泡了一份热腾腾的${it.name}，一股暖流从胃里蔓延开来。`, 'good');
    } else if (cold) {
      this.msg(`你嚼着冰凉的${it.name}（+${it.kcal} kcal）。热量下了肚，接下来一两个小时身体会多产些热。`, 'good');
      this.tip('foodheat', '冷的时候吃东西也能暖身：身体的热量来自吃下去的食物，冷的热的都算。巧克力、能量棒、牛肉干这类高热量的东西吃下去，接下来一两个小时产热明显增加；吃饱的人也比饿肚子的人扛冻得多。热食热水暖得更快，但不是必需。');
    } else this.msg(`你吃了${it.name}（+${it.kcal} kcal）。`, 'info');
    this.audio.eat();
    if (this.player.firstPerson === false) this.player.sitting = false;
  }

  toggleWear(id) {
    const inv = this.inv;
    if (inv.worn.has(id)) { inv.worn.delete(id); this.msg(`你脱下了${ITEMS[id].name}。`, 'info'); }
    else { inv.worn.add(id); this.msg(`你穿上了${ITEMS[id].name}。`, 'info'); }
    this.audio.zip();
    this.player.setGear(inv);
  }

  dropItem(id) {
    const inv = this.inv;
    if (!inv.has(id)) return;
    if (inv.worn.has(id) && inv.items[id] <= 1) inv.worn.delete(id);
    const it = ITEMS[id];
    if (it.stack && ITEM_USES[id] && inv.uses[id] !== undefined) inv.uses[id] = Math.max(0, inv.uses[id] - ITEM_USES[id]);
    inv.consume(id);
    if (!inv.has(id)) delete inv.uses[id];
    if (inv.water > inv.waterCap) { inv.water = inv.waterCap; inv.waterRaw = Math.min(inv.waterRaw, inv.water); }
    if (inv.flask > inv.flaskCap) inv.flask = inv.flaskCap;
    this.player.setGear(inv);
    this.msg(`你丢弃了${it.name}，减轻了 ${it.weight} kg。`, 'info');
  }

  purify() {
    const inv = this.inv;
    if (inv.waterRaw < 0.01 || !inv.use('tablet')) return;
    inv.waterRaw = 0; this.msg('你往水壶里投了净水片。等半小时就能放心喝了。', 'good');
  }
  // 有没有能架在火上的锅：炉头的套锅或钛杯（保温壶是真空的，不能放火上烧）
  hasPot() { return this.inv.has('stove') || this.inv.has('cup'); }
  nearFire() { const f = this.fire, P = this.player.pos; return !!(f && f.left > 0 && Math.hypot(P.x - f.x, P.z - f.z) < 3.2); }
  // 烧水做饭的热源：src = 'fire' 用火堆（花时间、烧柴），否则用炉子（耗燃气）
  heatUse(src, gas, min) {
    if (src === 'fire') { if (!this.nearFire() || !this.hasPot()) return false; this.fire.left -= min / 60; }
    else if (!this.inv.useGas(gas)) return false;
    this.gameMin += min; return true;
  }
  boilWater(src) {
    const inv = this.inv;
    if (inv.waterRaw < 0.01 || !this.heatUse(src, clamp(inv.waterRaw * 0.3, 0.1, 2), src === 'fire' ? 20 : 15)) return;
    inv.waterRaw = 0; this.msg(src === 'fire' ? '你把生水架在火上烧开了。' : '你把生水烧开了。', 'good');
  }
  hotDrink(src) {
    const inv = this.inv, s = this.surv;
    if (inv.water < 0.3 || !this.heatUse(src, 0.1, 10)) return;
    inv.water -= 0.3; inv.waterRaw = Math.max(0, Math.min(inv.waterRaw, inv.water));
    // 0.3 L 约 70℃ 的水带进身体的热量和一口冰水带走的一样多（方向相反）：核心体温 +0.3℃ 左右
    s.hydration = Math.min(100, s.hydration + 12); s.core = Math.min(37.2, s.core + 0.3 * 33 * 0.028); s.mental = Math.min(100, s.mental + 6);
    s.drinkFill(0.3);
    s.addStatus('hotmeal', { t: SEC_PER_GAME_HOUR });
    this.audio.drink();
    this.msg('你捧着一杯热水慢慢喝下，冻僵的手指渐渐有了知觉。', 'good');
  }
  meltSnow(src) {
    const inv = this.inv;
    if (inv.water >= inv.waterCap || !this.heatUse(src, 1, src === 'fire' ? 40 : 30)) return;
    const a = Math.min(1.2, inv.waterCap - inv.water);
    inv.water += a;
    this.msg(src === 'fire' ? `你把锅架在火上，一锅一锅地化雪，攒了 ${fmt(a, 1)} L 水。` : `你铲了一锅雪，烧化成了 ${fmt(a, 1)} L 水。`, 'good');
  }

  // ===================== 篝火 =====================
  // 能不能生起火，看三样东西：附近有没有柴、柴湿不湿、风大不大（太冷时丁烷打火机也不好打火）
  fireOdds() {
    const ti = this.ti || {}, inv = this.inv, W = this.weather, L = this.wxLocal || {};
    const fuel = (FUEL[ti.type] ?? 0.3) * (this.altitude > 3400 ? 0.6 : 1) * (1 - (this.snowLocal || 0) * 0.5);
    const wet = clamp((L.rain || 0) * 1.3 + (W.wetGround || 0) * 0.55 + (this.snowLocal || 0) * 0.5 + (L.snow || 0) * 0.6 + (W.p.damp || 0) * (this.fogK || 0) * 3, 0, 1);
    const wind = this.windLocal || 0, tinder = inv.has('tinder');
    let p = 0.95 * (1 - wet * (tinder ? 0.45 : 0.85)) * (0.7 + 0.3 * Math.min(1, fuel));
    p *= wind > 8 ? (tinder ? 0.55 : 0.25) : wind > 6 ? (tinder ? 0.85 : 0.6) : 1;
    if (this.airTemp < -5) p *= tinder ? 0.9 : 0.7;
    if ((L.rain || 0) > 0.5 && !this.shelterNow) p *= 0.35;   // 大雨直接把火苗浇灭
    return { fuel, wet, wind, tinder, p: clamp(p, 0, 0.97), gatherH: clamp(0.4 / Math.max(fuel, 0.05), 0.4, 1.5) };
  }

  fireStartMenu() {
    const o = this.fireOdds(), P = this.player.pos;
    const pile = !!(this.woodPile && Math.hypot(P.x - this.woodPile.x, P.z - this.woodPile.z) < 4);
    const fuelTxt = o.fuel >= 0.8 ? '林子里到处是枯枝和倒木，柴火充足。' : o.fuel >= 0.25 ? '周围只有零星的灌木枯枝，得走远些、多花点时间才能捡够一堆。' : o.fuel >= 0.1 ? '这里几乎没有能烧的东西，只能在石缝里抠一点枯草和矮灌木。' : '这里是光秃秃的石头和草皮，找不到任何能烧的东西。';
    const wetTxt = o.wet > 0.6 ? '柴火全是湿的' : o.wet > 0.3 ? '柴火有些潮' : '柴火还算干';
    const windTxt = o.wind > 8 ? '，风大得火苗根本立不住' : o.wind > 6 ? '，风很大' : '';
    const chance = o.p > 0.75 ? '很容易点着' : o.p > 0.5 ? '多半能点着' : o.p > 0.25 ? '不太好点' : '很难点着';
    const btns = [];
    if (o.fuel >= 0.1) btns.push({ label: pile ? '再试着点火（柴已经捡好了）' : `捡柴生火（约 ${Math.round(o.gatherH * 60)} 分钟）`, action: () => this.startFire(pile) });
    btns.push({ label: '算了' });
    this.ui.modal('生火', `<p>${fuelTxt}</p>${o.fuel >= 0.1 ? `<p>${wetTxt}${windTxt}。看样子<b>${chance}</b>${o.tinder ? '（会用掉一块引火块）' : '；带着引火块会好点很多'}。</p>` : ''}<p class="muted">点着之后可以烤火取暖、烤干衣服${this.hasPot() ? '，架锅融雪、烧水、煮东西' : '；没有锅（炉头套锅或钛杯）就没法烧水煮东西'}。</p>`, btns);
  }

  startFire(pile) {
    const run = () => {
      const o = this.fireOdds(), inv = this.inv, P = this.player.pos;
      if (o.tinder) inv.use('tinder');
      this.gameMin += 10;
      if (o.fuel < 0.1) return '<p>你转了一大圈，什么能烧的都没找到。</p>';
      if (Math.random() >= o.p) {
        this.woodPile = { x: P.x, z: P.z };
        const why = o.wind > 6 && o.wet < 0.5 ? '风太大，火苗刚冒头就被吹灭了' : o.wet > 0.3 ? '柴火太湿，只冒了一阵呛人的白烟，怎么也燃不起来' : this.airTemp < -5 ? '打火机冻得打不出火，揣怀里焐热了也只蹿了一下就灭了' : '细枝烧完了，粗柴却没引着';
        return `<p>${why}。${o.tinder ? '引火块烧完了也没能把柴引着。' : ''}</p><p class="muted">柴还堆在这里，可以再试（T → 捡柴生火）。</p>`;
      }
      this.woodPile = null;
      this.makeFire(P.x, P.y, P.z, 2);
      this.tip('fire', '现实中秦岭保护区全年严禁野外用火：山火一旦烧起来，人跑不过火。干燥的大风天，火星很容易引燃枯草；离开前一定要把火彻底弄灭。');
      return `<p>火苗舔着细枝蹿了起来，你小心地往上架粗柴——火生起来了！${o.tinder ? '（用掉一块引火块）' : ''}</p><p class="muted">站在火边就能取暖、烤干衣服。靠近火堆按 E：烤火${this.hasPot() ? '、融雪、烧水、煮东西' : ''}、添柴。这堆柴大约能烧 2 小时。</p>` + this.wildfireCheck(o);
    };
    if (pile) { const html = run(); this.ui.modal('生火', html, [{ label: '确定' }]); return; }
    this.skipTime(this.fireOdds().gatherH, 'collect', { title: '捡柴生火', step: () => {}, done: run });
  }

  // 干燥的大风天，火星可能被卷进枯草——真实存在的山火风险
  wildfireCheck(o) {
    const ti = this.ti || {};
    if (o.wet > 0.15 || o.wind <= 5 || !['forest', 'dead', 'meadow', 'gully'].includes(ti.type)) return '';
    if (Math.random() > 0.1 + (o.wind - 5) * 0.04) return '';
    const s = this.surv; s.damage(3, '扑救山火时烧伤'); if (!this.god) s.mental = Math.max(0, s.mental - 10); this.dangerCount++;
    this.gameMin += 20; this.clearFire();
    return '<p style="color:#e0483c">一阵风把火星卷进了旁边的枯草里，火苗“呼”地蹿起半人高！你脱下外套拼命扑打，又捧土压了好一阵，才把它扑灭。手上燎起了几个水泡，火堆也被你踩散了。</p><p class="muted">干燥的大风天生火，火星很容易引燃枯草——这正是现实中禁止野外用火的原因。</p>';
  }

  makeFire(x, y, z, hours) {
    this.clearFire();
    const g = campfireModel();
    const light = new THREE.PointLight(0xff8a3a, 30, 18, 2); light.position.y = 0.9;
    g.add(light);
    g.position.set(x, y, z);
    this.scene.add(g);
    this.fire = { x, z, left: hours, mesh: g, light, ember: g.userData.ember, t: 0 };
    this.fx.setFire(g.position, 1);
  }
  clearFire() {
    if (this.fx) this.fx.setFire(null, 0);
    if (!this.fire) return;
    this.scene.remove(this.fire.mesh);
    this.fire.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });      // 材质是共用的，不销毁
    this.fire.ember.dispose();
    this.fire = null;
  }
  // 柴火燃烧：一抱柴约烧 2 小时；下雨下雪、风大都烧得更快，大雨可能直接把火浇灭
  updateFire(dt, note) {
    const f = this.fire; if (!f) return;
    const L = this.wxLocal || {};
    const wetK = (L.rain || 0) + (L.snow || 0) * 0.5;
    f.left -= dt / SEC_PER_GAME_HOUR * (1 + wetK * 2 + Math.max(0, (this.windLocal || 0) - 5) * 0.12);
    if ((L.rain || 0) > 0.5 && !this.shelterNow && Math.random() < dt * 0.02) f.left = 0;
    if (f.left <= 0) {
      const near = Math.hypot(this.player.pos.x - f.x, this.player.pos.z - f.z) < 40;
      this.clearFire();
      if (near && note) note(wetK > 0.3 ? '雨雪把火堆浇灭了，只剩一堆冒着白烟的湿炭。' : '火堆烧尽了，只剩一堆暗红的炭。');
      return;
    }
    f.t += dt;
    const k = Math.min(1, f.left / 0.4);   // 快烧完时火变小
    const fl = 0.85 + Math.sin(f.t * 13) * 0.08 + Math.sin(f.t * 7.3) * 0.06 + Math.random() * 0.05;
    this.fx.setFire(f.mesh.position, Math.max(0.12, k * fl));
    f.ember.color.setRGB(2.6 * k * fl, 0.62 * k * fl, 0.1 * k * fl);
    f.light.intensity = 30 * k * fl;
  }

  addWood() {
    const o = this.fireOdds();
    if (o.fuel < 0.1) { this.msg('附近已经找不到能烧的东西了。', 'warn'); return; }
    const P = this.player.pos;
    this.skipTime(o.gatherH, 'collect', { title: '添柴', step: () => {}, done: () => {
      if (!this.fire) { this.makeFire(P.x, P.y, P.z, 2); return '<p>等你抱着柴回来，火已经快灭了。好在炭还有余温，你吹了几口，又把它引着了。</p>' + this.wildfireCheck(o); }
      this.fire.left += 2;
      return `<p>你又捡回一抱柴架上，火堆还能烧约 ${fmt(this.fire.left, 1)} 小时。</p>` + this.wildfireCheck(o);
    } });
  }

  fireMenu() {
    if (!this.nearFire()) { this.msg('火已经灭了。', 'info'); return; }
    document.exitPointerLock && document.exitPointerLock();
    const inv = this.inv, s = this.surv, pot = this.hasPot(), f = this.fire;
    const again = (fn) => () => { fn(); if (this.nearFire()) setTimeout(() => this.fireMenu(), 60); };
    const btns = [];
    if (inv.has('basin')) btns.push({ label: '烧水泡脚…', action: () => this.footSoakMenu() });
    btns.push({ label: '烤火 1 小时', action: () => this.skipTime(1, 'rest', { title: '烤火', warm: true, step: () => {}, done: () => `<p>你凑在火边烤了一个小时。前胸烤得发烫，冻僵的手脚慢慢缓了过来${s.wet > 2 ? `，衣服还有 ${Math.round(s.wet)}% 潮` : '，衣服也烤干了'}。核心体温 ${fmt(s.core, 1)}℃。</p>` }) });
    if (pot) {
      btns.push({ label: '喝杯热水（10 分钟）', disabled: inv.water < 0.3, action: again(() => this.hotDrink('fire')) });
      if ((this.snowLocal || 0) > 0.25) btns.push({ label: '融雪（40 分钟，约 1.2 L）', disabled: inv.water >= inv.waterCap - 0.05, action: again(() => this.meltSnow('fire')) });
      if (inv.waterRaw > 0.01) btns.push({ label: '烧开生水（20 分钟）', action: again(() => this.boilWater('fire')) });
      if (inv.has('thermos')) btns.push({ label: '烧开水灌满保温壶（15 分钟）', disabled: inv.water < 0.05 || inv.flask > inv.flaskCap - 0.05, action: again(() => this.fillFlask('fire')) });
      for (const id of ['meal', 'noodle']) if (inv.has(id)) btns.push({ label: `煮${ITEMS[id].name}（15 分钟）`, disabled: inv.water < 0.3 || s.satiety > 96, action: again(() => this.eat(id, 'fire')) });
    }
    btns.push({ label: '添柴（再烧 2 小时）', action: () => this.addWood() });
    btns.push({ label: '把火弄灭', cls: 'danger', action: () => { this.clearFire(); this.msg('你用土把火堆压灭，又踩了几脚，确认没有一点火星了。', 'info'); } });
    btns.push({ label: '先这样' });
    this.ui.modal('火堆', `<p>火堆还能烧约 <b>${fmt(Math.max(0.1, f.left), 1)} 小时</b>。站在火边就能取暖、烤干衣服（现在潮湿度 ${Math.round(s.wet)}%，核心体温 ${fmt(s.core, 1)}℃）。</p>${pot ? '' : '<p class="muted">你没有锅（炉头套锅或钛杯），没法在火上烧水煮东西。</p>'}<p class="muted">水壶 ${fmt(inv.water, 2)} / ${fmt(inv.waterCap, 0)} L${inv.has('thermos') ? `；保温壶 ${fmt(inv.flask, 2)} L` : ''}</p>`, btns);
  }

  // ===================== 热水泡脚 =====================
  // 一盆 40℃ 左右的热水泡二十多分钟，脚上的血管扩张，热量顺着血流进身体：核心体温能回升半度左右。
  // 泡脚的水不入口，雪水、溪水、水洼的生水都行；要有盆，还要有火（火堆 + 锅，或炉子）。
  soakWater() {
    const inv = this.inv, P = this.player.pos;
    let near = null;
    for (const it of this.world.interactables) if (it.type === 'water' && Math.hypot(P.x - it.x, P.z - it.z) < it.r) { near = it; break; }
    const frozen = SEASONS[this.seasonKey].water <= 0;
    if (!near && P.x > STREAM.x0 + 30 && P.x < STREAM.x1 - 30 && Math.abs(P.z - (routeZ(P.x) + STREAM.off)) < 3.6) near = { frozen };
    if ((this.snowLocal || 0) > 0.25) return { kind: 'snow', label: '铲雪化水' };
    if (near && (near.frozen || frozen) && !near.dry) return { kind: 'snow', label: '凿冰化水' };
    if (near && !near.dry) return { kind: 'raw', label: '就近舀一盆溪水' };
    if (this.fieldWater().puddle) return { kind: 'raw', label: '舀一盆水洼里的积水' };
    if (inv.water >= 2.5) return { kind: 'bottle', label: '倒出水壶里的 2.5 L 饮用水' };
    return { kind: null, label: '附近没有雪、溪水或水洼，水壶里的水也不够 2.5 L' };
  }
  soakHeat(kind) {
    const snow = kind === 'snow';
    if (this.nearFire() && this.hasPot()) { const h = snow ? 0.85 : 0.5; return { src: 'fire', hours: h, ok: this.fire.left >= h + 0.45, label: `架锅在火上烧（约 ${Math.round(h * 60)} 分钟）`, why: '火快灭了，先添柴' }; }
    if (this.inv.has('stove')) { const gas = snow ? 2 : 0.6, h = snow ? 0.6 : 0.35; return { src: 'stove', gas, hours: h, ok: this.inv.gasLeft() >= gas, label: `用炉子烧（约 ${Math.round(h * 60)} 分钟，耗气 ${fmt(gas / 6 * 100, 0)}% 罐）`, why: '燃气不够烧一盆水' }; }
    if (this.nearFire()) return { ok: false, why: '有火，但没有能架在火上烧水的锅（炉头套锅或钛杯）' };
    return { ok: false, why: '没有火：先生一堆火（T → 捡柴生火），或者带上炉子' };
  }
  footSoakMenu() {
    const inv = this.inv, s = this.surv;
    if (!inv.has('basin')) { this.msg('你没有盆。', 'warn'); return; }
    const w = this.soakWater(), h = this.soakHeat(w.kind || 'raw');
    const ok = w.kind && h.ok;
    const warn = s.core < 34.5 ? '<p style="color:#e0483c">⚠ 你已经失温比较重了。这时先暖手脚，四肢冰冷的血会一下子流回心脏，核心体温反而会先往下掉。应该先暖躯干：烤火、钻睡袋、裹保温毯、喝热水、吃东西。</p>' : '';
    const sprain = s.status.sprain ? '<p style="color:#e8913a">⚠ 你的脚踝崴伤了：急性扭伤头两天应该冷敷，泡热水会肿得更厉害。</p>' : '';
    this.ui.modal('热水泡脚', `<p>水：${w.label}。${w.kind === 'bottle' ? '（附近没有雪和溪水，只能用饮用水了）' : ''}</p><p>火：${h.ok ? h.label : `<span style="color:#e8913a">${h.why}</span>`}。</p><p class="muted">水烧到 40℃ 左右，再泡 25 分钟。泡完擦干脚、换上干袜子。</p>${warn}${sprain}`,
      [{ label: '烧水泡脚', disabled: !ok, action: () => this.footSoak(w, h) }, { label: '算了' }]);
  }
  footSoak(w, h) {
    const inv = this.inv, s = this.surv;
    if (h.src === 'stove' && !inv.useGas(h.gas)) return;
    if (w.kind === 'bottle') { inv.water -= 2.5; inv.waterRaw = Math.max(0, Math.min(inv.waterRaw, inv.water)); }
    const total = h.hours + 0.42, need = Math.round(total * SEC_PER_GAME_HOUR), heatN = Math.round(h.hours * SEC_PER_GAME_HOUR);
    let n = 0, cs = null;   // cs：水烧好、脚放进去那一刻的核心体温（烧水时坐在火边，身子可能已经先暖过来了）
    this.skipTime(total, 'rest', { title: '热水泡脚', warm: true, step: () => { n++; if (n === heatN) cs = s.core; }, done: () => {
      const prep = (w.kind === 'snow' ? '你铲了几锅雪（冰）' : w.kind === 'raw' ? '你舀了一盆水' : '你倒出 2.5 L 饮用水') + (h.src === 'fire' ? '，架在火上一锅一锅烧热，倒进折叠盆里。' : '，用炉子烧热，倒进折叠盆里。');
      if (n < need - 1) return `<p>${prep}可还没泡多久就撑不下去了。</p>`;
      let html;
      if ((cs ?? s.core) < 34.5) {
        s.core -= 0.25;
        html = `<p>${prep}你把冻僵的脚泡进热水里……一阵刺骨的寒意反而从腿上涌了上来，身体抖得更厉害了（核心体温 −0.25℃）。</p><p class="muted">失温比较重时先暖手脚，四肢冰冷的血一下子流回心脏，核心体温会先往下掉（“复温后降”）。应该先暖躯干：烤火、钻睡袋、裹保温毯、喝热水、吃东西，缓过来再泡脚。</p>`;
      } else {
        const g = Math.max(0, Math.min(0.6, 37.2 - s.core)); s.core += g;
        s.mental = Math.min(100, s.mental + 8); s.energy = Math.min(100, s.energy + 3);
        s.addStatus('footbath', { t: 4 * SEC_PER_GAME_HOUR });
        html = `<p>${prep}你把脚泡进冒着热气的水里，一股暖流从脚底慢慢爬上来，冻木的脚趾一点点有了知觉。泡了二十多分钟，后背都微微出了汗${g >= 0.05 ? `（核心体温 +${fmt(g, 1)}℃）` : ''}。擦干脚、换上干袜子，整个人都松快了。</p>`;
      }
      if (s.status.sprain) { if (s.status.sprain.t !== undefined) s.status.sprain.t += 5 * SEC_PER_GAME_HOUR; html += '<p style="color:#e8913a">崴伤的脚踝一泡热水，肿得更厉害了——急性扭伤头两天应该冷敷。</p>'; }
      return html;
    } });
  }

  // ===================== 就地取水：雨水 / 积雪 / 水洼 =====================
  // 山上的水不一定都得从山下背：下雨可以接雨水，有积雪可以化雪，雨后的水洼也能舀（但要处理）。
  fieldWater() {
    const L = this.wxLocal || {};
    const rain = (L.rain || 0) + (L.snow || 0) * 0.3 + (L.hail || 0) * 0.2;   // 能接到的降水强度
    const canRain = rain > 0.08;
    const snow = (this.snowLocal || 0) > 0.15 || (L.snow || 0) > 0.25;
    const puddle = !snow && (this.weather.wetGround || 0) > 0.55 && this.airTemp > 0.5 && !(this.ti && this.ti.type === 'cliff');
    return { rain, canRain, snow, puddle, any: canRain || snow || puddle, primary: canRain ? '接雨水' : snow ? '融雪' : puddle ? '舀水洼积水' : '' };
  }

  // 用什么兜雨水：帐篷外帐最好（人还能躲在帐篷里），其次是铺开的雨衣，再次是锅，最差是只用水壶口接
  rainCatch() {
    const inv = this.inv;
    if (inv.has('tent4') || inv.has('tent3')) return { k: 1, tent: true, how: '你撑起帐篷，让雨水顺着外帐流进锅和水壶里' };
    if (inv.has('poncho')) return { k: 0.5, how: '你把一次性雨衣铺开兜成一个水槽' };
    if (inv.has('stove')) return { k: 0.25, how: '你把锅和水壶摆在石头上接水' };
    return { k: 0.12, how: '你拧开水壶，举着接雨' };
  }

  fieldWaterMenu() {
    const o = this.fieldWater(), inv = this.inv;
    if (!o.any) { this.msg('这里找不到水。下雨时可以接雨水，有积雪可以融雪，雨后的水洼也能舀水。', 'info'); return; }
    const hasCup = inv.waterCap > 0;
    const full = hasCup && inv.water > inv.waterCap - 0.05;
    const parts = [], btns = [];
    if (o.canRain) {
      const c = this.rainCatch(), rate = o.rain * 4 * c.k;
      parts.push(`<p>🌧 <b>雨水</b>比较干净，接到就能喝。${c.how}，按现在的雨势每小时大约能接 <b>${fmt(rate, 1)} L</b>${c.tent ? '，人躲在帐篷里不会被淋湿' : '——但接水的时候你也站在雨里'}。雨要是停了，就接不到了。</p>`);
      btns.push({ label: '接雨水 30 分钟', disabled: full, action: () => this.collectRain(0.5, c) });
      btns.push({ label: '接雨水 1 小时', disabled: full, action: () => this.collectRain(1, c) });
    }
    if (o.snow) {
      const stove = inv.has('stove') && inv.gasLeft() > 0;
      parts.push(`<p>❄ <b>积雪</b>可以化成水。${stove ? '用炉子融雪最快：30 分钟约 1.2 L，耗一次燃气。' : '没有炉子（或没气了），只能把雪塞进水壶、揣在怀里用体温慢慢化——很慢，还会带走不少体温。'}直接吃雪会让你越吃越冷。</p>`);
      if (stove) btns.push({ label: '用炉子融雪', disabled: full || !hasCup, action: () => this.meltSnow() });
      if (this.nearFire() && this.hasPot()) btns.push({ label: '在火上融雪（40 分钟）', disabled: full || !hasCup, action: () => this.meltSnow('fire') });
      if (hasCup) btns.push({ label: '体温化雪 1 小时', disabled: full, action: () => this.bodyMelt() });
      btns.push({ label: '直接吃几口雪', cls: 'danger', action: () => this.eatSnow() });
    }
    if (o.puddle) {
      parts.push(`<p>💧 雨后地上积着<b>水洼</b>，水很浑，是生水。${inv.has('tablet') ? '舀起来会自动投净水片。' : inv.has('stove') ? '舀起来记得烧开再喝。' : '没有净水片和炉子，喝了很可能腹泻。'}</p>`);
      btns.push({ label: '舀水洼里的积水', disabled: full, action: () => this.scoopPuddle() });
    }
    btns.push({ label: '算了' });
    this.ui.modal('就地取水', `<p class="muted">水壶 ${fmt(inv.water, 2)} / ${fmt(inv.waterCap, 0)} L${full ? ' · 已经满了' : ''}</p>${parts.join('')}`, btns);
  }

  // 没有水壶时，接到的水只能当场喝掉
  // tw：水温（直接趴在水边喝冰冷的水会降体温）；接雨水是一小时里慢慢喝的，不额外算
  // 快捷喝水：身上冷、保温壶里还有热水时先喝热的；水壶空了也喝保温壶
  quickDrink() {
    const inv = this.inv, s = this.surv;
    const warmFlask = inv.flask > 0.02 && inv.flaskT > 40;
    if (inv.flask > 0.02 && (inv.water < 0.02 || (warmFlask && (s.core < 36.6 || s.balance < 0 || (this.airTemp ?? 10) < 8)))) this.flaskDrink(0.25);
    else this.drink(0.25);
  }
  flaskDrink(L) {
    const inv = this.inv, s = this.surv;
    if (inv.flask < 0.02) { this.msg('保温壶已经空了。', 'warn'); return; }
    const a = Math.min(L, inv.flask), tw = inv.flaskT;
    inv.flask -= a;
    s.hydration = Math.min(100, s.hydration + a / 0.025); s.stats.water += a;
    s.drinkFill(a);
    // 和冰水同一个算法：水温高于体温就往身体里送热量（0.25 L 85℃ ≈ 核心 +0.3℃），低于体温就带走热量
    let d = 0;
    if (tw > 37) { d = Math.max(0, Math.min(37.2 - s.core, a * (tw - 37) * 0.028)); s.core += d; }
    else s.coldDrink(a, tw);
    if (tw > 45) { s.addStatus('hotmeal', { t: 0.5 * SEC_PER_GAME_HOUR }); s.mental = Math.min(100, s.mental + 3); }
    this.audio.drink();
    const feel = tw >= 65 ? '滚烫的热水，得吹着小口喝' : tw >= 48 ? '热乎乎的水' : tw >= 33 ? '温吞水' : '已经凉透的水';
    this.msg(`你拧开保温壶喝了 ${fmt(a, 2)} L ${feel}（${Math.round(tw)}℃）${d >= 0.05 ? `，一股热流顺着喉咙下去（核心体温 +${fmt(d, 1)}℃）` : ''}。保温壶还剩 ${fmt(inv.flask, 2)} L。`, tw > 45 ? 'good' : 'info');
  }
  // 用炉子把水壶里的水烧开灌进保温壶。海拔越高水的沸点越低：3500 米上 88℃ 左右就开了
  fillFlask(src) {
    const inv = this.inv;
    const a = Math.min(inv.flaskCap - inv.flask, inv.water);
    if (a < 0.05) return;
    if (!this.heatUse(src, Math.max(0.05, a * 0.3), src === 'fire' ? 15 : 10)) { this.msg(src === 'fire' ? '火已经灭了。' : '没有燃气了。', 'warn'); return; }
    const rawFrac = inv.water > 0 ? inv.waterRaw / inv.water : 0;
    inv.water -= a; inv.waterRaw = Math.max(0, inv.waterRaw - a * rawFrac);
    const bp = 100 - (this.altitude || 0) / 300;
    inv.flaskT = (inv.flask * inv.flaskT + a * bp) / (inv.flask + a); inv.flask += a;
    this.audio.drink();
    this.msg(`你烧开了 ${fmt(a, 2)} L 水灌进保温壶。这里海拔 ${Math.round(this.altitude || 0)} 米，水 ${Math.round(bp)}℃ 就开了。`, 'good');
  }
  drinkDirect(L, tw) {
    const s = this.surv; s.hydration = Math.min(100, s.hydration + L / 0.025); s.stats.water += L;
    s.drinkFill(L);
    if (tw !== undefined) s.coldDrink(L, tw);
  }

  collectRain(hours, c) {
    const inv = this.inv;
    let got = 0;
    this.skipTime(hours, 'collect', {
      title: '接雨水', tent: c.tent,
      step: (env) => { got += ((env.rain || 0) + (env.snow || 0) * 0.3 + (env.hail || 0) * 0.2) * 4 * c.k / SEC_PER_GAME_HOUR; },
      done: () => {
        if (inv.waterCap <= 0) { const a = Math.min(got, 0.8); this.drinkDirect(a); return `<p>你没有水壶，只能仰着头、用手捧着接雨水喝，喝下了大约 ${fmt(a, 1)} L。</p>`; }
        const a = Math.min(got, inv.waterCap - inv.water);
        inv.water += a;
        if (a < 0.05) return '<p>雨下得太小了，几乎没接到水。</p>';
        return `<p>${c.how}，接到了 <b>${fmt(a, 1)} L</b> 雨水。${got > a + 0.05 ? '水壶已经装满了。' : ''}</p>`;
      },
    });
  }

  bodyMelt() {
    const inv = this.inv, s = this.surv;
    this.skipTime(1, 'collect', {
      title: '体温化雪',
      step: () => { s.core -= 0.35 / SEC_PER_GAME_HOUR; },
      done: () => {
        const a = Math.min(0.5, inv.waterCap - inv.water);
        inv.water += a;
        return `<p>你把雪一把把塞进水壶，揣在贴身的衣服里。一个小时后，化出了 <b>${fmt(a, 1)} L</b> 冰凉的水——代价是你的胸口被冰得生疼，身体也更冷了。</p>`;
      },
    });
  }

  eatSnow() {
    const s = this.surv;
    s.hydration = Math.min(100, s.hydration + 5); s.core -= 0.3; s.stats.water += 0.2;
    this.gameMin += 5; this.audio.drink();
    this.msg(s.core < 35.5 ? '你抓起一把雪塞进嘴里……冰得牙根发痛，身体抖得更厉害了。再这样下去会失温的！' : '你抓起一把雪塞进嘴里，冰得牙根发痛。补了一点水分，但身体更冷了。', s.core < 35.5 ? 'danger' : 'warn');
  }

  scoopPuddle() {
    const inv = this.inv, s = this.surv;
    this.gameMin += 10;
    if (inv.waterCap <= 0) {
      this.drinkDirect(0.3, clamp(this.airTemp, 0.5, 20)); this.audio.drink();
      if (Math.random() < 0.5 * this.diff.hazard) setTimeout(() => { if (this.state === 'play' && s.addStatus('diarrhea', { t: 150 })) this.msg('水洼里的脏水让你开始腹泻！', 'crit'); }, 6000);
      this.msg('你趴在水洼边喝了几口浑水。', 'warn'); return;
    }
    const add = inv.waterCap - inv.water;
    inv.water = inv.waterCap;
    if (inv.has('tablet') && inv.use('tablet')) this.msg(`你从水洼里舀了 ${fmt(add, 1)} L 浑水，投进了净水片。等泥沙沉下去就能喝了。`, 'good');
    else { inv.waterRaw += add; this.msg(`你从水洼里舀了 ${fmt(add, 1)} L 浑水。这是生水，最好烧开或用净水片处理再喝。`, 'warn'); }
    this.audio.drink();
  }

  useItem(id) {
    const inv = this.inv, s = this.surv, st = s.status;
    const H = SEC_PER_GAME_HOUR;
    switch (id) {
      case 'firstaid': {
        let done = '';
        if (st.bleed) { delete st.bleed; done = '你用纱布和止血带处理了伤口，血止住了。'; }
        else if (st.poison) { delete st.poison; s.health = Math.min(100, s.health + 5); done = '你清洗了蛇咬伤口，挤出毒液并包扎好。'; }
        else if (st.fracture && !st.fracture.splinted) { st.fracture.splinted = true; done = '你咬着牙用夹板固定好了断腿。还能走，但很慢。'; }
        else if (st.sprain && !st.sprain.bandaged) { st.sprain.bandaged = true; done = '你用急救包里的绷带固定了脚踝。'; }
        else if (s.health < 90) { s.health = Math.min(100, s.health + 15); done = '你处理了身上的擦伤。'; }
        else { this.msg('你现在不需要急救。', 'info'); return; }
        inv.use('firstaid'); this.msg(done, 'good'); break;
      }
      case 'bandage':
        if (st.sprain && !st.sprain.bandaged) { st.sprain.bandaged = true; inv.consume('bandage'); this.msg('你用弹性绷带把崴伤的脚踝缠紧了。', 'good'); }
        else this.msg('现在不需要绷带。', 'info');
        break;
      case 'ibu':
        if (!inv.use('ibu')) return;
        s.addStatus('ibu', { t: 4 * H }); if (st.fever) s.core = Math.max(37.2, s.core - 0.8);
        this.msg('你吃了一片布洛芬。疼痛渐渐减轻了。', 'good'); break;
      case 'diamox':
        if (!inv.use('diamox')) return;
        s.addStatus('diamox', { t: 6 * H }); s.altSick = Math.max(0, s.altSick - 20);
        this.msg('你服下了抗高反药。头痛缓解了一些。', 'good'); break;
      case 'smecta':
        if (!st.diarrhea) { this.msg('你现在没有腹泻。', 'info'); return; }
        if (!inv.use('smecta')) return;
        st.diarrhea.t = Math.min(st.diarrhea.t, 10); this.msg('蒙脱石散起效了，肚子舒服了很多。', 'good'); break;
      case 'warmer':
        if (!inv.use('warmer')) return;
        s.addStatus('warmer', { t: 8 * H }); this.msg('你撕开一片暖宝宝贴在胸口，一股暖意慢慢渗进来。', 'good'); break;
      case 'blanket':
        inv.consume('blanket'); s.addStatus('blanket', { t: 4 * H }); this.msg('你把金色的急救保温毯裹在身上，热量流失大大减少。', 'good'); break;
      case 'power':
        if (!inv.use('power')) return;
        inv.battery.gps = 100; inv.battery.lamp = 100; inv.battery.phone = 100; this.msg('你给手机、GPS 和头灯充满了电。', 'good'); break;
      case 'elec':
        if (inv.water < 0.4 || !inv.use('elec')) return;
        inv.water -= 0.4; inv.waterRaw = Math.max(0, Math.min(inv.waterRaw, inv.water));
        s.hydration = Math.min(100, s.hydration + 22); s.energy = Math.min(100, s.energy + 5);
        s.addStatus('elec', { t: 3 * H }); this.msg('你冲了一杯电解质水，感觉身体轻松了些。', 'good'); break;
    }
    this.audio.ui();
  }

  useSpray() {
    if (!this.inv.has('spray')) { this.msg('你没有防兽喷雾！', 'warn'); return; }
    const t = this.hazards.nearestTakin(15);
    if (!t) { this.msg('附近没有需要驱赶的动物。', 'info'); return; }
    this.inv.use('spray');
    t.spray();
    this.audio.burst({ f: 3000, type: 'highpass', dur: 1.2, vol: 0.4, attack: 0.02 });
    this.msg('你对着羚牛按下了喷雾——刺鼻的辣椒雾让它掉头狂奔而去！', 'good');
  }

  // 没被发现的蜱虫吸饱血后会自己掉下来。病原体可能已经进了身体，但森林脑炎 / 莱姆病要潜伏一到两周才发病
  tickDropped(s, note) {
    note('你在小腿上摸到一个发硬的小红包，中间有个小黑点——一只吸饱了血的蜱虫已经自己掉了。');
    if (this.rng() < 0.5) s.addStatus('incub', { t: (7 + this.rng() * 7) * 24 * SEC_PER_GAME_HOUR });
  }

  checkBody() {
    const s = this.surv;
    this.gameMin += 10;
    if (s.status.tick) { delete s.status.tick; this.msg('你在小腿上发现了一只吸饱了血的蜱虫……你用镊子小心地把它连头拔了出来。', 'good'); this.ui.modal('检查身体', '<p>你在小腿上发现了一只吸饱了血的蜱虫，小心地连头拔了出来。</p><p class="muted">蜱虫可能传播森林脑炎、莱姆病，叮得越久风险越大。潜伏期一到两周：下山后如果发烧，要告诉医生被蜱虫咬过。在林区和草丛中行走后，记得检查身体。</p>'); }
    else this.msg('你仔细检查了一遍身体，没有发现蜱虫。', 'info');
  }

  sendSOS() {
    if (!this.inv.has('sat')) return;
    if (this.rescue) { this.msg(`救援已在路上。${this.rescue.paused ? '（因天气暂停）' : ''}`, 'info'); return; }
    const sev = this.envNow.severe;
    const hours = 9 + (this.altitude > 3300 ? 6 : 2) + this.rng() * 6;
    this.rescue = { t: hours * SEC_PER_GAME_HOUR, total: hours, paused: false };
    this.ui.hide('screen-inv');
    this.ui.modal('SOS 已发送', `<p>卫星通讯器的指示灯闪烁了几下——信号发出去了。</p><p>救援队收到了你的坐标，预计 <b>${Math.round(hours)}</b> 小时后抵达${sev ? '（当前天气恶劣，救援可能暂停）' : ''}。</p><p>保持体温，补充水分，原地等待或缓慢移动到开阔处。活下去。</p><p class="muted">注：鳌太线属于禁止穿越区域，救援费用将由当事人承担，并可能面临行政处罚。</p>`);
  }

  updateRescue(dt) {
    const r = this.rescue;
    const bad = this.envNow.severe || this.fogK > 0.6;
    if (bad && !r.paused) { r.paused = true; this.msg('卫星通讯器收到消息：天气恶劣，救援暂停。', 'danger'); }
    if (!bad && r.paused) { r.paused = false; this.msg('卫星通讯器收到消息：天气好转，救援队继续前进。', 'good'); }
    if (!r.paused) r.t -= dt;
    if (r.t <= 0) this.rescued();
  }

  // ===================== 互动 =====================
  interact() {
    const it = this.nearInteract;
    if (!it) return;
    document.exitPointerLock && document.exitPointerLock();
    const ui = this.ui, inv = this.inv, s = this.surv;
    switch (it.type) {
      case 'water': {
        if (it.frozen) {
          if (!inv.has('stove') || inv.gasLeft() <= 0) { this.msg('水源冻得结结实实。没有炉子和燃气，你只能啃几口冰，冻得牙齿打颤。', 'danger'); s.hydration = Math.min(100, s.hydration + 4); s.core -= 0.3; return; }
          if (inv.water >= inv.waterCap - 0.05) { this.msg('水壶已经满了。', 'info'); return; }
          inv.useGas(); const a = Math.min(1.5, inv.waterCap - inv.water); inv.water += a; this.gameMin += 30;
          this.msg(`你凿开冰面，烧化了 ${fmt(a, 1)} L 水。`, 'good'); this.audio.drink(); return;
        }
        if (it.dry) { this.msg('水坑早已干涸，只剩一滩龟裂的泥。', 'danger'); s.mental -= 5; return; }
        const add = inv.waterCap - inv.water;
        const springT = clamp(this.airTemp, 2, 10);   // 山泉水常年冰凉
        if (inv.waterCap <= 0) { this.msg('你没有任何水壶……只能用手捧着喝几口。', 'warn'); this.drinkDirect(0.25, springT); if (Math.random() < 0.35 * this.diff.hazard) s.addStatus('diarrhea', { t: 150 }); return; }
        this.drinkDirect(0.3, springT);
        if (add < 0.05) { this.msg('水壶已经是满的。你在水源边痛快地喝了几口。', 'info'); if (Math.random() < 0.15 * this.diff.hazard) s.addStatus('diarrhea', { t: 150 }); return; }
        inv.water = inv.waterCap;
        if (inv.has('tablet') && inv.use('tablet')) { this.msg(`你灌满了 ${fmt(add, 1)} L 水，并投入了净水片。`, 'good'); }
        else { inv.waterRaw += add; this.msg(`你灌满了 ${fmt(add, 1)} L 冰冷的生水。直接喝可能会腹泻。`, 'warn'); }
        this.audio.drink();
        break;
      }
      case 'sign': {
        const w = ROUTE[it.wp];
        ui.modal(w.name, `<p style="color:#d8b46a">海拔 ${w.alt} m</p><p>${w.desc}</p>`);
        break;
      }
      case 'lore': ui.modal('飞机残骸', `<p>${it.text}</p>`); break;
      case 'abandoned': {
        it.used = true;
        const loot = ['gas', 'biscuit', 'choco', 'warmer', 'bar'][(this.rng() * 5) | 0];
        inv.add(loot, 1);
        s.mental = Math.max(0, s.mental - 8);
        ui.modal('破损的帐篷', `<p>帐篷被风撕开了一道长长的口子，里面落满了雪和碎石。一只登山鞋、一个空了的气罐、一本被雨水泡烂的笔记本……</p><p>主人不知去向。也许他下撤了，也许没有。</p><p class="muted">你在角落里找到了：${ITEMS[loot].name}。你默默在心里说了声谢谢。（精神 −8）</p>`);
        break;
      }
      case 'temple': this.templeMenu(it); break;
      case 'field': this.fieldWaterMenu(); break;
      case 'fire': this.fireMenu(); break;
      case 'shop': this.shopMenu(it); break;
      case 'npc': this.talkNPC(it.npc); break;
    }
  }

  talkNPC(n) {
    const s = this.surv, inv = this.inv;
    if (n.ranger) {
      this.ui.modal('管理站工作人员', `<p>“这条线早就禁止穿越了，你知道吧？”他皱着眉头看了你半天，叹了口气。</p><p>“既然都走到这儿了……上拔仙台就往东，下撤走大文公庙、放羊寺、平安寺。到了平安寺往羊皮沟下，<b>只沿着溪流走，千万别钻野沟</b>。”</p><p>“小卖部有方便面和气罐，贵是贵点。”</p>`);
      if (!n.talked) { n.talked = true; s.mental = Math.min(100, s.mental + 10); }
      return;
    }
    const wp = n.wp;
    const nextWater = ROUTE.findIndex((w, i) => i > wp && w.water !== undefined && !w.safe);
    let line = NPC_LINES[(wp * 3 + (n.talked ? 1 : 0)) % NPC_LINES.length];
    if (nextWater > 0 && this.world.waterState[nextWater] === false) line = `听下撤的人说，${ROUTE[nextWater].name}那边今年的水源干了。你得多背点水，或者带上炉子融雪。`;
    let gift = '';
    if (!n.talked) {
      n.talked = true; s.mental = Math.min(100, s.mental + 10);
      const r = this.rng();
      if (r < 0.35) { inv.add('choco', 1); gift = '<p class="muted">他塞给你一块巧克力。“拿着，路上吃。”</p>'; }
      else if (r < 0.6 && inv.water < inv.waterCap - 0.5) { inv.water += 0.5; gift = '<p class="muted">他往你的水壶里倒了半升烧开过的水。</p>'; }
      else if (r < 0.75) { inv.add('warmer', 1); gift = '<p class="muted">他递给你一片暖宝宝。“夜里冷。”</p>'; }
    }
    this.ui.modal('同路的驴友', `<p>“${line}”</p>${gift}`);
  }

  templeMenu(it) {
    const w = ROUTE[it.wp];
    const big = w.name === '平安寺';
    const btns = [
      { label: '休息 1 小时', action: () => this.skipTime(1, 'temple') },
      { label: '在这里过夜', action: () => this.skipTime(this.hoursUntilDawn(), 'templeSleep') },
      { label: '离开' },
    ];
    if (big && !this.shopVisited.hotwater) {
      btns.unshift({ label: '向师父讨一碗热水', action: () => {
        this.shopVisited.hotwater = true; const s = this.surv, inv = this.inv;
        s.core = Math.min(37.3, s.core + 0.6); s.hydration = Math.min(100, s.hydration + 15); s.mental = Math.min(100, s.mental + 15);
        inv.water = inv.waterCap; inv.waterRaw = 0;
        if (inv.flaskCap) { inv.flask = inv.flaskCap; inv.flaskT = 92; }
        this.ui.modal('平安寺', `<p>老师父什么也没问，给你倒了一碗滚烫的开水，又把你的水壶${inv.flaskCap ? '灌满、保温壶也续满了开水' : '灌满了'}。</p><p>“山上下来的？阿弥陀佛。下山的路还长，慢慢走。”</p>`);
      } });
    }
    this.ui.modal(w.name, `<p>${w.desc}</p><p class="muted">在庙里可以避风避雨。没有帐篷的话，这里是过夜的好地方。</p>`, btns);
  }

  shopMenu(it) {
    const w = ROUTE[it.wp];
    const stock = SHOP_STOCK[w.name] || [];
    const render = () => {
      const inv = this.inv;
      let html = `<p class="muted">资金 ¥${inv.money} · 负重 ${fmt(inv.weight())}/${inv.backpack.cap} kg · 水 ${fmt(inv.water, 1)}/${fmt(inv.waterCap, 0)} L</p>`;
      stock.forEach(([id, price], k) => {
        const name = id === 'bottleWater' ? '瓶装水 1L' : ITEMS[id].name;
        html += `<div class="opt"><span>${name} <span class="muted">¥${price}</span></span><button class="btn small" data-buy="${k}">购买</button></div>`;
      });
      this.ui.modal(w.name === '大爷海' ? '大爷海小卖部' : '平安寺 · 斋堂', html, [{ label: '离开' }]);
      document.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
        const [id, price] = stock[+b.dataset.buy];
        if (inv.money < price) { this.msg('钱不够了。', 'warn'); return; }
        if (id === 'bottleWater') { if (inv.water > inv.waterCap - 0.99) { this.msg('水壶装不下了。', 'warn'); return; } inv.water += 1; }
        else { if (inv.weight() + ITEMS[id].weight > inv.backpack.cap) { this.msg('背包装不下了。', 'warn'); return; } inv.add(id, 1); }
        inv.money -= price; this.audio.buy(); render();
      });
    };
    render();
  }

  hoursUntilDawn() { const h = this.hour(), sr = SEASONS[this.seasonKey].sunrise + 0.2; return h >= 17 ? 24 - h + sr : h < sr ? sr - h : Math.min(8, 24 + sr - h); }

  campMenu() {
    const inv = this.inv, pl = this.player;
    const n = pl.terrainNormal(pl.pos.x, pl.pos.z);
    const hasTent = inv.has('tent3') || inv.has('tent4');
    const flat = n.y > 0.86 && !pl.onRock;
    const h = this.hour();
    const dawn = this.hoursUntilDawn();
    const bag = inv.has('bagm10') || inv.has('bag0') || inv.has('bag10');
    const warn = [];
    if (!flat) warn.push(pl.onRock ? '脚下全是乱石，帐篷搭在这里会非常难受。' : '这里坡度太大，睡不安稳。');
    if (!bag) warn.push('你没有睡袋。');
    if (this.windLocal > 7) warn.push(`现在风力 ${Math.round(this.windLocal)} 级。${inv.has('tent3') && !inv.has('tent4') ? '三季帐篷可能被撕裂！' : ''}`);
    if (this.shelterNow) warn.push(`你在${this.shelterNow.name}附近，这里相对避风。`);
    const btns = [];
    if (hasTent) {
      btns.push({ label: `搭帐篷睡到天亮（${Math.round(dawn)}h）`, action: () => this.skipTime(dawn, 'tent') });
      btns.push({ label: '搭帐篷睡 3 小时', action: () => this.skipTime(3, 'tent') });
    } else btns.push({ label: `露宿到天亮（${Math.round(dawn)}h）`, cls: 'danger', action: () => this.skipTime(dawn, 'outside') });
    btns.push({ label: '原地休息 1 小时', action: () => this.skipTime(1, 'rest') });
    if (this.nearFire()) btns.push({ label: '火堆…', action: () => this.fireMenu() });
    else if (inv.has('lighter')) btns.push({ label: '捡柴生火…', action: () => this.fireStartMenu() });
    btns.push({ label: '取消' });
    this.ui.modal('扎营', `<p>现在是 ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}，气温 ${fmt(this.airTemp, 0)}℃，体感 ${fmt(this.surv.teff, 0)}℃。</p>${warn.map(w => `<p style="color:#e8913a">⚠ ${w}</p>`).join('')}${!hasTent ? '<p style="color:#e0483c">你没有帐篷。在高海拔露宿极其危险。</p>' : ''}`, btns);
  }

  // 快速推进时间（睡觉/休息）
  // job：就地取水等需要原地耗时的事情 { title, tent, step(env), done() → html }
  skipTime(hours, mode, job) {
    const s = this.surv, inv = this.inv, pl = this.player;
    const steps = Math.round(hours * SEC_PER_GAME_HOUR);
    this.sleeping = true;
    pl.sitting = false;
    const black = $('fx-black');
    black.style.opacity = 1;
    const notes = new Set();
    let woke = null, qSum = 0, n = 0, torn = false, dressed = false;
    const tentMode = mode === 'tent' || !!(job && job.tent);
    const sleepMode = mode === 'tent' || mode === 'outside' || mode === 'templeSleep';
    const flat = pl.terrainNormal(pl.pos.x, pl.pos.z).y > 0.86 && !pl.onRock;
    setTimeout(() => {
      for (let i = 0; i < steps; i++) {
        this.gameMin += GAME_MIN_PER_SEC;
        const env = this.updateEnvironment(1);
        env.moving = false; env.sprint = false; env.resting = true;
        env.sleeping = sleepMode; env.inTent = tentMode; env.lost = false;
        if (mode === 'templeSleep' && !env.shelter) env.shelter = { weak: false };
        this.weather.update(1, this.hour(), this.altitude, this.airTemp, (t) => notes.add(t), this.wxK);
        this.updateFire(1, (t) => notes.add(t));
        // 睡眠质量
        let th = s.thermal(env);
        // 冷醒了就把背包里的保暖衣物都套上（真实的露营习惯：抓绒、羽绒服、帽子穿进睡袋里）
        if (!job && !dressed && th.balance < 0) {
          const more = ['fleece', 'down', 'hat'].filter(id => inv.has(id) && !inv.worn.has(id));
          if (more.length) {
            dressed = true; for (const id of more) inv.worn.add(id); pl.setGear(inv);
            notes.add(`${sleepMode ? '半夜冷醒，你摸黑把' : '坐着坐着冷了，你把'}${more.map(id => ITEMS[id].name).join('、')}都穿上了。`);
            th = s.thermal(env);
          }
        }
        let q = 1;
        if (th.balance < 0) q -= Math.min(0.8, -th.balance * 0.05);
        if (s.wet > 50) q -= 0.25;
        if (this.windLocal > 7) q -= 0.25;
        if (mode === 'outside') q -= 0.35;
        if (!flat && tentMode) q -= 0.25;
        if (s.mental < 30) q -= 0.2;
        if (s.status.footbath) q += 0.15;   // 脚暖了更容易入睡
        if (s.altSick > 50) q -= 0.3;
        env.sleepQ = clamp(q, 0.1, 1.2);
        qSum += env.sleepQ; n++;
        s.update(1, env, { msg: (t) => notes.add(t), gearChanged: () => pl.setGear(inv), onExpire: (kk) => { if (kk === 'tick') this.tickDropped(s, (t) => notes.add(t)); if (kk === 'incub') { s.addStatus('fever', { t: 520 }); notes.add('你在高烧中醒来，浑身发冷、关节酸痛……想起一个多星期前那只蜱虫。'); } } });
        if (job && job.step) job.step(env, i);
        // 帐篷被撕裂
        if (tentMode && !inv.tentDamaged && inv.has('tent3') && !inv.has('tent4') && this.windLocal >= 8 && this.rng() < 0.02) { inv.tentDamaged = true; torn = true; }
        if (s.health <= 0) { woke = 'dead'; break; }
        if (sleepMode && i > 20 && (s.core < 34.6 || s.health < 15 || s.hydration < 3)) { woke = s.core < 34.6 ? '你被冻醒了，浑身止不住地发抖……' : '你在剧烈的不适中醒来。'; break; }
        if (job && i > 3 && ((s.core < 34.8 && !job.warm) || s.health < 15)) { woke = '你冷得受不了，只好提前停了下来。'; break; }
      }
      this.sleeping = false;
      if (this.campTent) { this.scene.remove(this.campTent); this.campTent = null; }
      if (woke === 'dead') { black.style.opacity = 0; this.die(s.cause || '失温', true); return; }
      const avgQ = n ? qSum / n : 1;
      const qName = !sleepMode ? '' : avgQ > 0.9 ? '不错' : avgQ > 0.65 ? '一般' : avgQ > 0.4 ? '很差' : '几乎没睡着';
      let html = job ? job.done() : `<p>${sleepMode ? `你睡了 ${Math.round(n / SEC_PER_GAME_HOUR * 10) / 10} 小时。睡眠质量：<b>${qName}</b>。` : `你休息了 ${hours} 小时。`}</p>`;
      if (woke) html += `<p style="color:#e0483c">${woke}</p>`;
      if (torn) html += `<p style="color:#e0483c">夜里的狂风把你的三季帐篷撕开了一道大口子！之后的夜晚它将很难挡风挡雨。</p>`;
      for (const t of [...notes].slice(-4)) html += `<p class="muted">${t}</p>`;
      const h = this.hour();
      html += `<p class="muted">现在是第 ${Math.floor(this.gameMin / 1440) + 1} 天 ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}，天气：${this.wxLabel().name}，气温 ${fmt(this.airTemp, 0)}℃。</p>`;
      black.style.opacity = 0;
      this.ui.modal(job ? job.title : sleepMode ? '醒来' : '休息结束', html);
      pl.setGear(inv);
    }, 1300);
  }

  // ===================== 结局 =====================
  statsList() {
    const s = this.surv;
    const el = this.gameMin - (this.startMin || 7 * 60);
    const days = Math.floor(el / 1440), hrs = Math.floor((el % 1440) / 60);
    return [
      ['季节', SEASONS[this.seasonKey].full], ['用时', `${days} 天 ${hrs} 小时`], ['抵达', ROUTE[this.reached].name.replace(/（.*）/, '')], ['遭遇险情', `${this.dangerCount} 次`],
      ['最低体温', `${fmt(s.stats.minCore, 1)}℃`], ['最高高反', `${Math.round(s.stats.maxAlt)}`], ['消耗热量', `${Math.round(s.stats.kcal)} kcal`],
    ];
  }

  die(cause, instant) {
    if (this.state !== 'play') return;
    this.state = 'dead';
    this.deadT = 0;
    this.qte = null; $('qte').style.display = 'none';
    document.exitPointerLock && document.exitPointerLock();
    this.player.lamp.intensity = 0;
    $('fx-black').style.opacity = 0.7;
    this.audio.warn();
    const TEXT = {
      '失温': '失温是鳌太线上致死人数最多的原因。主脊上“一日四季”，淋湿加上大风，即使气温十几度也会在短时间内让人失温。从发抖、意识模糊到昏迷，往往只要几个小时。',
      '坠崖': '在麦秸岭、东跑马梁这样的刃脊上，大雾、湿滑和阵风足以让人失足坠落。偏离主脊、强行下沟，是坠崖与失踪事故最常见的起因。',
      '滑坠摔伤': '陡坡、碎石与积雪上的滑坠，往往在一瞬间发生。',
      '石海摔伤': '九重石海、金字塔、飞机梁的松动花岗岩，让每一步都可能是最后一步。',
      '被羚牛顶撞': '受惊的羚牛攻击性极强，曾多次造成人员伤亡。',
      '被落石砸中': '石海和陡坡上的落石毫无预兆。',
      '雷击': '雷暴天气里，山脊和山顶是最危险的地方。',
      '高原肺水肿': '高原肺水肿发展迅速。唯一有效的治疗是立即下撤。',
      '严重脱水': '两段长距离主脊之间可能连续十几公里没有稳定水源，一旦判断失误就会断水。',
      '饥饿与低血糖': '连续多日负重行进，热量缺口会让身体迅速崩溃。',
      '失血过多': '在远离救援的地方，一处无法处理的伤口就足以致命。',
      '蛇毒': '低海拔林区的毒蛇常常隐藏在草丛中。',
      '蜱虫叮咬引发的森林脑炎': '蜱虫可传播森林脑炎和莱姆病，潜伏期一到两周，之后突然发病。',
      '冰雹砸伤': '冰雹天气务必寻找遮蔽。',
      '精神崩溃': '在迷雾与孤独中，人会慢慢失去判断力。',
      '极度疲劳衰竭': '连续多日的透支，身体终于撑不住了。',
    };
    const cp = this.checkpoint;
    const cpName = cp ? ROUTE[cp.reached].name : null;
    setTimeout(() => {
      this.ui.hide('hud');
      this.ui.showEnd({
        kicker: '你 没 能 走 出 去', title: '遇 难', color: '#e0483c', cause: `死因：${cause}`,
        stats: this.statsList(),
        text: `<p>${TEXT[cause] || (cause.includes('失温') ? TEXT['失温'] + '体温降到 30℃ 左右时，人会突然失去意识倒下，再也没有醒来。' : '')}</p><p class="muted">现实中的鳌太线自 2018 年起已被禁止穿越。每一个名字背后，都是一个没有回家的人。</p>`,
        buttons: [
          ...(cp ? [{ label: `从「${cpName}」重新出发`, big: true, action: () => { this.ui.hide('screen-end'); $('fx-black').style.opacity = 0; this.loadRun({ seed: this.seed, diffKey: this.diffKey, season: this.seasonKey, snap: cp }); } }] : []),
          { label: '重新选购物资', action: () => { this.ui.hide('screen-end'); $('fx-black').style.opacity = 0; this.state = 'title'; this.toSeason(); } },
          { label: '返回标题', action: () => this.toTitle() },
        ],
      });
    }, instant ? 300 : 2200);
  }

  victory() {
    this.state = 'end';
    document.exitPointerLock && document.exitPointerLock();
    // 开着无敌走完的不计入通关次数（不然初始资金能随便刷）
    const godRun = this.god || this.godUsed;
    let wins = this.wins() + (godRun ? 0 : 1);
    try { localStorage.removeItem('aotai_save'); if (!godRun) localStorage.setItem('aotai_wins', String(wins)); } catch (e) { /* */ }
    const nextMoney = moneyForWins(wins);
    const s = this.surv;
    const score = this.dangerCount;
    const rating = s.health > 70 && score < 6 ? '老练的山野行者' : s.health > 40 ? '幸存者' : '九死一生';
    const incub = s.status.incub ? `<p style="color:#e8913a">下山后第 ${Math.max(1, Math.ceil(s.status.incub.t / (24 * SEC_PER_GAME_HOUR)))} 天，你突然发起高烧、浑身酸痛。好在你想起了腿上那个蜱虫叮过的红包，告诉了医生——确诊森林脑炎，住院两周后康复。</p>` : '';
    setTimeout(() => {
      this.ui.hide('hud');
      this.ui.showEnd({
        kicker: '你 活 着 走 了 出 来', title: '生 还', color: '#d8b46a', cause: `评价：${rating}`,
        stats: this.statsList(),
        text: `<p>炊烟、狗叫、柏油路——你回到了人间。回头望去，鳌太主脊隐没在翻滚的云层里，像从来没有存在过。</p>${incub}${godRun ? `<p style="color:#d8b46a">这次开了无敌模式，不计入通关次数（已真正通关 ${wins} 次）。下一次出发的初始资金：¥${nextMoney}</p>` : `<p style="color:#d8b46a">这是你第 ${wins} 次成功穿越。下一次出发的初始资金：¥${nextMoney}</p>`}<p class="muted">你很幸运。现实中的鳌太线自 2018 年起已被禁止穿越，请不要以身犯险。</p>`,
        buttons: [{ label: '再走一次', big: true, action: () => { this.ui.hide('screen-end'); this.state = 'title'; this.toSeason(); } }, { label: '返回标题', action: () => this.toTitle() }],
      });
    }, 4000);
  }

  rescued() {
    this.state = 'end';
    document.exitPointerLock && document.exitPointerLock();
    this.ui.hide('hud');
    this.ui.showEnd({
      kicker: '直 升 机 的 轰 鸣 声', title: '获 救', color: '#5aa0e0', cause: '你被救援队带下了山',
      stats: this.statsList(),
      text: `<p>救援队员把你裹进睡袋，抬上担架。你活下来了——但穿越失败了。</p><p class="muted">根据规定，非法穿越鳌太线遇险产生的救援费用由当事人承担，你还将面临行政处罚。</p>`,
      buttons: [{ label: '重新挑战', big: true, action: () => { this.ui.hide('screen-end'); this.state = 'title'; this.toSeason(); } }, { label: '返回标题', action: () => this.toTitle() }],
    });
  }

  debugNext() {
    const i = Math.min(this.reached + 1, ROUTE.length - 1);
    const x = ROUTE[i].x - 10;
    const z = routeZ(x);
    this.player.pos.set(x, groundAt(x, z).y + 0.5, z);
    this.player.vel.set(0, 0, 0); this.player.sliding = false; this.player.onGround = false;
    this.terrain.update(x, z, 0, true);
    this.msg(`（测试）传送到 ${ROUTE[i].name} 附近`, 'info');
  }

  // ===================== 特效 / 音频 / 渲染 =====================
  updateFX(dt) {
    const s = this.surv, U = this.postU;
    this.hurtFx = Math.max(0, this.hurtFx - dt * 1.2);
    let blur = 0;
    if (s.core < 34) blur += (34 - s.core) / 3.5;
    if (s.altSick > 60) blur += (s.altSick - 60) / 70;
    if (s.status.snowblind) blur += 0.6;
    if (s.exhausted) blur += 0.12;
    if (s.status.fever) blur += 0.2 + Math.sin(this.time * 1.5) * 0.1;
    if (s.health < 20) blur += 0.3;
    U.uBlur.value = clamp(blur, 0, 1.2);
    U.uDesat.value = clamp((40 - s.mental) / 40, 0, 1) * 0.65 + clamp((30 - s.health) / 30, 0, 1) * 0.3;
    U.uCold.value = clamp((36.6 - s.core) / 3, 0, 1) * 0.8 + clamp(-s.teff / 20, 0, 0.25);
    U.uAber.value = (s.altSick > 40 ? (s.altSick - 40) / 60 : 0) + (s.mental < 20 ? (20 - s.mental) / 25 : 0) + (s.status.fever ? 0.3 : 0);
    U.uPulse.value = s.altSick > 35 ? Math.max(0, Math.sin(this.time * 2.6)) * 0.08 * s.altSick / 100 : 0;
    U.uExposure.value = s.status.snowblind ? 1.7 : 1;
    U.uRed.value = this.hurtFx * 0.6 + (s.health < 30 ? (0.5 + 0.5 * Math.sin(this.time * 4)) * (30 - s.health) / 60 : 0);
    U.uGrain.value = 0.03 + this.fogK * 0.02 + (this.darkness || 0) * 0.03;
    U.uTime.value = this.time;
    $('fx-frost').style.opacity = clamp((36.3 - s.core) / 4, 0, 0.95);
    $('fx-blood').style.opacity = clamp(this.hurtFx * 0.8 + (s.health < 30 ? (30 - s.health) / 45 : 0), 0, 0.9);
    const rainOn = (this.wxLocal ? this.wxLocal.rain : 0) * (this.shelterNow && !this.shelterNow.weak ? 0.2 : 1);
    $('fx-drops').style.opacity = clamp(rainOn * 0.9, 0, 0.8);
    if (s.coma) { U.uBlur.value = 1.2; U.uDesat.value = 0.9; }
    $('fx-black').style.opacity = s.coma ? 0.55 + Math.sin(this.time * 0.8) * 0.2 : (this.sleeping ? 1 : 0);
    $('fx-vignette').style.opacity = 0.45 + (s.exhausted ? 0.35 : 0) + (1 - s.stamina / 100) * 0.2 + this.darkness * 0.2;
    $('fx-flash').style.opacity = clamp(this.weather.flash * 0.25, 0, 0.5);
  }

  updateAudio(dt) {
    const a = this.audio; if (!a.ctx) return;
    const s = this.surv;
    const inside = this.shelterNow && !this.shelterNow.weak ? 0.6 : 0;
    const ti = this.ti || {};
    const nearStream = ti.type === 'gully' || (this.altitude < 2300 && ti.ad < 20) ? 1 : 0;
    const L = this.wxLocal || { rain: 0, hail: 0 };
    a.env({ wind: this.windLocal, rain: Math.max(L.rain, L.hail * 0.8), stream: nearStream, inside });
    const danger = (s.health < 40 ? 1 : 0) + (s.core < 35 ? 1 : 0) + (this.envNow.severe ? 1 : 0) + (this.fogK > 0.5 ? 0.5 : 0) + (s.mental < 30 ? 1 : 0);
    a.update(dt, {
      heart: clamp(Math.max((45 - s.health) / 40, (30 - s.mental) / 30, this.qte ? 0.8 : 0), 0, 1),
      breath: clamp(Math.max((35 - s.stamina) / 35, this.player.sprinting ? 0.5 : 0, s.altSick > 50 ? 0.4 : 0), 0, 1),
      forest: ['forest', 'dead', 'gully'].includes(ti.type), day: !this.night, calm: clamp(1 - danger * 0.4, 0, 1),
    });
  }

  profileAt(x) { return profileY(x); }
  navDevice() {
    const inv = this.inv; if (!inv) return null;
    if (inv.has('gps') && inv.battery.gps > 0) return 'gps';
    if (inv.has('app') && inv.battery.phone > 0) return 'app';
    return null;
  }

  render() {
    this.sky.mesh.position.copy(this.camera.position);
    // 远距离地形阴影图：隔几帧重画一次（太阳走得慢，山影不需要每帧更新）
    this.frameNo++;
    if (this.postEnv && this.postEnv.farK > 0 && (this.frameNo % (QUAL.lite ? 8 : 3) === 0 || !this.farSh.ready)) {
      try { this.farSh.update(this.renderer, this.scene, this.wxU.uSunDir.value, this.camera.position); }
      catch (e) { console.error('[gfx] 远距离阴影图出错，已关闭', e); this.postEnv.farK = 0; this.wxU.uFarSh.value.z = 0; this.farSh.update = () => {}; }
    }
    // 中距离阴影图：走出十来米、太阳转了一度多、或者隔两秒（新的树加载进来了）才重画
    const MS = this.midSh;
    if (MS && this.postEnv && this.postEnv.farK > 0) {
      const st = this.midState, ld = this.wxU.uSunDir.value, P = this.state === 'play' ? this.player.pos : this.camera.position;
      st.t += this.postEnv.dt || 0.016;
      this.wxU.uMidC.value.set(P.x, P.y, P.z, SHADOW_HALF * 0.9);      // “从多远开始接手”跟着人走（近处那张阴影图也是跟着人走的）
      if (!MS.ready || st.t > 2 || (st.t > 0.25 && (st.c.distanceToSquared(P) > 144 || st.d.dot(ld) < 0.99978))) {
        st.t = 0; st.c.copy(P); st.d.copy(ld);
        try { this.terrain.withLowLod(() => MS.update(this.renderer, this.scene, ld, P)); }
        catch (e) { console.error('[gfx] 中距离阴影图出错，已关闭', e); this.midSh = null; this.wxU.uMidSh.value.z = 0; }
      }
    }
    this.post.render(this.scene, this.camera, this.postEnv || {});
  }
}

new Game();
