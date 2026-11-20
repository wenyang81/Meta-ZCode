# Codegraph 符号索引规范（融智坊）

> 状态：**P1 已实现并自验（工作区未提交）**，验收记录见 §7「P1 验收记录」，收益对照停在
> 附录 A.3（headless 发不出模型）；P2 只有设计参考，未开工（2026-11-19 与用户对齐方案后落稿）。
> 上游同步注意：本文描述的能力整体为 fork 改动；`packages/biz-codegraph` 为独立新包，
> 原生层只留注册薄壳，合并冲突面以此为准。
> 关联：[上游同步规范](upstream-sync.md)、架构检查（`architecture-policy.yaml`）。

## 1. 背景与目标

当前 Agent 理解项目只有 `read / glob / grep / bash` 原始文本扫描：Explore 子代理反复
`list/read` 遍历目录，符号级问题（谁引用这个函数、某模块的导出面、跨文件依赖）靠模型
拼 grep 猜测，工具调用次数和 token 消耗都高。

本能力为目标：**符号依赖被持久索引，Agent 查图不扫目录**。

- 索引内容：文件 → 符号表（导出/声明）、跨文件引用边、包/模块归属（与
  `architecture-policy.yaml` 的模块边界对齐）。
- 消费方：Agent 通过只读工具查询结构化结果，拿到 `文件:行号` 后定点 `Read`；
  Repo Wiki 生成是同管线的派生产物（P2），给模型用的一直是工具查询而非整篇文档。
- 语言范围：P1 只做 TS/TSX/MTS/CTS（ts-morph）；非 TS 语言（YAML/SQL/shell 等）
  tree-sitter 兜底放 P3，降级策略届时另行决策。

## 2. 方案分层与决策记录

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 查询形态 | **ZCode 原生工具（进程内调库）**，MCP 暂缓 | 原生层有现成的权限收敛（`path-policy`）、合同测试（`tool-contracts.test.ts`）与免审批元数据；MCP 的价值全在跨 host 互操作，只服务 ZCode 时是纯成本。库与 SQLite 是稳定接缝，将来加 MCP 壳包同一库即可，不预付 |
| 索引构建 | **CLI 子命令**（`zcode codegraph rebuild / stats`） | 人和脚本都能触发；可挂进 pre-push 门禁 |
| 常驻 watcher | **不做**。查询时按需 ensure + CLI 手动 rebuild | 桌面端后台 watcher 的生命周期与资源占用复杂度高，先不背；索引新鲜度靠查询时校验兜底 |
| 核心逻辑归属 | `packages/biz-codegraph` 纯库（indexer + query API） | fork 约定：业务进独立包不侵入原生底层；原生层只留薄注册壳，控制上游合并冲突面 |
| Repo Wiki | P2，同一索引派生，增量按索引 diff 重建 | 图喂模型、文档给人看，来源必须同一条抽取管线，避免两套真相 |
| 边抽取两层化（P1 实现期决策，2026-11-19 实测回填） | 符号表用裸 TypeScript 逐文件 parse，全仓 8458 文件 rebuild 实测 **219s**；符号级精确边在**查询时对该符号懒算**（文本预筛候选 + 小 program findReferences），持久缓存进 `edge_coverage`，同一符号只算一次 | 实测：常驻 ts-morph Project 装全仓 OOM；全量 findReferences 超 10 分钟。本仓首个符号查询 **28.6s**（一次性），同一符号缓存后 **2.4s**（其中 ensure 的 stat 比对约 2s）——持久索引保证的正是"只算一次"。首版曾按 ~2ms/文件推算出 40s，实测慢 5 倍，差在磁盘 IO 与 tsconfig 解析，不改结论只改预算 |

