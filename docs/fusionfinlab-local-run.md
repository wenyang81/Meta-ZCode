# 融智坊桌面端 · 本地测试运行步骤

> 适用范围：本 fork（`zai-org/zcode` 二开，品牌 `融智坊 / FusionFinLab`）在本机跑起来做功能验证。
> 上游通用文档已经很多，本文只做**索引 + fork 特有现实**，不重复它们的内容。
> 打包发布请看 [本地打包步骤](fusionfinlab-packaging.md)。

## 0. 文档分工（先查这张表，别在本文里找答案）

| 我要弄明白的事 | 该读哪份 |
| --- | --- |
| bootstrap 命令的边界与远程初始化环境 | [docs/bootstrap.md](bootstrap.md) |
| 开发态 runtime 归属、macOS `.zcode-runtime/desktop-dev` | [docs/desktop/dev-runtime.md](desktop/dev-runtime.md) |
| 为什么 dev 有文件监听黑名单 | [docs/desktop/dev-build-watch.md](desktop/dev-build-watch.md) |
| 深链 `zcode://` 在开发态怎么验 | [docs/desktop/dev-deep-link.md](desktop/dev-deep-link.md) |
| 开发态验证自动更新 | [docs/desktop/dev-auto-update-test.md](desktop/dev-auto-update-test.md) |
| mise 任务与数据根隔离约定 | [docs/development-mise-runtime.md](development-mise-runtime.md) |
| Vite OOM / 类型错误排障 | [docs/migration/dev-troubleshooting.md](migration/dev-troubleshooting.md) |
| react-scan 覆盖层（不是"花屏"） | [docs/performance/react-scan-dev.md](performance/react-scan-dev.md) |
| Windows 上以源码方式跑 CUA | [docs/cua/windows-source-development.md](cua/windows-source-development.md) |
| push 门禁到底跑什么 | [docs/testing/pre-push-hook.md](testing/pre-push-hook.md) |
| 品牌改了哪些接缝、哪些明确不改 | [docs/brand-identity.md](brand-identity.md) |
| 数据目录叶子名（`.zcode` → `.dlMeta`）怎么配、哪些名字不能动 | [docs/data-dir-name.md](data-dir-name.md) |
| 上游服务地址分档（env / 构建期 / 硬编码） | [docs/upstream-service-dependencies.md](upstream-service-dependencies.md) |

## 1. 一次性环境准备

工具链版本由 [mise.toml](../mise.toml) 钉住：node `24.14.0`、pnpm `10.33.2`，并且已经设了
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（`COREPACK_ENABLE_PROJECT_SPEC=0`）。
所有 mise 任务都经 `node scripts/mise-run.mjs` 转发，不要绕过它直接猜任务体。

装完系统工具后按平台确认这几件事：

