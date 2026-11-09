// ===================== 游戏数据：路线 / 物资 / 难度 =====================

// 游戏高度：game_y = (海拔 - 1000) * V_SCALE
export const V_SCALE = 0.22;
export const altToY = (alt) => (alt - 1000) * V_SCALE;
export const yToAlt = (y) => 1000 + y / V_SCALE;

// 时间：现实 1 秒 = 2.5 游戏分钟（1 游戏小时 = 24 秒）
export const GAME_MIN_PER_SEC = 2.5;
export const SEC_PER_GAME_HOUR = 60 / GAME_MIN_PER_SEC;

// seg：从此地标到下一地标的地形类型
// forest 林区爬升 / dead 火烧坡枯林 / meadow 高山草甸 / ridge 山脊 / cliff 悬崖窄脊 / stone 石海 / pillars 万仙阵石林 / gully 野沟
// open：开阔台地程度（0–1）。盆景园、西塬、东塬这类地方宽得看不到边，人在上面几乎感觉不到左右坡度
export const ROUTE = [
  { name: '塘口村', alt: 1750, seg: 'forest', len: 340, kind: 'village', water: 1, safe: true,
    desc: '秦岭北麓的小山村，鳌太穿越的起点。村口的牌子写着：“鳌太线严禁穿越”。' },
  { name: '火烧坡', alt: 2300, seg: 'dead', len: 320, kind: 'sign',
    desc: '多年前的一场山火留下满坡枯木，灰白的树干像墓碑一样立在陡坡上。' },
  { name: '2900营地', alt: 2900, seg: 'meadow', len: 220, open: 0.9, kind: 'camp', water: 0.8, camp: true,
    desc: '林线附近的平台，有一眼小泉水。很多人在这里度过穿越的第一夜。' },
  { name: '盆景园', alt: 3150, seg: 'meadow', len: 190, open: 1, kind: 'sign',
    desc: '被高山风雕琢得虬曲低矮的冷杉与杜鹃，宛如天然盆景。羚牛常在附近出没。' },
  { name: '白起庙', alt: 3300, seg: 'ridge', len: 160, kind: 'temple', shelter: true,
    desc: '一座低矮的石砌小庙，相传祭祀战国名将白起。庙里可以短暂避风。' },
  { name: '导航架', alt: 3476, seg: 'ridge', len: 220, kind: 'tower',
    desc: '鳌山最高点，海拔 3476 米。锈迹斑斑的金属导航架在风里呜呜作响。从这里开始，真正的鳌太主脊才刚刚展开。' },
  { name: '药王庙', alt: 3400, seg: 'ridge', len: 230, kind: 'temple', shelter: true, camp: true, water: 0.28,
    desc: '残破的药王庙遗址，石墙尚能挡风。附近偶有积水，但旱季常常干涸。' },
  { name: '麦秸岭（荞麦梁）', alt: 3450, seg: 'cliff', len: 230, kind: 'sign',
    desc: '狭窄的刃脊，一侧是深不见底的陡崖。大雾和阵风叠加时，这里是坠崖事故的高发地。' },
  { name: '水窝子营地', alt: 3360, seg: 'stone', len: 200, kind: 'camp', water: 0.45, camp: true,
    desc: '石海边的一处凹地营地，名字里带“水”，但水坑在旱季经常干得只剩泥。' },
  { name: '飞机梁·梁1', alt: 3520, seg: 'stone', len: 90, kind: 'wreck', minor: true,
    desc: '飞机梁因上世纪的一次空难得名，石缝间至今散落着飞机残骸。' },
  { name: '飞机梁·梁2', alt: 3500, seg: 'stone', len: 90, kind: 'sign', minor: true, desc: '第二道梁，乱石嶙峋。' },
  { name: '飞机梁·梁3', alt: 3540, seg: 'stone', len: 200, kind: 'sign', minor: true, desc: '第三道梁，翻过去就能看到 2800 营地。' },
  { name: '2800营地', alt: 3330, seg: 'stone', len: 200, kind: 'camp', water: 0.5, camp: true,
    desc: '石海环抱中的营地，有一处季节性水源。很多队伍在这里补水，也有很多队伍在这里发现无水可补。' },
  { name: '金字塔·塔1', alt: 3550, seg: 'stone', len: 90, kind: 'sign', minor: true, desc: '金字塔状的花岗岩峰，第一座。' },
  { name: '金字塔·塔2', alt: 3600, seg: 'stone', len: 90, kind: 'sign', minor: true, desc: '第二座金字塔，石块松动，小心落石。' },
  { name: '金字塔·塔3', alt: 3620, seg: 'stone', len: 200, kind: 'sign', minor: true, desc: '第三座金字塔，最高也最陡。' },
  { name: '西塬', alt: 3500, seg: 'meadow', len: 230, open: 1, kind: 'sign', camp: true,
    desc: '开阔的高山草甸台地。天好时一望无际，起雾时四面八方都长得一模一样。' },
  { name: '九重石海（太白梁）', alt: 3580, seg: 'stone', len: 320, kind: 'sign',
    desc: '鳌太线最长、最耗体力的石海。九重乱石无边无际，没有路迹，全凭方向感和地图。' },
  { name: '东塬', alt: 3520, seg: 'meadow', len: 220, open: 1, kind: 'sign', camp: true,
    desc: '石海尽头的另一片高山台地，风很大。' },
  { name: '万仙阵', alt: 3560, seg: 'pillars', len: 200, kind: 'sign',
    desc: '成片的巨石林立如阵，传说姜子牙在此大摆万仙阵。雾中的石柱看起来像一个个人影。' },
  { name: '雷公庙', alt: 3500, seg: 'ridge', len: 220, kind: 'temple', shelter: true,
    desc: '供奉雷公的小庙，坐落在雷暴最频繁的山脊上。' },
  { name: '东跑马梁', alt: 3600, seg: 'cliff', len: 230, kind: 'sign',
    desc: '又一段狭长的刃脊，两侧陡峭，风从南面的山谷直灌上来。' },
  { name: '大爷海', alt: 3590, seg: 'ridge', len: 130, kind: 'lake', water: 1, camp: true, shop: true, shelter: true,
    desc: '太白山最大的冰斗湖，湖边有一座石头房子，管理站和小卖部就在这里。' },
  { name: '拔仙台', alt: 3771, seg: 'ridge', len: 230, kind: 'summit',
    desc: '太白山主峰，海拔 3771.2 米，青藏高原以东的最高点。站在这里，整个秦岭都在脚下。' },
  { name: '大文公庙', alt: 3550, seg: 'meadow', len: 260, open: 0.6, kind: 'temple', shelter: true, camp: true, water: 0.6,
    desc: '高山上的文公庙，有简易的庇护所。从这里开始一路下撤。' },
  { name: '放羊寺', alt: 3200, seg: 'forest', len: 260, kind: 'temple', shelter: true,
    desc: '林线下的小寺，四周是太白红杉林。' },
  { name: '明星寺', alt: 2950, seg: 'forest', len: 230, kind: 'temple', shelter: true, water: 0.5,
    desc: '古寺遗迹，传说夜里能看到满天星斗落在寺顶。' },
  { name: '平安寺', alt: 2750, seg: 'gully', len: 380, kind: 'temple', shelter: true, camp: true, water: 1, shop: true,
    desc: '有僧人常住的寺院，可以讨一碗热水。名字很吉利，但下山的路还很长。' },
  { name: '羊皮沟', alt: 2050, seg: 'forest', len: 520, kind: 'sign', water: 1,
    desc: '灌木茂密、湿滑的下撤沟谷。很多迷路事故都发生在附近的无名野沟里——只沿着溪流走。' },
  { name: '鹦鸽镇', alt: 1000, seg: 'forest', len: 0, kind: 'village', water: 1, safe: true, end: true,
    desc: '终点。炊烟、狗叫、柏油路——你回到了人间。' },
];