## 3. 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 事实源 | 工作区文件系统 | 索引永远是派生物，不改写任何源文件 |
| 索引库 | SQLite 文件，`packages/biz-codegraph` 独占读写 | 三张表：`files`（路径、mtime、hash）、`symbols`、`edges`；查询端只读 |
| 索引生命周期 | CLI（全量 rebuild）/ 查询时 ensure（增量） | 增量以 `mtime + hash` 为键，只重解析变更文件 |
| 工具注册 | `apps/zcode-cli/packages/core/src/tool/registry.ts` + `handlers/` | 薄壳：new ToolEntry，handler 转调 biz-codegraph 库 |
| 索引文件位置 | `<workspace>/<契约目录>/codegraph/index.sqlite`（现为 `.dlMeta`） | P1 实现按**工作区目录**隔离：索引跟着仓库走，clone/搬运即带索引，门禁与 `gitignore` 只管一个叶子。`workspaceIdentity` 仍用于请求关联与日志；它不作为索引键——身份值会随项目改名/虚拟项目变化，把派生物绑上去等于每次换 key 都要重跑 219s 全量重建。若后续出现「同一目录多身份」的真实场景需要隔离，再登记独立叶子，不在 P1 预付 |

## 4. 接口定义

### 4.1 运行时工具（P1）

两个只读工具，`ToolEntry` 元数据统一：
`readOnly: true, destructive: false, needsApproval: false, sideEffectScope: "none", riskLevel: "low", concurrentSafe: true`——与 Grep 同级，自动放行，不产生审批摩擦。

**`CodegraphQuery`** —— 符号级问答：

- 入参：`{ symbol?: string; filePath?: string; direction?: "inbound" | "outbound" | "both"; limit?: number }`。`symbol` 与 `filePath` 至少给一个（handler 校验，不进 schema 以免各家 provider 对交叉约束的实现不一致）。
- **`direction` 的实际覆盖面（P1 收口，2026-11-19）**：`inbound` 是符号级能力——被查符号的导出点 + 谁引用它，未算过时当场懒算并持久缓存。`outbound` **只有文件级**：它返回「该文件作为引用方」的缓存边，这些边是别的符号算 inbound 时顺带产出的，所以对新查询常为空；符号级 outbound（某函数体引用了谁）P1 不算，工具在这种情况下返回明确的失败提示而不是空结果——空结果会被模型读成「没有依赖」，而事实是「这个方向工具答不了」。文件的真实 import 依赖面归 P2 的 `CodegraphModules`（import 清单入库后它才能给出完整的方向性依赖）。
- 出参：符号声明位置（`文件:行号`）、引用边列表（含引用方位置与所属包）、该文件的导出面。
- 输出为 JSON，含 `stale: boolean` 与逐条 `staleReason`（见 §5）。

**`CodegraphModules`** —— 模块边界视图（`architecture:context` 的机器可查版）：

- 入参（草案）：`{ filePath?: string; module?: string }`。
- 出参：模块归属、模块间依赖方向、对 `architecture-policy.yaml` 边界的符合性标记。

### 4.2 CLI 子命令（P1）

```
zcode codegraph rebuild [--workspace <path>]   # 全量重建（覆盖式）
zcode codegraph stats   [--workspace <path>]   # 文件/符号/边计数、上次构建时间、stale 比例
```

### 4.3 工具描述即路由规则

两个工具的模型侧 `description` 必须写明分工：**符号级问题（谁引用/导出面/模块边界/
跨文件依赖）先查 codegraph，全文文本搜索与未索引语言仍用 Grep**；返回 stale 时改用
Grep/Read 复核。模型选不选用工具，九成取决于这段描述——它属于本 spec 的验收面，
不是实现附属品。

## 5. 不变量（硬约束）

1. **stale 校验**：任何查询返回前，对结果涉及的文件校验 `mtime + hash`；不一致的条目
   标记 `stale` 并说明原因，**禁止静默返回旧图**。索引缺失/整体过期时返回明确提示，
   引导模型改用 Grep，而不是给半旧数据或抛错。
2. **workspace 身份键**：索引库按工作区目录隔离（见 §3「索引文件位置」），运行时工具
   一律以 `context.workspaceRoot` 为根，`filePath` 只当**索引键**用（相对路径归一后进
   store 查询），不拿它做文件访问，因此越界路径只会查不到，不会读到仓库外的东西；
   CLI 侧才接受 `--workspace` 显式指定目录。请求关联与日志继续传递 `workspaceIdentity`。
3. **只读边界**：运行时工具不写任何文件；路径处理复用现有 `path-policy` /
   `path-normalization`，不绕过权限体系；写索引只发生在 CLI 与查询时 ensure 的
   biz-codegraph 内部路径。