| 平台 | 必需 | 落点 / 失败态 |
| --- | --- | --- |
| Windows | Git Bash、Node 24、pnpm 10、VS Build Tools 2022（含 `VC.Tools.x86.x64`） | 缺 VS 时 `prepare:windows-runtime-host` 直接失败，因为它用 `cmake -G "Visual Studio 17 2022" -A x64` 现编 `zcode-runtime-host.exe`（[scripts/build-windows-runtime-host.mjs:11-27](../scripts/build-windows-runtime-host.mjs#L11-L27)） |
| macOS | Xcode Command Line Tools、`make`、`curl`、`tar` | 缺 `swiftc` 时窗口吸附 helper 会被跳过，权限浮窗退化成不吸附（fail-open，不报错） |
| Linux | Node 24、pnpm 10、能跑 Electron 的图形栈 | 缺预编译 sidecar 时 `prepare:native-search` 需要现场构建，普通开发路径不要求 |

三条 Windows 上真实踩过的坑：

1. **PATH 顺序**：`C:\Windows\System32` 里的 `tar.exe` 是 bsdtar，会盖掉 GNU tar，某些解包步骤行为不同。把工作区内的工具目录排在前面。
2. **`pnpm` 在脚本里是 `pnpm.cmd`**：仓库脚本在 win32 上显式走 `pnpm.cmd`（[scripts/bootstrap.mjs:52-62](../scripts/bootstrap.mjs#L52-L62)），手工在 Git Bash 里复制脚本命令时不要照着改成别的 shim。
3. **别残留 `ELECTRON_RUN_AS_NODE=1`**：带着它启动，Electron 会变成纯 Node 进程，窗口根本不出现。仓库自己在冒烟脚本里删掉这个变量（`packages/desktop/scripts/auto-update-*-smoke.mjs`），手工启动前先 `env -u ELECTRON_RUN_AS_NODE ...` 或确认 shell 里没 export。

**数据根不要落在 C 盘。** 默认值是 `${HOME 或 homedir}/.zcode`
（[packages/services/src/paths.ts:14-15](../packages/services/src/paths.ts#L14-L15)、[:47](../packages/services/src/paths.ts#L47)），
Windows 上就是 `C:\Users\<你>\.zcode`。跑 dev 前显式指定：

```bash
export ZCODE_DATA_BASE_DIR=/f/data/zcode-dev-home      # 缓存/会话/日志都跟着走
export ZCODE_DESKTOP_USER_DATA_DIR=/f/data/fusionfinlab-dev/userData   # Electron userData（登录态、localStorage）
```

两者是**不同**的目录：前者是 agent 数据根，后者只影响 Electron userData
（[packages/desktop/src/main/desktopRuntimeEnv.ts:82](../packages/desktop/src/main/desktopRuntimeEnv.ts#L82)）。
只设前者不够。

> 优先级提醒：`~/.zcode/v2/setting.json` 里的 `dataBaseDir` 会盖过环境变量，**除非**当前是隔离开发态。
> 生产安装版（`F:\tools\zcode`）用的就是这个文件，别拿它当测试配置改。

## 2. 首次拉仓库（只做一次）

```bash
mise install                              # 或自行确认 node 24.14.0 / pnpm 10.33.2
pnpm bootstrap                            # 根 package.json:65
node scripts/check-workspace-freshness.mjs
```

`pnpm bootstrap` 的真实顺序（[scripts/bootstrap.mjs:220-245](../scripts/bootstrap.mjs#L220-L245)）：

1. `git submodule update --init --recursive apps/zcode-cli`
2. 清理被 patch 的依赖残留
3. `pnpm install`（触发 `prepare` → `husky && pnpm build:cua`，以及 desktop 的 `postinstall` node-pty 处理）
4. `pnpm prepare:desktop-runtime`
5. `pnpm build:bootstrap`（`packages/*` 全量，desktop 用 `build:no-runtime-assets`）

**不带交互提示**，只有 `--with-remote` 一个额外开关，用于远程 workspace 资产链路。
低内存机器上它是刻意串行的（并发 workspace 构建会 OOM），慢是正常的，别手动并行。

## 3. 每天怎么起

```bash
pnpm dev:desktop:test         # 连测试后端（推荐日常）
pnpm dev:desktop              # = dev:desktop:prod，连正式后端
```

注意默认值：根 `dev:desktop` 指向 **production**（[package.json:9-11](../package.json#L9-L11)），
想连测试环境必须显式带 `:test`。`mise dev` 任务是另一条路径，它额外把数据根设成
`{{env.HOME}}/.zcode-dev-home`。

两条命令的差别**只有一个变量** `ZCODE_ENV`（[scripts/dev-desktop-env.mjs:10-15](../scripts/dev-desktop-env.mjs#L10-L15)、[:72](../scripts/dev-desktop-env.mjs#L72)），
随后按顺序做四件事：

1. （仅 macOS 且装了真实 CUA producer）构建 CUA Helper app
2. `pnpm --filter @zcode/desktop pre-dev` → 准备本地 runtime 资产 + **删掉整个 `out/`**（[packages/desktop/package.json:13](../packages/desktop/package.json#L13)）
3. 构建 agent CLI
4. `dev:runtime` → `concurrently` 起 `tsup --watch`、`vite dev`、`node scripts/dev.mjs`

dev 起来后的进程与端口：

| 端口 | 归属 | 说明 |
| --- | --- | --- |
| 5174 | Vite renderer dev server | `strictPort: true`（[packages/desktop/vite.config.ts:222](../packages/desktop/vite.config.ts#L222)），被占直接失败，不会自动换端口 |
| 9229 | Electron CDP | 仅未打包态固定注入（[packages/desktop/src/main/index.ts:326-327](../packages/desktop/src/main/index.ts#L326-L327)），用 `ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT=1` 关掉 |
| 无固定 TCP | main ↔ host ↔ agent | 走 Electron `MessagePort` / stdio，不要在防火墙或端口表里找它 |

`pnpm dev:web` 是另一套东西（server `3030` + web Vite `5173`），**dev:desktop 不会拉起它们**。

## 4. 判定"真的起来了"（验收）

不要靠肉眼看窗口，按这三条依次确认：

1. 构建标记齐了：`packages/desktop/out/` 下 `.main-build-ready`、`.host-build-ready`、
   `.preload-build-ready`、`.extension-host-build-ready` 四个文件都存在
   （[packages/desktop/scripts/dev.mjs:14-18](../packages/desktop/scripts/dev.mjs#L14-L18)），
   `dev.mjs` 只有在它们全部就绪且 main bundle 产出后才启动 Electron。
2. Vite 就绪：`dev.mjs` 轮询 `localhost/127.0.0.1/[::1]:5174`（[:73](../packages/desktop/scripts/dev.mjs#L73)）。
3. 主进程报告就绪：日志出现 `perf_agent_ready reported`
   （[packages/desktop/src/main/desktopStabilityTelemetry.ts:320](../packages/desktop/src/main/desktopStabilityTelemetry.ts#L320)）。

这个 fork 额外要验的两条（品牌与隔离，改动过就必须重跑）：

- 任务栏/开始菜单图标是**融智坊**，且开发态身份独立：AUMID 为 `com.meta.fusionfinlab.desktop.dev`
  （[packages/desktop/scripts/desktop-product-identity.mjs:89-93](../packages/desktop/scripts/desktop-product-identity.mjs#L89-L93)）。
  看到上游旧 Z 图标 = 图标缓存或 seam 失效。
- 会话数据写进 `ZCODE_DATA_BASE_DIR` 指向的目录，`C:\Users\<你>\.zcode` 没有新增文件。

## 5. 把客户端指到自己的后端 / 模型网关

这一步是二开的主线，**不要靠改代码**。按 [docs/upstream-service-dependencies.md](upstream-service-dependencies.md) 的分档处理：

- **A 档（运行时 env 覆盖）**：值已经集中登记在仓库根的 `.env.fusionfinlab.example`，把所有 `REPLACE_ME` 换成自己的地址后，抄进 `.env.development.local`（这个文件不入库）。
- **B 档（构建期 define）**：只在打包时生效，见打包文档。
- **C 档（硬编码）**：现在改不了，例如插件市场 CDN 与 `zcode://` 回调字面量。

两个最容易把结论搞反的机制，排障时先怀疑它们，不要先改代码：

1. **`rewriteZCodeEndpointUrl()` 只改写 origin 恰好等于 `https://zcode.z.ai` 的 URL**，所以 `cdn-zcode.z.ai`、`open.bigmodel.cn` 等不会跟着 `ZCODE_BASE_URL` 走。
2. **env 生效顺序按变量名，不按文件**。构建期读取顺序见 [packages/desktop/tsup.config.ts:29-67](../packages/desktop/tsup.config.ts#L29-L67)；runtime host 侧是 workspace 根再 desktop 根，后读的文件覆盖先读的（[packages/desktop/src/main/desktopRuntimeEnv.ts:168-213](../packages/desktop/src/main/desktopRuntimeEnv.ts#L168-L213)）。带 `_TEST_`/`_PRODUCTION_` 作用域前缀的变量排在未加作用域的名字之后。

## 6. 常见失败 → 处置

按"改一条命令 / 改一个环境 / 必须改代码"三档看，从上往下排。

| 现象 | 已确认原因 | 处置 |
| --- | --- | --- |
| 启动即报 5174 被占用 | 上一个 dev 实例的 Electron 没进同一进程组，`concurrently -k` 只杀了包装进程 | 结束残留的 Electron；`ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT=1` 只解决 9229 冲突，不解决 5174 |
| 界面叠加一层彩色框/高亮，像渲染坏了 | 是 react-scan 覆盖层，`vite dev` 默认开启（[packages/desktop/vite.config.ts:195](../packages/desktop/vite.config.ts#L195)） | `ZCODE_REACT_SCAN=0`（只认字面量 `0`） |
| Windows 报找不到 `zcode-runtime-host.exe` | 首次 dev 需要现编原生 host | 装 VS Build Tools 2022 的 C++ 工作负载；产物缓存在 `packages/desktop/bundled-tools/win32-<arch>/runtime-host`，命中后跳过重编 |
| `pnpm install` 后 node-pty 相关报错 | win32 上刻意跳过 `electron-rebuild` 以复用自带 prebuild，避免 node-gyp 走 Spectre-lib 源码编译（[packages/desktop/scripts/node-pty-rebuild.mjs:101-115](../packages/desktop/scripts/node-pty-rebuild.mjs#L101-L115)） | 确认 `node-pty/prebuilds/win32-<arch>/pty.node` 存在，不要手动 rebuild |
| Vite 内存分配失败 | 已有专项文档三种处置 | 见 [docs/migration/dev-troubleshooting.md](migration/dev-troubleshooting.md)（`NODE_OPTIONS=--max-old-space-size=4096`） |
| 改了代码没反应 | 监听在黑名单里，或改的是未纳入 watch 的包 | 见 [docs/desktop/dev-build-watch.md](desktop/dev-build-watch.md) |
| 切换分支后类型检查报 `out/*.d.ts has not been built from source` | `pre-dev` 会整体删 `out/`，切分支后标记与产物不同步 | 跑一次 `pnpm dev:desktop:test` 或 `pnpm --filter @zcode/desktop build` 让产物重新生成 |

## 7. 验证与门禁

```bash
pnpm typecheck
pnpm lint                      # React 改动必须跑，看 exhaustive-deps / rules-of-hooks
pnpm test:engineering <文件>   # 工程 Vitest
pnpm architecture:check --changed
pnpm verify:pre-push           # push 时 husky 自动执行
```

如实记录的基线状态（**本次未重跑，属上一轮实测**，别当成"通过"）：

- `pnpm lint` 当时退出码 0。
- `pnpm typecheck` 当时退出码 2：两条 TS6305（`out/app-control-navigation/main.d.ts`、`.../host.d.ts` 未从源码构建）+ 两条 TS7006 隐式 any（位于上游 v3.18.2 代码内，尚未定性是否上游真实破坏）。修法见上表"切换分支"一行，未定性的两条仍未收口。
- `pnpm fmt:check` 在本仓库基线就是大面积失败，**不能当门禁**；要格式化只对本次改动的文件手工执行，并且**永远不要对上游法律/文案文件跑格式化**（曾把 `NOTICE.md` 上游表格重排、删掉 22 行）。
- `verify:pre-push` 里的受影响测试需要一个基线覆盖：`ZCODE_AFFECTED_TEST_BASE=origin/main`。

## 8. 交接检查清单

跑完一遍，下面每项都要有明确答案（不确定的写"未验"，不写"应该没问题"）：

1. `pnpm bootstrap` 与 `check-workspace-freshness.mjs` 输出真实结果（含失败项）。
2. dev 窗口打开，且日志出现 `perf_agent_ready reported`。
3. 任务栏图标与关于窗体显示**融智坊 / FusionFinLab**，关于窗体含上游来源归属行。
4. `ZCODE_DATA_BASE_DIR` 指向非 C 盘目录，C 盘 `.zcode` 无新增写入。
5. 登录/模型请求打到 `.env.development.local` 里配置的地址（抓包或日志确认零请求打到 `*.z.ai`）。
6. 本次改动过的文件已列进 `pnpm fork:changes` 重新生成的 [docs/fork-changes.md](fork-changes.md)。
7. `pnpm typecheck` / `pnpm lint` 的真实退出码与新增失败条数。
