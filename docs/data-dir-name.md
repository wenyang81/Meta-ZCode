# 数据目录叶子名（`.zcode` → 可配置）

## 目标与决策

本 fork 的用户级数据目录是 `<数据根>/<叶子>`，叶子上游写死成 `.zcode`。它与上游正式版共用
同一个 home，带来两类真实事故：

1. **上游设置劫持本 fork 的数据根**。`<home>/.zcode/v2/setting.json` 只有一个，谁先写谁生效：
   上游 App 把 `dataBaseDir` 写进去后，本 fork 启动早期（`desktopDataBaseDirBootstrap.ts:16-18`，
   由 `desktopEarlyDataBaseDirBootstrap.ts:3` 在任何路径工具加载前调用）会照读同一个值，
   两边的会话、凭据、日志落进同一个目录树。已实测过 `meta_json 非法` 就是这种共用的后果。
2. **同机并存时无法区分谁的写入**。清理、备份、排障时看不出哪些文件属于本 fork。

决策（用户确认，2026-11-14；工作区契约名于 2026-11-17 反转为跟随品牌）：

- **叶子也品牌化**，本 fork 使用 `.dlMeta`。
- **不写死**：值由变量提供，默认值保持 `.zcode`，不注入时与上游行为完全一致。
- **不做数据迁移**：改名后从空目录开始，存量 `.zcode` 数据不搬、不合并、不兼容。
- **给人看的文字按解析结果插值**：语言包与发给模型的英文提示词里描述真实运行位置的
  `~/.zcode/...` 一律由 `DATA_DIR_NAME`/`WORKSPACE_CONFIG_DIR_NAME` 拼出——叶子默认值改为
  `.dlMeta` 后，这些文字描述的位置事实变了，保留上游写法会变成错误文档。
- **工作区契约目录也改名 `.dlMeta`（2026-11-17，用户确认「彻底改名」）**：
  `<workspace>/.dlMeta/{config.json,skills,commands,agents,workflows,plans,workflow-runs…}`，
  全部走 `WORKSPACE_CONFIG_DIR_NAME` 常量引用，不再保留字面量。上游正式版继续读写
  `<workspace>/.zcode`，两个工具打开同一项目时项目级配置各一份、不再互通（跨工具共享契约就此切断）。

这与 [品牌身份 spec](brand-identity.md) 里「`.zcode` 数据目录名不改」的原边界相反，该文档已改为
指向本文；理由变化是：原来按「40+ 处硬编码」估算，实测是 **7 个路径权威、约 85 个生产源文件**，
数量可控且全部有明确注入点，同时不迁移策略消除了改名最大的风险项。

收口后的真实量级（2026-11-14 全仓扫描；2026-11-17 工作区契约改名后复核）：
权威层的写死点已全部换成常量，`pnpm data-dir:check` 报 **0 处非例外命中 + 13 个例外文件**。
剩余例外只有三类：上游时期落盘的协议遗留取值、刻意读取上游目录的兼容代码、
不随品牌包分发的工程脚本。

## 唯一所有者：`@zcode/shared` 的 `dataDirName`

`packages/shared/src/dataDirName.ts` 导出六个符号：