4. **无第二写入路径**：SQLite 仅由 biz-codegraph 写；UI、Main、Renderer 不直接触碰。
5. **薄壳纪律**：`apps/zcode-cli/packages/core` 内每个文件只做注册与转调（每个几十行），
   解析、存储、查询逻辑全部在 `packages/biz-codegraph`。

## 6. 现有文件改造清单（全部为注册性质增量）

| 位置 | 改动 |
| --- | --- |
| `core/src/tool/handlers/index.ts`（`builtInTools`） | 注册 `codegraphQueryToolEntry`（`CodegraphModules` 留到 P2，不留空壳） |
| `core/src/tool/provider-visible-order.ts` | `CodegraphQuery` 排在 `Bash` 之后（搜索族聚拢） |
| `core/src/tool/scheduler.ts`（`READ_ONLY_TOOLS`）、`core/src/permission/service.ts`（`isReadOnlyTool`） | 登记为只读工具 → 默认权限模式下免审批 |
| `apps/zcode-cli/packages/contracts/src/tools/codegraph-query.ts` + `tools/index.ts` | 工具的入参/出参 schema 与调用/结果类型。**实现落点与规划不同**：原生工具的类型全部住在 `@zcode/contracts`（对照 `grep.ts`），`packages/shared/src/zcode-protocol` 是桌面进程间协议，本工具不跨该边界，故不改它 |
| `packages/shared/src/tool-identity.ts` | **P1 不改**（原清单列了它）：它服务桌面 UI 的工具身份展示，§8 已把 UI 排除在 P1 之外，先例是同样只注册到 CLI 的 `ListModels`。要做 UI 展示时再登记 |
| CLI 命令注册 | `run.ts` 加 `codegraph` 分支 → `cli/src/codegraph-command.ts` 薄壳；`arguments.ts` 新增 `--workspace`（不复用 `--cwd`：语义是索引归属目录，不是命令 cwd） |
| `packages/i18n`（en-US / zh-CN） | 帮助命令清单加一行 `codegraph` |
| 数据目录品牌契约 | 索引库叶子 `<workspace>/.dlMeta/codegraph/index.sqlite`，走 `@zcode/shared/dataDirName` 的 `WORKSPACE_CONFIG_DIR_NAME` 子路径导出，不写字面量 |
| `core/src/subagent/explore-tools.ts`、`profile.ts`、`explore.ts` | 两个分支的 `EXPLORE_AGENT_*_ALLOWED_TOOLS` 都加 `CodegraphQuery`，描述优先级排第一，Explore 系统提示加一条「符号级问题先查索引」的路由规则——默认路径从"扫目录"变为"先查图" |
| `core/tests/`（`tool-contracts`、`tool-search-builtins`、`explore-tools`、`main-tool-pool`、`subagent-explore`、`subagent-profile`）+ 新增 `codegraph-query-tool-contract.test.ts` | 硬编码工具清单全部补齐；新工具自带合同用例 |
| `architecture-policy.yaml` | 3 个新文件按文件登记 `unmanaged-new-file` 例外（CLI 壳 + contracts 类型 + core handler） |

**明确不动**：现有 `read/glob/grep/bash` 工具行为；会话管理、stream/snapshot、
owner/lease、`CommandInbox` 等高危区；`packages/ui` 与 desktop/web 渲染层（P1/P2 无 UI）。

## 7. 分期与验收场景

### P1：索引器 + CodegraphQuery

1. 全量 rebuild 本仓库 → `stats` 报告文件/符号/边计数，符号数与 `pnpm dep:refs` 同源口径一致量级。
2. 改一个文件新增导出 → 不重建直接 `CodegraphQuery` → 新符号可见（查询时增量生效）。
3. 绕过索引直接改文件 mtime/hash → 查询命中该文件的条目带 `stale` 标记，不静默给旧边。
4. `CodegraphQuery symbol=X direction=inbound` 返回的每个引用位置，`Read` 后确有引用（抽样人工核验）。
5. Explore 子代理会话内可调用 `CodegraphQuery`，免审批执行。
6. `tool-contracts` 合同测试覆盖入参校验、输出 schema、`maxOutputBytes` 截断。
7. **收益对照（基线值见 §7.1）**：同一批固定任务集，grep-only 基线路径 vs codegraph 路径的工具调用次数与 token 消耗达到 §7.1 通过线；任一任务劣化即本条不通过。

