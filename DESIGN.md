# 《穗浪》 SUÌ LÀNG — 设计纲领

> 一场与黄昏的收割。Golden-hour wheat harvest, mouse as sickle.
> 交付目录：`F:\deepseekDSH\golden-harvest\`（双击 `index.html` 即可玩，无构建步骤、无外部资源）

## 1. 体验目标

玩家打开页面，3 秒内应产生「卧槽」的视觉反应；10 秒内理解玩法；30 秒后舍不得停。

- 视觉气质：中文海报式的克制排版 × 吉卜力黄昏田野 × 电影感光尘。不是赛博霓虹，不是常见紫渐变 SaaS 风。
- 手感：鼠标划过的轨迹就是镰刀。挥动有残影、有风声、麦秆有物理感地倒伏，连斩音高逐级爬升，金色麦穗爆出碎金。
- 情绪弧线：开场的辽阔 → 收割的爽快 → 连斩的亢奋 → 丰饶之刻的爆发 → 日落收工的温柔。

## 2. 技术约束（必须遵守）

- 纯静态：`index.html` + `css/style.css` + 若干 **经典 script**（非 ES module，双击 file:// 可运行）。
- 不加载任何外部字体、图片、音频、CDN；全部 Canvas 程序化绘制 + WebAudio 合成。
- 主循环 requestAnimationFrame；目标 60fps @ 1600×900 / DPR≤2；不卡顿、不爆内存。
- 支持鼠标 / 触屏（Pointer Events）；`Escape`/`P` 暂停；`M` 静音；尊重 `prefers-reduced-motion`。
- 响应式：1280–2560 宽、浏览器全屏；窄屏可玩（推荐横屏）。
- 文件分工（写入范围，禁止越界改别人的文件）：
  - Lead：`index.html`、`css/style.css`、`js/main.js`、README、集成与验收
  - 音效：`js/audio.js` + `qa/audio-smoke.html`
  - 麦田：`js/field.js` + `qa/field-preview.html`

## 3. 色彩与排版

### 黄昏调色盘（主场景，随游戏进度缓慢入暮）

| 用途 | 值 |
|---|---|
| 天顶 | `#5f7196` |
| 上层霞光 | `#a98a9c` |
| 中层霞光 | `#e2a37c` |
| 下层金橙 | `#f4bd7c` |
| 地平线 | `#f9dc9c` |
| 太阳核心 / 外晕 | `#fff6d4` / `#ffcf7a` |
| 远山（雾） | `#c08d78` → `#96755c` → `#6d5a3d` |
| 麦秆 | `#6f4b1e` `#8c6326` `#a8782e` `#c2923d` |
| 麦穗 | `#d8a74d` `#e7bb61` `#f3cf7d` `#ffe6a4` |
| 地面暗部 | `#4a2d12` `#6b461c` |
| 金色高光 / UI | `#f2c15c` / `#fff3d8` |
| 墨色文字 | `#241708` |
| 印章朱红（极少量） | `#c8472c` |

入暮变体（最后 20 秒插值）：天顶 `#323c5c`，霞光 `#7c667a` → `#c0776b` → `#e89a62`，地平线 `#f0b878`。

### 字体栈

```css
--font-display: "STKaiti", "KaiTi", "Kaiti SC", "Songti SC", "STSong", "SimSun", serif;
--font-serif: "Songti SC", "STSong", "SimSun", "Noto Serif SC", serif;
--font-sans: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", -apple-system, "Segoe UI", sans-serif;
--font-num: "Georgia", "Times New Roman", serif;
```

- 大标题：楷体/宋体，金色渐变 + 墨色投影，字距舒展。
- 拉丁小标签：全大写、0.32em letter-spacing、sans，10–12px。
- 数字：Georgia，老式数字，衬线，克制。
- 避免：圆角大卡片堆叠、玻璃拟态滥用、荧光色、emoji、大段说明文。

### 构图

