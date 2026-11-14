# 品牌身份（融智坊 / FusionFinLab）

## 目标

把本 fork 的应用标识从上游 `ZCode` 换成 `融智坊 / FusionFinLab`，视觉标记与
`F:\develop\metaBase1.0\meta-fusionfinlab\portal` 一致（六边形分子标记 + 蓝→绿渐变）。

上游仓库**没有** white-label / edition 机制：标识分散在「构建期身份表」「运行时 React 组件」
「主进程原生外壳」「派生图标」四类位置。本 spec 规定每类位置的唯一所有者和接管方式，
目的是把 fork 的 diff 收在可控的少数 seam 上，而不是散落成上千个字面量替换。

## 唯一所有者：`biz-brand`

`packages/biz-brand` 是 `domain` 层受控模块：无 IO、无 `await`、无 JSX，只持有常量与字符串。
品牌事实只有一个来源，其它位置一律读取，不再各自复制一份名称或图形。

公开契约（`packages/biz-brand/src/contract.ts`）：

| 字段                  | 语义                                    | 取值                            |
| --------------------- | --------------------------------------- | ------------------------------- |
| `productName`         | 打包与文件系统用的 ASCII 名             | `FusionFinLab`                  |
| `displayName`         | 界面、托盘、菜单、关于页展示名          | `融智坊`                        |
| `displayNameEn`       | 副名 / wordmark 次要文字                | `FUSIONFINLAB`                  |
| `appId`               | electron-builder appId 与 Windows AUMID | `com.meta.fusionfinlab.desktop` |
| `linuxExecutableName` | Linux 可执行与包名                      | `fusionfinlab`                  |
| `logoSvg`             | 品牌标记母版（viewBox 0 0 120 120）     | SVG 源码字符串                  |
| `logoDataUrl`         | 可直接进 `<img src>` 的 data URL        | 由 `logoSvg` 编码               |

字段只保留有真实消费方的：窗口/文档标题由 HTML 壳的 `<title>` 与 `document.title` 决定，
没有集中所有者，因此不设 `windowTitle` 字段，避免契约里躺着没人读的值。

母版只有一份：`logoSvg`。运行时用 `logoDataUrl`，派生图标用它渲染，两者不允许各自维护图形。

## Seam 清单

### 1. 构建期身份（改表，不改判定轴）