#### P1 验收记录（2026-11-19，本仓 win32）

| 场景 | 结论 | 证据 |
| --- | --- | --- |
| 1 | 通过 | `rebuildIndex` 实测 8458 文件 / 65055 符号 / rebuild 219.5s；`stats` 与之一致，`staleRatio=0`。口径抽样对照：`pnpm dep:refs --list-exports packages/services/src/logger/serviceLogger.ts` 报 2 个导出（`ServiceLogger` interface line 11、`createServiceLogger` function line 18），索引同一文件的 `exported=true` 行完全同名同行号，另含 1 条 `exported=false`（索引记未导出的顶层声明，是 dep:refs 口径的超集） |
| 2 | 通过 | `packages/biz-codegraph/tests/freshness.test.ts` 用例 1：新增 `export function gamma` 后不 rebuild，查询即命中且 `stale=false` |
| 3 | 通过（措辞澄清） | 同文件用例 4：`a.ts` 被同名目录顶掉（mtime 变化 + 读取必失败）→ `stale=true` 且 `staleReason` 点名该文件。原句「改 mtime/hash 就带 stale」按 §5.1 精确化为：**变化且重抽成功=直接给新数据，不标 stale；变化但重抽失败才标 stale**——否则这条不变量会退化成「凡是刚改过的都不可信」 |
| 4 | 通过 | 抽样 5 个 `symbol=createToolRegistry direction=inbound` 的引用位置逐一核对源文件行内容：`core/src/runtime/agent-runtime.ts:13/380`、`runtime/deps.ts:274`（re-export）、`tests/cron-tool.test.ts:2`、`tests/websearch.test.ts:106`，全部确有该符号引用 |
| 5 | 部分通过 | 工具面已就位：两个 Explore 分支白名单、描述优先级第一、系统提示路由规则、`needsApproval:false` + 只读登记（`READ_ONLY_TOOLS`/`isReadOnlyTool`），默认模式下不会触发审批；`main-tool-pool` / `subagent-explore` / `subagent-profile` 用例钉住了工具面。真实「Explore 会话内一次调用成功」依赖 §7.1 校准运行，尚未跑 |
| 6 | 通过 | 新增 `core/tests/codegraph-query-tool-contract.test.ts`（9 例）：v2 通用合同、描述路由规则、空入参拒绝、索引缺席的业务失败、符号/边投影与 `file:line` 行首格式、空结果措辞、stale 复述。`maxOutputBytes` 截断沿用执行器的 `resultBudget`（本工具声明 20k truncate），未另造第二套截断路径 |
| 7 | 部分通过 | codegraph 臂的**答案**已实测：附录 A.2 五条任务的索引返回与 A.1 冻结清单逐位一致（含 6 文件/154 边、13 处/101 边、33 文件/80 边），并量出冷算 5.6s–116s、命中缓存 1.5s。两条臂的**调用次数与 token** 未跑——headless `-p` 在本机发不出模型（`Select a model before sending a message`，卡因与运行手册见 A.3） |

同期修的实现缺陷（win32）：懒算边曾走 `project.addSourceFilesAtPaths([abs])`——那是 **glob** API，Windows 反斜杠绝对路径一个都匹配不上，结果是所有引用边静默为空且误报 `stale: source file not loaded`。改为 `addSourceFileAtPathIfExists` 后临时目录用例才真正出边。另：`ensure` 阶段读文件（同名目录/权限/瞬时 IO 错误）原先会把异常抛穿查询路径，现按「内容已变」交给重抽记录失败并标 stale。

**outbound 覆盖面已收口（同日决定）**：`direction=outbound` 定义为**文件级**——只返回「该文件作为
引用方」的缓存边（别的符号算 inbound 时顺带产出，所以对新查询常为空，实测
`filePath=core/src/tool/registry.ts` → 5 个符号、0 条 outbound 边）。符号级 outbound 明确不在 P1
做；只给 `symbol` 又问 outbound 时工具直接返回 `codegraph_outbound_needs_file_path` 失败并指路，
而不是回一条空边表（空表会被模型读成「它没有依赖」）。文件的完整 import 依赖面留给 P2 的
`CodegraphModules`。

