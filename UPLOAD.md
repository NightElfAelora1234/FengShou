# 上传到 GitHub（照这个做）

## 先搞清楚：上传什么

上传 **这个文件夹里的内容**：

```text
golden-harvest-v6-upload/
├── index.html
├── assets/
├── css/
├── js/
├── docs/
├── screenshots/
├── CHARACTER.md
├── LICENSE

├── README.md
├── UPLOAD.md
├── RICE-MAP-SPEC.md
├── DESIGN.md
├── serve.mjs
├── .gitignore
└── .nojekyll
```

不要上传：

- `golden-harvest-v5-backup`（里面有旧的官方素材）；
- `qa/`（开发自检页，不在这个上传包里）；
- 整个父文件夹 `F:\deepseekDSH`。

## 方法一：GitHub 网页上传

1. 新建一个 **Public** 仓库，例如 `suilang`；
2. 进入仓库，点 **Add file → Upload files**；
3. 打开 `F:\deepseekDSH\golden-harvest-v6-upload`，把里面**所有文件和文件夹**拖进上传框；
4. 点 **Commit changes**；
5. 进入 **Settings → Pages**；
6. Source 选 **Deploy from a branch**，Branch 选 `main`，目录选 `/(root)`，Save；
7. 等 1–2 分钟，得到：

```text
https://你的用户名.github.io/suilang/
```

这个网址就是别人点开就能玩的地址。

## 方法二：GitHub Desktop（推荐，文件多时更稳）

1. GitHub Desktop → **Add local repository**；
2. 选择 `F:\deepseekDSH\golden-harvest-v6-upload`；
3. 如果提示 not a Git repository，点 **create a repository**；
4. Commit；
5. **Publish repository**，选择 Public；
6. 再去 GitHub 仓库 Settings → Pages 开 Pages。

## 关于 zip

`F:\deepseekDSH\suilang-v6-upload.zip` 只是打包备份/传输用。

**GitHub Pages 不会自动解压 zip。**  
如果上传了 zip，网页只会下载它，不会变成游戏。要上线，请上传解压后的**文件夹内容**。

## 上线后检查

- 打开 `https://你的用户名.github.io/suilang/`；
- 点开始，能进麦田；
- 进农具小铺，底部/顶部能换老板娘；
- 打开 `docs/boss-pack-kit.zip` 能下载；
- 单人收工能看到 S/A/B/C/D 和老板娘评语。

## 不要上传

- `assets/shu.png`、`QUOTES.md`；
- 任何官方立绘、官方台词、官方截图；
- v5 备份目录；
- 任何 `.apk` / `.exe`（先不要混进 Pages 仓库，之后用 Releases）。