| 符号                        | 语义                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `DLMETA_DATA_DIR_NAME_ENV`   | 注入用的环境变量名 `DLMETA_DATA_DIR_NAME`；业务代码不得自行读环境变量                     |
| `DLMETA_DATA_BASE_DIR_ENV`   | 数据根覆盖变量名 `DLMETA_DATA_BASE_DIR`（上游同义变量 `ZCODE_DATA_BASE_DIR`，fork 不再读取）；「隔离开发态」判定也用它 |
| `DLMETA_DESKTOP_USER_DATA_DIR_ENV` | Electron userData 目录覆盖变量名 `DLMETA_DESKTOP_USER_DATA_DIR`（上游同义 `ZCODE_DESKTOP_USER_DATA_DIR`） |
| `DEFAULT_DATA_DIR_NAME`     | 未注入任何覆盖时的回落值 `.dlMeta`（2026-11-17 起）：dev 不设变量、打包漏配变量都落品牌叶子，与同机上游 `.zcode` 天然隔离                                      |
| `WORKSPACE_CONFIG_DIR_NAME` | 项目目录内的点目录名，2026-11-17 起为 `.dlMeta`（跟随品牌），见下一节                       |
| `normalizeDataDirName()`    | 校验并裁剪单值；空/全空白 → `null`（交调用方回落），非法 → 直接抛错                      |
| `resolveDataDirName()`      | `env` 参数化解析；`env` 缺省读 `process.env`，浏览器端没有 `process` 时返回默认值        |
| `DATA_DIR_NAME`             | 模块加载期捕获一次的解析结果，**改造调用点时用它**，不要把 `resolveDataDirName()` 散着调 |

绝大多数调用点只需要 `DATA_DIR_NAME` 与 `WORKSPACE_CONFIG_DIR_NAME` 两个常量；
`resolveDataDirName()` 是 owner 内部与测试用的解析入口，注入点（desktop main 的 define→env 解析）
才显式再调一次。这样「一个进程只认一个叶子」由模块系统保证，而不是靠每个权威自律。

### 两个同名不同义的 `.zcode`

改造中最容易搞坏的一条：仓库里有**两类**点目录都叫 `.zcode`，只有一类是数据根叶子。

| 类别           | 形状                                                   | 例子                                                                                                                                         | 处理                                                                |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 用户级数据叶子 | `<home 或 dataBaseDir>/.zcode/{v2,cli,workspace,…}`    | `paths.ts:47`、`setting/settingService.ts:255`、`hooks/hooksService.ts:74` 的 else 分支                                                      | 走 `DATA_DIR_NAME`，可品牌化                                        |
| 工作区项目目录 | `<workspacePath>/.zcode/{config.json,skills,commands}` | `hooks/hooksService.ts:337`、`settings-sync/settingsSyncService.ts:416,424`、`mcp-sync/mcpSyncService.ts:44` 的 `workspaceConfigDirSegments` | 语义上走 `WORKSPACE_CONFIG_DIR_NAME`（固定 `.zcode`）；写法见下一段 |

判据不是行号也不是文件名，而是**调用方拼的是 home/dataBaseDir 还是 workspacePath**；
`commandsService.ts:56-57` 那种 `userDirectorySegments` / `workspaceDirectorySegments` 成对命名
就是这条分界在代码里的显式表达。工作区级目录随 git 仓库走，是跨工具共享的项目契约，
上游正式版和本 fork 打开同一个项目必须读到同一份 skills/commands/hooks 配置，所以不改名。
落到具体写法上：**只有当同一段代码已经在用户叶子与工作区契约之间分派时才换成两个常量**
（`commands/roots.ts`、`skills/roots.ts` 的 `scope === "user" ? DATA_DIR_NAME : WORKSPACE_CONFIG_DIR_NAME`，
`ui/src/lib/skillSourceFilter.ts` 的两个目录名并列匹配）；纯工作区点（`saved-workflow.ts` 的
`SAVED_WORKFLOW_PROJECT_DIR`、`plugins.ts` 的 `<workspace>/.zcode/config.json` 判定等）保留字面量，
进例外清单，不改上游行。

同族但**不是目录**的名字同样不动：`.zcode-plugin`、`.zcode-share`、`.zcode-carry-*.patch`
（`git/managed-worktree/gitWorktreeRepo.ts:62-63`）、`.zcode-sync-preflight-*`
（`remote-sync/remoteSyncWriteAccess.ts:9`）、`.zcode-install-manifest`。它们都以 `.zcode-` 开头，
门禁的模式（叶子后面必须紧跟 `/` 或字符串结束）天然不会误伤。