### 7.1 收益对照基线（P1 验收指标）

- **任务集**：5 个符号级定位任务，固定清单与判定标准记录在附录 A（如"找出谁调用了
  某导出函数""定位某类型定义的全部使用点"），任务不因工具面不同而改写。
- **测量口径**：工具调用次数 = 定位阶段（从任务开始到给出目标 `文件:行号` 为止）
  `read/glob/grep/bash/codegraph` 调用总和；token 以模型 usage 统计为准，只计定位阶段。
- **预设基线（grep-only 路径，P1 开工前未实测，采用保守预设值）**：
  平均 **≤ 20 次工具调用/任务**、**≤ 60k token/任务**。校准运行实测后，附录 A 回填
  实测值取代预设值；若实测低于预设值，通过线随之按同比例收紧。
- **通过线（codegraph 路径）**：
  - 工具调用次数：任务集平均相对基线**下降 ≥ 50%**（按预设基线即平均 ≤ 10 次/任务）；
  - token 消耗：任务集平均相对基线**下降 ≥ 30%**；
  - **劣化条款**：任一单任务两项指标均不劣于基线（允许个别任务持平，不允许反向变差）。
- 基线与 codegraph 路径使用同一模型、同一系统提示版本、同一任务提示词；只允许工具面不同。

### P2：CodegraphModules + Repo Wiki / 知识卡片生成

> 设计参考：Qoder 的 Repo Wiki 生成页（2026-11-19 用户提供截图，项目 `meta-fusionfinlab`）。
> 抄的是它的**产物分层**与**脏判定锚点**，不是它的界面——§8 仍把 UI 展示层排除在 P1/P2 之外，
> 面板上的等价能力一律放 CLI。

**产物三类，一条管线**（§2「图喂模型、文档给人看」的补全：给模型的第二形态是模块卡片，不是整篇 Wiki）：

| 产物 | 消费方 | 存储与写者 | 成本口径 |
| --- | --- | --- | --- |
| `CodegraphModules` 结构化查询 | 模型（只读、免审批） | 由索引现有表派生，不新增真相 | 查询时算，同一符号/模块只算一次 |
| 模块知识卡片 | 模型（一次读全文，替代扫目录） | 索引库新增 `cards` 表，写者仍是 biz-codegraph（不变量 4） | 生成期一次 LLM 抽取，之后按脏重建 |
| Repo Wiki 页面 | 人 | markdown，落点待定（见本节末） | 与卡片同批产出，同一份抽取结果两种渲染 |

卡片 schema 沿用被验证过的类别划分（一模块 × 多类别，非自由文档）：`overview`、
`architecture_design`、`tech_stack`、`coding_conventions`、`unique_setup_and_commands`、
`configuration_system`、`dependency_management`、`logging_system`、`error_handling`、
`build_system`、`frontend_style`，卡片间带 parent/related/sub/similar 链接。检索面定为
**「标题清单 → 按标题取全文」，不做语义搜索**——脏判定要落在标题粒度上才能只重建过期条目，
语义召回做不到这一点，且会把「卡片过期」藏进相似度分数里。

**脏判定锚点（本节主决策）**：参考页把一次生成任务锚在一个 commit 上（截图「任务目标 `2eb00d4`」）。

- commit 锚点：切分支、rebase、复制工程都不误伤（内容未变即不脏），代价是未提交的改动不在锚点里，
  仍需现有 `mtime + hash` 兜。
- `mtime + hash`（P1 现状）：对未提交改动敏感、已实现，代价是 checkout 会让一片文件 mtime 全变而
  内容未变，误判成整模块脏。
- 推荐：**commit 为主键 + `mtime + hash` 作同一键下的快速脏检**，两层判定都只在 biz-codegraph 内做，
  沿用不变量 1——脏了不静默给旧卡片，而是点名哪张过期、为什么。

**长任务可控（CLI 等价物，不做面板）**：`zcode codegraph wiki [--lang zh-CN|en-US] [--module <id>] [--resume]`。
Ctrl-C 可中断且**按卡片粒度提交**（已完成的卡片保留，不像 rebuild 那样全或无）；`--module` 只重建
指定模块；`--lang` 决定卡片与页面的产出语言。