- 地平线 `0.46h`；太阳 `(0.73w, 0.275h)`，半径 `0.072h`。
- 天空占上半，留白给标题；麦田从 `0.5h` 铺到画面底部并溢出。
- 远景：三层雾山、左 `0.17w` 一座小屋（暖窗 + 炊烟）+ 树影、偶有飞鸟。
- 中景：不可交互的细密麦田剪影带；近景：可交互麦田（主角）。
- 前景：左右下角超大、偏暗、轻模糊的麦穗剪影，形成画框（Lead 负责）。
- 后期：丁达尔光、暖色调、暗角、细颗粒、轻浮动尘埃、镜头光斑。

## 4. 玩法

- 90 秒一局。开始按钮进入，第一次挥镰才启动计时（给玩家从容感）。
- 鼠标/手指划过麦穗即割倒；速度阈值约 `0.3 CSS px/ms` 或按下指针拖动时无视阈值。
- 每株普通麦 +1 穗；金色麦穗（约 5.5%）+15 穗并额外充能。
- **连斩**：每次有效切割累积 combo，2.2 秒无切割清空。倍率 = 1 + floor(combo/8)×0.5，上限 ×4。
- **丰饶之刻**：收割累积能量（普通 +2.6，金色 +10），满 100 后可按 `Space` 或点击底部按钮释放：
  - 金色风浪从左向右扫过，割倒全场，慢动作 0.45s，屏幕轻震；
  - 之后 8 秒狂热：双倍收成、金色麦穗概率提升、麦田快速重生、风声与音乐提亮；
  - 能量条在 8 秒内排空。
- 结算：S/A/B/C 等级 + 收成 / 最高连斩 / 黄金穗 / 历史最佳。localStorage 键 `suilang.best`、`suilang.muted`。
- 不设死亡/失败，只有「日落收工」。温柔、可反复游玩。

### 连斩音阶（音频）与手感反馈（Lead）

- 每刀：细碎风声 + 轻拨弦；音高随 combo 在 D 大调五声音阶上行。
- 金色麦穗：FM 钟声。
- 丰饶触发：低频冲击 + 铃声上行 + 风声爆发。
- 屏幕：高频切割时暗角收紧、暖光增强；金色切割短促 hit-stop；大招横向光带 + 慢动作 + 金尘风暴。

## 5. 模块契约

### 5.1 `js/audio.js`（音效同事）

经典脚本，暴露 `window.HarvestAudio` 类（不要自动创建 AudioContext，必须等用户手势）。

```js
class HarvestAudio {
  constructor();                    // 只做字段初始化；不得在构造时创建/播放 AudioContext
  async start();                    // 首次用户手势调用；创建/恢复 AudioContext 与总线
  setMuted(m); get muted;           // 静音切换（立即生效；可持久化到 localStorage 键 suilang.muted）
  setScene(scene);                  // 'menu' | 'play' | 'end'，带淡入淡出
  gameStart(); gameEnd(rank);       // 开场钟声 / 收工和弦
  cut(opts);                        // {strength:0..1, combo:int, golden:bool, pan:-1..1}
  comboMilestone(level);            // 可选，连斩里程碑亮音
  frenzyReady();                    // 能量满时一声提示
  frenzyStart(); frenzyEnd();       // 大招开始/结束
  storm();                          // 金风扫场（可与 frenzyStart 区分）
  ui(kind);                         // 'hover' | 'click' | 'start' | 'back'
  pause(); resume();
  update(dt, state);                // state: {combo, frenzy:0..1, time}；驱动环境音
  dispose();
}
window.HarvestAudio = HarvestAudio;
```

要求：WebAudio 不可用时全部方法安全降级；总线压缩/限幅防爆音；单帧同秒最多 ~10 个切割声部；环境风声、偶尔鸟鸣、暖色 pad、稀疏五声拨弦；所有声音由代码合成。默认音量克制、耐听，不刺耳。

### 5.2 `js/field.js`（麦田同事）