为什么不放 `packages/biz-brand`：`biz-brand` 是 domain 层品牌事实（名称、appId、图形母版），
按规格不做 IO、不持文件系统语义；而读这个值的层从 Electron 主进程一直分布到独立 CLI 与远端
server CLI，`@zcode/shared` 是这七方**都**已经依赖的公共层（`apps/zcode-cli/packages/adapters`
的 `package.json` 就把 `@zcode/shared` 列为依赖并在用）。图形归品牌包，路径归 shared。

约束：该文件不得 import `node:*`——它经 `packages/shared/src/index.ts` 暴露给浏览器端 bundle。
回归测试 `packages/shared/test/dataDirName.test.ts`（已登记进
`scripts/engineering-test-files.json`，用 `pnpm test:engineering packages/shared/test/dataDirName.test.ts` 跑）。

### 取值形状

`^[.A-Za-z0-9_-]+$`，且不能是 `.` 或 `..`。允许前导点（数据目录是隐藏目录），禁止路径分隔符、
空格、非 ASCII。理由：这个值会被拼进 shell 包装脚本、NSIS 字符串和 SQLite `GLOB` 模式，
带空格或非 ASCII 的目录名在下游只能靠转义兜底；**宁可启动即抛错，也不在下游加分支**。

非法值抛错而不是回落默认值：静默回落会让「以为隔离了、其实没有」变成最难查的一类现场。

## 注入与传播

解析优先级是一条轴——运行时环境变量优先，构建期 define 只服务桌面包自带品牌值，
最后才落到 owner 的默认值：

```
所有进程：process.env[DLMETA_DATA_DIR_NAME_ENV]
桌面 bundle（main / host / renderer）额外回退：__ZCODE_DATA_DIR_NAME__
          （由 packages/desktop/tsup.config.ts 的 createSharedDefines 与 vite.config.ts 的 define
            从 DLMETA_DATA_DIR_NAME 构建期取值写入；未配置时是空串，normalize 后交默认值）
两者都没有 → DEFAULT_DATA_DIR_NAME（`.dlMeta`，2026-11-17 起与上游 `.zcode` 天然隔离）
```

未打包的 dev / CLI / server 运行环境拿不到 define（`typeof __ZCODE_DATA_DIR_NAME__ === "undefined"`
分支兜住），因此它们只认 env，语义仍然是同一条优先级轴。

关键规则：**同一个进程内解析一次，跨进程由主进程显式下发**。

- `resolveDataDirName()` 每次调用都读 env，不做进程内缓存，所以 owner 自己导出
  `DATA_DIR_NAME = resolveDataDirName()` 作为模块加载期的唯一捕获点；各权威 import 这个常量，
  不在自己模块里再调 `resolveDataDirName()`。中途改 env 不会生效，这是刻意的——
  `paths.ts:12-15` 的数据根同样是启动期一次性捕获，两套路径各自漂移比直接报错更糟。
- 主进程解析完的值，按现有 `DLMETA_DATA_BASE_DIR` / `ZCODE_HOME` 的可信注入范式写进 host 与
  agent 子进程 env：`desktopRuntimeEnv.ts` 的 `buildHostProcessEnv` 返回值里显式带
  `[DLMETA_DATA_DIR_NAME_ENV]: DATA_DIR_NAME`（与 `DLMETA_DATA_BASE_DIR` 同一处）。
  子进程不靠自己继承的外部环境决定叶子名，否则任何一个 spawn 路径漏传就会让一半数据落
  `.zcode`、一半落 `.dlMeta`。