| 位置                                                      | 现状                                                     | 接管                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/desktop/scripts/desktop-product-identity.mjs:8` | `PRODUCTION_IDENTITY` 硬写 `dev.zcode.app` / `ZCode`     | 字段值改为读 `biz-brand`；`flavor`（production/preview）与 `ZCODE_ENV` 两个正交轴语义不变   |
| `resolveWindowsAppUserModelIdForFlavor():89`              | 开发态返回 `cn.aminer.zcode`                             | 开发态改为 `<appId>.dev`：依旧与正式/Preview 快捷方式互不干扰，但换掉上游身份，Windows 按 AUMID 缓存的任务栏图标不再继承上游旧图标；打包态随 `appId` 变更                     |
| `packages/desktop/electron-builder.config.js`             | `appId`/`productName` 来自身份表，`protocols` 显示名同源 | 无需单独改：跟随身份表；`extraMetadata.author.name` 读 `productName`                        |
| `packages/desktop/tsup.config.ts` main `noExternal`       | 源码型 workspace 包必须内联进 main bundle                | `@zcode/biz-brand` 与 `@zcode/provider` 同规则；漏加会让安装包启动即 `ERR_MODULE_NOT_FOUND` |

`productName` 变更的连带影响必须知道：它决定 Windows `%APPDATA%\<productName>` 与安装目录，
打包后 Dev/正式版与 `FusionFinLab` 并存、数据根互不干扰。运行时应用名同样读它
（`desktopRuntimeEnv.ts:66` → dev `FusionFinLab Dev` / preview `... Preview` / prod 本名），
所以 dev 的**默认** userData 目录从 `%APPDATA%\ZCode Dev` 变成 `%APPDATA%\FusionFinLab Dev`；
本机 dev 靠显式 `ZCODE_DESKTOP_USER_DATA_DIR`（数据根隔离）指到 F 盘，不受这次改名影响，
但没有该覆盖的启动会新建一个空白 profile，窗口位置与本地存储看起来像初始化。
`build/installer.nsh` 的日志名（`ZCode-installer.log`）与内部 `ZCode*` 变量/宏名属于安装器实现，
跟随打包验收一起决策，本轮不改。`scripts/devElectronAppBundle.mjs` 的
`DEV_ELECTRON_APP_NAME = "ZCode Dev"` 也只在本轮之外：它仅写 macOS dev bundle 的
`CFBundleName`/`CFBundleDisplayName`，不参与 userData 目录计算，改名会让开发态 .app 与
已安装的 dev bundle 目录名分叉。

### 2. 运行时 React 图形（三个上游组件）

| 位置                                                                       | 消费者                                                                                                | 接管                                                                                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/components/mobile-ui/ZCodeAppLogo.tsx:3`                  | `web/src/auth/WebLoginPage.tsx`、`web-remote-control/ui/webRemoteControlBrand.tsx`                    | `<img src>` 从 `logo-zai.svg` 改为 `logoDataUrl`，保留 `data-app-logo` 测试钩子                                                                            |
| `packages/ui/src/App.tsx:58`                                               | `:1357` 的 `appLogoUrl` prop                                                                          | 同上                                                                                                                                                       |
| `packages/ui/src/root/RootStartupLoading.tsx:54`（内联 SVG path）          | 启动壳、`WindowsTopLeftLogo.tsx:28`、`DesktopTopOverlay.tsx:152`、`OccupationOnboardingVisual.tsx:54` | `ZCodeStartupLogo` 内部渲染改为品牌标记；徽章底色/圆角/动画与 `size` 语义保持不变                                                                          |
| `packages/ui/src/components/ui/ZCodeAboutLogo.tsx:3`（内联 SVG path）      | `WelcomeScreen.tsx:688`                                                                               | `ZCodeAboutLogo` 改为品牌标记                                                                                                                              |
| `packages/ui/src/components/ui/ZCodeAboutLogo.tsx:28`（"ZCode" 字形 path） | `highspeed/HighspeedShareNoticeCard.tsx:78`                                                           | `ZCodeWordmarkLogo` 改为文字 wordmark（`displayName` + `displayNameEn`），沿用原 className；CSS 只依赖 `width/height/opacity`（`highspeed-share.css:135`） |
| `packages/ui/src/v4/ConversationDraftEmptyState.tsx`（浅色内联 Z 线框 path + 深色 `@/assets/Z.svg`） | 草稿首页问候语背后的大水印；手机远控复用同组件          | 两套主题合并成单个 `<img src="${logoDataUrl}">`（`data-v4-draft-logo="brand"`）：彩色母版不能再用 `currentColor` 继承容器灰度，水印强度改由 `opacity` 分档，下缘渐隐遮罩与旧观感一致。上游 `packages/ui/src/assets/Z.svg` 已无引用，删除 |

组件名、props 与 className 不改，避免上游同步与样式连锁改动；改的是它们内部的图形来源。

### 2.1 品牌文案 seam（i18n 占位，不做字面量替换）

登录页是本轮唯一从 i18n 语料里摘出来的品牌文案，做法是把品牌名改成 ICU 占位符，值仍由
`biz-brand` 提供，避免在 5 个 locale 文件里各写一份中文名：

| key                                                        | 位置                                                                                   | 接管                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `login.title`、`login.description`、`login.copyright`      | `packages/ui/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR,ru-RU}.ts`                      | 品牌名一律写成 `{brand}` 占位；五种语言同步改造，不留一种还显示上游名                            |
| 消费方                                     | `packages/ui/src/WelcomeScreen.tsx`（`LoginPanelHeader` 标题/副标题、页脚版权）        | `loginBrandName(locale)`：`zh*` 取 `displayName`，其余取 `productName`；调用点只传值不拼字符串 |

`login.description` 原文点名登录提供方（`登录 Z.AI`）。租户 OAuth2 尚未落地，登录目标随时可能改，
所以文案改成不点名的「登录即可开始使用 {brand}」——既不再声明上游商标，也不提前替未定的认证方案背书。

**不要动** `packages/ui/src/assets/provider-icons/logo-zai.svg`：它同时是 Z.AI 服务商图标
（`packages/ui/src/lib/oauthProviderIcon.tsx:6`），属于第三方 provider 品牌，不是本应用标识。

### 3. 主进程原生外壳

