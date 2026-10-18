/* ============================================================================
 * 《穗浪 v3》稻田 · RiceField
 * ----------------------------------------------------------------------------
 * 经典 script（非 ES module），暴露 window.RiceField。
 * 无内部 requestAnimationFrame / setTimeout —— 完全由主循环 update / draw 驱动。
 * 所有坐标为 CSS 像素；draw 收到的 ctx 已含 DPR / CSS 像素变换。
 *
 * 契约（RICE-MAP-SPEC.md）：
 *   constructor()
 *   resize(width, height)
 *   reset(seed)                           // 清空并按当前尺寸种满
 *   update(dt, time, env)                 // env: {wind,gust,pointer,frenzy,reduced}
 *   cut(x0,y0,x1,y1,speed,force)          // 线段切割；返回本次事件数组
 *   drainEvents()                         // 返回并清空事件 outbox
 *   stormCut()                            // 1.1s 金风扫场（由 update 推进）
 *   draw(ctx, opts)                       // opts: {time, frenzy}
 *   getStats()                            // {uncut,total,golden}
 *   setGoldenBoost(mult)                  // 新株金色概率倍率（默认 1）
 *   setCutRange(mult)                     // 收割半径倍率（1 / 1.5 / 2）
 *
 * 事件对象：{x, y, golden, scale, angle}
 *   x,y   = 被割水稻的穗部（主稻穗籽粒团重心）CSS 像素
 *   angle = 稻丛相对竖直方向的倾角（弧度，顺时针为正）
 *
 * 额外便利（主程序可忽略）：
 *   getStormProgress() -> -1 | 0..1
 *   regrowScale 属性：仅供 QA 加速验证重生节奏
 *
 * 视觉：每株 = 一丛完整水稻的预渲染精灵（弯曲茎、长披叶、下垂稻穗、
 * 浅水接触阴影、水光波圈），6 种株型 × 3 档空气透视 × 金色变体。
 * 运行时每株只做 1 次 drawImage + 旋转/缩放；无逐帧 filter / shadowBlur。
 * ========================================================================== */