- 远端链路同理，不能指望 SSH/WSL/Docker 起的进程继承桌面 env：
  `packages/server/src/remote/connect.ts` 的 `buildRemoteServerCommand` 在命令前缀里显式导出
  `DLMETA_DATA_DIR_NAME`，同时 `deployShared.ts` 的 `REMOTE_BASE`、`sourceServerProbe.ts` /
  `transportAdapter.ts` 的 shell 路径、`zcodeAgentBundleWrapper.ts` 写死的 wrapper 脚本全部由
  `DATA_DIR_NAME` 拼出，保证「provisioning 写到哪」与「远端进程自己解析到哪」是同一个值。
- 三个进程的解析结果各有一条启动 info 日志，用于现场对照（验收场景 2）：
  main 是 `index.ts` 的 `[startup] 数据目录叶子名解析结果`，host 是 `host/index.ts` 在
  `initializing local services` 后紧接的 `host data directory leaf resolved`，两条都同时打
  `dataDirName` 与解析后的 `dataRootDir`；agent 是 `zcode-protocol-entrypoint.ts` 在拿到
  `createConfig()` 结果后打的 `agent data directory leaf resolved`，落盘位置与 main/host 不同，
  在 agent 自己的日志文件里（`<home>/<叶子>/cli/log/zcode-*.jsonl`，见权威 6「CLI 不认数据根」）。
- `DLMETA_DATA_DIR_NAME` 不在 `shouldSanitizeZCodeRuntimeEnvKey` 黑名单里，因此默认能穿过
  main→host 的 env 规整；但**不能依赖这个默认**，显式注入才是契约，默认只是顺带。
- 该变量属于运行时路径事实，不属于工具 env：不得进 `ZCODE_TOOL_ENV_PASSTHROUGH` 集合，
  即用户 shell/MCP 工具看不到它，也不能用它改写 agent 子进程的数据根。

### 改造后顺带修掉的劫持

叶子换名后，bootstrap 读的是 `<home>/.dlMeta/v2/setting.json`。上游写的
`<home>/.zcode/v2/setting.json` 不再被本 fork 读取，第 1 节第 1 条劫持路径自动断开。
代价见「不迁移」一节。

## 七类权威与注入点

下表是改造清单。「其他拼写」列的写法**不**被 `".zcode"` 精确匹配覆盖，门禁必须同时匹配，
否则改完仍会留半截硬编码。

