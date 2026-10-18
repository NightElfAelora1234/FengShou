# 《穗浪 v3》水稻地图 · 模块规格

> 目标：不做「麦田换绿色」的敷衍换皮，而是一张能独立成立的 **江南稻作黄昏** 地图。  
> 与麦田地图共用同一套 60 秒收割、丰饶、农具、丰收印记、历史记录。

## 世界观与画面方向

- 地图名：**稻田 · 稻浪**（菜单名 `稻田`，history 中 map=`rice`）。
- 时间与空气：**雨后薄暮 / 水汽未散的黄昏**。天光从青玉色过渡到杏金色；低日、长雾、水田像镜面。
- 与麦田的区别：麦田是干燥、金色、风尘；稻田是潮湿、青绿、水光。不要照搬金色麦浪。
- 关键意象：镜面水田、弯曲的田埂（田塍）、远山（桂林式喀斯特峰丛）、白鹭、蜻蜓、浮萍/稻叶、水光里的落日拉长倒影。
- 情绪：安静、丰润、水汽发亮；仍然可以很爽地割稻。

调色盘（建议）：
- 天顶 `#3d6270` → 高中 `#78a09b` → 低霞 `#d7c49a` → 地平线 `#f2d8a0`
- 水田反光 `#d8c79a` / `#9ab7a4` / `#6f9285`
- 远处峰丛 `#557a78` → `#315652` → 近处 `#223c34`
- 稻叶 `#3f5e2f` / `#6e8b44` / `#a9bd6f`；稻穗 `#b9c478` / `#d8d79a` / `#f4e8b4`；金色稻 `#ffdf8c`
- 田水 `#b9c9b0` / `#7e9d90` / 反射暖金 `#e8cf9c`

## 主程序接口（必须严格实现）

### `js/rice-field.js` — `window.RiceField`

经典 script（非 ES Module），无内部 RAF / 定时器，由主循环驱动。坐标单位 CSS px；主程序会给 ctx 加好 DPR 变换。

```js
class RiceField {
  constructor();
  resize(width, height);
  reset(seed?);
  update(dt, time, env);                  // env: {wind:-1..1,gust:0..1,pointer:{x,y,active},frenzy:bool,reduced:bool}
  cut(x0,y0,x1,y1,speed,force);           // 线段切割；结果推入内部 outbox
  drainEvents();                          // 返回并清空事件数组
  stormCut();                             // 金风扫场：约 1.1 秒从左至右割倒所有水稻
  draw(ctx, opts);                        // opts:{time, frenzy:0..1}
  getStats();                             // {uncut,total,golden}
  setGoldenBoost(mult);
  setCutRange(mult);                      // 主程序会传 1 / 1.5 / 2
}
window.RiceField = RiceField;
```

事件对象：`{x, y, golden:boolean, scale:number, angle:number}`，x/y 为被割水稻的穗部位置（CSS px），供主程序计分/粒子/音效。

硬性要求：
- 1600×900 目标 **674 株水稻**；按宽度自适应：`round(clamp(width/2.375, 440, 920))`（与麦田相同密度）。
- 三档景深；每株为水中一丛水稻（可以用预渲染整丛精灵，以降低绘制开销）：弯曲茎、长披叶、**下垂稻穗**（区别于直立带芒麦穗）、浅水接触阴影。
- 风来时成浪；指针靠近有拂动；割倒绕根部倾倒、留短茬、3–6 秒原位重生（frenzy 0.9–2 秒），重生有生长动画。
- 金色水稻约 5.5%，有暖金呼吸光晕/星点；`setGoldenBoost` 影响新株概率。
- 切割半径与麦田相同：`(26 + 14*scale) * (this._cutRange||1) * (golden ? 1.35 : 1)`；速度阈值 `0.3 CSS px/ms` 或 `force`；一划多杀；同一株不重复计。
- `stormCut()` 1.1 秒扫描，逐帧通过 `drainEvents()` 抛出事件；事件数量应等于当时未割株数。
- 性能：默认路径优先预渲染整丛水稻精灵；60fps @1600×900（headful GPU 上 draw 建议 < 12ms）。可保留 `fastMode` 属性但非必需。
- 不画天空/远山/大片水面/UI；这些由 RiceScene 与主程序负责。水面的接触阴影、稻丛本体由本模块绘制。