// 计算每个地标的 x 坐标（路线沿 +X 自西向东）
let acc = 0;
for (const w of ROUTE) { w.x = acc; acc += w.len; }
export const ROUTE_LENGTH = ROUTE[ROUTE.length - 1].x;

// 路线中心线的 z 偏移（蜿蜒）
export function routeZ(x) {
  return 120 * Math.sin(x / 700) + 55 * Math.sin(x / 290 + 1.3) + 22 * Math.sin(x / 127 + 0.5);
}
export function routeDZ(x) { // dz/dx
  return 120 / 700 * Math.cos(x / 700) + 55 / 290 * Math.cos(x / 290 + 1.3) + 22 / 127 * Math.cos(x / 127 + 0.5);
}

// 游戏 1 单位 ≈ 现实 12.5 米（与时间压缩一致：步行约 1.5 km/h）
export const UNIT_M = 12.5;
export function routeDist(x0, x1) {
  if (x1 <= x0) return 0;
  let s = 0, step = 8;
  for (let x = x0; x < x1; x += step) { const h = Math.min(step, x1 - x); const dz = routeDZ(x + h / 2); s += h * Math.sqrt(1 + dz * dz); }
  return s;
}
export function fmtDist(units) { const m = units * UNIT_M; return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m'; }

export function segIndexAt(x) {
  if (x <= 0) return 0;
  for (let i = 0; i < ROUTE.length - 1; i++) if (x < ROUTE[i + 1].x) return i;
  return ROUTE.length - 2;
}

// ===================== 季节 =====================
// temp：基准气温偏移；sunrise/sunset：日出日落；snow0：初始积雪；water：水源倍率；bugs：蛇虫蜱倍率
// wx：天气权重倍率；foliage：植被色调
export const SEASONS = {
  spring: { name: '春', full: '春 · 五月', temp: -7, sunrise: 6.0, sunset: 19.2, snow0: 0.6, snowLine: 3150, water: 1.25, bugs: 0.8, fauna: 0.9, danger: 3,
    wx: { clear: 1, cloudy: 1, fog: 1.2, rain: 0.8, storm: 0.6, hail: 1.2, snow: 2.2, gale: 1.2 }, foliage: 'spring',
    desc: '主脊积雪未化，冰面湿滑，夜间可达零下十度。杜鹃花正在盛开，融雪让水源相对充足。春季暴雪常常不期而至。' },
  summer: { name: '夏', full: '夏 · 七月', temp: 3, sunrise: 5.5, sunset: 19.8, snow0: 0, snowLine: 3650, water: 1.3, bugs: 1.6, fauna: 1.3, danger: 2,
    wx: { clear: 0.8, cloudy: 1, fog: 1.8, rain: 2.2, storm: 2.4, hail: 1.3, snow: 0.25, gale: 0.8 }, foliage: 'summer',
    desc: '雨季。午后雷暴几乎天天都来，浓雾锁山，冷雨失温。高山草甸开满野花，林区蛇虫蜱虫最活跃。' },
  autumn: { name: '秋', full: '秋 · 九月', temp: -1, sunrise: 6.4, sunset: 18.7, snow0: 0, snowLine: 3300, water: 0.75, bugs: 0.7, fauna: 1, danger: 2,
    wx: { clear: 1.2, cloudy: 1, fog: 1, rain: 1, storm: 0.8, hail: 1, snow: 1, gale: 1.3 }, foliage: 'autumn',
    desc: '层林尽染，红叶金杉。天气相对稳定，但一日四季依旧，初雪随时会来。旱季水源大多干涸，断水是最大的威胁。' },
  winter: { name: '冬', full: '冬 · 一月', temp: -19, sunrise: 7.4, sunset: 17.6, snow0: 1, snowLine: 1900, water: 0, bugs: 0, fauna: 0.4, danger: 5,
    wx: { clear: 1, cloudy: 1, fog: 1, rain: 0.05, storm: 0.05, hail: 0.2, snow: 3, gale: 2.4 }, foliage: 'winter',
    desc: '冰封的鳌太。夜间零下二十五度，十级以上的风雪是常态，所有水源冻结，只能融雪取水。几乎没有人能在冬季走完。' },
};
export const WORLD = { season: 'autumn' };
export const season = () => SEASONS[WORLD.season];

// ===================== 资金：统一起步，每成功穿越一次增加 =====================
export const BASE_MONEY = 6000, WIN_BONUS = 1500, MAX_MONEY = 18000;
export const moneyForWins = (w) => Math.min(MAX_MONEY, BASE_MONEY + w * WIN_BONUS);

// ===================== 难度 =====================
export const DIFFICULTY = {
  easy:   { name: '驴友', money: 9000, hazard: 0.85, weather: 0.85, desc: '预算充足，天气相对温和。适合第一次体验。' },
  normal: { name: '老驴', money: 6000, hazard: 1.3, weather: 1.2, desc: '预算有限，需要在装备之间取舍。真实的鳌太。' },
  hard:   { name: '九死一生', money: 4000, hazard: 1.75, weather: 1.5, desc: '捉襟见肘的预算，频繁的恶劣天气。几乎不可能活着走出去。' },
};

// ===================== 背包 =====================
export const BACKPACKS = [
  { id: 'bp10', name: '轻量攻击包 25L', cap: 10, weight: 0.6, price: 199, eff: 1.12, desc: '无腰带，背负简陋。最大承重 10kg，负重一大就压肩。' },
  { id: 'bp20', name: '中型徒步包 45L', cap: 20, weight: 1.1, price: 399, eff: 1.0, desc: '标准徒步包，带腰带。最大承重 20kg。' },
  { id: 'bp30', name: '重装登山包 65L', cap: 30, weight: 1.7, price: 699, eff: 0.9, desc: '背负系统优秀，最大承重 30kg。' },
  { id: 'bp50', name: '超大重装包 90L', cap: 50, weight: 2.6, price: 1099, eff: 0.82, desc: '顶级背负，最大承重 50kg。能装下一切——包括你的执念。' },
];

// ===================== 物资 =====================
// cat: shelter cloth nav gear cook food med
// stack: 可叠加数量购买；max：最大数量
export const ITEMS = {
  // ---- 宿营 ----
  tent3:  { name: '三季帐篷', cat: 'shelter', price: 499, weight: 1.8, desc: '单人双层帐。抗风一般，8 级以上大风可能被撕裂。下雨时撑开外帐能接雨水，人还能躲在里面。' },
  tent4:  { name: '四季高山帐', cat: 'shelter', price: 1199, weight: 2.5, desc: '高山级防风帐，可抵御 10 级风雪。下雨时撑开外帐能接雨水，人还能躲在里面。' },
  bag10:  { name: '信封睡袋(舒适+10℃)', cat: 'shelter', price: 149, weight: 1.0, bag: 10, desc: '便宜，但在鳌太的夜里基本等于一张被单。' },
  bag0:   { name: '羽绒睡袋(舒适0℃)', cat: 'shelter', price: 599, weight: 1.1, bag: 0, desc: '三季羽绒睡袋，夏秋季的主流选择。' },
  bagm10: { name: '高山羽绒睡袋(舒适-10℃)', cat: 'shelter', price: 1099, weight: 1.5, bag: -10, desc: '暴雪之夜也能睡个好觉。' },
  pad:    { name: '防潮垫', cat: 'shelter', price: 79, weight: 0.4, desc: '隔绝地面寒气。没有它，冻土会一整夜吸走你的体温。' },
  // ---- 衣物 ----
  base:   { name: '速干排汗内衣', cat: 'cloth', price: 149, weight: 0.2, wear: true, insul: 2, desc: '排汗速干，减少出汗导致的潮湿。棉T恤湿了就是冰。' },
  fleece: { name: '抓绒衣', cat: 'cloth', price: 199, weight: 0.5, wear: true, insul: 6, desc: '中间保暖层，湿了也有一定保暖性。' },
  down:   { name: '羽绒服', cat: 'cloth', price: 699, weight: 0.7, wear: true, insul: 12, wetLoss: 0.85, desc: '保暖之王，但一旦被淋湿几乎失去保暖能力。' },
  shell:  { name: '冲锋衣裤(硬壳)', cat: 'cloth', price: 899, weight: 1.0, wear: true, insul: 3, windBlock: 0.7, rainBlock: 0.9, desc: '防风防水。鳌太线上最重要的一件装备。' },
  poncho: { name: '一次性雨衣', cat: 'cloth', price: 15, weight: 0.2, wear: true, insul: 0, windBlock: 0.1, rainBlock: 0.55, fragile: true, desc: '聊胜于无，大风中很快就会被撕烂。下雨时还能铺开来兜雨水。' },
  hat:    { name: '抓绒帽+手套', cat: 'cloth', price: 99, weight: 0.2, wear: true, insul: 3, desc: '头和手露在外面散热很快；手冻僵了连拉链都拉不上。' },
  boots:  { name: '高帮登山鞋', cat: 'cloth', price: 699, weight: 1.2, desc: '护踝防滑，大幅降低在石海崴脚的概率。没有它你穿的是运动鞋。' },
  gaiter: { name: '雪套绑腿', cat: 'cloth', price: 69, weight: 0.2, desc: '防止蜱虫、蛇咬和雨水灌进鞋里。' },
  // ---- 导航通讯 ----
  compass:{ name: '指北针', cat: 'nav', price: 49, weight: 0.1, desc: '屏幕顶部显示方位。大雾中能大大减轻方向感的偏移（鬼打墙）。' },
  map:    { name: '纸质地形图', cat: 'nav', price: 29, weight: 0.1, desc: '按 M 查看全线地图、海拔剖面和水源位置。没有它，只记得走过的地方。' },
  app:    { name: '手机离线轨迹APP', cat: 'nav', price: 199, weight: 0.25, desc: '提供路引（下一站方向与距离）和轨迹小地图。手机很耗电，低温下掉电更快；大雾里定位漂移明显。' },
  gps:    { name: 'GPS手持机(含轨迹)', cat: 'nav', price: 1499, weight: 0.3, desc: '提供路引和轨迹小地图，定位精准，续航长、耐低温。专业穿越的标配。' },
  sat:    { name: '卫星通讯器', cat: 'nav', price: 2499, weight: 0.2, desc: '主脊几乎没有手机信号。它是唯一能发出 SOS 的东西。' },
  lamp:   { name: '头灯', cat: 'nav', price: 129, weight: 0.1, desc: '按 F 开关。没有头灯，夜里寸步难行。' },
  power:  { name: '充电宝', cat: 'nav', price: 99, weight: 0.3, stack: true, max: 3, desc: '为手机、GPS 和头灯充满一次电。' },
  // ---- 装备 ----
  poles:  { name: '登山杖(一对)', cat: 'gear', price: 199, weight: 0.5, desc: '按 X 展开/收起。展开后石海和湿滑处更稳、抗阵风、爬坡省力。' },
  cramp:  { name: '冰爪', cat: 'gear', price: 259, weight: 0.6, desc: '积雪结冰后防止滑坠。' },
  glasses:{ name: '太阳镜', cat: 'gear', price: 149, weight: 0.05, desc: '雪后晴天防止雪盲。' },
  spray:  { name: '防兽喷雾', cat: 'gear', price: 199, weight: 0.3, stack: true, max: 3, desc: '按 Q 喷射，驱赶冲过来的羚牛。每罐可用一次。' },
  // ---- 炊具饮水 ----
  bottle: { name: '水壶(1L)', cat: 'cook', price: 29, weight: 0.15, stack: true, max: 8, desc: '每个增加 1L 携水量。水本身也很重：1 升 = 1 公斤。路上可以在水源灌水，下雨时接雨水，有积雪时融雪。' },
  stove:  { name: '炉头+气罐', cat: 'cook', price: 199, weight: 0.5, desc: '烧水做饭（含一罐气）。一罐气约能融 6 锅雪（每锅 1.2 L），或烧 60 杯热水。热食热水提振精神；还能融雪取水、煮沸生水。' },
  gas:    { name: '备用气罐', cat: 'cook', price: 39, weight: 0.3, stack: true, max: 5, desc: '每罐约能融 6 锅雪，或烧 60 杯热水。' },
  tablet: { name: '净水片(10片)', cat: 'cook', price: 39, weight: 0.05, stack: true, max: 4, desc: '处理生水，防止急性腹泻。' },
  // ---- 食物 ----
  meal:   { name: '脱水米饭', cat: 'food', price: 35, weight: 0.2, stack: true, max: 20, kcal: 650, hot: true, desc: '650 kcal。用热水泡更好吃，冷泡也能吃。' },
  biscuit:{ name: '压缩饼干', cat: 'food', price: 10, weight: 0.12, stack: true, max: 30, kcal: 500, dry: true, desc: '500 kcal。很干，吃了会更渴。' },
  bar:    { name: '能量棒', cat: 'food', price: 12, weight: 0.05, stack: true, max: 30, kcal: 220, quick: true, desc: '220 kcal，快速恢复体力，吃下去身体也会多产点热。' },
  choco:  { name: '巧克力', cat: 'food', price: 18, weight: 0.1, stack: true, max: 20, kcal: 540, quick: true, desc: '540 kcal，高热量，冷天的好朋友：吃下去一两个小时里身体产热明显增加。' },
  jerky:  { name: '牛肉干', cat: 'food', price: 30, weight: 0.15, stack: true, max: 20, kcal: 450, desc: '450 kcal，补充蛋白质和精神。' },
  noodle: { name: '方便面', cat: 'food', price: 5, weight: 0.12, stack: true, max: 20, kcal: 450, hot: true, desc: '450 kcal。一碗热面能救命。' },
  elec:   { name: '电解质泡腾片', cat: 'food', price: 25, weight: 0.05, stack: true, max: 5, desc: '每片：喝水时额外恢复水分，缓解疲劳。' },
  // ---- 药品 ----
  firstaid:{ name: '急救包', cat: 'med', price: 129, weight: 0.4, stack: true, max: 3, desc: '止血、固定骨折、处理咬伤。每个可用 2 次。' },
  bandage:{ name: '弹性绷带', cat: 'med', price: 19, weight: 0.05, stack: true, max: 4, desc: '固定崴伤的脚踝。' },
  ibu:    { name: '布洛芬', cat: 'med', price: 19, weight: 0.02, desc: '止痛退烧，缓解高反头痛（6 次）。' },
  diamox: { name: '抗高反药', cat: 'med', price: 49, weight: 0.02, desc: '乙酰唑胺。预防和缓解高原反应（4 次）。' },
  smecta: { name: '蒙脱石散', cat: 'med', price: 15, weight: 0.03, desc: '治疗急性腹泻（3 次）。' },
  deet:   { name: '驱虫驱蜱喷雾', cat: 'med', price: 39, weight: 0.1, desc: '大幅降低被蜱虫叮咬的概率。' },
  blanket:{ name: '急救保温毯', cat: 'med', price: 19, weight: 0.1, stack: true, max: 3, desc: '紧急时裹上，短时间内大幅减少热量流失。一次性。' },
  warmer: { name: '暖宝宝(5片)', cat: 'med', price: 20, weight: 0.1, stack: true, max: 4, desc: '每片持续发热约 8 小时。贴在胸口能暖和些，但一片只有几瓦，比不上走路和吃东西产的热。' },
};

// 某些物品购买后带有“次数”
export const ITEM_USES = { stove: 6, gas: 6, tablet: 10, firstaid: 2, ibu: 6, diamox: 4, smecta: 3, warmer: 5, elec: 1, power: 1, spray: 1 };

export const CATEGORIES = [
  { id: 'pack', name: '背包' },
  { id: 'shelter', name: '宿营' },
  { id: 'cloth', name: '衣物鞋袜' },
  { id: 'nav', name: '导航通讯' },
  { id: 'gear', name: '技术装备' },
  { id: 'cook', name: '炊具饮水' },
  { id: 'food', name: '食物' },
  { id: 'med', name: '药品急救' },
];

// 推荐配置（按预算从上到下尽量购买）
export const RECOMMENDED = [
  ['pack', 'bp30'],
  ['shell', 1], ['boots', 1], ['tent3', 1], ['bag0', 1], ['pad', 1], ['fleece', 1], ['base', 1], ['hat', 1],
  ['bottle', 4], ['lamp', 1], ['firstaid', 1], ['compass', 1], ['app', 1], ['poles', 1], ['map', 1], ['stove', 1], ['tablet', 1], ['bandage', 1],
  ['meal', 8], ['biscuit', 6], ['choco', 5], ['bar', 6], ['jerky', 3],
  ['down', 1], ['diamox', 1], ['deet', 1], ['blanket', 1], ['warmer', 1], ['gaiter', 1], ['elec', 2],
  ['spray', 1], ['ibu', 1], ['smecta', 1], ['glasses', 1], ['gas', 1], ['cramp', 1], ['gps', 1], ['power', 1], ['noodle', 4],
];

// 补给点（剩余资金可购买）
export const SHOP_STOCK = {
  '大爷海': [['noodle', 30], ['biscuit', 25], ['choco', 40], ['gas', 80], ['bottleWater', 20]],
  '平安寺': [['noodle', 20], ['meal', 50], ['bottleWater', 10]],
};