| #   | 权威层                     | 代表位置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 说明 / 其他拼写                                                                                                                                                                                                          |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | services 路径主收口        | `packages/services/src/paths.ts:47,74,254,263-264`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `:47` 是 `getZCodeDataRootDir()`，绝大多数调用点经过它；`:254` 的回落分支、`:263-264` 的数据目录迁移复制要一起改                                                                                                         |
| 2   | services 未走 paths 的散点 | `settings-sync/settingsSyncService.ts`（9 处）、`skills/skillsService.ts`、`hooks/hooksService.ts`、`commands/commandsService.ts`、`mcp-sync`、`plugin-sync`、`skill-sync`、`data-sync/*`、`subagents/*`、`telemetry/telemetryCore.ts`、`node.ts:1214`、`feedback/compactLogArchive.ts`、`onboarding/localUsageEvidence.ts`、`zcode-agent/modelTrajectoryFileTail.ts`、`session/sourceServerWorkspaceAliasRepo.ts`、`runtime-tools/providerRuntimeResolver.ts`                                                                                                                                     | 各自 `join(home, ".zcode", …)`，约 25 个文件。另有 SQL 模式串：`project-storage/default-workspace/migration.ts:12` 与 `project-storage/migrate-projects.ts:149` 的 `GLOB '*/.zcode/workspace/…'` 必须由叶子拼出          |
| 3   | services 重复常量          | `storage/adapters/rootsResolver.ts:9`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `export const ZCODE_DATA_DIR_NAME = ".zcode"` 与 owner 重名不同义，删除后从 `@zcode/shared` 取解析结果；该文件已声明「模块内不读环境变量」，注入点由调用方给出                                                           |
| 4   | shared 内其他持有者        | `managed-worktree/layout.ts:7`、`zcode-agent-runtime.ts:32`（`nativeConfigDir: ".zcode/cli"`）、`workspace-hook-config.ts:181,239,249`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | owner 与它们同包，直接引用。`nativeConfigDir` 是「叶子 + 子段」拼写，门禁的 `.zcode/` 前缀规则就是为它加的                                                                                                               |
| 5   | desktop main / host        | `main/desktopDataBaseDirBootstrap.ts:17`、`main/desktopRuntimeEnv.ts:534`、`main/index.ts`、`main/desktopHostProcess.ts`、`main/desktopChromiumHardwareAccelerationBootstrap.ts`、`main/desktopApplicationLocaleBootstrap.ts`、`main/mcpUserDirectory/{index,types}.ts`、`host/sourceServerDirectory.ts`、`host/remotePromptAttachments.ts:6-7`、`main/exportLogs.ts`（含 `:1061` 的 `startsWith(".zcode/cli/log/")` 与多处注释里的展示路径）                                                                                                                                                      | `exportLogs.ts` 一个文件 7 处精确匹配、注释另计。压缩包内相对路径判断（`startsWith`）必须与写侧同源，否则日志导出静默漏收                                                                                                |
| 6   | agent CLI（独立仓中仓）    | `packages/adapters/src/storage/session-store/paths.ts:5`、`config/file-config.adapter.ts`、`context/index.ts`、`auth/shared-credentials.ts`、`device/cli-device-mid.ts`、`logging/index.ts`、`skills/roots.ts`、`commands/roots.ts`、`memory-diagnostics`、`workflow/index.ts`、`exec/execution-utils.ts`；`packages/core/src/memory/memory-file-path.ts`、`subagent/persistent-memory.ts`、`runtime/helpers/plan-file-continuity.ts`；`packages/bootstrap/src/{plugins,subagents}.ts`、`app/script-workflow-*`；`packages/cli/src/provider-runtime-env.ts`、`packages/telemetry/src/bootstrap.ts` | CLI **完全独立解析**，`session-store/paths.ts:5` 直接 `join(homedir(), ".zcode", "cli", …)`，连 `DLMETA_DATA_BASE_DIR` 都不认。改造时统一走注入进来的 `DLMETA_DATA_DIR_NAME`；是否顺带让它认数据根属另一议题，本文不扩范围 |
| 7   | 远端 server CLI            | `packages/zcode-server-cli/src/runtime/paths.ts:30,91,153`、`runtime/releaseManager.ts`、`cli.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 远程 workspace 侧的数据根同样要跟着叶子，否则手机远控读到的目录与桌面写入的不一致。`:91` 是 `basename(...) === ".zcode"` 的反向判定，属于必须同步的拼写                                                                  |

打包侧不在该表内，但边界已经确认过：`packages/desktop/build/installer.nsh` 只操作 `$INSTDIR`
（安装目录 + 它自己写的 `.zcode-install-manifest`），卸载分支从不碰用户数据叶子，所以安装器不需要
知道叶子名；品牌化真正依赖的是构建期 define（`tsup.config.ts` 里 main 走 `createMainDefines`、preload / host /
scheduler / extension-host 走 `createSharedDefines`，两者都带同一个叶子；`vite.config.ts define`
覆盖 renderer），
`scripts/zcode-distribution/installer.mjs` 的 `INSTALL_DIR` 则改成跟 `DLMETA_DATA_DIR_NAME` 走、
未设置时回落 `.zcode`，避免独立发行安装把 runtime 装进上游叶子。

### 落地状态（2026-11-14）

- 权威 1-4（services 路径主收口、散点、`rootsResolver` 重复常量、shared 内其他持有者）：已收口。
- 权威 5（desktop main / host）：已收口，含 `exportLogs.ts` 的压缩包相对路径判断与
  `mcpUserDirectory` 的用户分支；`types.ts` 那条是死路径，进例外清单。
- 权威 6（agent CLI）：已收口。`packages/telemetry` 原本不依赖 `@zcode/shared`，为设备中台状态文件
  补了这条 workspace 依赖（`@zcode/contracts` 已经这么依赖 shared，方向不新鲜）。
- **工作区契约目录改名（2026-11-17，用户确认「彻底改名 .dlMeta」）**：
  产品运行期约 20 个文件的 `<workspace>/.zcode` 字面量全部换成 `WORKSPACE_CONFIG_DIR_NAME`
  （含此前「不为此加依赖」的 `dynamic-workflow-runtime`、`office-runtime`——补了
  `@zcode/shared` workspace 依赖，用 `@zcode/shared/dataDirName` 子路径导入避免把 shared
  全图拖进 tsc emit 编译）；发给模型的英文提示词与工具描述改为按常量插值；
  en/ja/ko/ru 语言包里描述运行位置的字符串同样改为插值（描述的事实变了，保留上游写法=错误文档）；
  dev-docs、E2E 夹具（`wdio.conf.ts`）、UAT 夹具、测试夹具同步改名。
  `contracts` 快照 schema 与 shared 的 kind 类型保留 `".zcode/config.json"` 作为
  上游时期落盘记录的遗留解析取值；`memory-file-path.ts` 敏感段黑名单同时挡
  `.zcode`（存量磁盘目录）与 `.dlMeta`。例外清单从 41 个文件收敛到 13 个。
  代价：两个工具打开同一项目时项目级 skills/commands/hooks/config 各一份、不再互通。
- 权威 7（远端）：`packages/zcode-server-cli` 三处 + `packages/server` 的 provisioning shell
  全部由 `DATA_DIR_NAME` 拼出，`buildRemoteServerCommand` 显式导出 `DLMETA_DATA_DIR_NAME`。
- 打包侧：define 已接（见上一节），`scripts/zcode-distribution/installer.mjs` 的 runtime 目录改随
  `DLMETA_DATA_DIR_NAME`；安装器卸载分支确认与用户数据叶子无关，无需改。
- 门禁：`pnpm data-dir:check` 已接进 `verify:pre-push`（排在 `lint` 之后）。
- 验收场景 2 实测（2026-11-15，`dev:desktop:test` + `DLMETA_DATA_BASE_DIR=F:\tools\zcode-dev-data`
  + `ZCODE_DATA_DIR_NAME=.dlMeta`）：main / host / agent 三条启动日志解析出的叶子都是 `.dlMeta`，
  main 与 host 的 `dataRootDir` 指向 `F:\tools\zcode-dev-data\.dlMeta`，agent 的 `storageRoot`
  是 `~/.dlMeta`（即权威 6 记的「CLI 只认 homedir，不认 `DLMETA_DATA_BASE_DIR`」缺口）；
  数据写进 `.dlMeta/v2`（tasks-index、provider_config、telemetry-state、workspace、logs 全在里），
  同根的 `.zcode` 16 个文件零新增，整份启动日志里不出现任何 `.zcode` 路径。

## 明确不改

| 项                                                              | 位置示例                                                                                                                                | 理由                                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.zcode-plugin` / `.zcode-share` / `.zcode-share-import(.json)` | `services/src/commands/commandsService.ts:50`、`skills/skillsService.ts:48`、`conversation-share/conversationShareService.ts:1514,2372` | 它们是**插件清单文件名**与**工作区内的分享标记**，不是用户数据目录叶子，改了会让插件与分享包解析失败                                       |
| 项目内的 `<workspace>/.zcode/config.json`                       | contracts 快照 schema 的遗留枚举值 `".zcode/config.json"`（`workspace-hook-trust.ts`）、敏感段黑名单 `memory-file-path.ts`（磁盘上存量上游工作区目录仍要挡） | 2026-11-17 起工作区契约目录已改为 `.dlMeta` 并全量走 `WORKSPACE_CONFIG_DIR_NAME`；仅上述两处为兼容存量磁盘/落盘记录保留字面量                    |
| `.zcode-install-manifest`                                       | `build/installer.nsh:29`                                                                                                                | 安装器自己的清单文件，与上游安装/卸载检测逻辑同生死，属打包边界                                                                            |
| `.zcode-beta` / `.zcode-runtime` 等其它点开头名字               | 见 `docs/` 与脚本内的 macOS dev runtime 路径                                                                                            | 不同的名字，不是同一个叶子；门禁只匹配「`.zcode` 后面直接是 `/` 或字符串结束」                                                             |
| `ZCODE_HOME` 的**变量名**与 `DLMETA_DATA_BASE_DIR` 的**变量名**  | `desktopRuntimeEnv.ts:534`、`paths.ts:14`                                                                                               | 换的是值不是键；键名属 `ZCODE_*` 前缀边界（见 brand-identity 不改清单）                                                                    |
| UI 展示串与 i18n 文案里的 `~/.zcode/...`                        | 五个语言包 + 工具描述/斜杠帮助/builtin-prompt 全部改为按 `DATA_DIR_NAME`/`WORKSPACE_CONFIG_DIR_NAME` 插值（2026-11-17）；`.zcodeignore` 这类**同名前缀但不同义**的文件名不动 | 叶子默认值变成 `.dlMeta` 后这些文字描述的位置事实变了，必须跟着常量走；`.zcodeignore` 是独立的功能文件名，非目录叶子                          |
| 上游既有数据的读取兼容                                          | —                                                                                                                                       | 已决定不迁移，因此不保留「先读 `.dlMeta` 读不到再回落 `.zcode`」的双读路径；加了就是第二条写入路径，违反单一所有者                         |