(function (global) {
  'use strict';

  var PI = Math.PI;
  var TAU = PI * 2;

  var STATE_STAND = 0;
  var STATE_FALL = 1;
  var STATE_STUB = 2;
  var STATE_GROW = 3;

  /* ---------------------------------------------------------------- 精灵规格 */
  /* 逻辑尺寸 170 × 330；根在 (85, 300)，根下留 30px 给水面阴影/反光。 */
  var SPR_W = 170;
  var SPR_H = 330;
  var ROOT_X = 85;
  var ROOT_Y = 300;
  var CLUMP_H = 270;
  var TOP_MARGIN = 26;

  /* 空气透视的雾色：偏青玉的暖灰绿（不能是麦田的土黄，也不能发白） */
  var HAZE_RGB = [186, 194, 162];

  /* 三档 haze：0 近景（原色、2x 分辨率）、1 中景、2 远景（重雾、低分辨率） */
  var TIERS = [
    { haze: 0.0, res: 2.0, alpha: 1.0 },
    { haze: 0.16, res: 1.38, alpha: 0.94 },
    { haze: 0.38, res: 0.80, alpha: 0.84 }
  ];

  /* ---------------------------------------------------------------- 景深行 */
  /* weight 之和为 1；t 为田野内部纵向深度 0..1（顶部 0.49h，底部 1.02h）。 */
  var ROWS = [
    { tier: 2, t: 0.010, scale: 0.300, weight: 0.065 },
    { tier: 2, t: 0.038, scale: 0.335, weight: 0.065 },
    { tier: 2, t: 0.074, scale: 0.370, weight: 0.065 },
    { tier: 2, t: 0.118, scale: 0.415, weight: 0.065 },
    { tier: 1, t: 0.175, scale: 0.500, weight: 0.084 },
    { tier: 1, t: 0.240, scale: 0.585, weight: 0.084 },
    { tier: 1, t: 0.315, scale: 0.680, weight: 0.084 },
    { tier: 1, t: 0.398, scale: 0.790, weight: 0.084 },
    { tier: 1, t: 0.488, scale: 0.900, weight: 0.084 },
    { tier: 0, t: 0.605, scale: 1.020, weight: 0.080 },
    { tier: 0, t: 0.720, scale: 1.140, weight: 0.080 },
    { tier: 0, t: 0.845, scale: 1.270, weight: 0.080 },
    { tier: 0, t: 0.975, scale: 1.420, weight: 0.080 }
  ];

  /* ---------------------------------------------------------------- 六种株型 */
  /* 每丛多分蘖（4–7 根稻茎），对应 4–7 个稻穗；株型、倾角、叶量各不相同。 */
  var V_SHAPES = [
    { stems: 5, spread: 0.90, lean: 0.02, droop: 1.00, leafN: 7, leafLen: 1.02 },
    { stems: 6, spread: 1.12, lean: -0.08, droop: 1.08, leafN: 8, leafLen: 1.10 },
    { stems: 7, spread: 1.00, lean: 0.01, droop: 0.94, leafN: 8, leafLen: 0.98 },
    { stems: 4, spread: 0.70, lean: 0.05, droop: 1.18, leafN: 7, leafLen: 1.12 },
    { stems: 6, spread: 1.05, lean: 0.09, droop: 1.02, leafN: 8, leafLen: 1.06 },
    { stems: 5, spread: 1.20, lean: -0.03, droop: 1.12, leafN: 7, leafLen: 1.00 }
  ];

  /* ---------------------------------------------------------------- 调色板 */
  /* 稻叶：深青绿 → 青绿 → 黄绿尖；六种株型略有色相偏移。
     整体比 v1 精灵更深、更绿，避免被黄昏 grading 洗成奶白。 */
  var LEAF_PALS = [
    { deep: [34, 54, 28], mid: [82, 116, 50], light: [154, 182, 88], vein: [184, 200, 124], rim: [220, 214, 144] },
    { deep: [30, 51, 31], mid: [74, 110, 52], light: [146, 176, 90], vein: [176, 194, 120], rim: [208, 206, 136] },
    { deep: [40, 58, 26], mid: [92, 120, 46], light: [168, 186, 84], vein: [200, 200, 114], rim: [232, 222, 144] },
    { deep: [36, 52, 27], mid: [84, 110, 42], light: [156, 168, 76], vein: [188, 186, 106], rim: [218, 208, 134] },
    { deep: [30, 53, 30], mid: [76, 114, 46], light: [150, 182, 90], vein: [182, 198, 122], rim: [212, 212, 142] },
    { deep: [38, 53, 26], mid: [88, 110, 40], light: [162, 168, 72], vein: [192, 186, 104], rim: [222, 210, 132] }
  ];

  /* 稻穗：青黄谷壳 → 暖金穗尖。色相要偏“青金”，不能发白也不能发土黄。
     视觉上再靠细小谷粒的成串感和小面积高光取胜，而不是靠整片浅色。 */
  var PAN_PALS = [
    { deep: [102, 110, 54], mid: [156, 158, 82], light: [196, 188, 108], tip: [224, 208, 136], awn: [198, 194, 124] },
    { deep: [110, 114, 58], mid: [164, 164, 86], light: [204, 194, 112], tip: [230, 214, 142], awn: [204, 198, 128] },
    { deep: [96, 108, 54], mid: [150, 154, 84], light: [192, 186, 112], tip: [220, 206, 140], awn: [194, 192, 128] },
    { deep: [114, 112, 54], mid: [168, 160, 82], light: [208, 192, 108], tip: [232, 212, 140], awn: [206, 194, 122] },
    { deep: [92, 110, 58], mid: [146, 158, 88], light: [188, 192, 118], tip: [216, 210, 146], awn: [190, 196, 128] },
    { deep: [106, 110, 50], mid: [162, 158, 78], light: [202, 188, 104], tip: [228, 210, 134], awn: [200, 192, 118] }
  ];

  var STEM_RGB = { dark: [46, 66, 36], mid: [84, 112, 52], light: [156, 172, 96] };

  /* 金色水稻：稻穗暖金、茎金黄，叶仍是带金边的青绿，避免整株糊成黄块。 */
  var GOLD_RGB = {
    leafDeep: [58, 66, 32], leafMid: [112, 116, 48], leafLight: [178, 170, 84],
    leafVein: [218, 202, 126], leafRim: [250, 228, 150],
    stemDark: [140, 98, 32], stemMid: [198, 146, 56], stemLight: [255, 220, 140],
    panDeep: [168, 112, 30], panMid: [220, 162, 50], panLight: [252, 200, 92],
    panTip: [255, 232, 158], panAwn: [250, 214, 134],
    water: [238, 228, 178], shadow: [30, 40, 28]
  };

  /* ------------------------------------------------------------- 工具函数 */
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

  function mixRgb(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }

  function rgbStr(c, alpha) {
    var r = Math.round(c[0]);
    var g = Math.round(c[1]);
    var b = Math.round(c[2]);
    if (alpha === undefined || alpha >= 1) return 'rgb(' + r + ',' + g + ',' + b + ')';
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (Math.round(alpha * 1000) / 1000) + ')';
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function boundsOf(pts) {
    var minX = 1e9;
    var minY = 1e9;
    var maxX = -1e9;
    var maxY = -1e9;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function cubicAt(stem, t) {
    var mt = 1 - t;
    var a = mt * mt * mt;
    var b = 3 * mt * mt * t;
    var c = 3 * mt * t * t;
    var d = t * t * t;
    return {
      x: a * stem.base.x + b * stem.c1.x + c * stem.c2.x + d * stem.neck.x,
      y: a * stem.base.y + b * stem.c1.y + c * stem.c2.y + d * stem.neck.y
    };
  }

  /* ============================================================ 几何预生成 */
  /* 每种株型的几何只生成一次；6 株型 × 3 haze × 金色 用同一份几何上色，
     保证正常/金色精灵完全重叠，切割锚点与画面一致。 */

  function buildPanicle(nx, ny, launch, dirSign, plen, rnd) {
    /* 稻穗的关键形态：窄、长、弯垂成串。
       不再画“展开的扇面”，而是一条弯曲穗轴 + 少量短分枝 + 稀疏小谷粒。 */
    var N = 26;
    var roll = rnd();
    var finalH;
    if (roll < 0.18) {
      finalH = dirSign * (1.15 + rnd() * 0.55);       /* 少数偏直立 */
    } else if (roll < 0.36) {
      finalH = dirSign * (1.80 + rnd() * 0.55);       /* 半垂 */
    } else {
      finalH = dirSign * (2.55 + rnd() * 0.60);       /* 弯垂 / 下垂 */
    }
    var dH = finalH - launch;
    if (dH * dirSign < 0.55) dH = dirSign * 0.55;

    var pts = [{ x: nx, y: ny }];
    var x = nx;
    var y = ny;
    var k;
    for (k = 1; k <= N; k++) {
      var t = k / N;
      var e = smoothstep(t);
      var h = launch + dH * e;
      var step = plen / N;
      x += Math.sin(h) * step;
      y -= Math.cos(h) * step;
      pts.push({ x: x, y: y });
    }

    /* 穗不能出精灵边界：以穗颈为原点整体缩放 */
    var factor = 1;
    for (k = 1; k <= N; k++) {
      var p0 = pts[k];
      var denom;
      if (p0.x < 11) {
        denom = p0.x - nx;
        if (denom < -0.001) factor = Math.min(factor, (11 - nx) / denom);
      }
      if (p0.x > 159) {
        denom = p0.x - nx;
        if (denom > 0.001) factor = Math.min(factor, (159 - nx) / denom);
      }
      if (p0.y < TOP_MARGIN) {
        denom = p0.y - ny;
        if (denom < -0.001) factor = Math.min(factor, (TOP_MARGIN - ny) / denom);
      }
      if (p0.y > ROOT_Y - 5) {
        denom = p0.y - ny;
        if (denom > 0.001) factor = Math.min(factor, (ROOT_Y - 5 - ny) / denom);
      }
    }
    if (factor < 1) {
      factor = Math.max(0.55, factor * 0.97);
      for (k = 1; k <= N; k++) {
        pts[k].x = nx + (pts[k].x - nx) * factor;
        pts[k].y = ny + (pts[k].y - ny) * factor;
      }
    }

    var grains = [];
    var pedicels = [];
    var awns = [];
    for (k = 1; k < N; k++) {
      var tt = k / N;
      var rp = pts[k];
      var count = (tt > 0.88 || k % 5 === 0) ? 1 : 2;
      for (var j = 0; j < count; j++) {
        var side = count === 2 ? (j === 0 ? 1 : -1) : (k % 2 ? 1 : -1);
        var ang = PI + side * (0.12 + rnd() * 0.24) + (rnd() - 0.5) * 0.18;
        var bl = (0.70 + rnd() * 1.50) * (1.08 - tt * 0.30);
        var gx = rp.x + Math.sin(ang) * bl;
        var gy = rp.y - Math.cos(ang) * bl;
        if (gy > ROOT_Y - 5) gy = ROOT_Y - 5;
        if (gy < TOP_MARGIN + 2) gy = TOP_MARGIN + 2;
        if (gx < 9) gx = 9;
        else if (gx > 161) gx = 161;
        var dirX = Math.sin(ang);
        var dirY = -Math.cos(ang);
        var rx = 0.85 + rnd() * 0.30;
        var ry = 1.90 + rnd() * 0.85;
        if (tt > 0.55 && rnd() < 0.4) {
          rx *= 1.10;
          ry *= 1.08;
        }
        grains.push({
          x: gx,
          y: gy,
          rx: rx,
          ry: ry,
          rot: Math.atan2(dirY, dirX),
          tone: tt < 0.30 ? 0 : (tt < 0.72 ? 1 : 2),
          hi: rnd() < 0.65
        });
        pedicels.push({
          x0: rp.x, y0: rp.y,
          x1: gx - dirX * ry * 0.65,
          y1: gy - dirY * ry * 0.65
        });
        if (rnd() < 0.22) {
          var alen = 1.2 + rnd() * 1.7;
          awns.push({
            x0: gx + dirX * ry * 0.72,
            y0: gy + dirY * ry * 0.72,
            x1: gx + dirX * (ry * 0.72 + alen) + (rnd() - 0.5) * 0.9,
            y1: gy + dirY * (ry * 0.72 + alen) + (rnd() - 0.5) * 0.7,
            a: 0.26 + rnd() * 0.22
          });
        }
      }
    }

    /* 穗尖两三粒，收束成自然下垂的尾 */
    var tip0 = pts[N];
    for (var q = 0; q < 2; q++) {
      var qa = PI + (q === 0 ? 0.16 : -0.16) + (rnd() - 0.5) * 0.12;
      var qb = 0.6 + rnd() * 1.1;
      var qx = tip0.x + Math.sin(qa) * qb;
      var qy = tip0.y - Math.cos(qa) * qb;
      if (qy > ROOT_Y - 5) qy = ROOT_Y - 5;
      var qdx = Math.sin(qa);
      var qdy = -Math.cos(qa);
      grains.push({
        x: qx, y: qy,
        rx: 0.58 + rnd() * 0.26,
        ry: 1.4 + rnd() * 0.7,
        rot: Math.atan2(qdy, qdx),
        tone: 2,
        hi: rnd() < 0.6
      });
      pedicels.push({
        x0: tip0.x, y0: tip0.y,
        x1: qx - qdx * 0.7, y1: qy - qdy * 0.7
      });
    }

    return {
      pts: pts,
      grains: grains,
      pedicels: pedicels,
      awns: awns,
      neck: { x: nx, y: ny }
    };
  }

  function buildLeaf(baseX, baseY, len, side, layer, dead, rnd) {
    var a0 = side * (0.08 + rnd() * 0.36);
    /* 每片叶的“直/披”程度不同：有的近直立，有的长披垂，避免整片叶子一个弧度 */
    var arch = 0.55 + rnd() * 0.80;
    var pts = [];
    var p0 = { x: baseX, y: baseY };
    var p1len = len * (0.24 + rnd() * 0.10);
    var p1 = {
      x: baseX + Math.sin(a0) * p1len,
      y: baseY - Math.cos(a0) * p1len
    };
    var a2 = a0 + side * (0.28 + rnd() * 0.34);
    var p2 = {
      x: baseX + Math.sin(a2) * len * 0.64,
      y: baseY - Math.cos(a2) * len * 0.64
    };
    var a3 = a0 + side * arch;
    var p3 = {
      x: baseX + Math.sin(a3) * len,
      y: baseY - Math.cos(a3) * len + len * 0.22
    };
    var SEG = 14;
    var i;
    for (i = 0; i <= SEG; i++) {
      var t = i / SEG;
      var mt = 1 - t;
      var x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x +
        3 * mt * t * t * p2.x + t * t * t * p3.x;
      var y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y +
        3 * mt * t * t * p2.y + t * t * t * p3.y;
      pts.push({ x: x, y: y });
    }

    var box = boundsOf(pts);
    var f = 1;
    var d;
    if (box.minX < 8 && (d = box.minX - baseX) < -0.001) {
      f = Math.min(f, (8 - baseX) / d);
    }
    if (box.maxX > SPR_W - 8 && (d = box.maxX - baseX) > 0.001) {
      f = Math.min(f, (SPR_W - 8 - baseX) / d);
    }
    if (box.minY < TOP_MARGIN && (d = box.minY - baseY) < -0.001) {
      f = Math.min(f, (TOP_MARGIN - baseY) / d);
    }
    if (box.maxY > ROOT_Y - 3 && (d = box.maxY - baseY) > 0.001) {
      f = Math.min(f, (ROOT_Y - 3 - baseY) / d);
    }
    if (f < 1) {
      f = Math.max(0.45, f * 0.97);
      for (i = 0; i < pts.length; i++) {
        pts[i].x = baseX + (pts[i].x - baseX) * f;
        pts[i].y = baseY + (pts[i].y - baseY) * f;
      }
    }

    var wmax = (2.0 + rnd() * 1.3) * (dead ? 0.65 : 1);
    var w = [];
    for (i = 0; i <= SEG; i++) {
      var wt = i / SEG;
      var ww = wmax * Math.pow(Math.sin(PI * Math.pow(wt, 0.72)), 0.85) * (1 - 0.2 * wt) + 0.12;
      w.push(ww);
    }

    var dew = [];
    if (!dead && layer === 2) {
      for (var k = 0; k < 2; k++) {
        var idx = 4 + k * 3 + ((rnd() * 2) | 0);
        if (idx < pts.length - 2) {
          dew.push({
            x: pts[idx].x + (rnd() - 0.5) * 1.6,
            y: pts[idx].y - 0.7,
            r: 0.45 + rnd() * 0.4
          });
        }
      }
    }

    return { pts: pts, w: w, layer: layer, dead: !!dead, dew: dew };
  }

  function makePlan(variant) {
    var shape = V_SHAPES[variant % V_SHAPES.length];
    var rnd = mulberry32(0x51ED + variant * 1319 + 17);
    var stems = [];
    var nStems = shape.stems;
    var i;

    for (i = 0; i < nStems; i++) {
      var isMain = i === 0;
      var u = nStems === 1 ? 0 : (i / (nStems - 1)) * 2 - 1;
      var bx = ROOT_X + (u * 0.85 + (rnd() - 0.5) * 0.35) * 15 * shape.spread +
        shape.lean * 24;
      var by = ROOT_Y - rnd() * 6;
      var neckH = CLUMP_H * (0.60 + rnd() * 0.17) * (isMain ? 1.08 : 1);
      var side = u === 0 ? (rnd() < 0.5 ? -1 : 1) : (u < 0 ? -1 : 1);
      var out = (0.05 + rnd() * 0.13) * CLUMP_H * (0.30 + 0.70 * Math.abs(u));
      var lean = shape.lean + (rnd() - 0.5) * 0.13;
      var tipX = clamp(bx + side * out + lean * neckH * 0.62, ROOT_X - 46, ROOT_X + 46);
      var tipY = by - neckH;
      var c1x = bx + side * out * 0.08 + lean * neckH * 0.10;
      var c1y = by - neckH * 0.36;
      var c2x = bx + side * out * 0.45 + lean * neckH * 0.46;
      var c2y = by - neckH * 0.80;

      var tx = tipX - c2x;
      var ty = tipY - c2y;
      var launch = Math.atan2(tx, -ty);
      if (Math.abs(launch) < 0.12) launch = side * (0.24 + rnd() * 0.12);
      var dirSign = launch >= 0 ? 1 : -1;
      var plen = CLUMP_H * (0.165 + rnd() * 0.085) * (isMain ? 1.05 : 1);

      var stem = {
        base: { x: bx, y: by },
        c1: { x: c1x, y: c1y },
        c2: { x: c2x, y: c2y },
        neck: { x: tipX, y: tipY },
        width: (isMain ? 3.05 : 2.25) + rnd() * 0.7,
        side: side,
        isMain: isMain,
        pan: buildPanicle(tipX, tipY, launch, dirSign, plen, rnd)
      };
      stems.push(stem);
    }

    var leaves = [];
    var leafCount = shape.leafN;
    for (i = 0; i < leafCount; i++) {
      var st = stems[(i * 2 + 1) % nStems];
      var t = 0.20 + rnd() * 0.50;
      var b = cubicAt(st, t);
      var side2 = (i % 2 === 0 ? -1 : 1) * (rnd() < 0.22 ? -1 : 1);
      var len = CLUMP_H * (0.44 + rnd() * 0.24) * shape.leafLen;
      var layer = i < 2 ? 0 : (i >= leafCount - 2 ? 2 : 1);
      leaves.push(buildLeaf(b.x + side2 * 1.5, b.y + 1, len, side2, layer, false, rnd));
    }

    /* 两片更长、更靠外的披叶：让叶层占比超过穗层 */
    for (i = 0; i < 2; i++) {
      var stOut = stems[(i * 3 + 2) % nStems];
      var tOut = 0.26 + rnd() * 0.34;
      var bOut = cubicAt(stOut, tOut);
      var sideOut = i === 0 ? -1 : 1;
      leaves.push(buildLeaf(
        bOut.x + sideOut * 2,
        bOut.y + 1,
        CLUMP_H * (0.52 + rnd() * 0.16) * shape.leafLen,
        sideOut,
        1,
        false,
        rnd
      ));
    }

    /* 剑叶：贴着穗颈向上再披垂，是稻田辨识度最高的一层轮廓。
       只让其中一片压在穗前，另一片放在穗后，避免遮住稻穗。 */
    for (i = 0; i < Math.min(2, nStems); i++) {
      var fs = stems[i];
      var fside = i === 0 ? -1 : 1;
      leaves.push(buildLeaf(
        fs.neck.x + fside * 1.0,
        fs.neck.y + 4,
        CLUMP_H * (0.28 + rnd() * 0.10) * shape.leafLen,
        fside,
        i === 0 ? 2 : 1,
        false,
        rnd
      ));
    }

    /* 基部两片短新叶 + 一片斜插水面的枯叶，增加“水田”的野生感 */
    for (i = 0; i < 2; i++) {
      var st2 = stems[(i + 1) % nStems];
      var b2 = cubicAt(st2, 0.06 + rnd() * 0.08);
      var sideY = i === 0 ? 1 : -1;
      leaves.push(buildLeaf(
        b2.x + sideY * 2,
        b2.y + 2,
        CLUMP_H * (0.17 + rnd() * 0.10),
        sideY,
        1,
        false,
        rnd
      ));
    }
    var deadBase = cubicAt(stems[0], 0.04);
    leaves.push(buildLeaf(
      deadBase.x + (rnd() < 0.5 ? -4 : 4),
      deadBase.y + 2,
      CLUMP_H * (0.22 + rnd() * 0.08),
      rnd() < 0.5 ? -1 : 1,
      0,
      true,
      rnd
    ));

    /* 切割锚点：主穗籽粒团、穗颈、整丛冠层中心、副穗籽粒团 */
    var mainPan = stems[0].pan;
    var head = averageGrains(mainPan.grains, mainPan.pts[mainPan.pts.length - 1]);
    var center = { x: 0, y: 0, n: 0 };
    for (i = 0; i < stems.length; i++) {
      var gp = averageGrains(stems[i].pan.grains, stems[i].pan.pts[0]);
      center.x += gp.x;
      center.y += gp.y;
      center.n++;
    }
    center.x /= center.n;
    center.y /= center.n;
    var second = stems.length > 1
      ? averageGrains(stems[1].pan.grains, stems[1].pan.pts[0])
      : head;

    var anchors = {
      h0x: head.x - ROOT_X, h0y: head.y - ROOT_Y,
      h1x: stems[0].neck.x - ROOT_X, h1y: stems[0].neck.y - ROOT_Y,
      h2x: center.x - ROOT_X, h2y: center.y - ROOT_Y,
      h3x: second.x - ROOT_X, h3y: second.y - ROOT_Y
    };

    return {
      variant: variant,
      shape: shape,
      stems: stems,
      leaves: leaves,
      anchors: anchors,
      headCenter: head
    };
  }

  function averageGrains(grains, fallback) {
    if (!grains || !grains.length) return { x: fallback.x, y: fallback.y };
    var x = 0;
    var y = 0;
    for (var i = 0; i < grains.length; i++) {
      x += grains[i].x;
      y += grains[i].y;
    }
    return { x: x / grains.length, y: y / grains.length };
  }

  /* ============================================================ 精灵绘制 */
  /* 全部一次性预渲染；运行时只 drawImage，不碰 filter / shadowBlur。 */

  function paletteFor(variant, golden) {
    var v = variant % 6;
    if (golden) {
      return {
        leafDeep: GOLD_RGB.leafDeep,
        leafMid: GOLD_RGB.leafMid,
        leafLight: GOLD_RGB.leafLight,
        leafVein: GOLD_RGB.leafVein,
        leafRim: GOLD_RGB.leafRim,
        stemDark: GOLD_RGB.stemDark,
        stemMid: GOLD_RGB.stemMid,
        stemLight: GOLD_RGB.stemLight,
        panDeep: GOLD_RGB.panDeep,
        panMid: GOLD_RGB.panMid,
        panLight: GOLD_RGB.panLight,
        panTip: GOLD_RGB.panTip,
        panAwn: GOLD_RGB.panAwn,
        water: GOLD_RGB.water,
        shadow: GOLD_RGB.shadow
      };
    }
    var lp = LEAF_PALS[v];
    var pp = PAN_PALS[v];
    return {
      leafDeep: lp.deep,
      leafMid: lp.mid,
      leafLight: lp.light,
      leafVein: lp.vein,
      leafRim: lp.rim,
      stemDark: STEM_RGB.dark,
      stemMid: STEM_RGB.mid,
      stemLight: STEM_RGB.light,
      panDeep: pp.deep,
      panMid: pp.mid,
      panLight: pp.light,
      panTip: pp.tip,
      panAwn: pp.awn,
      water: [230, 224, 180],
      shadow: [20, 36, 28]
    };
  }

  function paintWaterBase(g, pal, golden) {
    /* 浅水接触阴影：椭圆软影 + 水光横线 + 两圈涟漪 */
    g.save();
    g.translate(ROOT_X, ROOT_Y + 5);
    g.scale(1, 0.26);
    var rg = g.createRadialGradient(0, 0, 2, 0, 0, 72);
    rg.addColorStop(0, 'rgba(16,32,26,0.52)');
    rg.addColorStop(0.46, 'rgba(18,36,30,0.26)');
    rg.addColorStop(1, 'rgba(22,40,32,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, 0, 72, 0, TAU);
    g.fill();
    g.restore();

    /* 根下浅浅的绿色倒影，让稻丛“立在水里” */
    var ref = g.createLinearGradient(0, ROOT_Y + 1, 0, ROOT_Y + 26);
    ref.addColorStop(0, 'rgba(84,112,66,0.22)');
    ref.addColorStop(0.45, 'rgba(72,100,62,0.10)');
    ref.addColorStop(1, 'rgba(70,98,60,0)');
    g.fillStyle = ref;
    g.beginPath();
    g.moveTo(ROOT_X - 17, ROOT_Y + 1);
    g.lineTo(ROOT_X + 17, ROOT_Y + 1);
    g.lineTo(ROOT_X + 26, ROOT_Y + 27);
    g.lineTo(ROOT_X - 26, ROOT_Y + 27);
    g.closePath();
    g.fill();

    g.strokeStyle = rgbStr(pal.water, golden ? 0.36 : 0.32);
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(ROOT_X - 24, ROOT_Y + 3.5);
    g.lineTo(ROOT_X + 22, ROOT_Y + 3.5);
    g.moveTo(ROOT_X - 14, ROOT_Y + 7);
    g.lineTo(ROOT_X + 17, ROOT_Y + 7);
    g.moveTo(ROOT_X - 28, ROOT_Y + 10.5);
    g.lineTo(ROOT_X + 8, ROOT_Y + 10.5);
    g.stroke();

    /* 水面冷色反光：稻田的水是青玉色而不是泥黄色 */
    var cool = g.createLinearGradient(0, ROOT_Y - 2, 0, ROOT_Y + 10);
    cool.addColorStop(0, 'rgba(126,166,150,0)');
    cool.addColorStop(0.38, 'rgba(126,166,150,0.20)');
    cool.addColorStop(1, 'rgba(120,160,146,0)');
    g.fillStyle = cool;
    g.fillRect(ROOT_X - 36, ROOT_Y - 2, 72, 12);
    g.strokeStyle = 'rgba(168,200,178,0.20)';
    g.lineWidth = 0.55;
    g.beginPath();
    g.moveTo(ROOT_X - 31, ROOT_Y - 0.5);
    g.lineTo(ROOT_X - 18, ROOT_Y - 0.5);
    g.moveTo(ROOT_X + 12, ROOT_Y - 1);
    g.lineTo(ROOT_X + 26, ROOT_Y - 1);
    g.stroke();

    g.strokeStyle = rgbStr(pal.water, 0.18);
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(ROOT_X + 38, ROOT_Y + 6);
    g.ellipse(ROOT_X, ROOT_Y + 6, 38, 9.5, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = rgbStr(pal.water, 0.10);
    g.beginPath();
    g.moveTo(ROOT_X + 56, ROOT_Y + 8);
    g.ellipse(ROOT_X, ROOT_Y + 8, 56, 13, 0, 0, TAU);
    g.stroke();
  }

  /* 稻丛画完后压在水面上的几笔：短水光、断茬水圈。
     短横线随精灵轻微旋转也不突兀，比整条水平线自然。 */
  function paintWaterline(g, pal, golden) {
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = rgbStr(pal.water, golden ? 0.5 : 0.42);
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(ROOT_X - 30, ROOT_Y - 0.5);
    g.lineTo(ROOT_X - 20, ROOT_Y - 0.5);
    g.moveTo(ROOT_X - 8, ROOT_Y - 1.2);
    g.lineTo(ROOT_X + 6, ROOT_Y - 1.2);
    g.moveTo(ROOT_X + 17, ROOT_Y - 0.2);
    g.lineTo(ROOT_X + 29, ROOT_Y - 0.2);
    g.moveTo(ROOT_X - 23, ROOT_Y + 1.6);
    g.lineTo(ROOT_X - 15, ROOT_Y + 1.6);
    g.moveTo(ROOT_X + 22, ROOT_Y + 1.8);
    g.lineTo(ROOT_X + 32, ROOT_Y + 1.8);
    g.stroke();

    g.strokeStyle = 'rgba(24,44,36,0.34)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(ROOT_X - 21, ROOT_Y + 2.4);
    g.lineTo(ROOT_X + 18, ROOT_Y + 2.4);
    g.stroke();

    g.strokeStyle = rgbStr(pal.water, 0.20);
    g.lineWidth = 0.55;
    g.beginPath();
    g.moveTo(ROOT_X + 44, ROOT_Y + 3.2);
    g.ellipse(ROOT_X, ROOT_Y + 3.2, 44, 10, 0, 0, PI);
    g.stroke();
    g.restore();
  }

  function paintLeaf(g, leaf, pal, golden) {
    var pts = leaf.pts;
    var n = pts.length;
    var i;
    var left = [];
    var right = [];
    var centers = [];
    var leftY = 0;
    var rightY = 0;
    for (i = 0; i < n; i++) {
      var pPrev = pts[i > 0 ? i - 1 : 0];
      var pNext = pts[i < n - 1 ? i + 1 : n - 1];
      var dx = pNext.x - pPrev.x;
      var dy = pNext.y - pPrev.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len;
      var ny = dx / len;
      var w = leaf.w[i];
      var lx = pts[i].x + nx * w;
      var ly = pts[i].y + ny * w;
      var rx = pts[i].x - nx * w;
      var ry = pts[i].y - ny * w;
      left.push({ x: lx, y: ly });
      right.push({ x: rx, y: ry });
      centers.push({ x: pts[i].x, y: pts[i].y });
      leftY += ly;
      rightY += ry;
    }

    var deep;
    var mid;
    var light;
    var vein;
    var rim;
    if (leaf.dead) {
      deep = [98, 84, 46];
      mid = [136, 118, 62];
      light = [174, 154, 84];
      vein = [186, 168, 100];
      rim = [206, 190, 124];
    } else if (leaf.layer === 0) {
      deep = mixRgb(pal.leafDeep, [20, 28, 20], 0.30);
      mid = mixRgb(pal.leafMid, [24, 34, 24], 0.24);
      light = mixRgb(pal.leafLight, [26, 36, 26], 0.16);
      vein = mixRgb(pal.leafVein, [30, 40, 28], 0.18);
      rim = pal.leafRim;
    } else if (leaf.layer === 2) {
      deep = mixRgb(pal.leafDeep, [238, 230, 172], 0.08);
      mid = mixRgb(pal.leafMid, [242, 232, 174], 0.12);
      light = mixRgb(pal.leafLight, [252, 244, 196], 0.18);
      vein = mixRgb(pal.leafVein, [255, 248, 208], 0.20);
      rim = mixRgb(pal.leafRim, [255, 248, 210], 0.24);
    } else {
      deep = pal.leafDeep;
      mid = pal.leafMid;
      light = pal.leafLight;
      vein = pal.leafVein;
      rim = pal.leafRim;
    }

    var base = pts[0];
    var tip = pts[n - 1];
    g.beginPath();
    g.moveTo(left[0].x, left[0].y);
    for (i = 1; i < n; i++) g.lineTo(left[i].x, left[i].y);
    for (i = n - 1; i >= 0; i--) g.lineTo(right[i].x, right[i].y);
    g.closePath();

    var grad = g.createLinearGradient(base.x, base.y, tip.x, tip.y);
    grad.addColorStop(0, rgbStr(deep));
    grad.addColorStop(0.42, rgbStr(mid));
    grad.addColorStop(0.82, rgbStr(light));
    grad.addColorStop(1, rgbStr(mixRgb(light, [250, 242, 196], 0.35)));
    g.fillStyle = grad;
    g.globalAlpha = leaf.dead ? 0.8 : (leaf.layer === 0 ? 0.94 : 1);
    g.fill();
    g.globalAlpha = 1;

    /* 叶缘暗线 */
    g.strokeStyle = rgbStr(deep, 0.30);
    g.lineWidth = 0.45;
    g.stroke();

    /* 主脉 */
    g.strokeStyle = rgbStr(vein, leaf.layer === 2 ? 0.62 : 0.46);
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(centers[0].x, centers[0].y);
    for (i = 1; i < n - 1; i++) g.lineTo(centers[i].x, centers[i].y);
    g.stroke();

    /* 受光上缘 */
    var rimSide = leftY < rightY ? left : right;
    g.strokeStyle = rgbStr(rim, leaf.layer === 2 ? 0.68 : 0.38);
    g.lineWidth = leaf.layer === 2 ? 0.6 : 0.5;
    g.beginPath();
    g.moveTo(rimSide[1].x, rimSide[1].y);
    for (i = 2; i < n - 2; i++) g.lineTo(rimSide[i].x, rimSide[i].y);
    g.stroke();

    /* 近景叶片的细侧脉与露珠 */
    if (leaf.layer === 2 && !leaf.dead) {
      g.strokeStyle = rgbStr(mid, 0.22);
      g.lineWidth = 0.3;
      g.beginPath();
      for (i = 4; i <= 10; i += 3) {
        g.moveTo(centers[i].x, centers[i].y);
        g.lineTo(rimSide[i].x, rimSide[i].y);
      }
      g.stroke();
      for (i = 0; i < leaf.dew.length; i++) {
        var dw = leaf.dew[i];
        g.fillStyle = 'rgba(252,250,226,0.68)';
        g.beginPath();
        g.arc(dw.x, dw.y, dw.r, 0, TAU);
        g.fill();
      }
    }
  }

  function paintStem(g, stem, pal, golden) {
    var b = stem.base;
    var c1 = stem.c1;
    var c2 = stem.c2;
    var nNeck = stem.neck;

    /* 叶鞘 */
    var t1 = cubicAt(stem, 0.14);
    g.strokeStyle = rgbStr(pal.stemDark, 0.7);
    g.lineWidth = stem.width * 1.8;
    g.beginPath();
    g.moveTo(b.x, b.y);
    g.quadraticCurveTo(b.x + (t1.x - b.x) * 0.4, b.y + (t1.y - b.y) * 0.8, t1.x, t1.y);
    g.stroke();

    /* 主茎 */
    g.strokeStyle = rgbStr(pal.stemDark, 0.94);
    g.lineWidth = stem.width;
    g.beginPath();
    g.moveTo(b.x, b.y);
    g.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, nNeck.x, nNeck.y);
    g.stroke();

    /* 右侧暖光 */
    g.strokeStyle = rgbStr(pal.stemLight, golden ? 0.8 : 0.62);
    g.lineWidth = Math.max(0.55, stem.width * 0.30);
    g.beginPath();
    g.moveTo(b.x + 0.8, b.y);
    g.bezierCurveTo(c1.x + 0.8, c1.y, c2.x + 0.8, c2.y, nNeck.x + 0.8, nNeck.y);
    g.stroke();

    /* 茎节 */
    var nodeT = 0.46;
    var np = cubicAt(stem, nodeT);
    var np2 = cubicAt(stem, nodeT + 0.03);
    g.strokeStyle = rgbStr(pal.stemLight, 0.5);
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(np.x - stem.width * 0.8, np.y + 0.6);
    g.lineTo(np.x + stem.width * 0.8, np.y - 0.5);
    g.stroke();
    if (np2.y > np.y + 2) {
      g.strokeStyle = rgbStr(pal.stemDark, 0.35);
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(np.x - stem.width * 0.7, np.y + 1.8);
      g.lineTo(np.x + stem.width * 0.7, np.y + 1.1);
      g.stroke();
    }
  }

  function paintPanicle(g, stem, pal, golden) {
    var pan = stem.pan;
    var pts = pan.pts;
    var base = pts[0];
    var i;
    var gr;

    /* 穗轴：细而弯，能看到“垂头”的骨架 */
    g.strokeStyle = rgbStr(pal.panDeep, 0.9);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(base.x, base.y);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();

    /* 小穗梗：短、朝下，是稻穗“成串”感的关键 */
    g.strokeStyle = rgbStr(pal.panDeep, 0.55);
    g.lineWidth = 0.34;
    g.beginPath();
    for (i = 0; i < pan.pedicels.length; i++) {
      var pd = pan.pedicels[i];
      g.moveTo(pd.x0, pd.y0);
      g.lineTo(pd.x1, pd.y1);
    }
    g.stroke();

    /* 谷粒：按深/中/浅三档分组填充，各自描边，保证颗粒分离不成糊面 */
    var tones = [pal.panDeep, pal.panMid, pal.panLight];
    for (var t = 0; t < 3; t++) {
      var any = false;
      g.beginPath();
      for (i = 0; i < pan.grains.length; i++) {
        gr = pan.grains[i];
        if (gr.tone !== t) continue;
        g.ellipse(gr.x, gr.y, gr.rx, gr.ry, gr.rot, 0, TAU);
        any = true;
      }
      if (!any) continue;
      g.fillStyle = rgbStr(tones[t]);
      g.fill();
      g.strokeStyle = rgbStr(pal.panDeep, 0.5);
      g.lineWidth = 0.2;
      g.stroke();
    }

    /* 只给一半谷粒一道很细的受光边，避免整穗发白 */
    g.strokeStyle = rgbStr(pal.panTip, golden ? 0.68 : 0.46);
    g.lineWidth = 0.26;
    g.beginPath();
    for (i = 0; i < pan.grains.length; i++) {
      gr = pan.grains[i];
      if (!gr.hi) continue;
      var ax = Math.cos(gr.rot);
      var ay = Math.sin(gr.rot);
      var px = -ay;
      var py = ax;
      var ox = gr.x + px * gr.rx * 0.40 - ax * gr.ry * 0.12;
      var oy = gr.y + py * gr.rx * 0.40 - ay * gr.ry * 0.12;
      var hl = gr.ry * 0.5;
      g.moveTo(ox - ax * hl, oy - ay * hl);
      g.lineTo(ox + ax * hl, oy + ay * hl);
    }
    g.stroke();

    /* 短芒（稻芒比麦芒短得多） */
    if (pan.awns.length) {
      g.strokeStyle = rgbStr(pal.panAwn, golden ? 0.5 : 0.34);
      g.lineWidth = 0.24;
      g.beginPath();
      for (i = 0; i < pan.awns.length; i++) {
        var aw = pan.awns[i];
        g.moveTo(aw.x0, aw.y0);
        g.lineTo(aw.x1, aw.y1);
      }
      g.stroke();
    }

    /* 穗颈的一小段：让稻穗与茎的连接更自然 */
    g.strokeStyle = rgbStr(pal.panMid, 0.75);
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(base.x, base.y);
    g.quadraticCurveTo(base.x + 1.2, base.y + 2.5, base.x + 2.0, base.y + 4.2);
    g.stroke();
  }

  function paintGoldenBake(g, plan, pal) {
    var i;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (i = 0; i < plan.stems.length; i++) {
      var pan = plan.stems[i].pan;
      var c = averageGrains(pan.grains, pan.pts[0]);
      var r = 24;
      var rg = g.createRadialGradient(c.x, c.y, 1, c.x, c.y, r * 1.5);
      rg.addColorStop(0, 'rgba(255,230,150,0.15)');
      rg.addColorStop(0.45, 'rgba(255,206,104,0.06)');
      rg.addColorStop(1, 'rgba(255,190,84,0)');
      g.fillStyle = rg;
      g.fillRect(c.x - r * 1.5, c.y - r * 1.5, r * 3, r * 3);
    }
    var rnd = mulberry32(0xBEEF + plan.variant * 71);
    g.fillStyle = 'rgba(255,244,196,0.8)';
    for (i = 0; i < plan.stems.length; i++) {
      var pan2 = plan.stems[i].pan;
      for (var k = 0; k < 4; k++) {
        var gr = pan2.grains[(rnd() * pan2.grains.length) | 0];
        if (!gr) continue;
        g.beginPath();
        g.arc(gr.x + (rnd() - 0.5) * 2.2, gr.y + (rnd() - 0.5) * 2.2, 0.35 + rnd() * 0.55, 0, TAU);
        g.fill();
      }
    }
    g.restore();
  }

  function paintClump(plan, golden) {
    var res = TIERS[0].res;
    var cv = document.createElement('canvas');
    cv.width = Math.round(SPR_W * res);
    cv.height = Math.round(SPR_H * res);
    var g = cv.getContext('2d');
    g.scale(res, res);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    var pal = paletteFor(plan.variant, golden);
    var i;

    paintWaterBase(g, pal, golden);

    for (i = 0; i < plan.leaves.length; i++) {
      if (plan.leaves[i].layer === 0) paintLeaf(g, plan.leaves[i], pal, golden);
    }
    for (i = 0; i < plan.stems.length; i++) {
      paintStem(g, plan.stems[i], pal, golden);
    }
    for (i = 0; i < plan.leaves.length; i++) {
      if (plan.leaves[i].layer === 1) paintLeaf(g, plan.leaves[i], pal, golden);
    }
    for (i = 0; i < plan.stems.length; i++) {
      paintPanicle(g, plan.stems[i], pal, golden);
    }
    for (i = 0; i < plan.leaves.length; i++) {
      if (plan.leaves[i].layer === 2) paintLeaf(g, plan.leaves[i], pal, golden);
    }
    paintWaterline(g, pal, golden);
    if (golden) paintGoldenBake(g, plan, pal);
    return cv;
  }

  /* 远/中景：从 2x 近景精灵降采样 + 空气透视薄雾叠加（source-atop）。 */
  function hazeCopy(src, tier) {
    var cfg = TIERS[tier];
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(SPR_W * cfg.res));
    cv.height = Math.max(1, Math.round(SPR_H * cfg.res));
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, cv.width, cv.height);
    if (cfg.haze > 0) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(' + HAZE_RGB[0] + ',' + HAZE_RGB[1] + ',' + HAZE_RGB[2] + ',' + cfg.haze + ')';
      g.fillRect(0, 0, cv.width, cv.height);
      g.globalCompositeOperation = 'source-over';
    }
    return cv;
  }

  function makeGlowSprite() {
    var S = 128;
    var cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    var g = cv.getContext('2d');
    var rg = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(255,250,222,0.95)');
    rg.addColorStop(0.18, 'rgba(255,234,170,0.62)');
    rg.addColorStop(0.48, 'rgba(255,204,108,0.22)');
    rg.addColorStop(1, 'rgba(255,186,76,0)');
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
    rg.addColorStop(0, 'rgba(255,251,232,0.95)');
    rg.addColorStop(0.32, 'rgba(255,235,170,0.34)');
    rg.addColorStop(1, 'rgba(255,214,124,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,252,238,0.96)';
    g.beginPath();
    g.moveTo(c, 5);
    g.quadraticCurveTo(c + 2, c - 3, S - 5, c);
    g.quadraticCurveTo(c + 2, c + 3, c, S - 5);
    g.quadraticCurveTo(c - 2, c + 3, 5, c);
    g.quadraticCurveTo(c - 2, c - 3, c, 5);
    g.closePath();
    g.fill();
    return cv;
  }

  function makeRippleSprite() {
    var W = 128;
    var H = 64;
    var cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    var g = cv.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1.2;
    for (var k = 0; k < 3; k++) {
      g.strokeStyle = 'rgba(228,232,198,' + (0.26 - k * 0.07) + ')';
      g.beginPath();
      g.ellipse(W / 2, H / 2, 17 + k * 15, 5.4 + k * 4.6, 0, 0, TAU);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
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
    lg.addColorStop(0, 'rgba(226,226,164,0)');
    lg.addColorStop(0.24, 'rgba(236,230,166,0.16)');
    lg.addColorStop(0.43, 'rgba(250,244,192,0.44)');
    lg.addColorStop(0.50, 'rgba(255,252,226,0.62)');
    lg.addColorStop(0.57, 'rgba(250,244,192,0.44)');
    lg.addColorStop(0.76, 'rgba(236,230,166,0.16)');
    lg.addColorStop(1, 'rgba(226,226,164,0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);

    var rnd = mulberry32(0x5EED);
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 18; i++) {
      var x = W * (0.34 + rnd() * 0.32);
      g.strokeStyle = 'rgba(255,248,214,' + (0.03 + rnd() * 0.10).toFixed(3) + ')';
      g.lineWidth = 0.6 + rnd() * 1.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 42, H * 0.5, x + (rnd() - 0.5) * 26, H);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    return cv;
  }

  /* --------------------------------------------------------- 共享资源缓存 */
  /* 精灵与几何在所有 RiceField 实例间共享；预览页的 bench 不会再生成一份。 */
  var SHARED = null;

  function ensureShared() {
    if (SHARED) return SHARED;
    var plans = [];
    var metrics = [];
    for (var v = 0; v < 6; v++) {
      var plan = makePlan(v);
      plans.push(plan);
      metrics.push(plan.anchors);
    }
    SHARED = { plans: plans, metrics: metrics, sprites: null };
    return SHARED;
  }

  function buildSpriteSet(plans) {
    var normal = [[], [], []];
    var gold = [[], [], []];
    for (var v = 0; v < plans.length; v++) {
      var near = paintClump(plans[v], false);
      normal[0][v] = near;
      for (var t = 1; t < 3; t++) normal[t][v] = hazeCopy(near, t);
      var goldNear = paintClump(plans[v], true);
      gold[0][v] = goldNear;
      for (var t2 = 1; t2 < 3; t2++) gold[t2][v] = hazeCopy(goldNear, t2);
    }
    return {
      normal: normal,
      gold: gold,
      glow: makeGlowSprite(),
      star: makeStarSprite(),
      ripple: makeRippleSprite(),
      sweep: makeSweepSprite()
    };
  }

  /* ------------------------------------------------------- 留茬配色（按档） */
  var STUB_STYLES = TIERS.map(function (cfg) {
    var h = cfg.haze;
    return {
      alpha: cfg.alpha,
      dark: rgbStr(mixRgb([46, 60, 32], HAZE_RGB, 0.15 + h * 0.65), 0.86),
      light: rgbStr(mixRgb([198, 196, 136], HAZE_RGB, 0.18 + h * 0.6), 0.76),
      goldDark: rgbStr(mixRgb([150, 108, 34], HAZE_RGB, 0.15 + h * 0.65), 0.86),
      goldLight: rgbStr(mixRgb([255, 228, 156], HAZE_RGB, 0.12 + h * 0.5), 0.8),
      ring: rgbStr(mixRgb([226, 220, 172], HAZE_RGB, h * 0.4), 0.14),
      straw: rgbStr(mixRgb([178, 160, 96], HAZE_RGB, 0.18 + h * 0.6), 0.20)
    };
  });

  /* 每行每株的绘制透明度（远景轻一点，融入雾里） */
  var ROW_STYLES = ROWS.map(function (row) {
    return { alpha: TIERS[row.tier].alpha };
  });

  /* 各档的平均 draw scale，用于留茬线宽 */
  var TIER_AVG = [0, 0, 0];
  (function () {
    var sum = [0, 0, 0];
    var wsum = [0, 0, 0];
    for (var i = 0; i < ROWS.length; i++) {
      var r = ROWS[i];
      sum[r.tier] += r.scale * r.weight;
      wsum[r.tier] += r.weight;
    }
    for (var t = 0; t < 3; t++) TIER_AVG[t] = wsum[t] ? sum[t] / wsum[t] : 1;
  })();

  /* ================================================================ 类 */
  class RiceField {
    constructor() {
      this.width = 1600;
      this.height = 900;
      this._u = 1;
      this._top = 900 * 0.49;
      this._bottom = 900 * 1.02;

      this._plants = [];
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
      this._cutRange = 1;

      this._events = [];
      this._storm = null;
      this._stormX = -9999;

      this._sprites = null;
      this._spriteFailed = false;
      this._metrics = null;

      this._stats = { uncut: 0, total: 0, golden: 0 };

      /* 仅供 QA（预览页）调整重生节奏；主程序无需关心 */
      this.regrowScale = 1;

      /* 契约允许保留的开关；本实现默认走整丛预渲染精灵。 */
      this.fastMode = false;
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

      if (!this._built) return;

      var sx = w / oldW;
      var ratioH = h / oldH;
      var spanRatio = (this._bottom - this._top) / Math.max(1, oldBottom - oldTop);
      for (var i = 0; i < this._plants.length; i++) {
        var p = this._plants[i];
        p.x = clamp(p.x * sx, 0, w);
        p.y = this._top + (p.y - oldTop) * spanRatio;
        p.height *= ratioH;
        p.stubH *= ratioH;
      }
      this._adjustCount(this._targetCount());
      this._resort();
      this._updateSwayAndGeometry(this._time);
      this._countStats();
    }

    _targetCount() {
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

      var shared = ensureShared();
      this._metrics = shared.metrics;

      var target = this._targetCount();
      var counts = this._distributeCounts(target);
      var plants = [];
      for (var r = 0; r < ROWS.length; r++) {
        var n = counts[r];
        var spacing = this.width / n;
        var rowShift = ((r * 0.37) % 1) * 0.62;
        for (var i = 0; i < n; i++) {
          var x = clamp(
            (i + 0.5 + rowShift + (this._rng() - 0.5) * 0.86) * spacing,
            2,
            this.width - 2
          );
          plants.push(this._makePlant(r, x, this._rng));
        }
      }
      this._plants = plants;
      this._built = true;
      this._resort();
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

    _pickRow(rand) {
      var acc = 0;
      for (var r = 0; r < ROWS.length; r++) {
        acc += ROWS[r].weight;
        if (rand <= acc) return r;
      }
      return ROWS.length - 1;
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
          var rowIndex = this._pickRow(rnd());
          var x = rnd() * this.width;
          plants.push(this._makePlant(rowIndex, x, rnd));
        }
      }
    }

    _resort() {
      this._plants.sort(function (a, b) {
        return a.y - b.y;
      });
    }

    _makePlant(rowIndex, x, rng) {
      var row = ROWS[rowIndex];
      var style = ROW_STYLES[rowIndex];
      var u = this._u;
      var scale = row.scale;
      var height = (150 + rng() * 92) * scale * u;
      var golden = rng() < this._goldenChance();

      var p = {
        x: x,
        y: this._top + (row.t + (rng() - 0.5) * 0.032) * (this._bottom - this._top),
        row: rowIndex,
        tier: row.tier,
        style: style,
        scale: scale,
        height: height,
        golden: golden,
        variant: (rng() * 6) | 0,
        phase: rng() * TAU,
        lean: (rng() - 0.5) * 0.16,
        state: STATE_STAND,
        growth: 1,
        growthScale: 1,
        growDur: 0.52,
        spawnGlow: 0,
        fallAngle: 0,
        fallVel: 0,
        fallTarget: 0,
        fade: 0,
        alpha: 1,
        landed: false,
        strawFade: 0,
        regrowAt: Infinity,
        stubH: height * (0.055 + rng() * 0.035),
        stubGeo: null,
        rippleT: 0,
        sway: 0,
        flutter: 0,
        drawAng: 0,
        visH: height,
        hx0: x, hy0: p0Y(this, row, height),
        hx1: x, hy1: p0Y(this, row, height),
        hx2: x, hy2: p0Y(this, row, height),
        hx3: x, hy3: p0Y(this, row, height)
      };
      return p;
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
      if (!this._metrics) this._metrics = ensureShared().metrics;

      /* 1) 金风前沿 */
      if (this._storm) {
        this._storm.t += dt;
        var prog = Math.min(1, this._storm.t / this._storm.dur);
        this._stormX = -40 + (this.width + 80) * prog;
      }

      /* 2) 状态机 / 物理 */
      var plants = this._plants;
      for (var i = 0; i < plants.length; i++) {
        var p = plants[i];
        if (p.strawFade > 0) p.strawFade = Math.max(0, p.strawFade - dt / 0.8);
        if (p.rippleT > 0) p.rippleT = Math.max(0, p.rippleT - dt * 1.8);

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
            p.spawnGlow = Math.max(0, 1 - g0 * 1.7);
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
            if (p.scale > 0.62) p.rippleT = 0.5;
          }
          if (p.landed) {
            p.fade += dt;
            p.alpha = Math.max(0, 1 - p.fade / 0.55);
            if (p.alpha <= 0) {
              p.state = STATE_STUB;
              p.alpha = 1;
              p.fade = 0;
              p.sway = 0;
            }
          }
        }
      }

      /* 3) 摆动 + 锚点几何 */
      this._updateSwayAndGeometry(time);

      /* 4) 金风：逐帧从左向右割倒，事件进 outbox */
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
      if (!this._metrics) this._metrics = ensureShared().metrics;
      var metrics = this._metrics;
      var plants = this._plants;
      var reducedAmp = this._reduced ? 0.42 : 1;
      var wind = this._wind;
      var gust = this._gust;
      var pointer = this._pointer;
      var storm = this._storm ? this._stormX : -9999;
      var stormZone = 240 * this._u;

      for (var i = 0; i < plants.length; i++) {
        var p = plants[i];
        if (p.state === STATE_STUB) {
          p.sway = 0;
          p.drawAng = 0;
          p.visH = 0;
          continue;
        }

        var vis = p.state === STATE_GROW ? p.growthScale : 1;
        p.visH = p.height * vis;
        var H = p.height;
        var phase = p.phase;

        /* 成浪：两道相位不同的行波 + 阵风包络 */
        var wave1 = Math.sin(time * 1.15 + p.x * 0.0125 + p.y * 0.0035 + phase * 0.45);
        var wave2 = Math.sin(time * 0.55 - p.x * 0.0052 + p.y * 0.0055 + phase * 0.72);
        var amp = (0.016 + gust * 0.032 + Math.abs(wind) * 0.020) * reducedAmp;
        var sway = (wave1 * 0.66 + wave2 * 0.34) * amp;
        sway += wind * 0.030 * reducedAmp;
        var band = Math.sin(time * 0.72 + p.x * 0.0042 + p.y * 0.003);
        sway += band * band * band * gust * 0.028 * reducedAmp;

        /* 指针拂动 */
        var fl = 0;
        if (pointer.active) {
          var dxp = p.x - pointer.x;
          var dyp = (p.y - pointer.y) * 0.55;
          var R = 205 * this._u * (0.62 + p.scale * 0.38);
          var d2 = dxp * dxp + dyp * dyp;
          if (d2 < R * R) {
            var d = Math.sqrt(d2) + 0.001;
            var f = 1 - d / R;
            f *= f;
            fl = f;
            sway += (dxp >= 0 ? 1 : -1) * f * 0.045 * reducedAmp;
            sway += Math.sin(time * 9.5 + phase * 2.3) * f * 0.024 * reducedAmp;
          }
        }
        p.flutter = fl;

        /* 金风压弯未割的稻丛 */
        if (this._storm) {
          var dF = p.x - storm;
          if (dF > -80 * this._u && dF < stormZone) {
            var ff = 1 - Math.abs(dF - 50 * this._u) / (stormZone + 60 * this._u);
            if (ff > 0) sway += ff * ff * 0.11;
          }
        }

        if (p.state === STATE_FALL) {
          sway *= Math.max(0, 1 - Math.abs(p.fallAngle) / 1.8);
        }
        p.sway = sway;

        var ang = p.lean + sway + (p.state === STATE_FALL ? p.fallAngle : 0);
        p.drawAng = ang;

        var s = p.visH / CLUMP_H;
        var cs = Math.cos(ang);
        var sn = Math.sin(ang);
        var m = metrics[p.variant];

        p.hx0 = p.x + (m.h0x * cs - m.h0y * sn) * s;
        p.hy0 = p.y + (m.h0x * sn + m.h0y * cs) * s;
        p.hx1 = p.x + (m.h1x * cs - m.h1y * sn) * s;
        p.hy1 = p.y + (m.h1x * sn + m.h1y * cs) * s;
        p.hx2 = p.x + (m.h2x * cs - m.h2y * sn) * s;
        p.hy2 = p.y + (m.h2x * sn + m.h2y * cs) * s;
        p.hx3 = p.x + (m.h3x * cs - m.h3y * sn) * s;
        p.hy3 = p.y + (m.h3x * sn + m.h3y * cs) * s;
      }
    }

    _startGrow(p) {
      p.state = STATE_GROW;
      p.growth = 0;
      p.growthScale = 0.12;
      p.growDur = this._frenzy ? 0.30 : 0.52;
      p.spawnGlow = 1;
      p.alpha = 1;
      p.fade = 0;
      p.landed = false;
      p.fallAngle = 0;
      p.fallVel = 0;
      p.regrowAt = Infinity;
      p.golden = this._rng() < this._goldenChance();
      p.variant = (this._rng() * 6) | 0;
      p.phase = this._rng() * TAU;
    }

    _canCut(p) {
      if (p.state === STATE_STAND) return true;
      if (p.state === STATE_GROW && p.growth > 0.5) return true;
      return false;
    }

    _goldenChance() {
      var c = 0.055 * this._goldenBoost * (this._frenzy ? 1.8 : 1);
      return Math.min(0.85, c);
    }

    /* 内部：割倒一株；返回事件对象 */
    _cutPlant(p, dir, speed) {
      var growthVis = p.state === STATE_GROW ? p.growthScale : 1;
      var event = {
        x: p.hx0,
        y: p.hy0,
        golden: p.golden,
        scale: p.scale * (p.golden ? 1.1 : 1) * Math.max(0.6, growthVis),
        angle: p.drawAng
      };

      p.state = STATE_FALL;
      p.fallAngle = 0;
      p.fallVel = dir * (4.4 + Math.min(6.5, Math.abs(speed) * 1.45) + this._rng() * 2.4);
      p.fallTarget = dir * (1.14 + this._rng() * 0.34);
      p.landed = false;
      p.fade = 0;
      p.alpha = 1;
      p.rippleT = 0;
      var delay = this._frenzy ? (0.9 + this._rng() * 1.1) : (3.0 + this._rng() * 3.0);
      p.regrowAt = this._clock + delay * this.regrowScale;
      p.stubH = clamp(p.height * growthVis * (0.05 + this._rng() * 0.045), 3, 24 * this._u);
      p.strawFade = 1;

      /* 留茬几何（2–3 根短断秆） */
      var u = this._u;
      var geo = [];
      var count = 2 + ((this._rng() < 0.5) ? 1 : 0);
      for (var i = 0; i < count; i++) {
        geo.push({
          dx: (this._rng() - 0.5) * 11 * p.scale * u,
          lean: (this._rng() - 0.5) * 0.7,
          hf: 0.72 + this._rng() * 0.42
        });
      }
      p.stubGeo = geo;
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
        var r = (26 + 14 * p.scale) * (this._cutRange || 1) * (p.golden ? 1.35 : 1);
        var r2 = r * r;

        /* 四个采样点：主穗 / 穗颈 / 冠层中心 / 副穗，一划多杀且不重复计 */
        var hit = false;
        if (len2 < 1e-6) {
          var ddx = p.hx0 - x0;
          var ddy = p.hy0 - y0;
          if (ddx * ddx + ddy * ddy <= r2) hit = true;
          else {
            ddx = p.hx1 - x0;
            ddy = p.hy1 - y0;
            if (ddx * ddx + ddy * ddy <= r2) hit = true;
            else {
              ddx = p.hx2 - x0;
              ddy = p.hy2 - y0;
              if (ddx * ddx + ddy * ddy <= r2) hit = true;
              else {
                ddx = p.hx3 - x0;
                ddy = p.hy3 - y0;
                if (ddx * ddx + ddy * ddy <= r2) hit = true;
              }
            }
          }
        } else {
          if (distToSeg2(p.hx0, p.hy0, x0, y0, dx, dy, len2) <= r2) hit = true;
          else if (distToSeg2(p.hx1, p.hy1, x0, y0, dx, dy, len2) <= r2) hit = true;
          else if (distToSeg2(p.hx2, p.hy2, x0, y0, dx, dy, len2) <= r2) hit = true;
          else if (distToSeg2(p.hx3, p.hy3, x0, y0, dx, dy, len2) <= r2) hit = true;
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

    /* -------------------------------------------------------------- 绘制 */
    draw(ctx, opts) {
      if (!ctx || !this._built) return;
      opts = opts || {};
      var time = isFinite(+opts.time) ? +opts.time : this._time;
      var frenzy = clamp(+opts.frenzy || 0, 0, 1);

      if (!this._sprites) this._ensureSprites();
      if (!this._sprites) return;

      var sprites = this._sprites;
      var plants = this._plants;

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.imageSmoothingEnabled = true;

      /* 远 → 近逐档：先该档留茬，再该档稻丛，保证遮挡关系近似正确 */
      for (var t = 2; t >= 0; t--) {
        this._drawStubTier(ctx, t);
        for (var i = 0; i < plants.length; i++) {
          var p = plants[i];
          if (p.tier !== t || p.state === STATE_STUB) continue;
          if (p.x < -260 || p.x > this.width + 260) continue;
          if (p.y - p.visH * 1.28 > this.height + 40) continue;

          var baseAlpha = p.alpha * p.style.alpha;
          if (p.state === STATE_GROW) baseAlpha *= Math.min(1, 0.32 + p.growth * 1.15);
          if (baseAlpha <= 0.01) continue;

          var sprite = p.golden ? sprites.gold[t][p.variant] : sprites.normal[t][p.variant];
          var s = p.visH / CLUMP_H;
          if (s <= 0.001) continue;

          ctx.globalAlpha = baseAlpha;
          ctx.save();
          ctx.translate(p.x, p.y);
          if (p.drawAng) ctx.rotate(p.drawAng);
          ctx.drawImage(sprite, -ROOT_X * s, -ROOT_Y * s, SPR_W * s, SPR_H * s);
          ctx.restore();
        }
      }

      /* 加色层：金色呼吸光、重生微光、落水涟漪、金风扫场光带 */
      ctx.globalAlpha = 1;
      this._drawAdditive(ctx, time, frenzy);

      ctx.restore();
    }

    _drawStubTier(ctx, tier) {
      var plants = this._plants;
      var style = STUB_STYLES[tier];
      var u = this._u;
      var i;
      var j;
      var p;
      var started;

      ctx.globalAlpha = style.alpha;

      /* 普通断茬暗部 */
      started = false;
      ctx.beginPath();
      for (i = 0; i < plants.length; i++) {
        p = plants[i];
        if (p.tier !== tier || p.golden) continue;
        if (p.state === STATE_STAND || p.state === STATE_GROW) continue;
        if (!p.stubGeo) continue;
        for (j = 0; j < p.stubGeo.length; j++) {
          var g = p.stubGeo[j];
          var sx = p.x + g.dx;
          var sy = p.y;
          var h = p.stubH * g.hf;
          var tx = sx + g.lean * h * 0.55;
          var ty = sy - h;
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(sx + g.lean * h * 0.2, sy - h * 0.55, tx, ty);
          started = true;
        }
      }
      if (started) {
        ctx.strokeStyle = style.dark;
        ctx.lineWidth = (0.9 + 1.5 * TIER_AVG[tier]) * u;
        ctx.stroke();
      }

      /* 普通断口亮面 */
      started = false;
      ctx.beginPath();
      for (i = 0; i < plants.length; i++) {
        p = plants[i];
        if (p.tier !== tier || p.golden) continue;
        if (p.state === STATE_STAND || p.state === STATE_GROW) continue;
        if (!p.stubGeo) continue;
        for (j = 0; j < p.stubGeo.length; j++) {
          var g2 = p.stubGeo[j];
          var h2 = p.stubH * g2.hf;
          var tx2 = p.x + g2.dx + g2.lean * h2 * 0.55;
          var ty2 = p.y - h2;
          ctx.moveTo(tx2 - 1.4 * u, ty2 + 0.5 * u);
          ctx.lineTo(tx2 + 1.2 * u, ty2 - 0.7 * u);
          started = true;
        }
      }
      if (started) {
        ctx.strokeStyle = style.light;
        ctx.lineWidth = Math.max(0.55, (0.55 + 0.5 * TIER_AVG[tier]) * u);
        ctx.stroke();
      }

      /* 金色断茬 */
      started = false;
      ctx.beginPath();
      for (i = 0; i < plants.length; i++) {
        p = plants[i];
        if (p.tier !== tier || !p.golden) continue;
        if (p.state === STATE_STAND || p.state === STATE_GROW) continue;
        if (!p.stubGeo) continue;
        for (j = 0; j < p.stubGeo.length; j++) {
          var g3 = p.stubGeo[j];
          var h3 = p.stubH * g3.hf;
          var tx3 = p.x + g3.dx + g3.lean * h3 * 0.55;
          ctx.moveTo(p.x + g3.dx, p.y);
          ctx.quadraticCurveTo(p.x + g3.dx + g3.lean * h3 * 0.2, p.y - h3 * 0.55, tx3, p.y - h3);
          started = true;
        }
      }
      if (started) {
        ctx.strokeStyle = style.goldDark;
        ctx.lineWidth = (0.9 + 1.5 * TIER_AVG[tier]) * u;
        ctx.stroke();
      }

      /* 断口处的水圈（只给中近景，淡） */
      if (tier < 2) {
        started = false;
        ctx.beginPath();
        for (i = 0; i < plants.length; i++) {
          p = plants[i];
          if (p.tier !== tier) continue;
          if (p.state === STATE_STAND || p.state === STATE_GROW) continue;
          if (p.scale < 0.55) continue;
          var rx = (8 + 10 * p.scale) * u;
          var ry = rx * 0.26;
          ctx.moveTo(p.x + rx, p.y + 1.5 * u);
          ctx.ellipse(p.x, p.y + 1.5 * u, rx, ry, 0, 0, PI);
          started = true;
        }
        if (started) {
          ctx.strokeStyle = style.ring;
          ctx.lineWidth = Math.max(0.5, 0.8 * u);
          ctx.stroke();
        }
      }

      /* 刚落下的浮草（0.8s 内淡出，统一低透明度） */
      started = false;
      ctx.beginPath();
      for (i = 0; i < plants.length; i++) {
        p = plants[i];
        if (p.tier !== tier || p.strawFade <= 0.02) continue;
        if (p.state === STATE_STAND) continue;
        var ang = p.phase * 1.7;
        for (j = 0; j < 2; j++) {
          var a2 = ang + j * 1.9;
          var len = (6 + 11 * Math.min(1.2, p.scale)) * u;
          var sx2 = p.x + Math.cos(a2) * 4 * u;
          var sy2 = p.y - 1.2 * u;
          ctx.moveTo(sx2, sy2);
          ctx.quadraticCurveTo(
            sx2 + Math.cos(a2) * len * 0.5,
            sy2 - (1.5 + j * 1.8) * u,
            sx2 + Math.cos(a2) * len,
            sy2 - Math.sin(a2 * 1.2) * len * 0.2
          );
          started = true;
        }
      }
      if (started) {
        ctx.strokeStyle = style.straw;
        ctx.lineWidth = Math.max(0.5, (0.5 + 0.5 * TIER_AVG[tier]) * u);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    _drawAdditive(ctx, time, frenzy) {
      var plants = this._plants;
      var sprites = this._sprites;
      var u = this._u;
      var i;
      var p;
      var w = this.width;
      var h = this.height;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      for (i = 0; i < plants.length; i++) {
        p = plants[i];

        if (p.state === STATE_STAND && p.golden) {
          if (p.x < -200 || p.x > w + 200) continue;
          var pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + p.phase * 1.3);
          var boost = 1 + frenzy * 0.8;
          var gr = p.visH * (0.62 + 0.10 * pulse);
          ctx.globalAlpha = Math.min(1, p.style.alpha * (0.10 + 0.07 * pulse) * boost);
          ctx.drawImage(sprites.glow, p.hx0 - gr * 0.5, p.hy0 - gr * 0.5, gr, gr);

          var starCount = p.scale > 0.82 ? 2 : 1;
          for (var k = 0; k < starCount; k++) {
            var a = time * (1.1 + k * 0.5) + p.phase + k * 2.2;
            var ss = (0.8 + 1.1 * p.scale) * (0.7 + 0.45 * Math.sin(time * 3.0 + a));
            if (ss < 0.5) continue;
            var sx = p.hx0 + Math.cos(a * 1.25 + k) * p.visH * 0.20;
            var sy = p.hy0 + Math.sin(a * 1.6 + k) * p.visH * 0.16;
            ctx.globalAlpha = Math.min(1, p.style.alpha * (0.24 + 0.28 * pulse));
            ctx.drawImage(sprites.star, sx - ss, sy - ss, ss * 2, ss * 2);
          }
        } else if (p.state === STATE_GROW && p.spawnGlow > 0.01) {
          var sgr = p.visH * 0.9;
          ctx.globalAlpha = Math.min(1, p.style.alpha * p.spawnGlow * 0.34);
          ctx.drawImage(sprites.glow, p.x - sgr * 0.5, p.y - p.visH * 0.55 - sgr * 0.35, sgr, sgr);
        } else if (p.state === STATE_FALL && p.rippleT > 0.01) {
          var rr = (26 + 30 * p.scale) * u * (1.15 - p.rippleT * 0.5);
          var rh = rr * 0.30;
          ctx.globalAlpha = Math.min(1, p.rippleT * 0.7 * p.style.alpha);
          ctx.drawImage(sprites.ripple, p.x - rr, p.y - rh * 0.5 + 2 * u, rr * 2, rh * 2);
        }
      }

      /* 金风扫场光带 */
      if (this._storm) {
        var prog = clamp(this._storm.t / this._storm.dur, 0, 1);
        var x = -40 + (this.width + 80) * prog;
        var fade = Math.sin(prog * PI);
        var bandW = 300 * u;
        var top = this._top - 50 * u;
        ctx.globalAlpha = (0.42 + frenzy * 0.12) * fade * (this._reduced ? 0.6 : 1);
        ctx.drawImage(sprites.sweep, x - bandW * 0.5, top, bandW, h - top + 70 * u);
      }

      ctx.restore();
      ctx.globalAlpha = 1;
    }

    _ensureSprites() {
      if (this._sprites || this._spriteFailed) return;
      if (typeof document === 'undefined') {
        this._spriteFailed = true;
        return;
      }
      var shared = ensureShared();
      if (!shared.sprites) {
        var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
        shared.sprites = buildSpriteSet(shared.plans);
        if (t0 && typeof performance !== 'undefined' && performance.now) {
          this._spriteBuildMs = performance.now() - t0;
        }
      }
      this._sprites = shared.sprites;
      this._metrics = shared.metrics;
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

  /* 只用于 _makePlant 初始占位锚点 */
  function p0Y(field, row, height) {
    return field._top + row.t * (field._bottom - field._top) - height * 0.55;
  }

  global.RiceField = RiceField;
})(typeof window !== 'undefined' ? window : this);