经典脚本，暴露 `window.WheatField` 类。无内部 RAF、无定时器，由主循环驱动。

```js
class WheatField {
  constructor();
  resize(width, height);          // CSS px；内部 u = height / 900；按比例重排已有麦株
  reset(seed);                    // 清空并按当前尺寸种满
  update(dt, time, env);          // env: {
                                  //   wind:-1..1, gust:0..1,
                                  //   pointer:{x,y,active},
                                  //   frenzy:bool, reduced:bool }
  cut(x0, y0, x1, y1, speed, force); // 鼠标线段；只在速度达标或 force 时割；命中结果推入 outbox
  drainEvents();                  // 返回并清空本帧切割事件数组
  stormCut();                     // 金风：约 1.1s 内从左到右扫过，逐株割倒并通过 drainEvents 抛出
  draw(ctx, opts);                // opts: {time, frenzy:0..1}；ctx 已含 DPR/CSS 像素变换
  getStats();                     // {uncut, total, golden}
  setGoldenBoost(mult);           // 新麦株金色概率倍率（默认 1）
}
window.WheatField = WheatField;
```

事件对象：`{x, y, golden, scale, angle}`，`x,y` 为麦穗端点 CSS 像素坐标，供主程序计分/粒子/音效使用。

麦田视觉硬指标：
- 1600×900 下目标约 300 株，按宽度自适应（`clamp(round(w/5.2), 200, 430)`），覆盖地平线以下整个可交互区域；
- 三档景深：远排（小、雾、密）、中排、近排（大、细节多、可能超出画面底部）；
- 每株：微弯茎（带高光描边）、1–2 片叶、带芒的麦穗（6 种预渲染变体，含金色变体）、轻微独立摆动；
- 风吹成浪：摆幅随 x 相位差 + gust 推动；指针靠近有「拂动」反应；
- 割倒：绕根部倒伏、轻微弹跳、随后淡出；留短茬，3–6 秒后原位重生（frenzy 时 0.9–2 秒），重生有生长动画与微光；
- 金色麦穗：暖金发光（预渲染径向光晕 + `lighter`），有脉动和星点，约 5.5% 概率；
- 切割半径约 `26 + 14*scale` CSS px，允许一划多杀；不得把已经割倒的重复计入；
- 不许逐帧 `ctx.filter`、`shadowBlur`（预渲染除外）；每帧尽可能复用渐变/精灵；不得造成 GC 抖动；
- 画面密度和细节要经得起 1600×900 截图审视，不能看起来像稀疏的「火柴人」。

同时产出 `qa/field-preview.html`：暖色渐变背景 + 麦田 + 鼠标切割 + 实时 FPS/株数，独立可跑，供截图验收。

### 5.3 `js/main.js`（Lead）

场景、输入、HUD、状态机、粒子、光影、后处理、音画调度、移动端适配、存档、测试钩子。

## 6. 视觉红线

- 禁止：蓝紫渐变、emoji、无意义圆角玻璃卡、默认浏览器字体的大段英文、克隆式 dashboard 排版、素材库感。
- 必须有：真实的空间层次（空气透视）、可信的暖光方向、有呼吸的麦浪、细腻但不喧宾夺主的 Grain、能让人截图分享的标题界面与结算界面。
- 所有按钮/文字中文优先；拉丁文只作小号装饰标签。
- 音画同步：切割必须即时反馈（同帧粒子 + 音效），不允许延迟感。

## 7. 验收清单

1. `file:///F:/deepseekDSH/golden-harvest/index.html` 双击可运行，控制台无报错。
2. 菜单 → 开始 → 切割 → 连斩 → 丰饶 → 暂停 → 结算 → 重开 全流程可用。
3. 1600×900 与 2560×1440 截图：构图、字体、麦田密度、HUD 均成立。
4. Chrome Performance 估算 ≥55fps；无内存持续增长。
5. 音频在用户手势后启动，静音可用，切场景不爆音。
6. 键盘、触屏、暂停、重开、最佳分持久化均通过。