| 位置                                                                             | 内容                                                   | 接管                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/main/index.ts:316,329`                                     | `app.setName(runtimeApplicationName)`、`process.title` | 名称来自 `biz-brand`：`desktopRuntimeEnv.ts:66` 用 `productName` 拼 dev/preview 后缀                                 |
| `packages/desktop/src/main/index.ts:1637,1672,1928,2751`                         | `nativeImage` / `icon`                                 | 图标文件路径不变，内容随派生图标更新                                                                                 |
| `packages/desktop/src/main/desktopTray.ts:14`（图标）与 tooltip                  | 托盘                                                   | tooltip 用 `{appName}` 模板插 `app.name`（dev 下即 `FusionFinLab Dev`），图标文件换成派生产物                        |
| `packages/desktop/src/main/about.ts:56,73,80`                                    | “关于 ZCode” 窗口标题与文案                            | 读 `biz-brand`                                                                                                       |
| `packages/desktop/src/main/aboutWindow.ts:174`（内联 SVG path）                  | 自定义关于窗体                                         | 改为 `<img src="${logoDataUrl}">`，`.app-logo` 尺寸样式不动                                                          |
| `packages/shared/src/desktopMenu.ts:51,115,167`                                  | 应用菜单首项与 About/Quit 标签                         | 菜单 id 文案改成 `{appName}` 模板，由 `desktopApplicationMenu.ts` / `desktopTray.ts` 用 `app.name` 插值              |
| `packages/desktop/src/renderer/index.html`、`packages/web/index.html`            | 首屏启动壳图形、文档标题、favicon                      | 标题写 `融智坊`；启动壳内联母版副本（静态壳不能 import TS）；web favicon 换成母版 data URL                           |
| `packages/desktop/src/renderer/cua-permission-panel.html`、`plugin-sandbox.html` | 子窗口文档标题                                         | 本轮不改：前者标题不可见且面板名是 Computer Use 助手身份（跟随 Helper 二进制一起决策），后者是沙箱页的 devtools 标题 |

### 4. 派生图标（唯一允许生成二进制的环节）

`packages/desktop/build/` 的 `icons/{16..1024}x{16..1024}.png`、`icon.png`、`icon_windows.png`、
`icon_installer.png`、`icon.ico`、`icon_installer.ico`（打包态复制为 `tray_icon.ico`，见
`electron-builder.config.js:868,890`）与 `packages/web/public/favicon.ico` 由
`node scripts/render-brand-icons.mjs`（在 `packages/desktop` 下执行）从 `logoSvg` 母版栅格化，
输入只有母版与目标尺寸，产物可重跑覆盖。

- 图标构图与上游一致：深色圆角方块（`#000 → #151718`，圆角占画布 23%）+ 居中品牌标记，
  与 App 内启动壳、关于页的 logo 壳同一套底色；16px 下纯描边母版不可读，所以图标不能直接用裸标记。
- Windows 侧仓库内没有 `sharp` / `@resvg` 等栅格化依赖，派生脚本使用本机 Edge/Chrome headless
  `--screenshot --default-background-color=00000000`，ICO 用 PNG-in-ICO 容器封装。
  每个尺寸必须用独立 `--user-data-dir`：共用 profile 会命中 Edge 单实例锁，第二次截图请求会挂住。
  浏览器路径可用 `ZCODE_BRAND_ICON_BROWSER` 覆盖；中间产物写 `<repoRoot>/.cache/brand-icons`。
- `icon.icns` 与 `dmg_background*.png` 属于 macOS 产物，Windows 上无法生成，保持原样并在报告里标注未覆盖，
  不假装完成。
- 图标是构建资源，不进 `biz-brand` 包；母版在 `biz-brand`，派生产物在 `packages/desktop/build/`。

## 明确不改的边界

| 项                                                                                           | 理由                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.zcode` 数据目录名                                                                          | `packages/services/src/storage/adapters/rootsResolver.ts:9` 有常量，但全仓 40+ 处硬编码 join；改名会让存量会话、凭据、日志全部失联，属于数据迁移议题而不是品牌议题                                               |
| `zcode://` deep link scheme                                                                  | 授权回调、Linux scheme 注册、provider 配置多处硬编码；与租户 OAuth2 回调地址一起决策才有意义                                                                                                                     |
| `ZCODE_*` 环境变量前缀                                                                       | 约 529 个变量名，改动等于重做所有启动配方与 CI                                                                                                                                                                   |
| i18n 语料与注释里的 "ZCode" 字面量（ui 907 / services 182 / desktop 103 / shared 89 个文件） | 全量替换会把 upstream 同步冲突面扩大到每个包；本轮按“品牌包 + seam”收口。已从语料里摘出的只有 `login.title` / `login.description` / `login.copyright` 三个 key（见 2.1），其余正文文案留给后续单独决策 |
| 登录页页脚版权与`用户协议`/`隐私政策`链接                                                    | 现指向上游 `https://zcode.z.ai/*`，条款主体与地址属法务边界，需要本 fork 自己给出文案和 URL，不能由品牌 seam 编造。页脚版权行已跟随品牌名改成 `{brand}`                                                                                  |
| CLI bin 名 `zcode`                                                                           | 用户已安装的脚本与 PATH 依赖它；改名影响二开之外的工作流                                                                                                                                                         |
| 分享落地页与分享管理页的 `ShareBrandMark`                                                    | `packages/web/src/share/ConversationShareLandingPage.tsx:249` 仍内联上游 Z 图形与 "ZCode" 字形 path，同页 `ZCODE_DOWNLOAD_URL = https://zcode.z.ai` 会把访客引到上游下载。这两处对外可见，但换标要连同本 fork 的下载/落地地址一起定，未决策前不动 |

