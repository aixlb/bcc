# Mac App Store 上架手册（XLB Storyboard / 包拆拆）

本文档记录把本应用上架 **Mac App Store（MAS）** 所需的全部步骤、已经准备好的工程文件，以及**必须由你本人完成**的账号/审核环节。

> 仓库已迁移到公开 MIT 项目 `aixlb/bcc`。桌面应用仍使用 `XLB Storyboard` / `com.xlbstoryboard.app`，保留用户数据兼容；当前发布入口见 [RELEASE.md](RELEASE.md)。本文中的 MAS 账号与审核事项独立于本次仓库迁移。

> 结论先行：上架 = ①工程准备（仓库内，已基本就绪）+ ②**必须的代码改造**（沙盒兼容，未完成，需决策）+ ③**你的付费账号与证书** + ④**Apple 审核**（数天）。其中 ③④ 任何人/工具都无法代替你完成。

---

## 0. 仓库内已准备好的文件

| 文件 | 作用 |
|------|------|
| `build/icon.icns` | macOS 应用图标（16~1024 全尺寸） |
| `build/entitlements.mas.plist` | MAS 主程序沙盒权限（app-sandbox / 网络 / 用户选择文件读写） |
| `build/entitlements.mas.inherit.plist` | 子进程（Electron Helper、ffmpeg）继承沙盒 |
| `build/entitlements.mac.plist` | （备选方案）Developer ID 公证分发用 Hardened Runtime 权限 |
| `package.json` → `build.mas` | electron-builder 的 MAS 目标配置（含出口合规 `ITSAppUsesNonExemptEncryption=false`） |
| `package.json` → `scripts.dist:mas` | `npm run dist:mas` 一键打 MAS 包 |
| `docs/appstore/metadata.md` | App Store Connect 全部文案/分类/关键词，中英双语，可直接粘贴 |
| `docs/appstore/PRIVACY_POLICY.md` | 隐私政策（中英），部署成网页后填 Privacy Policy URL |

> 应用定位：**包拆拆 / XLB Storyboard**，**免费、无内购、无广告**。
> 免费 App **无需**填写税务与银行信息，只需签署免费版《Apple Developer Program License Agreement》。

---

## 1. 沙盒兼容代码改造 —— ✅ 已实现

Mac App Store **强制 App Sandbox**。原代码有两处会在沙盒下失效，现已改造完成（均**仅在 MAS 沙盒构建下生效**，Windows / 公证 DMG / 开发构建行为完全不变）：

### 1.1 数据存储位置 ✅
- `apps/bcc-desktop/src/main/electron-paths.ts`：数据根解析在 **macOS 打包**时写入 `app.getPath('userData')/data`（MAS 下位于 `~/Library/Containers/com.xlbstoryboard.app/Data/...`）；Windows 保留原有位置；开发仍是项目根/data。结果注入 `packages/bcc-core/src/runtime.ts`。
- `storyboard-storage` / `project-storage` / `distillation-storage` / `config.ts` 都经由 `getDataRoot()`，自动跟随。

### 1.2 ffmpeg 读取用户视频 ✅
- `packages/bcc-core/src/services/media-import.ts` 的 `importMediaToContainer()`：检测到沙盒（`process.mas === true`）时，导入瞬间把源视频**拷贝进容器**对应目录，并把存档的 `videoPath` 指向容器副本；非沙盒构建原样返回外部路径。
- 接入点：`createProject`（拷到项目目录）、`createDistillation` / `addVideosToDistillation`（拷到研究项目 `videos/`）。此后所有 ffmpeg 处理、视频预览、跨会话重读都走容器副本，规避“子进程无权访问容器外文件”。

> ⚠️ **验证边界**：App Sandbox 只在**正式 MAS 签名构建**里强制生效；开发态（electron-vite）不开沙盒。因此上述改造在开发态恒为“原路径”分支，真正的沙盒行为需用你的证书产出签名 MAS 包后实测确认（见第 3 节）。
>
> 副作用提示：沙盒下每个项目会在容器内保存一份源视频副本，磁盘占用约翻倍，导入大视频时多一次拷贝耗时——这是 MAS 沙盒下让 ffmpeg 可访问文件的必要代价。

---

## 2. 你必须在 Apple 侧完成的前置（无法代办）

