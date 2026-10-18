/* ============================================================================
 * 《穗浪》 SUÌ LÀNG — 可交互麦田引擎
 * ----------------------------------------------------------------------------
 * 经典 script（非 ES module），暴露 window.WheatField。
 * 无内部 requestAnimationFrame / setTimeout —— 完全由主循环 update/draw 驱动。
 * 所有坐标为 CSS 像素；draw 收到的 ctx 已含 DPR / CSS 像素变换。
 *
 * 契约（DESIGN.md 5.2）：
 *   constructor()
 *   resize(width, height)                 // CSS px；内部 u = height / 900
 *   reset(seed)                           // 清空并按当前尺寸种满
 *   update(dt, time, env)                 // env: {wind,gust,pointer,frenzy,reduced}
 *   cut(x0,y0,x1,y1,speed,force)          // speed = CSS px/ms；返回本次事件数组
 *   drainEvents()                         // 返回并清空 outbox
 *   stormCut()                            // 1.1s 金风扫场（由 update 推进）
 *   draw(ctx, opts)                       // opts: {time, frenzy}
 *   getStats()                            // {uncut,total,golden}
 *   setGoldenBoost(mult)                  // 新株金色概率倍率（默认 1）
 *
 * 事件对象：{x, y, golden, scale, angle}
 *   x,y   = 麦穗端点（穗尖）CSS 像素
 *   angle = 穗轴相对竖直方向的世界倾角（弧度，顺时针为正）
 *
 * 额外便利（主程序可忽略）：
 *   getStormProgress() -> -1 | 0..1
 *   预览页可通过 field.regrowScale 调整重生时间（仅供 QA 加速验证）
 * ========================================================================== */