**验收口径**（替换本节原先的两条）：

1. `CodegraphModules` 的模块边界与 `pnpm architecture:check` 判定一致（同一份 policy 源）。
2. 卡片/页面增量重建只触碰索引 diff 覆盖到的模块；删除符号后对应引用条目同步消失。
3. 脏判定可复现：改一个模块内一个文件 → 只有该模块的卡片标脏，其余卡片读取仍命中缓存。
4. 卡片不能比查询更贵：同一道「谁引用 X」的题，读卡片的 token 不高于 `CodegraphQuery` 结果 +
   为核对而做的必要 `Read`（§7.1 的口径与任务集直接复用）。
5. 中断后 `--resume` 补齐未完成卡片，不重复已完成部分。

**开工前待用户定的两点**：

- 卡片**持久存**（如上表，新增 `cards` 表）还是**查询时现拼**（不新增表，但每次查询都跑一次 LLM）。
  持久存才吃到调用次数收益，代价是引入「卡片过期」这条新的一致性线。
- Wiki markdown 的落点：写进仓库还是写进契约目录。写进仓库不是 §8 禁止的「索引写回源文件」
  （那是改写既有源文件），但会新增未跟踪文件、脏工作区，而 `verify:pre-push` 拒绝脏工作区，
  所以要同时定 `gitignore` 条目与门禁口径；写进契约目录则完全不进仓库，代价是人读时要另外打开。

### P3：非 TS 语言的 tree-sitter 兜底

范围与降级策略届时补充本节后再实施。

## 8. 明确不做

- MCP server 壳（留作后续选项，不加）。
- 常驻文件 watcher / 后台守护进程。
- 修改任何现有工具的行为或输出格式。
- 索引写回源文件、UI 展示层（P1/P2）。
- 依赖注入以外的方式绕过 `IPlatformService` / 权限边界。

## 附录 A：收益对照任务集与实测记录

> 状态（2026-11-19）：A.1 标准答案已冻结；A.2 记录了 codegraph 臂**答案可达性**的实测
> （库层直调，不经模型）；A.3 是两条臂的**调用次数/token** 对照，**未跑**，卡因与运行手册
> 写在里面。A.0 说明为什么把批准的 5 条提示词收窄了——这一条需要用户确认。

### A.0 与批准版的偏差（为什么必须收窄）

批准的 5 条都是「全仓」提问。冻结标准答案时先用词边界 Grep 数了一遍真实规模，发现两类
问题让「人工判定答案对错」不可执行——答案规模大到没法逐条比对（任务 1/2/3），以及提问
落在索引口径答不了的位置上（任务 5）——于是逐条加了范围限定（判定标准同步改写成可数的清单）：

| # | 全仓真实规模 | 问题 | 收窄后 |
| --- | --- | --- | --- |
| 1 | `createServiceLogger` 72 个源文件提及，索引给出 154 条引用边（超默认 50，`limit` 顶到 200） | 154 个位置逐一人工核对不是「一次判定」能完成的 | 限定 `packages/services/src/cua-permission-broker` 目录 |
| 2 | `registerBuiltInTools` 全仓 115 处（含测试） | 测试引用占多数，判定标准里「三个形态」会被测试噪声淹没 | 明示「只看 `src/`，忽略 `tests/` 与 `dist/`」 |
| 3 | `WORKSPACE_CONFIG_DIR_NAME` 33 个源文件 | 提问本身可判定（按包汇总），但两条臂都得先排除测试与 `dist` | 加同一句范围限定，保持可判定 |
| 5 | `packages/rpc/src/index.ts` 只有 11 条 `export {...} from` 语句、0 条 `export *` | 索引按**声明**建符号表，barrel 里没有声明，实测该路径返回 `symbols=0`——这条任务对 codegraph 臂根本不可答，不是性能差 | 换成有真实声明的 `packages/rpc/src/protocol.ts`；barrel 口径缺口按 §6 记为 P2（`CodegraphModules`）要补的事 |

任务 4（`SymbolQuery`）全仓只有 6 处引用，无需收窄，但把判定标准里的「含 `codegraph.ts` 的
`querySymbols`」改成逐点清单——原句描述的是意图，不是可比对的答案。

