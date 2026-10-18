/* ============================================================
   《穗浪》 SUÌ LÀNG — game core
   Canvas scene + interactive field + game feel + UI choreography.
   Classic script, no dependencies, file:// friendly.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- utilities ---------------- */
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOutCubic(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fmt(n) {
    n = Math.round(n);
    return n.toLocaleString('en-US');
  }
  function angleLerp(a, b, t) {
    var d = (b - a + Math.PI) % TAU;
    if (d < 0) d += TAU;
    d -= Math.PI;
    return a + d * t;
  }
  function $(id) { return document.getElementById(id); }
  function sfx() {
    if (!audio) return;
    var name = arguments[0];
    try {
      if (typeof audio[name] === 'function') {
        audio[name].apply(audio, Array.prototype.slice.call(arguments, 1));
      }
    } catch (err) { /* audio must never break the field */ }
  }
  function storeGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* file:// may block */ }
  }

  function makeGlow(size, r, g, b) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var x = c.getContext('2d');
    var grad = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
    grad.addColorStop(0.2, 'rgba(' + r + ',' + g + ',' + b + ',.6)');
    grad.addColorStop(0.55, 'rgba(' + r + ',' + g + ',' + b + ',.15)');
    grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    x.fillStyle = grad;
    x.fillRect(0, 0, size, size);
    return c;
  }

  /* ---------------- fallbacks ---------------- */
  function DummyAudio() { this._muted = false; }
  ['start', 'setScene', 'gameStart', 'gameEnd', 'cut', 'comboMilestone', 'frenzyReady',
    'frenzyStart', 'frenzyEnd', 'storm', 'ui', 'pause', 'resume', 'update', 'dispose'
  ].forEach(function (m) { DummyAudio.prototype[m] = function () { }; });
  DummyAudio.prototype.setMuted = function (m) { this._muted = !!m; };
  Object.defineProperty(DummyAudio.prototype, 'muted', { get: function () { return this._muted; } });

  function FallbackField() {
    this.w = 1; this.h = 1; this.stalks = [];
  }
  FallbackField.prototype.resize = function (w, h) {
    this.w = w; this.h = h;
    this.stalks = [];
    for (var i = 0; i < 120; i++) {
      this.stalks.push({ x: Math.random() * w, y: h * 0.6 + Math.random() * h * 0.4, hh: 60 + Math.random() * 120 });
    }
  };
  FallbackField.prototype.reset = function () { };
  FallbackField.prototype.update = function () { };
  FallbackField.prototype.cut = function () { };
  FallbackField.prototype.drainEvents = function () { return []; };
  FallbackField.prototype.stormCut = function () { };
  FallbackField.prototype.setGoldenBoost = function () { };
  FallbackField.prototype.getStats = function () { return { uncut: 0, total: 0, golden: 0 }; };
  FallbackField.prototype.draw = function (ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,82,30,.7)';
    ctx.lineWidth = 1.5;
    for (var i = 0; i < this.stalks.length; i++) {
      var s = this.stalks[i];
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(s.x + 4, s.y - s.hh * 0.6, s.x + 8, s.y - s.hh);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ---------------- dom ---------------- */
  var app = $('app');
  var canvas = $('stage');
  var ctx = canvas.getContext('2d', { alpha: false });
  var D = {
    hud: $('hud'), score: $('score'), combo: $('combo'), comboCount: $('comboCount'),
    comboMult: $('comboMult'), comboFill: $('comboFill'), timer: $('timer'),
    sunRailFill: $('sunRailFill'), sunDot: $('sunDot'), windArrow: $('windArrow'),
    windText: $('windText'), btnPause: $('btnPause'), btnMute: $('btnMute'),
    hint: $('hint'), frenzy: $('frenzy'), frenzyState: $('frenzyState'),
    frenzyFill: $('frenzyFill'), btnBlessing: $('btnBlessing'), blessingCount: $('blessingCount'),
    furyRule: $('furyRule'), caption: $('caption'),
    announce: $('announce'), announceCn: $('announceCn'), announceEn: $('announceEn'),
    notice: $('notice'), menu: $('menu'), btnStart: $('btnStart'), bestMenu: $('bestMenu'),
    btnShop: $('btnShop'), coinMenu: $('coinMenu'), menuTool: $('menuTool'),
    pause: $('pause'), btnResume: $('btnResume'), btnRestart: $('btnRestart'), btnHome: $('btnHome'),
    end: $('end'), rankLetter: $('rankLetter'), rankTitle: $('rankTitle'),
    finalScore: $('finalScore'), statCombo: $('statCombo'), statGolden: $('statGolden'),
    bestEnd: $('bestEnd'), endQuote: $('endQuote'), btnReplay: $('btnReplay'),
    endBossEval: $('endBossEval'), endBossPortrait: $('endBossPortrait'),
    endBossName: $('endBossName'), endBossGrade: $('endBossGrade'), endBossComment: $('endBossComment'),
    btnHome2: $('btnHome2'), newBest: $('newBest'), debug: $('debug'),
    coinsEarned: $('coinsEarned'), coinBalance: $('coinBalance'), btnShopEnd: $('btnShopEnd'),
    shop: $('shop'), btnShopBack: $('btnShopBack'), coinShop: $('coinShop'),
    currentTool: $('currentTool'), toolList: $('toolList'), btnUnequip: $('btnUnequip'),
    shopCharacter: $('shopCharacter'), shopLine: $('shopLine'), shopDialogue: $('shopDialogue'),
    shopToast: $('shopToast'), shopPortrait: $('shopPortrait'),
    shopBossName: $('shopBossName'), shopBossName2: $('shopBossName2'),
    shopBossNameTop: $('shopBossNameTop'), btnBossSwitchTop: $('btnBossSwitchTop'),
    shopBossRole: $('shopBossRole'), shopBossMini: $('shopBossMini'),
    btnBossSwitch: $('btnBossSwitch'), bossPanel: $('bossPanel'), bossList: $('bossList'),
    bossFile: $('bossFile'), btnBossClose: $('btnBossClose'), bossBackdrop: $('bossBackdrop'),
    btnBossDefault: $('btnBossDefault'), bossKitLink: $('bossKitLink'),
    captionK: $('captionK'), captionV: $('captionV'), menuSideLabel: $('menuSideLabel'), taglineText: $('taglineText'),
    hudToolIcon: $('hudToolIcon'), hudToolName: $('hudToolName'), hudToolEffect: $('hudToolEffect'),
    mapWheat: $('mapWheat'), mapRice: $('mapRice'),
    btnHistory: $('btnHistory'), historySummary: $('historySummary'),
    history: $('history'), historyList: $('historyList'), historyEmpty: $('historyEmpty'),
    historyStats: $('historyStats'), btnHistoryBack: $('btnHistoryBack'),
    btnPK: $('btnPK'), pkSetup: $('pkSetup'), btnPKBack: $('btnPKBack'),
    pkMapWheat: $('pkMapWheat'), pkMapRice: $('pkMapRice'), btnPKStart: $('btnPKStart'),
    pkHud: $('pkHud'), pkScore1: $('pkScore1'), pkScore2: $('pkScore2'),
    pkCombo1: $('pkCombo1'), pkCombo2: $('pkCombo2'), pkTimer: $('pkTimer'),
    pkMapName: $('pkMapName'), pkFuryState: $('pkFuryState'), pkFuryFill: $('pkFuryFill'),
    pkFuryRule: $('pkFuryRule'), pkStick1: $('pkStick1'), pkStick2: $('pkStick2'), pkPause: $('pkPause'),
    pkEnd: $('pkEnd'), pkWinner: $('pkWinner'), pkEndSub: $('pkEndSub'),
    pkEndScore1: $('pkEndScore1'), pkEndScore2: $('pkEndScore2'),
    pkEndCombo1: $('pkEndCombo1'), pkEndCombo2: $('pkEndCombo2'),
    btnPKAgain: $('btnPKAgain'), btnPKSwitch: $('btnPKSwitch'), btnPKHome: $('btnPKHome')
  };

  /* ---------------- constants ---------------- */
  var DURATION = 60;
  var COMBO_WINDOW = 2.4;
  var FURY_DURATION = 8;
  var FURY_EXTENSION = 0.05;
  var FURY_EXTENSION_EVERY = 25;
  var PK_SPEED = 560;
  var PK_KEYMAP = {
    KeyW: ['p1', 'up'], KeyS: ['p1', 'down'], KeyA: ['p1', 'left'], KeyD: ['p1', 'right'],
    ArrowUp: ['p2', 'up'], ArrowDown: ['p2', 'down'], ArrowLeft: ['p2', 'left'], ArrowRight: ['p2', 'right']
  };
  var FURY_WINDOW_MIN = 20;
  var FURY_WINDOW_MAX = 40;
  var RANKS = [
    { min: 10000, letter: 'S', title: '丰饶之神', riceTitle: '丰饶之神', quote: '风把整片田野，都交给了你的镰刀。', riceQuote: '风把整片水田，都交给了你的镰刀。' },
    { min: 5000, letter: 'A', title: '金牌麦客', riceTitle: '金牌稻客', quote: '这一季的黄昏，记得你的每一次挥镰。', riceQuote: '这一季的水光，记得你的每一次挥镰。' },
    { min: 2000, letter: 'B', title: '麦浪知音', riceTitle: '稻浪知音', quote: '麦浪俯身，向你道谢。', riceQuote: '稻浪俯身，向你道谢。' },
    { min: 500, letter: 'C', title: '初握镰刀', riceTitle: '初握镰刀', quote: '慢慢来，田野会等你下一次日落。', riceQuote: '慢慢来，水田会等你下一次日落。' },
    { min: 0, letter: 'D', title: '第一次下田', riceTitle: '第一次下水田', quote: '田埂还长，今天先记下风的方向。', riceQuote: '水田还长，今天先记下水光的方向。' }
  ];
  var GENERIC_RANK_COMMENTS = {
    S: '这一季，田野把最好的颜色留给了你。',
    A: '很好。你的镰刀已经认得风的脾气。',
    B: '不错。再走一遍田埂，会更熟。',
    C: '慢慢来，庄稼和人都需要时间。',
    D: '先歇一歇吧，田会等你下一次日落。'
  };

  /* 农具定义：三种镰刀（互斥装备）+ 一次性祝福 */
  var TOOLS = [
    {
      id: 'scythe_plus', name: '加强镰刀', type: 'tool', price: 100,
      range: 1.5, scoreMult: 1, tag: '范围 ×1.5',
      desc: '刃口淬过金穗的蜜。镰刀挥过的范围增加 50%。',
      flavor: '刃口蘸过一点蜜，割起来更轻。'
    },
    {
      id: 'long_scythe', name: '长柄镰刀', type: 'tool', price: 300,
      range: 1, scoreMult: 1.3, tag: '积分 ×1.3',
      desc: '柄更长，腰更省力。收获积分增加 30%。',
      flavor: '麻绳缠了七道，柄比去年更长。'
    },
    {
      id: 'sweep', name: '钐子', type: 'tool', price: 800,
      range: 2, scoreMult: 1, tag: '范围 ×2.0',
      desc: '长柄阔刃，刃后带一张竹编落兜。一抡就是半垄，收割范围增加 100%。',
      flavor: '一抡一兜，风也跟着落进网里。'
    },
    {
      id: 'blessing', name: '来自黍的祝福', type: 'consumable', price: 100,
      range: 1, scoreMult: 1, tag: '一次性 · 上限 1',
      desc: '直接开启一次丰饶之刻。用后消失，最多携带一个，需要再次购买。',
      flavor: '一张写满节气与祝词的黍色符纸。'
    }
  ];
  var TOOL_MAP = {};
  for (var ti = 0; ti < TOOLS.length; ti++) TOOL_MAP[TOOLS[ti].id] = TOOLS[ti];

  /* ---------------- 老板娘 / 角色包 ----------------
     公开版默认老板娘是原创角色「穗」：一个古老谷神家族的第十四位幼妹。
     台词全部为原创；不包含任何官方角色台词、立绘或截图。 */
  var BOSS_LINES = [
    '稻子熟的时候，风会先来告诉我。',
    '你闻到了吗？这是新米被太阳晒暖的味道。',
    '别急着把整片田割完，留一束给明年的燕子。',
    '哥哥姐姐们总说我还小，可我认得每一粒谷子的脾气。',
    '手伸出来，沾一点土，才算真正来过田里。',
    '饿了就坐一会儿吧，锅里的粥还温着。',
    '丰收不是把田野搬空，是让每个人都有饭吃。',
    '我梦见十四个人围着一张桌子，桌上有新蒸的米饭。',
    '风把云吹散的时候，田地会露出它藏了一整年的颜色。',
    '如果有一天我走远了，你就在稻穗低头的时候叫我。',
    '黍姐姐的祝福我带着呢，分你一半。',
    '天黑之前，再陪我割完这一垄吧。'
  ];
  var BOSS_ACTIVE_KEY = 'suilang3.boss';
  var BOSS_PACKS_KEY = 'suilang3.bossPacks';
  var DEFAULT_BOSS = {
    id: 'sui14',
    name: '穗',
    role: '第十四位 · 老板娘',
    en: 'THE FOURTEENTH · SHOPKEEPER',
    title: '谷神家的第十四位',
    portrait: 'assets/boss.png',
    accent: '#b8ca8f',
    lines: BOSS_LINES.slice(),
    rankLines: {
      S: '这一季的黄昏，连风都替你让路。今晚加餐。',
      A: '割得漂亮。再慢一点，就能听见稻子道谢了。',
      B: '手上有风，心里有田。明年会更稳。',
      C: '别急，田垄还长。先喝碗粥，明天再来。',
      D: '第一次下田能站着回来，已经很好了。先歇歇。'
    },
    author: '穗浪',
    license: 'MIT',
    note: '原创角色 · 基于谷神家族群像气质设计',
    builtin: true
  };


  function loadOwnedToolIds() {
    try {
      var arr = JSON.parse(storeGet('suilang3.owned', '[]'));
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (id) {
        return TOOL_MAP[id] && TOOL_MAP[id].type === 'tool';
      });
    } catch (e) { return []; }
  }
  function normalizeEquipped(id, owned) {
    return (id && owned.indexOf(id) >= 0 && TOOL_MAP[id] && TOOL_MAP[id].type === 'tool') ? id : 'none';
  }
  var SAVED_OWNED = loadOwnedToolIds();
  var SAVED_EQUIPPED = normalizeEquipped(storeGet('suilang3.equipped', 'none'), SAVED_OWNED);
  var SAVED_BLESSING = clamp(parseInt(storeGet('suilang3.blessing', '0'), 10) || 0, 0, 1);
  var HISTORY_KEY = 'suilang3.history';

  function loadRunHistory() {
    try {
      var arr = JSON.parse(storeGet(HISTORY_KEY, '[]'));
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (r) {
        return r && typeof r === 'object' && isFinite(r.score) && typeof r.t === 'number';
      }).slice(0, 30);
    } catch (e) { return []; }
  }
  function saveRunHistory() {
    try { storeSet(HISTORY_KEY, JSON.stringify(G.history.slice(0, 30))); } catch (e) { }
  }

  function getEquippedTool() {
    return (G && G.equippedTool && TOOL_MAP[G.equippedTool]) ? TOOL_MAP[G.equippedTool] : null;
  }
  function getEquippedEffects() {
    var t = getEquippedTool();
    return t ? { id: t.id, name: t.name, range: t.range, scoreMult: t.scoreMult } :
      { id: 'none', name: '旧镰刀', range: 1, scoreMult: 1 };
  }

  /* ---------------- state ---------------- */
  var G = {
    mode: 'menu',
    visTime: 0,
    remaining: DURATION,
    started: false,
    score: 0,
    shownScore: 0,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    lastTier: 0,
    golden: 0,
    totalCuts: 0,
    fury: 0,
    furyActive: false,
    furyTimer: 0,
    furyAt: 0,
    furyNatureTriggered: false,
    furyWarned: false,
    furySource: 'nature',
    furyExtendPulse: 0,
    furyCutCount: 0,
    map: storeGet('suilang3.map', 'wheat') === 'rice' ? 'rice' : 'wheat',
    history: loadRunHistory(),
    runRecorded: false,
    pk: null,
    pauseFrom: 'single',
    pkStickAxes: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } },
    pkStickIds: { p1: null, p2: null },
    critters: [],
    critterTimer: 8,
    best: parseInt(storeGet('suilang3.best', '0'), 10) || 0,
    coins: parseInt(storeGet('suilang3.coins', '0'), 10) || 0,
    coinsEarned: 0,
    coinAwarded: false,
    ownedTools: SAVED_OWNED.slice(),
    equippedTool: SAVED_EQUIPPED,
    blessing: SAVED_BLESSING,
    toolRange: 1,
    toolScoreMult: 1,
    shopFrom: 'menu',
    shopTalkTimer: null,
    shopTypingTimer: null,
    shopLineIndex: -1,
    shopLineTyping: false,
    bossId: storeGet(BOSS_ACTIVE_KEY, DEFAULT_BOSS.id),
    importedBosses: [],
    prevBest: 0,
    newBest: false,
    muted: storeGet('suilang.muted', '0') === '1',
    reduced: false,
    pointer: {
      x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, speed: 0,
      down: false, active: false, lastT: 0, type: 'mouse'
    },
    wind: 0.3,
    gust: 0,
    gustTimer: rand(5, 9),
    gustActive: false,
    gustElapsed: 0,
    gustDur: 3,
    gustStrength: 0.6,
    timeScale: 1,
    slowT: 0,
    hitstop: 0,
    shake: 0,
    flash: 0,
    bladeFlash: 0,
    stormVis: 0,
    stormScoreT: 0,
    endT: 0,
    endShown: false,
    endScoreShown: 0,
    endRank: null,
    soundBudget: 8,
    cursorAngle: -0.45,
    trail: [],
    fieldDrawAcc: 0,
    fieldDrawN: 0,
    fieldDrawAvg: 0,
    autoFast: false,
    demo: false,
    demoT: 0,
    demoFury: false,
    noticed30: false,
    noticed10: false,
    startSoundPlayed: false,
    debug: false,
    fps: 60,
    lastTimerText: '',
    lastScoreText: '',
    lastPulseScore: 0,
    lastPulseT: 0,
    lastWindText: '',
    scoreTarget: { x: 120, y: 80 },
    noticeTimer: null,
    announceTimer: null,
    captionTimer: null,
    lastFrame: 0
  };

  var params = new URLSearchParams(window.location.search);
  var SCREEN = params.get('screen') || '';
  var mapParam = params.get('map');
  if (mapParam === 'rice' || mapParam === 'wheat') G.map = mapParam;
  var DEMO = params.get('demo') === '1' || SCREEN === 'play' || SCREEN === 'fury' || SCREEN === 'pause';
  var IS_TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  G.demo = DEMO;
  G.debug = params.get('debug') === '1';
  if (window.matchMedia) {
    G.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  var scenes = {
    wheat: new window.HarvestScene(),
    rice: window.RiceScene ? new window.RiceScene() : null
  };
  var FieldCtor = window.WheatField || FallbackField;
  var fields = {
    wheat: new FieldCtor(),
    rice: window.RiceField ? new window.RiceField() : null
  };
  if (!scenes.rice) scenes.rice = scenes.wheat;
  if (!fields.rice) fields.rice = fields.wheat;
  if (!window.RiceScene || !window.RiceField) G.map = 'wheat';
  var scene = scenes[G.map] || scenes.wheat;
  var field = fields[G.map] || fields.wheat;
  var audio = window.HarvestAudio ? new window.HarvestAudio() : new DummyAudio();
  var audioStarted = false;
  var W = window.innerWidth, H = window.innerHeight, dpr = 1;
  var lastResize = 0;

  var sprSpark = makeGlow(32, 255, 238, 192);
  var sprGold = makeGlow(72, 255, 200, 100);
  var sprMote = makeGlow(24, 255, 226, 170);
  var sprPK1 = makeGlow(80, 242, 193, 92);
  var sprPK2 = makeGlow(80, 156, 196, 140);
  var fx = { chaff: [], sparks: [], rings: [], popups: [], souls: [], slashes: [] };
  var previewCoinBalance = null;
  var shopToastTimer = null;

  /* ---------------- 丰收印记 / 农具 ---------------- */
  function saveProgression() {
    storeSet('suilang3.coins', G.coins);
    storeSet('suilang3.owned', JSON.stringify(G.ownedTools));
    storeSet('suilang3.equipped', G.equippedTool);
    storeSet('suilang3.blessing', G.blessing);
  }

  function updateProgressionLabels() {
    var eff = getEquippedEffects();
    if (D.coinMenu) D.coinMenu.textContent = fmt(G.coins);
    if (D.coinShop) D.coinShop.textContent = fmt(G.coins);
    if (D.menuTool) D.menuTool.textContent = eff.name;
    if (D.currentTool) D.currentTool.textContent = eff.name;
    if (D.hudToolName) D.hudToolName.textContent = eff.name;
    if (D.hudToolEffect) {
      D.hudToolEffect.textContent = eff.id === 'none' ? '旧镰刀 · 范围 ×1.0' :
        (eff.scoreMult > 1 ? '积分 ×' + eff.scoreMult.toFixed(1) : '范围 ×' + eff.range.toFixed(1));
    }
    if (D.hudToolIcon) D.hudToolIcon.innerHTML = toolIconMarkup(eff.id);
    if (D.coinBalance) D.coinBalance.textContent = fmt(previewCoinBalance != null ? previewCoinBalance : G.coins);
    if (D.blessingCount) D.blessingCount.textContent = '×' + G.blessing;
    if (D.btnUnequip) D.btnUnequip.disabled = G.equippedTool === 'none';
  }

  function applyToolLoadout() {
    var eff = getEquippedEffects();
    G.toolRange = eff.range;
    G.toolScoreMult = eff.scoreMult;
    try { if (field.setCutRange) field.setCutRange(eff.range); } catch (e) { }
    updateProgressionLabels();
  }

  /* ---------------- 地图 / 田埂 / 农事记录 ---------------- */
  function mapName(map) { return map === 'rice' ? '稻田' : '麦田'; }
  function mapCropWord(map) { return map === 'rice' ? '稻穗' : '麦穗'; }

  function useMap(map) {
    if (G.mode !== 'menu' && G.mode !== 'history' && G.mode !== 'pkSetup') return;
    if (map !== 'rice' || scenes.rice === scenes.wheat || fields.rice === fields.wheat) map = 'wheat';
    G.map = map;
    scene = scenes[map] || scenes.wheat;
    field = fields[map] || fields.wheat;
    app.dataset.map = map;
    storeSet('suilang3.map', map);
    if (D.mapWheat) D.mapWheat.classList.toggle('is-on', map === 'wheat');
    if (D.mapRice) D.mapRice.classList.toggle('is-on', map === 'rice');
    if (D.mapWheat) D.mapWheat.setAttribute('aria-pressed', map === 'wheat' ? 'true' : 'false');
    if (D.mapRice) D.mapRice.setAttribute('aria-pressed', map === 'rice' ? 'true' : 'false');
    updatePKSetupUI();
    if (D.menuSideLabel) D.menuSideLabel.textContent = map === 'rice' ? '青 玉 稻 浪 · 卷 二' : '金 色 丰 收 · 卷 一';
    if (D.captionK) D.captionK.textContent = map === 'rice' ? '江南 · 稻熟时分' : '北纬 37° · 麦熟时分';
    if (D.captionV) D.captionV.textContent = map === 'rice' ? '风把水光吹成了稻浪' : '麦浪把黄昏推向了岸边';
    if (D.taglineText) D.taglineText.innerHTML = map === 'rice'
      ? '薄暮把水田磨成镜，<br>你只需划开一痕。'
      : '黄昏把田野熬成蜜，<br>你只需挥一挥手。';
    var hintSpan = D.hint && D.hint.querySelector('span');
    if (hintSpan) hintSpan.textContent = (IS_TOUCH ? '滑动指尖 · 划过' : '按住并划过') + mapCropWord(map) + ' · 开镰';
    try { field.resize(W, H); } catch (e) { }
    G.critters.length = 0;
    G.critterTimer = rand(7, 13);
    try {
      field.reset();
      field.setGoldenBoost(1.15);
    } catch (e) { }
    applyToolLoadout();
    updateHistorySummary();
    if (window.__SUILANG__) {
      window.__SUILANG__.scene = scene;
      window.__SUILANG__.field = field;
    }
    if (D.caption) {
      D.caption.classList.toggle('rice', map === 'rice');
    }
  }

  function renderHistory() {
    if (!D.historyList) return;
    var h = G.history || [];
    var totalCoins = 0, best = 0, bestCombo = 0;
    for (var i = 0; i < h.length; i++) {
      totalCoins += (+h[i].coins || 0);
      if ((+h[i].score || 0) > best) best = +h[i].score;
      if ((+h[i].combo || 0) > bestCombo) bestCombo = +h[i].combo;
    }
    if (D.historyStats) {
      D.historyStats.innerHTML =
        '<div><span>总场次</span><b>' + h.length + '</b></div>' +
        '<div><span>最佳收成</span><b>' + (best ? fmt(best) : '—') + '</b></div>' +
        '<div><span>累计印记</span><b>' + fmt(totalCoins) + '</b></div>' +
        '<div><span>最高连斩</span><b>' + (bestCombo ? fmt(bestCombo) : '—') + '</b></div>';
    }
    if (!h.length) {
      D.historyList.innerHTML = '';
      if (D.historyEmpty) D.historyEmpty.classList.add('on');
      return;
    }
    if (D.historyEmpty) D.historyEmpty.classList.remove('on');
    var html = '';
    for (var j = 0; j < h.length; j++) {
      var r = h[j];
      var d = new Date(r.t);
      var time = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      var rice = r.map === 'rice';
      html += '<div class="history-row">' +
        '<span class="h-time">' + time + '</span>' +
        '<span class="history-map' + (rice ? ' is-rice' : '') + '">' + (rice ? '稻田' : '麦田') + '</span>' +
        '<span class="h-score">' + fmt(Math.round(+r.score || 0)) + '</span>' +
        '<span class="h-rank">' + (r.rank || '—') + '</span>' +
        '<span class="h-coins">+' + fmt(Math.max(0, +r.coins || 0)) + '</span>' +
        '<span class="h-tool">' + (r.tool || '旧镰刀') + '</span>' +
        '</div>';
    }
    D.historyList.innerHTML = html;
  }

  function updateHistorySummary() {
    if (!D.historySummary) return;
    var h = G.history || [];
    if (!h.length) {
      D.historySummary.textContent = '还没有收成';
    } else {
      var r = h[0];
      D.historySummary.textContent = '上次 · ' + mapName(r.map) + ' · ' + (r.rank || '—') + ' · ' + fmt(Math.round(+r.score || 0));
    }
  }

  function recordRun() {
    if (G.runRecorded) return;
    G.runRecorded = true;
    if (!G.endRank) return;
    var rec = {
      t: Date.now(),
      map: G.map,
      score: Math.round(G.score),
      rank: G.endRank.letter,
      coins: Math.max(0, G.coinsEarned),
      combo: G.maxCombo,
      golden: G.golden,
      tool: getEquippedEffects().name
    };
    G.history.unshift(rec);
    if (G.history.length > 30) G.history.length = 30;
    saveRunHistory();
    updateHistorySummary();
  }

  function openHistory() {
    if (G.mode !== 'menu') return;
    ensureAudio();
    hideAnnounce();
    hideNotice();
    hideCaption();
    hideScreens();
    hideHUD();
    setMode('history');
    G.pointer.down = false;
    renderHistory();
    D.history.classList.remove('hidden');
    void D.history.offsetWidth;
    D.history.classList.add('is-live');
    sfx('setScene', 'menu');
    sfx('ui', 'click');
  }

  function closeHistory() {
    if (G.mode !== 'history') return;
    D.history.classList.add('hidden');
    D.history.classList.remove('is-live');
    showMenu();
    sfx('ui', 'back');
  }

  function updateHistory(raw) {
    try {
      field.update(raw * 0.5, G.visTime, buildFieldEnv());
      field.drainEvents();
    } catch (e) { }
    updateFx(raw);
  }

  function awardRunCoins() {
    if (G.coinAwarded) return;
    G.coinsEarned = Math.max(0, Math.floor(G.score / 1000));
    G.coins += G.coinsEarned;
    G.coinAwarded = true;
    storeSet('suilang3.coins', G.coins);
  }

  /* ---------------- two-player local duel ---------------- */
  function makePKPlayer(id, x, y) {
    return {
      id: id, x: x, y: y, px: x, py: y, vx: 0, vy: 0,
      angle: -0.45, speed: 0,
      score: 0, shownScore: 0,
      combo: 0, comboTimer: 0, maxCombo: 0, golden: 0,
      flash: 0, trail: [],
      keys: { up: false, down: false, left: false, right: false },
      lastPulseScore: 0, lastPulseT: 0
    };
  }

  function pkMult(p) {
    var tier = Math.min(6, Math.floor(p.combo / 10));
    return 1 + tier * 0.5;
  }

  function pkComboText(p) {
    return '连斩 ×' + pkMult(p).toFixed(1);
  }

  function shouldShowPKTouch() {
    return !!(IS_TOUCH || W <= 900 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
  }

  function pkDesktopAllowed() {
    var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    return !(IS_TOUCH || coarse || W < 900);
  }

  function updatePKAvailability() {
    if (!D.btnPK) return;
    var allowed = pkDesktopAllowed();
    D.btnPK.style.display = allowed ? '' : 'none';
    D.btnPK.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    D.btnPK.tabIndex = allowed ? 0 : -1;
  }

  function updatePKTouch() {
    if (!D.pkHud) return;
    D.pkHud.classList.toggle('touch', shouldShowPKTouch());
  }

  function resetPKSticks() {
    G.pkStickAxes = { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } };
    G.pkStickIds = { p1: null, p2: null };
    if (D.pkStick1 && D.pkStick1._pkReset) D.pkStick1._pkReset();
    if (D.pkStick2 && D.pkStick2._pkReset) D.pkStick2._pkReset();
  }

  function resetPKKeys() {
    if (!G.pk) return;
    var ids = ['p1', 'p2'];
    for (var i = 0; i < ids.length; i++) {
      var p = G.pk[ids[i]];
      if (!p || !p.keys) continue;
      p.keys.up = p.keys.down = p.keys.left = p.keys.right = false;
    }
  }

  function updatePKSetupUI() {
    if (D.pkMapWheat) {
      D.pkMapWheat.classList.toggle('is-on', G.map === 'wheat');
      D.pkMapWheat.setAttribute('aria-pressed', G.map === 'wheat' ? 'true' : 'false');
    }
    if (D.pkMapRice) {
      D.pkMapRice.classList.toggle('is-on', G.map === 'rice');
      D.pkMapRice.setAttribute('aria-pressed', G.map === 'rice' ? 'true' : 'false');
    }
  }

  function updatePKHud(force) {
    var pk = G.pk;
    if (!pk || !D.pkHud) return;
    var now = performance.now();
    var p1 = pk.p1, p2 = pk.p2;
    var s1 = fmt(Math.round(p1.shownScore));
    var s2 = fmt(Math.round(p2.shownScore));
    if (D.pkScore1.textContent !== s1) D.pkScore1.textContent = s1;
    if (D.pkScore2.textContent !== s2) D.pkScore2.textContent = s2;
    if (D.pkCombo1) D.pkCombo1.textContent = pkComboText(p1);
    if (D.pkCombo2) D.pkCombo2.textContent = pkComboText(p2);
    var secs = Math.max(0, Math.ceil(pk.time));
    var timer = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    if (D.pkTimer && D.pkTimer.textContent !== timer) D.pkTimer.textContent = timer;
    if (D.pkMapName) D.pkMapName.textContent = mapName(G.map);

    var state, rule, fill = 0;
    if (G.furyActive) {
      state = Math.max(0, G.furyTimer).toFixed(1) + ' 秒';
      rule = '每 25 穗 +0.05 秒 · ' + (G.furyCutCount % FURY_EXTENSION_EVERY) + '/' + FURY_EXTENSION_EVERY;
      fill = clamp(G.furyTimer / FURY_DURATION, 0, 1);
    } else if (G.started && !G.furyNatureTriggered) {
      state = '静候金风';
      rule = '将在 20–40 秒间随机降临 · 每 25 穗 +0.05 秒';
    } else {
      state = '金风已过';
      rule = (G.map === 'rice' ? '稻浪' : '麦浪') + '记得那阵风';
    }
    if (D.pkFuryState.textContent !== state) D.pkFuryState.textContent = state;
    if (D.pkFuryRule.textContent !== rule) D.pkFuryRule.textContent = rule;
    if (D.pkFuryFill) D.pkFuryFill.style.transform = 'scaleX(' + fill.toFixed(4) + ')';
    D.pkHud.classList.toggle('fury', G.furyActive);

    if (p1.score - p1.lastPulseScore >= 0.5 && now - p1.lastPulseT > 95) {
      var d1 = p1.score - p1.lastPulseScore;
      pulseScore(D.pkScore1, d1 >= 30);
      p1.lastPulseScore = p1.score;
      p1.lastPulseT = now;
    }
    if (p2.score - p2.lastPulseScore >= 0.5 && now - p2.lastPulseT > 95) {
      var d2 = p2.score - p2.lastPulseScore;
      pulseScore(D.pkScore2, d2 >= 30);
      p2.lastPulseScore = p2.score;
      p2.lastPulseT = now;
    }
  }

  function openPKSetup() {
    if (G.mode !== 'menu' && G.mode !== 'pkEnd') return;
    if (!pkDesktopAllowed()) {
      showNotice('双人同屏 PK 仅支持桌面键盘；手机端暂不开放。');
      return;
    }
    ensureAudio();
    hideAnnounce();
    hideNotice();
    hideCaption();
    hideScreens();
    hideHUD();
    G.pk = null;
    G.pauseFrom = 'single';
    try {
      field.reset();
      field.setGoldenBoost(1.15);
    } catch (e) { }
    resetPKSticks();
    setMode('pkSetup');
    updatePKSetupUI();
    D.pkSetup.classList.remove('hidden');
    void D.pkSetup.offsetWidth;
    D.pkSetup.classList.add('is-live');
    D.pkSetup.scrollTop = 0;
    sfx('setScene', 'menu');
    sfx('ui', 'click');
  }

  function closePKSetup() {
    if (G.mode !== 'pkSetup') return;
    D.pkSetup.classList.add('hidden');
    D.pkSetup.classList.remove('is-live');
    showMenu();
  }

  function startPK() {
    if (!(G.mode === 'pkSetup' || G.mode === 'pkEnd' || G.mode === 'menu' || G.mode === 'pkPaused')) return;
    if (!pkDesktopAllowed()) return;
    hideScreens();
    D.pause.classList.add('hidden');
    hideAnnounce();
    hideNotice();
    hideCaption();
    clearFx();
    G.trail.length = 0;
    G.critters.length = 0;
    resetPKSticks();
    var py = clamp(H * 0.68, H * 0.52, H * 0.94);
    G.pk = {
      time: DURATION,
      done: false,
      p1: makePKPlayer('p1', clamp(W * 0.27, 36, W - 36), py),
      p2: makePKPlayer('p2', clamp(W * 0.73, 36, W - 36), py)
    };
    resetPKKeys();
    G.mode = 'pk';
    app.dataset.mode = 'pk';
    G.started = true;
    G.remaining = DURATION;
    G.score = 0;
    G.shownScore = 0;
    G.combo = 0;
    G.comboTimer = 0;
    G.maxCombo = 0;
    G.golden = 0;
    G.totalCuts = 0;
    G.furyActive = false;
    G.furyTimer = 0;
    G.furyAt = rand(FURY_WINDOW_MIN, FURY_WINDOW_MAX);
    G.furyNatureTriggered = false;
    G.furyWarned = false;
    G.furySource = 'nature';
    G.furyCutCount = 0;
    G.furyExtendPulse = 0;
    G.stormVis = 0;
    G.stormScoreT = 0;
    G.slowT = 0;
    G.timeScale = 1;
    G.hitstop = 0;
    G.shake = 0;
    G.flash = 0;
    G.bladeFlash = 0;
    G.lastPulseScore = 0;
    G.lastPulseT = 0;
    G.endT = 0;
    G.endShown = false;
    G.endRank = null;
    G.coinsEarned = 0;
    G.runRecorded = false;
    G.pauseFrom = 'single';
    G.soundBudget = 8;
    G.startSoundPlayed = false;
    G.toolRange = 1;
    G.toolScoreMult = 1;
    try {
      field.reset();
      field.setGoldenBoost(1);
      field.setCutRange(1);
    } catch (e) { }
    updatePKTouch();
    setMode('pk');
    D.pkEnd.classList.add('hidden');
    D.pkEnd.classList.remove('is-live');
    D.pkSetup.classList.add('hidden');
    D.pkSetup.classList.remove('is-live');
    D.pkHud.setAttribute('aria-hidden', 'false');
    updatePKHud(true);
    ensureAudio();
    sfx('setScene', 'play');
    whenAudioReady(function () {
      try {
        audio.setMuted(G.muted);
        audio.setScene('play');
        if (!G.startSoundPlayed) {
          G.startSoundPlayed = true;
          audio.gameStart();
        }
      } catch (e) { }
    });
    showAnnounce('同屏对决', 'DUEL OF THE FIELD');
  }

  function finishPK() {
    var pk = G.pk;
    if (!pk || pk.done) return;
    pk.done = true;
    pk.time = 0;
    G.remaining = 0;
    G.furyActive = false;
    G.furyTimer = 0;
    G.furyCutCount = 0;
    G.stormVis = 0;
    G.stormScoreT = 0;
    try { field.setGoldenBoost(1); } catch (e) { }
    resetPKSticks();
    resetPKKeys();
    var a = Math.round(pk.p1.score);
    var b = Math.round(pk.p2.score);
    var winner, cls = '';
    if (a > b) winner = 'P1 胜';
    else if (b > a) { winner = 'P2 胜'; cls = 'p2win'; }
    else { winner = '平局'; cls = 'draw'; }
    D.pkWinner.textContent = winner;
    D.pkWinner.classList.remove('p2win', 'draw');
    if (cls) D.pkWinner.classList.add(cls);
    D.pkEndSub.textContent = mapName(G.map) + ' · 60 秒 · ' + (a === b ? '势均力敌' : '胜者 ' + (a > b ? 'P1' : 'P2'));
    D.pkEndScore1.textContent = fmt(a);
    D.pkEndScore2.textContent = fmt(b);
    D.pkEndCombo1.textContent = '最高连斩 · ' + fmt(pk.p1.maxCombo);
    D.pkEndCombo2.textContent = '最高连斩 · ' + fmt(pk.p2.maxCombo);
    setMode('pkEnd');
    hideHUD();
    D.pkHud.classList.add('hidden');
    D.pkEnd.classList.remove('hidden');
    void D.pkEnd.offsetWidth;
    D.pkEnd.classList.add('is-live');
    sfx('gameEnd', 'A');
    sfx('setScene', 'end');
  }

  function pkMove(p, dt) {
    var ax = (p.keys.right ? 1 : 0) - (p.keys.left ? 1 : 0);
    var ay = (p.keys.down ? 1 : 0) - (p.keys.up ? 1 : 0);
    var stick = G.pkStickAxes[p.id] || { x: 0, y: 0 };
    if (Math.abs(stick.x) > 0.08) ax += stick.x;
    if (Math.abs(stick.y) > 0.08) ay += stick.y;
    var len = Math.sqrt(ax * ax + ay * ay);
    if (len > 1) { ax /= len; ay /= len; }
    if (len < 0.02) {
      p.speed *= Math.exp(-dt * 8);
      if (p.speed < 0.05) p.speed = 0;
      return;
    }
    var dist = PK_SPEED * dt;
    var edgeX = Math.min(92, W * 0.22);
    var nx = clamp(p.x + ax * dist, edgeX, W - edgeX);
    var ny = clamp(p.y + ay * dist, H * 0.5, H * 0.9);
    var mdx = nx - p.x, mdy = ny - p.y;
    var moved = Math.sqrt(mdx * mdx + mdy * mdy);
    if (moved < 0.15) {
      p.speed *= Math.exp(-dt * 8);
      return;
    }
    p.px = p.x;
    p.py = p.y;
    p.vx = mdx / Math.max(dt, 0.001);
    p.vy = mdy / Math.max(dt, 0.001);
    p.speed = moved / Math.max(dt * 1000, 0.1);
    p.angle = angleLerp(p.angle, Math.atan2(mdy, mdx) + 0.5, 1 - Math.exp(-dt * 15));
    p.x = nx;
    p.y = ny;
    try {
      field.cut(p.px, p.py, p.x, p.y, Math.max(p.speed, 2.2), true);
      var evts = field.drainEvents();
      if (evts.length) pkHandleCuts(p, evts);
    } catch (e) { }
    p.trail.push({ x: p.x, y: p.y, t: performance.now() });
    if (p.trail.length > 14) p.trail.shift();
  }

  function pkHandleCuts(p, events) {
    if (!events || !events.length) return;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var golden = !!ev.golden;
      p.combo++;
      p.comboTimer = COMBO_WINDOW;
      if (p.combo > p.maxCombo) p.maxCombo = p.combo;
      var gain = Math.round((golden ? 15 : 1) * pkMult(p) * (G.furyActive ? 2 : 1));
      p.score += gain;
      if (golden) p.golden++;
      registerFuryHarvest();
      if (golden) pkGoldenFx(ev, gain);
      else spawnCutChaff(ev, false);
      addSlash(ev.x, ev.y, golden);
      if (G.soundBudget > 0) {
        G.soundBudget--;
        sfx('cut', {
          strength: clamp((ev.scale || 0.6) * 0.7 + 0.15, 0.25, 1),
          combo: p.combo, golden: golden,
          pan: clamp(p.x / W * 2 - 1, -0.85, 0.85)
        });
      }
      if (p.combo > 0 && p.combo % 25 === 0) {
        popup('连斩 ×' + pkMult(p).toFixed(1), ev.x, ev.y - 38, 'tier');
        sfx('comboMilestone', Math.floor(p.combo / 25));
      }
      p.flash = Math.max(p.flash, golden ? 0.7 : 0.18);
      G.flash = Math.max(G.flash, golden ? 0.12 : 0.035);
      G.shake = Math.min(6, G.shake + (golden ? 2.2 : 0.35));
    }
    updatePKHud(true);
  }

  function pkGoldenFx(ev, gain) {
    if (fx.rings.length < 20) {
      fx.rings.push({ x: ev.x, y: ev.y, r: 6, maxR: 54, life: 0.5, max: 0.5, w: 1.4 });
    }
    for (var i = 0; i < 8; i++) {
      var a = rand(0, TAU), sp = rand(60, 300);
      fx.sparks.push({
        x: ev.x, y: ev.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rand(0.4, 0.9), max: 0.9, size: rand(6, 15)
      });
    }
    for (var j = 0; j < 5; j++) {
      fx.chaff.push({
        x: ev.x, y: ev.y,
        vx: rand(-130, 130), vy: rand(-200, -50), g: 500,
        rot: rand(0, TAU), vr: rand(-10, 10),
        life: rand(0.6, 1.2), max: 1.2, size: rand(2, 4.5),
        color: pick(G.map === 'rice' ? ['#e8e2ae', '#c6d499', '#f5efc6'] : ['#ffe6a8', '#ffd67a', '#fff1c8'])
      });
    }
    if (gain > 0) popup('+' + gain, ev.x, ev.y - 14, 'gold');
  }

  function pkNeutralEvents(events) {
    if (!events || !events.length) return;
    for (var i = 0; i < events.length; i++) registerFuryHarvest();
    updatePKHud(true);
  }

  function updatePK(raw) {
    var pk = G.pk;
    if (!pk || pk.done) return;
    var dt = raw;
    pk.time -= dt;
    G.remaining = Math.max(0, pk.time);
    if (pk.time <= 0) {
      pk.time = 0;
      finishPK();
      return;
    }
    if (G.furyActive) {
      G.furyTimer -= dt;
      if (G.furyTimer <= 0) endFury();
    }
    var elapsed = DURATION - pk.time;
    if (!G.furyWarned && !G.furyNatureTriggered && !G.furyActive &&
        elapsed >= Math.max(1, G.furyAt - 3)) {
      G.furyWarned = true;
      showNotice('风里有金穗的味道…');
    }
    if (!G.furyNatureTriggered && !G.furyActive && elapsed >= G.furyAt) {
      G.furyNatureTriggered = true;
      activateFury('nature');
    }
    if (G.furyExtendPulse > 0) G.furyExtendPulse = Math.max(0, G.furyExtendPulse - raw);
    if (G.stormVis > 0) {
      G.stormVis = Math.max(0, G.stormVis - dt);
      var sx = lerp(-W * 0.15, W * 1.15, 1 - G.stormVis / 1.15);
      if (Math.random() < 0.55) spawnStormSparks(sx);
    }
    if (G.stormScoreT > 0) G.stormScoreT = Math.max(0, G.stormScoreT - dt);

    G.soundBudget = 6;
    try {
      field.update(dt, G.visTime, buildFieldEnv());
      var neutral = field.drainEvents();
      if (neutral.length) pkNeutralEvents(neutral);
    } catch (e) {
      if (!G._fieldError) {
        G._fieldError = true;
        console.error('PK field error:', e);
      }
    }
    pkMove(pk.p1, dt);
    pkMove(pk.p2, dt);
    var i, p, ps = [pk.p1, pk.p2];
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      if (p.comboTimer > 0) {
        p.comboTimer -= dt;
        if (p.comboTimer <= 0) p.combo = 0;
      }
      p.shownScore += (p.score - p.shownScore) * (1 - Math.exp(-raw * 10));
      if (Math.abs(p.score - p.shownScore) < 0.3) p.shownScore = p.score;
      p.flash *= Math.exp(-raw * 8);
      var now = performance.now();
      while (p.trail.length && now - p.trail[0].t > 220) p.trail.shift();
    }
    updateFx(dt);
    updatePKHud();
  }

  function updatePKPaused(raw) {
    try { field.update(0, G.visTime, buildFieldEnv()); } catch (e) { }
  }

  function updatePKSetup(raw) {
    try {
      field.update(raw * 0.55, G.visTime, buildFieldEnv());
      field.drainEvents();
    } catch (e) { }
    updateFx(raw);
  }

  function updatePKEnd(raw) {
    try { field.update(raw * 0.3, G.visTime, buildFieldEnv()); } catch (e) { }
    updateFx(raw * 0.7);
  }

  function drawPKTrail(ctx, p, color) {
    if (!p.trail || p.trail.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var i = 1; i < p.trail.length; i++) {
      var a = i / p.trail.length;
      var b = p.trail[i - 1], c = p.trail[i];
      ctx.globalAlpha = a * 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 + a * 2.4;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPKSickles(ctx) {
    var pk = G.pk;
    if (!pk) return;
    var oldMode = G.mode, oldPointer = G.pointer, oldTool = G.equippedTool,
      oldAngle = G.cursorAngle, oldFlash = G.bladeFlash;
    var ps = [pk.p1, pk.p2];
    var glow = [sprPK1, sprPK2];
    var colors = ['rgba(255,211,126,.95)', 'rgba(180,224,156,.95)'];
    var rings = ['rgba(242,193,92,.55)', 'rgba(156,196,140,.6)'];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      drawPKTrail(ctx, p, colors[i]);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = i === 0 ? 0.31 : 0.36;
      ctx.drawImage(glow[i], p.x - 42, p.y - 42, 84, 84);
      ctx.restore();
      G.mode = 'playing';
      G.equippedTool = 'none';
      G.cursorAngle = p.angle;
      G.bladeFlash = p.flash;
      G.pointer = {
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, speed: p.speed,
        type: 'mouse', down: true, active: true
      };
      drawSickle(ctx);
      p.angle = G.cursorAngle;
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = rings[i];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y + 4, 25, 0.15, 2.9);
      ctx.stroke();
      ctx.globalAlpha = 0.24;
      ctx.beginPath();
      ctx.arc(p.x, p.y + 4, 29, 2.3, 4.6);
      ctx.stroke();
      ctx.restore();

      var tag = i === 0 ? 'P1' : 'P2';
      ctx.save();
      ctx.font = '600 9px "Noto Sans SC", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      var tw = ctx.measureText(tag).width;
      var tx = p.x, ty = p.y - 68;
      ctx.globalAlpha = 0.68;
      ctx.fillStyle = 'rgba(12,7,3,.72)';
      ctx.fillRect(tx - tw / 2 - 7, ty - 10, tw + 14, 16);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = rings[i];
      ctx.lineWidth = 0.8;
      ctx.strokeRect(tx - tw / 2 - 7, ty - 10, tw + 14, 16);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = colors[i];
      ctx.fillText(tag, tx, ty + 2);
      ctx.restore();
    }
    G.mode = oldMode;
    G.pointer = oldPointer;
    G.equippedTool = oldTool;
    G.cursorAngle = oldAngle;
    G.bladeFlash = oldFlash;
  }

  function bindPKStick(el, id) {
    var activeId = null;
    var knob = el.querySelector('.stick-knob');
    function center() {
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, max: r.width * 0.34 };
    }
    function setStick(e) {
      var c = center();
      var dx = e.clientX - c.x;
      var dy = e.clientY - c.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      var max = c.max;
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      if (knob) knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      G.pkStickAxes[id] = { x: dx / max, y: dy / max };
    }
    function reset() {
      activeId = null;
      G.pkStickAxes[id] = { x: 0, y: 0 };
      if (knob) knob.style.transform = 'translate(0,0)';
    }
    el._pkReset = reset;
    el.addEventListener('pointerdown', function (e) {
      if (activeId !== null) return;
      activeId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (err) { }
      setStick(e);
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== activeId) return;
      setStick(e);
      e.preventDefault();
      e.stopPropagation();
    });
    function onEnd(e) {
      if (e.pointerId !== activeId) return;
      reset();
      e.preventDefault();
      e.stopPropagation();
    }
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
    el.addEventListener('lostpointercapture', function () { reset(); });
  }

  function toolIconMarkup(id) {
    if (id === 'scythe_plus') {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 19.5 10 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 14c3 2.6 7.2 2 9.2-1.2-3-.9-6.4-.4-9.2 1.2Z" fill="currentColor"/><path d="m18.6 4 .55 2.05L21.2 6.6l-2.05.55L18.6 9.2l-.55-2.05L16 6.6l2.05-.55L18.6 4Z" fill="currentColor" opacity=".7"/></svg>';
    }
    if (id === 'long_scythe') {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 21 14 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 9c2.4 2.3 6.2 2 8.2-.8-2.7-.8-5.7-.4-8.2.8Z" fill="currentColor"/><path d="M5 19.4 4 22" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".65"/></svg>';
    }
    if (id === 'sweep') {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M2.6 21.6 12.1 10.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
        '<path d="M12 10.2c2.8 2.6 7 2.2 9.2-1.1-3-.8-6.4-.3-9.2 1.1Z" fill="currentColor"/>' +
        '<path d="M11.3 11.4c-2.5 1.1-4.2 3.3-4.6 6.2 3 .5 5.7-.8 7.5-3.2" fill="currentColor" opacity=".14"/>' +
        '<path d="M11.3 11.4c-2.5 1.1-4.2 3.3-4.6 6.2 3 .5 5.7-.8 7.5-3.2" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>' +
        '<path d="M6.9 17.2c1.6-2 3.2-3.5 5.1-4.7M8 17.6l1.5-3M9.4 17.8l1.5-2.5M12.5 10.5 14 5.8" stroke="currentColor" stroke-width=".75" opacity=".62"/>' +
        '<path d="M5.2 18.1c1.9.4 3.7 0 5.2-1" stroke="currentColor" stroke-width=".8" opacity=".45"/>' +
        '</svg>';
    }
    if (id === 'blessing') {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7.5" y="3.5" width="9" height="17" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 7h5M9.5 10h5M9.5 13h5M9.5 16h3" stroke="currentColor" stroke-width=".9" opacity=".55"/><text x="12" y="19.3" text-anchor="middle" font-size="4.2" fill="currentColor" font-family="serif">黍</text></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 20.5 12 12" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/><path d="M12 12c3 2.7 7.3 2.2 9.4-1.2-3.1-.8-6.7-.3-9.4 1.2Z" fill="currentColor"/><path d="M4.5 19.4 3.4 21.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".55"/></svg>';
  }

  function renderShop() {
    if (!D.toolList) return;
    updateBossUI();
    updateProgressionLabels();
    var html = '';
    for (var i = 0; i < TOOLS.length; i++) {
      var t = TOOLS[i];
      var owned = G.ownedTools.indexOf(t.id) >= 0;
      var equipped = G.equippedTool === t.id;
      var afford = G.coins >= t.price;
      var priceLine, action;
      if (t.type === 'consumable') {
        priceLine = G.blessing >= 1 ? '最多 1 个' : t.price + ' <i>丰收印记</i>';
        if (G.blessing >= 1) action = '<button class="tool-btn" disabled>已携带</button>';
        else if (!afford) action = '<button class="tool-btn" disabled>印记不足</button>';
        else action = '<button class="tool-btn" data-shop-buy="' + t.id + '">购入</button>';
      } else {
        priceLine = owned ? '已解锁' : t.price + ' <i>丰收印记</i>';
        if (!owned && !afford) action = '<button class="tool-btn" disabled>印记不足</button>';
        else if (!owned) action = '<button class="tool-btn" data-shop-buy="' + t.id + '">购入</button>';
        else if (equipped) action = '<button class="tool-btn equipped-btn" disabled>使用中</button>';
        else action = '<button class="tool-btn" data-shop-equip="' + t.id + '">装备</button>';
      }
      html += '<article class="tool-card ' +
        (equipped ? 'equipped ' : '') +
        (t.type === 'consumable' ? 'consumable ' : '') +
        '" role="listitem" data-tool="' + t.id + '">' +
        '<div class="tool-top"><span class="tool-icon">' + toolIconMarkup(t.id) + '</span>' +
        '<div class="tool-name-wrap"><h3 class="tool-name">' + t.name + '</h3><span class="tool-type">' + t.tag + '</span></div></div>' +
        '<p class="tool-desc">' + t.desc + '</p>' +
        '<p class="tool-flavor">' + t.flavor + '</p>' +
        '<div class="tool-meta"><span class="tool-price">' + priceLine + '</span>' + action + '</div>' +
        '<span class="tool-watermark" aria-hidden="true">' + toolIconMarkup(t.id) + '</span>' +
        '</article>';
    }
    D.toolList.innerHTML = html;
  }

  function showShopToast(text) {
    clearTimeout(shopToastTimer);
    D.shopToast.textContent = text;
    D.shopToast.classList.add('show');
    shopToastTimer = setTimeout(function () { D.shopToast.classList.remove('show'); }, 2400);
  }

  function shopBuy(id) {
    var t = TOOL_MAP[id];
    if (!t) return;
    if (G.coins < t.price) {
      showShopToast('丰收印记不足，再去割一垄吧。');
      return;
    }
    if (t.type === 'consumable') {
      if (G.blessing >= 1) { showShopToast('最多只能携带一个。'); return; }
      G.coins -= t.price;
      G.blessing = 1;
      saveProgression();
      renderShop();
      showShopToast('来自黍的祝福 · 已放入行囊');
      sfx('ui', 'start');
      return;
    }
    if (G.ownedTools.indexOf(id) >= 0) { shopEquip(id); return; }
    G.coins -= t.price;
    G.ownedTools.push(id);
    G.equippedTool = id;
    saveProgression();
    applyToolLoadout();
    renderShop();
    showShopToast(t.name + ' · 已收入柜台并装备');
    sfx('ui', 'start');
  }

  function shopEquip(id) {
    if (G.ownedTools.indexOf(id) < 0) return;
    G.equippedTool = id;
    saveProgression();
    applyToolLoadout();
    renderShop();
    showShopToast('已装备 · ' + TOOL_MAP[id].name);
    sfx('ui', 'click');
  }

  function shopUnequip() {
    G.equippedTool = 'none';
    saveProgression();
    applyToolLoadout();
    renderShop();
    showShopToast('已卸下农具 · 回到旧镰刀');
    sfx('ui', 'back');
  }

  /* ---------------- 老板娘角色包（本地导入，不联网） ---------------- */
  function getBossPacks() {
    return [DEFAULT_BOSS].concat(G.importedBosses || []);
  }

  function getBossById(id) {
    var packs = getBossPacks();
    for (var i = 0; i < packs.length; i++) if (packs[i].id === id) return packs[i];
    return null;
  }

  function getActiveBoss() {
    return getBossById(G.bossId) || DEFAULT_BOSS;
  }

  function cleanPackText(value, max) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function isBossPackLike(obj) {
    return !!(obj && typeof obj === 'object' &&
      typeof obj.id === 'string' && obj.id &&
      typeof obj.name === 'string' && obj.name &&
      typeof obj.portrait === 'string' && /^(data:image\/|assets\/)/.test(obj.portrait) &&
      Array.isArray(obj.lines) && obj.lines.length);
  }

  function loadImportedBosses() {
    try {
      var arr = JSON.parse(storeGet(BOSS_PACKS_KEY, '[]'));
      if (!Array.isArray(arr)) return [];
      return arr.filter(isBossPackLike).slice(0, 8);
    } catch (e) { return []; }
  }

  function saveImportedBosses() {
    try {
      storeSet(BOSS_PACKS_KEY, JSON.stringify(G.importedBosses));
      return true;
    } catch (e) {
      showShopToast('角色包太大，浏览器本地空间不足；请压缩立绘后再试。');
      return false;
    }
  }

  function initBossPacks() {
    G.importedBosses = loadImportedBosses();
    if (!getBossById(G.bossId)) G.bossId = DEFAULT_BOSS.id;
    updateBossUI();
  }

  function updateBossUI() {
    var b = getActiveBoss();
    var name = b.name || '老板娘';
    var role = b.role || '老板娘';
    if (D.shopPortrait) {
      D.shopPortrait.src = b.portrait;
      D.shopPortrait.alt = '农具小铺老板娘' + name;
    }
    if (D.shopBossMini) D.shopBossMini.src = b.portrait;
    if (D.shopBossName) D.shopBossName.textContent = name;
    if (D.shopBossName2) D.shopBossName2.textContent = name;
    if (D.shopBossNameTop) D.shopBossNameTop.textContent = name;
    if (D.shopBossRole) D.shopBossRole.textContent = b.en || role;
    if (D.shopCharacter) D.shopCharacter.setAttribute('aria-label', '和' + name + '说话');
    document.documentElement.style.setProperty('--boss-accent', b.accent || '#b8ca8f');
    renderBossList();
  }

  function setActiveBoss(id, silent) {
    var b = getBossById(id);
    if (!b) return false;
    G.bossId = b.id;
    storeSet(BOSS_ACTIVE_KEY, b.id);
    G.shopLineIndex = -1;
    updateBossUI();
    if (G.mode === 'shop') {
      renderShop();
      typeBossLine(pickBossLine());
    }
    if (!silent) showShopToast('老板娘 · ' + b.name + ' 已就位');
    return true;
  }

  function renderBossList() {
    if (!D.bossList) return;
    var packs = getBossPacks();
    var activeId = getActiveBoss().id;
    D.bossList.innerHTML = '';
    for (var i = 0; i < packs.length; i++) {
      (function (b) {
        var active = b.id === activeId;
        var card = document.createElement('article');
        card.className = 'boss-option' + (active ? ' is-active' : '');
        card.setAttribute('role', 'listitem');
        var img = document.createElement('img');
        img.src = b.portrait;
        img.alt = '';
        img.draggable = false;
        var body = document.createElement('div');
        body.className = 'boss-option-body';
        var nm = document.createElement('b');
        nm.textContent = b.name;
        var meta = document.createElement('span');
        meta.textContent = b.role || b.title || '老板娘';
        var small = document.createElement('em');
        small.textContent = (b.builtin ? '内置' : '导入') +
          (b.author ? ' · ' + b.author : '') +
          (b.license ? ' · ' + b.license : '');
        body.appendChild(nm);
        body.appendChild(meta);
        body.appendChild(small);
        var acts = document.createElement('div');
        acts.className = 'boss-option-actions';
        var use = document.createElement('button');
        use.type = 'button';
        use.className = 'boss-use' + (active ? ' is-current' : '');
        use.setAttribute('data-boss-apply', b.id);
        use.textContent = active ? '使用中' : '使用';
        use.disabled = active;
        acts.appendChild(use);
        if (!b.builtin) {
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'boss-del';
          del.setAttribute('data-boss-delete', b.id);
          del.textContent = '删除';
          acts.appendChild(del);
        }
        card.appendChild(img);
        card.appendChild(body);
        card.appendChild(acts);
        D.bossList.appendChild(card);
      })(packs[i]);
    }
  }

  function openBossPanel() {
    if (G.mode !== 'shop' || !D.bossPanel) return;
    renderBossList();
    D.bossPanel.classList.remove('hidden');
    sfx('ui', 'click');
    if (D.btnBossClose) D.btnBossClose.focus();
  }

  function closeBossPanel() {
    if (D.bossPanel) D.bossPanel.classList.add('hidden');
  }

  function deleteBossPack(id) {
    var idx = -1;
    for (var i = 0; i < G.importedBosses.length; i++) if (G.importedBosses[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var prev = G.importedBosses.slice();
    G.importedBosses.splice(idx, 1);
    if (!saveImportedBosses()) { G.importedBosses = prev; return; }
    if (G.bossId === id) {
      setActiveBoss(DEFAULT_BOSS.id, true);
      showShopToast('已恢复默认老板娘 · ' + DEFAULT_BOSS.name);
    } else {
      renderBossList();
      showShopToast('角色包已删除');
    }
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器不支持解压 zip，请用新版 Chrome / Edge。');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readBossZip(arrayBuffer) {
    var u8 = new Uint8Array(arrayBuffer);
    var dv = new DataView(arrayBuffer);
    var eocd = -1;
    var min = Math.max(0, u8.length - 65557);
    for (var i = u8.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 文件。');
    var count = dv.getUint16(eocd + 10, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    if (count > 64) throw new Error('压缩包文件过多。');
    var files = {};
    var p = cdOff;
    var total = 0;
    var decoder = new TextDecoder('utf-8');
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 中央目录损坏。');
      var flags = dv.getUint16(p + 8, true);
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var usize = dv.getUint32(p + 24, true);
      var nlen = dv.getUint16(p + 28, true);
      var elen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var rawName = decoder.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (flags & 1) throw new Error('不支持加密 zip。');
      var name = rawName.replace(/\\/g, '/').split('/').pop().toLowerCase();
      if (!name || /\/$/.test(rawName)) continue;
      if (!/\.(json|png|jpe?g|webp)$/i.test(name)) continue;
      if (dv.getUint32(local, true) !== 0x04034b50) throw new Error('zip 文件头损坏。');
      var lnlen = dv.getUint16(local + 26, true);
      var lelen = dv.getUint16(local + 28, true);
      var start = local + 30 + lnlen + lelen;
      if (start + csize > u8.length) throw new Error('zip 数据越界。');
      if (usize > 6 * 1024 * 1024 || total + usize > 12 * 1024 * 1024) {
        throw new Error('角色包过大，请把立绘压到 6MB 以内。');
      }
      var raw;
      if (method === 0) raw = u8.slice(start, start + csize);
      else if (method === 8) raw = await inflateRaw(u8.subarray(start, start + csize));
      else throw new Error('zip 使用了不支持的压缩方式。');
      total += raw.length;
      files[name] = raw;
    }
    return files;
  }

  function imageBytesToPackPortrait(bytes, mime) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([bytes], { type: mime });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var maxW = 720, maxH = 1100;
          var scale = Math.min(1, maxW / img.width, maxH / img.height);
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          var x = c.getContext('2d');
          x.clearRect(0, 0, c.width, c.height);
          x.drawImage(img, 0, 0, c.width, c.height);
          var data = c.toDataURL('image/webp', 0.86);
          if (data.indexOf('data:image/webp') !== 0) data = c.toDataURL('image/png');
          URL.revokeObjectURL(url);
          if (data.length > 1800000) {
            reject(new Error('立绘太大，请压到 1.8MB 以内再导入。'));
            return;
          }
          resolve(data);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('立绘图片无法读取。'));
      };
      img.src = url;
    });
  }

  async function importBossZip(file) {
    if (!file) return;
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('压缩包不能超过 12MB。');
      showShopToast('正在读取角色包…');
      var files = await readBossZip(await file.arrayBuffer());
      var packKey = null, imgKey = null, keys = Object.keys(files);
      for (var i = 0; i < keys.length; i++) if (keys[i].endsWith('pack.json')) { packKey = keys[i]; break; }
      if (!packKey) throw new Error('压缩包里缺少 pack.json。');
      var meta;
      try {
        meta = JSON.parse(new TextDecoder('utf-8').decode(files[packKey]));
      } catch (e) {
        throw new Error('pack.json 不是合法 JSON。');
      }
      var want = String(meta.portrait || 'portrait.png').split('/').pop().toLowerCase();
      var imgKeys = keys.filter(function (n) { return /\.(png|jpe?g|webp)$/i.test(n); });
      for (var j = 0; j < imgKeys.length; j++) if (imgKeys[j] === want) { imgKey = imgKeys[j]; break; }
      if (!imgKey) imgKey = imgKeys[0];
      if (!imgKey) throw new Error('压缩包里缺少立绘图片（portrait.png / .jpg / .webp）。');
      var mime = /\.png$/i.test(imgKey) ? 'image/png' : /\.webp$/i.test(imgKey) ? 'image/webp' : 'image/jpeg';
      var portrait = await imageBytesToPackPortrait(files[imgKey], mime);
      var lines = (Array.isArray(meta.lines) ? meta.lines : [])
        .map(function (s) { return cleanPackText(s, 80); })
        .filter(Boolean)
        .slice(0, 12);
      if (!lines.length) throw new Error('pack.json 里至少要有一句台词（lines）。');
      var name = cleanPackText(meta.name, 24);
      if (!name) throw new Error('pack.json 缺少 name。');
      var id = cleanPackText(meta.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      if (!id) id = 'custom-' + Date.now().toString(36);
      if (id === DEFAULT_BOSS.id) id += '-custom';
      var rankLines = {};
      if (meta.rankLines && typeof meta.rankLines === 'object') {
        ['S', 'A', 'B', 'C', 'D'].forEach(function (k) {
          var v = cleanPackText(meta.rankLines[k], 80);
          if (v) rankLines[k] = v;
        });
      }
      var pack = {
        id: id,
        name: name,
        role: cleanPackText(meta.role || meta.title || '老板娘', 36),
        en: cleanPackText(meta.en || '', 48),
        title: cleanPackText(meta.title || '', 36),
        portrait: portrait,
        accent: /^#[0-9a-f]{6}$/i.test(String(meta.accent || '')) ? meta.accent : '#b8ca8f',
        lines: lines,
        rankLines: rankLines,
        author: cleanPackText(meta.author || '', 28),
        license: cleanPackText(meta.license || '', 32),
        note: cleanPackText(meta.note || '', 90),
        builtin: false
      };
      var idx = -1;
      for (var m = 0; m < G.importedBosses.length; m++) if (G.importedBosses[m].id === id) { idx = m; break; }
      var prev = G.importedBosses.slice();
      if (idx >= 0) G.importedBosses[idx] = pack;
      else G.importedBosses.push(pack);
      if (G.importedBosses.length > 8) G.importedBosses = G.importedBosses.slice(-8);
      if (!saveImportedBosses()) { G.importedBosses = prev; return; }
      setActiveBoss(pack.id, true);
      showShopToast('已导入老板娘 · ' + pack.name);
    } catch (err) {
      showShopToast(err && err.message ? err.message : '角色包导入失败。');
    } finally {
      if (D.bossFile) D.bossFile.value = '';
    }
  }

  function pickBossLine() {
    var b = getActiveBoss();
    var lines = (b && b.lines && b.lines.length) ? b.lines : BOSS_LINES;
    if (!lines.length) return '……';
    if (lines.length === 1) { G.shopLineIndex = 0; return lines[0]; }
    var idx = -1, guard = 0;
    do {
      idx = Math.floor(Math.random() * lines.length);
      guard++;
    } while (idx === G.shopLineIndex && guard < 8);
    G.shopLineIndex = idx;
    return lines[idx];
  }

  function typeBossLine(text) {
    if (!D.shopLine) return;
    clearInterval(G.shopTypingTimer);
    D.shopLine.textContent = '';
    G.shopLineTyping = true;
    var i = 0;
    G.shopTypingTimer = setInterval(function () {
      i++;
      D.shopLine.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(G.shopTypingTimer);
        G.shopTypingTimer = null;
        G.shopLineTyping = false;
      }
    }, 26);
  }

  function talkToBoss(playSound) {
    if (!D.shopLine) return;
    var text = pickBossLine();
    typeBossLine(text);
    if (D.shopCharacter) {
      D.shopCharacter.classList.remove('speaking');
      void D.shopCharacter.offsetWidth;
      D.shopCharacter.classList.add('speaking');
      setTimeout(function () { D.shopCharacter.classList.remove('speaking'); }, 620);
    }
    if (playSound !== false) sfx('ui', 'click');
  }

  function openShop(from) {
    if (G.mode === 'playing' || G.mode === 'paused' || G.mode === 'ending') return;
    ensureAudio();
    G.shopFrom = from === 'end' ? 'end' : 'menu';
    hideAnnounce();
    hideNotice();
    hideCaption();
    hideScreens();
    hideHUD();
    setMode('shop');
    G.pointer.down = false;
    D.btnShopBack.textContent = G.shopFrom === 'end' ? '← 回到结算' : '← 回到田埂';
    closeBossPanel();
    D.shop.classList.remove('hidden');
    renderShop();
    typeBossLine(pickBossLine());
    sfx('setScene', 'menu');
    updateProgressionLabels();
  }

  function closeShop() {
    if (G.mode !== 'shop') return;
    closeBossPanel();
    clearInterval(G.shopTypingTimer);
    G.shopTypingTimer = null;
    D.shop.classList.add('hidden');
    if (G.shopFrom === 'end' && G.endShown) {
      hideScreens();
      setMode('end');
      hideHUD();
      fillEndScreen();
      D.end.classList.remove('hidden');
      void D.end.offsetWidth;
      D.end.classList.add('is-live');
      sfx('setScene', 'end');
    } else {
      showMenu();
    }
    G.shopFrom = 'menu';
  }

  function useBlessing() {
    if (G.mode !== 'playing' || !G.started || G.furyActive || G.blessing <= 0) return;
    if (activateFury('blessing')) {
      G.blessing = 0;
      saveProgression();
      updateProgressionLabels();
      updateFuryUI();
      showNotice('来自黍的祝福 · 金风提前降临');
    }
  }

  /* ---------------- audio bootstrap ---------------- */
  var audioReady = false;
  var audioReadyCallbacks = [];

  function audioSceneForMode() {
    if (G.mode === 'playing' || G.mode === 'ending' || G.mode === 'pk' || G.mode === 'pkPaused') return 'play';
    if (G.mode === 'end' || G.mode === 'pkEnd') return 'end';
    return 'menu';
  }

  function whenAudioReady(fn) {
    if (typeof fn !== 'function') return;
    if (audioReady) {
      try { fn(); } catch (e) { }
    } else {
      audioReadyCallbacks.push(fn);
    }
  }

  function ensureAudio() {
    if (audioStarted) {
      try {
        if (audio._ctx && audio._ctx.state === 'suspended' && typeof audio._ctx.resume === 'function') {
          var rp = audio._ctx.resume();
          if (rp && rp.catch) rp.catch(function () { });
        }
      } catch (e) { }
      try { audio.setScene(audioSceneForMode()); } catch (e) { }
      return;
    }
    audioStarted = true;
    var started;
    try { started = audio.start(); } catch (e) { started = null; }
    var ready = function () {
      if (audioReady) return;
      audioReady = true;
      try {
        audio.setMuted(G.muted);
        audio.setScene(audioSceneForMode());
        if ((G.mode === 'playing' || G.mode === 'pk') && !G.startSoundPlayed) {
          G.startSoundPlayed = true;
          audio.gameStart();
        }
      } catch (e) { }
      var cbs = audioReadyCallbacks.splice(0, audioReadyCallbacks.length);
      for (var i = 0; i < cbs.length; i++) {
        try { cbs[i](); } catch (e) { }
      }
    };
    if (started && typeof started.then === 'function') {
      started.then(ready).catch(function () { });
    } else {
      ready();
    }
    updateMuteButton();
  }

  function updateMuteButton() {
    D.btnMute.classList.toggle('is-muted', G.muted);
    D.btnMute.setAttribute('aria-label', G.muted ? '开启声音' : '静音');
  }
  function toggleMute() {
    G.muted = !G.muted;
    try { audio.setMuted(G.muted); } catch (e) { }
    storeSet('suilang.muted', G.muted ? '1' : '0');
    updateMuteButton();
    if (!G.muted) sfx('ui', 'click');
    showNotice(G.muted ? '已静音 · 风仍在吹' : '声音已开启');
  }

  /* ---------------- stage & sizing ---------------- */
  function resizeAll() {
    W = Math.max(320, window.innerWidth);
    H = Math.max(360, window.innerHeight);
    // Pixel budget: keep the game crisp but avoid 8MP+ canvases on 4K / retina screens.
    var rawDpr = window.devicePixelRatio || 1;
    var budgetDpr = Math.sqrt(4400000 / Math.max(1, W * H));
    dpr = Math.min(rawDpr, 2, Math.max(1, budgetDpr));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    try { scenes.wheat.resize(W, H, dpr); } catch (e) { }
    try { if (scenes.rice !== scenes.wheat) scenes.rice.resize(W, H, dpr); } catch (e) { }
    try { fields.wheat.resize(W, H); } catch (e) { }
    try { if (fields.rice !== fields.wheat) fields.rice.resize(W, H); } catch (e) { }
    if (!G.pointer.active) {
      G.pointer.x = W * 0.56;
      G.pointer.y = H * 0.62;
    }
    G.pointer.x = clamp(G.pointer.x, 0, W);
    G.pointer.y = clamp(G.pointer.y, 0, H);
    updatePKTouch();
    updatePKAvailability();
    updateScoreTarget();
  }

  function updateScoreTarget() {
    var r = D.score.getBoundingClientRect();
    if (r.width) {
      G.scoreTarget = { x: r.left + r.width * 0.5, y: r.top + r.height * 0.55 };
    }
  }

  function scheduleResize() {
    var now = performance.now();
    if (now - lastResize < 80) return;
    lastResize = now;
    setTimeout(function () {
      resizeAll();
      updateScoreTarget();
    }, 80);
  }

  /* ---------------- screen & state flow ---------------- */
  function hideScreens() {
    [D.menu, D.pause, D.end, D.shop, D.history, D.pkSetup, D.pkEnd].forEach(function (el) {
      if (!el) return;
      el.classList.add('hidden');
      el.classList.remove('is-live');
    });
  }
  function setMode(mode) {
    G.mode = mode;
    app.dataset.mode = mode;
    var standardHud = mode === 'playing' || mode === 'paused' || mode === 'ending';
    var pkVisible = mode === 'pk' || mode === 'pkPaused';
    D.hud.classList.toggle('hud--off', !standardHud);
    D.hud.setAttribute('aria-hidden', standardHud ? 'false' : 'true');
    if (D.pkHud) {
      D.pkHud.classList.toggle('hidden', !pkVisible);
      D.pkHud.setAttribute('aria-hidden', pkVisible ? 'false' : 'true');
    }
    if (mode === 'end' || mode === 'pkEnd') {
      D.hud.classList.add('hud--off');
      D.hud.setAttribute('aria-hidden', 'true');
      if (D.pkHud) {
        D.pkHud.classList.add('hidden');
        D.pkHud.setAttribute('aria-hidden', 'true');
      }
    }
  }
  function showHUD() {
    D.hud.classList.remove('hud--off');
    D.hud.setAttribute('aria-hidden', 'false');
  }
  function hideHUD() {
    D.hud.classList.add('hud--off');
    D.hud.setAttribute('aria-hidden', 'true');
  }

  function clearFx() {
    fx.chaff.length = 0;
    fx.sparks.length = 0;
    fx.rings.length = 0;
    fx.popups.length = 0;
    fx.souls.length = 0;
    fx.slashes.length = 0;
    G.trail.length = 0;
  }

  function resetGameState() {
    G.remaining = DURATION;
    G.started = false;
    G.score = 0;
    G.shownScore = 0;
    G.combo = 0;
    G.comboTimer = 0;
    G.maxCombo = 0;
    G.lastTier = 0;
    G.golden = 0;
    G.totalCuts = 0;
    G.fury = 0;
    G.furyActive = false;
    G.furyTimer = 0;
    G.furyAt = 0;
    G.furyNatureTriggered = false;
    G.furyWarned = false;
    G.furySource = 'nature';
    G.furyExtendPulse = 0;
    G.furyCutCount = 0;
    G.runRecorded = false;
    G.pk = null;
    G.pauseFrom = 'single';
    resetPKSticks();
    G.critters.length = 0;
    G.critterTimer = rand(7, 13);
    G.coinsEarned = 0;
    G.coinAwarded = false;
    G.lastPulseScore = 0;
    G.lastPulseT = 0;
    if (D.score) D.score.classList.remove('score-pop', 'score-big');
    previewCoinBalance = null;
    G.prevBest = G.best;
    G.newBest = false;
    G.timeScale = 1;
    G.slowT = 0;
    G.hitstop = 0;
    G.shake = 0;
    G.flash = 0;
    G.bladeFlash = 0;
    G.stormVis = 0;
    G.stormScoreT = 0;
    G.endT = 0;
    G.endShown = false;
    G.endScoreShown = 0;
    G.endRank = null;
    G.demoT = 0;
    G.demoFury = false;
    G.noticed30 = false;
    G.noticed10 = false;
    G.startSoundPlayed = false;
    G.fieldDrawAcc = 0;
    G.fieldDrawN = 0;
    G.pointer.down = false;
    G.pointer.speed = 0;
    clearFx();
    try {
      field.reset();
      field.setGoldenBoost(1);
    } catch (e) { }
    applyToolLoadout();
    D.combo.classList.remove('on');
    D.frenzy.classList.remove('full', 'active', 'live', 'done', 'waiting', 'btn-show');
    D.btnBlessing.hidden = true;
    D.hint.classList.remove('off');
    hideAnnounce();
    hideNotice();
    hideCaption();
    updateHUD(true);
    updateFuryUI();
  }

  function showMenu() {
    hideScreens();
    resetGameState();
    setMode('menu');
    hideHUD();
    try { field.setGoldenBoost(1.15); } catch (e) { }
    D.menu.classList.remove('hidden');
    void D.menu.offsetWidth;
    D.menu.classList.add('is-live');
    updateBestLabels();
    updateProgressionLabels();
    updateHistorySummary();
    updatePKAvailability();
    sfx('setScene', 'menu');
    updateScoreTarget();
  }

  function updateBestLabels() {
    D.bestMenu.textContent = G.best > 0 ? fmt(G.best) : '—';
    if (D.bestEnd) D.bestEnd.textContent = G.best > 0 ? fmt(G.best) : '0';
  }

  function startGame() {
    if (G.mode === 'playing' || G.mode === 'pk' || G.mode === 'pkPaused') return;
    hideScreens();
    resetGameState();
    setMode('playing');
    showHUD();
    ensureAudio();
    setTimeout(function () {
      if (G.mode !== 'playing') return;
      sfx('setScene', 'play');
      if (!G.startSoundPlayed) {
        G.startSoundPlayed = true;
        sfx('gameStart');
      }
    }, 0);
    G.demoT = 0;
    D.hint.classList.remove('off');
    updateHUD(true);
    updateProgressionLabels();
    updateScoreTarget();
    setTimeout(showCaption, 450);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function pauseGame() {
    if (G.mode === 'pk') {
      G.pauseFrom = 'pk';
      setMode('pkPaused');
      G.pointer.down = false;
      resetPKSticks();
      resetPKKeys();
      D.pause.classList.remove('hidden');
      sfx('pause');
      return;
    }
    if (G.mode !== 'playing') return;
    G.pauseFrom = 'single';
    setMode('paused');
    G.pointer.down = false;
    D.pause.classList.remove('hidden');
    sfx('pause');
  }

  function resumeGame() {
    if (G.mode === 'pkPaused') {
      D.pause.classList.add('hidden');
      setMode('pk');
      resetPKSticks();
      resetPKKeys();
      G.pauseFrom = 'single';
      sfx('resume');
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      return;
    }
    if (G.mode !== 'paused') return;
    D.pause.classList.add('hidden');
    setMode('playing');
    G.pointer.lastT = 0;
    sfx('resume');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function beginEnding() {
    if (G.mode !== 'playing') return;
    setMode('ending');
    G.remaining = 0;
    G.endT = 0;
    G.timeScale = 0.32;
    G.furyActive = false;
    G.furyTimer = 0;
    G.fury = 0;
    G.stormVis = 0;
    G.stormScoreT = 0;
    try { field.setGoldenBoost(1); } catch (e) { }
    G.critters.length = 0;
    D.frenzy.classList.remove('full', 'active', 'live', 'done', 'waiting');
    D.btnBlessing.hidden = true;
    D.hint.classList.add('off');
    G.newBest = G.score > G.best;
    if (G.newBest) {
      G.best = G.score;
      storeSet('suilang3.best', G.best);
    }
    G.endRank = rankFor(G.score);
    showAnnounce('日暮收工', 'THE SUN GOES DOWN', true);
    updateFuryUI();
    updateBestLabels();
    sfx('setScene', 'end');
  }

  function finishEnding() {
    if (G.endShown) return;
    G.endShown = true;
    try {
      field.reset();
      field.setGoldenBoost(1);
    } catch (e) { }
    awardRunCoins();
    recordRun();
    hideScreens();
    setMode('end');
    hideHUD();
    D.end.classList.remove('hidden');
    void D.end.offsetWidth;
    D.end.classList.add('is-live');
    fillEndScreen();
    G.endScoreShown = 0;
    D.finalScore.textContent = '0';
    sfx('gameEnd', G.endRank.letter);
    sfx('setScene', 'end');
  }

  function rankFor(score) {
    for (var i = 0; i < RANKS.length; i++) {
      if (score >= RANKS[i].min) return RANKS[i];
    }
    return RANKS[RANKS.length - 1];
  }

  function fillEndScreen() {
    var rank = G.endRank || rankFor(G.score);
    D.rankLetter.textContent = rank.letter;
    D.rankTitle.textContent = G.map === 'rice' ? (rank.riceTitle || rank.title) : rank.title;
    D.endQuote.textContent = G.map === 'rice' ? (rank.riceQuote || rank.quote) : rank.quote;
    var endBoss = getActiveBoss();
    if (D.endBossPortrait) D.endBossPortrait.src = endBoss.portrait;
    if (D.endBossName) D.endBossName.textContent = endBoss.name;
    if (D.endBossGrade) D.endBossGrade.textContent = rank.letter;
    if (D.endBossComment) {
      var bossLine = endBoss.rankLines && endBoss.rankLines[rank.letter];
      D.endBossComment.textContent = bossLine || GENERIC_RANK_COMMENTS[rank.letter] || rank.quote;
    }
    if (D.endBossEval) {
      D.endBossEval.setAttribute('data-grade', rank.letter);
      D.endBossEval.setAttribute('aria-label', '老板娘' + endBoss.name + '的评价：' + rank.letter);
    }
    D.statCombo.textContent = fmt(G.maxCombo);
    D.statGolden.textContent = fmt(G.golden);
    D.bestEnd.textContent = fmt(G.best);
    D.newBest.classList.toggle('hidden', !G.newBest);
    D.coinsEarned.textContent = '+' + fmt(G.coinsEarned);
    D.coinBalance.textContent = fmt(previewCoinBalance != null ? previewCoinBalance : G.coins);
    updateBestLabels();
    updateProgressionLabels();
  }

  function showEndPreview() {
    hideScreens();
    resetGameState();
    G.score = 6842;
    G.shownScore = 6842;
    G.maxCombo = 118;
    G.golden = 44;
    G.started = true;
    G.remaining = 0;
    G.best = 6842;
    G.prevBest = 0;
    G.newBest = true;
    G.endShown = true;
    G.coinsEarned = Math.floor(G.score / 1000);
    G.coinAwarded = true;
    previewCoinBalance = G.coins + G.coinsEarned;
    G.endRank = rankFor(G.score);
    setMode('end');
    hideHUD();
    D.end.classList.remove('hidden');
    void D.end.offsetWidth;
    D.end.classList.add('is-live');
    fillEndScreen();
    G.endScoreShown = 0;
    D.finalScore.textContent = '0';
    sfx('setScene', 'end');
  }

  /* ---------------- timer, combo, fury ---------------- */
  function currentMult() {
    var tier = Math.min(6, Math.floor(G.combo / 10));
    return 1 + tier * 0.5;
  }

  function beginTimer() {
    if (G.started) return;
    G.started = true;
    G.furyAt = rand(FURY_WINDOW_MIN, FURY_WINDOW_MAX);
    G.furyWarned = false;
    G.furyNatureTriggered = false;
    D.hint.classList.add('off');
    showNotice('第一镰 · 金风开始择时');
    updateScoreTarget();
    updateFuryUI();
  }

  function resetCombo() {
    G.combo = 0;
    G.comboTimer = 0;
    G.lastTier = 0;
    D.combo.classList.remove('on');
  }

  function updateFuryUI() {
    var active = G.furyActive;
    var canBless = G.mode === 'playing' && G.started && !active && G.blessing > 0;
    var waiting = G.started && !active && !G.furyNatureTriggered;
    var done = G.started && !active && G.furyNatureTriggered;
    if (active) {
      D.frenzyFill.style.transform = 'scaleX(' + clamp(G.furyTimer / FURY_DURATION, 0, 1).toFixed(4) + ')';
    } else {
      D.frenzyFill.style.transform = 'scaleX(0)';
    }
    var status;
    if (active) status = Math.max(0, G.furyTimer).toFixed(1) + ' 秒';
    else if (waiting) status = '静候金风';
    else if (done) status = '金风已过';
    else status = '待开镰';
    if (D.frenzyState.textContent !== status) D.frenzyState.textContent = status;

    var rule;
    if (active) rule = '每 25 穗 +0.05 秒 · ' + (G.furyCutCount % FURY_EXTENSION_EVERY) + '/' + FURY_EXTENSION_EVERY;
    else if (waiting) rule = '将在 20–40 秒间随机降临 · 每 25 穗 +0.05 秒';
    else if (done) rule = (G.map === 'rice' ? '稻浪' : '麦浪') + '记得那阵风';
    else rule = '第一镰之后，金风开始择时';
    if (D.furyRule.textContent !== rule) D.furyRule.textContent = rule;

    D.frenzy.classList.toggle('live', active);
    D.frenzy.classList.toggle('waiting', waiting);
    D.frenzy.classList.toggle('done', done);
    D.frenzy.classList.toggle('extend', G.furyExtendPulse > 0);
    D.frenzy.classList.remove('full', 'active');
    D.btnBlessing.hidden = !canBless;
    if (D.blessingCount) D.blessingCount.textContent = '×' + G.blessing;
  }

  function activateFury(source) {
    if ((G.mode !== 'playing' && G.mode !== 'pk') || G.furyActive || !G.started) return false;
    var isPK = G.mode === 'pk';
    G.furyActive = true;
    G.furyTimer = FURY_DURATION;
    G.furySource = source || 'nature';
    G.furyCutCount = 0;
    G.fury = 0;
    if (isPK) {
      G.slowT = 0;
      G.timeScale = 1;
      G.hitstop = 0;
    } else {
      G.slowT = 0.62;
      G.timeScale = 0.32;
      G.hitstop = 0.05;
      D.frenzy.classList.remove('waiting', 'done');
      D.frenzy.classList.add('live');
      updateFuryUI();
    }
    G.stormVis = 1.15;
    G.stormScoreT = 1.25;
    G.flash = 0.4;
    G.shake = 14;
    G.bladeFlash = 1;
    G.furyExtendPulse = 0.25;
    hideNotice();
    try {
      if (field.stormCut) field.stormCut();
      if (field.setGoldenBoost) field.setGoldenBoost(2.7);
    } catch (e) { }
    showAnnounce('丰饶之刻', isPK ? 'SHARED GOLDEN GUST' : (G.furySource === 'blessing' ? 'BLESSING OF SHU' : 'THE GOLDEN GUST'));
    sfx('frenzyStart');
    sfx('storm');
    var horizon = H * 0.55;
    for (var i = 0; i < 26; i++) {
      fx.sparks.push({
        x: rand(0, W), y: rand(horizon, H),
        vx: rand(-60, 60), vy: rand(-220, -30),
        life: rand(0.6, 1.4), max: 1.4, size: rand(8, 22)
      });
    }
    if (isPK) updatePKHud(true);
    return true;
  }

  function endFury() {
    G.furyActive = false;
    G.furyTimer = 0;
    G.furyCutCount = 0;
    G.fury = 0;
    try { field.setGoldenBoost(1); } catch (e) { }
    if (G.mode === 'pk' || G.mode === 'pkPaused') updatePKHud(true);
    else updateFuryUI();
    sfx('frenzyEnd');
  }

  /* ---------------- field critters: field mouse / paddy fish ---------------- */
  function resetCritters() {
    G.critters.length = 0;
    G.critterTimer = rand(7, 13);
  }

  function spawnCritter() {
    if (G.mode !== 'playing' || !G.started || G.critters.length) return;
    var rice = G.map === 'rice';
    var x0 = rand(W * 0.16, W * 0.84);
    var baseY = rand(H * 0.64, H * 0.84);
    var guard = 0;
    while (G.pointer.active && Math.hypot(G.pointer.x - x0, G.pointer.y - baseY) < 90 && guard < 6) {
      x0 = rand(W * 0.16, W * 0.84);
      guard++;
    }
    var c = {
      type: rice ? 'fish' : 'mouse',
      x0: x0, x: x0, baseY: baseY, y: baseY,
      t: 0,
      dur: rice ? rand(1.15, 1.65) : rand(1.9, 2.8),
      dir: Math.random() < 0.5 ? -1 : 1,
      run: rice ? rand(44, 92) : rand(34, 82),
      hop: rice ? rand(105, 168) : rand(30, 52),
      scale: rice ? rand(1.55, 2.05) : rand(1.55, 1.95),
      angle: 0,
      spin: 0,
      vx: 0, vy: 0,
      flight: 0,
      state: 'live',
      phase: rand(0, TAU)
    };
    G.critters.push(c);
    G.critterTimer = rand(11, 20);
    if (rice) {
      fx.rings.push({ x: x0, y: baseY, r: 4, maxR: 52, life: 0.7, max: 0.7, w: 1 });
      fx.rings.push({ x: x0, y: baseY, r: 2, maxR: 30, life: 0.45, max: 0.45, w: 0.7 });
      for (var d = 0; d < 5; d++) {
        fx.chaff.push({
          x: x0 + rand(-15, 15), y: baseY - rand(0, 5),
          vx: rand(-55, 55), vy: rand(-180, -60), g: 500,
          rot: rand(0, TAU), vr: rand(-6, 6),
          life: rand(0.4, 0.8), max: 0.8, size: rand(1.6, 3.2),
          color: pick(['#eaf4e8', '#c4d9d0', '#f7f2d8'])
        });
      }
    } else {
      for (var m = 0; m < 5; m++) {
        fx.chaff.push({
          x: x0 + rand(-12, 12), y: baseY - rand(0, 8),
          vx: rand(-35, 35), vy: rand(-110, -30), g: 480,
          rot: rand(0, TAU), vr: rand(-6, 6),
          life: rand(0.35, 0.7), max: 0.7, size: rand(1.4, 3),
          color: pick(['#8f6b3c', '#b08c50', '#e3c486'])
        });
      }
    }
  }

  function hitCritter(c) {
    if (!c || c.state !== 'live') return;
    c.state = 'fly';
    c.flight = 0;
    var dx = c.x - G.pointer.x;
    var dy = c.y - G.pointer.y;
    var len = Math.max(22, Math.sqrt(dx * dx + dy * dy));
    c.vx = dx / len * rand(190, 330) + clamp(G.pointer.vx || 0, -900, 900) * 0.12;
    c.vy = -rand(280, 440);
    c.spin = rand(-14, 14);
    c.angle = rand(0, TAU);
    G.shake = Math.max(G.shake, 4.5);
    G.bladeFlash = Math.max(G.bladeFlash, 0.45);
    G.flash = Math.max(G.flash, 0.06);
    var fish = c.type === 'fish';
    var colors = fish
      ? ['#eaf6ef', '#b9d9d3', '#fff7db', '#f0b967']
      : ['#8f6b3c', '#b08c50', '#e3c486', '#fff0c8'];
    for (var i = 0; i < (fish ? 14 : 10); i++) {
      fx.chaff.push({
        x: c.x + rand(-8, 8), y: c.y + rand(-6, 6),
        vx: rand(-210, 210), vy: rand(-260, -40), g: fish ? 620 : 480,
        rot: rand(0, TAU), vr: rand(-12, 12),
        life: rand(0.45, 0.95), max: 0.95, size: rand(1.8, 4),
        color: pick(colors)
      });
    }
    fx.rings.push({ x: c.x, y: c.y, r: 4, maxR: fish ? 58 : 38, life: 0.5, max: 0.5, w: 1.2 });
    if (fish) {
      fx.rings.push({ x: c.x0, y: c.baseY, r: 5, maxR: 72, life: 0.7, max: 0.7, w: 1 });
    }
    sfx('cut', {
      strength: 0.42, combo: 1, golden: false,
      pan: clamp(c.x / W * 2 - 1, -0.8, 0.8)
    });
    G.critterTimer = rand(11, 20);
  }

  function updateCritters(dt) {
    if (!G.critters.length) return;
    for (var i = G.critters.length - 1; i >= 0; i--) {
      var c = G.critters[i];
      if (c.state === 'fly') {
        c.flight += dt;
        c.vy += 880 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.angle += c.spin * dt;
        if (c.flight > 1.1 || c.y > H + 90) G.critters.splice(i, 1);
        continue;
      }
      c.t += dt;
      var p = clamp(c.t / c.dur, 0, 1);
      if (c.type === 'fish') {
        c.x = c.x0 + c.dir * c.run * p;
        c.y = c.baseY - 4 * c.hop * p * (1 - p);
        var prevY = c.baseY - 4 * c.hop * Math.max(0, p - 0.01) * (1 - Math.max(0, p - 0.01));
        c.angle = c.dir * clamp(Math.atan2(c.y - prevY, c.run * 0.01 + 0.1), -0.9, 0.9);
      } else {
        c.x = c.x0 + c.dir * c.run * p;
        var hop = Math.abs(Math.sin(p * Math.PI * 2.15)) * c.hop;
        c.y = c.baseY - hop * (p < 0.13 ? p / 0.13 : 1);
        c.angle = c.dir * Math.sin(p * Math.PI * 3.2) * 0.08;
      }
      if (G.pointer.active && G.mode === 'playing') {
        var hitR = c.type === 'fish' ? 38 * c.scale : 30 * c.scale;
        var dx = G.pointer.x - c.x;
        var dy = G.pointer.y - c.y;
        if (dx * dx + dy * dy < hitR * hitR && c.t > 0.08) hitCritter(c);
      }
      if (p >= 1 || c.t > c.dur + 0.35) {
        if (c.type === 'fish') {
          fx.rings.push({ x: c.x, y: c.baseY, r: 5, maxR: 50, life: 0.55, max: 0.55, w: 0.8 });
        }
        G.critters.splice(i, 1);
        G.critterTimer = rand(11, 20);
      }
    }
  }

  function updateCritterSpawn(dt) {
    if (!G.started || G.mode !== 'playing') return;
    G.critterTimer -= dt;
    if (G.critterTimer <= 0) {
      if (!G.critters.length) spawnCritter();
      if (G.critterTimer <= 0) G.critterTimer = rand(10, 18);
    }
  }

  function drawFieldMouse(ctx, c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.scale(c.dir * c.scale, c.scale);
    // tail
    ctx.strokeStyle = 'rgba(60,35,18,.9)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-9, 1);
    ctx.bezierCurveTo(-19, 8, -24, -5, -18, -10);
    ctx.stroke();
    // body
    var bg = ctx.createLinearGradient(0, -8, 0, 8);
    bg.addColorStop(0, '#6d4a2a');
    bg.addColorStop(0.6, '#55371d');
    bg.addColorStop(1, '#342012');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(-1, 1, 11, 7, -0.08, 0, TAU);
    ctx.fill();
    // head
    ctx.fillStyle = '#604127';
    ctx.beginPath();
    ctx.ellipse(8, -2.5, 5.6, 4.8, -0.2, 0, TAU);
    ctx.fill();
    // ears
    ctx.fillStyle = '#7c5732';
    ctx.beginPath(); ctx.arc(6.5, -7.2, 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(220,160,130,.55)';
    ctx.beginPath(); ctx.arc(6.8, -7.3, 2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6b4828';
    ctx.beginPath(); ctx.arc(10.2, -6.5, 2.8, 0, TAU); ctx.fill();
    // eye / nose
    ctx.fillStyle = '#0e0905';
    ctx.beginPath(); ctx.arc(10.2, -3, 1.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e6a596';
    ctx.beginPath(); ctx.arc(13.2, -1.7, 1, 0, TAU); ctx.fill();
    // belly
    ctx.fillStyle = 'rgba(210,170,125,.55)';
    ctx.beginPath(); ctx.ellipse(1, 4, 6.5, 2.2, 0.1, 0, TAU); ctx.fill();
    // paws
    ctx.fillStyle = '#2c1a0e';
    ctx.beginPath(); ctx.ellipse(-5, 7, 2.4, 1.3, 0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, 7, 2.2, 1.2, -0.1, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawPaddyFish(ctx, c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.scale(c.dir * c.scale, c.scale);
    // tail
    ctx.fillStyle = '#d97742';
    ctx.beginPath();
    ctx.moveTo(-11, 0);
    ctx.lineTo(-23, -8);
    ctx.quadraticCurveTo(-19, 0, -23, 8);
    ctx.closePath();
    ctx.fill();
    // body
    var bg = ctx.createLinearGradient(-10, -8, 12, 8);
    bg.addColorStop(0, '#d96a37');
    bg.addColorStop(0.45, '#f2a45f');
    bg.addColorStop(0.8, '#f8d7a1');
    bg.addColorStop(1, '#fff0cf');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.bezierCurveTo(-7, -9, 7, -8, 15, 0);
    ctx.bezierCurveTo(7, 8, -7, 9, -12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,43,20,.45)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // dorsal fin
    ctx.fillStyle = 'rgba(228,117,61,.85)';
    ctx.beginPath();
    ctx.moveTo(-3, -6);
    ctx.quadraticCurveTo(1, -13, 7, -7);
    ctx.closePath();
    ctx.fill();
    // eye
    ctx.fillStyle = '#241008';
    ctx.beginPath(); ctx.arc(9, -2, 1.2, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,248,225,.8)';
    ctx.beginPath(); ctx.arc(9.4, -2.4, 0.45, 0, TAU); ctx.fill();
    // scales
    ctx.strokeStyle = 'rgba(255,240,200,.38)';
    ctx.lineWidth = 0.5;
    for (var s = 0; s < 3; s++) {
      ctx.beginPath();
      ctx.arc(3 - s * 4, 0, 3.8, -0.8, 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCritters(ctx) {
    if (!G.critters.length) return;
    for (var i = 0; i < G.critters.length; i++) {
      var c = G.critters[i];
      var a = c.state === 'fly' ? clamp(1 - c.flight / 1.1, 0, 1) : 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.22 * a;
      ctx.drawImage(sprGold, c.x - 34, c.y - 34, 68, 68);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.18 * a;
      ctx.fillStyle = c.type === 'fish' ? 'rgba(40,80,80,.55)' : 'rgba(60,38,18,.5)';
      ctx.beginPath();
      ctx.ellipse(c.x0, c.baseY + 2, c.type === 'fish' ? 24 : 15, c.type === 'fish' ? 7 : 5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = a;
      if (c.type === 'fish') drawPaddyFish(ctx, c);
      else drawFieldMouse(ctx, c);
      ctx.restore();
    }
  }

  /* ---------------- cuts & scoring ---------------- */
  function registerFuryHarvest() {
    if (!G.furyActive) return false;
    G.furyCutCount++;
    if (G.furyCutCount >= FURY_EXTENSION_EVERY) {
      G.furyCutCount -= FURY_EXTENSION_EVERY;
      G.furyTimer += FURY_EXTENSION;
      G.furyExtendPulse = 0.22;
      return true;
    }
    return false;
  }

  function handleCuts(events) {
    if (!events || !events.length || G.mode !== 'playing') return;
    if (!G.started) beginTimer();
    var stormScoring = G.stormScoreT > 0;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var golden = !!ev.golden;
      G.combo++;
      G.comboTimer = COMBO_WINDOW;
      if (G.combo > G.maxCombo) G.maxCombo = G.combo;
      var mult = currentMult();
      var gain;
      if (stormScoring) gain = Math.round((golden ? 30 : 2) * (G.toolScoreMult || 1));
      else gain = Math.round((golden ? 15 : 1) * mult * (G.furyActive ? 2 : 1) * (G.toolScoreMult || 1));
      G.score += gain;
      G.totalCuts++;
      if (golden) {
        G.golden++;
        spawnGolden(ev, gain);
      } else {
        spawnCutChaff(ev, stormScoring);
      }
      registerFuryHarvest();
      var tier = Math.min(6, Math.floor(G.combo / 10));
      if (tier > G.lastTier) {
        G.lastTier = tier;
        if (tier > 0) {
          D.comboMult.classList.remove('pop');
          void D.comboMult.offsetWidth;
          D.comboMult.classList.add('pop');
        }
      }
      if (G.stormScoreT <= 0 && G.combo > 0 && G.combo % 25 === 0) {
        popup('连斩 ×' + currentMult().toFixed(1), ev.x, ev.y - 38, 'tier');
        sfx('comboMilestone', Math.floor(G.combo / 25));
      }
      if (G.soundBudget > 0) {
        G.soundBudget--;
        sfx('cut', {
          strength: clamp((ev.scale || 0.6) * 0.7 + 0.15, 0.25, 1),
          combo: G.combo, golden: golden,
          pan: clamp(ev.x / W * 2 - 1, -0.85, 0.85)
        });
      }
      G.shake = Math.min(8, G.shake + (golden ? 2.3 : 0.24));
      G.bladeFlash = Math.max(G.bladeFlash, golden ? 0.55 : 0.16);
      if (golden) {
        G.flash = Math.max(G.flash, 0.14);
        G.hitstop = Math.max(G.hitstop, 0.018);
      }
      addSlash(ev.x, ev.y, golden);
    }
    D.combo.classList.add('on');
    updateFuryUI();
  }

  function spawnCutChaff(ev, quiet) {
    var count = quiet ? 1 : (Math.random() < 0.35 ? 3 : 2);
    var colors = G.map === 'rice'
      ? ['#c6d499', '#e4e2ad', '#9eb46e', '#f5efc6']
      : ['#e7b45c', '#f5d48c', '#c98f3b', '#ffe6a8'];
    for (var i = 0; i < count; i++) {
      fx.chaff.push({
        x: ev.x + rand(-8, 8) * (ev.scale || 1),
        y: ev.y + rand(-4, 4),
        vx: rand(-90, 90) + (ev.angle ? Math.cos(ev.angle) * 40 : 0),
        vy: rand(-170, -40),
        g: 540, rot: rand(0, TAU), vr: rand(-9, 9),
        life: rand(0.5, 1.1), max: 1.1,
        size: rand(1.6, 4.2) * (0.8 + (ev.scale || 1) * 0.25),
        color: pick(colors)
      });
    }
    if (fx.chaff.length > 460) fx.chaff.splice(0, fx.chaff.length - 460);
  }

  function spawnGolden(ev, gain) {
    var storm = G.stormScoreT > 0;
    if (!storm) {
      fx.rings.push({ x: ev.x, y: ev.y, r: 6, maxR: 62 + 22 * (ev.scale || 1), life: 0.55, max: 0.55, w: 1.6 });
      fx.rings.push({ x: ev.x, y: ev.y, r: 12, maxR: 100 + 30 * (ev.scale || 1), life: 0.8, max: 0.8, w: 0.9 });
    } else if (Math.random() < 0.35) {
      fx.rings.push({ x: ev.x, y: ev.y, r: 4, maxR: 44, life: 0.4, max: 0.4, w: 1 });
    }
    var sparkCount = storm ? 5 : 13;
    for (var i = 0; i < sparkCount; i++) {
      var a = rand(0, TAU), sp = rand(60, 330);
      fx.sparks.push({
        x: ev.x, y: ev.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rand(0.45, 1.1), max: 1.1, size: rand(6, 18) * (storm ? 0.75 : 1)
      });
    }
    var chaffCount = storm ? 3 : 9;
    for (var j = 0; j < chaffCount; j++) {
      fx.chaff.push({
        x: ev.x, y: ev.y,
        vx: rand(-150, 150), vy: rand(-220, -60), g: 500,
        rot: rand(0, TAU), vr: rand(-12, 12),
        life: rand(0.7, 1.4), max: 1.4,
        size: rand(2.2, 5),
        color: pick(['#ffe6a8', '#ffd67a', '#fff1c8'])
      });
    }
    if (!storm || Math.random() < 0.06) {
      popup('+' + gain, ev.x, ev.y - 14, 'gold');
    }
    if (!storm && fx.souls.length < 14) {
      fx.souls.push({
        x: ev.x, y: ev.y, sx: ev.x, sy: ev.y,
        tx: G.scoreTarget.x, ty: G.scoreTarget.y,
        cx: ev.x + rand(-80, 80), cy: ev.y - rand(120, 220),
        t: 0, dur: rand(0.65, 0.95), size: rand(10, 17)
      });
    }
    G.flash = Math.max(G.flash, storm ? 0.06 : 0.2);
    if (!storm) G.hitstop = Math.max(G.hitstop, 0.03);
    G.shake = Math.min(9, G.shake + (storm ? 1.1 : 3));
  }

  function addSlash(x, y, golden) {
    if (fx.slashes.length > 22) return;
    var ang = Math.atan2(G.pointer.vy, G.pointer.vx);
    if (!isFinite(ang)) ang = G.cursorAngle;
    fx.slashes.push({
      x: x, y: y, a: ang, life: golden ? 0.3 : 0.18,
      max: golden ? 0.3 : 0.18, size: golden ? 42 : 24, gold: golden
    });
  }

  function spawnStormSparks(x) {
    if (fx.sparks.length > 300) return;
    for (var i = 0; i < 2; i++) {
      fx.sparks.push({
        x: x + rand(-30, 30), y: rand(H * 0.5, H),
        vx: rand(-30, 30), vy: rand(-140, -20),
        life: rand(0.4, 0.9), max: 0.9, size: rand(5, 14)
      });
    }
  }

  function addTrail(x, y, now, speed) {
    G.trail.push({ x: x, y: y, t: now, s: speed });
    if (G.trail.length > 30) G.trail.shift();
  }

  function popup(text, x, y, kind) {
    if (fx.popups.length > 26) fx.popups.shift();
    fx.popups.push({
      text: text, x: x, y: y, life: kind === 'tier' ? 0.9 : 0.8,
      max: kind === 'tier' ? 0.9 : 0.8, kind: kind || 'gold',
      vy: kind === 'tier' ? -32 : -46
    });
  }

  /* ---------------- field & demo ---------------- */
  function buildFieldEnv() {
    var px = G.pointer.x, py = G.pointer.y;
    if ((G.mode === 'pk' || G.mode === 'pkPaused') && G.pk) {
      px = G.pk.p1.x;
      py = G.pk.p1.y;
    }
    return {
      wind: G.wind,
      gust: G.gust,
      pointer: { x: px, y: py, active: true },
      frenzy: G.furyActive,
      reduced: G.reduced
    };
  }

  function demoStep(dt) {
    G.demoT += dt;
    var t = G.demoT;
    var px = G.pointer.x, py = G.pointer.y;
    var x = W * (0.5 + 0.3 * Math.sin(t * 0.85) + 0.11 * Math.sin(t * 2.17 + 1.3));
    var y = H * (0.66 + 0.13 * Math.sin(t * 1.33 + 0.4) + 0.035 * Math.sin(t * 3.1));
    G.pointer.active = true;
    G.pointer.down = true;
    G.pointer.x = x; G.pointer.y = y;
    G.pointer.vx = (x - px) / Math.max(dt, 0.001);
    G.pointer.vy = (y - py) / Math.max(dt, 0.001);
    G.pointer.speed = 2.2;
    G.soundBudget = 3;
    try {
      field.cut(px, py, x, y, 2.2, true);
    } catch (e) { }
    handleCuts(field.drainEvents());
    addTrail(x, y, performance.now(), 2.2);
    if (G.demoT > 1.2 && !G.started) beginTimer();
  }

  /* ---------------- fx updates ---------------- */
  function updateFx(dt) {
    var i, p;
    for (i = fx.chaff.length - 1; i >= 0; i--) {
      p = fx.chaff[i];
      p.life -= dt;
      if (p.life <= 0) { fx.chaff.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.vx += G.wind * 55 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (i = fx.sparks.length - 1; i >= 0; i--) {
      p = fx.sparks[i];
      p.life -= dt;
      if (p.life <= 0) { fx.sparks.splice(i, 1); continue; }
      p.vy += 240 * dt;
      p.vx += G.wind * 32 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (i = fx.rings.length - 1; i >= 0; i--) {
      p = fx.rings[i];
      p.life -= dt;
      if (p.life <= 0) { fx.rings.splice(i, 1); continue; }
      p.r = lerp(p.r, p.maxR, 1 - Math.exp(-dt * 7));
    }
    for (i = fx.popups.length - 1; i >= 0; i--) {
      p = fx.popups[i];
      p.life -= dt;
      if (p.life <= 0) { fx.popups.splice(i, 1); continue; }
      p.y += p.vy * dt;
      p.vy *= Math.exp(-dt * 1.8);
    }
    for (i = fx.souls.length - 1; i >= 0; i--) {
      p = fx.souls[i];
      p.t += dt / p.dur;
      if (p.t >= 1) { fx.souls.splice(i, 1); }
    }
    for (i = fx.slashes.length - 1; i >= 0; i--) {
      p = fx.slashes[i];
      p.life -= dt;
      if (p.life <= 0) fx.slashes.splice(i, 1);
    }
    var now = performance.now();
    while (G.trail.length && now - G.trail[0].t > 190) G.trail.shift();
    G.pointer.speed *= Math.exp(-dt * 5);
    G.shake *= Math.exp(-dt * 7.5);
    G.flash *= Math.exp(-dt * 7);
    G.bladeFlash *= Math.exp(-dt * 9);
    if (G.pointer.speed < 0.01) G.pointer.speed = 0;
  }

  /* ---------------- wind ---------------- */
  function updateWind(dt) {
    if (G.furyActive) {
      G.gust += (0.95 - G.gust) * Math.min(1, dt * 2.5);
      G.wind = 0.95 + Math.sin(G.visTime * 1.2) * 0.08;
      return;
    }
    G.gustTimer -= dt;
    if (!G.gustActive && G.gustTimer <= 0) {
      G.gustActive = true;
      G.gustElapsed = 0;
      G.gustDur = rand(2.2, 4.4);
      G.gustStrength = rand(0.35, 0.95);
      G.gustTimer = rand(7, 13);
    }
    if (G.gustActive) {
      G.gustElapsed += dt;
      var x = G.gustElapsed / G.gustDur;
      var env = Math.sin(clamp(x, 0, 1) * Math.PI);
      G.gust = env * G.gustStrength;
      if (x >= 1) {
        G.gustActive = false;
        G.gust = 0;
      }
    } else {
      G.gust *= Math.exp(-dt * 2);
    }
    G.wind = 0.26 + 0.13 * Math.sin(G.visTime * 0.23) + G.gust * 0.72;
    if (G.mode === 'menu') G.wind *= 0.55;
  }

  /* ---------------- per-mode updates ---------------- */
  function updatePlaying(raw) {
    if (G.slowT > 0) {
      G.slowT -= raw;
      G.timeScale = 0.32 + 0.68 * smooth(1 - Math.max(0, G.slowT) / 0.62);
      if (G.slowT <= 0) G.timeScale = 1;
    } else {
      G.timeScale = 1;
    }
    var dt = raw * G.timeScale;
    if (G.hitstop > 0) {
      G.hitstop -= raw;
      dt *= 0.18;
    }
    G.soundBudget = G.stormScoreT > 0 ? 4 : 8;

    if (G.started) {
      G.remaining -= dt;
      if (G.remaining <= 0) {
        G.remaining = 0;
        beginEnding();
        return;
      }
      if (!G.noticed30 && G.remaining <= 30) {
        G.noticed30 = true;
        showNotice('日头偏西 · 还有三十秒');
      }
      if (!G.noticed10 && G.remaining <= 10) {
        G.noticed10 = true;
        showNotice('最后一缕日光');
      }
    }
    if (G.comboTimer > 0) {
      G.comboTimer -= dt;
      if (G.comboTimer <= 0) resetCombo();
    }
    if (G.furyActive) {
      G.furyTimer -= dt;
      if (G.furyTimer <= 0) endFury();
    }
    if (G.started) {
      var elapsed = DURATION - G.remaining;
      if (!G.furyWarned && !G.furyNatureTriggered && !G.furyActive &&
          elapsed >= Math.max(1, G.furyAt - 3)) {
        G.furyWarned = true;
        showNotice('风里有金穗的味道…');
      }
      if (!G.furyNatureTriggered && !G.furyActive && elapsed >= G.furyAt) {
        G.furyNatureTriggered = true;
        activateFury('nature');
      }
    }
    if (G.furyExtendPulse > 0) G.furyExtendPulse = Math.max(0, G.furyExtendPulse - raw);
    if (G.stormVis > 0) {
      G.stormVis = Math.max(0, G.stormVis - dt);
      var sx = lerp(-W * 0.15, W * 1.15, 1 - G.stormVis / 1.15);
      if (Math.random() < 0.7) spawnStormSparks(sx);
    }
    if (G.stormScoreT > 0) G.stormScoreT = Math.max(0, G.stormScoreT - dt);

    if (G.demo) demoStep(dt);

    try {
      field.update(dt, G.visTime, buildFieldEnv());
      handleCuts(field.drainEvents());
    } catch (e) {
      if (!G._fieldError) {
        G._fieldError = true;
        console.error('Field error:', e);
      }
    }
    updateCritters(dt);
    updateCritterSpawn(dt);
    G.shownScore += (G.score - G.shownScore) * (1 - Math.exp(-raw * 9));
    if (Math.abs(G.score - G.shownScore) < 0.2) G.shownScore = G.score;
    updateFx(dt);
    updateFuryUI();
  }

  function updateEnding(raw) {
    G.endT += raw;
    G.timeScale = lerp(0.32, 0.16, clamp(G.endT / 1.4, 0, 1));
    var dt = raw * G.timeScale;
    G.soundBudget = 2;
    if (G.endT > 2.5) {
      finishEnding();
      return;
    }
    try { field.update(dt, G.visTime, buildFieldEnv()); } catch (e) { }
    G.shownScore += (G.score - G.shownScore) * (1 - Math.exp(-raw * 6));
    updateFx(dt);
  }

  function updateMenu(raw) {
    try {
      field.update(raw * 0.55, G.visTime, buildFieldEnv());
      field.drainEvents();
    } catch (e) { }
    updateFx(raw);
  }

  function updateShop(raw) {
    try {
      field.update(raw * 0.4, G.visTime, buildFieldEnv());
      field.drainEvents();
    } catch (e) { }
    updateFx(raw);
  }

  function updatePaused(raw) {
    try { field.update(0, G.visTime, buildFieldEnv()); } catch (e) { }
  }

  function updateEnd(raw) {
    if (G.endScoreShown < G.score) {
      G.endScoreShown += (G.score - G.endScoreShown) * (1 - Math.exp(-raw * 4.2));
      if (G.score - G.endScoreShown < 0.5) G.endScoreShown = G.score;
      D.finalScore.textContent = fmt(G.endScoreShown);
    }
    try { field.update(raw * 0.3, G.visTime, buildFieldEnv()); } catch (e) { }
    updateFx(raw * 0.7);
  }

  /* ---------------- HUD ---------------- */
  function pulseScore(el, big) {
    if (!el) return;
    clearTimeout(el._pulseTimer);
    el.classList.remove('score-pop', 'score-big');
    void el.offsetWidth;
    el.classList.add(big ? 'score-big' : 'score-pop');
    el._pulseTimer = setTimeout(function () {
      el.classList.remove('score-pop', 'score-big');
    }, big ? 540 : 260);
  }

  function updateHUD(raw) {
    var scoreTxt = fmt(G.shownScore);
    if (scoreTxt !== G.lastScoreText) {
      D.score.textContent = scoreTxt;
      G.lastScoreText = scoreTxt;
    }
    var nowPulse = performance.now();
    if (G.score - G.lastPulseScore >= 0.5 && nowPulse - G.lastPulseT > 95) {
      var pulseDelta = G.score - G.lastPulseScore;
      pulseScore(D.score, pulseDelta >= 30);
      G.lastPulseScore = G.score;
      G.lastPulseT = nowPulse;
    }
    var secs = G.started ? Math.max(0, Math.ceil(G.remaining)) : DURATION;
    var timerTxt = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    if (timerTxt !== G.lastTimerText) {
      D.timer.textContent = timerTxt;
      G.lastTimerText = timerTxt;
    }
    D.timer.classList.toggle('timer-late', G.started && G.remaining <= 10.4 && G.mode === 'playing');
    var p = G.started ? clamp(1 - G.remaining / DURATION, 0, 1) : 0;
    D.sunRailFill.style.width = (p * 100).toFixed(2) + '%';
    D.sunDot.style.left = (p * 100).toFixed(2) + '%';

    if (G.combo > 0) {
      D.comboCount.textContent = fmt(G.combo);
      D.comboMult.textContent = currentMult().toFixed(1);
      D.comboFill.style.transform = 'scaleX(' + clamp(G.comboTimer / COMBO_WINDOW, 0, 1).toFixed(3) + ')';
    }
    if (G.windLabelT === undefined) G.windLabelT = 0;
    G.windLabelT -= raw;
    if (G.windLabelT <= 0) {
      G.windLabelT = 0.3;
      var wt;
      if (G.furyActive) wt = '金风 · 浩荡';
      else if (G.gust > 0.55) wt = '西风 · 疾';
      else if (G.gust > 0.22) wt = '西风 · 徐';
      else wt = '西风 · 轻';
      if (wt !== G.lastWindText) {
        D.windText.textContent = wt;
        G.lastWindText = wt;
      }
      D.windArrow.style.transform = 'rotate(' + (G.furyActive ? 24 : -8 + G.wind * 22).toFixed(1) + 'deg)';
    }
    if (G.mode === 'end') {
      // final score is animated in updateEnd
    }
    if (G.debug && D.debug) {
      D.debug.classList.add('on');
    }
  }

  /* ---------------- announcements ---------------- */
  function showAnnounce(cn, en, soft) {
    clearTimeout(G.announceTimer);
    D.announce.classList.remove('show', 'soft');
    void D.announce.offsetWidth;
    D.announceCn.textContent = cn;
    D.announceEn.textContent = en;
    if (soft) D.announce.classList.add('soft');
    D.announce.classList.add('show');
    G.announceTimer = setTimeout(function () {
      D.announce.classList.remove('show', 'soft');
    }, 2900);
  }
  function hideAnnounce() {
    clearTimeout(G.announceTimer);
    D.announce.classList.remove('show', 'soft');
  }
  function showNotice(text) {
    clearTimeout(G.noticeTimer);
    D.notice.classList.remove('show');
    D.notice.textContent = text;
    void D.notice.offsetWidth;
    D.notice.classList.add('show');
    G.noticeTimer = setTimeout(function () { D.notice.classList.remove('show'); }, 3100);
  }
  function hideNotice() {
    clearTimeout(G.noticeTimer);
    D.notice.classList.remove('show');
  }
  function showCaption() {
    clearTimeout(G.captionTimer);
    D.caption.classList.remove('show');
    void D.caption.offsetWidth;
    D.caption.classList.add('show');
    G.captionTimer = setTimeout(function () { D.caption.classList.remove('show'); }, 5000);
  }
  function hideCaption() {
    clearTimeout(G.captionTimer);
    D.caption.classList.remove('show');
  }

  /* ---------------- input ---------------- */
  function onPointerMove(e) {
    var x = e.clientX, y = e.clientY;
    var now = performance.now();
    var p = G.pointer;
    if (!p.active) {
      p.active = true;
      p.x = x; p.y = y; p.lastT = now;
      return;
    }
    var dt = clamp(now - p.lastT, 4, 80);
    var dx = x - p.x, dy = y - p.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var speed = dist / dt;
    p.vx = dx / dt * 1000;
    p.vy = dy / dt * 1000;
    p.speed = speed;
    if (G.mode === 'playing' && dist > 0.8) {
      try {
        field.cut(p.x, p.y, x, y, speed, p.down);
      } catch (err) { }
      handleCuts(field.drainEvents());
      if (speed > 1.4 && Math.random() < 0.5) {
        fx.sparks.push({
          x: x, y: y, vx: rand(-40, 40), vy: rand(-50, 20),
          life: rand(0.18, 0.4), max: 0.4, size: rand(3, 8)
        });
      }
    }
    p.px = p.x; p.py = p.y;
    p.x = x; p.y = y; p.lastT = now;
    if (G.mode === 'playing' && dist > 6) addTrail(x, y, now, speed);
  }

  function onPointerDown(e) {
    ensureAudio();
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    G.pointer.type = e.pointerType || 'mouse';
    G.pointer.down = true;
    G.pointer.active = true;
    G.pointer.x = e.clientX;
    G.pointer.y = e.clientY;
    G.pointer.lastT = performance.now();
  }

  function onPointerUp() {
    G.pointer.down = false;
    if (G.pointer.type === 'touch') G.pointer.active = false;
  }

  function onKeyDown(e) {
    if (G.mode === 'pk' || G.mode === 'pkPaused') {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (G.mode === 'pk') pauseGame();
        else resumeGame();
        return;
      }
      if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
      if (G.mode === 'pk') {
        var km = PK_KEYMAP[e.code];
        if (km && G.pk) {
          e.preventDefault();
          var pp = km[0] === 'p1' ? G.pk.p1 : G.pk.p2;
          pp.keys[km[1]] = true;
          return;
        }
        if (e.code === 'Space') e.preventDefault();
      }
      return;
    }
    if (G.mode === 'pkSetup') {
      if (e.key === 'Escape') { e.preventDefault(); closePKSetup(); }
      return;
    }
    if (G.mode === 'pkEnd') {
      if (e.key === 'Escape') { e.preventDefault(); showMenu(); }
      return;
    }
    if (G.mode === 'history') {
      if (e.key === 'Escape') { e.preventDefault(); closeHistory(); }
      return;
    }
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (G.mode === 'shop') {
        if (e.key === 'Escape') { e.preventDefault(); closeShop(); }
        return;
      }
      if (G.mode === 'playing') { e.preventDefault(); pauseGame(); }
      else if (G.mode === 'paused') { e.preventDefault(); resumeGame(); }
      else if (G.mode === 'end') { e.preventDefault(); showMenu(); }
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      if (G.mode === 'playing') {
        e.preventDefault();
        return;
      }
      if (G.mode === 'menu') { e.preventDefault(); startGame(); }
      else if (G.mode === 'end') { e.preventDefault(); startGame(); }
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      if (G.mode === 'playing') { e.preventDefault(); useBlessing(); }
      return;
    }
    if (e.key === 'Enter') {
      if (G.mode === 'menu' || G.mode === 'end') { e.preventDefault(); startGame(); }
      else if (G.mode === 'paused') { e.preventDefault(); resumeGame(); }
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      toggleMute();
    }
  }

  function onKeyUp(e) {
    if (!G.pk) return;
    var km = PK_KEYMAP[e.code];
    if (!km) return;
    var p = km[0] === 'p1' ? G.pk.p1 : G.pk.p2;
    p.keys[km[1]] = false;
  }

  function bindEvents() {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', scheduleResize);
    window.addEventListener('blur', function () {
      if (!G.demo && (G.mode === 'playing' || G.mode === 'pk')) pauseGame();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && !G.demo && (G.mode === 'playing' || G.mode === 'pk')) pauseGame();
    });
    document.addEventListener('contextmenu', function (e) {
      if (e.target === canvas) e.preventDefault();
    });

    D.btnStart.addEventListener('click', function () { startGame(); });
    D.btnReplay.addEventListener('click', function () { startGame(); });
    D.btnRestart.addEventListener('click', function () {
      if (G.pauseFrom === 'pk') {
        D.pause.classList.add('hidden');
        startPK();
      } else {
        startGame();
      }
    });
    D.btnPK.addEventListener('click', function () { openPKSetup(); });
    D.btnPKBack.addEventListener('click', function () { closePKSetup(); });
    D.btnPKStart.addEventListener('click', function () { startPK(); });
    D.btnPKAgain.addEventListener('click', function () { startPK(); });
    D.btnPKSwitch.addEventListener('click', function () { openPKSetup(); });
    D.btnPKHome.addEventListener('click', function () { showMenu(); });
    D.pkMapWheat.addEventListener('click', function () {
      if (G.mode !== 'pkSetup' || G.map === 'wheat') return;
      useMap('wheat');
      sfx('ui', 'click');
    });
    D.pkMapRice.addEventListener('click', function () {
      if (G.mode !== 'pkSetup' || G.map === 'rice') return;
      useMap('rice');
      sfx('ui', 'click');
    });
    if (D.pkStick1) bindPKStick(D.pkStick1, 'p1');
    if (D.pkStick2) bindPKStick(D.pkStick2, 'p2');
    if (D.pkPause) D.pkPause.addEventListener('click', function (e) {
      e.stopPropagation();
      if (G.mode === 'pk') pauseGame();
      else if (G.mode === 'pkPaused') resumeGame();
    });
    D.btnResume.addEventListener('click', function () { resumeGame(); });
    D.btnHome.addEventListener('click', function () { showMenu(); });
    D.btnHome2.addEventListener('click', function () { showMenu(); });
    D.btnPause.addEventListener('click', function () {
      if (G.mode === 'playing') pauseGame();
      else if (G.mode === 'paused') resumeGame();
    });
    D.btnMute.addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });
    D.btnBlessing.addEventListener('click', function (e) { e.stopPropagation(); useBlessing(); });
    D.btnShop.addEventListener('click', function () { ensureAudio(); openShop('menu'); });
    D.btnShopEnd.addEventListener('click', function () { ensureAudio(); openShop('end'); });
    D.btnShopBack.addEventListener('click', function () { closeShop(); });
    D.btnUnequip.addEventListener('click', function () { shopUnequip(); });
    D.btnHistory.addEventListener('click', function () { openHistory(); });
    D.btnHistoryBack.addEventListener('click', function () { closeHistory(); });
    if (D.mapWheat) D.mapWheat.addEventListener('click', function () {
      if (G.mode !== 'menu' || G.map === 'wheat') return;
      useMap('wheat');
      sfx('ui', 'click');
      sfx('ui', 'hover');
    });
    if (D.mapRice) D.mapRice.addEventListener('click', function () {
      if (G.mode !== 'menu' || G.map === 'rice') return;
      useMap('rice');
      sfx('ui', 'click');
      sfx('ui', 'hover');
    });
    D.shopCharacter.addEventListener('click', function () { talkToBoss(true); });
    D.shopCharacter.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); talkToBoss(true); }
    });
    if (D.btnBossSwitch) D.btnBossSwitch.addEventListener('click', function (e) {
      e.stopPropagation();
      openBossPanel();
    });
    if (D.btnBossSwitchTop) D.btnBossSwitchTop.addEventListener('click', function (e) {
      e.stopPropagation();
      openBossPanel();
    });
    if (D.btnBossClose) D.btnBossClose.addEventListener('click', closeBossPanel);
    if (D.bossBackdrop) D.bossBackdrop.addEventListener('click', closeBossPanel);
    if (D.btnBossDefault) D.btnBossDefault.addEventListener('click', function () {
      setActiveBoss(DEFAULT_BOSS.id);
    });
    if (D.bossFile) D.bossFile.addEventListener('change', function () {
      var f = D.bossFile.files && D.bossFile.files[0];
      if (f) importBossZip(f);
    });
    if (D.bossList) D.bossList.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.getAttribute('data-boss-apply')) setActiveBoss(b.getAttribute('data-boss-apply'));
      else if (b.getAttribute('data-boss-delete')) deleteBossPack(b.getAttribute('data-boss-delete'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && G.mode === 'shop' && D.bossPanel &&
          !D.bossPanel.classList.contains('hidden')) {
        e.preventDefault();
        e.stopPropagation();
        closeBossPanel();
      }
    }, true);
    D.toolList.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.getAttribute('data-shop-buy')) shopBuy(b.getAttribute('data-shop-buy'));
      else if (b.getAttribute('data-shop-equip')) shopEquip(b.getAttribute('data-shop-equip'));
    });

    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (b) sfx('ui', 'click');
    });
    var hoverables = document.querySelectorAll('.btn-primary,.btn-ghost,.icon-btn,.frenzy-btn,.btn-tools,.shop-back,.tool-btn,.shop-boss-switch,.shop-boss-quick,.boss-use,.boss-del,.boss-import,.boss-kit,.boss-default,.boss-close');
    for (var i = 0; i < hoverables.length; i++) {
      hoverables[i].addEventListener('mouseenter', function () { sfx('ui', 'hover'); });
    }
  }

  /* ---------------- rendering ---------------- */
  function sceneEnv() {
    var progress;
    if (G.mode === 'menu' || G.mode === 'history' || G.mode === 'pkSetup') progress = 0.055 + 0.012 * Math.sin(G.visTime * 0.07);
    else if (G.mode === 'end' || G.mode === 'pkEnd') progress = 1;
    else if (G.mode === 'pk' || G.mode === 'pkPaused') progress = G.pk ? clamp(1 - G.pk.time / DURATION, 0, 1) : 0;
    else progress = clamp(1 - G.remaining / DURATION, 0, 1);
    return {
      progress: progress,
      wind: G.wind,
      gust: G.gust,
      frenzy: Math.min(1, (G.furyActive ? 0.85 : 0) + G.flash * 0.6),
      pointer: G.pointer,
      reduced: G.reduced
    };
  }

  function render(raw) {
    if (G.mode === 'shop') return;
    var env = sceneEnv();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var shake = G.reduced ? 0 : G.shake;
    var ox = Math.sin(G.visTime * 61.7) * shake * 0.55;
    var oy = Math.cos(G.visTime * 53.1) * shake * 0.38;
    ctx.save();
    ctx.translate(ox, oy);
    scene.drawBack(ctx, env);
    var fieldT0 = performance.now();
    try {
      field.draw(ctx, { time: G.visTime, frenzy: G.furyActive ? 1 : 0 });
    } catch (e) { }
    var fieldMs = performance.now() - fieldT0;
    G.fieldDrawAcc = (G.fieldDrawAcc || 0) + fieldMs;
    G.fieldDrawN = (G.fieldDrawN || 0) + 1;
    if (G.fieldDrawN >= 120 && !G.autoFast) {
      G.fieldDrawAvg = G.fieldDrawAcc / G.fieldDrawN;
      if (G.fieldDrawAvg > 15.5) {
        G.autoFast = true;
        try { field.fastMode = true; } catch (e) { }
        console.info('[穗浪] 已启用性能模式，保护帧率。');
      }
      G.fieldDrawAcc = 0;
      G.fieldDrawN = 0;
    }
    gradeField(ctx, env);
    drawWorldFx(ctx);
    scene.drawFront(ctx, env);
    if (G.mode === 'playing' || G.mode === 'ending') drawCritters(ctx);
    drawStormBand(ctx);
    drawPopups(ctx);
    ctx.restore();
    drawSouls(ctx);
    drawSlashes(ctx);
    drawTrail(ctx);
    if (G.mode === 'pk' || G.mode === 'pkPaused') drawPKSickles(ctx);
    else drawSickle(ctx);
    drawFlash(ctx);
    if (G.debug) updateDebug();
  }

  function gradeField(ctx, env) {
    var horizon = H * 0.46;
    if (G.map === 'rice') { gradeRiceField(ctx, env); return; }
    ctx.save();

    // melt the far edge of the crop into the horizon air
    var haze = ctx.createLinearGradient(0, horizon - H * 0.06, 0, horizon + H * 0.17);
    haze.addColorStop(0, 'rgba(255,226,176,0)');
    haze.addColorStop(0.22, 'rgba(255,218,164,.24)');
    haze.addColorStop(0.62, 'rgba(255,201,138,.09)');
    haze.addColorStop(1, 'rgba(255,192,120,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - H * 0.06, W, H * 0.24);

    // warm, deep grade — unify pale stalks into amber wheat
    ctx.globalCompositeOperation = 'multiply';
    var grade = ctx.createLinearGradient(0, horizon, 0, H);
    grade.addColorStop(0, 'rgba(255,214,152,.22)');
    grade.addColorStop(0.42, 'rgba(226,158,76,.27)');
    grade.addColorStop(0.78, 'rgba(160,98,38,.32)');
    grade.addColorStop(1, 'rgba(105,60,20,.4)');
    ctx.fillStyle = grade;
    ctx.fillRect(0, horizon - 2, W, H - horizon + 2);

    // last warm kiss from the sun
    ctx.globalCompositeOperation = 'lighter';
    var kiss = ctx.createRadialGradient(W * 0.73, horizon + H * 0.14, 0, W * 0.73, horizon + H * 0.16, W * 0.55);
    kiss.addColorStop(0, 'rgba(255,204,126,.13)');
    kiss.addColorStop(0.6, 'rgba(255,186,100,.045)');
    kiss.addColorStop(1, 'rgba(255,176,90,0)');
    ctx.fillStyle = kiss;
    ctx.fillRect(0, horizon - 4, W, H - horizon + 4);

    // grounded foreground
    ctx.globalCompositeOperation = 'source-over';
    var bottom = ctx.createLinearGradient(0, H * 0.82, 0, H);
    bottom.addColorStop(0, 'rgba(24,13,4,0)');
    bottom.addColorStop(1, 'rgba(24,13,4,.34)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, H * 0.82, W, H * 0.18);
    ctx.restore();
  }

  function gradeRiceField(ctx, env) {
    var horizon = H * 0.45;
    ctx.save();

    // 远垄融进青灰水汽，而不是麦田的暖金雾
    var haze = ctx.createLinearGradient(0, horizon - H * 0.06, 0, horizon + H * 0.18);
    haze.addColorStop(0, 'rgba(196,220,202,0)');
    haze.addColorStop(0.22, 'rgba(205,226,206,.2)');
    haze.addColorStop(0.64, 'rgba(162,191,166,.08)');
    haze.addColorStop(1, 'rgba(140,170,148,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - H * 0.06, W, H * 0.26);

    // 统一的稻青 grading：不要压成金黄
    ctx.globalCompositeOperation = 'multiply';
    var grade = ctx.createLinearGradient(0, horizon, 0, H);
    grade.addColorStop(0, 'rgba(186,211,181,.2)');
    grade.addColorStop(0.42, 'rgba(92,124,78,.16)');
    grade.addColorStop(0.78, 'rgba(44,76,55,.22)');
    grade.addColorStop(1, 'rgba(26,48,36,.32)');
    ctx.fillStyle = grade;
    ctx.fillRect(0, horizon - 2, W, H - horizon + 2);

    // 水面带走一点低日的暖光
    ctx.globalCompositeOperation = 'lighter';
    var kiss = ctx.createLinearGradient(W * 0.4, horizon, W * 0.76, H * 0.82);
    kiss.addColorStop(0, 'rgba(255,219,156,.08)');
    kiss.addColorStop(0.52, 'rgba(255,210,142,.035)');
    kiss.addColorStop(1, 'rgba(255,202,128,0)');
    ctx.fillStyle = kiss;
    ctx.fillRect(0, horizon - 4, W, H - horizon + 4);
    if (env && env.frenzy) {
      ctx.fillStyle = 'rgba(255,218,150,' + (0.035 + env.frenzy * 0.04).toFixed(3) + ')';
      ctx.fillRect(0, horizon, W, H - horizon);
    }

    // 让底部 HUD 的暗部有落点
    ctx.globalCompositeOperation = 'source-over';
    var bottom = ctx.createLinearGradient(0, H * 0.8, 0, H);
    bottom.addColorStop(0, 'rgba(8,17,12,0)');
    bottom.addColorStop(1, 'rgba(8,17,12,.36)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, H * 0.8, W, H * 0.2);
    ctx.restore();
  }

  function drawWorldFx(ctx) {
    var i, p;
    if (fx.chaff.length) {
      ctx.save();
      for (i = 0; i < fx.chaff.length; i++) {
        p = fx.chaff[i];
        var a = clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.38, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    if (fx.rings.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < fx.rings.length; i++) {
        p = fx.rings[i];
        var ra = clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = ra * 0.6;
        ctx.strokeStyle = 'rgba(255,228,160,' + (ra * 0.8) + ')';
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    if (fx.sparks.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < fx.sparks.length; i++) {
        p = fx.sparks[i];
        var sa = clamp(p.life / p.max, 0, 1);
        var sz = p.size * (0.5 + sa * 0.8);
        ctx.globalAlpha = sa * 0.85;
        ctx.drawImage(sprSpark, p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function drawPopups(ctx) {
    for (var i = 0; i < fx.popups.length; i++) {
      var p = fx.popups[i];
      var t = 1 - p.life / p.max;
      var a = p.life > p.max * 0.65 ? (1 - p.life / p.max) / 0.35 : p.life / (p.max * 0.65);
      a = clamp(a, 0, 1);
      var scale = p.kind === 'tier' ? 0.85 + 0.2 * easeOutCubic(Math.min(1, t * 4)) : 1;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = p.kind === 'tier'
        ? '600 19px Georgia, "Songti SC", serif'
        : '500 20px Georgia, "Songti SC", serif';
      ctx.fillStyle = 'rgba(35,17,4,.55)';
      ctx.fillText(p.text, 1.5, 1.5);
      ctx.fillStyle = p.kind === 'tier' ? '#ffe6a4' : '#fff1c8';
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  function drawSouls(ctx) {
    if (!fx.souls.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < fx.souls.length; i++) {
      var p = fx.souls[i];
      var t = easeOutCubic(clamp(p.t, 0, 1));
      var it = 1 - t;
      var x = it * it * p.sx + 2 * it * t * p.cx + t * t * p.tx;
      var y = it * it * p.sy + 2 * it * t * p.cy + t * t * p.ty;
      var a = Math.sin(clamp(p.t, 0, 1) * Math.PI) * 0.85 + 0.1;
      var sz = p.size * (1 - t * 0.65);
      ctx.globalAlpha = a;
      ctx.drawImage(sprGold, x - sz / 2, y - sz / 2, sz, sz);
      ctx.globalAlpha = a * 1.4;
      ctx.fillStyle = '#fff3cd';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, 2.2 * (1 - t)), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSlashes(ctx) {
    if (!fx.slashes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < fx.slashes.length; i++) {
      var p = fx.slashes[i];
      var a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = p.gold ? 'rgba(255,236,180,.95)' : 'rgba(255,243,210,.72)';
      ctx.lineWidth = p.gold ? 2.2 : 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.2 - a * 0.3), p.a - 1.1, p.a + 1.1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawTrail(ctx) {
    if (G.mode !== 'playing' && G.mode !== 'ending') return;
    if (G.trail.length < 2) return;
    var now = performance.now();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 1; i < G.trail.length; i++) {
        var a0 = clamp(1 - (now - G.trail[i - 1].t) / 190, 0, 1);
        var a1 = clamp(1 - (now - G.trail[i].t) / 190, 0, 1);
        var a = Math.min(a0, a1);
        if (a <= 0.01) continue;
        var k = i / G.trail.length;
        var w = pass === 0 ? (10 + 16 * k) * a : (1.2 + 2.2 * k) * a;
        ctx.globalAlpha = pass === 0 ? a * 0.1 : a * 0.55;
        ctx.strokeStyle = pass === 0 ? 'rgba(255,206,120,.8)' : 'rgba(255,245,214,.95)';
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(G.trail[i - 1].x, G.trail[i - 1].y);
        ctx.lineTo(G.trail[i].x, G.trail[i].y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawStormBand(ctx) {
    if (G.stormVis <= 0) return;
    var prog = clamp(1 - G.stormVis / 1.15, 0, 1);
    var x = lerp(-W * 0.15, W * 1.15, prog);
    var horizon = H * 0.44;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var half = W * 0.085;
    var g = ctx.createLinearGradient(x - half, 0, x + half, 0);
    g.addColorStop(0, 'rgba(255,205,110,0)');
    g.addColorStop(0.4, 'rgba(255,222,150,.035)');
    g.addColorStop(0.5, 'rgba(255,241,196,.135)');
    g.addColorStop(0.6, 'rgba(255,222,150,.035)');
    g.addColorStop(1, 'rgba(255,205,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - half, horizon, half * 2, H - horizon + 10);
    ctx.globalAlpha = 0.16 + 0.06 * Math.sin(prog * Math.PI);
    ctx.strokeStyle = 'rgba(255,244,206,.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 2, horizon + 12);
    ctx.quadraticCurveTo(x + 6, horizon + (H - horizon) * 0.45, x - 3, H);
    ctx.stroke();
    ctx.globalAlpha = 0.06;
    for (var i = 0; i < 4; i++) {
      var yy = horizon + (H - horizon) * (0.2 + i * 0.19);
      ctx.beginPath();
      ctx.moveTo(x - 34 + Math.sin(i * 2.1) * 18, yy);
      ctx.lineTo(x + 30 + Math.sin(i * 1.7) * 22, yy - 16);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFlash(ctx) {
    if (G.flash <= 0.005) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(W * 0.62, H * 0.38, 0, W * 0.62, H * 0.38, Math.max(W, H) * 0.8);
    g.addColorStop(0, 'rgba(255,232,175,' + (G.flash * 0.42) + ')');
    g.addColorStop(0.55, 'rgba(255,198,120,' + (G.flash * 0.14) + ')');
    g.addColorStop(1, 'rgba(255,180,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawSickle(ctx) {
    if (G.mode !== 'playing' && G.mode !== 'ending') return;
    if (G.pointer.type === 'touch' && !G.pointer.down) return;
    var p = G.pointer;
    var target;
    if (p.speed > 0.3) target = Math.atan2(p.vy, p.vx) + 0.5;
    else target = -0.5 + Math.sin(G.visTime * 1.35) * 0.05;
    G.cursorAngle = angleLerp(G.cursorAngle, target, 1 - Math.exp(-0.016 * 16));
    var toolId = G.equippedTool;
    var isLong = toolId === 'long_scythe';
    var isSweep = toolId === 'sweep';
    var isPlus = toolId === 'scythe_plus';
    var s = clamp(H / 900 * 1.38, 1.02, 1.8);
    if (isSweep) s *= 1.06;
    else if (isLong) s *= 1.02;
    else if (isPlus) s *= 1.03;
    var inflate = 1 + G.bladeFlash * 0.05;
    ctx.save();
    ctx.translate(p.x - 4, p.y + 3);
    ctx.rotate(G.cursorAngle);
    ctx.scale(s * inflate, s * inflate);

    // wider sickles advertise their reach with a faint wind arc
    if ((isSweep || isPlus) && (p.speed > 0.25 || G.bladeFlash > 0.02)) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (isSweep ? 0.075 : 0.05) + G.bladeFlash * 0.08;
      ctx.strokeStyle = 'rgba(255,224,158,.8)';
      ctx.lineWidth = isSweep ? 5 : 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, isSweep ? 70 : 54, -1.25, 0.45);
      ctx.stroke();
      ctx.restore();
    }

    // faint halo while the blade is working
    if (p.speed > 0.5 || G.bladeFlash > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.1 + G.bladeFlash * 0.24, 0, 0.38) + (isPlus ? 0.04 : 0);
      ctx.drawImage(sprGold, 1, -24, 52, 52);
      ctx.restore();
    }

    // cast shadow
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#180b03';
    ctx.beginPath();
    ctx.ellipse(-4, 20, 29, 9, 0.1, 0, TAU);
    ctx.fill();
    ctx.restore();

    // handle — dark wood, wrapped grip
    var hx = isSweep ? -64 : (isLong ? -56 : -35);
    var hy = isSweep ? 42 : (isLong ? 35 : 24);
    var ex = -8, ey = 6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#221204';
    ctx.lineWidth = isLong ? 9 : 10;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = '#5e391d';
    ctx.lineWidth = isLong ? 5.6 : 6.2;
    ctx.beginPath();
    ctx.moveTo(hx + 2, hy - 1.5);
    ctx.lineTo(ex - 0.5, ey + 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,205,148,.36)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hx + 4, hy - 4.5);
    ctx.lineTo(ex - 3, ey + 1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,16,6,.8)';
    ctx.lineWidth = 2.2;
    var bt1x = lerp(hx, ex, 0.25), bt1y = lerp(hy, ey, 0.25);
    var bt2x = lerp(hx, ex, 0.47), bt2y = lerp(hy, ey, 0.47);
    var bt3x = lerp(hx, ex, 0.69), bt3y = lerp(hy, ey, 0.69);
    ctx.beginPath(); ctx.moveTo(bt1x - 2, bt1y + 4); ctx.lineTo(bt1x + 2.2, bt1y - 4.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bt2x - 2, bt2y + 4); ctx.lineTo(bt2x + 2.2, bt2y - 4.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bt3x - 2, bt3y + 4); ctx.lineTo(bt3x + 2.2, bt3y - 4.2); ctx.stroke();
    ctx.fillStyle = '#7a4d24';
    ctx.beginPath(); ctx.arc(hx, hy, 4.4, 0, TAU); ctx.fill();
    if (isLong) {
      ctx.strokeStyle = 'rgba(155,184,116,.82)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx, hy + 2);
      ctx.quadraticCurveTo(hx - 8, hy + 10, hx - 4, hy + 19);
      ctx.stroke();
      ctx.fillStyle = 'rgba(242,193,92,.55)';
      ctx.beginPath();
      ctx.moveTo(hx - 5, hy + 18);
      ctx.lineTo(hx - 1, hy + 26);
      ctx.lineTo(hx - 9, hy + 22);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#9a6531';
    ctx.beginPath(); ctx.ellipse(-6.4, 3.8, 4.2, 3.1, -0.55, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,160,.45)';
    ctx.beginPath(); ctx.arc(-8, 6, 1.1, 0, TAU); ctx.fill();
    if (isPlus) {
      ctx.fillStyle = 'rgba(255,214,128,.7)';
      ctx.beginPath(); ctx.arc(-6.5, 3.5, 1.25, 0, TAU); ctx.fill();
    }

    // 钐子：刃后张开一张竹编落兜
    if (isSweep) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(224,201,139,.78)';
      ctx.lineWidth = 0.85;
      var hubX = 4, hubY = 8;
      var rimAx = 60, rimAy = 18, rimCx = 42, rimCy = 40, rimBx = 20, rimBy = 44;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = 'rgba(224,201,139,.8)';
      ctx.beginPath();
      ctx.moveTo(hubX, hubY);
      ctx.lineTo(rimAx, rimAy);
      ctx.quadraticCurveTo(rimCx, rimCy, rimBx, rimBy);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(224,201,139,.88)';
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.moveTo(rimAx, rimAy);
      ctx.quadraticCurveTo(rimCx, rimCy, rimBx, rimBy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hubX, hubY); ctx.lineTo(rimAx, rimAy);
      ctx.moveTo(hubX, hubY); ctx.lineTo(rimBx, rimBy);
      ctx.stroke();
      for (var rib = 1; rib <= 5; rib++) {
        var rt = rib / 6;
        var rx = (1 - rt) * (1 - rt) * rimAx + 2 * (1 - rt) * rt * rimCx + rt * rt * rimBx;
        var ry = (1 - rt) * (1 - rt) * rimAy + 2 * (1 - rt) * rt * rimCy + rt * rt * rimBy;
        ctx.beginPath();
        ctx.moveTo(hubX, hubY);
        ctx.lineTo(rx, ry);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.36;
      ctx.strokeStyle = 'rgba(255,236,178,.7)';
      ctx.beginPath();
      ctx.arc(hubX, hubY, 2.2, -0.4, 2.2);
      ctx.stroke();
      ctx.restore();
    }

    // blade — broad crescent, warm steel
    var tipX = isSweep ? 58 : (isPlus ? 48 : 45);
    var tipY = isSweep ? -18 : (isPlus ? -15 : -14);
    var shoulderX = isSweep ? 38 : 33;
    var shoulderY = isSweep ? 9 : 7;
    var bg = ctx.createLinearGradient(-2, -12, tipX - 5, 2);
    bg.addColorStop(0, '#fffdf2');
    bg.addColorStop(0.28, '#ffedb8');
    bg.addColorStop(0.58, '#e8bd6f');
    bg.addColorStop(0.82, '#c59248');
    bg.addColorStop(1, '#9a6a30');
    ctx.beginPath();
    ctx.moveTo(-4, 4);
    ctx.bezierCurveTo(13, 14, shoulderX, shoulderY, tipX, tipY);
    ctx.bezierCurveTo(isSweep ? 37 : 30, -3, 13, -4, -3, -9);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,230,.9)';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(88,48,14,.52)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-1, -5.5);
    ctx.bezierCurveTo(13, -2, 30, 1, tipX - 4, tipY + 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,244,.92)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(1, 5.5);
    ctx.bezierCurveTo(15, 11.5, 30, 9.5, tipX - 3, tipY + 7);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(11, -1.5);
    ctx.bezierCurveTo(20, -1, 27, -2.5, tipX - 12, tipY + 7);
    ctx.stroke();
    ctx.fillStyle = '#6f4822';
    ctx.beginPath(); ctx.arc(-2, -2, 1.9, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,228,170,.55)';
    ctx.beginPath(); ctx.arc(-2.6, -2.7, 0.7, 0, TAU); ctx.fill();

    // slow glint travelling the edge
    var gl = clamp((Math.sin(G.visTime * 2.3) * 0.5 + 0.5) * (0.4 + Math.min(0.6, p.speed * 0.12)), 0, 1);
    if (gl > 0.25) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (gl - 0.25) * 0.65 + (isPlus ? 0.05 : 0);
      var gx = 14 + Math.sin(G.visTime * 2.3) * 18;
      ctx.drawImage(sprSpark, gx - 9, -14, 26, 26);
      ctx.restore();
    }
    if (G.bladeFlash > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(G.bladeFlash * 0.75, 0, 0.7);
      ctx.drawImage(sprGold, isSweep ? 18 : 12, isSweep ? -38 : -33, isSweep ? 62 : 52, isSweep ? 62 : 52);
      ctx.restore();
    }
    ctx.restore();
  }

  function updateDebug() {
    if (!D.debug) return;
    G.debugT = (G.debugT || 0) + 1;
    if (G.debugT % 20 !== 0) return;
    var st = { uncut: 0, total: 0, golden: 0 };
    try { st = field.getStats(); } catch (e) { }
    D.debug.textContent =
      'FPS ' + G.fps.toFixed(0) +
      '\nmode ' + G.mode + '  score ' + Math.round(G.score) + '  mult ' + currentMult().toFixed(1) +
      '\ncombo ' + G.combo + '  fury ' + (G.furyActive ? G.furyTimer.toFixed(1) + 's ACTIVE' : (G.started ? 'at ' + G.furyAt.toFixed(1) : 'wait')) +
      '\nstalks uncut ' + st.uncut + ' / ' + st.total + '  gold ' + st.golden +
      '\nfx ' + (fx.chaff.length + fx.sparks.length + fx.popups.length + fx.souls.length) +
      '\ndpr ' + dpr.toFixed(2) + '  ' + W + 'x' + H;
  }

  /* ---------------- main loop ---------------- */
  function frame(now) {
    var raw = (now - G.lastFrame) / 1000;
    G.lastFrame = now;
    if (!G.lastFrame || raw < 0) raw = 0.016;
    if (raw > 0.12) raw = 0.12;
    G.fps = G.fps ? G.fps * 0.94 + (1 / Math.max(0.001, raw)) * 0.06 : 60;
    G.visTime += raw;
    updateWind(raw);
    sfx('update', raw, { combo: G.combo, frenzy: G.furyActive ? 1 : 0, time: G.visTime });

    if (G.mode === 'playing') updatePlaying(raw);
    else if (G.mode === 'ending') updateEnding(raw);
    else if (G.mode === 'menu') updateMenu(raw);
    else if (G.mode === 'paused') updatePaused(raw);
    else if (G.mode === 'end') updateEnd(raw);
    else if (G.mode === 'shop') updateShop(raw);
    else if (G.mode === 'history') updateHistory(raw);
    else if (G.mode === 'pk') updatePK(raw);
    else if (G.mode === 'pkPaused') updatePKPaused(raw);
    else if (G.mode === 'pkSetup') updatePKSetup(raw);
    else if (G.mode === 'pkEnd') updatePKEnd(raw);

    scene.update(raw, G.visTime, sceneEnv());
    updateHUD(raw);
    render(raw);
    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    resizeAll();
    updateMuteButton();
    initBossPacks();
    updateBestLabels();
    bindEvents();
    if (IS_TOUCH) {
      var hintSpan = D.hint.querySelector('span');
      if (hintSpan) hintSpan.textContent = '滑动指尖 · 划过麦穗 · 开镰';
    }
    D.menu.classList.add('is-live');
    useMap(G.map);
    updateHistorySummary();
    updateProgressionLabels();
    setMode('menu');
    updateHUD(true);
    updateFuryUI();
    requestAnimationFrame(function () { updateScoreTarget(); });
    requestAnimationFrame(function (t) {
      G.lastFrame = t;
      G.visTime = 0;
      requestAnimationFrame(frame);
    });

    if (G.debug && D.debug) D.debug.classList.add('on');

    if (SCREEN === 'shop') {
      setTimeout(function () { openShop('menu'); }, 120);
    } else if (SCREEN === 'history') {
      setTimeout(function () { openHistory(); }, 180);
    } else if (SCREEN === 'end') {
      setTimeout(function () {
        hideScreens();
        showEndPreview();
      }, 80);
    } else if (SCREEN === 'pause') {
      setTimeout(function () { startGame(); }, 80);
      setTimeout(function () { pauseGame(); }, 2100);
    } else if (SCREEN === 'fury') {
      setTimeout(function () { startGame(); }, 80);
      setTimeout(function () {
        if (G.mode !== 'playing') return;
        if (!G.started) beginTimer();
        activateFury('demo');
      }, 1600);
    } else if (DEMO) {
      setTimeout(function () { startGame(); }, 80);
    } else if (params.get('autostart') === '1') {
      setTimeout(function () { startGame(); }, 300);
    }

    window.__SUILANG__ = {
      state: G, field: field, scene: scene, audio: audio,
      start: startGame, pause: pauseGame, resume: resumeGame,
      endNow: beginEnding, finishEnding: finishEnding, showMenu: showMenu,
      activateFury: function (source) { return activateFury(source || 'demo'); },
      triggerFury: function (source) { return activateFury(source || 'demo'); },
      setFuryAt: function (v) { G.furyAt = +v || 0; },
      useBlessing: useBlessing,
      openShop: openShop, closeShop: closeShop,
      openBossPanel: openBossPanel, closeBossPanel: closeBossPanel,
      setBoss: setActiveBoss, importBossZip: importBossZip,
      shopBuy: shopBuy, shopEquip: shopEquip, shopUnequip: shopUnequip,
      setMap: useMap, openHistory: openHistory, closeHistory: closeHistory,
      addCoins: function (n) {
        G.coins = Math.max(0, G.coins + (parseInt(n, 10) || 0));
        storeSet('suilang3.coins', G.coins);
        updateProgressionLabels();
        if (G.mode === 'shop') renderShop();
        return G.coins;
      },
      cutAt: function (x0, y0, x1, y1, speed) {
        try {
          field.cut(x0, y0, x1, y1, speed || 2, true);
          handleCuts(field.drainEvents());
        } catch (e) { }
      },
      benchmark: function (n) {
        n = n || 20;
        var env = sceneEnv();
        var sum = { fieldUpdate: 0, back: 0, fieldDraw: 0, front: 0, fx: 0, total: 0 };
        for (var i = 0; i < n; i++) {
          var t0 = performance.now();
          try { field.update(1 / 60, G.visTime + i / 60, buildFieldEnv()); } catch (e) { }
          var t1 = performance.now();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          scene.drawBack(ctx, env);
          var t2 = performance.now();
          try { field.draw(ctx, { time: G.visTime + i / 60, frenzy: 0 }); } catch (e) { }
          var t3 = performance.now();
          scene.drawFront(ctx, env);
          var t4 = performance.now();
          drawWorldFx(ctx);
          drawPopups(ctx);
          var t5 = performance.now();
          sum.fieldUpdate += t1 - t0;
          sum.back += t2 - t1;
          sum.fieldDraw += t3 - t2;
          sum.front += t4 - t3;
          sum.fx += t5 - t4;
          sum.total += t5 - t0;
        }
        for (var k in sum) sum[k] = +(sum[k] / n).toFixed(2);
        return sum;
      },
      reset: function () { resetGameState(); }
    };
    console.log('%c穗浪 · 丰饶之刻 %c— 六十秒黄昏，农具小铺已开张。',
      'color:#f2c15c;font-weight:bold;font-size:14px', 'color:#9b7a48');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
