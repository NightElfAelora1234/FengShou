/*!
 * 穗浪 SUÌ LÀNG — js/audio.js
 * 程序化黄昏音景引擎（WebAudio 纯合成，零外部资源，经典 script）。
 *
 * ── 契约（DESIGN.md 5.1）────────────────────────────────────────────────────
 *   const audio = new HarvestAudio();   // 只初始化字段，绝不创建 AudioContext
 *   await audio.start();                // 用户手势内调用，创建/恢复 AudioContext 与总线
 *   audio.setMuted(m);  audio.muted     // 静音（持久化到 localStorage['suilang.muted']）
 *   audio.setScene(s);                  // 'menu' | 'play' | 'end'，淡入淡出
 *   audio.gameStart();                  // 开场钟声
 *   audio.gameEnd(rank);                // 收工和弦（rank: 'S'|'A'|'B'|'C'）
 *   audio.cut({strength,combo,golden,pan}); // 挥镰：短促 swish + 五声拨弦，连斩音高上行
 *   audio.comboMilestone(level);        // 连斩里程碑亮音
 *   audio.frenzyReady();                // 能量满提示
 *   audio.frenzyStart();                // 丰饶之刻：低频冲击 + 铃声上行 + 风声爆发
 *   audio.frenzyEnd();
 *   audio.storm();                      // 金风扫场（横向 whoosh）
 *   audio.ui('hover'|'click'|'start'|'back');
 *   audio.pause(); audio.resume();
 *   audio.update(dt, {combo, frenzy:0..1, time}); // 驱动环境（风、鸟、拨弦）
 *   audio.dispose();
 *
 * ── 安全约定 ───────────────────────────────────────────────────────────────
 *   · 未 start()、WebAudio 不可用、页面隐藏、暂停中：所有发声方法安全 no-op。
 *   · 构造、字段初始化阶段不触碰 AudioContext / 不发出任何声音。
 *   · 总线：混响发送 → 卷积混响（程序生成 IR）→ 总线压缩 → 限幅 → 软削波，
 *     任何情况下输出峰值 < 1，不爆音。
 *   · 切割声部：滚动 1 秒窗口最多 10 个，超出直接丢弃（保护 CPU 与听感）。
 *   · 默认音量克制；高频内容全部经过低通/带通柔化，耐听、不刺耳。
 *
 * ── 自动化测试接口（额外，不影响契约）──────────────────────────────────────
 *   await audio.renderOffline({duration, scene, events, simulate, state})
 *     在 OfflineAudioContext 中渲染同一套音景，返回 {buffer, stats}。
 *   HarvestAudio.analyseBuffer(buffer) → {rms, peak, nan, frames, channels}
 *   手动试听与自检：qa/audio-smoke.html
 *
 * 测试：node --check js/audio.js；无头 Chrome 打开 qa/audio-smoke.html。
 */