### A.1 冻结的标准答案（词边界 Grep，2026-11-19，本仓）

清单只收**引用**（import / 调用 / 类型位置 / 再导出）。注释里出现名字的位置单列，两条臂都
不因缺它判错——注释不是引用，索引也不该把它算成边。

1. `createServiceLogger`（限定 `packages/services/src/cua-permission-broker`，定义在
   `packages/services/src/logger/serviceLogger.ts:18`）：
   `cuaPipSessionService.ts:7`(import) `:50`(调用)、`stableCuaTransport.ts:2`(import) `:5`(调用)、
   `windowsCuaDevHelperHost.ts:11`(import) `:87`(调用)。共 6 处，3 个文件。
2. `registerBuiltInTools`（`src/` 非测试，13 处 / 8 个文件）：定义
   `core/src/tool/handlers/index.ts:234`；再导出 `core/src/tool/index.ts:9`、
   `core/src/index.ts:22`、`core/src/runtime/deps.ts:274`；import
   `core/src/runtime/helpers/runtime-tools.ts:7`、`core/src/runtime/methods/embedded-search-branch.ts:2`；
   调用 `runtime-tools.ts:56`、`embedded-search-branch.ts:28`。
   注释位（不判错）：`bootstrap/src/app/dynamic-workflow-gate.ts:7`、
   `core/src/runtime/helpers/tool-allowlist.ts:96`、`core/src/tool/handlers/index.ts:85,173`、
   `core/src/tool/handlers/read-topic-resource.ts:35`。
3. `WORKSPACE_CONFIG_DIR_NAME`（`src/` 非测试，按包的文件集合）：
   `apps/zcode-cli` 18 个文件（adapters 3、bootstrap 6、cli 1、contracts 2、core 4、
   dynamic-workflow-runtime 1、office-runtime 1）、`packages/services` 7、`packages/shared` 3、
   `packages/desktop` 2（`src/main/mcpUserDirectory/index.ts`、`wdio.conf.ts`）、
   `packages/ui` 2、`packages/biz-codegraph` 1。共 33 个文件 / 6 个包。
4. `SymbolQuery`：定义 `packages/biz-codegraph/src/contract.ts:33`；引用
   `codegraph.ts:30`(import)、`codegraph.ts:271`(函数签名)、`contract.example.ts:5`(import)、
   `contract.example.ts:7`(返回类型)、`index.ts:9`(再导出)。
5. `packages/rpc/src/protocol.ts` 的导出面：该文件顶层 `export` 声明 15–16 条（词边界统计
   15 条，索引给出 16 条，差异是 `export` 换行写法），以索引返回的名字清单为准逐一核对；
   原 `packages/rpc/src/index.ts` 版本的「包对外导出了哪些名字」明确**不在 P1 可答范围**
   （见 A.0 第 5 行）。

### A.2 codegraph 臂：答案可达性实测（库层直调，不含模型）

同一进程内按 A.0 收窄后的提问依次调 `querySymbols(root, {limit:200})`，索引为 8459 文件：

| # | 提问 | 首次调用 | 命中缓存后 | 与 A.1 的比对 |
| --- | --- | --- | --- | --- |
| 1 | `symbol=createServiceLogger direction=inbound` | 116.0s（154 条边） | 1.9s | 收窄目录内的 6 处全部在边表里，无漏报 |
| 2 | `symbol=registerBuiltInTools direction=inbound` | 19.6s（101 条边） | 1.5s | `src/` 的 8 处引用齐（定义/再导出/import/调用四种形态都有），注释位未算成边（正确） |
| 3 | `symbol=WORKSPACE_CONFIG_DIR_NAME direction=inbound` | 13.9s（80 条边） | 1.5s | 按包去重后 33 个源文件 / 6 个包，与 A.1 第 3 条逐项一致 |
| 4 | `symbol=SymbolQuery direction=inbound` | 5.6s（5 条边） | 1.5s | 5 条边 = A.1 的 5 个引用位，`index.ts:9` 带 `reexport` 标记 |
| 5 | `filePath=packages/rpc/src/protocol.ts` | 1.5s | 1.5s | 16 个符号、0 条 outbound 边（outbound 是文件级缓存边，见 §4.1） |
| — | `filePath=packages/rpc/src/index.ts`（原任务 5） | 1.6s | — | `symbols=0`：barrel 无声明，A.0 第 5 行据此换题 |