1. **加入 Apple Developer Program**（个人或公司，**$99/年**）。公司账号需 D-U-N-S 编号。
2. 在 [Apple Developer](https://developer.apple.com/account) → Certificates 创建两张证书并装入钥匙串：
   - **Apple Distribution**（或 *3rd Party Mac Developer Application*）
   - **Mac Installer Distribution**（*3rd Party Mac Developer Installer*）
3. 注册 **App ID**：Bundle ID = `com.xlbstoryboard.app`（与 `package.json` 的 `appId` 一致）。
4. 在 [App Store Connect](https://appstoreconnect.apple.com) 创建 App 记录，并下载 **Mac App Store 类型**的描述文件，保存为：
   ```
   build/embedded.provisionprofile
   ```
5. 记下你的 **Team ID**（开发者账号右上角，10 位）。
   - 注：MAS 签名时身份由钥匙串证书自动带出，**Team ID 并非 `dist:mas` 必填**；它主要用于备选的公证 DMG 路线（`notarize.teamId`）。

---

## 3. 构建 MAS 包

完成第 1、2 节后：

```bash
# 证书已在钥匙串中，描述文件已放到 build/embedded.provisionprofile
npm run dist:mas
```

产物：`release/mas/XLB Storyboard-<版本>.pkg`（这是上传 App Store 用的安装包，**不能**双击安装，只能通过下面工具上传）。

如签名报错，确认钥匙串里有上面两张证书，且 `security find-identity -v` 能看到它们。

---

## 4. 上传与提交审核（你操作）

1. 上传 `.pkg`（任选其一）：
   - **Transporter**（Mac App Store 免费下载，拖入 `.pkg` 即可），或
   - 命令行：`xcrun altool --upload-app -f release/mas/*.pkg -t macos -u <AppleID> -p <App专用密码>`
2. 在 App Store Connect 该 App 下填写并提交（**文案全部已备好，见 `docs/appstore/metadata.md`，直接粘贴**）：
   - 名称、副标题、宣传文本、描述、关键词、分类（视频）→ 复制 `metadata.md`
   - **隐私政策 URL** → 把 `docs/appstore/PRIVACY_POLICY.md` 部署成网页后填入
   - App 隐私问卷 → 按 `metadata.md` 第四节答「不收集数据」
   - 价格 = **Free**、销售范围 = 所有地区、年龄分级 = **4+**
   - 出口合规 → 已内置 `ITSAppUsesNonExemptEncryption=false`，无需手动回答
   - 签署免费版《Apple Developer Program License Agreement》（免费 App 无需税务/银行）
   - **截图**（唯一需你手动产出的素材，按 Apple 尺寸截 3~5 张，见 `metadata.md` 第六节）
3. 选中刚上传的构建版本 → **提交审核**。
4. 等待 **Apple 审核**（通常 1~3 个工作日，可能被拒需整改）。

---

## 5. 审核风险提示（与本应用强相关）

- **打包外部二进制（ffmpeg/ffprobe）**：MAS 允许，但必须随主程序一起正确签名并继承沙盒（`entitlements.mas.inherit.plist` 已覆盖）。仍可能被审核问询用途。
- **自带 API Key / 第三方 AI**：需在隐私问卷与描述中如实说明；不得在 App 内引导用户去外部购买/充值（IAP 政策）。
- **沙盒文件访问**：若第 1.2 节未妥善处理，审核或真机会出现“无法读取视频”。

---

## 6. 备选：不进商店，走 Developer ID 公证分发（更简单）

如果只是想让用户在 macOS 上**双击就能装、不被 Gatekeeper 拦**，但不一定进商店，可走 **Developer ID + 公证（notarization）** 路线：

- 仍需 $99/年账号，但**不需要沙盒**，ffmpeg 路线无需改造。
- 用 `build/entitlements.mac.plist`（已备好），给 `package.json` 的 `mac` 块加：
  ```jsonc
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "notarize": { "teamId": "<你的TeamID>" }
  ```
- 设置环境变量 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` 后 `npm run dist:mac`，electron-builder 会自动签名+公证产出可分发 DMG。
- 这条路**不算“App Store 上架”**，但对带 ffmpeg 的工具类应用是业界常见做法，落地最快。
