/* ============================================================
   《穗浪》 — atmosphere & golden-hour scene renderer
   Pure procedural Canvas 2D. No images, no filters per frame.
   Classic script. Exposes window.HarvestScene.
   ============================================================ */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

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

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function mix(hexA, hexB, t) {
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' +
      Math.round(lerp(a[1], b[1], t)) + ',' +
      Math.round(lerp(a[2], b[2], t)) + ')';
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function makeSky(w, h, dusk) {
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, h);
    if (!dusk) {
      grad.addColorStop(0.00, '#5f7196');
      grad.addColorStop(0.22, '#8a8098');
      grad.addColorStop(0.40, '#c39687');
      grad.addColorStop(0.55, '#e6a87e');
      grad.addColorStop(0.70, '#f6c481');
      grad.addColorStop(0.84, '#fada9c');
      grad.addColorStop(1.00, '#f2c58b');
    } else {
      grad.addColorStop(0.00, '#303a5c');
      grad.addColorStop(0.22, '#5d5a78');
      grad.addColorStop(0.40, '#8d6a78');
      grad.addColorStop(0.56, '#bd7a6b');
      grad.addColorStop(0.72, '#e09364');
      grad.addColorStop(0.86, '#f0b478');
      grad.addColorStop(1.00, '#e5a06c');
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // broad luminous band around where the sun sits
    var warm = g.createRadialGradient(w * 0.73, h * 0.29, 0, w * 0.73, h * 0.29, h * 0.72);
    if (!dusk) {
      warm.addColorStop(0, 'rgba(255,244,208,.5)');
      warm.addColorStop(0.25, 'rgba(255,214,150,.22)');
      warm.addColorStop(0.7, 'rgba(255,190,120,0)');
    } else {
      warm.addColorStop(0, 'rgba(255,220,165,.38)');
      warm.addColorStop(0.3, 'rgba(255,170,110,.16)');
      warm.addColorStop(0.75, 'rgba(255,150,100,0)');
    }
    g.fillStyle = warm;
    g.fillRect(0, 0, w, h);

    // soft drifting sky bands
    g.globalAlpha = 0.07;
    for (var i = 0; i < 3; i++) {
      var y = h * (0.35 + i * 0.14);
      var band = g.createLinearGradient(0, y - h * 0.05, 0, y + h * 0.05);
      band.addColorStop(0, 'rgba(255,240,210,0)');
      band.addColorStop(0.5, dusk ? 'rgba(255,196,150,.9)' : 'rgba(255,238,200,.9)');
      band.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = band;
      g.fillRect(0, y - h * 0.05, w, h * 0.1);
    }
    return c;
  }

  function makeCloud(seed) {
    var w = 760, h = 300;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var rnd = mulberry32(seed);
    g.filter = 'blur(6px)';
    for (var i = 0; i < 12; i++) {
      var x = w * (0.17 + rnd() * 0.66);
      var y = h * (0.5 + (rnd() - 0.5) * 0.18);
      var rx = w * (0.075 + rnd() * 0.115);
      var ry = rx * (0.34 + rnd() * 0.18);
      var rg = g.createLinearGradient(0, y - ry, 0, y + ry);
      var a = 0.5 + rnd() * 0.28;
      rg.addColorStop(0, 'rgba(255,250,234,' + a + ')');
      rg.addColorStop(0.52, 'rgba(255,231,205,' + a * 0.62 + ')');
      rg.addColorStop(1, 'rgba(204,150,133,' + a * 0.15 + ')');
      g.fillStyle = rg;
      g.beginPath();
      g.ellipse(x, y, rx, ry, (rnd() - 0.5) * 0.14, 0, TAU);
      g.fill();
    }
    // small bright crowns
    for (var j = 0; j < 6; j++) {
      var cx = w * (0.24 + rnd() * 0.52);
      var cy = h * (0.36 + rnd() * 0.12);
      var cr = w * (0.025 + rnd() * 0.045);
      var cg = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
      cg.addColorStop(0, 'rgba(255,252,240,.5)');
      cg.addColorStop(1, 'rgba(255,245,224,0)');
      g.fillStyle = cg;
      g.beginPath();
      g.ellipse(cx, cy, cr, cr * 0.5, 0, 0, TAU);
      g.fill();
    }
    // warm underlight
    g.filter = 'blur(9px)';
    for (var k = 0; k < 5; k++) {
      var ux = w * (0.22 + rnd() * 0.56);
      var uy = h * (0.7 + rnd() * 0.05);
      var ur = w * (0.05 + rnd() * 0.08);
      var ug = g.createRadialGradient(ux, uy, 0, ux, uy, ur);
      ug.addColorStop(0, 'rgba(255,205,158,.16)');
      ug.addColorStop(1, 'rgba(255,205,158,0)');
      g.fillStyle = ug;
      g.beginPath();
      g.ellipse(ux, uy, ur, ur * 0.4, 0, 0, TAU);
      g.fill();
    }
    g.filter = 'none';
    return c;
  }

  function makeDotSprite(size, r, g2, b) {
    var c = makeCanvas(size, size), g = c.getContext('2d');
    var gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, 'rgba(' + r + ',' + g2 + ',' + b + ',1)');
    gr.addColorStop(0.22, 'rgba(' + r + ',' + g2 + ',' + b + ',0.55)');
    gr.addColorStop(0.55, 'rgba(' + r + ',' + g2 + ',' + b + ',0.13)');
    gr.addColorStop(1, 'rgba(' + r + ',' + g2 + ',' + b + ',0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function makeRadialSprite(size, stops) {
    var c = makeCanvas(size, size), g = c.getContext('2d');
    var gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function makeMidfield(w, h) {
    var bandH = h * 0.23;
    var c = makeCanvas(w + 60, bandH), g = c.getContext('2d');
    var rnd = mulberry32(90210);
    var count = Math.round(w * 1.1);
    for (var i = 0; i < count; i++) {
      var x = rnd() * (w + 60);
      var depth = Math.pow(rnd(), 0.7);
      var y = bandH * (0.16 + depth * 0.82);
      var len = (10 + depth * 30) * (h / 900) * (0.7 + rnd() * 0.7);
      var lean = (rnd() - 0.5) * 4;
      var a = 0.1 + depth * 0.3;
      var hue = rnd();
      g.strokeStyle = hue > 0.78
        ? 'rgba(221,178,95,' + (a * 1.25) + ')'
        : 'rgba(' + (92 + Math.floor(rnd() * 40)) + ',' + (65 + Math.floor(rnd() * 30)) + ',28,' + a + ')';
      g.lineWidth = 0.7 + depth * 1.1;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + lean * 0.4, y - len * 0.6, x + lean, y - len);
      g.stroke();
      if (rnd() > 0.35) {
        g.strokeStyle = 'rgba(231,190,116,' + (a * 1.35) + ')';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(x + lean, y - len);
        g.lineTo(x + lean + (rnd() - 0.5) * 4, y - len - (2 + rnd() * 4));
        g.stroke();
      }
    }
    // fade the top edge into haze
    var fade = g.createLinearGradient(0, 0, 0, bandH);
    fade.addColorStop(0, 'rgba(246,200,140,.34)');
    fade.addColorStop(0.28, 'rgba(246,200,140,0)');
    fade.addColorStop(1, 'rgba(60,36,14,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w + 60, bandH);
    return c;
  }

  function makeForeground(w, h, seed, flip) {
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var rnd = mulberry32(seed);
    g.translate(flip ? w : 0, h);
    g.scale(flip ? -1 : 1, 1);
    g.lineCap = 'round';
    g.filter = 'blur(2.4px)';

    var stems = 4;
    for (var i = 0; i < stems; i++) {
      var bx = w * (0.16 + (i / (stems - 1)) * 0.68 + (rnd() - 0.5) * 0.09);
      var by = 8 + rnd() * 12;
      var len = h * (0.55 + rnd() * 0.36);
      var bend = (rnd() - 0.5) * w * 0.34 + (i < 2 ? -w * 0.06 : w * 0.05);
      var tipX = bx + bend;
      var tipY = by - len;

      // dark stem silhouette
      g.strokeStyle = 'rgba(28,15,6,.92)';
      g.lineWidth = 7 + rnd() * 5;
      g.beginPath();
      g.moveTo(bx, by);
      g.bezierCurveTo(bx + bend * 0.15, by - len * 0.35, tipX - bend * 0.12, tipY + len * 0.28, tipX, tipY);
      g.stroke();

      // two heavy leaves
      for (var lf = 0; lf < 2; lf++) {
        var t = 0.32 + lf * 0.3 + rnd() * 0.08;
        var mt = 1 - t;
        var lx = mt * mt * mt * bx + 3 * mt * mt * t * (bx + bend * 0.15) +
          3 * mt * t * t * (tipX - bend * 0.12) + t * t * t * tipX;
        var ly = mt * mt * mt * by + 3 * mt * mt * t * (by - len * 0.35) +
          3 * mt * t * t * (tipY + len * 0.28) + t * t * t * tipY;
        var dir = lf === 0 ? -1 : 1;
        var leafLen = len * (0.22 + rnd() * 0.12);
        g.fillStyle = 'rgba(30,17,7,.9)';
        g.beginPath();
        g.moveTo(lx, ly);
        g.quadraticCurveTo(lx + dir * leafLen * 0.7, ly - leafLen * 0.2,
          lx + dir * leafLen, ly - leafLen * 0.85);
        g.quadraticCurveTo(lx + dir * leafLen * 0.32, ly - leafLen * 0.6, lx, ly);
        g.fill();
      }

      // grain head
      g.fillStyle = 'rgba(27,14,5,.94)';
      g.beginPath();
      g.ellipse(tipX, tipY + 26, 9, 33, -0.12 + (rnd() - 0.5) * 0.14, 0, TAU);
      g.fill();
      // grain lobes
      for (var k = 0; k < 8; k++) {
        var gy = tipY + 6 + k * 7.4;
        var gx = tipX + Math.sin(k * 0.8) * 2.2;
        g.beginPath();
        g.ellipse(gx, gy, 5.2, 3.6, 0.3, 0, TAU);
        g.fill();
      }
      // long awns
      g.strokeStyle = 'rgba(26,14,5,.9)';
      for (var a = 0; a < 9; a++) {
        var ay = tipY + 4 + a * 7;
        var ax = tipX + (a - 4) * 1.1;
        g.lineWidth = 1.1 + rnd() * 1.5;
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(ax + 12 + rnd() * 26, ay - 18 - rnd() * 30);
        g.stroke();
      }

      // a whisper of warm rim light along the outer edge
      if (rnd() > 0.25) {
        g.strokeStyle = 'rgba(255,188,104,.12)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(bx + 2, by - 24);
        g.bezierCurveTo(bx + bend * 0.15 + 2, by - len * 0.35,
          tipX - bend * 0.12 + 2, tipY + len * 0.28, tipX + 2, tipY + 22);
        g.stroke();
      }
    }
    g.filter = 'none';
    return c;
  }

  function HarvestScene() {
    this.W = 1; this.H = 1; this.u = 1; this.horizon = 0;
    this.time = 0;
    this.clouds = [];
    this.birds = [];
    this.dust = [];
    this.bokeh = [];
    this.midSparkles = [];
    this.streaks = [];
    this.fireflies = [];
    this.skyStart = null; this.skyDusk = null;
    this.mountains = null;
    this.midfield = null;
    this.fgL = null; this.fgR = null;
    this.dot = makeDotSprite(32, 255, 236, 190);
    this.dotGold = makeDotSprite(64, 255, 203, 105);
    this.bokehSprite = makeDotSprite(128, 255, 222, 168);
    this.sunGlow = makeRadialSprite(512, [
      [0, 'rgba(255,249,222,.95)'],
      [0.16, 'rgba(255,235,185,.5)'],
      [0.38, 'rgba(255,211,137,.16)'],
      [0.7, 'rgba(255,186,100,.035)'],
      [1, 'rgba(255,176,90,0)']
    ]);
    this.sunBloom = makeRadialSprite(512, [
      [0, 'rgba(255,231,174,.26)'],
      [0.45, 'rgba(255,197,120,.08)'],
      [1, 'rgba(255,176,90,0)']
    ]);
    this.veilSprite = makeRadialSprite(512, [
      [0, 'rgba(255,228,190,.38)'],
      [0.5, 'rgba(255,206,158,.16)'],
      [1, 'rgba(255,190,140,0)']
    ]);
    this.cloudSprites = [makeCloud(11), makeCloud(37), makeCloud(73), makeCloud(129)];
  }

  HarvestScene.prototype.resize = function (w, h, dpr) {
    this.W = w; this.H = h; this.dpr = dpr || 1;
    this.u = h / 900;
    this.horizon = Math.round(h * 0.46);

    this.skyStart = makeSky(w * 0.5, h * 0.5, false);
    this.skyDusk = makeSky(w * 0.5, h * 0.5, true);

    this.midfield = makeMidfield(w, h);
    var fw = Math.min(w * 0.31, 510 * this.u);
    var fh = Math.min(h * 0.48, 500 * this.u);
    this.fgL = makeForeground(fw, fh, 991, false);
    this.fgR = makeForeground(fw * 1.02, fh * 0.94, 424, true);
    this.fgLW = fw; this.fgLH = fh; this.fgRW = fw * 1.02; this.fgRH = fh * 0.94;

    // mountains, three hazy ridges
    this.mountains = [];
    var seeds = [3.1, 7.7, 12.3];
    var amps = [0.075, 0.058, 0.038];
    var bases = [0.036, 0.022, 0.01];
    for (var L = 0; L < 3; L++) {
      var pts = [];
      var n = Math.max(30, Math.round(w / 26));
      var rnd = mulberry32(800 + L * 111);
      var p0 = rnd() * TAU, p1 = rnd() * TAU, p2 = rnd() * TAU, p3 = rnd() * TAU;
      for (var i = 0; i <= n; i++) {
        var t = i / n;
        var v = 0.52 * Math.sin(t * 6.2 + p0) + 0.27 * Math.sin(t * 13.7 + p1) +
          0.14 * Math.sin(t * 27.1 + p2) + 0.07 * Math.sin(t * 51 + p3);
        v = (v + 1) * 0.5;
        v = Math.pow(clamp(v, 0, 1), 1.35);
        pts.push({
          x: t * w,
          y: this.horizon - bases[L] * h - v * amps[L] * h
        });
      }
      this.mountains.push({ pts: pts, layer: L });
    }

    // clouds
    this.clouds = [];
    var defs = [
      { x: 0.43, y: 0.13, s: 0.6, a: 0.12, v: 1.4, sp: 0 },
      { x: 0.76, y: 0.065, s: 0.5, a: 0.1, v: 1.8, sp: 1 },
      { x: 0.9, y: 0.27, s: 0.62, a: 0.08, v: 1.2, sp: 2 }
    ];
    for (var cdef = 0; cdef < defs.length; cdef++) {
      var d = defs[cdef];
      d.w = Math.max(300, w * 0.34 * d.s);
      d.h = d.w * (300 / 760);
      this.clouds.push(d);
    }

    // birds
    this.birds = [];
    var flocks = [[0.1, 0.24, 18, 1], [0.55, 0.15, 13, 1], [0.3, 0.34, 22, -1]];
    for (var f = 0; f < flocks.length; f++) {
      var fl = flocks[f];
      var members = [];
      var mCount = 5 + (f % 3);
      for (var m = 0; m < mCount; m++) {
        members.push({
          dx: (m - mCount / 2) * (16 + f * 4) + (m % 2) * 5,
          dy: Math.abs(m - mCount / 2) * 8 + (m % 2) * 3,
          ph: Math.random() * TAU,
          sz: 0.7 + Math.random() * 0.6
        });
      }
      this.birds.push({
        x: fl[0] * w, y: fl[1] * h,
        vx: fl[2] * (w / 1600) * (fl[3] > 0 ? 1 : 1) * fl[3],
        alpha: 0.35, members: members, speed: 13 + f * 4
      });
    }

    // dust motes & bokeh
    var rnd2 = mulberry32(5150);
    this.dust = [];
    for (var dI = 0; dI < 92; dI++) {
      var front = dI < 34;
      this.dust.push({
        x: rnd2() * w,
        y: this.horizon * 0.1 + rnd2() * h * 0.95,
        s: front ? 2 + rnd2() * 4 : 0.9 + rnd2() * 1.8,
        a: front ? 0.18 + rnd2() * 0.32 : 0.1 + rnd2() * 0.16,
        vx: (4 + rnd2() * 13) * (rnd2() > 0.5 ? 1 : -1),
        vy: -1 - rnd2() * 4,
        ph: rnd2() * TAU,
        tw: 0.5 + rnd2() * 1.6,
        depth: rnd2(),
        front: front
      });
    }
    this.bokeh = [];
    for (var bI = 0; bI < 7; bI++) {
      this.bokeh.push({
        x: rnd2() * w, y: this.horizon + rnd2() * h * 0.4,
        s: 26 + rnd2() * 90, a: 0.03 + rnd2() * 0.055,
        vx: 2 + rnd2() * 5, ph: rnd2() * TAU
      });
    }

    this.midSparkles = [];
    var rnd3 = mulberry32(661);
    for (var sI = 0; sI < 120; sI++) {
      this.midSparkles.push({
        x: rnd3() * w,
        y: this.horizon - h * 0.02 + rnd3() * h * 0.2,
        s: 1 + rnd3() * 2.2,
        ph: rnd3() * TAU,
        sp: 0.7 + rnd3() * 1.8
      });
    }
    this.streaks = [];
    this.fireflies = [];
  };

  HarvestScene.prototype.sunPos = function (progress) {
    var p = smooth(progress);
    return {
      x: this.W * 0.735,
      y: lerp(this.H * 0.255, this.H * 0.405, p),
      r: this.H * 0.066 * (1 - p * 0.1)
    };
  };

  HarvestScene.prototype.update = function (dt, time, env) {
    this.time = time;
    env = env || {};
    var wind = env.wind || 0;
    var gust = env.gust || 0;
    var W = this.W, H = this.H;

    for (var i = 0; i < this.clouds.length; i++) {
      var cl = this.clouds[i];
      cl.x += dt * cl.v * 4.6 / W;
      if (cl.x > 1.35) cl.x = -0.35;
    }

    for (var b = 0; b < this.birds.length; b++) {
      var bird = this.birds[b];
      bird.x += bird.vx * dt * (1 + gust * 0.35);
      if (bird.vx > 0 && bird.x > W + 250) {
        bird.x = -250; bird.y = H * (0.1 + Math.random() * 0.25);
      } else if (bird.vx < 0 && bird.x < -250) {
        bird.x = W + 250; bird.y = H * (0.1 + Math.random() * 0.25);
      }
    }

    for (var d = 0; d < this.dust.length; d++) {
      var p = this.dust[d];
      p.x += (p.vx + wind * (14 + p.depth * 34)) * dt;
      p.y += (p.vy + Math.sin(time * 0.4 + p.ph) * 2.2) * dt;
      if (p.x > W + 20) p.x = -20;
      if (p.x < -20) p.x = W + 20;
      if (p.y < H * 0.08) p.y = H * 0.1;
      if (p.y > H + 20) p.y = this.horizon;
    }

    for (var bk = 0; bk < this.bokeh.length; bk++) {
      var bo = this.bokeh[bk];
      bo.x += bo.vx * dt * (1 + wind);
      if (bo.x > W + bo.s) bo.x = -bo.s;
    }

    // wind-drawn silk streaks
    if (gust > 0.22 && Math.random() < gust * dt * 2.4 && this.streaks.length < 8) {
      this.streaks.push({
        x: -Math.random() * W * 0.3,
        y: this.horizon * 0.72 + Math.random() * H * 0.36,
        len: W * (0.08 + Math.random() * 0.15),
        sp: (0.5 + Math.random() * 0.8) * (700 + 500 * gust) * this.u,
        a: 0.12 + Math.random() * 0.18,
        ph: Math.random() * TAU,
        life: 0,
        max: 2.4 + Math.random() * 2.2,
        curve: (Math.random() - 0.5) * 26
      });
    }
    for (var st = this.streaks.length - 1; st >= 0; st--) {
      var s = this.streaks[st];
      s.life += dt;
      s.x += s.sp * dt * (wind >= 0 ? 1 : -1) * 0.25;
      if (s.life > s.max || s.x > W + s.len) this.streaks.splice(st, 1);
    }

    // fireflies for frenzy and dusk
    var wantFire = env.frenzy > 0.15 || (env.progress || 0) > 0.78;
    if (wantFire && this.fireflies.length < 26 && Math.random() < dt * 9) {
      this.fireflies.push({
        x: Math.random() * W,
        y: this.horizon + Math.random() * H * 0.5,
        vx: (Math.random() - 0.5) * 12,
        vy: -6 - Math.random() * 14,
        ph: Math.random() * TAU,
        life: 0,
        max: 3 + Math.random() * 5,
        s: 2 + Math.random() * 4
      });
    }
    for (var ff = this.fireflies.length - 1; ff >= 0; ff--) {
      var f = this.fireflies[ff];
      f.life += dt;
      f.x += (f.vx + wind * 16) * dt;
      f.y += f.vy * dt;
      if (f.life > f.max || f.y < this.horizon * 0.8) this.fireflies.splice(ff, 1);
    }
  };

  HarvestScene.prototype.drawBack = function (ctx, env) {
    env = env || {};
    var W = this.W, H = this.H, u = this.u;
    var progress = clamp(env.progress || 0, 0, 1);
    var frenzy = clamp(env.frenzy || 0, 0, 1);
    var time = this.time;
    var sun = this.sunPos(progress);

    ctx.drawImage(this.skyStart, 0, 0, W, H);
    var duskAlpha = smooth(progress * 1.08);
    if (duskAlpha > 0.002) {
      ctx.globalAlpha = duskAlpha;
      ctx.drawImage(this.skyDusk, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // sun glow & disc
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var glowSize = sun.r * (10.4 + frenzy * 4.2);
    ctx.globalAlpha = 0.68 + frenzy * 0.2;
    ctx.drawImage(this.sunGlow, sun.x - glowSize / 2, sun.y - glowSize / 2, glowSize, glowSize);
    var hot = sun.r * 3.0;
    ctx.globalAlpha = 0.58;
    ctx.drawImage(this.sunGlow, sun.x - hot / 2, sun.y - hot / 2, hot, hot);
    var bloom = sun.r * 13;
    ctx.globalAlpha = 0.24 + frenzy * 0.25;
    ctx.drawImage(this.sunBloom, sun.x - bloom / 2, sun.y - bloom / 2, bloom, bloom);

    // thin, restrained anamorphic flare
    var flW = W * 0.4;
    var fl = ctx.createLinearGradient(sun.x - flW, 0, sun.x + flW, 0);
    fl.addColorStop(0, 'rgba(255,220,160,0)');
    fl.addColorStop(0.5, 'rgba(255,233,185,' + (0.05 + frenzy * 0.1) + ')');
    fl.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = fl;
    ctx.fillRect(sun.x - flW, sun.y - sun.r * 0.1, flW * 2, sun.r * 0.2);
    ctx.restore();

    // sun disc — warm, not a white headlight
    var discR = sun.r * 0.94;
    var disc = ctx.createRadialGradient(sun.x - discR * 0.28, sun.y - discR * 0.32, 0, sun.x, sun.y, discR);
    disc.addColorStop(0, '#fff9e6');
    disc.addColorStop(0.42, mix('#ffedc0', '#ffdc9f', progress));
    disc.addColorStop(0.8, mix('#ffd995', '#ffc176', progress));
    disc.addColorStop(1, mix('#ffc271', '#f2a45e', progress));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, discR, 0, TAU);
    ctx.fill();

    // thin sun veil
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.15;
    ctx.drawImage(this.veilSprite, sun.x - sun.r * 4.2, sun.y - sun.r * 0.72, sun.r * 8.4, sun.r * 1.55);
    ctx.restore();

    // clouds (drift in front of the sun, veil it)
    for (var ci = 0; ci < this.clouds.length; ci++) {
      var c = this.clouds[ci];
      var cx = c.x * W - c.w / 2;
      var cy = c.y * H;
      ctx.globalAlpha = c.a * (0.85 + progress * 0.2);
      ctx.drawImage(this.cloudSprites[c.sp], cx, cy, c.w, c.h);
    }
    ctx.globalAlpha = 1;

    // distant birds
    var birdAlpha = 0.34 * (1 - progress * 0.55);
    if (birdAlpha > 0.01) {
      ctx.save();
      ctx.strokeStyle = 'rgba(54,33,26,' + birdAlpha + ')';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      for (var bi = 0; bi < this.birds.length; bi++) {
        var bd = this.birds[bi];
        for (var mi = 0; mi < bd.members.length; mi++) {
          var m = bd.members[mi];
          var flap = Math.sin(time * 5.2 + m.ph) * 2.4;
          var bx = bd.x + m.dx;
          var by = bd.y + m.dy;
          var sz = m.sz * (12 + this.u * 5);
          ctx.beginPath();
          ctx.moveTo(bx - sz, by);
          ctx.quadraticCurveTo(bx - sz * 0.4, by - flap, bx, by);
          ctx.quadraticCurveTo(bx + sz * 0.4, by - flap, bx + sz, by);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // mountains
    var farCols = [
      ['#c79580', '#a17766'],
      ['#9f7c61', '#7a5f4a'],
      ['#6f5a3d', '#4d3e2b']
    ];
    var duskCols = [
      ['#8a6c74', '#63525f'],
      ['#6b5660', '#4a3e4b'],
      ['#453a37', '#302b2c']
    ];
    for (var L = 0; L < 3; L++) {
      var layer = this.mountains[L];
      var colTop = mix(farCols[L][0], duskCols[L][0], progress);
      var colBot = mix(farCols[L][1], duskCols[L][1], progress);
      var grad = ctx.createLinearGradient(0, this.horizon - H * 0.09, 0, this.horizon + H * 0.03);
      grad.addColorStop(0, colTop);
      grad.addColorStop(1, colBot);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, this.horizon + 10);
      for (var pi = 0; pi < layer.pts.length; pi++) {
        var pt = layer.pts[pi];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.lineTo(W, this.horizon + 10);
      ctx.closePath();
      ctx.fill();

      // atmospheric haze over the ridge feet
      var hz = ctx.createLinearGradient(0, this.horizon - H * 0.05, 0, this.horizon + H * 0.022);
      hz.addColorStop(0, 'rgba(255,208,160,0)');
      hz.addColorStop(0.65, 'rgba(255,208,160,' + (0.06 - L * 0.012) + ')');
      hz.addColorStop(1, 'rgba(255,208,160,0)');
      ctx.fillStyle = hz;
      ctx.fillRect(0, this.horizon - H * 0.06, W, H * 0.1);
    }

    // horizon haze band
    var haze = ctx.createLinearGradient(0, this.horizon - H * 0.045, 0, this.horizon + H * 0.085);
    haze.addColorStop(0, 'rgba(255,215,165,0)');
    haze.addColorStop(0.55, 'rgba(255,206,150,.2)');
    haze.addColorStop(1, 'rgba(245,180,115,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, this.horizon - H * 0.05, W, H * 0.15);

    // ground bed
    var ground = ctx.createLinearGradient(0, this.horizon - 2, 0, H);
    ground.addColorStop(0, mix('#d39a55', '#a56d4a', progress));
    ground.addColorStop(0.18, mix('#b37b37', '#84583c', progress));
    ground.addColorStop(0.55, mix('#815322', '#5e3d24', progress));
    ground.addColorStop(1, mix('#4a2d12', '#2f2016', progress));
    ctx.fillStyle = ground;
    ctx.fillRect(0, this.horizon - 2, W, H - this.horizon + 2);

    // broad sunlight wash across the field
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var wash = ctx.createRadialGradient(W * 0.78, this.horizon + H * 0.06, 0, W * 0.78, this.horizon + H * 0.14, W * 0.62);
    wash.addColorStop(0, 'rgba(255,206,130,.17)');
    wash.addColorStop(0.4, 'rgba(255,190,110,.07)');
    wash.addColorStop(1, 'rgba(255,180,100,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, this.horizon, W, H - this.horizon);
    ctx.restore();

    // barn, trees, fence — small warm life at the horizon
    this.drawHomestead(ctx, progress, time);

    // distant wheat field (non-interactive)
    var midX = -30 + Math.sin(time * 0.16) * (2 + (env.gust || 0) * 4) * u + (env.pointer ? (env.pointer.x / W - 0.5) * -6 : 0);
    var midY = this.horizon - this.midfield.height * 0.15;
    ctx.drawImage(this.midfield, midX, midY);

    // wheat-field sparkle
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var si = 0; si < this.midSparkles.length; si++) {
      var sp = this.midSparkles[si];
      var tw = 0.45 + 0.55 * Math.sin(time * sp.sp + sp.ph);
      tw = Math.max(0, tw);
      if (tw < 0.2) continue;
      var sx = midX + sp.x + 30;
      var sy = midY + (sp.y - (this.horizon - this.H * 0.02)) + this.midfield.height * 0.15;
      ctx.globalAlpha = tw * 0.22;
      ctx.drawImage(this.dot, sx - sp.s * 2, sy - sp.s * 2, sp.s * 4, sp.s * 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // back dust
    this.drawDust(ctx, false);

    // soft ground contact shading
    var footShade = ctx.createLinearGradient(0, H * 0.9, 0, H);
    footShade.addColorStop(0, 'rgba(20,10,3,0)');
    footShade.addColorStop(1, 'rgba(20,10,3,.28)');
    ctx.fillStyle = footShade;
    ctx.fillRect(0, H * 0.9, W, H * 0.1);
  };

  HarvestScene.prototype.drawHomestead = function (ctx, progress, time) {
    var u = this.u;
    var W = this.W, H = this.H;
    var x = W * 0.158;
    var y = this.horizon + 2;
    var alpha = 0.74 - progress * 0.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(u * 0.9, u * 0.9);

    // trees
    ctx.fillStyle = 'rgba(52,35,22,' + (alpha * 0.85) + ')';
    function tree(tx, ty, s) {
      ctx.fillRect(tx - 1.5 * s, ty - 30 * s, 3 * s, 30 * s);
      ctx.beginPath();
      ctx.ellipse(tx, ty - 44 * s, 17 * s, 13 * s, -0.12, 0, TAU);
      ctx.ellipse(tx - 13 * s, ty - 36 * s, 12 * s, 10 * s, 0.2, 0, TAU);
      ctx.ellipse(tx + 13 * s, ty - 38 * s, 13 * s, 10 * s, -0.2, 0, TAU);
      ctx.fill();
    }
    tree(-70, 4, 1.05);
    tree(74, 2, 0.72);

    // barn
    ctx.fillStyle = 'rgba(58,38,23,' + alpha + ')';
    ctx.beginPath();
    ctx.moveTo(-36, 0);
    ctx.lineTo(-36, -34);
    ctx.lineTo(0, -56);
    ctx.lineTo(36, -34);
    ctx.lineTo(36, 0);
    ctx.closePath();
    ctx.fill();
    // roof line
    ctx.strokeStyle = 'rgba(255,206,150,' + (alpha * 0.22) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-39, -32);
    ctx.lineTo(0, -57);
    ctx.lineTo(39, -32);
    ctx.stroke();
    // chimney
    ctx.fillStyle = 'rgba(52,33,20,' + alpha + ')';
    ctx.fillRect(21, -67, 8, 15);
    // door
    ctx.fillStyle = 'rgba(30,18,10,' + (alpha * 0.9) + ')';
    ctx.fillRect(-7, -24, 14, 24);
    // window with warm light
    var glowPulse = 0.7 + 0.3 * Math.sin(time * 1.7);
    ctx.fillStyle = 'rgba(255,212,140,' + (alpha * 0.85) + ')';
    ctx.fillRect(15, -28, 8, 7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var wg = ctx.createRadialGradient(19, -25, 0, 19, -25, 26);
    wg.addColorStop(0, 'rgba(255,206,120,' + (0.22 * glowPulse) + ')');
    wg.addColorStop(1, 'rgba(255,206,120,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(-7, -51, 52, 52);
    ctx.restore();

    // smoke curls
    for (var s = 0; s < 4; s++) {
      var t = ((time * 0.055 + s * 0.27) % 1);
      var sx = 25 + Math.sin(t * 7 + s) * 5;
      var sy = -70 - t * 58;
      var sr = 2.5 + t * 9;
      ctx.fillStyle = 'rgba(218,198,180,' + ((1 - t) * 0.16) + ')';
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, TAU);
      ctx.fill();
    }

    // hay bales & fence
    ctx.fillStyle = 'rgba(70,46,25,' + (alpha * 0.8) + ')';
    ctx.beginPath(); ctx.ellipse(56, -8, 13, 7, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(112, -4, 9, 5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(55,36,21,' + (alpha * 0.55) + ')';
    ctx.lineWidth = 1;
    for (var f = 0; f < 7; f++) {
      var fx = 44 + f * 13;
      ctx.beginPath();
      ctx.moveTo(fx, -3);
      ctx.lineTo(fx, -17);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(44, -13);
    ctx.lineTo(140, -10);
    ctx.stroke();

    ctx.restore();
  };

  HarvestScene.prototype.drawDust = function (ctx, front) {
    var t = this.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.dust.length; i++) {
      var p = this.dust[i];
      if (p.front !== front) continue;
      var tw = 0.55 + 0.45 * Math.sin(t * p.tw + p.ph);
      ctx.globalAlpha = p.a * tw;
      var s = p.s * (p.front ? 6 : 4) * this.u;
      ctx.drawImage(this.dot, p.x - s / 2, p.y - s / 2, s, s);
    }
    if (front) {
      for (var b = 0; b < this.bokeh.length; b++) {
        var bo = this.bokeh[b];
        ctx.globalAlpha = bo.a * (0.7 + 0.3 * Math.sin(t * 0.6 + bo.ph));
        var bs = bo.s * this.u;
        ctx.drawImage(this.bokehSprite, bo.x - bs / 2, bo.y - bs / 2, bs, bs);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  HarvestScene.prototype.drawFront = function (ctx, env) {
    env = env || {};
    var W = this.W, H = this.H, u = this.u, t = this.time;
    var wind = env.wind || 0;
    var progress = clamp(env.progress || 0, 0, 1);
    var frenzy = clamp(env.frenzy || 0, 0, 1);
    var pointer = env.pointer || { x: W / 2, y: H / 2 };
    var px = (pointer.x / W - 0.5);
    var py = (pointer.y / H - 0.5);

    // foreground framing wheat
    ctx.save();
    ctx.translate(-58 * u + px * 10, H - this.fgLH + 16 * u + py * 4);
    ctx.rotate(wind * 0.003);
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this.fgL, 0, 0, this.fgLW, this.fgLH);
    ctx.restore();
    ctx.save();
    ctx.translate(W - this.fgRW + 54 * u + px * 14, H - this.fgRH + 18 * u + py * 5);
    ctx.rotate(-wind * 0.004);
    ctx.globalAlpha = 0.56;
    ctx.drawImage(this.fgR, 0, 0, this.fgRW, this.fgRH);
    ctx.restore();

    // wind silk
    if (this.streaks.length) {
      ctx.save();
      ctx.lineCap = 'round';
      for (var i = 0; i < this.streaks.length; i++) {
        var s = this.streaks[i];
        var fade = Math.sin(Math.min(1, s.life / s.max) * Math.PI);
        if (fade <= 0) continue;
        var grad = ctx.createLinearGradient(s.x, s.y, s.x + s.len, s.y);
        grad.addColorStop(0, 'rgba(255,240,205,0)');
        grad.addColorStop(0.45, 'rgba(255,240,205,' + (s.a * fade * 0.45) + ')');
        grad.addColorStop(1, 'rgba(255,240,205,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1 + this.u;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(s.x + s.len * 0.5, s.y + s.curve, s.x + s.len, s.y + Math.sin(t * 2 + s.ph) * 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    // god rays
    this.drawRays(ctx, progress, frenzy);

    // fireflies
    if (this.fireflies.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var f = 0; f < this.fireflies.length; f++) {
        var ff = this.fireflies[f];
        var lifeF = Math.sin(Math.min(1, ff.life / ff.max) * Math.PI);
        var blink = 0.45 + 0.55 * Math.sin(ff.life * 4.2 + ff.ph);
        var a = clamp(lifeF * blink, 0, 1) * 0.5;
        var sz = ff.s * this.u * (3.2 + blink);
        ctx.globalAlpha = a;
        ctx.drawImage(this.dotGold, ff.x - sz / 2, ff.y - sz / 2, sz, sz);
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = 'rgba(255,244,200,.9)';
        ctx.beginPath();
        ctx.arc(ff.x, ff.y, Math.max(0.7, ff.s * 0.22 * this.u), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // warm bloom wash (pre-rendered to keep the hot path cheap)
    var sun = this.sunPos(progress);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var bloomSize = W * 1.0;
    ctx.globalAlpha = 0.38 + frenzy * 0.3;
    ctx.drawImage(this.sunBloom, sun.x - bloomSize / 2, sun.y - bloomSize / 2, bloomSize, bloomSize);
    ctx.restore();

    // front dust
    this.drawDust(ctx, true);

    // small lens ghosts
    if (progress < 0.88) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var ghost = [
        { t: 0.3, s: 0.18, a: 0.026 },
        { t: 0.55, s: 0.11, a: 0.02 },
        { t: 0.82, s: 0.27, a: 0.018 }
      ];
      for (var gi = 0; gi < ghost.length; gi++) {
        var gg = ghost[gi];
        var gx = lerp(sun.x, W * 0.3, gg.t);
        var gy = lerp(sun.y, H * 0.56, gg.t);
        var grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, sun.r * gg.s * 10);
        grd.addColorStop(0, 'rgba(255,232,190,' + gg.a + ')');
        grd.addColorStop(0.6, 'rgba(255,210,160,' + gg.a * 0.35 + ')');
        grd.addColorStop(1, 'rgba(255,210,160,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(gx, gy, sun.r * gg.s * 10, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  HarvestScene.prototype.drawRays = function (ctx, progress, frenzy) {
    var sun = this.sunPos(progress);
    var intensity = (0.55 - progress * 0.22 + frenzy * 0.4);
    if (intensity <= 0.03) return;
    var W = this.W, H = this.H;
    var time = this.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 9; i++) {
      var base = Math.PI * 0.52 + i * 0.2;
      var ang = base + Math.sin(time * 0.07 + i * 1.37) * 0.045;
      var len = H * (0.75 + 0.25 * Math.sin(i * 2.1));
      var endX = sun.x + Math.cos(ang) * len;
      var endY = sun.y + Math.sin(ang) * len;
      var spread = sun.r * (0.16 + 0.42 * ((i * 37) % 10) / 10);
      var perp = ang + Math.PI / 2;
      var grad = ctx.createLinearGradient(sun.x, sun.y, endX, endY);
      grad.addColorStop(0, 'rgba(255,240,198,' + (0.075 * intensity) + ')');
      grad.addColorStop(0.35, 'rgba(255,224,165,' + (0.032 * intensity) + ')');
      grad.addColorStop(1, 'rgba(255,205,140,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sun.x + Math.cos(perp) * spread, sun.y + Math.sin(perp) * spread);
      ctx.lineTo(sun.x - Math.cos(perp) * spread, sun.y - Math.sin(perp) * spread);
      ctx.lineTo(endX - Math.cos(perp) * spread * 5, endY - Math.sin(perp) * spread * 5);
      ctx.lineTo(endX + Math.cos(perp) * spread * 5, endY + Math.sin(perp) * spread * 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  window.HarvestScene = HarvestScene;
})();