## 门禁

`scripts/check-data-dir-literal.mjs`（根脚本 `pnpm data-dir:check`，已接进 `verify:pre-push`；
七类权威收口后才接，接早了会把同步中的 push 全部卡死）：

- 扫描范围：仓库内 `.ts/.tsx/.mjs`，排除 `/dist/`、`/out/`、`/node_modules/`、`/test/`、
  `/tests/`、`/__tests__/`、`/e2e/`、`/__mocks__/`、`/fixtures`、`*.test.*`、`*.spec.*`、`*.d.ts`。
  整行注释与行内注释（含 JSDoc 续行）不参与匹配，注释里的示例路径不算违规。
- 命中模式：叶子必须独占一个完整路径段——前面是 `~`、`/`、引号、反引号或行首，后面是 `/`、
  引号、反引号、空白或行尾。这样 `.zcode-plugin`、`.zcode-share`、`.zcode-install-manifest`、
  `engines.zcode`、`com.zcode/official-mcp-auth` 天然不命中。
- 白名单（硬编码在脚本里）：只有 `packages/shared/src/dataDirName.ts`，即默认值所有者本人。
- 例外清单：`scripts/data-dir-literal-exceptions.json`，按文件整份豁免，每条必须写 `reason`。
  门禁额外校验三件事，防止清单退化成无人认领的垃圾场：理由不能为空、path 指向的文件必须存在、
  全仓扫描时清单里**已无命中**的条目算过期并报错（分批按目录扫描时跳过该判定，避免误报）。
  能改成常量的生产路径不允许进清单；清单只覆盖四类：工作区契约名、英文提示词与非中文文案、
  刻意读取上游目录的兼容代码、不随品牌包分发的工程脚本。