建议实现方式：
- 预生成 6 个 clump 变体 × 3 档 haze × 金色变体；每个精灵约 160×300 逻辑 px，底部中心为根。
- 每株画 1 次 drawImage + 1 次旋转/缩放；近景大株可额外画 1–2 片叶子/阴影。
- 割倒/重生/倒影若增加 draw，注意性能；倒影可只给近景少量株。

### `js/rice-scene.js` — `window.RiceScene`

经典 script，无需外部图片/字体/网络。接口：

```js
class RiceScene {
  constructor();
  resize(w,h,dpr);
  update(dt,time,env);
  drawBack(ctx,env);   // 画在交互稻田之后面
  drawFront(ctx,env);  // 画在交互稻田之前面
}
```

主程序会按以下顺序调用：`scene.drawBack` → `field.draw`（水稻）→ 粒子 → `scene.drawFront` → 暴风/UI。
`env`：`{progress:0..1, wind:-1..1, gust:0..1, frenzy:0..1, pointer:{x,y}, reduced:bool}`；progress=0 开局、1 日落。主程序另有暖色/水稻色分级覆盖，但场景自身的色彩必须成立。

必须包含：
- **天空**：青玉→杏金的渐变、低日/日晕、薄云、飞鸟；为了稻田地平线，雾更重。
- **远山**：2–3 层喀斯特峰丛（不是平滑丘陵），有空气透视与水面倒影。
- **水田**：地平线以下 2–3 级弯曲田塍/水田；水面反射天空、太阳光柱/碎金、轻微波纹；不能只是一个平涂绿色。
- **远景稻田**：带一点细密稻穗/秧苗剪影，与主交互稻田衔接。
- **前景**：少量虚化稻叶/稻穗在画面左右下角，形成画框（不要挡住主要操作区）。
- **活物/细节**：白鹭 2–3 只、蜻蜓 6–10 只、浮萍/水黾/水光尘埃、偶发涟漪；日落时更安静。
- **光**：低日暖光、雾中丁达尔光、镜头轻光斑；frenzy 时水面反光增强（env.frenzy）。
- 目标 60fps @1600×900；避免逐帧 filter/shadowBlur（预渲染允许）。
- 不画交互稻田本体与 UI；不拦截指针；画布透明。

建议：
- 天空/远山/田塍/水面可分两层预渲染（日/暮），水面动态高光用低成本 stroke/drawImage。
- 前景稻叶用一次性预渲染的深色模糊精灵；不要用逐帧 filter。

## 视觉验收

- 1600×900 截图必须一眼看出是 **水田稻作**，不是换色的麦田。
- 水面有反射与波纹，峰丛/雾/白鹭/蜻蜓细节可见。
- 交互稻田的稻穗下垂、稻叶长、绿色层次好，金色水稻有存在感。
- 与主程序组合后，HUD/农具/丰饶/收割手感保持原样。

## 写入范围

- 稻田同事 A（RiceField）：`golden-harvest-v3/js/rice-field.js`、`golden-harvest-v3/qa/rice-field-preview.html`、`golden-harvest-v3/qa/` 下自己的截图/日志。
- 场景同事 B（RiceScene）：`golden-harvest-v3/js/rice-scene.js`、`golden-harvest-v3/qa/rice-scene-preview.html`、`golden-harvest-v3/qa/` 下自己的截图/日志。
- 禁止改 index.html / css / main.js / field.js / scene.js / audio.js / shop 相关文件。
- 两个预览页都不得依赖对方文件（各自可跑），以便独立验收；组合验收由 Lead 完成。
