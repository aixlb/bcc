# bcc 发布流程

`aixlb/bcc` 是桌面版、CLI、共用核心和 Agent skill 的唯一源码仓库，采用 MIT 协议。桌面包发布到本仓库 Releases，CLI 发布到 npm `@aixlb/bcc`，skill 随本仓库源码与 tag 分发。DSH 插件由 [aixlb/dsh-bcc](https://github.com/aixlb/dsh-bcc) 独立发布。

## 1. 更新版本与检查

同步根 `package.json`、`package-lock.json` 及各 workspace 的版本，更新 `CHANGELOG.md`。迁移后的首版为 `0.4.0`。

```bash
npm ci
npm run check
node out/cli/index.mjs --version
node skills/bcc/bin/bcc.cjs --version
```

`check` 执行类型检查、测试、桌面构建、CLI 构建与 skill 构建。检查 `skills/bcc/bin/bcc.cjs` 的变更，将它和源码一起提交。`publish:skill` 仅是 `build:skill` 的本地兼容入口，不再创建提交或向其他仓库推送。

## 2. 打包与验证桌面版

Windows 在 Windows 上构建：

```bash
npm run dist:win
npm run smoke:win-release
```

macOS 在 Mac 上构建：

```bash
npm run dist:mac
```

`dist:mac` 构建后运行现有 DMG 包内启动检查。有签名 / 公证凭据时，按本机证书配置签名；需要钥匙串 profile 时在终端设置 `APPLE_KEYCHAIN_PROFILE`。最终 DMG 的公证与装订在 Mac 上执行，例如：

```bash
xcrun notarytool submit "release/XLB Storyboard-0.4.0-arm64.dmg" --keychain-profile xlb-notary --wait
xcrun stapler staple "release/XLB Storyboard-0.4.0-arm64.dmg"
```

对实际发布的每个架构分别验证，x64 包文件名以 `release/` 中产物为准。桌面应用名和应用标识仍为 `XLB Storyboard` / `com.xlbstoryboard.app`，避免更改已有用户数据路径。

没有目标平台机器时，可手动运行 `.github/workflows/build-windows.yml` 或 `build-mac.yml`。工作流使用 `npm ci`，构建指定分支 / tag，验证后提供 artifact。macOS 手动工作流构建 runner 原生架构的 zip；完整双架构 DMG 发布使用本地 `dist:mac`。

## 3. 提交源码与版本 tag

确认检查结果后，将源码、文档与重建后的 skill 运行时提交。新版本从对应源码提交创建 tag；保留原有桌面 Releases 和旧 tag，不移动、不重建历史 tag。

```bash
git push origin HEAD
git tag v0.4.0
git push origin v0.4.0
```

发布其他版本时替换示例版本号。用 `npx skills add aixlb/bcc --skill bcc` 安装主分支最新 skill，或在 skills 安装工具中指定所需版本引用。

## 4. 发布 npm CLI

```bash
npm run build:publish
cd cli-dist
npm publish
cd ..
```

`cli-dist/.npmrc` 使用 npm 官方源并声明公开包。发布需要 npm 登录，按账号要求完成 2FA。相同 npm 版本不能重复发布。

```bash
npm view @aixlb/bcc version --prefer-online
```

## 5. 上传桌面 Release

确认本地 `gh` 已登录、有当前仓库写权限，`release/` 中有当前版本产物：

```bash
gh auth status
npm run publish:app -- --dry-run
npm run publish:app
```

`publish:app` 上传到 `aixlb/bcc` 的 `v<version>` Release，不存在时创建 Release。默认上传免安装 exe、macOS dmg / zip，排除 Setup 安装版和 `.blockmap`。先推送对应源码 tag，确保 Release 指向已验证的源码。

手动平台工作流也可填写已有 Release tag，直接用当前仓库的 `GITHUB_TOKEN` 上传经过验证的包；无须配置跨仓库 PAT 或 `RELEASE_TOKEN`。上传前应确认指定 tag 已存在，且工作流构建的源码与 tag 一致。

## 发布结果核对

- npm `@aixlb/bcc` 版本及 `bcc --version` 与新版本一致。
- `npx skills add aixlb/bcc --skill bcc` 能安装，skill 中的自包含运行时能启动。
- 本仓库 Release 中有已验证的平台包，原历史 Releases 仍可访问。
- 源码 tag、CLI、skill 与桌面包版本对应。