上表最后两行（条款链接、分享落地地址）本质是**服务依赖**而不是图形依赖，处置档位与其余上游域名
一起登记在 [上游服务依赖清单](upstream-service-dependencies.md)；品牌 seam 只负责图形与文案取值，
不代为决定这些地址指向哪里。

## 开源合规边界（Apache-2.0）

上游 `zai-org/zcode` 以 Apache-2.0 发布（根 `LICENSE`，`package.json` 的 `license: Apache-2.0`）。
品牌 seam 属于对原始代码的修改，必须停在许可允许的范围内：

- §4(a) 随发行物提供许可副本：`LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md` 一律不改、不删、
  不改名；打包裁剪只移除非运行时文件，`LICENSE` 继续进安装包（`electron-builder.config.js:682`）。
- §4(c) 保留源码内的版权/归属声明：`packages/ui/src/components/ai-elements/*.tsx` 等文件头的
  `See THIRD-PARTY-NOTICES.md ...` provenance 注释不在任何改动文件里，品牌改动不得顺手清掉。
- §4(b) 标注被修改的文件：本 fork 不在被改的上游源文件里逐个加“已修改”头注释——那会把同步冲突面
  扩大到每个 seam。改为 `node scripts/fork-changes.mjs`（根脚本 `pnpm fork:changes`）对比上游同步基线，
  生成 `docs/fork-changes.md` 的改动文件清单，随源码提供，配合 git 历史与 `docs/upstream-sync.md`。
- §4(d) 归属声明：`NOTICE.md` 第五节是本 fork 追加的修改与商标声明，只新增、不替换上游第一至四节文本；
  上游文本改动会放大法务与同步审查成本，格式化脚本对该文件的重排也已回退。
- §6 不授予商标许可：把 `ZCode` / `Z.AI` 标识从产品品牌位换成 `融智坊 / FusionFinLab` 是二开
  发布的必要动作，不是可选美化。反向约束同样成立——换标不等于消除来源归属，
  关于面板的 `版权所有 © <year>` 由上游名改成本 fork 名之后，自定义关于窗体与原生 About 面板
  各显示一行上游来源声明（`about.ts` 的 `upstreamNotice`，256×312 窗口实测不裁切）；
  登录页页脚同理换成品牌名——UI 上的运营主体署名不是 §4(c) 要求保留的源文件归属声明，
  许可与归属义务由 `LICENSE` / `NOTICE.md` / `THIRD-PARTY-NOTICES.md` 与关于面板的来源行承担。
  仍属第三方法务文本、不由品牌 seam 自行编造或删除的，只剩 `用户协议`/`隐私政策` 的地址与
  分享页引到上游下载站的链接，待决策项见上表。

## 验收场景

1. 源码态启动 dev：标题栏徽章、启动壳、WelcomeScreen、Web 登录页四处显示品牌标记，页面标题为 `融智坊`。
   渲染层的品牌走 vite 源码，实测方式是连本机 dev 窗口的 CDP 读 DOM（标题 + logo `<img>` 的 data URL
   解码后是母版）；主进程外壳（菜单/托盘/原生关于面板）由 tsup 产物决定，改 `biz-brand` 后必须重启
   dev 才会生效，热更新不会覆盖。