- 测试与 e2e 不进门禁：它们要固定可预测路径，允许显式用 `DEFAULT_DATA_DIR_NAME` 或自建临时目录。
- 用法：`node scripts/check-data-dir-literal.mjs` 全仓；带目录参数按批扫描
  （`node scripts/check-data-dir-literal.mjs packages/shared packages/services`）。

## 验收场景

1. **不注入时零行为变化（2026-11-17 起语义更新）**：不设变量、不带 define 启动 → 用户级数据根为
   `<home>/.dlMeta`（默认值已随品牌），与同机上游 `.zcode` 隔离。工作区契约目录为
   `<workspace>/.dlMeta`，上游打开同一项目读写 `<workspace>/.zcode`，两者互不感知。
2. **dev 隔离生效**：启动 dev 后，主进程、host、agent 三个进程各自
   在 info 日志里打出一条包含解析结果的启动行，三处一致；数据写进
   `$DLMETA_DATA_BASE_DIR/.dlMeta/v2`，`$DLMETA_DATA_BASE_DIR/.zcode` 不产生新文件。
3. **bootstrap 劫持断开**：本机存在上游写的 `<home>/.zcode/v2/setting.json` 时，本 fork 不再读取它；
   `<home>/.dlMeta/v2/setting.json` 首次不存在 → 走 env / 默认数据根，而不是继承上游的 `dataBaseDir`。