(function (global) {
  'use strict';

  var PI = Math.PI;
  var TAU = PI * 2;

  var STATE_STAND = 0;
  var STATE_FALL = 1;
  var STATE_STUB = 2;
  var STATE_GROW = 3;

  /* ---------------------------------------------------------------- 景深行 */
  /* weight 之和为 1，用来分配目标株数；t 为田野内部纵向深度 0..1。 */
  var ROWS = [
    { t: 0.010, scale: 0.26, weight: 0.100, haze: 0.72 },
    { t: 0.065, scale: 0.31, weight: 0.100, haze: 0.66 },
    { t: 0.132, scale: 0.37, weight: 0.100, haze: 0.59 },
    { t: 0.205, scale: 0.44, weight: 0.100, haze: 0.51 },
    { t: 0.305, scale: 0.52, weight: 0.105, haze: 0.41 },
    { t: 0.425, scale: 0.63, weight: 0.100, haze: 0.31 },
    { t: 0.555, scale: 0.78, weight: 0.095, haze: 0.21 },
    { t: 0.700, scale: 0.97, weight: 0.100, haze: 0.13 },
    { t: 0.845, scale: 1.18, weight: 0.100, haze: 0.06 },
    { t: 0.990, scale: 1.48, weight: 0.100, haze: 0.015 }
  ];

  var HAZE_TIERS = [0.0, 0.10, 0.24]; /* 近景 / 中景 / 远景的高光精灵色阶 */
  var HAZE_RGB = [220, 170, 102];

  /* 麦穗配色六变体：暗琥珀 → 暖金 → 米金（保留明确的暖金层次） */
  var HEAD_PAL = [
    { deep: '#74440f', mid: '#c48a2b', light: '#f0c46b', tip: '#ffe6a6', awn: '#e8c67f' },
    { deep: '#633a0b', mid: '#b17420', light: '#e2ac4c', tip: '#f8d98f', awn: '#dcb775' },
    { deep: '#8a551a', mid: '#d19a3c', light: '#f4cd7a', tip: '#ffe6ac', awn: '#eecd86' },
    { deep: '#94601f', mid: '#dfa844', light: '#f9d383', tip: '#ffebba', awn: '#f2d292' },
    { deep: '#6f430f', mid: '#bd8428', light: '#e9bd60', tip: '#ffe29c', awn: '#e3c078' },
    { deep: '#9c6520', mid: '#e0a947', light: '#fad586', tip: '#ffedc0', awn: '#f5d697' }
  ];
  var GOLD_PAL = {
    deep: '#c47a0c', mid: '#eda82b', light: '#ffd26a', tip: '#fff2c6', awn: '#ffe5a0'
  };

  var STEM_RGB = {
    dark: [78, 52, 18],
    mid: [116, 80, 28],
    light: [190, 142, 62]
  };
  var GOLD_STEM_RGB = {
    dark: [154, 96, 22],
    mid: [202, 143, 46],
    light: [255, 228, 148]
  };
  /* 叶片压向暗橄榄 */
  var LEAF_RGB = {
    base: [64, 52, 20],
    mid: [102, 78, 26],
    tip: [176, 136, 56]
  };

  /* 每行预生成的颜色（字符串复用，避免逐帧拼色） */
  var ROW_STYLES = ROWS.map(function (row) {
    var h = row.haze;
    var mixT = h * 0.55;
    return {
      alpha: 1 - h * 0.2,
      headTier: tierOf(h),
      leafTier: tierOf(h),
      stemDark: css(mixRgb(STEM_RGB.dark, HAZE_RGB, mixT)),
      stemMid: css(mixRgb(STEM_RGB.mid, HAZE_RGB, mixT * 0.92)),
      stemLight: css(mixRgb(STEM_RGB.light, HAZE_RGB, h * 0.42)),
      stubLight: css(mixRgb([206, 166, 98], HAZE_RGB, h * 0.5)),
      goldStemDark: css(mixRgb(GOLD_STEM_RGB.dark, HAZE_RGB, mixT)),
      goldStemMid: css(mixRgb(GOLD_STEM_RGB.mid, HAZE_RGB, mixT * 0.92)),
      goldStemLight: css(mixRgb(GOLD_STEM_RGB.light, HAZE_RGB, h * 0.36)),
      goldStubLight: css(mixRgb([255, 240, 190], HAZE_RGB, h * 0.4)),
      shadowAlpha: 0.030 + 0.26 * (1 - h) * (1 - h)
    };
  });

  /* 矢量麦穗的 6 种形态与 3 档空气透视配色 */
  var HEAD_SHAPES = [
    { bend: -0.55, width: 1.00, awn: 1.00 },
    { bend: 0.42, width: 0.94, awn: 1.12 },
    { bend: -0.30, width: 1.06, awn: 0.92 },
    { bend: 0.58, width: 0.97, awn: 1.05 },
    { bend: -0.14, width: 1.02, awn: 0.98 },
    { bend: 0.30, width: 0.90, awn: 1.16 }
  ];
  var HEAD_VEC_COLORS = [];
  var LEAF_VEC_COLORS = [];
  (function () {
    for (var tier = 0; tier < 3; tier++) {
      var haze = HAZE_TIERS[tier];
      var headTier = [];
      for (var v = 0; v < 6; v++) {
        var pal = HEAD_PAL[v];
        var deep = mixRgb(rgbOf(pal.deep), HAZE_RGB, haze);
        var mid = mixRgb(rgbOf(pal.mid), HAZE_RGB, haze);
        var light = mixRgb(rgbOf(pal.light), HAZE_RGB, haze);
        var tip = mixRgb(rgbOf(pal.tip), HAZE_RGB, haze * 0.7);
        var awn = mixRgb(rgbOf(pal.awn), HAZE_RGB, haze * 0.8);
        headTier.push({
          deep: css(deep),
          mid: css(mid),
          light: css(light),
          tip: css(tip),
          awn: css(awn, 0.72),
          awn2: css(tip, 0.9),
          spike: css(deep, 0.45),
          rim: css(light, 0.62),
          shadow: css(deep, 0.4)
        });
      }
      HEAD_VEC_COLORS.push(headTier);
      var lBase = mixRgb(LEAF_RGB.base, HAZE_RGB, haze * 0.5);
      var lMid = mixRgb(LEAF_RGB.mid, HAZE_RGB, haze * 0.44);
      var lTip = mixRgb(LEAF_RGB.tip, HAZE_RGB, haze * 0.36);
      LEAF_VEC_COLORS.push({
        base: css(lBase),
        mid: css(lMid),
        tip: css(lTip),
        vein: css(lTip, 0.55),
        rim: css(lTip, 0.4),
        shade: css(lBase, 0.55)
      });
    }
  })();

  var HEAD_TIER_ALPHA = [0, 0, 0];
  (function () {
    var counts = [0, 0, 0];
    for (var r = 0; r < ROW_STYLES.length; r++) {
      var t = ROW_STYLES[r].headTier;
      HEAD_TIER_ALPHA[t] += ROW_STYLES[r].alpha;
      counts[t]++;
    }
    for (var i = 0; i < 3; i++) {
      if (counts[i]) HEAD_TIER_ALPHA[i] /= counts[i];
    }
  })();

  /* 精灵尺寸（逻辑像素） */
  var HEAD_W = 104;
  var HEAD_H = 168;
  var HEAD_S = 2.2;
  var HEAD_BASE_FRAC = (HEAD_H - 8) / HEAD_H;             /* 茎↔穗连接点距精灵底 */
  var HEAD_TIP_FROM_BASE = (HEAD_H - 8 - 24) / HEAD_H;    /* 穗尖距连接点 */

  var LEAF_W = 76;
  var LEAF_H = 140;
  var LEAF_S = 2.6;
  var LEAF_BASE_FRAC = (LEAF_H - 4) / LEAF_H;

  /* ------------------------------------------------------------- 工具函数 */
  function tierOf(haze) {
    return haze > 0.45 ? 2 : haze > 0.22 ? 1 : 0;
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rgbOf(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
  }

  function mixRgb(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }

  function css(rgb, alpha) {
    var r = Math.round(rgb[0]);
    var g = Math.round(rgb[1]);
    var b = Math.round(rgb[2]);
    if (alpha === undefined || alpha >= 1) {
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.round(alpha * 1000) / 1000 + ')';
  }

  function mixCss(hex, haze, alpha) {
    return css(mixRgb(rgbOf(hex), HAZE_RGB, haze), alpha);
  }

  /* ============================================================ 精灵绘制 */
  /* 全部在初始化时一次性预渲染；运行时只 drawImage，不用 filter/shadowBlur。 */

  function makeHeadSprite(variant, golden, tier) {
    var W = HEAD_W;
    var H = HEAD_H;
    var S = HEAD_S;
    var cv = document.createElement('canvas');
    cv.width = Math.round(W * S);
    cv.height = Math.round(H * S);
    var g = cv.getContext('2d');
    g.scale(S, S);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    var haze = HAZE_TIERS[tier];
    var pal = golden ? GOLD_PAL : HEAD_PAL[variant % HEAD_PAL.length];
    var deep = mixRgb(rgbOf(pal.deep), HAZE_RGB, haze);
    var mid = mixRgb(rgbOf(pal.mid), HAZE_RGB, haze);
    var light = mixRgb(rgbOf(pal.light), HAZE_RGB, haze);
    var tip = mixRgb(rgbOf(pal.tip), HAZE_RGB, haze * 0.72);
    var awn = mixRgb(rgbOf(pal.awn), HAZE_RGB, haze * 0.76);

    var rnd = mulberry32(0x51ED + variant * 131 + tier * 977 + (golden ? 7919 : 0));
    var N = 22 + (variant % 2);
    var bend = [-3.4, 2.8, -2.0, 3.6, -0.8, 2.2][variant % 6];
    var widthMul = [1.0, 0.93, 1.08, 0.97, 1.03, 0.9][variant % 6];
    var awnMul = [1.0, 1.15, 0.85, 1.08, 0.95, 1.2][variant % 6];
    var baseY = H - 12;
    var topY = 36 + (variant % 2) * 3;
    var cx = W / 2;

    function spineX(t) {
      return cx + Math.sin(t * 1.3) * bend + Math.sin(t * PI) * bend * 0.45;
    }
    function spineY(t) {
      return baseY + (topY - baseY) * t;
    }

    /* 穗轴 */
    g.strokeStyle = css(deep, 0.6);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(cx, baseY + 4);
    for (var si = 1; si <= 12; si++) {
      g.lineTo(spineX(si / 12), spineY(si / 12));
    }
    g.stroke();

    /* 每个小穗（左右两粒）的位置 */
    var grains = [];
    for (var i = 0; i < N; i++) {
      var t = (i + 0.5) / N;
      var x = spineX(t);
      var y = spineY(t);
      var half = widthMul * (3.4 + 9.4 * (1 - t));
      var gl = (13.0 + 6.0 * (1 - t)) * (0.94 + 0.1 * Math.sin(t * 3.5 + variant));
      for (var s = -1; s <= 1; s += 2) {
        var ax = x + s * half * 0.28;
        var ay = y + 1.0;
        var tipX = x + s * (half * 0.18 + gl * 0.12);
        var tipY = y - gl * 0.98;
        grains.push({
          t: t, s: s, x: x, y: y, ax: ax, ay: ay,
          tx: tipX, ty: tipY, half: half, gl: gl
        });
      }
    }

    /* 芒：细、直、偏向上方；先画在麦粒之后面 */
    for (var a = 0; a < grains.length; a++) {
      var gr = grains[a];
      if (rnd() < 0.38) continue;
      var alen = awnMul * (8 + 12 * gr.t) * (0.8 + rnd() * 0.35);
      var a0x = gr.tx + gr.s * alen * 0.02;
      var a0y = gr.ty + 1.2;
      var a1x = gr.tx + gr.s * alen * (0.14 + rnd() * 0.1);
      var a1y = gr.ty - alen * (0.86 + rnd() * 0.08);
      var acx = gr.tx + gr.s * alen * 0.05;
      var acy = gr.ty - alen * 0.46;
      g.strokeStyle = css(awn, 0.26 + rnd() * 0.22 + (golden ? 0.1 : 0));
      g.lineWidth = 0.36 + rnd() * 0.2;
      g.beginPath();
      g.moveTo(a0x, a0y);
      g.quadraticCurveTo(acx, acy, a1x, a1y);
      g.stroke();
    }

    /* 顶部冠芒 */
    var crownX = spineX(1);
    var crownY = spineY(1);
    for (var c = 0; c < 6; c++) {
      var ca = (c - 2.5) * 0.11;
      var clen = awnMul * (20 + rnd() * 10);
      g.strokeStyle = css(awn, 0.34 + rnd() * 0.2);
      g.lineWidth = 0.4 + rnd() * 0.18;
      g.beginPath();
      g.moveTo(crownX, crownY + 2);
      g.quadraticCurveTo(crownX + Math.sin(ca) * clen * 0.18, crownY - clen * 0.52,
        crownX + Math.sin(ca) * clen * 0.46, crownY - clen * 0.95);
      g.stroke();
    }

    /* 整穗统一的纵向金色渐变：主体偏琥珀，只有穗尖泛米金 */
    var kernelGrad = g.createLinearGradient(cx, baseY, cx, topY);
    kernelGrad.addColorStop(0, css(mixRgb(deep, mid, 0.5)));
    kernelGrad.addColorStop(0.68, css(mid));
    kernelGrad.addColorStop(0.92, css(mixRgb(mid, light, 0.6)));
    kernelGrad.addColorStop(1, css(light));

    /* 实心穗身（在麦粒下），保证远看也有饱满体积 */
    var bodyGrad = g.createLinearGradient(cx, baseY, cx, topY);
    bodyGrad.addColorStop(0, css(mixRgb(deep, mid, 0.35)));
    bodyGrad.addColorStop(0.62, css(mid));
    bodyGrad.addColorStop(0.9, css(mixRgb(mid, light, 0.4)));
    bodyGrad.addColorStop(1, css(light));
    g.beginPath();
    for (var bi = 0; bi <= 12; bi++) {
      var bt = bi / 12;
      var bh = widthMul * (1.2 + 7.6 * Math.sin(PI * Math.pow(bt, 0.72)) * (1 - bt * 0.16));
      var bxp = spineX(bt) + bh;
      var byp = spineY(bt);
      if (bi === 0) g.moveTo(bxp, byp + 3);
      else g.lineTo(bxp, byp);
    }
    for (var bj = 12; bj >= 0; bj--) {
      var bt2 = bj / 12;
      var bh2 = widthMul * (1.2 + 7.6 * Math.sin(PI * Math.pow(bt2, 0.72)) * (1 - bt2 * 0.16));
      g.lineTo(spineX(bt2) - bh2, spineY(bt2));
    }
    g.closePath();
    g.fillStyle = bodyGrad;
    g.fill();
    g.strokeStyle = css(deep, 0.55);
    g.lineWidth = 0.7;
    g.stroke();

    /* 受光侧穗身轮廓 */
    g.strokeStyle = css(light, 0.3);
    g.lineWidth = 0.65;
    g.beginPath();
    g.moveTo(spineX(0.16) + widthMul * 7.6, spineY(0.16));
    g.quadraticCurveTo(spineX(0.48) + widthMul * 8.0, spineY(0.48), spineX(0.85) + widthMul * 3.0, spineY(0.85));
    g.stroke();

    /* 从穗尖到穗基绘制，下层小穗压住上层，形成饱满的麦穗 */
    for (var gi = grains.length - 1; gi >= 0; gi--) {
      var q = grains[gi];
      g.beginPath();
      g.moveTo(q.ax, q.ay + 1.8);
      g.quadraticCurveTo(q.x + q.s * q.half * 0.98, q.y - q.gl * 0.28, q.tx, q.ty);
      g.quadraticCurveTo(q.x + q.s * q.half * 0.26, q.y - q.gl * 0.44, q.ax - q.s * 1.2, q.ay - 1.2);
      g.closePath();
      g.fillStyle = kernelGrad;
      g.fill();
      g.strokeStyle = css(deep, 0.5);
      g.lineWidth = 0.52;
      g.stroke();

      /* 下缘暗部，增加体积 */
      g.strokeStyle = css(deep, 0.42);
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(q.ax - q.s * 0.8, q.ay - 0.8);
      g.quadraticCurveTo(q.x + q.s * q.half * 0.4, q.y - q.gl * 0.44, q.tx, q.ty + 0.6);
      g.stroke();

      /* 阳面高光（右侧更强） */
      g.strokeStyle = css(light, q.s > 0 ? 0.7 : 0.3);
      g.lineWidth = q.s > 0 ? 0.72 : 0.46;
      g.beginPath();
      g.moveTo(q.x + q.s * q.half * 0.9, q.y - q.gl * 0.14);
      g.quadraticCurveTo(q.x + q.s * q.half * 0.62, q.y - q.gl * 0.62,
        q.tx - q.s * 0.3, q.ty + q.gl * 0.16);
      g.stroke();

      /* 内稃缝线 */
      g.strokeStyle = css(deep, 0.28);
      g.lineWidth = 0.35;
      g.beginPath();
      g.moveTo(q.ax, q.ay);
      g.quadraticCurveTo(q.x + q.s * q.gl * 0.1, q.y - q.gl * 0.52, q.tx, q.ty);
      g.stroke();
    }

    /* 穗尖小穗 */
    g.beginPath();
    g.moveTo(crownX - 1.4, crownY + 8);
    g.quadraticCurveTo(crownX - 0.4, crownY + 1, crownX + 0.4, crownY - 7);
    g.quadraticCurveTo(crownX + 1.4, crownY + 1, crownX + 1.1, crownY + 8);
    g.closePath();
    g.fillStyle = kernelGrad;
    g.fill();
    g.strokeStyle = css(deep, 0.35);
    g.lineWidth = 0.4;
    g.stroke();

    /* 粗一点的横向麦粒分隔，远看也能读出“穗”的层次 */
    g.strokeStyle = css(deep, 0.26);
    g.lineWidth = 0.9;
    g.beginPath();
    for (var li = 1; li <= 8; li++) {
      var lt = li / 9;
      var lh = widthMul * (2.2 + 7.2 * (1 - lt));
      g.moveTo(spineX(lt) - lh, spineY(lt) + 1.5);
      g.quadraticCurveTo(spineX(lt) + 1.5, spineY(lt) - 2.5, spineX(lt) + lh, spineY(lt) + 0.5);
    }
    g.stroke();

    /* 阳面/背阴面的方向性明暗，让整穗更有体积 */
    g.globalCompositeOperation = 'source-atop';
    var shade = g.createLinearGradient(0, 0, W * 0.66, 0);
    shade.addColorStop(0, golden ? 'rgba(120,66,10,0.16)' : 'rgba(70,38,6,0.28)');
    shade.addColorStop(0.52, golden ? 'rgba(120,66,10,0.06)' : 'rgba(70,38,6,0.10)');
    shade.addColorStop(1, 'rgba(70,38,6,0)');
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
    var sunSide = g.createLinearGradient(W * 0.55, 0, W, 0);
    sunSide.addColorStop(0, 'rgba(255,240,190,0)');
    sunSide.addColorStop(1, golden ? 'rgba(255,248,206,0.28)' : 'rgba(255,240,190,0.12)');
    g.fillStyle = sunSide;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';

    /* 金色穗内蕴暖光（预渲染，运行时不再加 blur） */
    if (golden) {
      g.globalCompositeOperation = 'lighter';
      var gg = g.createRadialGradient(cx, (baseY + topY) * 0.5, 4, cx, (baseY + topY) * 0.5, 64);
      gg.addColorStop(0, css(tip, 0.3));
      gg.addColorStop(0.55, css(light, 0.13));
      gg.addColorStop(1, css(light, 0));
      g.fillStyle = gg;
      g.fillRect(0, 0, W, H);
      /* 少量晶亮颗粒 */
      g.fillStyle = css(tip, 0.85);
      for (var sp = 0; sp < 10; sp++) {
        var sxp = cx + (rnd() - 0.5) * 34;
        var syp = topY + 10 + rnd() * (baseY - topY - 18);
        var sr = 0.5 + rnd() * 1.0;
        g.beginPath();
        g.arc(sxp, syp, sr, 0, TAU);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }

    return cv;
  }

  function makeLeafSprite(shape, tier) {
    var W = LEAF_W;
    var H = LEAF_H;
    var S = LEAF_S;
    var cv = document.createElement('canvas');
    cv.width = Math.round(W * S);
    cv.height = Math.round(H * S);
    var g = cv.getContext('2d');
    g.scale(S, S);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    var haze = HAZE_TIERS[tier];
    var baseCol = mixRgb(LEAF_RGB.base, HAZE_RGB, haze * 0.45);
    var midCol = mixRgb(LEAF_RGB.mid, HAZE_RGB, haze * 0.4);
    var tipCol = mixRgb(LEAF_RGB.tip, HAZE_RGB, haze * 0.32);

    var reach = [-13, 14, -19, 18][shape % 4];
    var rise = [82, 72, 76, 62][shape % 4];
    var droop = [0.35, 0.65, 0.5, 0.8][shape % 4];
    var wid = [0.9, 0.82, 1.05, 0.86][shape % 4];
    var bx = W * 0.5;
    var by = H - 4;
    var apexY = by - rise;
    var tipX = bx + reach;
    var tipY = apexY + rise * droop;
    var c1 = { x: bx + reach * 0.16, y: by - rise * 0.55 };
    var c2 = { x: bx + reach * 0.95, y: apexY + rise * 0.06 };

    var left = [];
    var right = [];
    var centers = [];
    var SEG = 14;
    for (var i = 0; i <= SEG; i++) {
      var t = i / SEG;
      var mt = 1 - t;
      var x = mt * mt * mt * bx + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * tipX;
      var y = mt * mt * mt * by + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * tipY;
      var dx = 3 * mt * mt * (c1.x - bx) + 6 * mt * t * (c2.x - c1.x) + 3 * t * t * (tipX - c2.x);
      var dy = 3 * mt * mt * (c1.y - by) + 6 * mt * t * (c2.y - c1.y) + 3 * t * t * (tipY - c2.y);
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len;
      var ny = dx / len;
      var w = wid * (1.6 + 9.0 * Math.pow(Math.sin(PI * t), 0.9)) * (1 - t * 0.92);
      left.push({ x: x + nx * w, y: y + ny * w });
      right.push({ x: x - nx * w, y: y - ny * w });
      centers.push({ x: x, y: y });
    }

    g.beginPath();
    g.moveTo(left[0].x, left[0].y);
    for (var li = 1; li < left.length; li++) g.lineTo(left[li].x, left[li].y);
    for (var ri = right.length - 1; ri >= 0; ri--) g.lineTo(right[ri].x, right[ri].y);
    g.closePath();

    var grad = g.createLinearGradient(bx, by, tipX, tipY);
    grad.addColorStop(0, css(baseCol));
    grad.addColorStop(0.5, css(midCol));
    grad.addColorStop(1, css(tipCol));
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = css(baseCol, 0.55);
    g.lineWidth = 0.55;
    g.stroke();

    /* 主脉 */
    g.strokeStyle = css(tipCol, 0.56);
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(centers[0].x, centers[0].y);
    for (var ci = 1; ci < centers.length; ci++) g.lineTo(centers[ci].x, centers[ci].y);
    g.stroke();

    /* 上缘反光 */
    g.strokeStyle = css(tipCol, 0.42);
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(right[2].x, right[2].y);
    for (var hi = 3; hi < right.length - 2; hi++) g.lineTo(right[hi].x, right[hi].y);
    g.stroke();

    /* 侧脉 */
    g.strokeStyle = css(midCol, 0.32);
    g.lineWidth = 0.35;
    for (var vi = 3; vi < centers.length - 4; vi += 4) {
      g.beginPath();
      g.moveTo(centers[vi].x, centers[vi].y);
      g.lineTo(right[vi].x * 0.94 + centers[vi].x * 0.06, right[vi].y * 0.94 + centers[vi].y * 0.06);
      g.stroke();
    }

    return cv;
  }

  function makeShadowSprite() {
    var S = 96;
    var cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    var g = cv.getContext('2d');
    var rg = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2 - 2);
    rg.addColorStop(0, 'rgba(48,28,10,0.55)');
    rg.addColorStop(0.5, 'rgba(48,28,10,0.24)');
    rg.addColorStop(1, 'rgba(48,28,10,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    return cv;
  }

  function makeGlowSprite() {
    var S = 128;
    var cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    var g = cv.getContext('2d');
    var rg = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(255,248,214,0.95)');
    rg.addColorStop(0.20, 'rgba(255,226,150,0.55)');
    rg.addColorStop(0.52, 'rgba(255,192,94,0.18)');
    rg.addColorStop(1, 'rgba(255,180,70,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    return cv;
  }

  function makeStarSprite() {
    var S = 48;
    var cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    var g = cv.getContext('2d');
    var c = S / 2;
    var rg = g.createRadialGradient(c, c, 1, c, c, c);
    rg.addColorStop(0, 'rgba(255,250,225,0.9)');
    rg.addColorStop(0.35, 'rgba(255,228,155,0.28)');
    rg.addColorStop(1, 'rgba(255,210,120,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    /* 四芒星 */
    g.fillStyle = 'rgba(255,251,235,0.95)';
    g.beginPath();
    g.moveTo(c, 4);
    g.quadraticCurveTo(c + 2, c - 3, S - 5, c);
    g.quadraticCurveTo(c + 2, c + 3, c, S - 4);
    g.quadraticCurveTo(c - 2, c + 3, 5, c);
    g.quadraticCurveTo(c - 2, c - 3, c, 4);
    g.closePath();
    g.fill();
    return cv;
  }

  function makeSweepSprite() {
    var W = 256;
    var H = 256;
    var cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    var g = cv.getContext('2d');
    var lg = g.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, 'rgba(255,210,120,0)');
    lg.addColorStop(0.26, 'rgba(255,214,132,0.18)');
    lg.addColorStop(0.44, 'rgba(255,236,176,0.46)');
    lg.addColorStop(0.50, 'rgba(255,251,232,0.62)');
    lg.addColorStop(0.56, 'rgba(255,236,176,0.46)');
    lg.addColorStop(0.74, 'rgba(255,214,132,0.18)');
    lg.addColorStop(1, 'rgba(255,210,120,0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);

    var rnd = mulberry32(0x5EED);
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 16; i++) {
      var x = W * (0.36 + rnd() * 0.28);
      g.strokeStyle = 'rgba(255,244,205,' + (0.03 + rnd() * 0.1).toFixed(3) + ')';
      g.lineWidth = 0.6 + rnd() * 1.4;
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 40, H * 0.5, x + (rnd() - 0.5) * 26, H);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    return cv;
  }

  function makeHazeSprite() {
    var W = 16;
    var H = 192;
    var cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    var g = cv.getContext('2d');
    var lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, 'rgba(246,208,148,0)');
    lg.addColorStop(0.16, 'rgba(245,205,142,0.10)');
    lg.addColorStop(0.34, 'rgba(243,200,134,0.26)');
    lg.addColorStop(0.52, 'rgba(240,193,124,0.30)');
    lg.addColorStop(0.72, 'rgba(236,184,112,0.14)');
    lg.addColorStop(0.9, 'rgba(232,176,102,0.04)');
    lg.addColorStop(1, 'rgba(230,172,98,0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    return cv;
  }

  /* ------------------------------------------------ 批量矢量麦穗几何 */
  /* 这些函数只把子路径追加进当前 path，由 _drawBatchedHeads 按色阶一次性
     fill/stroke，避免逐穗切换 fillStyle / strokeStyle 的软件渲染开销。 */

  function appendHeadShape(ctx, st, shape) {
    var E = st.headDisp * 0.82;
    if (E < 1) return false;
    var sn = Math.sin(st.ang);
    var cs = Math.cos(st.ang);
    var ux = sn;
    var uy = -cs;
    var rx = cs;
    var ry = sn;
    var bx = st.tx;
    var by = st.ty;
    var W = E * 0.098 * shape.width;
    var bend = shape.bend * E * 0.035;
    var far = E < 28;
    var N = far ? 4 : 6;
    var levels = far ? 4 : 9;
    var i;
    var t;
    var prof;
    var w;
    var o;
    for (i = 0; i <= N; i++) {
      t = i / N;
      prof = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
      o = bend * Math.sin(PI * t);
      w = W * prof * (0.86 + 0.14 * Math.abs(Math.sin(t * levels * PI)));
      if (i === 0) {
        ctx.moveTo(bx + ux * E * t + rx * (o + w), by + uy * E * t + ry * (o + w));
      } else {
        ctx.lineTo(bx + ux * E * t + rx * (o + w), by + uy * E * t + ry * (o + w));
      }
    }
    for (i = N; i >= 0; i--) {
      t = i / N;
      prof = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
      o = bend * Math.sin(PI * t);
      w = W * prof * (0.86 + 0.14 * Math.abs(Math.sin(t * levels * PI + 0.6)));
      ctx.lineTo(bx + ux * E * t + rx * (o - w), by + uy * E * t + ry * (o - w));
    }
    ctx.closePath();
    return true;
  }

  function appendHeadLight(ctx, st) {
    var E = st.headDisp * 0.82;
    if (E < 2) return false;
    var shape = HEAD_SHAPES[st.headVar % 6];
    var sn = Math.sin(st.ang);
    var cs = Math.cos(st.ang);
    var ux = sn;
    var uy = -cs;
    var rx = cs;
    var ry = sn;
    var bx = st.tx;
    var by = st.ty;
    var W = E * 0.052 * shape.width;
    var bend = shape.bend * E * 0.035 + W * 0.9;
    var far = E < 28;
    var N = far ? 3 : 5;
    var i;
    var t;
    var prof;
    var w;
    var o;
    for (i = 0; i <= N; i++) {
      t = i / N;
      prof = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
      o = bend * Math.sin(PI * t);
      w = W * prof;
      if (i === 0) {
        ctx.moveTo(bx + ux * E * t + rx * (o + w), by + uy * E * t + ry * (o + w));
      } else {
        ctx.lineTo(bx + ux * E * t + rx * (o + w), by + uy * E * t + ry * (o + w));
      }
    }
    for (i = N; i >= 0; i--) {
      t = i / N;
      prof = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
      o = bend * Math.sin(PI * t);
      w = W * prof;
      ctx.lineTo(bx + ux * E * t + rx * (o - w), by + uy * E * t + ry * (o - w));
    }
    ctx.closePath();
    return true;
  }

  function appendHeadSpikes(ctx, st) {    var E = st.headDisp * 0.82;
    if (E < 42) return false;
    var shape = HEAD_SHAPES[st.headVar % 6];
    var sn = Math.sin(st.ang);
    var cs = Math.cos(st.ang);
    var ux = sn;
    var uy = -cs;
    var rx = cs;
    var ry = sn;
    var bx = st.tx;
    var by = st.ty;
    var W = E * 0.098 * shape.width;
    var bend = shape.bend * E * 0.035;
    var levels = E > 70 ? 8 : 6;
    var i;
    var t;
    var prof;
    var w;
    var o;
    for (i = 1; i <= levels; i++) {
      t = i / (levels + 1);
      prof = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
      o = bend * Math.sin(PI * t);
      w = W * prof;
      ctx.moveTo(bx + ux * E * t + rx * (o - w * 0.92), by + uy * E * t + ry * (o - w * 0.92));
      ctx.quadraticCurveTo(
        bx + ux * E * (t + 0.022) + rx * o, by + uy * E * (t + 0.022) + ry * o,
        bx + ux * E * t + rx * (o + w * 0.92), by + uy * E * t + ry * (o + w * 0.92)
      );
    }
    return true;
  }

  function appendHeadAwns(ctx, st) {    var E = st.headDisp * 0.82;
    if (E < 1) return false;
    var shape = HEAD_SHAPES[st.headVar % 6];
    var sn = Math.sin(st.ang);
    var cs = Math.cos(st.ang);
    var ux = sn;
    var uy = -cs;
    var rx = cs;
    var ry = sn;
    var bx = st.tx;
    var by = st.ty;
    var W = E * 0.098 * shape.width;
    var bend = shape.bend * E * 0.035;
    var awns = E < 28 ? 5 : (E > 60 ? 12 : 8);
    var i;
    var t;
    var prof;
    var w;
    var o;
    for (i = 0; i < awns; i++) {
      t = 0.06 + (i / Math.max(1, awns - 1)) * 0.88;
      prof = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
      o = bend * Math.sin(PI * t);
      w = W * prof;
      var side = (i % 2 === 0) ? 1 : -1;
      var ax = bx + ux * E * t + rx * (o + side * w * 0.9);
      var ay = by + uy * E * t + ry * (o + side * w * 0.9);
      var alen = E * (0.24 + 0.2 * t) * shape.awn * (0.88 + 0.22 * Math.sin(i * 2.7 + st.phaseOff * 3.1));
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(
        ax + rx * side * alen * 0.12 + ux * alen * 0.4,
        ay + ry * side * alen * 0.12 + uy * alen * 0.4,
        ax + rx * side * alen * 0.3 + ux * alen * 0.98,
        ay + ry * side * alen * 0.3 + uy * alen * 0.98
      );
    }
    if (E > 30) {
      for (i = 0; i < 3; i++) {
        var cxs = bx + ux * E * 0.99 + rx * (i - 1) * W * 0.2;
        var cys = by + uy * E * 0.99 + ry * (i - 1) * W * 0.2;
        var clen = E * (0.3 + 0.06 * i) * shape.awn;
        ctx.moveTo(cxs, cys);
        ctx.quadraticCurveTo(
          cxs + ux * clen * 0.4, cys + uy * clen * 0.4,
          cxs + rx * (i - 1) * clen * 0.2 + ux * clen, cys + ry * (i - 1) * clen * 0.2 + uy * clen
        );
      }
    }
    return true;
  }

  /* 地平线远景补充：不参与计分的极淡小穗带，用来填满远排间隙 */
  var FRINGE_COLORS = {
    stem: css(mixRgb(STEM_RGB.dark, HAZE_RGB, 0.64), 0.55),
    head: css(mixRgb(rgbOf(HEAD_PAL[0].mid), HAZE_RGB, 0.58), 0.7),
    awn: css(mixRgb(rgbOf(HEAD_PAL[0].awn), HAZE_RGB, 0.58), 0.45)
  };

  /* 把一片叶子按 mode 追加进当前 path：
     0 = 完整叶形填充；1 = 细一点的暖面；2 = 主脉；3 = 受光边缘 */
  function appendLeafShape(ctx, lf, mode) {
    var len = lf.lenPx;
    if (len < 1.2) return false;
    var rot = lf.rot;
    var dirX = Math.sin(rot);
    var dirY = -Math.cos(rot);
    var perpX = Math.cos(rot);
    var perpY = Math.sin(rot);
    var bx = lf.x;
    var by = lf.y;
    var side = lf.side < 0 ? -1 : 1;
    var c1x = bx + dirX * len * 0.40 + perpX * side * len * 0.02;
    var c1y = by + dirY * len * 0.40 + perpY * side * len * 0.02;
    var c2x = bx + dirX * len * 0.76 + perpX * side * len * 0.22;
    var c2y = by + dirY * len * 0.76 + perpY * side * len * 0.22 - len * 0.02;
    var tipX = bx + dirX * len * 0.94 + perpX * side * len * 0.33;
    var tipY = by + dirY * len * 0.94 + perpY * side * len * 0.33 + len * 0.08;
    var N = 5;
    var i;
    var t;
    var mt;
    var x;
    var y;
    var dx;
    var dy;
    var dd;
    var nx;
    var ny;
    var w;

    if (mode === 2) {
      ctx.moveTo(bx, by);
      for (i = 1; i <= N; i++) {
        t = i / N;
        mt = 1 - t;
        x = mt * mt * mt * bx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tipX;
        y = mt * mt * mt * by + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * tipY;
        ctx.lineTo(x, y);
      }
      return true;
    }

    if (mode === 3) {
      var started = false;
      for (i = 1; i < N; i++) {
        t = i / N;
        mt = 1 - t;
        x = mt * mt * mt * bx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tipX;
        y = mt * mt * mt * by + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * tipY;
        dx = 3 * mt * mt * (c1x - bx) + 6 * mt * t * (c2x - c1x) + 3 * t * t * (tipX - c2x);
        dy = 3 * mt * mt * (c1y - by) + 6 * mt * t * (c2y - c1y) + 3 * t * t * (tipY - c2y);
        dd = Math.sqrt(dx * dx + dy * dy) || 1;
        w = len * (0.012 + 0.072 * Math.pow(Math.sin(PI * t), 0.8)) * (1 - t * 0.3);
        var ex = x - (-dy / dd) * w;
        var ey = y - (dx / dd) * w;
        if (!started) {
          ctx.moveTo(ex, ey);
          started = true;
        } else {
          ctx.lineTo(ex, ey);
        }
      }
      return started;
    }

    var ws = mode === 1 ? 0.5 : 1;
    for (i = 0; i <= N; i++) {
      t = i / N;
      mt = 1 - t;
      x = mt * mt * mt * bx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tipX;
      y = mt * mt * mt * by + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * tipY;
      dx = 3 * mt * mt * (c1x - bx) + 6 * mt * t * (c2x - c1x) + 3 * t * t * (tipX - c2x);
      dy = 3 * mt * mt * (c1y - by) + 6 * mt * t * (c2y - c1y) + 3 * t * t * (tipY - c2y);
      dd = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = -dy / dd;
      ny = dx / dd;
      w = len * (0.012 + 0.072 * Math.pow(Math.sin(PI * t), 0.8)) * (1 - t * 0.3) * ws;
      if (i === 0) ctx.moveTo(x + nx * w, y + ny * w);
      else ctx.lineTo(x + nx * w, y + ny * w);
    }
    for (i = N; i >= 0; i--) {
      t = i / N;
      mt = 1 - t;
      x = mt * mt * mt * bx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tipX;
      y = mt * mt * mt * by + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * tipY;
      dx = 3 * mt * mt * (c1x - bx) + 6 * mt * t * (c2x - c1x) + 3 * t * t * (tipX - c2x);
      dy = 3 * mt * mt * (c1y - by) + 6 * mt * t * (c2y - c1y) + 3 * t * t * (tipY - c2y);
      dd = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = -dy / dd;
      ny = dx / dd;
      w = len * (0.012 + 0.072 * Math.pow(Math.sin(PI * t), 0.8)) * (1 - t * 0.3) * ws;
      ctx.lineTo(x - nx * w, y - ny * w);
    }
    ctx.closePath();
    return true;
  }

  /* ================================================================ 类 */
  class WheatField {
    constructor() {
      this.width = 1600;
      this.height = 900;
      this._u = 1;
      this._top = 900 * 0.49;
      this._bottom = 900 * 1.02;

      this._plants = [];
      this._fringe = [];
      this._built = false;

      this._clock = 0;
      this._time = 0;
      this._rng = mulberry32(0x5A17);

      this._wind = 0;
      this._gust = 0;
      this._pointer = { x: -9999, y: -9999, active: false };
      this._frenzy = false;
      this._reduced = false;
      this._goldenBoost = 1;

      this._events = [];
      this._storm = null;
      this._stormX = -9999;

      this._sprites = null;
      this._spriteFailed = false;

      this._fogGrad = null;
      this._fogCtx = null;
      this._fogKey = '';
      this._fogTop = 0;
      this._fogH = 0;

      this._stats = { uncut: 0, total: 0, golden: 0 };

      /* 仅供 QA（预览页）调整重生节奏；主程序无需关心 */
      this.regrowScale = 1;

      /* 默认走细节丰富的预渲染精灵路径；
         低性能环境可设置 fastMode = true 切换为批量矢量路径。 */
      this.fastMode = false;
      this._cutRange = 1;
    }

    /* ------------------------------------------------------------ 尺寸 */
    resize(width, height) {
      var w = Math.max(320, Math.round(width || 1600));
      var h = Math.max(240, Math.round(height || 900));
      if (w === this.width && h === this.height && this._built) {
        this._top = h * 0.49;
        this._bottom = h * 1.02;
        return;
      }
      var oldW = this.width;
      var oldH = this.height;
      var oldTop = this._top;
      var oldBottom = this._bottom;

      this.width = w;
      this.height = h;
      this._u = h / 900;
      this._top = h * 0.49;
      this._bottom = h * 1.02;
      this._fogGrad = null;
      this._fogKey = '';

      if (!this._built) return;

      var sx = w / oldW;
      var ratioH = h / oldH;
      var spanRatio = (this._bottom - this._top) / Math.max(1, oldBottom - oldTop);
      for (var i = 0; i < this._plants.length; i++) {
        var p = this._plants[i];
        p.x = clamp(p.x * sx, 0, w);
        p.y = this._top + (p.y - oldTop) * spanRatio;
        p.height *= ratioH;
        p.stemWidth *= ratioH;
        p.stubH *= ratioH;
        for (var s = 0; s < p.stems.length; s++) {
          p.stems[s].dx *= ratioH;
        }
      }
      this._adjustCount(this._targetCount());
      this._buildFringe();
      this._countStats();
    }

    _foregroundCount() {
      return Math.round(clamp(this.width / 175, 6, 12));
    }

    _targetCount() {
      /* v2: 麦子数量在 v1 基础上加倍（1600×900 下 674 株） */
      return Math.round(clamp(this.width / 2.375, 440, 920));
    }

    /* ------------------------------------------------------------ 重置 */
    reset(seed) {
      var s = (seed === undefined ? 0x5A17 : seed) >>> 0;
      this._rng = mulberry32(s || 1);
      this._clock = 0;
      this._time = 0;
      this._frenzy = false;
      this._reduced = false;
      this._pointer.x = -9999;
      this._pointer.y = -9999;
      this._pointer.active = false;
      this._storm = null;
      this._stormX = -9999;
      this._events.length = 0;

      this._u = this.height / 900;
      this._top = this.height * 0.49;
      this._bottom = this.height * 1.02;
      this._fogGrad = null;
      this._fogKey = '';

      var target = this._targetCount();
      var fgCount = this._foregroundCount();
      var counts = this._distributeCounts(target - fgCount);
      var plants = [];
      for (var r = 0; r < ROWS.length; r++) {
        var n = counts[r];
        var spacing = this.width / n;
        var rowShift = ((r * 0.37) % 1) * 0.62;
        for (var i = 0; i < n; i++) {
          var x = clamp((i + 0.5 + rowShift + (this._rng() - 0.5) * 0.86) * spacing, 2, this.width - 2);
          plants.push(this._makePlant(r, x, this._rng));
        }
      }
      /* 底缘被裁切的超大麦穗：与近景拉开体量，形成画框 */
      for (var g = 0; g < fgCount; g++) {
        plants.push(this._makeForegroundPlant(g, fgCount));
      }
      this._plants = plants;
      this._built = true;
      this._buildFringe();

      /* 初始化摆动/几何，保证第一次 cut 前也有有效坐标 */
      this._updateSwayAndGeometry(0);
      this._countStats();
    }

    _distributeCounts(target) {
      var counts = [];
      var frac = [];
      var sum = 0;
      for (var i = 0; i < ROWS.length; i++) {
        var exact = target * ROWS[i].weight;
        var base = Math.floor(exact);
        counts.push(base);
        frac.push(exact - base);
        sum += base;
      }
      var remain = target - sum;
      while (remain > 0) {
        var best = 0;
        for (var j = 1; j < frac.length; j++) {
          if (frac[j] > frac[best]) best = j;
        }
        counts[best]++;
        frac[best] = -1;
        remain--;
      }
      return counts;
    }

    _adjustCount(target) {
      var plants = this._plants;
      var i;
      if (plants.length > target) {
        var remove = plants.length - target;
        for (i = plants.length - 1; i >= 0 && remove > 0; i--) {
          if (plants[i].state !== STATE_STAND) {
            plants.splice(i, 1);
            remove--;
          }
        }
        if (remove > 0) plants.splice(plants.length - remove, remove);
      } else if (plants.length < target) {
        var rnd = this._rng;
        while (plants.length < target) {
          var pick = rnd();
          var rowIndex = 0;
          var acc = 0;
          for (var r = 0; r < ROWS.length; r++) {
            acc += ROWS[r].weight;
            if (pick <= acc) {
              rowIndex = r;
              break;
            }
          }
          var x = rnd() * this.width;
          plants.push(this._makePlant(rowIndex, x, rnd));
        }
      }
    }

    /* 底缘超大前景麦穗：根部在画布外，穗头被底边裁切 */
    _makeForegroundPlant(index, total) {
      var u = this._u;
      var x;
      var bigScale;
      var rootY;
      if (index === 0) {
        x = this.width * 0.055;
        bigScale = 3.35;
        rootY = this.height * 1.47;
      } else if (index === 1) {
        x = this.width * 0.945;
        bigScale = 3.2;
        rootY = this.height * 1.44;
      } else if (index === 2) {
        x = this.width * 0.52;
        bigScale = 3.0;
        rootY = this.height * 1.56;
      } else {
        if (index % 2 === 0) {
          x = this.width * (0.04 + this._rng() * 0.34);
        } else {
          x = this.width * (0.62 + this._rng() * 0.34);
        }
        bigScale = 1.9 + this._rng() * 0.32;
        rootY = this.height * (1.06 + this._rng() * 0.26);
      }
      var p = this._makePlant(9, x, this._rng);
      p.scale = bigScale;
      p.height = (156 + this._rng() * 68) * bigScale * u;
      p.stemWidth = (0.95 + 1.5 * bigScale) * u;
      p.y = rootY;
      p.lean = (this._rng() - 0.5) * 0.1;
      p.stubH = p.height * (0.09 + this._rng() * 0.04);
      if (p.stems.length > 2) p.stems.length = 2;
      p.isHero = true;
      return p;
    }

    _buildFringe() {
      var n = this._fringeCount();
      var arr = [];
      var rng = this._rng;
      var u = this._u;
      var top = this._top;
      var h = this.height;
      for (var i = 0; i < n; i++) {
        arr.push({
          x: rng() * this.width,
          y: top + rng() * 0.05 * h,
          h: (11 + rng() * 30) * u,
          phase: rng() * TAU,
          lean: (rng() - 0.5) * 0.45
        });
      }
      this._fringe = arr;
    }

    _fringeCount() {
      return Math.round(this.width / 11);
    }

    _drawFringe(ctx, time) {
      var arr = this._fringe;
      if (!arr || !arr.length) return;
      var u = this._u;
      var i;
      var o;
      var sway;
      var tipX;
      var tipY;
      var E;
      var sn;
      var cs;
      var ux;
      var uy;
      var rx;
      var ry;
      var W;
      var j;
      var t;
      var prof;

      ctx.globalAlpha = 1;
      ctx.strokeStyle = FRINGE_COLORS.stem;
      ctx.lineWidth = Math.max(0.55, 1.0 * u);
      ctx.beginPath();
      for (i = 0; i < arr.length; i++) {
        o = arr[i];
        sway = Math.sin(time * 1.15 + o.phase + o.x * 0.012) * o.h * 0.2 + o.lean * o.h * 0.5;
        tipX = o.x + sway;
        tipY = o.y - o.h;
        o.tx = tipX;
        o.ty = tipY;
        ctx.moveTo(o.x, o.y);
        ctx.quadraticCurveTo(o.x + sway * 0.35, o.y - o.h * 0.55, tipX, tipY);
      }
      ctx.stroke();

      /* 极小的穗头 */
      ctx.fillStyle = FRINGE_COLORS.head;
      ctx.beginPath();
      for (i = 0; i < arr.length; i++) {
        o = arr[i];
        E = Math.max(5, o.h * 0.5);
        var ang = Math.atan2(o.tx - o.x, o.h * 0.75);
        sn = Math.sin(ang);
        cs = Math.cos(ang);
        ux = sn;
        uy = -cs;
        rx = cs;
        ry = sn;
        W = E * 0.16;
        for (j = 0; j <= 3; j++) {
          t = j / 3;
          prof = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
          var lx = o.tx + ux * E * t + rx * W * prof;
          var ly = o.ty + uy * E * t + ry * W * prof;
          if (j === 0) ctx.moveTo(lx, ly);
          else ctx.lineTo(lx, ly);
        }
        for (j = 3; j >= 0; j--) {
          t = j / 3;
          prof = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
          ctx.lineTo(o.tx + ux * E * t - rx * W * prof, o.ty + uy * E * t - ry * W * prof);
        }
        ctx.closePath();
      }
      ctx.fill();

      /* 芒 */
      ctx.strokeStyle = FRINGE_COLORS.awn;
      ctx.lineWidth = Math.max(0.35, 0.5 * u);
      ctx.beginPath();
      for (i = 0; i < arr.length; i++) {
        o = arr[i];
        E = Math.max(5, o.h * 0.5);
        var aa = Math.atan2(o.tx - o.x, o.h * 0.75);
        sn = Math.sin(aa);
        cs = Math.cos(aa);
        ux = sn;
        uy = -cs;
        rx = cs;
        ry = sn;
        var ax = o.tx + ux * E * 0.95;
        var ay = o.ty + uy * E * 0.95;
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + rx * E * 0.3 + ux * E * 0.5, ay + ry * E * 0.3 + uy * E * 0.5);
        ctx.moveTo(ax + rx * E * 0.1, ay + ry * E * 0.1);
        ctx.lineTo(ax - rx * E * 0.28 + ux * E * 0.45, ay - ry * E * 0.28 + uy * E * 0.45);
      }
      ctx.stroke();
    }

    _makePlant(rowIndex, x, rng) {
      var row = ROWS[rowIndex];
      var style = ROW_STYLES[rowIndex];
      var u = this._u;
      var scale = row.scale;
      var golden = rng() < this._goldenChance();
      var height = (156 + rng() * 68) * scale * u;
      if (golden) height *= 1.06;

      var isFar = scale < 0.5;
      var isNear = scale > 0.95;

      var stems = [];
      stems.push(this._makeStem(1, 0, rng));
      if (isFar) {
        if (rng() < 0.36) {
          stems.push(this._makeStem(
            0.58 + rng() * 0.24,
            (rng() < 0.5 ? -1 : 1) * (2 + rng() * 5) * u * scale,
            rng
          ));
        }
      } else {
        if (rng() < 0.86) {
          stems.push(this._makeStem(
            0.56 + rng() * 0.27,
            (rng() < 0.5 ? -1 : 1) * (2.5 + rng() * 7) * u * scale,
            rng
          ));
        }
        if (rng() < 0.3) {
          stems.push(this._makeStem(
            0.40 + rng() * 0.22,
            (rng() < 0.5 ? -1 : 1) * (1.5 + rng() * 4.5) * u * scale,
            rng
          ));
        }
        if (isNear && rng() < 0.55) {
          stems.push(this._makeStem(
            0.27 + rng() * 0.16,
            (rng() < 0.5 ? -1 : 1) * (2 + rng() * 6) * u * scale,
            rng
          ));
        }
      }

      var leaves = [];
      var leafCount = isFar ? 1 : (isNear ? (rng() < 0.7 ? 3 : 2) : 2);
      for (var i = 0; i < leafCount; i++) {
        leaves.push({
          t: 0.17 + i * 0.15 + rng() * 0.07,
          side: i % 2 === 0 ? -1 : 1,
          stemIdx: i % stems.length,
          v: (rng() * 4) | 0,
          len: (isFar ? 0.15 : 0.20) + rng() * 0.08,
          phase: rng() * TAU,
          x: 0, y: 0, rot: 0, lenPx: 0
        });
      }

      var p = {
        x: x,
        y: this._top + (row.t + (rng() - 0.5) * 0.024) * (this._bottom - this._top),
        row: rowIndex,
        style: style,
        scale: scale,
        height: height,
        golden: golden,
        stemWidth: (0.95 + 1.5 * scale) * u,
        stems: stems,
        leaves: leaves,
        phase: rng() * TAU,
        lean: (rng() - 0.5) * 0.13,
        headVar: (rng() * 6) | 0,
        state: STATE_STAND,
        growth: 1,
        growthScale: 1,
        growDur: 0.55,
        spawnGlow: 0,
        fallAngle: 0,
        fallVel: 0,
        fallTarget: 0,
        fallScale: 1,
        fade: 0,
        alpha: 1,
        landed: false,
        strawFade: 0,
        regrowAt: Infinity,
        stubH: height * (0.12 + rng() * 0.06),
        sway: 0,
        flutter: 0,
        visH: height
      };

      /* 让麦穗变体与株型相关，避免整齐重复 */
      for (var k = 0; k < stems.length; k++) {
        stems[k].headVar = (p.headVar + k * 2 + ((rng() * 3) | 0)) % 6;
        stems[k].tilt = (rng() - 0.5) * 0.05;
      }
      return p;
    }

    _makeStem(hf, dx, rng) {
      return {
        hf: hf,
        dx: dx,
        phaseOff: rng() * TAU * 0.5,
        tilt: 0,
        headVar: 0,
        x0: 0, y0: 0,
        c1x: 0, c1y: 0,
        c2x: 0, c2y: 0,
        tx: 0, ty: 0,
        hx: 0, hy: 0,
        ang: 0,
        headDisp: 0,
        earX: 0, earY: 0
      };
    }

    _goldenChance() {
      var c = 0.055 * this._goldenBoost * (this._frenzy ? 1.8 : 1);
      return Math.min(0.85, c);
    }

    _countStats() {
      var uncut = 0;
      var golden = 0;
      var plants = this._plants;
      for (var i = 0; i < plants.length; i++) {
        var p = plants[i];
        if (p.state === STATE_STAND) {
          uncut++;
          if (p.golden) golden++;
        }
      }
      this._stats.uncut = uncut;
      this._stats.golden = golden;
      this._stats.total = plants.length;
    }

    /* ------------------------------------------------------------ 每帧 */
    update(dt, time, env) {
      dt = +dt;
      if (!isFinite(dt) || dt < 0) dt = 0;
      if (dt > 0.1) dt = 0.1;
      time = +time;
      if (!isFinite(time)) time = this._time;
      this._time = time;
      this._clock += dt;

      env = env || {};
      var pointer = env.pointer || {};
      this._wind = clamp(+env.wind || 0, -1, 1);
      this._gust = clamp(+env.gust || 0, 0, 1);
      this._pointer.x = isFinite(+pointer.x) ? +pointer.x : -9999;
      this._pointer.y = isFinite(+pointer.y) ? +pointer.y : -9999;
      this._pointer.active = !!pointer.active;
      this._frenzy = !!env.frenzy;
      this._reduced = !!env.reduced;

      if (!this._built) return;

      /* 1) 金风前沿推进（本帧稍后统一割倒） */
      if (this._storm) {
        this._storm.t += dt;
        var prog = Math.min(1, this._storm.t / this._storm.dur);
        this._stormX = -40 + (this.width + 80) * prog;
      }

      /* 2) 状态机 / 物理 */
      var plants = this._plants;
      for (var i = 0; i < plants.length; i++) {
        var p = plants[i];
        if (p.strawFade > 0) {
          p.strawFade = Math.max(0, p.strawFade - dt / 0.8);
        }
        if (p.state === STATE_STUB) {
          if (this._clock >= p.regrowAt) this._startGrow(p);
        } else if (p.state === STATE_GROW) {
          p.growth += dt / p.growDur;
          if (p.growth >= 1) {
            p.growth = 1;
            p.growthScale = 1;
            p.state = STATE_STAND;
            p.spawnGlow = 0;
          } else {
            var g0 = p.growth;
            p.growthScale = 0.12 + 0.88 * (1 - (1 - g0) * (1 - g0) * (1 - g0));
            p.spawnGlow = Math.max(0, 1 - g0 * 1.5);
          }
        } else if (p.state === STATE_FALL) {
          var target = p.fallTarget;
          p.fallVel += (target - p.fallAngle) * 52 * dt;
          p.fallVel *= Math.exp(-5.6 * dt);
          p.fallAngle += p.fallVel * dt;
          if (p.fallAngle > 1.95) {
            p.fallAngle = 1.95;
            p.fallVel *= -0.18;
          } else if (p.fallAngle < -1.95) {
            p.fallAngle = -1.95;
            p.fallVel *= -0.18;
          }
          if (!p.landed && Math.abs(target - p.fallAngle) < 0.12 && Math.abs(p.fallVel) < 1.1) {
            p.landed = true;
          }
          if (p.landed) {
            p.fade += dt;
            p.alpha = Math.max(0, 1 - p.fade / 0.6);
            if (p.alpha <= 0) {
              p.state = STATE_STUB;
              p.alpha = 1;
              p.fade = 0;
              p.sway = 0;
            }
          }
        }
      }

      /* 3) 摆动 + 几何 */
      this._updateSwayAndGeometry(time);

      /* 4) 金风：逐帧从左向右割倒，事件进入 outbox */
      if (this._storm) {
        var front = this._stormX;
        var list = null;
        for (var j = 0; j < plants.length; j++) {
          var q = plants[j];
          if (q.x <= front + 10 && this._canCut(q)) {
            if (!list) list = [];
            list.push(q);
          }
        }
        if (list) {
          list.sort(function (a, b) { return a.x - b.x; });
          for (var k = 0; k < list.length; k++) {
            var evt = this._cutPlant(list[k], 1, 3.4);
            if (evt) this._events.push(evt);
          }
        }
        if (this._storm.t >= this._storm.dur) {
          this._storm = null;
          this._stormX = -9999;
        }
      }

      this._countStats();
    }

    _updateSwayAndGeometry(time) {
      var plants = this._plants;
      var u = this._u;
      var reducedAmp = this._reduced ? 0.42 : 1;
      var wind = this._wind;
      var gust = this._gust;
      var pointer = this._pointer;
      var storm = this._storm ? this._stormX : -9999;
      var stormZone = 230 * u;

      for (var i = 0; i < plants.length; i++) {
        var p = plants[i];
        if (p.state === STATE_STUB) {
          p.sway = 0;
          continue;
        }
        var vis = p.state === STATE_FALL ? p.fallScale : (p.state === STATE_GROW ? p.growthScale : 1);
        p.visH = p.height * vis;
        var H = p.visH;
        var phase = p.phase;

        var amp = H * (0.026 + gust * 0.075 + Math.abs(wind) * 0.02) * reducedAmp;
        var sway = Math.sin(time * 1.22 + phase + p.x * 0.0085) * amp * 0.62;
        sway += Math.sin(time * 0.57 + phase * 1.7 + p.y * 0.004) * amp * 0.38;
        sway += wind * H * 0.045;
        sway += Math.sin(time * 2.15 - p.x * 0.0037 + phase * 0.5) * H * (0.012 + gust * 0.05);

        /* 指针拂动 */
        var fl = 0;
        if (pointer.active) {
          var dxp = p.x - pointer.x;
          var dyp = (p.y - pointer.y) * 0.55;
          var R = 210 * u * (0.65 + p.scale * 0.35);
          var d2 = dxp * dxp + dyp * dyp;
          if (d2 < R * R) {
            var d = Math.sqrt(d2) + 0.001;
            var f = 1 - d / R;
            f *= f;
            fl = f;
            sway += (dxp >= 0 ? 1 : -1) * f * H * 0.15 * reducedAmp;
            sway += Math.sin(time * 10.5 + phase * 2.3) * f * H * 0.02 * reducedAmp;
          }
        }
        p.flutter = fl;

        /* 金风压弯尚未割倒的麦子 */
        if (this._storm) {
          var dF = p.x - storm;
          if (dF > -80 * u && dF < stormZone) {
            var ff = 1 - Math.abs(dF - 50 * u) / (stormZone + 60 * u);
            if (ff > 0) sway += ff * ff * H * 0.14;
          }
        }

        if (p.state === STATE_FALL) {
          sway *= Math.max(0, 1 - Math.abs(p.fallAngle) / 1.8);
        }
        p.sway = sway;

        this._updatePlantGeometry(p, time);
      }
    }

    _updatePlantGeometry(p, time) {
      var H = p.visH;
      var cf = Math.cos(p.fallAngle);
      var sf = Math.sin(p.fallAngle);
      var falling = p.fallAngle !== 0;
      var stems = p.stems;

      for (var s = 0; s < stems.length; s++) {
        var st = stems[s];
        var hf = st.hf;
        var sH = H * 0.58 * hf;
        var bx = p.x + st.dx;
        var by = p.y;
        var sway = p.sway * (0.55 + 0.45 * hf) +
          Math.sin(time * 1.9 + p.phase + st.phaseOff) * sH * 0.018 * (0.4 + this._gust * 1.6) *
          (this._reduced ? 0.4 : 1);
        var lean = p.lean + st.tilt;

        var c1x = bx + sway * 0.10 + lean * sH * 0.12;
        var c1y = by - sH * 0.36;
        var c2x = bx + sway * 0.55 + lean * sH * 0.55;
        var c2y = by - sH * 0.78;
        var tx = bx + sway + lean * sH;
        var ty = by - sH;

        if (falling) {
          var dx = c1x - bx;
          var dy = c1y - by;
          c1x = bx + dx * cf - dy * sf;
          c1y = by + dx * sf + dy * cf;
          dx = c2x - bx;
          dy = c2y - by;
          c2x = bx + dx * cf - dy * sf;
          c2y = by + dx * sf + dy * cf;
          dx = tx - bx;
          dy = ty - by;
          tx = bx + dx * cf - dy * sf;
          ty = by + dx * sf + dy * cf;
        }

        st.x0 = bx;
        st.y0 = by;
        st.c1x = c1x;
        st.c1y = c1y;
        st.c2x = c2x;
        st.c2y = c2y;
        st.tx = tx;
        st.ty = ty;

        st.ang = Math.atan2(tx - c2x, c2y - ty);
        var headDisp = H * 0.55 * hf * (p.golden ? 1.07 : 1);
        st.headDisp = headDisp;
        st.earX = tx + Math.sin(st.ang) * headDisp * HEAD_TIP_FROM_BASE;
        st.earY = ty - Math.cos(st.ang) * headDisp * HEAD_TIP_FROM_BASE;

        /* 上段茎取样点（用于切割命中，取 t=0.72） */
        var ht = 0.72;
        var mt = 1 - ht;
        var a = mt * mt * mt;
        var b = 3 * mt * mt * ht;
        var c = 3 * mt * ht * ht;
        var d = ht * ht * ht;
        st.hx = a * bx + b * c1x + c * c2x + d * tx;
        st.hy = a * by + b * c1y + c * c2y + d * ty;
      }

      /* 叶片分别挂在不同的茎上 */
      var leaves = p.leaves;
      for (var l = 0; l < leaves.length; l++) {
        var lf = leaves[l];
        var main = stems[lf.stemIdx % stems.length];
        var t = lf.t;
        var mt2 = 1 - t;
        var aa = mt2 * mt2 * mt2;
        var bb = 3 * mt2 * mt2 * t;
        var cc = 3 * mt2 * t * t;
        var dd = t * t * t;
        lf.x = aa * main.x0 + bb * main.c1x + cc * main.c2x + dd * main.tx;
        lf.y = aa * main.y0 + bb * main.c1y + cc * main.c2y + dd * main.ty;
        var dxdt = 3 * mt2 * mt2 * (main.c1x - main.x0) +
          6 * mt2 * t * (main.c2x - main.c1x) +
          3 * t * t * (main.tx - main.c2x);
        var dydt = 3 * mt2 * mt2 * (main.c1y - main.y0) +
          6 * mt2 * t * (main.c2y - main.c1y) +
          3 * t * t * (main.ty - main.c2y);
        var tang = Math.atan2(dxdt, -dydt);
        lf.rot = tang + lf.side * (0.72 + lf.v * 0.13) +
          Math.sin(time * 2.4 + lf.phase) * 0.05 +
          p.sway * 0.0035 +
          Math.sin(time * 9.5 + lf.phase) * p.flutter * 0.16;
        lf.lenPx = H * lf.len;
      }
    }

    _startGrow(p) {
      p.state = STATE_GROW;
      p.growth = 0;
      p.growthScale = 0.12;
      p.growDur = (this._frenzy ? 0.32 : 0.55);
      p.spawnGlow = 1;
      p.alpha = 1;
      p.fade = 0;
      p.landed = false;
      p.fallAngle = 0;
      p.fallVel = 0;
      p.fallScale = 1;
      p.regrowAt = Infinity;
      p.golden = this._rng() < this._goldenChance();
      p.headVar = (this._rng() * 6) | 0;
      for (var i = 0; i < p.stems.length; i++) {
        p.stems[i].headVar = (this._rng() * 6) | 0;
      }
    }

    _canCut(p) {
      if (p.state === STATE_STAND) return true;
      if (p.state === STATE_GROW && p.growth > 0.5) return true;
      return false;
    }

    /* 内部：割倒一株；返回事件对象 */
    _cutPlant(p, dir, speed) {
      var st = p.stems[0];
      var vis = p.state === STATE_GROW ? p.growthScale : 1;
      var event = {
        x: st.earX,
        y: st.earY,
        golden: p.golden,
        scale: p.scale * (p.golden ? 1.1 : 1) * Math.max(0.6, vis),
        angle: st.ang
      };

      p.state = STATE_FALL;
      p.fallAngle = 0;
      p.fallVel = dir * (4.6 + Math.min(7, Math.abs(speed) * 1.5) + this._rng() * 2.6);
      p.fallTarget = dir * (1.18 + this._rng() * 0.34);
      p.landed = false;
      p.fade = 0;
      p.alpha = 1;
      p.fallScale = Math.max(0.25, vis);
      var delay = this._frenzy ? (0.9 + this._rng() * 1.1) : (3.0 + this._rng() * 3.0);
      p.regrowAt = this._clock + delay * this.regrowScale;
      p.stubH = clamp(p.height * vis * (0.08 + this._rng() * 0.05), 4, 30 * this._u);
      p.strawFade = 1;
      return event;
    }

    /* ------------------------------------------------------------- 切割 */
    cut(x0, y0, x1, y1, speed, force) {
      var out = [];
      if (!this._built) return out;
      if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) return out;
      speed = +speed;
      if (!isFinite(speed)) speed = 0;
      if (!force && speed < 0.3) return out;

      var dx = x1 - x0;
      var dy = y1 - y0;
      var len2 = dx * dx + dy * dy;
      var dir;
      if (Math.abs(dx) >= Math.abs(dy) * 0.35) {
        dir = dx >= 0 ? 1 : -1;
      } else {
        dir = this._rng() < 0.5 ? -1 : 1;
      }

      var plants = this._plants;
      for (var i = 0; i < plants.length; i++) {
        var p = plants[i];
        if (!this._canCut(p)) continue;
        var st = p.stems[0];
        var r = (26 + 14 * p.scale) * (this._cutRange || 1) * (p.golden ? 1.35 : 1);
        var r2 = r * r;

        /* 三个采样点：穗尖 / 穗颈 / 茎上部 */
        var hit = false;
        var px = st.earX;
        var py = st.earY;
        if (len2 < 1e-6) {
          var ax = px - x0;
          var ay = py - y0;
          if (ax * ax + ay * ay <= r2) hit = true;
        } else {
          if (distToSeg2(px, py, x0, y0, dx, dy, len2) <= r2) hit = true;
        }
        if (!hit) {
          px = st.tx;
          py = st.ty;
          if (len2 < 1e-6) {
            var bx2 = px - x0;
            var by2 = py - y0;
            if (bx2 * bx2 + by2 * by2 <= r2) hit = true;
          } else if (distToSeg2(px, py, x0, y0, dx, dy, len2) <= r2) {
            hit = true;
          }
        }
        if (!hit) {
          px = st.hx;
          py = st.hy;
          if (len2 < 1e-6) {
            var cx2 = px - x0;
            var cy2 = py - y0;
            if (cx2 * cx2 + cy2 * cy2 <= r2) hit = true;
          } else if (distToSeg2(px, py, x0, y0, dx, dy, len2) <= r2) {
            hit = true;
          }
        }
        if (!hit) continue;

        var evt = this._cutPlant(p, dir, speed);
        if (evt) {
          out.push(evt);
          this._events.push(evt);
        }
      }
      this._countStats();
      return out;
    }

    /* ------------------------------------------------------------- 金风 */
    stormCut() {
      if (!this._built) return;
      this._storm = { t: 0, dur: 1.1 };
      this._stormX = -40;
    }

    getStormProgress() {
      if (!this._storm) return -1;
      return clamp(this._storm.t / this._storm.dur, 0, 1);
    }

    drainEvents() {
      var out = this._events;
      if (out.length === 0) return out;
      this._events = [];
      return out;
    }

    getStats() {
      return {
        uncut: this._stats.uncut,
        total: this._stats.total,
        golden: this._stats.golden
      };
    }

    setGoldenBoost(mult) {
      var m = +mult;
      this._goldenBoost = (isFinite(m) && m > 0) ? m : 1;
    }

    setCutRange(mult) {
      var m = +mult;
      this._cutRange = (isFinite(m) && m > 0) ? m : 1;
    }

    /* -------------------------------------------------------------- 绘制 */
    draw(ctx, opts) {
      if (!ctx || !this._built) return;
      opts = opts || {};
      var time = isFinite(+opts.time) ? +opts.time : this._time;
      var frenzy = clamp(+opts.frenzy || 0, 0, 1);

      if (!this._sprites) this._ensureSprites();
      if (!this._sprites) return;

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      var plants = this._plants;
      this._drawFringe(ctx, time);
      if (this.fastMode) {
        this._drawStandingPrep(ctx);
        this._drawBatchedLeaves(ctx, true);
        this._drawBatchedStems(ctx);
        this._drawBatchedLeaves(ctx, false);
        this._drawBatchedHeads(ctx, time, frenzy);
        for (var i = 0; i < plants.length; i++) {
          var p = plants[i];
          if (p.state === STATE_FALL || p.state === STATE_GROW) {
            this._drawPlant(ctx, p, time, frenzy, false);
          }
        }
      } else {
        for (var j = 0; j < plants.length; j++) {
          this._drawPlant(ctx, plants[j], time, frenzy, false);
        }
      }
      this._drawFog(ctx);

      /* 金风扫场光带（预渲染纹理 + lighter，无 filter） */
      if (this._storm) {
        var prog = clamp(this._storm.t / this._storm.dur, 0, 1);
        var x = -40 + (this.width + 80) * prog;
        var fade = Math.sin(Math.min(1, prog) * PI);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.42 + frenzy * 0.12) * fade * (this._reduced ? 0.6 : 1);
        var bandW = 240 * this._u;
        var bandY = this._top - 30 * this._u;
        var bandH = this.height - bandY + 40 * this._u;
        ctx.drawImage(this._sprites.sweep, x - bandW * 0.5, bandY, bandW, bandH);
        ctx.restore();
      }

      ctx.restore();
    }

    _drawFog(ctx) {
      var u = this._u;
      var top = this._top - 30 * u;
      var h = 100 * u;
      var key = this.width + 'x' + this.height;
      if (!this._fogGrad || this._fogCtx !== ctx || this._fogKey !== key) {
        var grad = ctx.createLinearGradient(0, top, 0, top + h);
        grad.addColorStop(0, 'rgba(240,198,134,0)');
        grad.addColorStop(0.14, 'rgba(239,195,128,0.07)');
        grad.addColorStop(0.34, 'rgba(236,190,120,0.18)');
        grad.addColorStop(0.54, 'rgba(233,183,112,0.22)');
        grad.addColorStop(0.76, 'rgba(229,174,98,0.10)');
        grad.addColorStop(1, 'rgba(225,166,90,0)');
        this._fogGrad = grad;
        this._fogCtx = ctx;
        this._fogKey = key;
        this._fogTop = top;
        this._fogH = h;
      }
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = this._fogGrad;
      ctx.fillRect(0, this._fogTop, this.width, this._fogH);
      ctx.globalAlpha = 1;
    }

    /* 站立植株的前置层：残茬、根部阴影、金色/前景主株的茎 */
    _drawStandingPrep(ctx) {
      var plants = this._plants;
      for (var i = 0; i < plants.length; i++) {
        var p = plants[i];
        var st = p.style;
        if (p.state === STATE_STUB) {
          ctx.globalAlpha = st.alpha;
          this._drawStubble(ctx, p, 1);
          continue;
        }
        if (p.state !== STATE_STAND) continue;
        if (p.scale > 0.62 && st.shadowAlpha > 0.01) {
          var sw = p.visH * 0.36;
          ctx.globalAlpha = st.alpha * st.shadowAlpha;
          ctx.drawImage(
            this._sprites.shadow,
            p.x - sw * 0.5 - sw * 0.18,
            p.y - sw * 0.08,
            sw,
            sw * 0.3
          );
        }
        if (p.golden || p.isHero) {
          ctx.globalAlpha = st.alpha;
          for (var s = 0; s < p.stems.length; s++) {
            this._drawStem(ctx, p, p.stems[s], st, s);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    /* 成片叶片：按色阶批量填充/描线 */
    _drawBatchedLeaves(ctx, back) {
      var plants = this._plants;
      var tier;
      var i;
      var p;
      var l;
      var leaves;
      var any;
      for (tier = 0; tier < 3; tier++) {
        var col = LEAF_VEC_COLORS[tier];
        ctx.globalAlpha = HEAD_TIER_ALPHA[tier];

        any = false;
        ctx.beginPath();
        for (i = 0; i < plants.length; i++) {
          p = plants[i];
          if (p.state !== STATE_STAND || p.style.leafTier !== tier) continue;
          leaves = p.leaves;
          for (l = 0; l < leaves.length; l++) {
            if ((l === 0) !== back) continue;
            if (appendLeafShape(ctx, leaves[l], 0)) any = true;
          }
        }
        if (any) {
          ctx.fillStyle = col.base;
          ctx.fill();
        }

        if (tier < 2) {
          any = false;
          ctx.beginPath();
          for (i = 0; i < plants.length; i++) {
            p = plants[i];
            if (p.state !== STATE_STAND || p.style.leafTier !== tier) continue;
            leaves = p.leaves;
            for (l = 0; l < leaves.length; l++) {
              if ((l === 0) !== back) continue;
              if (appendLeafShape(ctx, leaves[l], 1)) any = true;
            }
          }
          if (any) {
            ctx.fillStyle = col.mid;
            ctx.fill();
          }
        }

        any = false;
        ctx.beginPath();
        for (i = 0; i < plants.length; i++) {
          p = plants[i];
          if (p.state !== STATE_STAND || p.style.leafTier !== tier) continue;
          leaves = p.leaves;
          for (l = 0; l < leaves.length; l++) {
            if ((l === 0) !== back) continue;
            if (appendLeafShape(ctx, leaves[l], 2)) any = true;
          }
        }
        if (any) {
          ctx.strokeStyle = col.vein;
          ctx.lineWidth = 0.55;
          ctx.stroke();
        }

        any = false;
        ctx.beginPath();
        for (i = 0; i < plants.length; i++) {
          p = plants[i];
          if (p.state !== STATE_STAND || p.style.leafTier !== tier) continue;
          leaves = p.leaves;
          for (l = 0; l < leaves.length; l++) {
            if ((l === 0) !== back) continue;
            if (appendLeafShape(ctx, leaves[l], 3)) any = true;
          }
        }
        if (any) {
          ctx.strokeStyle = col.rim;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    /* 成片茎：按行批量描边 */
    _drawBatchedStems(ctx) {
      var plants = this._plants;
      var r;
      var i;
      var p;
      var s;
      var st;
      var any;
      for (r = 0; r < ROWS.length; r++) {
        var row = ROWS[r];
        var style = ROW_STYLES[r];
        var w = (0.95 + 1.5 * row.scale) * this._u;
        ctx.globalAlpha = style.alpha;

        any = false;
        ctx.beginPath();
        for (i = 0; i < plants.length; i++) {
          p = plants[i];
          if (p.state !== STATE_STAND || p.row !== r || p.golden || p.isHero) continue;
          for (s = 0; s < p.stems.length; s++) {
            st = p.stems[s];
            ctx.moveTo(st.x0, st.y0);
            ctx.bezierCurveTo(st.c1x, st.c1y, st.c2x, st.c2y, st.tx, st.ty);
            any = true;
          }
        }
        if (any) {
          ctx.strokeStyle = style.stemDark;
          ctx.lineWidth = w;
          ctx.stroke();
        }

        if (row.scale > 0.85) {
          var ox = w * 0.3;
          var oy = -w * 0.08;
          any = false;
          ctx.beginPath();
          for (i = 0; i < plants.length; i++) {
            p = plants[i];
            if (p.state !== STATE_STAND || p.row !== r || p.golden || p.isHero) continue;
            for (s = 0; s < p.stems.length; s++) {
              st = p.stems[s];
              ctx.moveTo(st.x0 + ox, st.y0);
              ctx.bezierCurveTo(st.c1x + ox, st.c1y + oy, st.c2x + ox, st.c2y + oy, st.tx + ox, st.ty);
              any = true;
            }
          }
          if (any) {
            ctx.globalAlpha = style.alpha * 0.7;
            ctx.strokeStyle = style.stemLight;
            ctx.lineWidth = Math.max(0.5, w * 0.28);
            ctx.stroke();
            ctx.globalAlpha = style.alpha;
          }
        }

        if (r === 9) {
          any = false;
          ctx.beginPath();
          for (i = 0; i < plants.length; i++) {
            p = plants[i];
            if (p.state !== STATE_STAND || p.row !== r || p.golden || p.isHero) continue;
            for (s = 0; s < p.stems.length; s++) {
              st = p.stems[s];
              var mt = 0.5;
              var a = mt * mt * mt;
              var b = 3 * mt * mt * mt;
              var c = 3 * mt * mt * mt;
              var d = mt * mt * mt;
              var nx = a * st.x0 + b * st.c1x + c * st.c2x + d * st.tx;
              var ny = a * st.y0 + b * st.c1y + c * st.c2y + d * st.ty;
              ctx.moveTo(nx - w * 0.8, ny + w * 0.4);
              ctx.lineTo(nx + w * 0.8, ny - w * 0.5);
              any = true;
            }
          }
          if (any) {
            ctx.strokeStyle = style.stemLight;
            ctx.lineWidth = Math.max(0.6, w * 0.45);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    /* 站立麦穗统一批处理：按色阶一次性 fill/stroke，减少状态切换 */
    _drawBatchedHeads(ctx, time, frenzy) {
      var plants = this._plants;
      var i;
      var s;
      var p;
      var st;
      var tier;
      var v;
      var any;

      for (tier = 0; tier < 3; tier++) {
        ctx.globalAlpha = HEAD_TIER_ALPHA[tier];

        for (v = 0; v < 6; v++) {
          var col = HEAD_VEC_COLORS[tier][v];
          any = false;
          ctx.beginPath();
          for (i = 0; i < plants.length; i++) {
            p = plants[i];
            if (p.state !== STATE_STAND || p.golden || p.isHero || p.style.headTier !== tier) continue;
            for (s = 0; s < p.stems.length; s++) {
              st = p.stems[s];
              if (st.headVar % 6 !== v) continue;
              if (appendHeadShape(ctx, st, HEAD_SHAPES[v])) any = true;
            }
          }
          if (!any) continue;
          ctx.fillStyle = col.mid;
          ctx.fill();
          ctx.strokeStyle = col.deep;
          ctx.lineWidth = tier === 2 ? 0.5 : (tier === 1 ? 0.6 : 0.75);
          ctx.stroke();

          /* 阳面暖光带，增加麦穗体积 */
          any = false;
          ctx.beginPath();
          for (i = 0; i < plants.length; i++) {
            p = plants[i];
            if (p.state !== STATE_STAND || p.golden || p.isHero || p.style.headTier !== tier) continue;
            for (s = 0; s < p.stems.length; s++) {
              st = p.stems[s];
              if (st.headVar % 6 !== v) continue;
              if (appendHeadLight(ctx, st)) any = true;
            }
          }
          if (any) {
            ctx.globalAlpha = HEAD_TIER_ALPHA[tier] * 0.55;
            ctx.fillStyle = col.light;
            ctx.fill();
            ctx.globalAlpha = HEAD_TIER_ALPHA[tier];
          }
        }

        /* 小穗横纹 */
        var baseCol = HEAD_VEC_COLORS[tier][0];
        any = false;
        ctx.beginPath();
        for (i = 0; i < plants.length; i++) {
          p = plants[i];
          if (p.state !== STATE_STAND || p.golden || p.isHero || p.style.headTier !== tier) continue;
          for (s = 0; s < p.stems.length; s++) {
            st = p.stems[s];
            if (appendHeadSpikes(ctx, st)) any = true;
          }
        }
        if (any) {
          ctx.globalAlpha = HEAD_TIER_ALPHA[tier] * 0.72;
          ctx.strokeStyle = baseCol.deep;
          ctx.lineWidth = tier === 2 ? 0.45 : (tier === 1 ? 0.7 : 0.9);
          ctx.stroke();
          ctx.globalAlpha = HEAD_TIER_ALPHA[tier];
        }

        /* 芒 */
        any = false;
        ctx.beginPath();
        for (i = 0; i < plants.length; i++) {
          p = plants[i];
          if (p.state !== STATE_STAND || p.golden || p.isHero || p.style.headTier !== tier) continue;
          for (s = 0; s < p.stems.length; s++) {
            st = p.stems[s];
            if (appendHeadAwns(ctx, st)) any = true;
          }
        }
        if (any) {
          ctx.strokeStyle = baseCol.awn;
          ctx.lineWidth = tier === 2 ? 0.5 : (tier === 1 ? 0.65 : 0.8);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;

      /* 金色穗与前景主视觉：预渲染精灵，数量很少 */
      for (i = 0; i < plants.length; i++) {
        p = plants[i];
        if (p.state !== STATE_STAND || (!p.golden && !p.isHero)) continue;
        ctx.globalAlpha = p.style.alpha;
        for (s = 0; s < p.stems.length; s++) {
          this._drawSpriteHead(ctx, p, p.stems[s], p.style, time, frenzy, p.style.alpha);
        }
      }
      ctx.globalAlpha = 1;
    }

    _drawPlant(ctx, p, time, frenzy, deferHeads) {
      var style = p.style;

      if (p.state === STATE_STUB) {
        ctx.globalAlpha = style.alpha;
        this._drawStubble(ctx, p, 1);
        return;
      }

      var growA = p.state === STATE_GROW ? Math.min(1, 0.25 + p.growth * 1.35) : 1;
      var baseAlpha = p.alpha * style.alpha * growA;
      if (baseAlpha <= 0.008) return;

      /* 生长时先画残茬，随抽穗淡出 */
      if (p.state === STATE_GROW) {
        var sa = Math.max(0, 1 - p.growth * 2.4) * style.alpha;
        if (sa > 0.01) {
          ctx.globalAlpha = sa;
          this._drawStubble(ctx, p, 1);
        }
      } else if (p.state === STATE_FALL && p.fallAngle < 0.9) {
        ctx.globalAlpha = baseAlpha;
        this._drawStubble(ctx, p, 1);
      }

      ctx.globalAlpha = baseAlpha;

      /* 根部接触阴影（远景省略） */
      if (p.scale > 0.62 && style.shadowAlpha > 0.01) {
        var sw = p.visH * 0.36;
        ctx.globalAlpha = baseAlpha * style.shadowAlpha;
        ctx.drawImage(
          this._sprites.shadow,
          p.x - sw * 0.5 - sw * 0.18,
          p.y - sw * 0.08,
          sw,
          sw * 0.3
        );
        ctx.globalAlpha = baseAlpha;
      }

      var leaves = p.leaves;
      if (leaves.length) this._drawLeaf(ctx, p, leaves[0], style, time);

      var stems = p.stems;
      for (var s = 0; s < stems.length; s++) {
        this._drawStem(ctx, p, stems[s], style, s);
      }

      for (var li = 1; li < leaves.length; li++) {
        this._drawLeaf(ctx, p, leaves[li], style, time);
      }

      for (var h = 0; h < stems.length; h++) {
        if (!deferHeads || p.state !== STATE_STAND) {
          this._drawHead(ctx, p, stems[h], style, time, frenzy, baseAlpha);
        }
      }

      /* 重生微光 */
      if (p.state === STATE_GROW && p.spawnGlow > 0.01) {
        var gr = p.visH * 0.62;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = baseAlpha * p.spawnGlow * 0.32;
        ctx.drawImage(
          this._sprites.glow,
          p.x - gr * 0.5,
          p.y - p.visH - gr * 0.1,
          gr,
          gr
        );
        ctx.restore();
      }
    }

    _drawStem(ctx, p, st, style, index) {
      var golden = p.golden;
      var w = p.stemWidth;
      ctx.strokeStyle = golden ? style.goldStemDark : style.stemDark;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(st.x0, st.y0);
      ctx.bezierCurveTo(st.c1x, st.c1y, st.c2x, st.c2y, st.tx, st.ty);
      ctx.stroke();

      /* 阳面细高光：向右侧偏移，形成圆润的茎（仅近景） */
      if (p.scale > 0.85) {
        var ox = w * 0.3;
        var oy = -w * 0.08;
        ctx.strokeStyle = golden ? style.goldStemLight : style.stemLight;
        ctx.lineWidth = Math.max(0.5, w * 0.28);
        ctx.globalAlpha *= 0.7;
        ctx.beginPath();
        ctx.moveTo(st.x0 + ox, st.y0);
        ctx.bezierCurveTo(st.c1x + ox, st.c1y + oy, st.c2x + ox, st.c2y + oy, st.tx + ox, st.ty);
        ctx.stroke();
        ctx.globalAlpha /= 0.7;
      }

      /* 近景茎节，增加细节（只画主茎） */
      if (p.scale > 1.0 && index === 0) {
        var t = 0.5;
        var mt = 1 - t;
        var a = mt * mt * mt;
        var b = 3 * mt * mt * t;
        var c = 3 * mt * t * t;
        var d = t * t * t;
        var nx = a * st.x0 + b * st.c1x + c * st.c2x + d * st.tx;
        var ny = a * st.y0 + b * st.c1y + c * st.c2y + d * st.ty;
        ctx.strokeStyle = golden ? style.goldStemLight : style.stemLight;
        ctx.lineWidth = Math.max(0.6, w * 0.45);
        ctx.beginPath();
        ctx.moveTo(nx - w * 0.8, ny + w * 0.4);
        ctx.lineTo(nx + w * 0.8, ny - w * 0.5);
        ctx.stroke();
      }
    }

    _drawLeaf(ctx, p, lf, style, time) {
      var img = this._sprites.leaves[style.leafTier][lf.v % 4];
      var len = lf.lenPx;
      if (len < 1) return;
      var dispH = len / LEAF_BASE_FRAC;
      var dispW = dispH * (LEAF_W / LEAF_H);
      ctx.save();
      ctx.translate(lf.x, lf.y);
      ctx.rotate(lf.rot);
      if (lf.side < 0) ctx.scale(-1, 1);
      ctx.drawImage(img, -dispW * 0.5, -len, dispW, dispH);
      ctx.restore();
    }

    _drawHead(ctx, p, st, style, time, frenzy, baseAlpha) {
      /* 默认使用预渲染精灵（6 变体 + 金色）；fastMode 下普通麦穗走批量矢量。 */
      if (!this.fastMode || p.golden || p.isHero) {
        this._drawSpriteHead(ctx, p, st, style, time, frenzy, baseAlpha);
      } else {
        this._drawVectorHead(ctx, st, style);
      }
    }

    _drawSpriteHead(ctx, p, st, style, time, frenzy, baseAlpha) {
      var tier = style.headTier;
      var sprite = p.golden
        ? this._sprites.goldHeads[tier]
        : this._sprites.heads[tier][st.headVar % 6];
      var dispH = st.headDisp;
      if (dispH < 1) return;
      var dispW = dispH * (HEAD_W / HEAD_H);

      ctx.save();
      ctx.translate(st.tx, st.ty);
      ctx.rotate(st.ang);
      ctx.drawImage(
        sprite,
        -dispW * 0.5,
        -dispH * HEAD_BASE_FRAC,
        dispW,
        dispH
      );
      ctx.restore();

      if (!p.golden) return;

      var pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + p.phase * 1.3 + st.phaseOff);
      var boost = 1 + frenzy * 0.7;
      var ex = (st.tx + st.earX) * 0.5;
      var ey = (st.ty + st.earY) * 0.5;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var gr = dispH * 1.05;
      ctx.globalAlpha = Math.min(1, baseAlpha * (0.085 + 0.065 * pulse) * boost);
      ctx.drawImage(
        this._sprites.glow,
        ex - gr * 0.5,
        ey - gr * 0.5,
        gr,
        gr
      );

      for (var k = 0; k < (p.scale > 0.85 ? 2 : 1); k++) {
        var a = time * (1.15 + k * 0.45) + p.phase + k * 2.1 + st.phaseOff;
        var sx = ex + Math.cos(a * 1.3 + k) * dispH * 0.45;
        var sy = ey + Math.sin(a * 1.7 + k) * dispH * 0.36;
        var ss = (0.7 + 0.95 * p.scale) * (0.72 + 0.45 * Math.sin(time * 3.1 + a));
        if (ss < 0.45) continue;
        ctx.globalAlpha = Math.min(1, baseAlpha * (0.22 + 0.3 * pulse));
        ctx.drawImage(
          this._sprites.star,
          sx - ss,
          sy - ss,
          ss * 2,
          ss * 2
        );
      }
      ctx.restore();
    }

    _drawVectorHead(ctx, st, style) {
      var v = st.headVar % 6;
      var shape = HEAD_SHAPES[v];
      var col = HEAD_VEC_COLORS[style.headTier][v];
      var E = st.headDisp * 0.82;
      if (E < 1) return;

      var sn = Math.sin(st.ang);
      var cs = Math.cos(st.ang);
      var ux = sn;
      var uy = -cs;
      var rx = cs;
      var ry = sn;
      var bx = st.tx;
      var by = st.ty;
      var W = E * 0.098 * shape.width;
      var bend = shape.bend * E * 0.035;
      var far = E < 28;
      var N = far ? 4 : 7;
      var levels = far ? 4 : 9;
      var i;
      var t;
      var w;
      var o;
      var profile;

      /* 麦穗剪影（暗部），边缘做出小穗起伏 */
      ctx.fillStyle = col.deep;
      ctx.beginPath();
      for (i = 0; i <= N; i++) {
        t = i / N;
        profile = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
        o = bend * Math.sin(PI * t);
        w = W * profile * (0.86 + 0.14 * Math.abs(Math.sin(t * levels * PI)));
        var px = bx + ux * E * t + rx * (o + w);
        var py = by + uy * E * t + ry * (o + w);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      for (i = N; i >= 0; i--) {
        t = i / N;
        profile = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
        o = bend * Math.sin(PI * t);
        w = W * profile * (0.86 + 0.14 * Math.abs(Math.sin(t * levels * PI + 0.6)));
        ctx.lineTo(bx + ux * E * t + rx * (o - w), by + uy * E * t + ry * (o - w));
      }
      ctx.closePath();
      ctx.fill();

      /* 阳面麦身，偏右收窄 */
      ctx.fillStyle = col.mid;
      ctx.beginPath();
      for (i = 0; i <= N; i++) {
        t = i / N;
        profile = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
        o = bend * Math.sin(PI * t) + W * 0.18;
        w = W * 0.6 * profile;
        var qx = bx + ux * E * t + rx * (o + w);
        var qy = by + uy * E * t + ry * (o + w);
        if (i === 0) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      }
      for (i = N; i >= 0; i--) {
        t = i / N;
        profile = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
        o = bend * Math.sin(PI * t) + W * 0.18;
        w = W * 0.6 * profile;
        ctx.lineTo(bx + ux * E * t + rx * (o - w), by + uy * E * t + ry * (o - w));
      }
      ctx.closePath();
      ctx.fill();

      /* 穗尖亮部 */
      ctx.fillStyle = col.tip;
      ctx.beginPath();
      for (i = 0; i <= 3; i++) {
        t = 0.72 + i * 0.09;
        profile = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
        w = W * 0.42 * profile;
        o = bend * Math.sin(PI * t) + W * 0.16;
        var tx = bx + ux * E * t + rx * (o + w);
        var ty = by + uy * E * t + ry * (o + w);
        if (i === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      for (i = 3; i >= 0; i--) {
        t = 0.72 + i * 0.09;
        profile = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
        w = W * 0.42 * profile;
        o = bend * Math.sin(PI * t) + W * 0.16;
        ctx.lineTo(bx + ux * E * t + rx * (o - w), by + uy * E * t + ry * (o - w));
      }
      ctx.closePath();
      ctx.fill();

      /* 小穗横纹（麦粒质感） */
      if (!far) {
        ctx.strokeStyle = col.spike;
        ctx.lineWidth = Math.max(0.5, E * 0.007);
        ctx.beginPath();
        for (i = 1; i <= levels; i++) {
          t = i / (levels + 1);
          profile = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
          o = bend * Math.sin(PI * t);
          w = W * profile;
          ctx.moveTo(bx + ux * E * t + rx * (o - w * 0.92), by + uy * E * t + ry * (o - w * 0.92));
          ctx.quadraticCurveTo(
            bx + ux * E * (t + 0.024) + rx * o, by + uy * E * (t + 0.024) + ry * o,
            bx + ux * E * t + rx * (o + w * 0.92), by + uy * E * t + ry * (o + w * 0.92)
          );
        }
        ctx.stroke();

        /* 缝线 */
        ctx.strokeStyle = col.shadow;
        ctx.lineWidth = Math.max(0.4, E * 0.005);
        ctx.beginPath();
        ctx.moveTo(bx + ux * E * 0.08, by + uy * E * 0.08);
        for (i = 1; i <= 6; i++) {
          t = i / 7;
          ctx.lineTo(bx + ux * E * t + rx * bend * Math.sin(PI * t), by + uy * E * t + ry * bend * Math.sin(PI * t));
        }
        ctx.stroke();
      }

      /* 芒：更长、更醒目 */
      var awns = far ? 6 : (E > 60 ? 15 : 10);
      ctx.strokeStyle = col.awn;
      ctx.lineWidth = Math.max(0.4, Math.min(1.0, E * 0.006));
      ctx.beginPath();
      for (i = 0; i < awns; i++) {
        t = 0.06 + (i / Math.max(1, awns - 1)) * 0.88;
        profile = Math.sin(PI * Math.pow(t, 0.7)) * (1 - t * 0.12);
        o = bend * Math.sin(PI * t);
        w = W * profile;
        var side = (i % 2 === 0) ? 1 : -1;
        var ax = bx + ux * E * t + rx * (o + side * w * 0.9);
        var ay = by + uy * E * t + ry * (o + side * w * 0.9);
        var alen = E * (0.26 + 0.2 * t) * shape.awn * (0.88 + 0.22 * Math.sin(i * 2.7 + st.phaseOff * 3.1));
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(
          ax + rx * side * alen * 0.12 + ux * alen * 0.4,
          ay + ry * side * alen * 0.12 + uy * alen * 0.4,
          ax + rx * side * alen * 0.3 + ux * alen * 0.98,
          ay + ry * side * alen * 0.3 + uy * alen * 0.98
        );
      }
      /* 顶部冠芒 */
      for (i = 0; i < 3; i++) {
        var cxs = bx + ux * E * 0.99 + rx * (i - 1) * W * 0.2;
        var cys = by + uy * E * 0.99 + ry * (i - 1) * W * 0.2;
        var clen = E * (0.34 + 0.07 * i) * shape.awn;
        ctx.moveTo(cxs, cys);
        ctx.quadraticCurveTo(
          cxs + ux * clen * 0.4, cys + uy * clen * 0.4,
          cxs + rx * (i - 1) * clen * 0.2 + ux * clen, cys + ry * (i - 1) * clen * 0.2 + uy * clen
        );
      }
      ctx.stroke();

      /* 受光侧轮廓 */
      if (E > 44) {
        ctx.strokeStyle = col.rim;
        ctx.lineWidth = Math.max(0.5, E * 0.007);
        ctx.beginPath();
        ctx.moveTo(bx + ux * E * 0.16 + rx * (W * 0.82), by + uy * E * 0.16 + ry * (W * 0.82));
        ctx.quadraticCurveTo(
          bx + ux * E * 0.46 + rx * (W * 0.98), by + uy * E * 0.46 + ry * (W * 0.98),
          bx + ux * E * 0.78 + rx * (W * 0.42), by + uy * E * 0.78 + ry * (W * 0.42)
        );
        ctx.stroke();
      }
    }

    _drawStubble(ctx, p, mul) {
      var style = p.style;
      var stems = p.stems;
      var u = this._u;
      var alpha0 = ctx.globalAlpha;
      var hBase = p.stubH;
      var golden = p.golden;
      var n = Math.min(stems.length, 3);

      /* 深色短茬，微微弯曲，斜切面 */
      for (var i = 0; i < n; i++) {
        var st = stems[i];
        var bx = p.x + st.dx;
        var h = Math.max(2, hBase * (0.72 + 0.3 * st.hf));
        var slant = (i % 2 === 0 ? 1 : -1) * (1.4 + 2.4 * st.hf) * u;
        ctx.strokeStyle = golden ? style.goldStemDark : style.stemDark;
        ctx.lineWidth = Math.max(1, p.stemWidth * 0.85);
        ctx.beginPath();
        ctx.moveTo(bx, p.y);
        ctx.quadraticCurveTo(bx + slant * 0.6, p.y - h * 0.55, bx + slant, p.y - h);
        ctx.stroke();

        ctx.globalAlpha = alpha0 * 0.8;
        ctx.strokeStyle = golden ? style.goldStubLight : style.stubLight;
        ctx.lineWidth = Math.max(0.7, p.stemWidth * 0.4);
        ctx.beginPath();
        ctx.moveTo(bx + slant - 1.4 * u, p.y - h + 0.6);
        ctx.lineTo(bx + slant + 1.2 * u, p.y - h - 0.6);
        ctx.stroke();
        ctx.globalAlpha = alpha0;
      }

      /* 落在地上的短断秆：深色、弯曲、0.8s 内淡出，不再横贯画面 */
      if (p.strawFade > 0.02) {
        ctx.globalAlpha = alpha0 * 0.3 * p.strawFade;
        ctx.strokeStyle = golden ? style.goldStemMid : style.stemMid;
        ctx.lineWidth = Math.max(0.7, p.stemWidth * 0.35);
        var baseAng = p.phase * 1.7;
        for (var k = 0; k < 2; k++) {
          var ang = baseAng + k * 1.9;
          var len = (7 + 12 * Math.min(1.2, p.scale)) * u;
          var sx = p.x + Math.cos(ang) * 5 * u;
          var sy = p.y - 1.4 * u;
          var ex = sx + Math.cos(ang) * len;
          var ey = sy - Math.sin(ang * 1.2) * len * 0.22;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo((sx + ex) * 0.5, sy - (2 + k * 2) * u, ex, ey);
          ctx.stroke();
        }
        ctx.globalAlpha = alpha0;
      }
    }

    _ensureSprites() {
      if (this._sprites || this._spriteFailed) return;
      if (typeof document === 'undefined') {
        this._spriteFailed = true;
        return;
      }
      var heads = [];
      var goldHeads = [];
      var leaves = [];
      for (var tier = 0; tier < 3; tier++) {
        var tierHeads = [];
        for (var v = 0; v < 6; v++) {
          tierHeads.push(makeHeadSprite(v, false, tier));
        }
        heads.push(tierHeads);
        goldHeads.push(makeHeadSprite(0, true, tier));
        var tierLeaves = [];
        for (var l = 0; l < 4; l++) {
          tierLeaves.push(makeLeafSprite(l, tier));
        }
        leaves.push(tierLeaves);
      }
      this._sprites = {
        heads: heads,
        goldHeads: goldHeads,
        leaves: leaves,
        shadow: makeShadowSprite(),
        glow: makeGlowSprite(),
        star: makeStarSprite(),
        sweep: makeSweepSprite()
      };
    }
  }

  /* 点到线段最短距离平方（热路径内联调用，无对象分配） */
  function distToSeg2(px, py, x0, y0, dx, dy, len2) {
    var t = ((px - x0) * dx + (py - y0) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    var qx = x0 + t * dx - px;
    var qy = y0 + t * dy - py;
    return qx * qx + qy * qy;
  }

  global.WheatField = WheatField;
})(typeof window !== 'undefined' ? window : this);
