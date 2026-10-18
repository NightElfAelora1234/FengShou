/* ============================================================
   《穗浪 v3》 — 稻田 · 稻浪  atmosphere renderer (window.RiceScene)
   ------------------------------------------------------------
   A humid, after-rain dusk over mirror-flooded paddies:
   jade-to-apricot sky, karst towers, curved field bunds, flooded
   terraces, egrets, dragonflies, rice-leaf foreground framing.

   Classic script. No images / fonts / network. No internal RAF.
   The host drives it:
       scene.drawBack(ctx, env)
       riceField.draw(ctx, ...)
       particles
       scene.drawFront(ctx, env)

   Contract:
       new RiceScene()
       resize(w, h, dpr)
       update(dt, time, env)
       drawBack(ctx, env)
       drawFront(ctx, env)

   env = {
       progress: 0..1,          // dusk progression
       wind: -1..1,
       gust: 0..1,
       frenzy: 0..1,            // golden-hour rush -> stronger water light
       pointer: {x, y},
       reduced: bool
   }

   Performance notes: everything static is pre-rendered at
   resize() (sky+mountains, flooded terraces, reflections, bunds,
   foreground leaves). No per-frame filter / shadowBlur; per-frame
   work is a handful of image blits, ~80 twinkle sprites and some
   cheap line work. 1600x900 @ 60fps on a GPU-composited canvas.
   ============================================================ */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function mod(n, m) { return ((n % m) + m) % m; }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w));
    c.height = Math.max(2, Math.round(h));
    return c;
  }

  /* Prerender layer whose drawing context works in CSS pixels. */
  function makeLayer(w, h, scale) {
    var c = makeCanvas(w * scale, h * scale);
    var g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    return { c: c, g: g, w: w, h: h, scale: scale };
  }

  function makeRadialSprite(size, stops) {
    var c = makeCanvas(size, size);
    var g = c.getContext('2d');
    var cx = size / 2;
    var gr = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function makeSpark(size, warm) {
    var c = makeCanvas(size, size), g = c.getContext('2d'), cx = size / 2;
    var gr = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
    if (warm) {
      gr.addColorStop(0, 'rgba(255,246,212,1)');
      gr.addColorStop(0.16, 'rgba(255,231,171,0.86)');
      gr.addColorStop(0.42, 'rgba(255,205,128,0.22)');
      gr.addColorStop(1, 'rgba(255,194,112,0)');
    } else {
      gr.addColorStop(0, 'rgba(230,245,230,0.9)');
      gr.addColorStop(0.18, 'rgba(214,238,220,0.56)');
      gr.addColorStop(0.48, 'rgba(186,220,202,0.14)');
      gr.addColorStop(1, 'rgba(176,214,195,0)');
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    // tiny horizontal glint
    g.save();
    g.globalCompositeOperation = 'lighter';
    var lg = g.createLinearGradient(0, cx, size, cx);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, warm ? 'rgba(255,241,203,0.55)' : 'rgba(224,244,228,0.42)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(0, cx - 0.6, size, 1.2);
    g.restore();
    return c;
  }

  function makeDotSprite(size, stops) {
    return makeRadialSprite(size, stops);
  }

  function makeStreakSprite() {
    var w = 256, h = 32;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(4.6, 0.55);
    var gr = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.9);
    gr.addColorStop(0, 'rgba(255,250,228,0.95)');
    gr.addColorStop(0.35, 'rgba(255,230,172,0.45)');
    gr.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, h * 0.9, 0, TAU);
    g.fill();
    g.restore();
    return c;
  }

  function makeSunPathSprite() {
    var w = 256, h = 512;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var vert = g.createLinearGradient(0, 0, 0, h);
    vert.addColorStop(0, 'rgba(255,226,170,0.95)');
    vert.addColorStop(0.28, 'rgba(255,220,164,0.66)');
    vert.addColorStop(0.7, 'rgba(255,214,158,0.22)');
    vert.addColorStop(1, 'rgba(255,210,150,0)');
    g.fillStyle = vert;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    var horiz = g.createLinearGradient(0, 0, w, 0);
    horiz.addColorStop(0, 'rgba(0,0,0,0)');
    horiz.addColorStop(0.34, 'rgba(0,0,0,0.55)');
    horiz.addColorStop(0.5, 'rgba(0,0,0,1)');
    horiz.addColorStop(0.66, 'rgba(0,0,0,0.55)');
    horiz.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = horiz;
    g.fillRect(0, 0, w, h);
    return c;
  }

  function makeMistSprite() {
    var w = 640, h = 200;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var rnd = mulberry32(31);
    for (var i = 0; i < 16; i++) {
      var x = w * (0.1 + rnd() * 0.8);
      var y = h * (0.42 + (rnd() - 0.5) * 0.26);
      var rx = w * (0.09 + rnd() * 0.15);
      var ry = h * (0.12 + rnd() * 0.16);
      var gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      gr.addColorStop(0, 'rgba(255,240,214,0.30)');
      gr.addColorStop(0.55, 'rgba(244,231,206,0.10)');
      gr.addColorStop(1, 'rgba(240,226,200,0)');
      g.fillStyle = gr;
      g.save();
      g.translate(x, y);
      g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      g.beginPath();
      g.arc(0, 0, Math.max(rx, ry), 0, TAU);
      g.fill();
      g.restore();
    }
    return c;
  }

  function makeBokehSprite() {
    return makeRadialSprite(128, [
      [0, 'rgba(255,238,204,0.16)'],
      [0.62, 'rgba(255,228,184,0.20)'],
      [0.86, 'rgba(255,216,158,0.42)'],
      [1, 'rgba(255,210,150,0)']
    ]);
  }

  function makeBeamSprite() {
    var w = 192, h = 512;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var vert = g.createLinearGradient(0, 0, 0, h);
    vert.addColorStop(0, 'rgba(255,242,208,0)');
    vert.addColorStop(0.06, 'rgba(255,240,204,0.62)');
    vert.addColorStop(0.32, 'rgba(255,234,194,0.42)');
    vert.addColorStop(0.72, 'rgba(255,226,180,0.14)');
    vert.addColorStop(1, 'rgba(255,220,170,0)');
    g.fillStyle = vert;
    g.beginPath();
    g.moveTo(w * 0.34, 0);
    g.lineTo(w * 0.66, 0);
    g.lineTo(w * 0.97, h);
    g.lineTo(w * 0.03, h);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'destination-in';
    var horiz = g.createLinearGradient(0, 0, w, 0);
    horiz.addColorStop(0, 'rgba(0,0,0,0)');
    horiz.addColorStop(0.28, 'rgba(0,0,0,0.7)');
    horiz.addColorStop(0.5, 'rgba(0,0,0,1)');
    horiz.addColorStop(0.72, 'rgba(0,0,0,0.7)');
    horiz.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = horiz;
    g.fillRect(0, 0, w, h);
    return c;
  }

  function makeCloudSprite(seed) {
    var w = 720, h = 260;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var rnd = mulberry32(seed);
    g.filter = 'blur(7px)';
    for (var i = 0; i < 15; i++) {
      var x = w * (0.14 + rnd() * 0.72);
      var y = h * (0.46 + (rnd() - 0.5) * 0.2);
      var rx = w * (0.08 + rnd() * 0.14);
      var ry = rx * (0.18 + rnd() * 0.16);
      var gr = g.createLinearGradient(0, y - ry, 0, y + ry);
      gr.addColorStop(0, 'rgba(255,242,219,' + (0.5 + rnd() * 0.28) + ')');
      gr.addColorStop(0.5, 'rgba(250,226,199,' + (0.28 + rnd() * 0.2) + ')');
      gr.addColorStop(1, 'rgba(176,193,183,0.12)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, rx, ry, (rnd() - 0.5) * 0.1, 0, TAU);
      g.fill();
    }
    // luminous upper lip
    g.filter = 'blur(5px)';
    for (var j = 0; j < 6; j++) {
      var cx = w * (0.24 + rnd() * 0.52);
      var cy = h * (0.34 + rnd() * 0.08);
      var cr = w * (0.03 + rnd() * 0.06);
      var cg = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
      cg.addColorStop(0, 'rgba(255,247,226,0.5)');
      cg.addColorStop(1, 'rgba(255,240,214,0)');
      g.fillStyle = cg;
      g.beginPath();
      g.ellipse(cx, cy, cr, cr * 0.35, 0, 0, TAU);
      g.fill();
    }
    g.filter = 'none';
    return c;
  }

  function makeForegroundRice(w, h, seed, flip) {
    var scale = 2;
    var layer = makeLayer(w, h, scale);
    var g = layer.g;
    var rnd = mulberry32(seed);
    g.filter = 'blur(4.2px)';
    if (flip) {
      g.translate(w, 0);
      g.scale(-1, 1);
    }

    var rootX = w * (0.58 + (rnd() - 0.5) * 0.16);
    var rootY = h + 14;
    var i, k;

    // long drooping rice leaves, arching in from the frame edge
    for (i = 0; i < 10; i++) {
      var t = i / 9;
      var ang = -Math.PI * 0.72 + t * Math.PI * 0.52 + (rnd() - 0.5) * 0.16;
      var len = h * (0.5 + rnd() * 0.5);
      var bx = rootX + (rnd() - 0.5) * w * 0.08;
      var dir = Math.cos(ang) >= 0 ? 1 : -1;
      var tipX = bx + Math.cos(ang) * len * 0.86 + dir * (rnd() * w * 0.035);
      var tipY = rootY + Math.sin(ang) * len * 0.92 - h * 0.03;
      var midX = bx + (tipX - bx) * 0.4 + dir * (w * 0.02 + rnd() * w * 0.055);
      var midY = rootY + (tipY - rootY) * 0.58;
      var width = w * (0.012 + rnd() * 0.015);
      var shade = 16 + Math.floor(rnd() * 20);
      g.fillStyle = 'rgba(' + (12 + shade * 0.15) + ',' + (26 + shade) + ',' + (15 + shade * 0.3) + ',0.94)';
      g.beginPath();
      g.moveTo(bx - width, rootY);
      g.quadraticCurveTo(midX - width * 0.9, midY, tipX, tipY);
      g.quadraticCurveTo(midX + width * 1.1, midY + h * 0.035, bx + width, rootY);
      g.closePath();
      g.fill();
      // sun-side rim
      if (rnd() > 0.4) {
        g.strokeStyle = 'rgba(255,222,166,' + (0.04 + rnd() * 0.06) + ')';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(bx + width * 0.5, rootY - h * 0.06);
        g.quadraticCurveTo(midX + width, midY, tipX - width * 0.3, tipY + h * 0.02);
        g.stroke();
      }
    }

    // two heavy panicles nodding into frame
    for (k = 0; k < 2; k++) {
      var px = rootX + (k === 0 ? -w * 0.19 : w * 0.18) + (rnd() - 0.5) * w * 0.08;
      var stemTopY = h * (0.14 + rnd() * 0.15);
      var ctrlX = px + (k === 0 ? w * 0.12 : -w * 0.13);
      var headX = px + (k === 0 ? w * 0.26 : -w * 0.29) + (rnd() - 0.5) * w * 0.05;
      var headY = stemTopY + h * (0.13 + rnd() * 0.08);
      g.strokeStyle = 'rgba(27,41,22,0.96)';
      g.lineWidth = w * 0.008;
      g.beginPath();
      g.moveTo(rootX + (k === 0 ? -w * 0.03 : w * 0.03), rootY);
      g.quadraticCurveTo(px, stemTopY + h * 0.28, ctrlX, stemTopY + h * 0.05);
      g.quadraticCurveTo(ctrlX + (headX - ctrlX) * 0.4, stemTopY - h * 0.02, headX, headY);
      g.stroke();
      // drooping grain head
      var grains = 12;
      for (var gi = 0; gi < grains; gi++) {
        var gt = gi / (grains - 1);
        var gx = lerp(ctrlX, headX, gt) + Math.sin(gt * 4.2) * w * 0.012;
        var gy = lerp(stemTopY + h * 0.05, headY, Math.pow(gt, 0.82));
        var gw = w * (0.009 - gt * 0.003);
        g.fillStyle = gi > grains - 4 ? 'rgba(198,190,140,0.5)' : 'rgba(38,52,27,0.96)';
        g.beginPath();
        g.ellipse(gx + Math.sin(gi) * 3, gy, Math.max(1.2, gw), Math.max(2.4, gw * 1.9), 0.5, 0, TAU);
        g.fill();
      }
      g.strokeStyle = 'rgba(255,224,168,0.05)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(ctrlX, stemTopY + h * 0.03);
      g.quadraticCurveTo(headX - w * 0.04, headY - h * 0.02, headX + w * 0.02, headY);
      g.stroke();
    }

    g.filter = 'none';
    return layer;
  }

  function makeVignette(w, h) {
    var cw = Math.max(2, Math.round(w * 0.5));
    var ch = Math.max(2, Math.round(h * 0.5));
    var c = makeCanvas(cw, ch), g = c.getContext('2d');
    var gr = g.createRadialGradient(cw * 0.5, ch * 0.5, Math.min(cw, ch) * 0.24,
      cw * 0.5, ch * 0.52, Math.max(cw, ch) * 0.72);
    gr.addColorStop(0, 'rgba(8,20,19,0)');
    gr.addColorStop(0.55, 'rgba(8,20,19,0.10)');
    gr.addColorStop(0.82, 'rgba(7,17,17,0.32)');
    gr.addColorStop(1, 'rgba(6,14,15,0.55)');
    g.fillStyle = gr;
    g.fillRect(0, 0, cw, ch);
    return c;
  }

  /* ------------------------------------------------------------
     palettes
     ------------------------------------------------------------ */
  var SKY_DAY = [
    [0.00, '#3d6270'], [0.13, '#4b7077'], [0.26, '#648a86'], [0.38, '#7ea39a'],
    [0.48, '#9ab2a1'], [0.57, '#b4bfa3'], [0.66, '#cbc6a2'], [0.75, '#ddca9e'],
    [0.84, '#ebd2a0'], [0.92, '#f2d8a0'], [1.00, '#f7e3ae']
  ];
  var SKY_DUSK = [
    [0.00, '#22394a'], [0.13, '#2d4753'], [0.25, '#41605f'], [0.37, '#5f7b71'],
    [0.47, '#7e8f7c'], [0.56, '#9c9a80'], [0.65, '#b9a37f'], [0.74, '#d4ad7f'],
    [0.83, '#e5bb86'], [0.92, '#f0c88f'], [1.00, '#f5d39a']
  ];
  var WATER_DAY = [
    [0.00, '#d9d2a9'], [0.03, '#c8cca9'], [0.07, '#b4c5ae'], [0.13, '#a2bbaa'],
    [0.21, '#92afa0'], [0.32, '#7f9e90'], [0.46, '#6e8e81'], [0.62, '#5e7f72'],
    [0.8, '#507166'], [1.00, '#45665b']
  ];
  var WATER_DUSK = [
    [0.00, '#e3c392'], [0.03, '#cbb696'], [0.07, '#aca88f'], [0.13, '#93a08e'],
    [0.21, '#829587'], [0.32, '#71857b'], [0.46, '#60766e'], [0.62, '#4f655f'],
    [0.8, '#415852'], [1.00, '#354a46']
  ];

  var GRASS_DAY = ['rgba(112,137,79,0.9)', 'rgba(83,108,61,0.88)', 'rgba(147,156,96,0.8)', 'rgba(201,187,124,0.72)'];
  var GRASS_DUSK = ['rgba(92,112,71,0.9)', 'rgba(64,86,57,0.88)', 'rgba(124,134,86,0.8)', 'rgba(196,165,109,0.72)'];
  var SEEDLING_DAY = ['rgba(86,112,70,0.85)', 'rgba(116,134,82,0.8)', 'rgba(154,156,102,0.75)', 'rgba(196,180,122,0.6)'];
  var SEEDLING_DUSK = ['rgba(70,92,64,0.85)', 'rgba(96,112,74,0.8)', 'rgba(128,130,90,0.75)', 'rgba(180,152,105,0.6)'];

  /* ------------------------------------------------------------
     construction
     ------------------------------------------------------------ */
  function RiceScene() {
    this.W = 2; this.H = 2; this.u = 1; this.dpr = 1; this.scale = 1;
    this.horizon = 1; this.topY = 0; this._ready = false;
    this.time = 0; this.progress = 0; this.dusk = 0;
    this.wind = 0; this.gust = 0; this.frenzy = 0;
    this.reduced = false;
    this._pointerX = 0; this._pointerY = 0;
    this.ripples = [];
    this._rippleClock = 0;
    this._fxRnd = mulberry32(9981);

    // static sprites (size independent)
    this.sunGlow = makeRadialSprite(768, [
      [0, 'rgba(255,250,232,0.7)'],
      [0.16, 'rgba(255,241,205,0.42)'],
      [0.34, 'rgba(255,222,168,0.2)'],
      [0.55, 'rgba(255,205,142,0.07)'],
      [0.78, 'rgba(255,194,126,0.018)'],
      [1, 'rgba(255,190,120,0)']
    ]);
    this.sunBloom = makeRadialSprite(768, [
      [0, 'rgba(255,228,170,0.3)'],
      [0.3, 'rgba(255,203,132,0.12)'],
      [0.62, 'rgba(255,188,112,0.03)'],
      [1, 'rgba(255,180,100,0)']
    ]);
    this.sunCore = makeRadialSprite(256, [
      [0, 'rgba(255,253,244,1)'],
      [0.36, 'rgba(255,247,220,0.97)'],
      [0.56, 'rgba(255,238,196,0.82)'],
      [0.72, 'rgba(255,226,172,0.5)'],
      [0.86, 'rgba(255,213,152,0.18)'],
      [0.95, 'rgba(255,205,140,0.04)'],
      [1, 'rgba(255,202,136,0)']
    ]);
    this.sunCoreDusk = makeRadialSprite(256, [
      [0, 'rgba(255,248,226,1)'],
      [0.36, 'rgba(255,238,201,0.96)'],
      [0.56, 'rgba(255,224,168,0.8)'],
      [0.72, 'rgba(255,204,138,0.48)'],
      [0.86, 'rgba(255,186,112,0.16)'],
      [0.95, 'rgba(250,169,96,0.035)'],
      [1, 'rgba(246,160,88,0)']
    ]);
    this.sparkWarm = makeSpark(64, true);
    this.sparkCool = makeSpark(64, false);
    this.dot = makeDotSprite(32, [
      [0, 'rgba(255,242,210,1)'],
      [0.25, 'rgba(255,232,190,0.5)'],
      [0.6, 'rgba(255,224,178,0.1)'],
      [1, 'rgba(255,220,170,0)']
    ]);
    this.glowStreak = makeStreakSprite();
    this.sunPathSprite = makeSunPathSprite();
    this.mist = makeMistSprite();
    this.bokeh = makeBokehSprite();
    this.beam = makeBeamSprite();
    this.cloudSprites = [makeCloudSprite(11), makeCloudSprite(37), makeCloudSprite(73)];
    this.cloudW = 720; this.cloudH = 260;
  }

  RiceScene.prototype.resize = function (w, h, dpr) {
    w = Math.max(320, Math.round(w) || 320);
    h = Math.max(240, Math.round(h) || 240);
    this.W = w; this.H = h;
    this.dpr = dpr || 1;
    this.u = h / 900;
    this.horizon = Math.round(h * 0.46);
    this.topY = Math.round(this.horizon - h * 0.052);
    var s = Math.min(2, Math.max(1, this.dpr));
    if (w * s > 2800) s = Math.max(1, 2800 / w);
    this.scale = s;

    this._buildGeometry();
    this.backDay = this._buildBack(false);
    this.backDusk = this._buildBack(true);
    this.waterDay = this._buildWater(false).c;
    this.waterDusk = this._buildWater(true).c;
    this.waterCssH = h - this.topY;

    this.fgLeft = makeForegroundRice(Math.min(w * 0.245, 430 * this.u), Math.min(h * 0.44, 440 * this.u), 991, false);
    this.fgRight = makeForegroundRice(Math.min(w * 0.255, 445 * this.u), Math.min(h * 0.41, 420 * this.u), 424, true);
    this.vignette = makeVignette(w, h);

    this.ripples = [];
    this._rippleClock = 0;
    this._ready = true;
  };

  /* ------------------------------------------------------------
     geometry (deterministic, rebuilt on resize only)
     ------------------------------------------------------------ */
  RiceScene.prototype._buildBund = function (cfg) {
    var W = this.W, H = this.H, hor = this.horizon;
    return {
      yAt: function (x) {
        var t = x / W;
        var y = hor + H * (cfg.y0 + cfg.slope * (t - 0.5) +
          cfg.a1 * Math.sin(t * Math.PI * cfg.f1 + cfg.p1) +
          cfg.a2 * Math.sin(t * Math.PI * cfg.f2 + cfg.p2));
        // low spillway dips cut into the earth crest
        if (cfg.notch1) y += H * cfg.notchDepth * Math.exp(-Math.pow((x - W * cfg.notch1) / (W * 0.024), 2));
        if (cfg.notch2) y += H * cfg.notchDepth * 0.7 * Math.exp(-Math.pow((x - W * cfg.notch2) / (W * 0.017), 2));
        // irregular earthen crest
        y += H * 0.0009 * Math.sin(x * 0.071 + cfg.seed) + H * 0.0005 * Math.sin(x * 0.19 + cfg.seed * 1.7);
        return y;
      },
      thick: H * cfg.thick,
      far: !!cfg.far,
      seed: cfg.seed
    };
  };

  RiceScene.prototype._buildKarst = function (def, seed) {
    var W = this.W, H = this.H, hor = this.horizon, sunX = this.sunX;
    var rnd = mulberry32(seed);
    var towers = [];

    function addTower(cx, hgt, wid) {
      towers.push({
        cx: cx, h: hgt, w: wid,
        wl: wid * (0.58 + rnd() * 0.78),
        wr: wid * (0.58 + rnd() * 0.78)
      });
    }

    for (var i = 0; i < def.n; i++) {
      var slot = (i + 0.16 + rnd() * 0.68) / def.n;
      var cx = W * slot;
      var tall = Math.pow(rnd(), 1.55);
      var hgt = H * (def.hMin + tall * (def.hMax - def.hMin));
      var wid = W * (def.wMin + rnd() * (def.wMax - def.wMin));
      addTower(cx, hgt, wid);
      if (rnd() > 0.34) {
        addTower(
          cx + (rnd() > 0.5 ? 1 : -1) * wid * (0.45 + rnd() * 0.8),
          hgt * (0.36 + rnd() * 0.42),
          wid * (0.4 + rnd() * 0.5)
        );
      }
    }
    // tall limestone spires that break the skyline
    for (var s = 0; s < def.spires.length; s++) {
      addTower(
        W * def.spires[s] + (rnd() - 0.5) * W * 0.025,
        H * def.hMax * (0.84 + rnd() * 0.3),
        W * def.wMin * (0.8 + rnd() * 0.65)
      );
    }
    // edge anchors keep the panorama framed
    addTower(W * 0.012, H * def.hMax * 0.8, W * def.wMax * 0.85);
    addTower(W * 0.99, H * def.hMax * 0.76, W * def.wMax * 0.9);

    var step = Math.max(2.2, W / 760);
    var pts = [];
    var topY = hor;
    var basePhase = rnd() * TAU;
    for (var x = 0; x <= W + step; x += step) {
      var maxH = 0;
      for (i = 0; i < towers.length; i++) {
        var tw = towers[i];
        var half = x < tw.cx ? tw.wl : tw.wr;
        var d = Math.abs(x - tw.cx) / half;
        if (d < 1) {
          var shape = Math.pow(Math.max(0, 1 - Math.pow(d, def.sidePow || 2.8)), def.topPow || 1.5);
          var hh = tw.h * shape * (1 + 0.05 * Math.sin(x * 0.05 + tw.cx * 0.03));
          if (hh > maxH) maxH = hh;
        }
      }
      var base = H * def.base * (0.55 + 0.3 * Math.sin(x / W * 6.1 + basePhase) +
        0.15 * Math.sin(x / W * 17.3 + basePhase * 1.7));
      base += H * 0.0045 * (0.4 + 0.6 * Math.sin(x * 0.13 + basePhase * 2.1));
      var hh2 = maxH + Math.max(0, base);
      // luminous saddle where the low sun sets (kept tight so the ridge line stays)
      var gd = Math.abs(x - sunX) / (W * 0.058);
      if (gd < 1) {
        var k = 1 - smooth(gd);
        hh2 = lerp(hh2, Math.min(hh2, H * def.gapMax), k);
      }
      hh2 += Math.sin(x * 0.19 + seed) * (0.7 + (hh2 / H) * 3.2) +
        Math.sin(x * 0.47 + seed * 2.3) * 0.45;
      if (hh2 < 0) hh2 = 0;
      var y = hor - hh2;
      if (y < topY) topY = y;
      pts.push({ x: x, y: y });
    }
    var path = new Path2D();
    path.moveTo(0, hor + 2);
    for (i = 0; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    path.lineTo(W, hor + 2);
    path.closePath();
    return { path: path, pts: pts, topY: topY, def: def, towers: towers };
  };

  RiceScene.prototype._buildGeometry = function () {
    var W = this.W, H = this.H, hor = this.horizon, u = this.u;
    this.sunX = W * 0.702;
    this.sunY0 = hor - H * 0.168;
    this.sunY1 = hor - H * 0.012;

    this.mtn = [];
    var defs = [
      {
        n: 13, hMin: 0.06, hMax: 0.205, base: 0.028, wMin: 0.019, wMax: 0.055,
        gapMax: 0.05, sidePow: 2.7, topPow: 1.55, spires: [0.16, 0.46, 0.88],
        day: ['#89a19d', '#a2b3a6', '#bcc7b4'],
        dusk: ['#5c7176', '#74847c', '#8e9285'],
        seed: 191
      },
      {
        n: 14, hMin: 0.055, hMax: 0.275, base: 0.015, wMin: 0.014, wMax: 0.042,
        gapMax: 0.031, sidePow: 3.0, topPow: 1.35, spires: [0.29, 0.55, 0.9],
        day: ['#557a72', '#6f8e80', '#8ba08e'],
        dusk: ['#3c5757', '#536862', '#6b786d'],
        seed: 733
      },
      {
        n: 15, hMin: 0.035, hMax: 0.16, base: 0.006, wMin: 0.01, wMax: 0.033,
        gapMax: 0.008, sidePow: 2.45, topPow: 1.5, spires: [0.03, 0.94, 0.985],
        day: ['#2e5147', '#3f6251', '#55745f'],
        dusk: ['#1d3531', '#2a443c', '#3d5549'],
        seed: 1259
      }
    ];
    for (var i = 0; i < defs.length; i++) this.mtn.push(this._buildKarst(defs[i], defs[i].seed));

    this.bundA = this._buildBund({
      y0: 0.118, slope: -0.008, a1: 0.019, f1: 1.2, p1: 0.6,
      a2: 0.007, f2: 3.2, p2: 2.0, thick: 0.009, far: true, seed: 501,
      notch1: 0.615, notchDepth: 0.0035
    });
    this.bundB = this._buildBund({
      y0: 0.305, slope: 0.02, a1: 0.032, f1: 1.12, p1: 2.3,
      a2: 0.011, f2: 2.6, p2: 0.4, thick: 0.018, far: false, seed: 947,
      notch1: 0.31, notch2: 0.845, notchDepth: 0.0055
    });

    // drifting thin clouds
    var crnd = mulberry32(203);
    this.clouds = [
      { x0: 0.34, y: 0.085, w: W * 0.42, h: W * 0.42 * (260 / 720), speed: W * 0.0032, a: 0.34, sp: 0, ph: crnd() * TAU },
      { x0: 0.71, y: 0.145, w: W * 0.31, h: W * 0.31 * (260 / 720), speed: W * 0.0022, a: 0.28, sp: 1, ph: crnd() * TAU },
      { x0: 0.07, y: 0.205, w: W * 0.36, h: W * 0.36 * (260 / 720), speed: W * 0.004, a: 0.23, sp: 2, ph: crnd() * TAU }
    ];

    this._buildGlints();
    this._buildDust();
    this._buildDragonflies();
    this._buildEgrets();
    this._buildStriders();
    this._buildDuckweedLive();
    this._buildSkyBirds();

    this.ripples = [];
    this._rippleClock = 0;
  };

  RiceScene.prototype._waterYInBand = function (band, x, rnd) {
    var u = this.u;
    var pad = u * 8;
    var a = this.bundA.yAt(x);
    var b = this.bundB.yAt(x);
    var y0, y1;
    if (band === 0) {
      y0 = this.horizon + pad * 1.4;
      y1 = a - pad * 1.8;
    } else if (band === 1) {
      y0 = a + this.bundA.thick + pad;
      y1 = b - pad * 1.8;
    } else {
      y0 = b + this.bundB.thick + pad * 1.6;
      y1 = this.H - pad * 2;
    }
    if (y1 <= y0 + 2) return null;
    return y0 + rnd() * (y1 - y0);
  };

  RiceScene.prototype._buildGlints = function () {
    var W = this.W, H = this.H, u = this.u;
    var rnd = mulberry32(5531);
    this.glints = [];
    var i, x, y;
    for (i = 0; i < 44; i++) {
      // most live sparkle sits inside the sun's broken reflection column
      x = clamp(this.sunX + (rnd() * 2 - 1) * W * (0.045 + rnd() * 0.08), W * 0.03, W * 0.97);
      y = this._waterYInBand(i % 3, x, rnd);
      if (y === null) continue;
      this.glints.push({
        x: x, y: y, s: 0.35 + rnd() * 0.75, a: 0.11 + rnd() * 0.24,
        ph: rnd() * TAU, sp: 0.8 + rnd() * 2.2, cool: false
      });
    }
    for (i = 0; i < 28; i++) {
      x = W * (0.03 + rnd() * 0.94);
      y = this._waterYInBand(i % 3, x, rnd);
      if (y === null) continue;
      this.glints.push({
        x: x, y: y, s: 0.3 + rnd() * 0.6, a: 0.05 + rnd() * 0.12,
        ph: rnd() * TAU, sp: 0.5 + rnd() * 1.6, cool: rnd() < 0.62
      });
    }

    this.glintStreaks = [];
    for (i = 0; i < 22; i++) {
      x = clamp(this.sunX + (rnd() * 2 - 1) * W * 0.11, W * 0.03, W * 0.97);
      y = this._waterYInBand(i % 3, x, rnd);
      if (y === null) continue;
      this.glintStreaks.push({
        x: x, y: y, w: W * (0.008 + rnd() * 0.04), a: 0.04 + rnd() * 0.1,
        ph: rnd() * TAU, sp: 0.4 + rnd() * 1.1, cool: rnd() < 0.3
      });
    }
  };

  RiceScene.prototype._buildDust = function () {
    var W = this.W, H = this.H, u = this.u;
    var rnd = mulberry32(4815);
    var i;
    this.dustFront = [];
    for (i = 0; i < 46; i++) {
      this.dustFront.push({
        x: rnd() * W,
        y: this.horizon + H * 0.03 + rnd() * (H - this.horizon) * 0.92,
        s: 0.7 + rnd() * 2.2,
        a: 0.08 + rnd() * 0.24,
        dx: 8 + rnd() * 26, dy: 3 + rnd() * 10,
        ph: rnd() * TAU, sp: 0.2 + rnd() * 0.6
      });
    }
    this.dustBack = [];
    for (i = 0; i < 16; i++) {
      this.dustBack.push({
        x: rnd() * W,
        y: this.horizon + H * 0.01 + rnd() * (H - this.horizon) * 0.5,
        s: 0.4 + rnd() * 1.2,
        a: 0.05 + rnd() * 0.12,
        dx: 4 + rnd() * 14, ph: rnd() * TAU, sp: 0.15 + rnd() * 0.4
      });
    }
    this.bokehMotes = [];
    for (i = 0; i < 5; i++) {
      this.bokehMotes.push({
        x: W * (0.08 + rnd() * 0.84),
        y: H * (0.55 + rnd() * 0.42),
        s: (70 + rnd() * 150) * u,
        a: 0.045 + rnd() * 0.06,
        ph: rnd() * TAU, sp: 0.1 + rnd() * 0.25
      });
    }
  };

  RiceScene.prototype._buildDragonflies = function () {
    var W = this.W, H = this.H, hor = this.horizon;
    var rnd = mulberry32(778);
    this.dragonflies = [];
    for (var i = 0; i < 9; i++) {
      var overWater = i < 5;
      this.dragonflies.push({
        x: W * (0.06 + rnd() * 0.88),
        y: overWater
          ? hor + H * (0.03 + rnd() * 0.25)
          : hor + H * (0.33 + rnd() * 0.52),
        ax: W * (0.008 + rnd() * 0.026),
        ay: H * (0.006 + rnd() * 0.024),
        sp: 0.2 + rnd() * 0.5,
        sp2: 0.4 + rnd() * 0.8,
        ph: rnd() * TAU,
        ph2: rnd() * TAU,
        s: 0.8 + rnd() * 0.75,
        rot: (rnd() - 0.5) * 0.7,
        flutter: 12 + rnd() * 6,
        golden: rnd()
      });
    }
  };

  RiceScene.prototype._buildEgrets = function () {
    var W = this.W, H = this.H, hor = this.horizon;
    // feet sit on the far water/bund line, bodies rise above the distant
    // rice canopy so the birds stay readable once RiceField is composited in.
    this.egrets = [
      { x: W * 0.172, fy: hor + H * 0.031, size: 1.0, ph: 0.4, forage: false, wade: W * 0.009 },
      { x: W * 0.268, fy: hor + H * 0.046, size: 0.84, ph: 2.1, forage: true, wade: W * 0.006 },
      { x: W * 0.858, fy: hor + H * 0.034, size: 1.06, ph: 4.3, forage: false, wade: W * 0.011 }
    ];
    var rnd = mulberry32(661);
    this.heroBird = {
      x0: rnd() * W,
      speed: W * 0.006 + 5,
      y: 0.145 + rnd() * 0.05,
      ph: rnd() * TAU
    };
    this.flock = [];
    for (var f = 0; f < 2; f++) {
      var members = [];
      var count = 3 + f;
      for (var m = 0; m < count; m++) {
        members.push({
          dx: (m - count / 2) * (13 + f * 5) + (m % 2) * 4,
          dy: Math.abs(m - count / 2) * 6 + (m % 2) * 2,
          ph: rnd() * TAU,
          sz: 0.6 + rnd() * 0.7
        });
      }
      this.flock.push({
        x0: rnd() * W,
        y: hor - H * (0.17 + rnd() * 0.14),
        speed: 8 + f * 4,
        members: members,
        ph: rnd() * TAU
      });
    }
  };

  RiceScene.prototype._buildStriders = function () {
    var rnd = mulberry32(1717);
    this.striders = [];
    for (var i = 0; i < 4; i++) {
      var x = this.W * (0.28 + rnd() * 0.5);
      var y = this._waterYInBand(i < 2 ? 0 : 1, x, rnd);
      if (y === null) continue;
      this.striders.push({
        x: x, y: y, ax: this.W * (0.006 + rnd() * 0.018),
        sp: 0.06 + rnd() * 0.16, ph: rnd() * TAU,
        ay: this.H * 0.002 + rnd() * this.H * 0.004,
        s: 0.8 + rnd() * 0.7
      });
    }
  };

  RiceScene.prototype._buildDuckweedLive = function () {
    var rnd = mulberry32(2929);
    this.duckweedLive = [];
    for (var i = 0; i < 16; i++) {
      var band = i % 2 ? 0 : 1;
      var x = this.W * (rnd() < 0.5 ? (0.02 + rnd() * 0.18) : (0.8 + rnd() * 0.18));
      var y = this._waterYInBand(band, x, rnd);
      if (y === null) continue;
      this.duckweedLive.push({
        x: x, y: y, ph: rnd() * TAU, sp: 0.05 + rnd() * 0.12,
        ax: this.W * (0.002 + rnd() * 0.008), s: 0.7 + rnd() * 1.1
      });
    }
  };

  RiceScene.prototype._buildSkyBirds = function () {
    this.flyingBirds = [];
    var rnd = mulberry32(152);
    for (var f = 0; f < 2; f++) {
      var members = [];
      for (var m = 0; m < 3 + f; m++) {
        members.push({
          dx: (m - 1.5) * (12 + f * 6), dy: Math.abs(m - 1.5) * 7 + rnd() * 4,
          ph: rnd() * TAU, sz: 0.55 + rnd() * 0.5
        });
      }
      this.flyingBirds.push({
        x0: rnd() * this.W,
        y: this.H * (0.11 + rnd() * 0.12),
        speed: 9 + f * 5,
        members: members
      });
    }
  };

  /* ------------------------------------------------------------
     pre-rendered background: sky, haze, karst towers
     ------------------------------------------------------------ */
  RiceScene.prototype._buildBack = function (dusk) {
    var W = this.W, H = this.H, hor = this.horizon, u = this.u;
    var layer = makeLayer(W, hor, this.scale);
    var g = layer.g;
    var i;

    // --- sky gradient -------------------------------------------------
    var sky = dusk ? SKY_DUSK : SKY_DAY;
    var sg = g.createLinearGradient(0, 0, 0, hor);
    for (i = 0; i < sky.length; i++) sg.addColorStop(sky[i][0], sky[i][1]);
    g.fillStyle = sg;
    g.fillRect(0, 0, W, hor);

    // broad glow around the low sun, baked into the sky
    var sunY = dusk ? this.sunY1 : this.sunY0;
    var warm = g.createRadialGradient(this.sunX, sunY, 0, this.sunX, sunY, H * 0.62);
    warm.addColorStop(0, dusk ? 'rgba(255,214,158,0.46)' : 'rgba(255,238,198,0.42)');
    warm.addColorStop(0.22, dusk ? 'rgba(255,203,147,0.2)' : 'rgba(255,226,176,0.2)');
    warm.addColorStop(0.55, dusk ? 'rgba(245,178,122,0.06)' : 'rgba(250,214,160,0.06)');
    warm.addColorStop(1, 'rgba(255,199,140,0)');
    g.fillStyle = warm;
    g.fillRect(0, 0, W, hor);

    // humid warm band across the horizon
    var hz = g.createLinearGradient(0, hor - H * 0.16, 0, hor);
    hz.addColorStop(0, 'rgba(255,224,176,0)');
    hz.addColorStop(0.6, dusk ? 'rgba(255,205,150,0.16)' : 'rgba(255,224,178,0.14)');
    hz.addColorStop(1, dusk ? 'rgba(255,214,164,0.34)' : 'rgba(255,234,194,0.3)');
    g.fillStyle = hz;
    g.fillRect(0, hor - H * 0.16, W, H * 0.16);

    // --- thin high cloud work ----------------------------------------
    var rnd = mulberry32(dusk ? 77 : 71);
    g.save();
    g.filter = 'blur(5px)';
    for (i = 0; i < 9; i++) {
      var cx = W * (0.06 + rnd() * 0.88);
      var cy = H * (0.06 + rnd() * 0.27);
      var cw = W * (0.12 + rnd() * 0.3);
      var ch = H * (0.006 + rnd() * 0.016);
      g.fillStyle = dusk
        ? 'rgba(255,214,180,' + (0.07 + rnd() * 0.14) + ')'
        : 'rgba(255,241,214,' + (0.065 + rnd() * 0.13) + ')';
      g.save();
      g.translate(cx, cy);
      g.rotate((rnd() - 0.5) * 0.05);
      g.beginPath();
      g.ellipse(0, 0, cw / 2, ch, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    // a couple of jade shadow bands beneath
    for (i = 0; i < 4; i++) {
      var sx = W * (0.1 + rnd() * 0.8);
      var sy = H * (0.2 + rnd() * 0.13);
      g.fillStyle = 'rgba(91,123,126,' + (0.045 + rnd() * 0.06) + ')';
      g.beginPath();
      g.ellipse(sx, sy, W * (0.08 + rnd() * 0.16), H * (0.008 + rnd() * 0.012), -0.02, 0, TAU);
      g.fill();
    }
    g.restore();

    // --- first faint stars at dusk -----------------------------------
    if (dusk) {
      var srnd = mulberry32(848);
      g.save();
      for (i = 0; i < 16; i++) {
        var px = W * srnd();
        var py = H * (0.02 + srnd() * 0.26);
        var pa = 0.08 + srnd() * 0.2;
        g.fillStyle = 'rgba(236,244,238,' + pa + ')';
        g.beginPath();
        g.arc(px, py, 0.5 + srnd() * 0.9, 0, TAU);
        g.fill();
      }
      g.restore();
    }

    // --- karst layers -------------------------------------------------
    for (var L = 0; L < this.mtn.length; L++) {
      var m = this.mtn[L];
      var def = m.def;
      var cols = dusk ? def.dusk : def.day;
      var grad = g.createLinearGradient(0, m.topY, 0, hor);
      grad.addColorStop(0, cols[0]);
      grad.addColorStop(0.55, cols[1]);
      grad.addColorStop(1, cols[2]);
      g.fillStyle = grad;
      g.fill(m.path);

      // warm sun-side wash + cool shadow, clipped to the ridge
      g.save();
      g.clip(m.path);
      var side = g.createLinearGradient(W * 0.38, 0, W, 0);
      side.addColorStop(0, 'rgba(70,104,106,0)');
      side.addColorStop(0.55, dusk ? 'rgba(255,190,130,0.05)' : 'rgba(255,222,172,0.055)');
      side.addColorStop(1, dusk ? 'rgba(255,199,141,0.17)' : 'rgba(255,233,190,0.18)');
      g.fillStyle = side;
      g.fillRect(0, m.topY, W, hor - m.topY);

      // limestone massing: cool shadow on the left flank, warm edge on the right
      for (i = 0; i < m.towers.length; i++) {
        var twr = m.towers[i];
        if (twr.h < H * 0.085) continue;
        var lx = twr.cx - twr.wl * 0.95;
        var rx = twr.cx + twr.wr * 0.95;
        var tg = g.createLinearGradient(lx, 0, rx, 0);
        tg.addColorStop(0, dusk ? 'rgba(8,26,25,0.24)' : 'rgba(20,48,40,0.19)');
        tg.addColorStop(0.46, 'rgba(255,255,255,0)');
        tg.addColorStop(0.78, dusk ? 'rgba(255,194,138,0.06)' : 'rgba(255,226,176,0.075)');
        tg.addColorStop(1, dusk ? 'rgba(255,206,150,0.13)' : 'rgba(255,238,192,0.15)');
        g.fillStyle = tg;
        g.fillRect(lx, m.topY, rx - lx, hor - m.topY);
      }
      // faint limestone striations on the nearer ridge
      if (L === 2) {
        g.strokeStyle = dusk ? 'rgba(255,206,156,0.05)' : 'rgba(255,222,176,0.055)';
        g.lineWidth = 1;
        var strn = mulberry32(3100 + L);
        for (i = 0; i < 26; i++) {
          var qx = W * strn();
          var qy = hor - (hor - m.topY) * (0.2 + strn() * 0.7);
          g.beginPath();
          g.moveTo(qx, qy);
          g.lineTo(qx + (strn() - 0.5) * 8, qy - H * (0.015 + strn() * 0.05));
          g.stroke();
        }
      }
      g.restore();

      // aerial haze pooling at the ridge feet
      var mistH = 0.075 - L * 0.012;
      var mg = g.createLinearGradient(0, hor - H * mistH * 1.6, 0, hor + 2);
      mg.addColorStop(0, 'rgba(250,224,184,0)');
      mg.addColorStop(0.62, dusk ? 'rgba(250,216,172,0.12)' : 'rgba(255,235,198,0.13)');
      mg.addColorStop(1, dusk ? 'rgba(255,222,180,0.24)' : 'rgba(255,241,210,0.24)');
      g.fillStyle = mg;
      g.fillRect(0, hor - H * mistH * 1.6, W, H * mistH * 1.6 + 2);
    }

    // final horizon breath, fusing ridge feet into the water
    var feet = g.createLinearGradient(0, hor - H * 0.075, 0, hor);
    feet.addColorStop(0, 'rgba(250,224,182,0)');
    feet.addColorStop(0.65, dusk ? 'rgba(252,220,176,0.2)' : 'rgba(255,238,202,0.22)');
    feet.addColorStop(1, dusk ? 'rgba(255,224,180,0.42)' : 'rgba(255,244,214,0.4)');
    g.fillStyle = feet;
    g.fillRect(0, hor - H * 0.075, W, H * 0.075);

    return layer.c;
  };

  /* ------------------------------------------------------------
     pre-rendered water: terraces, reflections, bunds, far paddy
     ------------------------------------------------------------ */
  RiceScene.prototype._buildReflection = function (dusk) {
    var W = this.W, H = this.H, hor = this.horizon, S = this.scale;
    var back = dusk ? this.backDusk : this.backDay;
    var srcH = Math.min(hor - 2, H * 0.245);
    var D = Math.max(8, srcH * 0.6);
    var layer = makeLayer(W, D, S);
    var g = layer.g;
    var i;

    g.save();
    g.translate(0, D);
    g.scale(1, -1);
    g.drawImage(back, 0, (hor - srcH) * S, W * S, srcH * S, 0, 0, W, D);
    g.restore();

    // fade the mirror with distance
    g.globalCompositeOperation = 'destination-in';
    var fade = g.createLinearGradient(0, 0, 0, D);
    fade.addColorStop(0, 'rgba(0,0,0,0.98)');
    fade.addColorStop(0.4, 'rgba(0,0,0,0.72)');
    fade.addColorStop(0.74, 'rgba(0,0,0,0.3)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, W, D);

    // broken horizontal ripple slits
    g.globalCompositeOperation = 'destination-out';
    var rnd = mulberry32(dusk ? 301 : 302);
    var y = 0;
    while (y < D) {
      var hh = 0.8 + rnd() * 4;
      g.fillStyle = 'rgba(0,0,0,' + (0.1 + rnd() * 0.26) + ')';
      g.fillRect(0, y, W, hh);
      y += hh + 1.4 + rnd() * 5;
    }
    // sideways offsets soften the mirrored ridge
    for (i = 0; i < 7; i++) {
      var sy = rnd() * D;
      g.fillStyle = 'rgba(0,0,0,' + (0.06 + rnd() * 0.16) + ')';
      g.fillRect(0, sy, W, 1.5 + rnd() * 5);
    }

    // tint the reflection toward the local water colour
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = dusk ? 'rgba(42,72,68,0.32)' : 'rgba(74,108,98,0.22)';
    g.fillRect(0, 0, W, D);
    g.globalCompositeOperation = 'source-over';
    return layer;
  };

  RiceScene.prototype._bakeSunPath = function (g, dusk) {
    var W = this.W, H = this.H, hor = this.horizon, u = this.u;
    var y0 = hor + 2, y1 = H * 0.9;
    if (y1 <= y0) return;
    var len = y1 - y0;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = dusk ? 0.6 : 0.5;
    var colW = W * 0.3;
    g.drawImage(this.sunPathSprite, this.sunX - colW * 0.5, y0, colW, len);

    var rnd = mulberry32(dusk ? 6611 : 6613);
    var i;
    for (i = 0; i < 195; i++) {
      var f = Math.pow(rnd(), 0.82);
      var yy = y0 + f * len;
      var spread = (W * 0.022 + W * 0.105 * f) * (0.4 + rnd() * 0.9);
      var xx = this.sunX + (rnd() * 2 - 1) * spread;
      var wdt = (2 + rnd() * 18) * (0.5 + f * 0.9);
      var alpha = (0.1 + rnd() * 0.38) * (1 - 0.3 * f);
      g.globalAlpha = alpha * (dusk ? 0.94 : 1);
      g.strokeStyle = rnd() < 0.18 ? 'rgba(205,224,198,1)' : 'rgba(255,229,174,1)';
      g.lineWidth = (0.7 + rnd() * 1.6) * u;
      g.beginPath();
      g.moveTo(xx - wdt / 2, yy);
      g.lineTo(xx + wdt / 2, yy + (rnd() - 0.5) * 0.6);
      g.stroke();
    }
    // brighter broken path right at the far mirror
    for (i = 0; i < 46; i++) {
      var ny = y0 + rnd() * H * 0.11;
      var off = (rnd() * 2 - 1) * W * (0.01 + 0.055 * rnd());
      var nw = (3 + rnd() * 24) * u;
      g.globalAlpha = (0.14 + rnd() * 0.26) * (dusk ? 0.9 : 1);
      g.strokeStyle = rnd() < 0.24 ? 'rgba(222,238,208,1)' : 'rgba(255,238,190,1)';
      g.lineWidth = (0.8 + rnd() * 1.4) * u;
      g.beginPath();
      g.moveTo(this.sunX + off - nw / 2, ny);
      g.lineTo(this.sunX + off + nw / 2, ny);
      g.stroke();
    }
    g.restore();
  };

  RiceScene.prototype._drawFarPaddy = function (g, dusk) {
    var W = this.W, H = this.H, hor = this.horizon, u = this.u;
    var rnd = mulberry32(dusk ? 911 : 913);
    var palette = dusk ? SEEDLING_DUSK : SEEDLING_DAY;
    var i, x, tall, lean, yb;

    function bankY(xx) {
      return hor + 3.6 + Math.sin(xx * 0.006 + 1.7) * 2 + Math.sin(xx * 0.021 + 4.1) * 0.9;
    }

    // dark wet bank / field edge right at the waterline
    g.fillStyle = dusk ? 'rgba(40,51,39,0.62)' : 'rgba(48,61,42,0.55)';
    g.beginPath();
    g.moveTo(0, hor + 7);
    for (x = 0; x <= W; x += 22) g.lineTo(x, bankY(x) + 1.6);
    g.lineTo(W, hor + 10);
    g.lineTo(0, hor + 10);
    g.closePath();
    g.fill();

    // dense hazy back layer of rice seedlings
    for (x = -2; x < W + 2; x += 1.5 + rnd() * 1.5) {
      yb = bankY(x) + 1.6;
      tall = 1.8 + rnd() * 6.5;
      lean = (rnd() - 0.5) * 3.6;
      g.globalAlpha = 0.16 + rnd() * 0.34;
      g.strokeStyle = palette[rnd() < 0.62 ? 0 : 1];
      g.lineWidth = (0.45 + rnd() * 0.55) * u;
      g.beginPath();
      g.moveTo(x, yb);
      g.quadraticCurveTo(x + lean * 0.3, yb - tall * 0.62, x + lean, yb - tall);
      g.stroke();
    }

    // taller foreground paddy fringe: longer leaves + nodding panicles
    for (x = -4; x < W + 4; x += 2.4 + rnd() * 3.4) {
      if (rnd() < 0.3) continue;
      yb = bankY(x) + 1.4;
      tall = 5 + rnd() * 15;
      lean = (rnd() - 0.5) * 5.4;
      g.globalAlpha = 0.34 + rnd() * 0.46;
      g.strokeStyle = palette[rnd() < 0.55 ? (rnd() < 0.5 ? 1 : 0) : (rnd() < 0.56 ? 2 : 3)];
      g.lineWidth = (0.6 + rnd() * 0.7) * u;
      g.beginPath();
      g.moveTo(x, yb);
      g.quadraticCurveTo(x + lean * 0.35, yb - tall * 0.58, x + lean, yb - tall);
      g.stroke();
      // drooping seed head on some stalks
      if (rnd() < 0.42 && tall > 9) {
        var hx = x + lean;
        var hy = yb - tall;
        var drop = 2.5 + rnd() * 4.5;
        var dx2 = lean * 0.35 + (rnd() - 0.5) * 2.4;
        g.globalAlpha = 0.3 + rnd() * 0.35;
        g.strokeStyle = palette[2];
        g.lineWidth = (0.5 + rnd() * 0.5) * u;
        g.beginPath();
        g.moveTo(hx, hy);
        g.quadraticCurveTo(hx + dx2, hy + drop * 0.4, hx + dx2 * 1.4, hy + drop);
        g.stroke();
        if (rnd() < 0.5) {
          g.fillStyle = dusk ? 'rgba(214,184,124,0.5)' : 'rgba(228,208,150,0.55)';
          g.globalAlpha = 0.28 + rnd() * 0.4;
          g.beginPath();
          g.ellipse(hx + dx2 * 1.4, hy + drop + 0.6 * u, 0.75 * u, 1.7 * u, dx2 * 0.03, 0, TAU);
          g.fill();
        }
      }
    }

    // a few taller tufts clustered like planted hills
    for (i = 0; i < 30; i++) {
      x = rnd() * W;
      yb = bankY(x) + 1.8;
      var stalks = 3 + Math.floor(rnd() * 4);
      for (var s = 0; s < stalks; s++) {
        var sx2 = x + (rnd() - 0.5) * 16;
        tall = 8 + rnd() * 15;
        lean = (rnd() - 0.5) * 7;
        g.globalAlpha = 0.32 + rnd() * 0.42;
        g.strokeStyle = palette[rnd() < 0.5 ? 1 : 2];
        g.lineWidth = (0.6 + rnd() * 0.8) * u;
        g.beginPath();
        g.moveTo(sx2, yb);
        g.quadraticCurveTo(sx2 + lean * 0.4, yb - tall * 0.55, sx2 + lean, yb - tall);
        g.stroke();
        if (rnd() < 0.55) {
          g.fillStyle = dusk ? 'rgba(208,176,116,0.5)' : 'rgba(226,204,144,0.6)';
          g.globalAlpha = 0.3 + rnd() * 0.4;
          g.beginPath();
          g.ellipse(sx2 + lean, yb - tall - 1.1 * u, 0.8 * u, 2.1 * u, lean * 0.02, 0, TAU);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;

    // reflected hints of the paddy fringe in the first centimetres of water
    for (i = 0; i < 130; i++) {
      x = rnd() * W;
      var ry = bankY(x) + 3 + rnd() * 7;
      g.globalAlpha = 0.05 + rnd() * 0.1;
      g.strokeStyle = dusk ? 'rgba(58,74,54,1)' : 'rgba(66,84,56,1)';
      g.lineWidth = (0.5 + rnd() * 0.6) * u;
      g.beginPath();
      g.moveTo(x, ry);
      g.lineTo(x + (rnd() - 0.5) * 3, ry + 1.2 + rnd() * 2.4);
      g.stroke();
    }

    // waterline catch-light + dark mirror edge
    g.globalAlpha = dusk ? 0.3 : 0.34;
    g.strokeStyle = dusk ? 'rgba(255,224,172,1)' : 'rgba(255,242,208,1)';
    g.lineWidth = 1.15 * u;
    g.beginPath();
    for (x = 0; x <= W; x += 24) {
      if (x === 0) g.moveTo(x, bankY(x) + 2.2); else g.lineTo(x, bankY(x) + 2.2);
    }
    g.stroke();
    g.globalAlpha = 0.18;
    g.strokeStyle = 'rgba(40,58,44,1)';
    g.lineWidth = 1.6 * u;
    g.beginPath();
    for (x = 0; x <= W; x += 24) {
      if (x === 0) g.moveTo(x, bankY(x) + 4); else g.lineTo(x, bankY(x) + 4);
    }
    g.stroke();
    g.globalAlpha = 1;

    // soft reflected smear of the far paddy
    var smear = g.createLinearGradient(0, hor + 2, 0, hor + H * 0.045);
    smear.addColorStop(0, dusk ? 'rgba(58,71,52,0.3)' : 'rgba(64,80,54,0.26)');
    smear.addColorStop(0.45, dusk ? 'rgba(64,78,58,0.1)' : 'rgba(72,90,62,0.09)');
    smear.addColorStop(1, 'rgba(70,88,64,0)');
    g.fillStyle = smear;
    g.fillRect(0, hor + 3, W, H * 0.045);
  };

  RiceScene.prototype._drawSeedlingRows = function (g, dusk) {
    var W = this.W, H = this.H, hor = this.horizon, u = this.u;
    var rnd = mulberry32(dusk ? 551 : 552);
    var rows = [0.036, 0.06, 0.084];
    for (var r = 0; r < rows.length; r++) {
      var baseY = hor + H * rows[r];
      for (var x = -6; x < W + 6; x += 7.5 + rnd() * 5) {
        var yy = baseY + Math.sin(x * 0.005 + r * 1.8) * H * 0.0038 + (rnd() - 0.5) * 1.6;
        var len = 1.2 + rnd() * 2.2;
        g.globalAlpha = (0.08 + rnd() * 0.16) * (1 - r * 0.18);
        g.strokeStyle = rnd() < 0.55 ? SEEDLING_DAY[0] : SEEDLING_DAY[2];
        g.lineWidth = 0.7 * u;
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(x + (rnd() - 0.5) * 1.6, yy - len);
        g.stroke();
        g.globalAlpha *= 0.35;
        g.beginPath();
        g.moveTo(x, yy + 0.5);
        g.lineTo(x + (rnd() - 0.5) * 1.2, yy + len * 0.8);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  };

  RiceScene.prototype._drawBund = function (g, bund, dusk) {
    var W = this.W, H = this.H, u = this.u;
    var step = Math.max(3, W / 420);
    var pts = [];
    var x;
    for (x = -step; x <= W + step; x += step) pts.push({ x: x, y: bund.yAt(x) });

    // soft dark reflection / root shadow beneath the bund
    var refG = g.createLinearGradient(0, bund.yAt(W * 0.5) + bund.thick, 0, bund.yAt(W * 0.5) + bund.thick + H * 0.045);
    refG.addColorStop(0, dusk ? 'rgba(26,37,31,0.34)' : 'rgba(34,46,37,0.3)');
    refG.addColorStop(0.55, dusk ? 'rgba(32,44,37,0.11)' : 'rgba(40,54,43,0.09)');
    refG.addColorStop(1, 'rgba(40,54,43,0)');
    g.fillStyle = refG;
    g.fillRect(0, bund.yAt(W * 0.5) + bund.thick - 2, W, H * 0.05);

    // ribbon body
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    var i;
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    for (i = pts.length - 1; i >= 0; i--) {
      g.lineTo(pts[i].x, pts[i].y + bund.thick * (1 + 0.16 * Math.sin(pts[i].x * 0.011 + bund.seed)));
    }
    g.closePath();
    var top = pts[0].y, bot = pts[0].y;
    for (i = 1; i < pts.length; i++) {
      if (pts[i].y < top) top = pts[i].y;
      if (pts[i].y > bot) bot = pts[i].y;
    }
    var bg = g.createLinearGradient(0, top - 2, 0, bot + bund.thick + 2);
    if (bund.far) {
      bg.addColorStop(0, dusk ? '#77755a' : '#8b8a61');
      bg.addColorStop(0.36, dusk ? '#4e583d' : '#5f6a45');
      bg.addColorStop(0.75, dusk ? '#36422f' : '#465236');
      bg.addColorStop(1, dusk ? '#2b372c' : '#38452f');
    } else {
      bg.addColorStop(0, dusk ? '#6c6a4d' : '#7f8159');
      bg.addColorStop(0.32, dusk ? '#455139' : '#566343');
      bg.addColorStop(0.72, dusk ? '#303d2e' : '#3f4d33');
      bg.addColorStop(1, dusk ? '#253127' : '#333f2b');
    }
    g.fillStyle = bg;
    g.fill();

    // sunlit crown
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokeStyle = dusk ? 'rgba(255,214,162,0.4)' : 'rgba(255,234,190,0.44)';
    g.lineWidth = (bund.far ? 1.1 : 1.5) * u;
    g.stroke();

    // wet glints along the crown
    g.strokeStyle = dusk ? 'rgba(255,232,190,0.16)' : 'rgba(255,246,214,0.2)';
    g.lineWidth = 0.8 * u;
    for (i = 3; i < pts.length - 3; i += 2) {
      if ((i * 37) % 11 > 3) continue;
      g.beginPath();
      g.moveTo(pts[i].x, pts[i].y + 1);
      g.lineTo(pts[i].x + step * 1.6, pts[i].y + 1);
      g.stroke();
    }

    // mud / straw speckles on the earth body
    var mrnd = mulberry32(bund.seed + 71);
    for (i = 0; i < (bund.far ? 150 : 210); i++) {
      var mx = mrnd() * W;
      var my = bund.yAt(mx) + bund.thick * (0.1 + mrnd() * 0.78);
      g.globalAlpha = 0.08 + mrnd() * 0.14;
      g.fillStyle = mrnd() < 0.55 ? 'rgba(30,40,28,1)' : 'rgba(214,190,140,1)';
      g.fillRect(mx, my, (0.8 + mrnd() * 2.4) * u, (0.6 + mrnd() * 0.8) * u);
    }

    // grass fringe
    var rnd = mulberry32(bund.seed);
    var palette = dusk ? GRASS_DUSK : GRASS_DAY;
    for (i = 0; i < pts.length; i++) {
      if (rnd() < 0.22) continue;
      var p = pts[i];
      var clump = rnd() < 0.22;
      var blades = clump ? 3 + Math.floor(rnd() * 4) : 1;
      for (var b = 0; b < blades; b++) {
        var bx = p.x + (rnd() - 0.5) * step * 1.4 + (clump ? (b - blades / 2) * 2.3 * u : 0);
        var by = p.y - rnd() * 1.8;
        var hgt = (bund.far ? 3.4 : 5.2) + rnd() * (bund.far ? 6 : 10);
        var lean = (rnd() - 0.5) * (bund.far ? 4 : 6.6) + 0.7;
        g.globalAlpha = 0.38 + rnd() * 0.55;
        g.strokeStyle = palette[rnd() < 0.7 ? (rnd() < 0.55 ? 0 : 1) : (rnd() < 0.6 ? 2 : 3)];
        g.lineWidth = (bund.far ? 0.65 : 0.95) * (0.7 + rnd() * 0.8);
        g.beginPath();
        g.moveTo(bx, by);
        g.quadraticCurveTo(bx + lean * 0.35, by - hgt * 0.62, bx + lean, by - hgt);
        g.stroke();
        if (clump && rnd() < 0.4) {
          g.globalAlpha *= 0.75;
          g.beginPath();
          g.moveTo(bx, by);
          g.quadraticCurveTo(bx - lean * 0.8, by - hgt * 0.55, bx - lean * 1.3, by - hgt * 0.8);
          g.stroke();
        }
      }
    }
    g.globalAlpha = 1;

    // a few taller rice-like tufts along the bund crown
    var tuftCount = bund.far ? 12 : 16;
    for (i = 0; i < tuftCount; i++) {
      var tx = rnd() * W;
      var ty = bund.yAt(tx) - 1;
      var tl = (bund.far ? 7 : 11) + rnd() * (bund.far ? 10 : 16);
      var tdir = rnd() < 0.5 ? -1 : 1;
      for (var tb = 0; tb < 4; tb++) {
        var tbx = tx + (rnd() - 0.5) * 8;
        var tlean = tdir * (2 + rnd() * 5);
        g.globalAlpha = 0.4 + rnd() * 0.4;
        g.strokeStyle = palette[rnd() < 0.5 ? 0 : 2];
        g.lineWidth = 0.8 * u;
        g.beginPath();
        g.moveTo(tbx, ty);
        g.quadraticCurveTo(tbx + tlean * 0.3, ty - tl * 0.65, tbx + tlean, ty - tl);
        g.stroke();
      }
      if (rnd() < 0.5) {
        g.globalAlpha = 0.38;
        g.fillStyle = dusk ? 'rgba(204,176,120,0.55)' : 'rgba(224,204,146,0.6)';
        g.beginPath();
        g.ellipse(tx + tdir * 5, ty - tl - 1, 1 * u, 2.4 * u, tdir * 0.04, 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // mirrored grass hints + bright waterline at the foot of the bund
    for (i = 0; i < pts.length; i += 3) {
      if ((i * 17) % 7 > 2) continue;
      var rp = pts[i];
      g.globalAlpha = 0.05 + (i % 5) * 0.012;
      g.strokeStyle = dusk ? 'rgba(48,66,48,1)' : 'rgba(56,76,50,1)';
      g.lineWidth = 0.7 * u;
      g.beginPath();
      g.moveTo(rp.x, rp.y + bund.thick + 1);
      g.lineTo(rp.x + (i % 4 - 1.5) * 2.5 * u, rp.y + bund.thick + 3 + (i % 3) * 1.6 * u);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y + bund.thick + 1);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y + bund.thick * (1 + 0.16 * Math.sin(pts[i].x * 0.011 + bund.seed)) + 1);
    g.globalAlpha = dusk ? 0.16 : 0.19;
    g.strokeStyle = dusk ? 'rgba(255,236,196,1)' : 'rgba(255,248,220,1)';
    g.lineWidth = 1.2 * u;
    g.stroke();
    g.globalAlpha = 1;

    // a couple of taller sedges / reeds at the far edges
    var edgeSpots = bund.far ? [0.045, 0.94] : [0.06, 0.9, 0.975];
    for (i = 0; i < edgeSpots.length; i++) {
      var ex = W * edgeSpots[i];
      var ey = bund.yAt(ex);
      var stalks = 2 + Math.floor(rnd() * 3);
      for (var s2 = 0; s2 < stalks; s2++) {
        var sx = ex + (rnd() - 0.5) * 7 * u;
        var sy = ey - rnd() * 2;
        var sl = (bund.far ? 12 : 20) + rnd() * (bund.far ? 14 : 24);
        var slx = (rnd() - 0.5) * 10;
        g.globalAlpha = 0.3 + rnd() * 0.35;
        g.strokeStyle = dusk ? 'rgba(60,74,54,0.85)' : 'rgba(70,88,56,0.8)';
        g.lineWidth = (0.9 + rnd() * 0.8) * u;
        g.beginPath();
        g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + slx * 0.3, sy - sl * 0.6, sx + slx, sy - sl);
        g.stroke();
        g.globalAlpha = 0.4;
        g.strokeStyle = dusk ? 'rgba(206,176,120,0.55)' : 'rgba(224,200,140,0.6)';
        g.beginPath();
        g.ellipse(sx + slx, sy - sl, 1.1 * u, 3.2 * u, slx * 0.04, 0, TAU);
        g.fill();
        g.globalAlpha = 1;
      }
    }

    // tiny flowering specks on the near bund
    if (!bund.far) {
      for (i = 0; i < 12; i++) {
        var fx = rnd() * W;
        var fy = bund.yAt(fx) + rnd() * bund.thick * 0.6;
        g.fillStyle = rnd() < 0.5 ? 'rgba(232,220,164,0.6)' : 'rgba(244,232,188,0.5)';
        g.beginPath();
        g.arc(fx, fy, (0.7 + rnd() * 0.9) * u, 0, TAU);
        g.fill();
      }
    }
  };

  RiceScene.prototype._drawDuckweedBaked = function (g, dusk) {
    var W = this.W, H = this.H, hor = this.horizon, u = this.u;
    var spots = [
      [0.075, 0.16, 1.0], [0.925, 0.15, 0.9], [0.2, 0.245, 0.75],
      [0.82, 0.355, 0.8], [0.53, 0.40, 0.6], [0.34, 0.185, 0.7]
    ];
    var rnd = mulberry32(dusk ? 818 : 819);
    var colors = dusk
      ? ['rgba(58,78,52,0.75)', 'rgba(80,98,60,0.65)', 'rgba(103,118,72,0.55)', 'rgba(134,140,88,0.4)']
      : ['rgba(63,86,51,0.72)', 'rgba(89,110,62,0.62)', 'rgba(116,133,76,0.52)', 'rgba(150,160,98,0.42)'];
    for (var s = 0; s < spots.length; s++) {
      var cx = W * spots[s][0];
      var cy = hor + H * spots[s][1];
      var rad = W * 0.022 * spots[s][2];
      var n = 18 + Math.floor(rnd() * 18);
      for (var i = 0; i < n; i++) {
        var a = rnd() * TAU;
        var d = Math.sqrt(rnd()) * rad;
        var px = cx + Math.cos(a) * d;
        var py = cy + Math.sin(a) * d * 0.46;
        g.globalAlpha = 0.5 + rnd() * 0.5;
        g.fillStyle = colors[Math.floor(rnd() * colors.length)];
        g.beginPath();
        g.ellipse(px, py, (1 + rnd() * 2.4) * u, (0.6 + rnd() * 1.2) * u, rnd(), 0, TAU);
        g.fill();
        if (rnd() < 0.35) {
          g.fillStyle = 'rgba(226,222,160,0.35)';
          g.beginPath();
          g.arc(px, py - 0.8 * u, 0.6 * u, 0, TAU);
          g.fill();
        }
      }
      // faint reflection patch
      g.globalAlpha = 0.08;
      g.fillStyle = dusk ? 'rgba(40,58,48,1)' : 'rgba(48,68,52,1)';
      g.beginPath();
      g.ellipse(cx, cy + rad * 0.35, rad * 1.2, rad * 0.4, 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  RiceScene.prototype._buildWater = function (dusk) {
    var W = this.W, H = this.H, hor = this.horizon, topY = this.topY, u = this.u;
    var layer = makeLayer(W, H - topY, this.scale);
    var g = layer.g;
    g.translate(0, -topY);
    var i, x, y;

    // base mirror gradient
    var stops = dusk ? WATER_DUSK : WATER_DAY;
    var wg = g.createLinearGradient(0, hor, 0, H);
    for (i = 0; i < stops.length; i++) wg.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = wg;
    g.fillRect(0, hor, W, H - hor);

    // reflected sky bands just under the horizon
    var skyRef = g.createLinearGradient(0, hor, 0, hor + H * 0.2);
    skyRef.addColorStop(0, dusk ? 'rgba(255,204,146,0.22)' : 'rgba(255,229,184,0.2)');
    skyRef.addColorStop(0.16, dusk ? 'rgba(214,192,152,0.14)' : 'rgba(224,224,190,0.13)');
    skyRef.addColorStop(0.45, dusk ? 'rgba(122,160,150,0.1)' : 'rgba(140,178,166,0.1)');
    skyRef.addColorStop(1, 'rgba(120,160,150,0)');
    g.fillStyle = skyRef;
    g.fillRect(0, hor, W, H * 0.22);

    var rnd = mulberry32(dusk ? 121 : 123);
    for (i = 0; i < 42; i++) {
      x = rnd() * W;
      y = hor + rnd() * H * 0.12;
      g.globalAlpha = 0.03 + rnd() * 0.055;
      g.strokeStyle = rnd() < 0.4 ? 'rgba(240,248,226,1)' : 'rgba(255,242,206,1)';
      g.lineWidth = (0.7 + rnd() * 1.1) * u;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + W * (0.015 + rnd() * 0.06), y + (rnd() - 0.5) * 1.2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // mirrored karst & sky
    var refl = this._buildReflection(dusk);
    g.globalAlpha = dusk ? 0.74 : 0.8;
    g.drawImage(refl.c, 0, hor, refl.w, refl.h);
    g.globalAlpha = 1;

    // broad sky sheen bands over the mirror
    var sheen = mulberry32(dusk ? 7331 : 7333);
    for (i = 0; i < 5; i++) {
      var sy = hor + H * (0.018 + sheen() * 0.24);
      var sh = H * (0.012 + sheen() * 0.04);
      var sgrad = g.createLinearGradient(0, sy - sh, 0, sy + sh);
      sgrad.addColorStop(0, 'rgba(240,244,224,0)');
      sgrad.addColorStop(0.5, sheen() < 0.45
        ? (dusk ? 'rgba(255,224,176,0.075)' : 'rgba(255,240,206,0.075)')
        : (dusk ? 'rgba(140,180,168,0.07)' : 'rgba(160,196,182,0.07)'));
      sgrad.addColorStop(1, 'rgba(220,236,214,0)');
      g.fillStyle = sgrad;
      g.fillRect(0, sy - sh, W, sh * 2);
    }
    // slow longitudinal ripple lines
    for (i = 0; i < 30; i++) {
      var ry2 = hor + H * (0.025 + rnd() * 0.72);
      var rx2 = rnd() * W;
      var rlen = W * (0.03 + rnd() * 0.13);
      g.globalAlpha = 0.035 + rnd() * 0.05;
      g.strokeStyle = rnd() < 0.45 ? 'rgba(40,66,58,1)' : 'rgba(240,240,210,1)';
      g.lineWidth = (0.55 + rnd() * 0.7) * u;
      g.beginPath();
      g.moveTo(rx2, ry2);
      g.quadraticCurveTo(rx2 + rlen * 0.5, ry2 + (rnd() - 0.5) * 2.4, rx2 + rlen, ry2 + (rnd() - 0.5) * 1.4);
      g.stroke();
    }
    g.globalAlpha = 1;

    // broken golden sun-path (sits under bundle / bank so terraces occlude it)
    this._bakeSunPath(g, dusk);

    // far paddy bank + transplanted rows
    this._drawFarPaddy(g, dusk);
    this._drawSeedlingRows(g, dusk);

    // fine seams of distant field divisions
    g.save();
    var seamYs = [0.35, 0.62];
    for (i = 0; i < seamYs.length; i++) {
      var sx = W * seamYs[i];
      g.strokeStyle = dusk ? 'rgba(255,232,188,0.1)' : 'rgba(255,246,214,0.12)';
      g.lineWidth = 0.9 * u;
      g.beginPath();
      g.moveTo(sx, hor + 4);
      g.quadraticCurveTo(sx + W * 0.01, hor + H * 0.05, sx + W * 0.022, this.bundA.yAt(sx + W * 0.022) - 2);
      g.stroke();
      g.strokeStyle = dusk ? 'rgba(36,52,46,0.12)' : 'rgba(44,62,52,0.11)';
      g.beginPath();
      g.moveTo(sx + 1, hor + 5);
      g.quadraticCurveTo(sx + W * 0.01 + 1, hor + H * 0.05, sx + W * 0.022 + 1, this.bundA.yAt(sx + W * 0.022) - 1);
      g.stroke();
    }
    g.restore();

    // broad water tone patches (avoid a flat mirror)
    var prnd = mulberry32(dusk ? 5511 : 5513);
    for (i = 0; i < 7; i++) {
      var px = W * prnd();
      var py = hor + H * (0.06 + prnd() * 0.55);
      var pr = W * (0.05 + prnd() * 0.12);
      var pg = g.createRadialGradient(px, py, 0, px, py, pr);
      var warmPatch = prnd() < 0.5;
      pg.addColorStop(0, warmPatch
        ? (dusk ? 'rgba(255,214,160,0.055)' : 'rgba(255,236,196,0.05)')
        : (dusk ? 'rgba(50,92,84,0.07)' : 'rgba(74,116,102,0.07)'));
      pg.addColorStop(1, 'rgba(120,150,130,0)');
      g.fillStyle = pg;
      g.save();
      g.translate(px, py);
      g.scale(2.4, 0.5);
      g.beginPath();
      g.arc(0, 0, pr, 0, TAU);
      g.fill();
      g.restore();
    }

    // fine surface texture streaks
    var srnd = mulberry32(dusk ? 3311 : 3313);
    for (i = 0; i < 95; i++) {
      x = srnd() * W;
      y = hor + H * (0.03 + srnd() * 0.9);
      var len = W * (0.008 + srnd() * 0.05);
      g.globalAlpha = 0.015 + srnd() * 0.05;
      g.strokeStyle = srnd() < 0.4 ? 'rgba(214,234,212,1)' : 'rgba(255,238,200,1)';
      g.lineWidth = (0.5 + srnd() * 0.9) * u;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len * 0.5, y + (srnd() - 0.5) * 2, x + len, y);
      g.stroke();
    }
    g.globalAlpha = 1;

    // bunds: far first, then near
    this._drawBund(g, this.bundA, dusk);
    this._drawBund(g, this.bundB, dusk);

    // duckweed clusters near the margins / bunds
    this._drawDuckweedBaked(g, dusk);

    // humid veil over the far water (kept light so the mirror stays readable)
    var fog = g.createLinearGradient(0, topY, 0, hor + H * 0.07);
    fog.addColorStop(0, 'rgba(250,232,198,0)');
    fog.addColorStop(0.5, dusk ? 'rgba(246,214,170,0.11)' : 'rgba(250,235,205,0.1)');
    fog.addColorStop(0.72, dusk ? 'rgba(248,222,184,0.075)' : 'rgba(252,238,210,0.07)');
    fog.addColorStop(1, 'rgba(246,214,170,0)');
    g.fillStyle = fog;
    g.fillRect(0, topY, W, H * 0.11);
    // extra breath right at the waterline
    var line = g.createLinearGradient(0, hor - H * 0.008, 0, hor + H * 0.024);
    line.addColorStop(0, 'rgba(255,235,202,0)');
    line.addColorStop(0.5, dusk ? 'rgba(255,224,178,0.15)' : 'rgba(255,240,208,0.13)');
    line.addColorStop(1, 'rgba(255,235,202,0)');
    g.fillStyle = line;
    g.fillRect(0, hor - H * 0.008, W, H * 0.032);

    return layer;
  };

  /* ------------------------------------------------------------
     update
     ------------------------------------------------------------ */
  RiceScene.prototype.sunPos = function () {
    var p = clamp(this.progress, 0, 1);
    return {
      x: this.sunX,
      y: lerp(this.sunY0, this.sunY1, p),
      r: lerp(this.H * 0.027, this.H * 0.040, p)
    };
  };

  RiceScene.prototype.update = function (dt, time, env) {
    env = env || {};
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    this.time = time || 0;

    var pTarget = clamp(env.progress == null ? 0 : env.progress, 0, 1);
    this.progress += (pTarget - this.progress) * Math.min(1, dt * 2.4);
    if (Math.abs(pTarget - this.progress) < 0.0008) this.progress = pTarget;
    this.dusk = smooth(this.progress);

    var wt = clamp(env.wind || 0, -1, 1);
    this.wind += (wt - this.wind) * Math.min(1, dt * 1.8);
    this.gust += (clamp(env.gust || 0, 0, 1) - this.gust) * Math.min(1, dt * 2.4);
    this.frenzy += (clamp(env.frenzy || 0, 0, 1) - this.frenzy) * Math.min(1, dt * 3);
    this.reduced = !!env.reduced;

    var tx = 0, ty = 0;
    if (env.pointer && isFinite(env.pointer.x) && isFinite(env.pointer.y)) {
      tx = clamp(env.pointer.x / this.W - 0.5, -0.5, 0.5);
      ty = clamp(env.pointer.y / this.H - 0.5, -0.5, 0.5);
    }
    this._pointerX += (tx - this._pointerX) * Math.min(1, dt * 1.4);
    this._pointerY += (ty - this._pointerY) * Math.min(1, dt * 1.4);

    // occasional rings on the mirror
    this._rippleClock += dt;
    var maxRings = this.reduced ? 3 : 6;
    if (this._rippleClock > 0.85 && this.ripples.length < maxRings) {
      this._rippleClock = 0;
      var x = this._fxRnd() * this.W;
      var y = this._waterYInBand(this._fxRnd() < 0.55 ? 0 : 1, x, this._fxRnd);
      if (y !== null) {
        this.ripples.push({
          x: x,
          y: y + (this._fxRnd() - 0.5) * this.u * 4,
          life: 0,
          max: 2.4 + this._fxRnd() * 2.6,
          r1: (18 + this._fxRnd() * 34) * this.u,
          squash: 0.32 + this._fxRnd() * 0.14
        });
      }
    }
    for (var i = this.ripples.length - 1; i >= 0; i--) {
      var r = this.ripples[i];
      r.life += dt;
      if (r.life > r.max) this.ripples.splice(i, 1);
    }
  };

  /* ------------------------------------------------------------
     drawBack
     ------------------------------------------------------------ */
  RiceScene.prototype.drawBack = function (ctx, env) {
    if (!this._ready) return;
    var W = this.W, H = this.H, hor = this.horizon, u = this.u;
    var t = this.time, p = this.dusk, frenzy = this.frenzy;

    // sky + karst, cross-faded day -> dusk
    ctx.drawImage(this.backDay, 0, 0, W, hor);
    if (p > 0.002) {
      ctx.globalAlpha = p;
      ctx.drawImage(this.backDusk, 0, 0, W, hor);
      ctx.globalAlpha = 1;
    }

    var sun = this.sunPos();
    this._drawSun(ctx, sun, p, frenzy);
    this._drawClouds(ctx, t, p);
    this._drawSkyBirds(ctx, t, p);

    // flooded terraces (mirror water, reflections, bunds, far paddy)
    ctx.drawImage(this.waterDay, 0, this.topY, W, this.waterCssH);
    if (p > 0.002) {
      ctx.globalAlpha = p;
      ctx.drawImage(this.waterDusk, 0, this.topY, W, this.waterCssH);
      ctx.globalAlpha = 1;
    }

    // warm bloom sitting on the low sun / waterline
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18 + p * 0.24 + frenzy * 0.2;
    ctx.drawImage(this.sunBloom, sun.x - W * 0.34, hor - H * 0.11, W * 0.68, H * 0.28);
    ctx.globalAlpha = 0.22 + frenzy * 0.22;
    ctx.drawImage(this.glowStreak, sun.x - W * 0.2, hor - H * 0.004, W * 0.4, H * 0.014);
    if (frenzy > 0.02) {
      ctx.globalAlpha = 0.16 * frenzy;
      ctx.drawImage(this.sunPathSprite, sun.x - W * 0.16, hor + 2, W * 0.32, H * 0.5);
    }
    ctx.restore();

    this._drawWaterGlints(ctx, t, p, frenzy);
    this._drawRipples(ctx, p, frenzy);
    this._drawEgrets(ctx, t, p);
    this._drawStriders(ctx, t, p);
    this._drawDuckweedLive(ctx, t, p);
    this._drawBackMotes(ctx, t, p);
    this._drawMist(ctx, t, p);
  };

  RiceScene.prototype._drawSun = function (ctx, sun, p, frenzy) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var gs = sun.r * (12 + frenzy * 4.5);
    ctx.globalAlpha = 0.42 + p * 0.1;
    ctx.drawImage(this.sunGlow, sun.x - gs * 0.5, sun.y - gs * 0.5, gs, gs);
    var hs = sun.r * 5.2;
    ctx.globalAlpha = 0.26 + p * 0.12;
    ctx.drawImage(this.sunGlow, sun.x - hs * 0.5, sun.y - hs * 0.5, hs, hs);
    // narrow anamorphic breath
    ctx.globalAlpha = 0.055 + p * 0.055;
    ctx.drawImage(this.glowStreak, sun.x - sun.r * 7.5, sun.y - sun.r * 0.42, sun.r * 15, sun.r * 0.84);
    ctx.restore();

    var r = sun.r * 0.92;
    // additive, so the disc never carves a dark halo into its own glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.sunCore, sun.x - r, sun.y - r, r * 2, r * 2);
    if (p > 0.01) {
      ctx.globalAlpha = p * 0.82;
      ctx.drawImage(this.sunCoreDusk, sun.x - r, sun.y - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  RiceScene.prototype._drawClouds = function (ctx, t, p) {
    var W = this.W;
    for (var i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i];
      var x = mod(c.x0 * W + t * c.speed, W + c.w * 1.4) - c.w * 0.7;
      var y = c.y * this.H + Math.sin(t * 0.04 + c.ph) * this.H * 0.004;
      ctx.globalAlpha = c.a * (1 - p * 0.18);
      ctx.drawImage(this.cloudSprites[c.sp], x, y, c.w, c.h);
    }
    ctx.globalAlpha = 1;
  };

  RiceScene.prototype._drawSkyBirds = function (ctx, t, p) {
    var W = this.W, H = this.H, hor = this.horizon;
    var alpha = 0.32 - p * 0.1;
    var i, j;
    if (alpha > 0.02) {
      ctx.save();
      ctx.strokeStyle = 'rgba(48,55,42,1)';
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      ctx.globalAlpha = alpha;
      for (i = 0; i < this.flyingBirds.length; i++) {
        var f = this.flyingBirds[i];
        var fx = mod(f.x0 + t * f.speed, W + 260) - 130;
        for (j = 0; j < f.members.length; j++) {
          var m = f.members[j];
          var bx = fx + m.dx;
          var by = f.y + m.dy + Math.sin(t * 0.6 + m.ph) * 3;
          var flap = Math.sin(t * 5 + m.ph) * 2.1;
          var sz = (7 + this.u * 3) * m.sz;
          ctx.beginPath();
          ctx.moveTo(bx - sz, by);
          ctx.quadraticCurveTo(bx - sz * 0.35, by - flap, bx, by);
          ctx.quadraticCurveTo(bx + sz * 0.35, by - flap, bx + sz, by);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // a lone white egret crossing the low sky
    var hb = this.heroBird;
    var hx = mod(hb.x0 + t * hb.speed, W + 420) - 210;
    var hy = H * hb.y + Math.sin(t * 0.4 + hb.ph) * H * 0.008;
    this._drawFlyingEgret(ctx, hx, hy, this.u * 0.9, t, p);
  };

  RiceScene.prototype._drawFlyingEgret = function (ctx, x, y, s, t, p) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.globalAlpha = 0.86 - p * 0.1;
    var flap = Math.sin(t * 2.6) * 0.55;
    // long slow wings
    ctx.fillStyle = 'rgba(247,242,226,1)';
    ctx.beginPath();
    ctx.moveTo(-2, 1);
    ctx.quadraticCurveTo(-14, -3 - flap * 9, -30, -1 - flap * 13);
    ctx.quadraticCurveTo(-18, 3 - flap * 2, -3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(2, 1);
    ctx.quadraticCurveTo(14, -3.5 - flap * 8, 29, -1.5 - flap * 11);
    ctx.quadraticCurveTo(17, 3 - flap * 2, 3, 4);
    ctx.closePath();
    ctx.fill();
    // body + trailing legs / neck
    ctx.fillStyle = 'rgba(252,247,233,1)';
    ctx.beginPath();
    ctx.ellipse(0, 2.4, 7, 2.8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(250,244,229,0.95)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(5, 2);
    ctx.quadraticCurveTo(10, 0.5, 13, -1);
    ctx.stroke();
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-5, 3);
    ctx.lineTo(-13, 6);
    ctx.moveTo(-5, 3.6);
    ctx.lineTo(-12, 7.4);
    ctx.stroke();
    // warm rim
    ctx.strokeStyle = 'rgba(255,214,158,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.quadraticCurveTo(14, -3.5 - flap * 7, 27, -1.5 - flap * 10);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  RiceScene.prototype._drawWaterGlints = function (ctx, t, p, frenzy) {
    var u = this.u;
    var boost = 0.7 + frenzy * 0.9;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var i, g;
    for (i = 0; i < this.glints.length; i++) {
      g = this.glints[i];
      var tw = 0.5 + 0.5 * Math.sin(t * g.sp + g.ph);
      if (tw < 0.06) continue;
      var s = (3.5 + g.s * 7) * u * (1 + frenzy * 0.4);
      ctx.globalAlpha = g.a * tw * boost * 0.6;
      ctx.drawImage(g.cool ? this.sparkCool : this.sparkWarm,
        g.x - s * 0.5, g.y - s * 0.21, s, s * 0.42);
    }
    for (i = 0; i < this.glintStreaks.length; i++) {
      var st = this.glintStreaks[i];
      var tw2 = 0.4 + 0.6 * Math.sin(t * st.sp + st.ph);
      if (tw2 < 0.08) continue;
      var sw = st.w * (0.7 + 0.5 * tw2) * (1 + frenzy * 0.3);
      var sx = st.x + Math.sin(t * st.sp * 0.7 + st.ph) * u * 5;
      ctx.globalAlpha = st.a * tw2 * boost * 0.55;
      ctx.drawImage(st.cool ? this.sparkCool : this.glowStreak,
        sx - sw * 0.5, st.y - u * 1.2, sw, u * 2.4);
    }
    ctx.restore();
  };

  RiceScene.prototype._drawRipples = function (ctx, p, frenzy) {
    if (!this.ripples.length) return;
    var u = this.u;
    ctx.save();
    ctx.strokeStyle = 'rgba(250,240,212,1)';
    ctx.lineWidth = 0.9 * u;
    for (var i = 0; i < this.ripples.length; i++) {
      var r = this.ripples[i];
      var q = clamp(r.life / r.max, 0, 1);
      var e = 1 - Math.pow(1 - q, 2);
      var rad = r.r1 * e;
      ctx.globalAlpha = Math.pow(1 - q, 1.6) * (0.16 + frenzy * 0.14);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, rad, rad * r.squash, 0, 0, TAU);
      ctx.stroke();
      if (q < 0.55) {
        ctx.globalAlpha *= 0.5;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, rad * 0.58, rad * 0.58 * r.squash, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  RiceScene.prototype._drawEgrets = function (ctx, t, p) {
    for (var i = 0; i < this.egrets.length; i++) {
      var e = this.egrets[i];
      var wx = e.x + Math.sin(t * 0.13 + e.ph) * e.wade;
      var bob = Math.sin(t * 0.7 + e.ph) * 1.2;
      var s = this.u * e.size;
      var footY = e.fy + this.H * 0.002;

      // reflected silhouette on the mirror
      ctx.save();
      ctx.globalAlpha = 0.23 - p * 0.04;
      ctx.translate(wx, footY + 1);
      ctx.scale(1, -0.5);
      ctx.fillStyle = 'rgba(246,241,222,1)';
      ctx.beginPath();
      ctx.ellipse(0, -34 * s, 14 * s, 8 * s, -0.1, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(246,241,222,1)';
      ctx.lineWidth = 3.2 * s;
      ctx.beginPath();
      ctx.moveTo(6 * s, -40 * s);
      ctx.quadraticCurveTo(13 * s, -52 * s, 10 * s, -60 * s);
      ctx.stroke();
      ctx.restore();

      // body
      ctx.save();
      ctx.translate(wx, footY + bob);
      ctx.fillStyle = 'rgba(247,242,226,0.96)';
      ctx.strokeStyle = 'rgba(247,242,226,0.96)';
      ctx.beginPath();
      ctx.ellipse(0, -35 * s, 14.5 * s, 8.6 * s, -0.13, 0, TAU);
      ctx.fill();
      // tail
      ctx.beginPath();
      ctx.moveTo(-11 * s, -37 * s);
      ctx.lineTo(-24 * s, -33 * s);
      ctx.lineTo(-11 * s, -30 * s);
      ctx.closePath();
      ctx.fill();
      // folded wing shade
      ctx.strokeStyle = p > 0.5 ? 'rgba(206,204,184,0.55)' : 'rgba(214,214,196,0.45)';
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(-8 * s, -39 * s);
      ctx.quadraticCurveTo(1 * s, -33 * s, -7 * s, -30 * s);
      ctx.stroke();

      // legs
      ctx.strokeStyle = 'rgba(58,62,50,0.85)';
      ctx.lineWidth = 1.25 * s;
      ctx.beginPath();
      ctx.moveTo(-1 * s, -28 * s);
      ctx.lineTo(-2.5 * s, -4 * s);
      ctx.moveTo(3 * s, -28 * s);
      ctx.lineTo(4.5 * s, -4 * s);
      ctx.stroke();

      // neck + head
      var forage = e.forage ? 0.5 + 0.5 * Math.sin(t * 0.5 + e.ph) : 0;
      var headX = (forage > 0.55 ? 16 : 13) * s;
      var headY = lerp(-60 * s, -14 * s, forage > 0.55 ? smooth((forage - 0.55) / 0.45) : 0);
      var neckMidX = 16 * s;
      var neckMidY = lerp(-50 * s, -34 * s, forage > 0.55 ? 1 : 0);
      ctx.strokeStyle = 'rgba(248,243,228,1)';
      ctx.lineWidth = 3.4 * s;
      ctx.beginPath();
      ctx.moveTo(7 * s, -40 * s);
      ctx.quadraticCurveTo(neckMidX, neckMidY, headX, headY);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(222,220,199,0.5)';
      ctx.lineWidth = 1.1 * s;
      ctx.beginPath();
      ctx.moveTo(7.8 * s, -39 * s);
      ctx.quadraticCurveTo(neckMidX + 1.2 * s, neckMidY + 0.5 * s, headX + 0.8 * s, headY);
      ctx.stroke();
      // head
      ctx.fillStyle = 'rgba(250,245,231,1)';
      ctx.beginPath();
      ctx.ellipse(headX, headY, 4.2 * s, 3.3 * s, forage > 0.55 ? 0.5 : -0.28, 0, TAU);
      ctx.fill();
      // beak
      ctx.fillStyle = 'rgba(214,163,86,1)';
      ctx.beginPath();
      ctx.moveTo(headX + 3 * s, headY - 0.4 * s);
      ctx.lineTo(headX + 13.5 * s, headY + (forage > 0.55 ? 2.5 : 0.8) * s);
      ctx.lineTo(headX + 3 * s, headY + 1.6 * s);
      ctx.closePath();
      ctx.fill();
      // eye
      ctx.fillStyle = 'rgba(48,50,40,0.8)';
      ctx.beginPath();
      ctx.arc(headX + 1.2 * s, headY - 0.6 * s, 0.8 * s, 0, TAU);
      ctx.fill();
      // warm rim light on the sunward side
      ctx.strokeStyle = 'rgba(255,222,174,' + (0.34 + p * 0.18) + ')';
      ctx.lineWidth = 0.85 * s;
      ctx.beginPath();
      ctx.ellipse(0, -35 * s, 14.5 * s, 8.6 * s, -0.13, -0.9, 1.4);
      ctx.stroke();

      // occasional wing lift
      if (Math.sin(t * 0.17 + e.ph * 2.3) > 0.96) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'rgba(248,243,228,1)';
        ctx.beginPath();
        ctx.moveTo(1 * s, -38 * s);
        ctx.quadraticCurveTo(-10 * s, -51 * s, -22 * s, -47 * s);
        ctx.quadraticCurveTo(-9 * s, -41 * s, 1 * s, -34 * s);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  };

  RiceScene.prototype._drawStriders = function (ctx, t, p) {
    if (!this.striders.length) return;
    var u = this.u;
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < this.striders.length; i++) {
      var s = this.striders[i];
      var x = s.x + Math.sin(t * s.sp + s.ph) * s.ax;
      var y = s.y + Math.sin(t * s.sp * 1.7 + s.ph * 1.3) * s.ay;
      var sc = s.s * u;
      // ripple ring
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = 'rgba(240,238,206,1)';
      ctx.lineWidth = 0.7 * u;
      ctx.beginPath();
      ctx.ellipse(x, y + 1 * u, 9 * sc, 3 * sc, 0, 0, TAU);
      ctx.stroke();
      // legs
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = 'rgba(38,48,40,1)';
      ctx.lineWidth = 0.7 * u;
      ctx.beginPath();
      ctx.moveTo(x - 2 * sc, y);
      ctx.lineTo(x - 7 * sc, y - 2.4 * sc);
      ctx.moveTo(x - 1.4 * sc, y + 0.4 * sc);
      ctx.lineTo(x - 5.5 * sc, y + 2.4 * sc);
      ctx.moveTo(x + 2 * sc, y);
      ctx.lineTo(x + 7 * sc, y - 2.2 * sc);
      ctx.moveTo(x + 1.4 * sc, y + 0.4 * sc);
      ctx.lineTo(x + 5.5 * sc, y + 2.6 * sc);
      ctx.stroke();
      // body
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = 'rgba(34,44,36,1)';
      ctx.beginPath();
      ctx.ellipse(x, y, 3.2 * sc, 1 * sc, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  RiceScene.prototype._drawDuckweedLive = function (ctx, t, p) {
    if (!this.duckweedLive.length) return;
    var u = this.u;
    ctx.save();
    for (var i = 0; i < this.duckweedLive.length; i++) {
      var d = this.duckweedLive[i];
      var x = d.x + Math.sin(t * d.sp + d.ph) * d.ax;
      var y = d.y + Math.cos(t * d.sp * 0.8 + d.ph) * u * 1.2;
      ctx.globalAlpha = 0.55 - p * 0.12;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(122,142,82,0.8)' : 'rgba(74,99,58,0.85)';
      ctx.beginPath();
      ctx.ellipse(x, y, (1.4 + (i % 4) * 0.5) * d.s * u, (0.8 + (i % 3) * 0.3) * d.s * u, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha *= 0.4;
      ctx.fillStyle = 'rgba(214,222,170,1)';
      ctx.beginPath();
      ctx.arc(x - 0.4 * u, y - 0.5 * u, 0.55 * u, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  RiceScene.prototype._drawBackMotes = function (ctx, t, p) {
    var W = this.W, u = this.u;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.dustBack.length; i++) {
      var d = this.dustBack[i];
      var tw = 0.5 + 0.5 * Math.sin(t * d.sp + d.ph);
      if (tw < 0.15) continue;
      var x = mod(d.x + t * d.dx * 0.12 + Math.sin(t * 0.3 + d.ph) * u * 8 + this._pointerX * 4, W + 20) - 10;
      var y = d.y + Math.sin(t * 0.24 + d.ph) * u * 6;
      var s = d.s * 6 * u;
      ctx.globalAlpha = d.a * tw * (0.6 + this.dusk * 0.4);
      ctx.drawImage(this.dot, x - s * 0.5, y - s * 0.5, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  RiceScene.prototype._drawMist = function (ctx, t, p) {
    var W = this.W, H = this.H, hor = this.horizon;
    var wisps = [
      { x0: 0.05, y: 0.018, speed: W * 0.003, a: 0.12, w: W * 0.55, h: H * 0.075, ph: 0.4 },
      { x0: 0.62, y: 0.045, speed: W * 0.0021, a: 0.1, w: W * 0.5, h: H * 0.07, ph: 2.1 },
      { x0: 0.3, y: 0.115, speed: W * 0.0014, a: 0.07, w: W * 0.62, h: H * 0.06, ph: 4.6 }
    ];
    var windShift = this._pointerX * W * 0.01;
    for (var i = 0; i < wisps.length; i++) {
      var m = wisps[i];
      var x = mod(m.x0 * W + t * m.speed, W + m.w) - m.w * 0.5 + windShift;
      var y = hor + m.y * H + Math.sin(t * 0.05 + m.ph) * H * 0.006;
      ctx.globalAlpha = m.a * (1 + this.dusk * 0.2);
      ctx.drawImage(this.mist, x, y, m.w, m.h);
    }
    ctx.globalAlpha = 1;
  };

  /* ------------------------------------------------------------
     drawFront
     ------------------------------------------------------------ */
  RiceScene.prototype.drawFront = function (ctx, env) {
    if (!this._ready) return;
    var W = this.W, H = this.H, u = this.u;
    var t = this.time, p = this.dusk, frenzy = this.frenzy;
    var sun = this.sunPos();

    this._drawRays(ctx, sun, p, frenzy);
    this._drawDragonflies(ctx, t, p);
    this._drawFrontMotes(ctx, t, p);
    this._drawBokeh(ctx, t, p);
    this._drawForeground(ctx, t, p);
    this._drawVignette(ctx, p);
  };

  RiceScene.prototype._drawRays = function (ctx, sun, p, frenzy) {
    if (this.reduced) return;
    var W = this.W, H = this.H;
    var intensity = (0.42 + p * 0.5) * (0.6 + frenzy * 0.7);
    if (intensity < 0.05) return;
    var t = this.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 7; i++) {
      var ang = (i - 3) * 0.155 + Math.sin(t * 0.06 + i * 1.7) * 0.025;
      var len = H * (0.5 + 0.3 * (0.5 + 0.5 * Math.sin(i * 1.9 + 0.6)));
      var bw = W * (0.035 + 0.028 * ((i * 5) % 4 / 3));
      ctx.save();
      ctx.translate(sun.x, sun.y);
      ctx.rotate(ang);
      ctx.globalAlpha = (0.05 + 0.035 * (0.5 + 0.5 * Math.sin(t * 0.11 + i * 2.2))) * intensity;
      ctx.drawImage(this.beam, -bw * 0.5, 0, bw, len);
      ctx.restore();
    }
    // soft sun breath in the humid air
    ctx.globalAlpha = 0.1 + p * 0.08;
    var hs = H * 0.55;
    ctx.drawImage(this.sunGlow, sun.x - hs * 0.5, sun.y - hs * 0.5, hs, hs);
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  RiceScene.prototype._drawDragonflies = function (ctx, t, p) {
    var u = this.u;
    for (var i = 0; i < this.dragonflies.length; i++) {
      var d = this.dragonflies[i];
      var x = d.x + Math.sin(t * d.sp + d.ph) * d.ax + this._pointerX * 8 * u;
      var y = d.y + Math.sin(t * d.sp2 + d.ph2) * d.ay;
      var sc = d.s * u * 1.45;
      var flap = 0.2 + 0.8 * Math.abs(Math.sin(t * d.flutter + d.ph));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(d.rot + Math.sin(t * 0.7 + d.ph) * 0.18);
      ctx.scale(sc, sc);

      // wings (two pairs)
      var wingA = p > 0.5 ? 0.2 : 0.24;
      ctx.fillStyle = 'rgba(238,247,236,' + wingA + ')';
      ctx.strokeStyle = 'rgba(255,251,240,0.38)';
      ctx.lineWidth = 0.35;
      for (var side = -1; side <= 1; side += 2) {
        for (var pair = 0; pair < 2; pair++) {
          ctx.save();
          ctx.translate(side * 1.2, -pair * 0.2);
          ctx.rotate(side * (0.5 + pair * 0.22));
          ctx.scale(flap, 1);
          ctx.beginPath();
          ctx.ellipse(pair === 0 ? 4.4 : 5.4, 0, pair === 0 ? 5.6 : 6.2, 1.15, 0, 0, TAU);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

      // abdomen (warm copper at dusk)
      var warm = d.golden > 0.5 ? 1 : 0;
      ctx.strokeStyle = warm
        ? 'rgba(' + (168 + Math.round(p * 30)) + ',108,58,0.92)'
        : 'rgba(72,96,66,0.92)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-11, 0.8);
      ctx.stroke();
      ctx.lineWidth = 1.1;
      for (var seg = 0; seg < 4; seg++) {
        ctx.strokeStyle = warm && seg % 2 === 0 ? 'rgba(228,166,92,0.65)' : 'rgba(38,52,40,0.5)';
        ctx.beginPath();
        ctx.moveTo(-3 - seg * 2, -0.1);
        ctx.lineTo(-3.2 - seg * 2, 1.6);
        ctx.stroke();
      }
      // thorax + head
      ctx.fillStyle = warm ? 'rgba(120,86,50,0.95)' : 'rgba(46,66,50,0.95)';
      ctx.beginPath();
      ctx.ellipse(1.6, 0, 2.6, 2.1, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(4.4, -0.1, 1.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,236,190,0.35)';
      ctx.beginPath();
      ctx.arc(4.8, -0.6, 0.55, 0, TAU);
      ctx.fill();
      // golden glint at sunset
      if (p > 0.35) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,214,150,' + (0.12 + p * 0.2) + ')';
        ctx.beginPath();
        ctx.ellipse(-5, 0.4, 9, 2.2, 0, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  };

  RiceScene.prototype._drawFrontMotes = function (ctx, t, p, frenzy) {
    var W = this.W, H = this.H, u = this.u;
    var wind = this.wind;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.dustFront.length; i++) {
      var d = this.dustFront[i];
      var tw = 0.45 + 0.55 * Math.sin(t * d.sp + d.ph);
      if (tw < 0.08) continue;
      var x = mod(d.x + t * (d.dx * 0.55 + wind * 18) + Math.sin(t * 0.33 + d.ph) * 14 + this._pointerX * 10, W + 30) - 15;
      var y = d.y + Math.sin(t * 0.27 + d.ph) * d.dy;
      var s = d.s * 7 * u;
      ctx.globalAlpha = d.a * tw * (0.75 + frenzy * 0.4);
      ctx.drawImage(this.dot, x - s * 0.5, y - s * 0.5, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  RiceScene.prototype._drawBokeh = function (ctx, t, p) {
    var u = this.u;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.bokehMotes.length; i++) {
      var b = this.bokehMotes[i];
      var x = b.x + Math.sin(t * b.sp + b.ph) * 30 * u + this._pointerX * 16;
      var y = b.y + Math.cos(t * b.sp * 0.8 + b.ph) * 12 * u;
      var s = b.s * (1 + 0.05 * Math.sin(t * 0.4 + b.ph));
      ctx.globalAlpha = b.a * (0.8 + p * 0.3);
      ctx.drawImage(this.bokeh, x - s * 0.5, y - s * 0.5, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  RiceScene.prototype._drawForeground = function (ctx, t, p) {
    var W = this.W, H = this.H;
    var swayL = Math.sin(t * 0.42) * 0.0035 + this.wind * 0.011;
    var swayR = Math.sin(t * 0.37 + 2.1) * 0.003 + this.wind * 0.009;

    ctx.save();
    ctx.translate(-W * 0.075 + this._pointerX * 12, H - this.fgLeft.h + H * 0.02 + this._pointerY * 7);
    ctx.rotate(swayL);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(this.fgLeft.c, 0, 0, this.fgLeft.w, this.fgLeft.h);
    ctx.restore();

    ctx.save();
    ctx.translate(W - this.fgRight.w + W * 0.075 + this._pointerX * -14, H - this.fgRight.h + H * 0.025 + this._pointerY * 6);
    ctx.rotate(swayR);
    ctx.globalAlpha = 0.76;
    ctx.drawImage(this.fgRight.c, 0, 0, this.fgRight.w, this.fgRight.h);
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  RiceScene.prototype._drawVignette = function (ctx, p) {
    var W = this.W, H = this.H;
    ctx.save();
    ctx.globalAlpha = 0.55 + p * 0.14;
    ctx.drawImage(this.vignette, 0, 0, W, H);
    ctx.restore();
    if (p > 0.02) {
      ctx.fillStyle = 'rgba(18,35,43,' + (0.05 * p) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    // subtle warm low light in the corners at dusk
    if (p > 0.25) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.05 * p;
      ctx.drawImage(this.sunBloom, -W * 0.15, H * 0.55, W * 0.55, H * 0.55);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  RiceScene.version = '3.0-rice';
  window.RiceScene = RiceScene;
})();
