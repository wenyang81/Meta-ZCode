# 融智坊桌面端 · 三平台打包步骤

> 适用范围：Windows / macOS / Linux 安装包在**本 fork** 里怎么打出来、打出来叫什么名字、
> 失败会长什么样、以及哪些环节这个 fork 根本没有能力做。
> 日常本地运行请看 [本地测试运行步骤](fusionfinlab-local-run.md)。

## 0. 一句话现实（先读这段，否则会按上游流程空跑）

上游发版链路依赖 GitLab CI 与一批仓库外脚本，而**它们不在这个 fork 的代码树里**。经
`git ls-files` 与文件系统双重确认，下列文件在 HEAD 树中不存在、也没有被 `.gitignore` 排除：

| 缺失项 | 上游文档 | 对这个 fork 的后果 |
| --- | --- | --- |
| `.gitlab-ci.yml`、`.gitlab/ci/*.yml` | [docs/desktop-ci-cd.md](desktop-ci-cd.md) | 没有 tag 流水线、没有 `approve → validate → upload → preload → publish`，打包只能在目标机上手工执行 |
| `scripts/notarize-macos.sh` | 同上「关键脚本」 | 没有公证自动化，DMG 只能停在未公证状态 |
| `scripts/upload-oss.sh`（缺失）与 `scripts/cdn-preload.sh` 的调用入口 | 同上 | `cdn-preload.sh` 这个脚本本身在仓库里，但没有任何 CI 定义或 release 脚本调它；产物上传与预热要自己接 |
| `scripts/publish-release.sh`、`scripts/reset-release-rollout.sh` | 同上 | 无法调用后端 release / 灰度接口，**装了包也不会有更新清单发布** |
| `scripts/ci-collect-artifacts.mjs`、`scripts/package-cua-helper-release.mjs` | 同上 | 没有共享产物目录归集，CUA Helper 独立签名/公证链路不存在 |
| `scripts/sign-windows.ps1` | [packages/desktop/scripts/sign-windows-hook.cjs:4](../packages/desktop/scripts/sign-windows-hook.cjs#L4) | ⚠️ 打包器**引用了这个不存在的脚本**：一旦 `ZCODE_ENABLE_WINDOWS_SIGN=1`，签名调用会直接失败。默认关闭，所以普通打包不受影响 |
| `config/private/build-defaults.json` | [scripts/build-time-config.mjs:6-12](../scripts/build-time-config.mjs#L6-L12) | 构建期可选能力没有内部默认值兜底，见 §6 |

所以这个 fork 目前的交付形态是：**本地手工出包 + 未签名（macOS）/ 未签名（Windows）+ 自行分发**。
[docs/adr/0004-release-packaging-platform-contract.md](adr/0004-release-packaging-platform-contract.md)
把「打包平台作为 Release Candidate 唯一状态源」定成目标契约，状态仍是 Proposed，尚未实现。

## 1. 打包链路（三层，顺序固定）

唯一入口是根脚本 `pnpm bundle:desktop`（[package.json:53](../package.json#L53)），它转到
[packages/desktop/scripts/bundle.mjs](../packages/desktop/scripts/bundle.mjs)：

```text
pnpm bundle:desktop -- --os win --arch x64
   ├─ 1. pnpm prepare:runtime-assets        原生 sidecar / agent bundle（按目标平台）
   ├─ 2. pnpm build                         out/ 清理 → tsup + vite 并行（NODE_ENV=production）
   ├─ 3. electron-builder --config electron-builder.config.js --win --x64   （带下载重试）
   ├─ 4. stampMacosUpdateManifests          macOS 更新清单落盘
   ├─ 5. verifyPackagedRuntimeDependencies  asar 运行时依赖闭包 + native 越界校验（失败即废包）
   └─ 6. audit-bundle-size                  体积审计
```

- 参数：`--os/-o <mac|win|linux>`、`--arch/-a <x64|arm64>`、`--skip-prepare`、`--skip-build`、`--dry-run`
  （帮助文本 [:286-305](../packages/desktop/scripts/bundle.mjs#L286-L305)）。**默认是 `mac/arm64`**
  （[:43-44](../packages/desktop/scripts/bundle.mjs#L43-L44)），在 Windows 上不带参数直接跑会打错平台。
  等价环境变量 `ZCODE_TARGET_OS` / `ZCODE_TARGET_ARCH`。
- `--dry-run` 只打印最终 electron-builder 命令就退出，接线阶段先用它。
- 产物目录 `packages/desktop/dist/`（可用 `ZCODE_DESKTOP_DIST_DIR` 覆盖，
  [electron-builder.config.js:86](../packages/desktop/electron-builder.config.js#L86)）。
- 跨目标只做一半：`ZCODE_TARGET_OS/ARCH` 会让资产准备按目标平台走
  （[packages/desktop/scripts/target-platform.mjs:37-53](../packages/desktop/scripts/target-platform.mjs#L37-L53)），
  Windows x64 机器交叉产 arm64 安装包是上游 CI 的常规做法；`zcode-runtime-host` 也支持在非 Windows 主机上
  交叉编译，走 `x86_64-w64-mingw32-g++` / `aarch64-w64-mingw32-clang++`，编译器可用 `ZCODE_WINDOWS_CXX` 覆盖
  （[scripts/build-windows-runtime-host.mjs:11-27](../scripts/build-windows-runtime-host.mjs#L11-L27)）。
  但**macOS 包只能在 macOS 上打**（需要原生 codesign/hdiutil），Linux 的 rpm 需要构建机有 `rpmbuild` 与 `xz`。

## 2. 两个轴：后端环境 ≠ 产品身份（打包前必须先决定）

| `ZCODE_ENV` | `ZCODE_PREVIEW_IDENTITY` | flavor | productName | 文件名后缀 |
| --- | --- | --- | --- | --- |
| `test`（或未设/无法识别） | 任意 | preview | `FusionFinLab Preview` | `_TEST` |
| `production` | 未设 / `0` | production | `FusionFinLab` | 无 |
| `production` | `1` | preview | `FusionFinLab Preview` | 无 |

规则见 [packages/desktop/scripts/desktop-product-identity.mjs:56-78](../packages/desktop/scripts/desktop-product-identity.mjs#L56-L78)：
测试后端**不允许**顶用正式身份覆盖用户正式安装，所以 `ZCODE_ENV=test` 强制是 Preview；
`ZCODE_PREVIEW_IDENTITY` 只认字面量 `1`/`0`/空，写 `true` 会在构建期直接抛错（[:42-53](../packages/desktop/scripts/desktop-product-identity.mjs#L42-L53)）。

品牌常量集中在 [packages/biz-brand/src/index.ts:47-51](../packages/biz-brand/src/index.ts#L47-L51)：
`productName=FusionFinLab`（决定安装目录、`%APPDATA%`、产物文件名）、`displayName=融智坊`、
`appId=com.meta.fusionfinlab.desktop`、`linuxExecutableName=fusionfinlab`。
Preview 会派生出 `.preview` appId 与 `-preview` 包名，与正式版可并排安装。
协议 scheme **仍然是 `zcode`**（[electron-builder.config.js:942-949](../packages/desktop/electron-builder.config.js#L942-L949)），
两个应用都会注册同名 scheme，最后注册者胜出——这是「明确不改的边界」一节里记着的已知取舍，见
[docs/brand-identity.md](brand-identity.md)。

### ⚠️ 最容易打错包的一条

打包器选哪份内置 Provider 目录、以及产品身份，都由 `ZCODE_ENV` 决定
（[electron-builder.config.js:61-65](../packages/desktop/electron-builder.config.js#L61-L65)）。
而如果命令行**没有**显式给 `ZCODE_ENV`，它会退回去读 `.env` / `.env.development(.local)`，
以文件里出现的最后一个值为准（[scripts/builtin-provider-config.mjs:14-33](../scripts/builtin-provider-config.mjs#L14-L33)）。
也就是说：**一个调试期遗留的 `.env.development` 能把你的正式包静默打成 Preview + 测试后端。**

出正式包时必须显式写在命令里，不要依赖 env 文件：

```bash
ZCODE_ENV=production pnpm bundle:desktop -- --os win --arch x64
```

打完立刻用 §8 的身份验收核对包名与后缀，别信"我设过了"。

## 3. Windows 打包

前置：VS Build Tools 2022（`VC.Tools.x86.x64`；打 arm64 还要 `VC.Tools.ARM64`）、CMake、Python 3.10+、
Git、Node 24。原因：`zcode-runtime-host.exe` 与 `zcode-installer-process-helper.exe` 要现场 CMake 编译，
并且安装包一定携带它们——缺失直接失败（[electron-builder.config.js:620-637](../packages/desktop/electron-builder.config.js#L620-L637)）。

```bash
# 正式包，x64
ZCODE_ENV=production pnpm bundle:desktop -- --os win --arch x64
# 交叉 arm64（在 x64 Windows 机器上）
ZCODE_ENV=production ZCODE_TARGET_ARCH=arm64 pnpm bundle:desktop -- --os win --arch arm64
```

打包器实际配置（[electron-builder.config.js:993-1072](../packages/desktop/electron-builder.config.js#L993-L1072)）：

- `win.target` 只有 `nsis` —— 不产 portable / msix。
- `nsis.oneClick=false`、允许用户改安装目录、安装/卸载图标用 `build/icon_installer.ico`。
- `verifyUpdateCodeSignature: true`、`signExts: [".node", ".dll"]`。
- 打包前会临时 patch electron-builder 自带的 NSIS `installSection.nsh` / `installUtil.nsh`，进程退出后恢复
  （[:695-734](../packages/desktop/electron-builder.config.js#L695-L734)）——**不要**把 patch 结果提交进 node_modules。
- win32 额外烧掉 Node CLI inspect 开关（fuses），但保留 `RunAsNode`（[:662-664](../packages/desktop/electron-builder.config.js#L662-L664)）。
- `extraResources` 携带：两个 runtime-host exe、`NOTICE.md`、`config/default.json`、
  内置 Provider 目录、agent JS bundle（`glm/zcode.cjs`）、`ripgrep`、native-search sidecars、托盘/窗口图标。

签名现状：只有 `ZCODE_ENABLE_WINDOWS_SIGN=1`（且在 Windows 上）才挂自定义 signer
（[:246-247](../packages/desktop/electron-builder.config.js#L246-L247)、[:1002-1008](../packages/desktop/electron-builder.config.js#L1002-L1008)），
它去调 `scripts/sign-windows.ps1` —— **本 fork 缺这个脚本**。`CSC_LINK` / `CSC_KEY_PASSWORD` 是
electron-builder 直接消费的通用变量。结论：本 fork 出的是**未签名 NSIS 包**，SmartScreen 与
`verifyUpdateCodeSignature` 那条更新校验链都要靠自己的签名基础设施补齐，机制背景见
[docs/desktop/windows-installer-overhaul-spec.md](desktop/windows-installer-overhaul-spec.md)、
[docs/desktop/windows-vsigntool-timestamp-retry.md](desktop/windows-vsigntool-timestamp-retry.md)、
[docs/desktop/windows-installer-diagnostics.md](desktop/windows-installer-diagnostics.md)。

已知可选开关：`ZCODE_ENABLE_WINDOWS_BROWSER_IMPORT=1` 才会编译并随包 Chrome 导入 helper
（默认关闭，入口已隐藏，[:59-60](../packages/desktop/electron-builder.config.js#L59-L60)）。

## 4. macOS 打包

前置：macOS 主机、Xcode Command Line Tools（含 `swiftc`、`codesign`、`hdiutil`、`ditto`）、Node 24、pnpm 10。

```bash
# 未签名内部测试包（这个 fork 的现实路径）
ZCODE_ENV=production pnpm bundle:desktop -- --os mac --arch arm64
# 有 Developer ID 时
ZCODE_ENV=production ZCODE_ENABLE_MAC_SIGN=1 \
  APPLE_SIGNING_IDENTITY="Developer ID Application: <你的组织> (<TEAMID>)" \
  pnpm bundle:desktop -- --os mac --arch arm64
```

配置要点（[electron-builder.config.js:950-1064](../packages/desktop/electron-builder.config.js#L950-L1064)）：

- `mac.target = ["dmg", "zip"]`，`minimumSystemVersion = 13.0.0`。
- **`notarize: false`**（[:976](../packages/desktop/electron-builder.config.js#L976)）—— 公证被刻意关闭，
  上游把它放在打包后的独立阶段；本 fork 没有那个阶段，所以包**不会自动公证**。
- 签名是显式开关式：`ZCODE_ENABLE_MAC_SIGN=1` **且** 有 `APPLE_SIGNING_IDENTITY`/`CSC_NAME` 才生效，
  否则 `identity=null` 直接出未签名包（[:70-74](../packages/desktop/electron-builder.config.js#L70-L74)、[:972](../packages/desktop/electron-builder.config.js#L972)）。
  Preview flavor 下开了签名却没身份会**提前抛错**，避免把未签名包误当走完发布链（[:254-262](../packages/desktop/electron-builder.config.js#L254-L262)）。
- `hardenedRuntime` 跟随签名开关；entitlements 用 `build/entitlements.mac.plist` 与 `.inherit.plist`（文件已存在）。
- `electronLanguages` 在 macOS 上必须走 `MAC_ELECTRON_LANGUAGES`，写错会让 Chromium 自带文案整批丢失
  （[:955-957](../packages/desktop/electron-builder.config.js#L955-L957)、打包后有断言校验 [:217-230](../packages/desktop/electron-builder.config.js#L217-L230)）。
- `signIgnore` 跳过 `cua-helper` / `glm` / `tools` 三处已预签名的目录（[:987-991](../packages/desktop/electron-builder.config.js#L987-L991)）。
- DMG 显式放大到 `3200m`，否则会静默截断 Framework 导致装完启动报 `DYLD Library missing`
  （[:1045-1050](../packages/desktop/electron-builder.config.js#L1045-L1050)）。
- 三个 TCC 用途描述（Apple Events / 蓝牙 / 麦克风）缺失会静默拒绝权限，文案已按 productName 生成
  （[:958-965](../packages/desktop/electron-builder.config.js#L958-L965)）。

CUA Helper：只在装了**真实 producer** 时才随包并断言存在
（[:77-78](../packages/desktop/electron-builder.config.js#L77-L78)、[:232-245](../packages/desktop/electron-builder.config.js#L232-L245)）。
开源占位包下会跳过——这是 fork 的正常形态，不是坏了。

签名/公证的完整要求与排障见 [docs/desktop/macos-dmg-signing-notarization.md](desktop/macos-dmg-signing-notarization.md)。
出包后可用 `pnpm doctor:macos-release`（[scripts/doctor-macos-release-app.sh](../scripts/doctor-macos-release-app.sh)）体检。

## 5. Linux 打包

```bash
ZCODE_ENV=production pnpm bundle:desktop -- linux x64
```

- `linux.target = ["AppImage", "deb", "rpm", "pacman"]` 四种全开
  （[electron-builder.config.js:1010-1033](../packages/desktop/electron-builder.config.js#L1010-L1033)），
  一次跑出四个格式。仓库入口**不支持只选一种格式**：`bundle.mjs` 的 `parseArgs` 对多余参数直接抛错
  （[packages/desktop/scripts/bundle.mjs:383-395](../packages/desktop/scripts/bundle.mjs#L383-L395)）。
  确实只想出 AppImage 时，只能在 `packages/desktop` 里手工执行
  `pnpm exec electron-builder --config electron-builder.config.js --linux AppImage`，
  代价是绕过第 1、2、5、6 阶段（资产准备、产物构建、依赖闭包校验、体积审计），仅用于调试。
- `executableName` / deb / rpm / pacman 的 `packageName` 全部按 flavor 拆成 `fusionfinlab` 与
  `fusionfinlab-preview`，否则系统包管理器会把另一 flavor 当升级替换掉
  （[:1021-1028](../packages/desktop/electron-builder.config.js#L1021-L1028)）。
- pacman 依赖是**手工维护的最小集**（gtk3/nss/libxss/libxtst/libnotify/alsa-lib/mesa/xdg-utils），
  因为 electron-builder 的默认集合含 Arch 已移除的包名（[:165-177](../packages/desktop/electron-builder.config.js#L165-L177)），产物扩展名归一成 `.pkg.tar.zst`。
- rpm 用 `fpm -d mesa-libgbm -d alsa-lib` **追加**而不是 `depends` 替换默认 Requires
  （[:1034-1044](../packages/desktop/electron-builder.config.js#L1034-L1044)）；构建机必须有 `rpmbuild` 和 `xz`。
- glibc 下限 2.28（RHEL 8 / Ubuntu 20.04 / Debian 10 起）；CentOS 7、Ubuntu 18.04、Amazon Linux 2 不在支持范围，
  依据与 rockylinux:8 实测记录见 [docs/desktop-ci-cd.md](desktop-ci-cd.md) 的「Linux 安装包格式与 glibc 基线」一节。
- 自更新在 Linux 上固定只认 AppImage，deb/rpm 只做首次安装分发。
- Arch 包细节见 [docs/desktop/linux-pacman-package.md](desktop/linux-pacman-package.md)。

## 6. 构建期开关清单（打不同能力的包用这些）

| 变量 | 影响的值 | 本 fork 的默认行为 |
| --- | --- | --- |
| `ZCODE_ENV` | 产品身份 flavor、内置 Provider 目录文件、产物 `_TEST` 后缀 | 未显式给时**回落去读 env 文件**（§2 的坑） |
| `ZCODE_PREVIEW_IDENTITY` | 生产后端 + Preview 身份（可并排装的内部包） | 只接受 `1`/`0` |
| `ZCODE_AUTO_UPDATE` | `__ZCODE_AUTO_UPDATE_ENABLED__`（[:44-46](../scripts/build-time-config.mjs#L44-L46)） | ⚠️ 内部默认文件 `config/private/build-defaults.json` **不存在**，所以不打这个变量就是**关闭自更新** |
| `ZCODE_ARMS_RUM_ENDPOINT` | `__ZCODE_ARMS_RUM_ENDPOINT__` | 空 = 不上报 |
| `ZCODE_TELEMETRY_REPORT_ENDPOINT` | `__ZCODE_TELEMETRY_REPORT_ENDPOINT__` | 空 = 不上报 |
| `ZCODE_ENABLE_MAC_SIGN` | 是否启用 macOS 签名参数（需配合身份变量） | 关 |
| `ZCODE_ENABLE_WINDOWS_SIGN` | 是否挂自定义 Windows signer | 关；**开着会因缺 `sign-windows.ps1` 失败** |
| `ZCODE_ENABLE_WINDOWS_BROWSER_IMPORT` | 是否编译并随包浏览器导入 helper | 关 |
| `ZCODE_NATIVE_SEARCH_ALLOW_PUBLISH` | 是否允许把自产 sidecar 写入共享 deps | 关（本地打包只下载/现编，不发布） |
| `ZCODE_SKIP_PREPARE` / `ZCODE_SKIP_BUILD` | 跳过第 1 / 第 2 阶段 | 只在反复调试第 3 阶段时用 |
| `ZCODE_E2E_KEEP_BUILD_CACHE` | `=1` 时不清 `out/` | ⚠️ 出正式包**不要**设：旧的 dev 产物会被打进 `app.asar`，泄露未压缩 JS 与 sourcemap 尾注（[packages/desktop/scripts/run-production-build.mjs:34-40](../packages/desktop/scripts/run-production-build.mjs#L34-L40)） |
| `ZCODE_DESKTOP_DIST_DIR` | 产物根目录 | `packages/desktop/dist` |
| `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` | 运行时与 builder 辅助包下载源 | builder 配 Electron runtime 镜像目录会被自动纠正回 npmmirror（[:265-274](../packages/desktop/scripts/bundle.mjs#L265-L274)）；内网 deps 源解析不到时回退官方 release 地址（[:169-177](../packages/desktop/scripts/bundle.mjs#L169-L177)） |

规则详见 [docs/desktop/build-time-optional-capabilities.md](desktop/build-time-optional-capabilities.md)。

内置 Provider 目录（模型供应商事实的唯一内置来源）会原样落进安装包
`resources/config/provider/zcode-builtin.json`（[:861-866](../packages/desktop/electron-builder.config.js#L861-L866)）。
换成融智坊自己的网关要改 `config/provider/zcode-builtin.json` / `zcode-builtin.test.json`，
这是 [docs/upstream-service-dependencies.md](upstream-service-dependencies.md) 里的 C 档，构建环境差异见
[docs/builtin-provider-config-build-environments.md](builtin-provider-config-build-environments.md)。

## 7. 自动更新与发布清单的现实

- 打包配置里 `publish` 是 generic provider，URL 固定为 `http://localhost:8081` 的**占位值**，
  `detectUpdateChannel=false`、`useMultipleRangeRequest=false`
  （[:1073-1083](../packages/desktop/electron-builder.config.js#L1073-L1083)）。
  它不再是可写的 stable feed；真正的更新入口由服务端 manifest provider 返回。
- 开发态用 `packages/desktop/dev-app-update.yml` 占位，仅在 `ZCODE_AUTO_UPDATE_DEV=1` 链路里生效
  （[docs/desktop/dev-auto-update-test.md](desktop/dev-auto-update-test.md)）。
- 要让客户端真的能自更新，缺的不是这个仓库里的代码，而是**外部三件事**：
  ① 构建时 `ZCODE_AUTO_UPDATE=1`；② 一个返回版本清单的服务端接口（YAML：`version` + `files[{url, sha512|sha2}]`）；
  ③ 签名/公证齐备且哈希可校验的产物放在可下载域名上。契约设计见
  [docs/adr/0004-release-packaging-platform-contract.md](adr/0004-release-packaging-platform-contract.md)。
- 构建产物通知、CDN 预热、灰度发布这些 CI 侧能力在本 fork 全部不存在（§0），别按上游文档找 job 名。

## 8. 打包后验收（每个平台都要过）

**身份与命名**

1. 产物文件名 = `${productName}-${version}-${mac|win|linux}-${arch}${_TEST?}.${ext}`
   （[:298-301](../packages/desktop/electron-builder.config.js#L298-L301)）；正式包**不得**出现 `Preview` 或 `_TEST`。
2. Windows：安装目录与 `%APPDATA%` 下是 `FusionFinLab`；快捷方式 AUMID 与 `appId` 一致
   （`com.meta.fusionfinlab.desktop`），任务栏图标是融智坊而不是上游 Z。
3. Linux：`Icon=zcode` 与 `hicolor/*/apps/<executableName>.png` 一致，可执行名是 `fusionfinlab`。
4. macOS：`codesign -dv --verbose=4 <>.app` 看 TeamIdentifier（未签名包应明确是未签名，不要误报成已签名）；
   `spctl -a` 结果如实记录。

**产物完整性（已被脚本机械校验，但要确认它真的跑了）**

5. `[bundle] target=<os>/<arch>` 与 `bundle:verify-runtime-dependencies`、`bundle:audit-bundle-size` 三段计时日志都出现。
6. `app.asar` 内无 `.map`（afterPack 清 sourcemap，[:471-494](../packages/desktop/electron-builder.config.js#L471-L494)），
   且不含其他平台 native（越界会抛错 [:496-507](../packages/desktop/electron-builder.config.js#L496-L507)）。
7. 装到一台干净机器（或新 Windows 用户配置）启动，主进程不报 `Cannot find module`——这类缺包历史上都是
   安装后才暴露，名单见 [:107-164](../packages/desktop/electron-builder.config.js#L107-L164)。

**合规（Apache-2.0，对外分发前必须做）**

8. `pnpm fork:changes` 重新生成 [docs/fork-changes.md](fork-changes.md)，改动清单与实际 diff 一致。
9. 包内 `resources/NOTICE.md` 与 `THIRD-PARTY-NOTICES.md` 存在且是本次构建的版本
   （随包注入：[:835](../packages/desktop/electron-builder.config.js#L835)、许可归集 [:735-748](../packages/desktop/electron-builder.config.js#L735-L748)）。
10. 关于窗体保留上游来源归属行（合规边界见 [docs/brand-identity.md](brand-identity.md) 的「开源合规边界」一节）。
11. **不要**对上游法律/文案文件跑格式化；提交前 `git diff --numstat` 确认这些文件只有新增行。

## 9. 本 fork 要走到"正式发版"还缺什么（按处置成本分档）

| 档 | 要做的事 | 说明 |
| --- | --- | --- |
| 现在就能做 | 本地手工出未签名包 + 内部分发 | §3–§5 的命令，Windows NSIS 与 Linux 包可直接用；macOS 包用户需右键打开绕过 Gatekeeper |
| 只要基础设施 | 自建三平台 runner 或直接手工在三台机器出包 | 需要 macOS Developer ID + 公证凭据、Windows Authenticode 证书（并把 `scripts/sign-windows.ps1` 补进仓库，或改走 `CSC_LINK` 让 electron-builder 内置 signtool 签） |
| 必须补代码/服务 | 更新清单服务 + 产物上传 + `latest.yml` 生成 | 目前没有任何仓库内入口，见 §7 与 ADR 0004 |
| 需要产品决策 | 用户协议/隐私政策 URL、share 落地页与下载地址 | 仍指向上游 `zcode.z.ai`，属对外可见内容，需本 fork 的法务主体信息才能改，见 [docs/upstream-service-dependencies.md](upstream-service-dependencies.md) |

## 10. 排障入口

| 症状 | 先看 |
| --- | --- |
| `prepare:desktop-runtime` 失败、下载 URL 报错 | [docs/desktop-ci-cd.md](desktop-ci-cd.md) 的「排障重点」一节（通常是外网或上游发布资产变化） |
| 装完启动 `Cannot find module X` | [docs/desktop-ci-cd.md](desktop-ci-cd.md) 与 [docs/electron/electron-builder-26.17-upgrade.md](electron/electron-builder-26.17-upgrade.md)（26.17 的 pnpm collector 漏 dedup 传递依赖） |
| NSIS 装完覆盖/保留文件行为不对 | [docs/desktop/windows-installer-preserve-files.md](desktop/windows-installer-preserve-files.md)、[docs/desktop/windows-update-install-handoff.md](desktop/windows-update-install-handoff.md) |
| 包体积异常变大 | `node packages/desktop/scripts/audit-bundle-size.mjs --artifact-path <包>`，规则见 [docs/desktop-bundle-size-architecture.md](desktop-bundle-size-architecture.md) |
| Windows 自更新信任/换证 | [docs/desktop/auto-update-service-manifest.md](desktop/auto-update-service-manifest.md) |
| 平台选择与缓存策略 | [docs/ci-build-platform-selection.md](ci-build-platform-selection.md)、[docs/ci-cache-strategy.md](ci-cache-strategy.md) |