2. `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 通过，且 `biz-brand` 已登记为受控模块（`unmanaged-new-file` 不报错）。
3. 运行中的桌面进程名与 userData 目录仍由 flavor 轴决定（dev 不受打包身份影响），品牌改动不破坏数据根隔离：
   显式给出 `ZCODE_DESKTOP_USER_DATA_DIR` / `ZCODE_DATA_BASE_DIR` 时，目录与改名前一致，
   仅未覆盖时的默认目录名跟随 `productName`。
4. 重新生成图标后，托盘、任务栏、关于窗口取到品牌图标；无法在 Windows 验证的 macOS 产物明确标注未验证。
   Windows 任务栏按钮取的是**主进程启动时**读到的 `build/icon_windows.png`（`index.ts:335` 只在 dev 走
   `../../build/` 相对路径，`applyAppIcon` 在非 darwin 直接 return），所以栅格化之后必须重启 dev 才会换；
   实测时先比对 electron 进程启动时间与图标文件 mtime，进程早于文件就是产物过期，不是代码问题。
   开发态 AUMID 已改成本 fork 的 `<appId>.dev`（`desktop-product-identity.mjs:89`）：上游值
   `cn.aminer.zcode` 会被 Windows 按 AUMID 命中的图标缓存钉住，换标后仍显示上游旧图标；
   本机两个 ZCode 快捷方式的 AUMID 实测都是 `dev.zcode.app`，改值不会与已装安装包互相抢身份。
   验证方式是重启 dev 后看任务栏按钮，缓存键变化后应直接取到品牌图标。
   2026-11-13 实测通过：重建后的 `out/main/index.js` 里 `resolveWindowsAppUserModelIdForFlavor`
   取到 `${brandIdentity.appId}.dev`，主进程启动时间晚于产物时间，任务栏按钮已是品牌六边形。
   远程桌面会话下 `CopyFromScreen` 整屏是全黑的，任务栏只能对 `Shell_TrayWnd` 用 `PrintWindow` 抓，
   再用 UI Automation 按窗口分组名定位到本进程那一格，不能凭肉眼在整屏截图里猜位置。
5. 全文检索品牌相关 seam 组件内不再有上游 "ZCode" 图形 path；`logo-zai.svg` 仍被 provider 图标引用。
   上游水印资产 `packages/ui/src/assets/Z.svg` 已随 seam 改造删除，全仓无引用。
6. 关于窗体（自定义 HTML 与原生面板）显示上游来源声明行，256×312 实测不裁切；`LICENSE`、`NOTICE.md`
   第一至四节与 `THIRD-PARTY-NOTICES.md` 相对上游零删改（`git diff` 对 NOTICE.md 只有新增行），
   对外分发源码前 `pnpm fork:changes` 重新生成改动清单。
7. 登录页三处品牌文案（标题、副标题、页脚版权）由 `{brand}` 占位渲染，实测 CDP 读 `document.body.innerText`
   得到 `欢迎来到 融智坊` / `登录即可开始使用 融智坊` / `© 2026 融智坊`；切到英文界面应显示拉丁名
   `FusionFinLab` 而不是中文名。草稿首页水印在退出登录后才挂载，未登录态先用离线 playwright 复现容器
   与遮罩验证构图；2026-11-13 已在本机登录态补做运行时实测：CDP 查到 `[data-v4-draft-logo="brand"]`
   且 `src` 是 `data:image/svg+xml,` 品牌资产，不再是上游 `Z.svg`。
   同一轮 CDP 全文扫描确认，界面里残留的 "ZCode" 字样全部来自 i18n 文案（输入框占位符、设置项说明），
   属于本轮明确不做的全量词条替换，不是 seam 漏改。

## 相关代码

| 文件                                                                                         | 职责                |
| -------------------------------------------------------------------------------------------- | ------------------- |
| `packages/biz-brand/src/contract.ts`                                                         | 品牌事实的公开契约  |
| `packages/biz-brand/src/index.ts`                                                            | 常量与母版导出      |
| `packages/desktop/scripts/desktop-product-identity.mjs`                                      | 构建期身份表        |
| `packages/desktop/electron-builder.config.js`                                                | 打包身份与图标装配  |
| `packages/desktop/scripts/render-brand-icons.mjs`                                            | 由母版派生图标集    |
| `packages/ui/src/root/RootStartupLoading.tsx`                                                | 启动壳 / 标题栏徽章 |
| `packages/ui/src/components/ui/ZCodeAboutLogo.tsx`                                           | 关于页与 wordmark   |
| `packages/ui/src/components/mobile-ui/ZCodeAppLogo.tsx`                                      | 跨端 App logo       |
| `packages/ui/src/v4/ConversationDraftEmptyState.tsx`                                         | 草稿首页品牌水印    |
| `packages/ui/src/WelcomeScreen.tsx` + `i18n/locales/*.ts` 的 `login.*`                       | 登录页品牌文案占位  |
| `packages/desktop/src/main/about.ts`、`desktopTray.ts`、`packages/shared/src/desktopMenu.ts` | 原生外壳文案        |