要点两条：**冷/热差一个数量级**——某符号的精确边全仓只算一次并持久化，之后固定 1.5s 级；
冷算成本随「提及该名字的源文件数」增长（6 文件→5.6s，33 文件→13.9s，72 文件→116s）。
第二点是工具面的既有约束：`CODEGRAPH_TIMEOUT_MS = 90_000` 小于最坏冷算（116s），且懒算是
同步 CPU 工作，计时器在事件循环被占住期间无法 preempt——冷算高扇入符号的那一次调用会明显
慢于申报的超时值。库层实测显示这次冷算照常把边表写进了缓存（第二次调用即 1.5s 命中）；
执行器在 90s 处是丢掉这个迟到的结果还是照常返回，只有跑通 A.3 的模型会话才能验证，此处
按未证记录，不写成结论。P1 不再改动这个边界，把它作为已知代价记录在此，供 P2 决定是
「rebuild 期预计算」还是「分批懒算 + 分批落盘」。

### A.3 未跑的部分：两条臂的调用次数与 token 对照

**卡因**：headless 运行在本机无法发起模型调用。命令

```
mise exec -- node_modules/.bin/tsx apps/zcode-cli/packages/cli/src/main.ts \
  -p "<A.0 收窄后的任务提示词>" --json \
  [--disallowed-tools CodegraphQuery]   # 只加在基线臂
```

在发出第一条消息前就退出：`Error: Select a model before sending a message`。`-p` 路径的模型
选择来自 Personal 配置里的 `defaultModelSelection`（`packages/provider-node/src/model-selection-config-repository.ts`），
CLI 没有 `--model` 旗标；补齐它要走交互式 `/model` 或登录流程，属凭据面，按约定不由我操作。
所以 10 次模型会话（5 任务 × 2 臂）没有跑，§7.1 的三条通过线（调用降 ≥50%、token 降 ≥30%、
无单任务劣化）保持「未测」，§7 场景 5 的「Explore 会话内一次调用成功」同样只能停在部分通过。

待模型可用时的运行手册（两条臂各自记录，同一模型、同一系统提示版本、同一提示词）：
每次运行从 `--json` 输出取定位阶段的工具调用序列与 usage token，按 §7.1 口径只计到给出目标
`文件:行号` 为止；索引预热（`zcode codegraph rebuild`）与 A.2 的首次冷算都在计时之外单独记录，
否则 codegraph 臂会被一次性缓存构建算进成本。结果回填下表，基线实测若低于 §7.1 的预设值，
通过线按同比例收紧。

| # | 任务提示词（收窄后） | 判定标准 | 基线实测（调用/token） | codegraph 实测（调用/token） |
| --- | --- | --- | --- | --- |
| 1 | 谁调用了 `createServiceLogger`？只看 `packages/services/src/cua-permission-broker`，给出每个调用点的 `文件:行号`，不要贴代码。 | A.1 第 1 条 6 处全覆盖；多报 import 行不判错，漏报调用点判错 | 未跑 | 未跑 |
| 2 | `registerBuiltInTools` 在哪些 `src/` 文件里被引用（忽略 `tests/` 与 `dist/`），分别是什么形态？ | A.1 第 2 条 8 处，且指出再导出链经过 `core/src/index.ts` | 未跑 | 未跑 |
| 3 | `WORKSPACE_CONFIG_DIR_NAME` 被哪些包引用（只看 `src/`）？按包汇总并给每个包一个代表位置。 | 包集合与 A.1 第 3 条的 6 个包一致，代表位置在该包内确有引用 | 未跑 | 未跑 |
| 4 | `SymbolQuery` 定义在哪，哪些文件把它写进了函数签名或再导出？ | 定义位 + A.1 第 4 条全部 5 个引用位 | 未跑 | 未跑 |
| 5 | `packages/rpc/src/protocol.ts` 对外导出了哪些名字？只给名字清单和 `文件:行号`。 | 与 A.1 第 5 条一致，允许顺序不同 | 未跑 | 未跑 |