4. **非法值启动即失败**：`ZCODE_DATA_DIR_NAME=a/b`、`..`、`my dir`、`融智坊` 四种取值，进程必须在
   任何磁盘写入前抛错退出，错误信息包含变量名与非法值。
5. **打包态不依赖用户环境**：define 注入的品牌包在干净机器上启动即使用 `.dlMeta`；
   用户机器上遗留的 `DLMETA_DATA_DIR_NAME` 只会覆盖，不会造成部分进程用旧值。
6. `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` /
   `pnpm test:engineering packages/shared/test/dataDirName.test.ts` / `pnpm data-dir:check` 通过，
   并如实记录基线已有失败。
7. 远端链路：手机远控连桌面时，远程 workspace 与 server CLI 解析出的叶子与桌面一致
   （权威 7），日志目录判断（`exportLogs.ts:1061`）在品牌包上仍能收全 `.dlMeta/cli/log` 下的文件。

## 不迁移的现实后果（必须让用户知道）

- 首次以品牌叶子启动等于全新安装：历史会话、凭据、技能、插件同步状态、日志全部看不到。
- 用户在设置里改过的数据根（`dataBaseDir`）存在旧 `<home>/.zcode/v2/setting.json` 里，改名后需要重新指定。
- 卸载时的「保留用户数据」检测只看新叶子，旧 `.zcode` 目录需要用户自己处置；本 fork 不代为删除，
  因为它可能正被同机的上游正式版使用。
- 回退（去掉变量）即恢复原路径，旧数据仍在原地，不会因改造损坏。

## Fork 环境变量命名空间（2026-11-17 增补）

三个 fork 注入变量统一收进 `DLMETA_` 前缀，与上游/同机其他 ZCode 系产品的
`ZCODE_*` 变量互不读取、互不覆盖：

| fork 变量 | 上游同义变量 | 唯一定义 |
| --- | --- | --- |
| `DLMETA_DATA_DIR_NAME` | （上游无此机制） | `DLMETA_DATA_DIR_NAME_ENV` |
| `DLMETA_DATA_BASE_DIR` | `ZCODE_DATA_BASE_DIR` | `DLMETA_DATA_BASE_DIR_ENV` |
| `DLMETA_DESKTOP_USER_DATA_DIR` | `ZCODE_DESKTOP_USER_DATA_DIR` | `DLMETA_DESKTOP_USER_DATA_DIR_ENV` |

名字的单一来源都在 `packages/shared/src/dataDirName.ts`（`@zcode/shared/dataDirName`
子路径导出），代码/测试/构建脚本一律 import 常量；无法 import 的两处——
`mise.toml` 的 dev 任务与 `scripts/zcode-distribution/installer.mjs` 的 shell 模板——
写字面量并注明「改名时与 dataDirName.ts 同步」。fork 不再读取上游同义变量；
历史文档（working-memory、上游 MR 记录等）保留旧名不改，属历史记录。