(function (global) {
  'use strict';

  /* ============================== 常量 ============================== */

  var STORAGE_KEY = 'suilang.muted';
  var MASTER_LEVEL = 0.9;              // 总线主音量（克制）
  var MAX_CUTS_PER_SECOND = 10;        // 「单帧同秒最多 ~10 个切割声部」
  var MAX_STARTED_VOICES = 10;

  // D 大调五声音阶（D E F# A B），用于连斩上行与稀疏拨弦
  // midi：62=D4 64=E4 66=F#4 69=A4 71=B4 74=D5 76=E5 78=F#5 81=A5 83=B5
  var CUT_SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83];
  var AMBIENT_PLUCKS = [50, 57, 62, 64, 66, 69, 71, 74, 76, 78]; // D3 A3 D4…F#5

  // 三个场景的环境目标值（增益均经过听感权衡，整体非常克制）
  var SCENE_CONFIG = {
    menu: {
      wind: 0.078, hiss: 0.030, pad: 0.62, padColor: 0.18,
      padCutoff: 940, windCutoff: 290, hissFreq: 1450,
      pluckRate: 0.075, birdRate: 0.055, pluckLevel: 1.0
    },
    play: {
      wind: 0.060, hiss: 0.026, pad: 0.52, padColor: 0.42,
      padCutoff: 1080, windCutoff: 320, hissFreq: 1550,
      pluckRate: 0.12, birdRate: 0.042, pluckLevel: 0.95
    },
    end: {
      wind: 0.052, hiss: 0.021, pad: 0.70, padColor: 0.30,
      padCutoff: 820, windCutoff: 270, hissFreq: 1350,
      pluckRate: 0.055, birdRate: 0.065, pluckLevel: 0.9
    }
  };

  /* ============================== 工具 ============================== */

  function clamp(value, lo, hi) {
    return value < lo ? lo : value > hi ? hi : value;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function makeSoftClipCurve(length) {
    // 0.6 以下完全透明，之上平滑饱和；输出严格 < 1，物理上不可能爆音。
    var n = length || 4096;
    var curve = new Float32Array(n);
    var knee = 0.6;
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      var a = x < 0 ? -x : x;
      var y;
      if (a <= knee) {
        y = x;
      } else {
        var t = (a - knee) / (1 - knee);
        y = (knee + (1 - knee) * Math.tanh(t)) * (x < 0 ? -1 : 1);
      }
      curve[i] = y;
    }
    return curve;
  }

  function configureCompressor(node, threshold, knee, ratio, attack, release) {
    try {
      node.threshold.value = threshold;
      node.knee.value = knee;
      node.ratio.value = ratio;
      node.attack.value = attack;
      node.release.value = release;
    } catch (e) { /* 某些环境参数受限，忽略 */ }
  }

  /* ============================== 主类 ============================== */

  class HarvestAudio {
    /**
     * @param {{offline?:boolean}} [options] offline 仅供 OfflineAudioContext 自检使用。
     * 构造阶段只做字段初始化：不创建 AudioContext、不发声、不联网。
     */
    constructor(options) {
      var opts = options && typeof options === 'object' ? options : {};
      this._offline = !!opts.offline;
      this._disposed = false;
      this._supported = true;
      this._ctx = null;
      this._started = false;
      this._startingPromise = null;

      this._muted = this._readMuted();
      this._scene = 'menu';
      this._sceneCfg = SCENE_CONFIG.menu;
      this._paused = false;
      this._hidden = false;
      this._listenersBound = false;
      this._onVisibility = null;
      this._disposeTimer = 0;

      // 环境调度状态
      this._frenzy = 0;
      this._gust = 0.42;
      this._gustPhase = Math.random() * 20;
      this._ambientClock = 0;
      this._pluckAcc = 0;
      this._birdAcc = 0;

      // 限制与冷却
      this._voiceTimes = [];
      this._lastUiTime = -100;
      this._lastMilestoneTime = -100;
      this._lastReadyTime = -100;

      // 离线渲染时钟（OfflineAudioContext.currentTime 在渲染前恒为 0）
      this._offlineTime = 0;

      // 总线与常驻声源
      this._persistent = [];
      this._noiseBuffer = null;
      this._dry = null;
      this._revSend = null;
      this._revReturn = null;
      this._convolver = null;
      this._revHP = null;
      this._revLP = null;
      this._master = null;
      this._duck = null;
      this._comp = null;
      this._limiter = null;
      this._clip = null;
      this._windFilter = null;
      this._windGain = null;
      this._hissFilter = null;
      this._hissGain = null;
      this._padFilter = null;
      this._padGain = null;
      this._padColor = null;
    }

    /* ---------------------------- 只读状态 ---------------------------- */

    get muted() { return this._muted; }
    get started() { return this._started; }
    get supported() { return this._supported; }
    get scene() { return this._scene; }

    /* ---------------------------- 生命周期 ---------------------------- */

    /**
     * 创建 / 恢复音频上下文与总线。必须在用户手势内首次调用。
     * @param {{context?: BaseAudioContext, offline?: boolean}} [options] 仅供离线自检。
     * @returns {Promise<boolean>} 是否可用
     */
    start(options) {
      var self = this;
      var opts = options && typeof options === 'object' ? options : {};
      var external = opts.context || null;
      var offline = !!(opts.offline || (external && typeof external.startRendering === 'function'));

      if (this._disposed) return Promise.resolve(false);

      if (this._started && !external) {
        if (!this._offline && this._ctx && this._ctx.state === 'suspended' &&
            typeof this._ctx.resume === 'function') {
          try {
            var p = this._ctx.resume();
            if (p && p.catch) p.catch(function () {});
          } catch (e) { /* 下一次手势再试 */ }
        }
        return Promise.resolve(true);
      }
      if (this._started && external) return Promise.resolve(true);
      if (this._startingPromise) return this._startingPromise;

      this._startingPromise = (async function () {
        try {
          var ctx = external;
          if (!ctx) {
            var Ctor = global.AudioContext || global.webkitAudioContext;
            if (!Ctor) {
              self._supported = false;
              return false;
            }
            try {
              ctx = new Ctor({ latencyHint: 'interactive' });
            } catch (e1) {
              try {
                ctx = new Ctor();
              } catch (e2) {
                self._supported = false;
                return false;
              }
            }
          }

          self._ctx = ctx;
          self._offline = offline || (typeof ctx.startRendering === 'function');
          self._offlineTime = 0;
          self._buildGraph();
          self._setupAmbient();
          self._started = true;

          if (self._offline) {
            // 离线渲染不需要淡入等待，直接给到目标，便于自检快速得到稳态
            self._master.gain.value = MASTER_LEVEL;
            self._duck.gain.value = 1;
          } else {
            self._master.gain.value = 0;
            self._duck.gain.value = 1;
            self._bindVisibility();
            // 若在隐藏标签页中启动，直接保持静音，等可见时再淡入
            if (self._hidden) self._rampDuck(0.05);

            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
              try {
                var resumePromise = ctx.resume();
                if (resumePromise && resumePromise.then) await resumePromise;
              } catch (e) { /* 保持 suspended，下次手势再恢复 */ }
            }

            // 总线淡入，避免初开声场的爆点
            try {
              var now = ctx.currentTime;
              self._master.gain.cancelScheduledValues(now);
              self._master.gain.setValueAtTime(0, now);
              self._master.gain.linearRampToValueAtTime(
                self._muted ? 0 : MASTER_LEVEL, now + 0.5
              );
            } catch (e) { /* ignore */ }
          }

          self._applyScene(self._offline ? 0.18 : 1.0);
          return true;
        } catch (err) {
          try { console.warn('[HarvestAudio] start() failed:', err); } catch (e) {}
          self._started = false;
          self._supported = false;
          // 自建上下文启动失败时关闭，避免留下半成品图；外部上下文交给调用方
          if (!external && self._ctx && !self._offline) {
            try {
              var closePromise = self._ctx.close();
              if (closePromise && closePromise.catch) closePromise.catch(function () {});
            } catch (e) { /* ignore */ }
          }
          self._ctx = null;
          self._persistent.length = 0;
          return false;
        }
      })();

      return this._startingPromise.then(
        function (value) {
          self._startingPromise = null;
          return value;
        },
        function (err) {
          self._startingPromise = null;
          throw err;
        }
      );
    }

    /** 关闭上下文、释放常驻声源、移除监听。可重复调用。 */
    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      this._started = false;
      this._unbindVisibility();

      var now = this._now();
      try {
        if (this._master) {
          this._master.gain.cancelScheduledValues(now);
          this._master.gain.setValueAtTime(this._master.gain.value, now);
          this._master.gain.linearRampToValueAtTime(0, now + 0.08);
        }
      } catch (e) { /* ignore */ }

      var i;
      for (i = 0; i < this._persistent.length; i++) {
        var node = this._persistent[i];
        try {
          if (node && typeof node.stop === 'function') node.stop(now + 0.1);
        } catch (e) { /* already stopped */ }
      }

      var self = this;
      var ctx = this._ctx;
      var clear = function () {
        for (var j = 0; j < self._persistent.length; j++) {
          try { self._persistent[j].disconnect(); } catch (e) {}
        }
        self._persistent.length = 0;
        try {
          if (ctx && !self._offline && ctx.state !== 'closed' && typeof ctx.close === 'function') {
            var p = ctx.close();
            if (p && p.catch) p.catch(function () {});
          }
        } catch (e) {}
        self._ctx = null;
      };

      if (this._offline) {
        clear();
      } else {
        this._disposeTimer = global.setTimeout(clear, 140);
      }
      this._voiceTimes.length = 0;
      this._startingPromise = null;
      this._master = null;
      this._duck = null;
      this._dry = null;
      this._revSend = null;
    }

    /* ---------------------------- 静音 ---------------------------- */

    /** @param {boolean} value */
    setMuted(value) {
      var next = !!value;
      var changed = next !== this._muted;
      this._muted = next;
      this._writeMuted(next);
      if (changed && this._started && this._master) {
        this._rampGain(this._master.gain, next ? 0 : MASTER_LEVEL, 0.14);
      }
    }

    /** @returns {boolean} 取反后的静音状态 */
    toggleMuted() {
      this.setMuted(!this._muted);
      return this._muted;
    }

    /* ---------------------------- 场景 ---------------------------- */

    /**
     * 场景切换：环境层目标值渐隐渐显（不切断已有声音）。
     * @param {'menu'|'play'|'end'} scene
     */
    setScene(scene) {
      var name = scene === 'play' || scene === 'end' ? scene : 'menu';
      this._scene = name;
      this._sceneCfg = SCENE_CONFIG[name] || SCENE_CONFIG.menu;
      if (!this._started) return;
      this._applyScene(0.85);
    }

    /** 开局：开阔的钟声 + 暖风涌起 + 一声远鸟。 */
    gameStart() {
      if (!this._canPlay()) return;
      var t = this._now() + 0.01;
      this._fmBell(t, midiToFreq(50), { decay: 2.6, level: 0.14, index: 1.4, ratio: 2.01, send: 0.55, pan: -0.05 });
      this._fmBell(t + 0.07, midiToFreq(62), { decay: 2.2, level: 0.09, index: 1.1, ratio: 3.005, send: 0.6, pan: 0.1, shimmer: 0.5 });
      this._whoosh(t, { dur: 2.0, f0: 240, f1: 760, level: 0.045, attack: 0.7, fromPan: -0.35, toPan: 0.3, q: 0.6 });
      this._bird(t + rand(0.9, 1.5), rand(-0.65, 0.45));
    }

    /**
     * 收工：D 大调 add9 暖和弦 + 下行琶音（S 级加一串高音星尘）。
     * @param {'S'|'A'|'B'|'C'|string} [rank]
     */
    gameEnd(rank) {
      if (!this._canPlay()) return;
      var t = this._now() + 0.02;
      var r = rank == null ? '' : String(rank).toUpperCase();

      // 柔和持续和弦：D3 A3 D4 F#4 A4
      var chord = [
        { midi: 50, level: 0.075, pan: -0.30, attack: 0.45, hold: 4.2 },
        { midi: 57, level: 0.060, pan: 0.25, attack: 0.55, hold: 4.4 },
        { midi: 62, level: 0.055, pan: 0.02, attack: 0.40, hold: 4.0 },
        { midi: 66, level: 0.042, pan: -0.18, attack: 0.65, hold: 3.8 },
        { midi: 69, level: 0.035, pan: 0.34, attack: 0.70, hold: 4.5 }
      ];
      for (var i = 0; i < chord.length; i++) {
        var v = chord[i];
        this._sustainVoice(t + i * 0.03, midiToFreq(v.midi), {
          level: v.level,
          attack: v.attack,
          hold: v.hold,
          pan: v.pan,
          send: 0.55
        });
      }

      // 结束的呼吸：缓慢下行的风
      this._whoosh(t + 0.05, {
        dur: 2.6, f0: 780, f1: 240, level: 0.038, attack: 0.9,
        fromPan: 0.4, toPan: -0.4, q: 0.7
      });

      // 轻拨弦收束
      this._bellArp(t + 0.45, [74, 69, 66, 62], 0.16, {
        decay: 1.9, level: 0.055, send: 0.6, pan: 0.0
      });

      if (r === 'S') {
        this._bellArp(t + 1.05, [78, 81, 86], 0.14, {
          decay: 1.6, level: 0.042, send: 0.65, twinkle: true
        });
      }
    }

    /* ---------------------------- 手感 ---------------------------- */

    /**
     * 挥镰。同一秒最多 10 个声部，超出静默丢弃。
     * @param {{strength?:number, combo?:number, golden?:boolean, pan?:number}} [opts]
     */
    cut(opts) {
      if (!this._canPlay()) return;
      var o = opts && typeof opts === 'object' ? opts : {};
      this._cutAt(this._now() + 0.004, o);
    }

    /**
     * 连斩里程碑：亮音（拨弦 + 高频钟），随 level 上行。
     * @param {number} level
     */
    comboMilestone(level) {
      if (!this._canPlay()) return;
      var t = this._now() + 0.005;
      if (t - this._lastMilestoneTime < 0.26) return;
      this._lastMilestoneTime = t;

      var lv = Math.max(1, Math.floor(Number(level) || 1));
      var idx = Math.min(CUT_SCALE.length - 1, 4 + lv);
      var freq = midiToFreq(CUT_SCALE[idx]);
      this._pluck(t, freq, {
        level: 0.095, decay: 0.95, send: 0.42, brightness: 3400, pan: 0.08, pick: 0.35
      });
      this._pluck(t + 0.075, freq * 1.5, {
        level: 0.055, decay: 0.75, send: 0.46, brightness: 3800, pan: -0.08
      });
      if (lv >= 3) {
        this._fmBell(t + 0.13, midiToFreq(CUT_SCALE[Math.min(CUT_SCALE.length - 1, 6 + lv)]), {
          decay: 1.2, level: 0.05, send: 0.55, index: 1.4
        });
      }
    }

    /** 能量满：温柔而明确的两音提示 + 向上的空气。 */
    frenzyReady() {
      if (!this._canPlay()) return;
      var t = this._now() + 0.01;
      if (t - this._lastReadyTime < 0.8) return;
      this._lastReadyTime = t;

      this._fmBell(t, midiToFreq(74), { decay: 1.3, level: 0.085, send: 0.5, index: 1.2, pan: -0.1 });
      this._fmBell(t + 0.13, midiToFreq(81), { decay: 1.5, level: 0.095, send: 0.55, index: 1.0, pan: 0.1 });
      this._pluck(t + 0.05, midiToFreq(69), { level: 0.06, decay: 0.7, send: 0.4, brightness: 3000 });
      this._whoosh(t, { dur: 1.0, f0: 520, f1: 1900, level: 0.028, attack: 0.4, fromPan: -0.2, toPan: 0.35, q: 1.0 });
    }

    /** 丰饶之刻：低频冲击 + 铃声上行 + 风声爆发（把整个声场点亮）。 */
    frenzyStart() {
      if (!this._canPlay()) return;
      var t = this._now() + 0.01;

      this._thump(t, { f0: 112, f1: 30, dur: 0.95, level: 0.24 });
      this._whoosh(t, {
        dur: 1.5, f0: 480, f1: 2700, level: 0.085, attack: 0.28,
        fromPan: -0.65, toPan: 0.65, q: 0.8
      });
      this._bellArp(t + 0.05, [62, 66, 69, 74, 78, 81], 0.085, {
        decay: 1.6, level: 0.07, send: 0.55, twinkle: true
      });
      this._shimmer(t + 0.25, 2.4, 0.016);
      this._thump(t + 0.45, { f0: 72, f1: 38, dur: 0.6, level: 0.07 });
    }

    /** 狂热结束：铃声温柔下行，风声落回麦田。 */
    frenzyEnd() {
      if (!this._canPlay()) return;
      var t = this._now() + 0.01;
      this._bellArp(t, [81, 78, 74, 69, 66], 0.11, {
        decay: 1.9, level: 0.055, send: 0.6, pan: 0.15
      });
      this._whoosh(t + 0.1, {
        dur: 1.8, f0: 1900, f1: 300, level: 0.04, attack: 0.35,
        fromPan: 0.55, toPan: -0.45, q: 0.8
      });
    }

    /** 金风扫场：从左到右一整片风声，与 frenzyStart 的冲击区分开。 */
    storm() {
      if (!this._canPlay()) return;
      var t = this._now() + 0.01;

      this._thump(t, { f0: 92, f1: 34, dur: 0.7, level: 0.14 });
      this._whoosh(t + 0.02, {
        dur: 1.3, f0: 300, f1: 2500, level: 0.14, attack: 0.30,
        fromPan: -0.95, toPan: 0.95, q: 0.75
      });
      this._whoosh(t + 0.10, {
        dur: 1.6, f0: 950, f1: 260, level: 0.065, attack: 0.45,
        fromPan: -0.8, toPan: 0.85, q: 1.1
      });
      this._bellArp(t + 0.55, [74, 78, 81, 86], 0.07, {
        decay: 1.2, level: 0.045, send: 0.65, twinkle: true
      });
    }

    /**
     * UI 轻音。
     * @param {'hover'|'click'|'start'|'back'} [kind]
     */
    ui(kind) {
      if (!this._canPlay()) return;
      var t = this._now() + 0.004;
      if (t - this._lastUiTime < 0.05) return;
      this._lastUiTime = t;

      var k = kind || 'click';
      var ctx = this._ctx;

      if (k === 'hover') {
        var hoverOsc = ctx.createOscillator();
        hoverOsc.type = 'sine';
        hoverOsc.frequency.setValueAtTime(760, t);
        hoverOsc.frequency.exponentialRampToValueAtTime(880, t + 0.05);
        var hoverEnv = this._env(t, 0.011, 0.006, 0.055);
        var hoverLp = ctx.createBiquadFilter();
        hoverLp.type = 'lowpass';
        hoverLp.frequency.value = 2200;
        hoverOsc.connect(hoverEnv);
        hoverEnv.connect(hoverLp);
        var hoverNodes = [hoverEnv, hoverLp].concat(this._routeVoice(hoverLp, { pan: 0, send: 0.12 }));
        hoverOsc.start(t);
        this._finish([hoverOsc], hoverNodes, t + 0.09);
        return;
      }

      if (k === 'start') {
        this._pluck(t, midiToFreq(69), { level: 0.075, decay: 0.55, send: 0.35, brightness: 3200, pan: -0.1 });
        this._pluck(t + 0.09, midiToFreq(76), { level: 0.07, decay: 0.7, send: 0.4, brightness: 3400, pan: 0.12 });
        return;
      }

      if (k === 'back') {
        this._pluck(t, midiToFreq(76), { level: 0.06, decay: 0.5, send: 0.35, brightness: 3000, pan: 0.1 });
        this._pluck(t + 0.085, midiToFreq(69), { level: 0.065, decay: 0.65, send: 0.4, brightness: 2800, pan: -0.1 });
        return;
      }

      // click：极轻的木质轻触
      var clickSrc = this._noiseSource(t, true);
      var clickHp = ctx.createBiquadFilter();
      clickHp.type = 'highpass';
      clickHp.frequency.value = 1800;
      var clickEnv = this._env(t, 0.03, 0.002, 0.035);
      clickSrc.connect(clickHp);
      clickHp.connect(clickEnv);
      var clickOsc = ctx.createOscillator();
      clickOsc.type = 'sine';
      clickOsc.frequency.setValueAtTime(520, t);
      clickOsc.frequency.exponentialRampToValueAtTime(420, t + 0.06);
      var clickTone = this._env(t, 0.018, 0.003, 0.06);
      clickOsc.connect(clickTone);
      clickTone.connect(clickEnv);
      var clickNodes = [clickHp, clickEnv, clickTone].concat(this._routeVoice(clickEnv, { pan: 0, send: 0.1 }));
      clickOsc.start(t);
      this._finish([clickSrc, clickOsc], clickNodes, t + 0.08);
    }

    /* ---------------------------- 时间轴 ---------------------------- */

    /** 暂停：总线 80ms 内淡出，不发爆点。 */
    pause() {
      if (!this._started || this._disposed) return;
      this._paused = true;
      this._rampDuck(0.08);
    }

    /** 恢复：尝试恢复上下文，总线 250ms 淡入。 */
    resume() {
      if (!this._started || this._disposed) return;
      this._paused = false;
      if (!this._offline && this._ctx && this._ctx.state === 'suspended' &&
          typeof this._ctx.resume === 'function') {
        try {
          var p = this._ctx.resume();
          if (p && p.catch) p.catch(function () {});
        } catch (e) { /* ignore */ }
      }
      this._rampDuck(0.25);
    }

    /**
     * 每帧驱动环境：风势起伏、偶尔鸟鸣、稀疏五声拨弦、frenzy 提亮。
     * @param {number} dt 秒
     * @param {{combo?:number, frenzy?:number, time?:number}} [state]
     */
    update(dt, state) {
      if (!this._canPlay()) return;
      var step = Number(dt);
      if (!isFinite(step) || step <= 0) return;
      step = Math.min(step, 0.1); // 跳帧保护，避免一次补太多事件

      var st = state && typeof state === 'object' ? state : {};
      var combo = Math.max(0, Number(st.combo) || 0);
      var frenzy = clamp(Number(st.frenzy) || 0, 0, 1);
      var now = this._now();

      // 风势：双正弦叠加，缓慢、不规律
      this._gustPhase += step * 0.13;
      this._gust = clamp(
        0.5 + 0.34 * Math.sin(this._gustPhase) + 0.16 * Math.sin(this._gustPhase * 2.37 + 1.3),
        0, 1
      );

      var frenzyChanged = Math.abs(frenzy - this._frenzy) > 0.025;
      this._frenzy = frenzy;

      // 环境参数每 ~0.18s 重新落一次，避免频繁调度
      this._ambientClock += step;
      if (this._ambientClock >= 0.18) {
        this._ambientClock = 0;
        this._scheduleAmbient(0.28);
      } else if (frenzyChanged) {
        this._scheduleAmbient(0.35);
      }

      var cfg = this._sceneCfg || SCENE_CONFIG.menu;

      // 稀疏五声拨弦
      var pluckRate = cfg.pluckRate *
        (1 + 0.85 * frenzy) *
        (1 + 0.45 * Math.min(1, combo / 40));
      this._pluckAcc += step * pluckRate;
      var guard = 0;
      while (this._pluckAcc >= 1 && guard++ < 3) {
        this._pluckAcc -= 1;
        this._ambientPluck(now + rand(0.03, 0.25));
      }

      // 偶尔的鸟鸣
      this._birdAcc += step * cfg.birdRate * (1 + 0.25 * frenzy);
      if (this._birdAcc >= 1) {
        this._birdAcc = 0;
        this._bird(now + rand(0.25, 0.9), rand(-0.7, 0.6));
      }
    }

    /* ---------------------------- 离线自检 ---------------------------- */

    /**
     * 在 OfflineAudioContext 中渲染一段可复现的音景，用于自动化验收。
     * @param {{duration?:number, sampleRate?:number, scene?:string,
     *          events?:Array<{at:number, method:string, args?:any[]}>,
     *          simulate?:boolean, simulateStep?:number,
     *          state?:{combo?:number, frenzy?:number}}} [options]
     * @returns {Promise<{buffer:AudioBuffer, stats:object}>}
     */
    async renderOffline(options) {
      var opts = options && typeof options === 'object' ? options : {};
      var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      if (!OAC) throw new Error('OfflineAudioContext is not supported');

      var duration = clamp(Number(opts.duration) || 4, 0.5, 60);
      var sampleRate = Math.round(clamp(Number(opts.sampleRate) || 44100, 8000, 96000));
      var ctx = new OAC(2, Math.ceil(duration * sampleRate), sampleRate);

      var probe = new HarvestAudio({ offline: true });
      var ok = await probe.start({ context: ctx, offline: true });
      if (!ok) throw new Error('offline audio graph failed to start');
      probe.setScene(opts.scene || 'play');

      var timeline = [];
      var ev, i;
      if (opts.simulate) {
        var simulationStep = clamp(Number(opts.simulateStep) || 0.05, 0.01, 0.5);
        for (var tt = 0; tt < duration - 0.001; tt += simulationStep) {
          timeline.push({ at: tt, update: simulationStep });
        }
      }
      var events = Array.isArray(opts.events) ? opts.events : [];
      for (i = 0; i < events.length; i++) {
        ev = events[i];
        if (!ev || typeof ev.method !== 'string') continue;
        timeline.push({
          at: Math.max(0, Number(ev.at) || 0),
          method: ev.method,
          args: Array.isArray(ev.args) ? ev.args : []
        });
      }
      timeline.sort(function (a, b) { return a.at - b.at; });

      var baseState = opts.state && typeof opts.state === 'object' ? opts.state : {};
      for (i = 0; i < timeline.length; i++) {
        var item = timeline[i];
        probe._offlineTime = item.at;
        if (item.update != null) {
          probe.update(item.update, {
            combo: Number(baseState.combo) || 0,
            frenzy: clamp(Number(baseState.frenzy) || 0, 0, 1),
            time: item.at
          });
        } else if (typeof probe[item.method] === 'function') {
          try { probe[item.method].apply(probe, item.args); } catch (e) { /* 事件级容错 */ }
        }
      }
      probe._offlineTime = duration;

      var buffer = await ctx.startRendering();
      return { buffer: buffer, stats: HarvestAudio.analyseBuffer(buffer) };
    }

    /** 统计一段 AudioBuffer：RMS / 峰值 / 非法样本数。 */
    static analyseBuffer(buffer) {
      if (!buffer || typeof buffer.getChannelData !== 'function') {
        return { rms: 0, peak: 0, nan: 0, frames: 0, channels: 0 };
      }
      var peak = 0;
      var sum = 0;
      var count = 0;
      var nan = 0;
      for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
        var data;
        try { data = buffer.getChannelData(ch); } catch (e) { continue; }
        for (var i = 0; i < data.length; i++) {
          var v = data[i];
          if (!Number.isFinite(v)) { nan++; continue; }
          var a = v < 0 ? -v : v;
          if (a > peak) peak = a;
          sum += v * v;
          count++;
        }
      }
      return {
        rms: count ? Math.sqrt(sum / count) : 0,
        peak: peak,
        nan: nan,
        frames: buffer.length,
        channels: buffer.numberOfChannels
      };
    }

    /* ==================================================================
     * 内部：总线 / 环境 / 合成
     * ================================================================== */

    _now() {
      if (!this._ctx) return 0;
      if (this._offline) return this._offlineTime || 0;
      return this._ctx.currentTime;
    }

    _canPlay() {
      if (!this._started || !this._ctx || this._disposed || !this._supported) return false;
      if (this._offline) return true;
      if (this._hidden || this._paused) return false;
      return true;
    }

    _readMuted() {
      try {
        var v = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
        return v === '1' || v === 'true';
      } catch (e) {
        return false;
      }
    }

    _writeMuted(flag) {
      try {
        if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, flag ? '1' : '0');
      } catch (e) { /* file:// 隐私模式等场景忽略 */ }
    }

    _bindVisibility() {
      if (this._listenersBound || typeof document === 'undefined') return;
      var self = this;
      this._onVisibility = function () {
        self._hidden = !!document.hidden;
        self._rampDuck(self._hidden ? 0.06 : 0.3);
        if (!self._hidden && !self._offline && self._ctx &&
            self._ctx.state === 'suspended' && typeof self._ctx.resume === 'function') {
          try {
            var p = self._ctx.resume();
            if (p && p.catch) p.catch(function () {});
          } catch (e) { /* ignore */ }
        }
      };
      try {
        document.addEventListener('visibilitychange', this._onVisibility);
        this._listenersBound = true;
        this._hidden = !!document.hidden;
      } catch (e) { /* ignore */ }
    }

    _unbindVisibility() {
      if (!this._listenersBound || typeof document === 'undefined') return;
      try { document.removeEventListener('visibilitychange', this._onVisibility); } catch (e) {}
      this._listenersBound = false;
      this._onVisibility = null;
    }

    _buildGraph() {
      var ctx = this._ctx;

      this._dry = ctx.createGain();
      this._revSend = ctx.createGain();
      this._master = ctx.createGain();
      this._duck = ctx.createGain();
      this._comp = ctx.createDynamicsCompressor();
      this._limiter = ctx.createDynamicsCompressor();
      this._clip = ctx.createWaveShaper();

      this._dry.gain.value = 1;
      this._revSend.gain.value = 1;
      this._master.gain.value = 0;
      this._duck.gain.value = 1;

      configureCompressor(this._comp, -15, 20, 3.5, 0.005, 0.26);
      configureCompressor(this._limiter, -2.5, 0, 20, 0.002, 0.09);

      this._clip.curve = makeSoftClipCurve(4096);
      try { this._clip.oversample = 'none'; } catch (e) {}

      // 卷积混响：程序生成的暗色 IR（黄昏空气感）
      this._convolver = ctx.createConvolver();
      try { this._convolver.normalize = true; } catch (e) {}
      this._convolver.buffer = this._makeIR(2.4);

      this._revHP = ctx.createBiquadFilter();
      this._revHP.type = 'highpass';
      this._revHP.frequency.value = 170;
      this._revHP.Q.value = 0.5;

      this._revLP = ctx.createBiquadFilter();
      this._revLP.type = 'lowpass';
      this._revLP.frequency.value = 5200;
      this._revLP.Q.value = 0.35;

      this._revReturn = ctx.createGain();
      this._revReturn.gain.value = 0.5;

      // 干声 / 混响 → 暂停门 → 主音量 → 压缩 → 限幅 → 软削波 → 输出
      this._dry.connect(this._duck);
      this._revSend.connect(this._convolver);
      this._convolver.connect(this._revHP);
      this._revHP.connect(this._revLP);
      this._revLP.connect(this._revReturn);
      this._revReturn.connect(this._duck);

      this._duck.connect(this._master);
      this._master.connect(this._comp);
      this._comp.connect(this._limiter);
      this._limiter.connect(this._clip);
      this._clip.connect(ctx.destination);
    }

    _setupAmbient() {
      var ctx = this._ctx;
      var self = this;
      var t0 = ctx.currentTime;
      var persist = this._persistent;

      this._noiseBuffer = this._makeNoiseBuffer(4.0);

      function startLoop(node) {
        try { node.start(t0); } catch (e) {}
        persist.push(node);
      }

      /* ---- 风 · 低频空气 ---- */
      var wind = ctx.createBufferSource();
      wind.buffer = this._noiseBuffer;
      wind.loop = true;

      var windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 290;
      windFilter.Q.value = 0.35;

      var windGain = ctx.createGain();
      windGain.gain.value = 0;

      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(this._dry);
      this._connectSend(windGain, 0.20);

      var windLfo = ctx.createOscillator();
      windLfo.type = 'sine';
      windLfo.frequency.value = 0.061;
      var windLfoDepth = ctx.createGain();
      windLfoDepth.gain.value = 0.016;
      windLfo.connect(windLfoDepth);
      windLfoDepth.connect(windGain.gain);

      var windFilterLfo = ctx.createOscillator();
      windFilterLfo.type = 'sine';
      windFilterLfo.frequency.value = 0.043;
      var windFilterDepth = ctx.createGain();
      windFilterDepth.gain.value = 120;
      windFilterLfo.connect(windFilterDepth);
      windFilterDepth.connect(windFilter.frequency);

      /* ---- 风 · 麦叶沙沙 ---- */
      var hiss = ctx.createBufferSource();
      hiss.buffer = this._noiseBuffer;
      hiss.loop = true;

      var hissFilter = ctx.createBiquadFilter();
      hissFilter.type = 'bandpass';
      hissFilter.frequency.value = 1500;
      hissFilter.Q.value = 0.55;

      var hissGain = ctx.createGain();
      hissGain.gain.value = 0;

      hiss.connect(hissFilter);
      hissFilter.connect(hissGain);
      hissGain.connect(this._dry);
      this._connectSend(hissGain, 0.28);

      var hissLfo = ctx.createOscillator();
      hissLfo.type = 'sine';
      hissLfo.frequency.value = 0.107;
      var hissLfoDepth = ctx.createGain();
      hissLfoDepth.gain.value = 0.006;
      hissLfo.connect(hissLfoDepth);
      hissLfoDepth.connect(hissGain.gain);

      var hissFilterLfo = ctx.createOscillator();
      hissFilterLfo.type = 'sine';
      hissFilterLfo.frequency.value = 0.071;
      var hissFilterDepth = ctx.createGain();
      hissFilterDepth.gain.value = 180;
      hissFilterLfo.connect(hissFilterDepth);
      hissFilterDepth.connect(hissFilter.frequency);

      /* ---- 暖 pad 和声（D add9，极低音量缓慢呼吸） ---- */
      var padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 1000;
      padFilter.Q.value = 0.5;
      this._padFilter = padFilter;

      var padMod = ctx.createGain();
      padMod.gain.value = 1;

      var padGain = ctx.createGain();
      padGain.gain.value = 0;

      var padColor = ctx.createGain();
      padColor.gain.value = 0;

      padFilter.connect(padMod);
      padMod.connect(padGain);
      padGain.connect(this._dry);
      this._connectSend(padGain, 0.42);
      padColor.connect(padFilter);

      var padLfo = ctx.createOscillator();
      padLfo.type = 'sine';
      padLfo.frequency.value = 0.033;
      var padLfoDepth = ctx.createGain();
      padLfoDepth.gain.value = 210;
      padLfo.connect(padLfoDepth);
      padLfoDepth.connect(padFilter.frequency);

      var padTrem = ctx.createOscillator();
      padTrem.type = 'sine';
      padTrem.frequency.value = 0.083;
      var padTremDepth = ctx.createGain();
      padTremDepth.gain.value = 0.10;
      padTrem.connect(padTremDepth);
      padTremDepth.connect(padMod.gain);

      var baseVoices = [
        { midi: 38, type: 'sine', level: 0.055, pan: -0.14 }, // D2
        { midi: 45, type: 'triangle', level: 0.030, pan: 0.22 }, // A2
        { midi: 54, type: 'triangle', level: 0.024, pan: -0.34 }, // F#3
        { midi: 50, type: 'sine', level: 0.028, pan: 0.30 } // D3
      ];
      var colorVoices = [
        { midi: 64, type: 'sine', level: 0.016, pan: 0.42 }, // E4（九音）
        { midi: 57, type: 'triangle', level: 0.016, pan: -0.40 }, // A3
        { midi: 69, type: 'triangle', level: 0.009, pan: -0.10 } // A4 泛音
      ];

      function addPadVoice(def, dest) {
        var osc = ctx.createOscillator();
        osc.type = def.type;
        osc.frequency.value = midiToFreq(def.midi);
        osc.detune.value = rand(-5, 5);

        var gain = ctx.createGain();
        gain.gain.value = def.level;
        osc.connect(gain);

        var panner = self._makePanner(def.pan);
        if (panner) {
          gain.connect(panner);
          panner.connect(dest);
          persist.push(panner);
        } else {
          gain.connect(dest);
        }
        try { osc.start(t0); } catch (e) {}
        persist.push(osc, gain);
      }

      var i;
      for (i = 0; i < baseVoices.length; i++) addPadVoice(baseVoices[i], padFilter);
      for (i = 0; i < colorVoices.length; i++) addPadVoice(colorVoices[i], padColor);

      /* ---- 启动常驻循环源 ---- */
      startLoop(wind);
      startLoop(hiss);
      startLoop(windLfo);
      startLoop(windFilterLfo);
      startLoop(hissLfo);
      startLoop(hissFilterLfo);
      startLoop(padLfo);
      startLoop(padTrem);

      this._windFilter = windFilter;
      this._windGain = windGain;
      this._hissFilter = hissFilter;
      this._hissGain = hissGain;
      this._padGain = padGain;
      this._padColor = padColor;
    }

    /** 常驻发送：接在总线混响发送上。 */
    _connectSend(node, amount) {
      if (!node || !this._revSend) return;
      var send = this._ctx.createGain();
      send.gain.value = clamp(amount, 0, 1);
      node.connect(send);
      send.connect(this._revSend);
      this._persistent.push(send);
    }

    _applyScene(fade) {
      if (!this._started) return;
      var cfg = this._sceneCfg || SCENE_CONFIG.menu;
      var t = this._now();
      var tau = Math.max(0.05, (Number(fade) || 0.85) * 0.42);

      // 场景自身的目标值（风势 / frenzy 由 _scheduleAmbient 叠加）
      this._rampParam(this._padGain.gain, cfg.pad * (1 - 0.10 * this._frenzy), t, tau);
      this._rampParam(this._padColor.gain, cfg.padColor * (1 + 0.9 * this._frenzy), t, tau);
      this._rampParam(this._padFilter.frequency, cfg.padCutoff + 120 * this._gust + 360 * this._frenzy, t, tau * 1.6);
      this._rampParam(this._windFilter.frequency, cfg.windCutoff + 180 * this._gust + 420 * this._frenzy, t, tau * 1.6);
      this._rampParam(this._hissFilter.frequency, cfg.hissFreq + 260 * this._gust + 520 * this._frenzy, t, tau * 1.6);
      this._rampParam(this._windGain.gain,
        cfg.wind * (0.70 + 0.55 * this._gust) * (1 + 0.9 * this._frenzy), t, tau);
      this._rampParam(this._hissGain.gain,
        cfg.hiss * (0.80 + 0.40 * this._gust) * (1 + 0.6 * this._frenzy), t, tau);
    }

    _scheduleAmbient(tau) {
      if (!this._started) return;
      var cfg = this._sceneCfg || SCENE_CONFIG.menu;
      var t = this._now();
      var gust = this._gust;
      var frenzy = this._frenzy;
      var timeConstant = Math.max(0.05, Number(tau) || 0.3);

      this._rampParam(this._windGain.gain,
        cfg.wind * (0.70 + 0.55 * gust) * (1 + 0.9 * frenzy), t, timeConstant);
      this._rampParam(this._hissGain.gain,
        cfg.hiss * (0.80 + 0.40 * gust) * (1 + 0.6 * frenzy), t, timeConstant);
      this._rampParam(this._padGain.gain, cfg.pad * (1 - 0.10 * frenzy), t, timeConstant * 2);
      this._rampParam(this._padColor.gain, cfg.padColor * (1 + 0.9 * frenzy), t, timeConstant * 2);
      this._rampParam(this._windFilter.frequency,
        cfg.windCutoff + 180 * gust + 420 * frenzy, t, timeConstant * 2);
      this._rampParam(this._hissFilter.frequency,
        cfg.hissFreq + 260 * gust + 520 * frenzy, t, timeConstant * 2);
      this._rampParam(this._padFilter.frequency,
        cfg.padCutoff + 120 * gust + 360 * frenzy, t, timeConstant * 2);
    }

    _rampParam(param, value, t, tau) {
      if (!param) return;
      try {
        param.cancelScheduledValues(t);
        param.setTargetAtTime(value, t, Math.max(0.01, tau || 0.2));
      } catch (e) { /* ignore */ }
    }

    _rampGain(param, value, duration) {
      if (!param) return;
      var t = this._now();
      try {
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
        param.linearRampToValueAtTime(value, t + Math.max(0.01, duration || 0.15));
      } catch (e) { /* ignore */ }
    }

    _rampDuck(duration) {
      if (!this._duck || this._offline) return;
      var target = (this._paused || this._hidden) ? 0 : 1;
      this._rampGain(this._duck.gain, target, duration);
    }

    /* ---------------------------- 合成积木 ---------------------------- */

    _makeIR(seconds) {
      var ctx = this._ctx;
      var rate = ctx.sampleRate;
      var len = Math.max(1, Math.floor(rate * seconds));
      var buffer = ctx.createBuffer(2, len, rate);
      var preDelay = Math.floor(rate * 0.02);

      for (var ch = 0; ch < 2; ch++) {
        var data = buffer.getChannelData(ch);
        var lp = 0;
        for (var i = 0; i < len; i++) {
          if (i < preDelay) { data[i] = 0; continue; }
          var t = (i - preDelay) / (len - preDelay);
          var white = Math.random() * 2 - 1;
          lp = lp * 0.58 + white * 0.42;
          var env = Math.pow(1 - t, 2.2) * Math.exp(-t * 1.15);
          data[i] = lp * env * 0.6;
        }
        var taps = ch === 0
          ? [0.011, 0.023, 0.037, 0.052, 0.071]
          : [0.014, 0.028, 0.043, 0.061, 0.083];
        for (var k = 0; k < taps.length; k++) {
          var idx = preDelay + Math.floor(rate * taps[k]);
          if (idx < len) data[idx] += (k % 2 ? -0.45 : 0.5) * (1 - k * 0.12);
        }
      }
      return buffer;
    }

    _makeNoiseBuffer(seconds) {
      var ctx = this._ctx;
      var rate = ctx.sampleRate;
      var len = Math.max(1, Math.floor(rate * seconds));
      var fade = Math.floor(rate * 0.25);
      var buffer = ctx.createBuffer(2, len, rate);

      for (var ch = 0; ch < 2; ch++) {
        var raw = new Float32Array(len + fade);
        var b0 = 0;
        var b1 = 0;
        var b2 = 0;
        for (var i = 0; i < len + fade; i++) {
          var white = Math.random() * 2 - 1;
          // Paul Kellet pink noise（更接近风声/空气声的频谱）
          b0 = 0.99765 * b0 + white * 0.0990460;
          b1 = 0.96300 * b1 + white * 0.2965164;
          b2 = 0.57000 * b2 + white * 1.0526913;
          raw[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
        }
        var data = buffer.getChannelData(ch);
        data.set(raw.subarray(0, len));
        // 首尾交叉淡化，循环无接缝
        for (var j = 0; j < fade; j++) {
          var a = j / fade;
          data[j] = raw[j] * a + raw[len + j] * (1 - a);
        }
      }
      return buffer;
    }

    _noiseSource(t, loop) {
      var ctx = this._ctx;
      var src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      src.loop = !!loop;
      var offset = Math.random() * Math.max(0, this._noiseBuffer.duration - 0.05);
      try {
        src.start(t, Math.max(0, offset));
      } catch (e) {
        try { src.start(t); } catch (e2) {}
      }
      return src;
    }

    _makePanner(pan) {
      var ctx = this._ctx;
      if (!ctx || typeof ctx.createStereoPanner !== 'function') return null;
      var panner = ctx.createStereoPanner();
      try { panner.pan.value = clamp(Number(pan) || 0, -1, 1); } catch (e) {}
      return panner;
    }

    _env(t, peak, attack, decay) {
      var gain = this._ctx.createGain();
      var level = Math.max(0.0002, Number(peak) || 0.0002);
      var atk = Math.max(0.002, Number(attack) || 0.003);
      var dec = Math.max(0.01, Number(decay) || 0.1);
      try {
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + atk);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
      } catch (e) {}
      return gain;
    }

    /** 把节点接到干声 + 可选混响发送；返回需要回收的节点。 */
    _routeVoice(node, opts) {
      var o = opts || {};
      var ctx = this._ctx;
      var made = [];
      var tail = node;
      var pan = Number(o.pan);
      if (isFinite(pan) && Math.abs(pan) > 0.004) {
        var panner = this._makePanner(pan);
        if (panner) {
          tail.connect(panner);
          tail = panner;
          made.push(panner);
        }
      }
      tail.connect(this._dry);
      var sendLevel = clamp(o.send == null ? 0.2 : Number(o.send), 0, 1);
      if (sendLevel > 0.001) {
        var send = ctx.createGain();
        send.gain.value = sendLevel;
        tail.connect(send);
        send.connect(this._revSend);
        made.push(send);
      }
      return made;
    }

    /** 统一收尾：停止音源，并在主音源结束后断开整条子图，避免节点堆积。 */
    _finish(sources, nodes, endTime) {
      var all = nodes ? nodes.slice() : [];
      var i;
      for (i = 0; i < sources.length; i++) {
        all.push(sources[i]);
        try { sources[i].stop(endTime); } catch (e) {}
      }
      var primary = sources[0];
      if (primary) {
        try {
          primary.onended = function () {
            for (var j = 0; j < all.length; j++) {
              try { all[j].disconnect(); } catch (e) {}
            }
            primary.onended = null;
          };
        } catch (e) {}
      }
    }

    _reserveCutVoice(t) {
      var times = this._voiceTimes;
      while (times.length && times[0] < t - 1) times.shift();
      if (times.length >= MAX_CUTS_PER_SECOND) return false;
      if (times.length >= MAX_STARTED_VOICES) return false;
      times.push(t);
      return true;
    }

    /* ---------------------------- 具体音色 ---------------------------- */

    _cutAt(t, opts) {
      if (!this._reserveCutVoice(t)) return;

      var ctx = this._ctx;
      var strength = clamp(Number(opts.strength == null ? 0.5 : opts.strength), 0.05, 1);
      var combo = Math.max(0, Math.floor(Number(opts.combo) || 0));
      var golden = !!opts.golden;
      var pan = clamp(Number(opts.pan) || 0, -1, 1);

      /* 1）短促 swish：带通噪声自高向低甩，像麦秆划过刀刃 */
      var swishDur = 0.10 + strength * 0.10;
      var swishSrc = this._noiseSource(t, true);
      var swishBp = ctx.createBiquadFilter();
      swishBp.type = 'bandpass';
      swishBp.Q.value = 0.9 + strength * 0.8;
      try {
        swishBp.frequency.setValueAtTime(clamp(1700 + strength * 1900, 400, 7000), t);
        swishBp.frequency.exponentialRampToValueAtTime(
          clamp(700 + strength * 520, 200, 5000), t + swishDur
        );
      } catch (e) {}
      var swishEnv = this._env(t, 0.055 + 0.09 * strength, 0.006, swishDur);
      swishSrc.connect(swishBp);
      swishBp.connect(swishEnv);
      var swishNodes = [swishBp, swishEnv].concat(
        this._routeVoice(swishEnv, { pan: pan, send: 0.16 })
      );
      this._finish([swishSrc], swishNodes, t + swishDur + 0.05);

      /* 2）轻拨弦：音高随 combo 沿 D 大调五声音阶上行 */
      var idx = Math.min(CUT_SCALE.length - 1, combo);
      var pluckLevel = (0.085 + 0.075 * strength) *
        (1 - 0.16 * idx / (CUT_SCALE.length - 1));
      this._pluck(t + 0.008, midiToFreq(CUT_SCALE[idx]), {
        level: pluckLevel,
        decay: 0.30 + strength * 0.18,
        pan: pan * 0.9,
        send: 0.26,
        brightness: 2600 + 900 * strength
      });

      /* 3）金色麦穗：FM 钟声 + 高音微光 */
      if (golden) this._goldenCut(t + 0.012, combo, pan);
    }

    _goldenCut(t, combo, pan) {
      var notes = [81, 83, 86]; // A5 B5 D6
      var freq = midiToFreq(notes[combo % notes.length]);
      this._fmBell(t, freq, {
        decay: 1.7, level: 0.11, ratio: 2.005, index: 1.9, send: 0.5,
        pan: pan * 0.8, shimmer: 1
      });
      this._fmBell(t + 0.025, midiToFreq(74), {
        decay: 1.3, level: 0.048, ratio: 3.01, index: 1.2, send: 0.55,
        pan: -pan * 0.6
      });
      this._shimmer(t + 0.04, 1.4, 0.012);
    }

    /**
     * 拨弦：三角波基音 + 正弦泛音 + 低通，快速起音与自然衰减。
     */
    _pluck(t, freq, opts) {
      var o = opts || {};
      var ctx = this._ctx;
      var decay = clamp(o.decay == null ? 0.7 : o.decay, 0.15, 3.2);
      var level = Math.max(0.0004, o.level == null ? 0.1 : o.level);
      var bright = clamp(o.brightness == null ? 2800 : o.brightness, 400, 8000);
      var pan = o.pan == null ? 0 : o.pan;
      var send = o.send == null ? 0.24 : o.send;

      var osc1 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.value = freq;
      osc1.detune.value = rand(-5, 5);

      var osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2.004;

      var osc2Gain = ctx.createGain();
      osc2Gain.gain.value = 0.18 + Math.random() * 0.1;

      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      try {
        filter.frequency.setValueAtTime(bright, t);
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(220, bright * 0.42), t + Math.max(0.2, decay * 0.75)
        );
      } catch (e) {}

      var env = ctx.createGain();
      try {
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(level, t + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      } catch (e) {}

      osc1.connect(filter);
      osc2.connect(osc2Gain);
      osc2Gain.connect(filter);
      filter.connect(env);

      var nodes = [osc2Gain, filter, env].concat(
        this._routeVoice(env, { pan: pan, send: send })
      );

      // 极轻的拨片触碰声，给拨弦一点实体感
      if (o.pick) {
        var pickSrc = this._noiseSource(t, true);
        var pickHp = ctx.createBiquadFilter();
        pickHp.type = 'highpass';
        pickHp.frequency.value = 2400;
        var pickEnv = this._env(t, Math.min(0.024, level * 0.26), 0.002, 0.03);
        pickSrc.connect(pickHp);
        pickHp.connect(pickEnv);
        var pickNodes = [pickHp, pickEnv].concat(
          this._routeVoice(pickEnv, { pan: pan, send: 0.08 })
        );
        this._finish([pickSrc], pickNodes, t + 0.06);
      }

      osc1.start(t);
      osc2.start(t);
      this._finish([osc1, osc2], nodes, t + decay + 0.08);
    }

    /**
     * FM 钟：载波正弦 + 指数衰减的调制指数，高频受低通柔化。
     */
    _fmBell(t, freq, opts) {
      var o = opts || {};
      var ctx = this._ctx;
      var decay = clamp(o.decay == null ? 1.4 : o.decay, 0.3, 4.5);
      var level = o.level == null ? 0.1 : o.level;
      var ratio = o.ratio == null ? 2.005 : o.ratio;
      var index = o.index == null ? 2.2 : o.index;
      var pan = o.pan == null ? rand(-0.12, 0.12) : o.pan;
      var send = o.send == null ? 0.4 : o.send;

      var carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = freq;

      var modulator = ctx.createOscillator();
      modulator.type = 'sine';
      modulator.frequency.value = freq * ratio;

      var modGain = ctx.createGain();
      try {
        modGain.gain.setValueAtTime(Math.max(0.5, freq * index), t);
        modGain.gain.exponentialRampToValueAtTime(
          Math.max(0.4, freq * 0.02), t + decay * 0.8
        );
      } catch (e) {}
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      var env = ctx.createGain();
      try {
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(Math.max(0.0005, level), t + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      } catch (e) {}

      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 6200;
      filter.Q.value = 0.4;

      carrier.connect(env);
      env.connect(filter);

      var sources = [carrier, modulator];
      var nodes = [modGain, env, filter].concat(
        this._routeVoice(filter, { pan: pan, send: send })
      );

      if (o.shimmer) {
        var shimmerAmt = o.shimmer === true ? 1 : Number(o.shimmer) || 1;
        var shimmerOsc = ctx.createOscillator();
        shimmerOsc.type = 'sine';
        shimmerOsc.frequency.value = freq * 2.001;
        // 包络必须与振荡器同刻开始：否则 GainNode 会在包络首个事件之前保持默认 1.0，
        // 产生 10ms 满幅爆点（曾把金色钟声峰值推到 0.87）。
        var shimmerEnv = this._env(t, level * 0.16 * shimmerAmt, 0.03, decay * 0.7);
        shimmerOsc.connect(shimmerEnv);
        var shimmerNodes = this._routeVoice(shimmerEnv, { pan: -pan * 1.2, send: 0.55 });
        nodes.push(shimmerEnv);
        nodes = nodes.concat(shimmerNodes);
        sources.push(shimmerOsc);
        shimmerOsc.start(t);
      }

      carrier.start(t);
      modulator.start(t);
      this._finish(sources, nodes, t + decay + 0.1);
    }

    /** 温和的持续和弦声部（结算用），慢起音长释放。 */
    _sustainVoice(t, freq, opts) {
      var o = opts || {};
      var ctx = this._ctx;
      var level = Math.max(0.0004, o.level == null ? 0.05 : o.level);
      var attack = Math.max(0.05, o.attack == null ? 0.4 : o.attack);
      var hold = Math.max(0.2, o.hold == null ? 3.5 : o.hold);

      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = rand(-6, 6);

      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2400;
      filter.Q.value = 0.4;

      var env = ctx.createGain();
      try {
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(level, t + attack);
        env.gain.setValueAtTime(level, t + attack + hold * 0.55);
        env.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold);
      } catch (e) {}

      osc.connect(filter);
      filter.connect(env);
      var nodes = [filter, env].concat(
        this._routeVoice(env, { pan: o.pan == null ? 0 : o.pan, send: o.send == null ? 0.5 : o.send })
      );
      osc.start(t);
      this._finish([osc], nodes, t + attack + hold + 0.1);
    }

    /** 低频冲击（丰饶 / 风暴的体感）。 */
    _thump(t, opts) {
      var o = opts || {};
      var ctx = this._ctx;
      var f0 = o.f0 == null ? 110 : o.f0;
      var f1 = o.f1 == null ? 36 : o.f1;
      var dur = o.dur == null ? 0.6 : o.dur;
      var level = o.level == null ? 0.22 : o.level;

      var osc = ctx.createOscillator();
      osc.type = 'sine';
      try {
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(15, f1), t + dur * 0.9);
      } catch (e) {}

      var env = ctx.createGain();
      try {
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(Math.max(0.0005, level), t + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      } catch (e) {}

      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 240;
      lp.Q.value = 0.4;

      osc.connect(env);
      env.connect(lp);
      var nodes = [env, lp].concat(this._routeVoice(lp, { pan: 0, send: 0.08 }));
      osc.start(t);
      this._finish([osc], nodes, t + dur + 0.05);

      // 低频噪声肉感层
      var noise = this._noiseSource(t, true);
      var nlp = ctx.createBiquadFilter();
      nlp.type = 'lowpass';
      nlp.frequency.value = 160;
      var nenv = this._env(t, Math.max(0.0005, level * 0.32), 0.004, dur * 0.55);
      noise.connect(nlp);
      nlp.connect(nenv);
      var nNodes = [nlp, nenv].concat(this._routeVoice(nenv, { pan: 0, send: 0.08 }));
      this._finish([noise], nNodes, t + dur * 0.6 + 0.05);
    }

    /** 风声/whoosh：带通扫频 + 左右横移。 */
    _whoosh(t, opts) {
      var o = opts || {};
      var ctx = this._ctx;
      var dur = clamp(o.dur == null ? 1.2 : o.dur, 0.2, 5);
      var f0 = clamp(o.f0 == null ? 400 : o.f0, 60, 8000);
      var f1 = clamp(o.f1 == null ? 2000 : o.f1, 60, 9000);
      var level = o.level == null ? 0.08 : o.level;
      var attack = clamp(o.attack == null ? 0.25 : o.attack, 0.01, dur * 0.8);
      var fromPan = clamp(o.fromPan == null ? -0.5 : o.fromPan, -1, 1);
      var toPan = clamp(o.toPan == null ? 0.5 : o.toPan, -1, 1);
      var q = o.q == null ? 0.8 : o.q;

      var src = this._noiseSource(t, true);
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      try {
        bp.frequency.setValueAtTime(f0, t);
        bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.55);
        bp.frequency.exponentialRampToValueAtTime(Math.max(80, f0 * 0.9), t + dur);
      } catch (e) {}

      var env = ctx.createGain();
      try {
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(Math.max(0.0005, level), t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      } catch (e) {}

      src.connect(bp);
      bp.connect(env);

      var nodes = [bp, env];
      var tail = env;
      var panner = this._makePanner(fromPan);
      if (panner) {
        try {
          panner.pan.setValueAtTime(fromPan, t);
          panner.pan.linearRampToValueAtTime(toPan, t + dur);
        } catch (e) {}
        tail.connect(panner);
        tail = panner;
        nodes.push(panner);
      }
      tail.connect(this._dry);
      this._finish([src], nodes, t + dur + 0.05);
    }

    /** 稀疏的环境拨弦：D 大调五声音阶，随机声像、轻微拨片声与混响。 */
    _ambientPluck(t) {
      var cfg = this._sceneCfg || SCENE_CONFIG.menu;
      var midi = pick(AMBIENT_PLUCKS);
      var level = rand(0.032, 0.05) * (cfg.pluckLevel == null ? 1 : cfg.pluckLevel);
      var pan = rand(-0.55, 0.55);

      this._pluck(t, midiToFreq(midi), {
        level: level,
        decay: rand(1.4, 2.4),
        pan: pan,
        send: 0.6,
        brightness: rand(1400, 2100),
        pick: 0.5
      });

      // 三成概率补一个五度/四度的轻应和，像远处另一根弦被风碰响
      if (Math.random() < 0.3) {
        this._pluck(t + rand(0.16, 0.3), midiToFreq(midi + (Math.random() < 0.5 ? 7 : 5)), {
          level: level * 0.6,
          decay: rand(1.2, 2.0),
          pan: -pan * 0.8,
          send: 0.6,
          brightness: rand(1500, 2200),
          pick: 0.3
        });
      }
    }

    /** 远处鸟鸣：两三声轻柔的滑音，混响里飘。 */
    _bird(t, pan) {
      var ctx = this._ctx;
      var base = rand(1650, 2500);
      var count = 2 + Math.floor(Math.random() * 3);
      var sources = [];
      var nodes = [];
      var last = t;

      for (var i = 0; i < count; i++) {
        var nt = t + i * rand(0.07, 0.13);
        var f = base * rand(0.92, 1.08);

        var osc = ctx.createOscillator();
        osc.type = 'sine';
        try {
          osc.frequency.setValueAtTime(f, nt);
          osc.frequency.exponentialRampToValueAtTime(f * rand(1.12, 1.35), nt + 0.035);
          osc.frequency.exponentialRampToValueAtTime(f * rand(0.88, 1.02), nt + 0.09);
        } catch (e) {}

        var env = this._env(nt, rand(0.010, 0.019), 0.008, rand(0.06, 0.1));
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3600;
        lp.Q.value = 0.4;

        osc.connect(env);
        env.connect(lp);
        var childNodes = this._routeVoice(lp, {
          pan: pan + rand(-0.12, 0.12),
          send: 0.45
        });
        nodes.push(env, lp);
        nodes = nodes.concat(childNodes);
        sources.push(osc);

        osc.start(nt);
        last = nt + 0.12;
      }
      this._finish(sources, nodes, last + 0.15);
    }

    /** 高音微光：两三个高频正弦，慢起音，大量混响。 */
    _shimmer(t, dur, level) {
      var ctx = this._ctx;
      var freqs = [midiToFreq(86), midiToFreq(93)]; // D6 / A6
      var sources = [];
      var nodes = [];
      var last = t + dur;
      for (var i = 0; i < freqs.length; i++) {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freqs[i];
        osc.detune.value = rand(-6, 6);
        var env = this._env(t + i * 0.03, Math.max(0.0004, level), 0.18, dur);
        osc.connect(env);
        var childNodes = this._routeVoice(env, {
          pan: i === 0 ? -0.45 : 0.45,
          send: 0.7
        });
        nodes.push(env);
        nodes = nodes.concat(childNodes);
        sources.push(osc);
        osc.start(t + i * 0.03);
      }
      this._finish(sources, nodes, last + 0.2);
    }

    /** 铃声琶音：一串 FM 钟，step 秒间隔。 */
    _bellArp(t, midis, step, opts) {
      var o = opts || {};
      for (var i = 0; i < midis.length; i++) {
        this._fmBell(t + i * step, midiToFreq(midis[i]), {
          decay: o.decay == null ? 1.5 : o.decay,
          level: (o.level == null ? 0.06 : o.level) * (1 - i * 0.05),
          send: o.send == null ? 0.5 : o.send,
          index: o.index == null ? 1.4 : o.index,
          ratio: o.ratio == null ? 2.005 : o.ratio,
          pan: (o.pan == null ? 0 : o.pan) + (i % 2 ? 0.16 : -0.16),
          shimmer: !!o.twinkle && i === midis.length - 1
        });
      }
    }
  }

  /* ============================== 导出 ============================== */

  global.HarvestAudio = HarvestAudio;
})(typeof window !== 'undefined' ? window : this);
