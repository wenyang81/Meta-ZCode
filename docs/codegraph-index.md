# Codegraph 符号索引规范（融智坊）

> 状态：**起草中，未实现**（2026-11-19 与用户对齐方案后落稿；P1 未开工）。
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

## 3. 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 事实源 | 工作区文件系统 | 索引永远是派生物，不改写任何源文件 |
| 索引库 | SQLite 文件，`packages/biz-codegraph` 独占读写 | 三张表：`files`（路径、mtime、hash）、`symbols`、`edges`；查询端只读 |
| 索引生命周期 | CLI（全量 rebuild）/ 查询时 ensure（增量） | 增量以 `mtime + hash` 为键，只重解析变更文件 |
| 工具注册 | `apps/zcode-cli/packages/core/src/tool/registry.ts` + `handlers/` | 薄壳：new ToolEntry，handler 转调 biz-codegraph 库 |
| 索引文件位置 | 数据目录下按 workspace 隔离的叶子 | 键为 `workspaceIdentity?.trim() \|\| workspacePath`（agents.md 身份键规则，不得纯路径匹配）；叶子命名与门禁收口遵循数据目录品牌契约（`.dlMeta` / `DLMETA_*`），实现时按现行契约登记新叶子 |

## 4. 接口定义

### 4.1 运行时工具（P1）

两个只读工具，`ToolEntry` 元数据统一：
`readOnly: true, destructive: false, needsApproval: false, sideEffectScope: "none", riskLevel: "low", concurrentSafe: true`——与 Grep 同级，自动放行，不产生审批摩擦。

**`CodegraphQuery`** —— 符号级问答：

- 入参（草案）：`{ symbol?: string; filePath?: string; direction?: "inbound" | "outbound" | "both"; limit?: number }`。`symbol` 与 `filePath` 至少给一个。
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
2. **workspace 身份键**：索引隔离与请求关联一律 `workspaceIdentity?.trim() || workspacePath`；
   远程链路贯穿传递 `workspaceIdentity`，不得仅按路径匹配。
3. **只读边界**：运行时工具不写任何文件；路径处理复用现有 `path-policy` /
   `path-normalization`，不绕过权限体系；写索引只发生在 CLI 与查询时 ensure 的
   biz-codegraph 内部路径。
4. **无第二写入路径**：SQLite 仅由 biz-codegraph 写；UI、Main、Renderer 不直接触碰。
5. **薄壳纪律**：`apps/zcode-cli/packages/core` 内每个文件只做注册与转调（每个几十行），
   解析、存储、查询逻辑全部在 `packages/biz-codegraph`。

## 6. 现有文件改造清单（全部为注册性质增量）

| 位置 | 改动 |
| --- | --- |
| `apps/zcode-cli/packages/core/src/tool/registry.ts` + `handlers/index.ts` | 注册 2 个新 ToolEntry |
| `core/src/tool/tool-visibility.ts`、`provider-visible-order.ts`、`tool-allowlist.ts` | 新工具加入可见性/排序/权限清单 |
| `packages/shared/src/zcode-protocol/index.ts` | 新增工具类型定义（严格类型 + 运行时校验），不动已有协议 |
| CLI 命令注册 | `zcode codegraph` 子命令分支 |
| 数据目录品牌契约 | 索引库叶子登记进品牌常量与门禁清单 |
| `core/src/subagent/explore-tools.ts` | `EXPLORE_AGENT_ALLOWED_TOOLS` 加 `CodegraphQuery`（embedded search 分支同加），描述优先级数组排在 `Grep` 之前——Explore 的默认路径从"扫目录"变为"先查图" |
| `core/tests/tool-contracts.test.ts` 等 | 补合同测试与新鲜度集成测试 |

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

### P2：CodegraphModules + Repo Wiki 生成

1. `CodegraphModules` 的模块边界与 `pnpm architecture:check` 判定一致（同一份 policy 源）。
2. Wiki 增量重建只触碰索引 diff 覆盖到的页面；删除符号后对应引用条目同步消失。

### P3：非 TS 语言的 tree-sitter 兜底

范围与降级策略届时补充本节后再实施。

## 8. 明确不做

- MCP server 壳（留作后续选项，不加）。
- 常驻文件 watcher / 后台守护进程。
- 修改任何现有工具的行为或输出格式。
- 索引写回源文件、UI 展示层（P1/P2）。
- 依赖注入以外的方式绕过 `IPlatformService` / 权限边界。

## 附录 A：收益对照任务集与实测记录

> P1 开工前建：固定 5 个任务的提示词、判定标准、grep-only 校准运行的实测
> （每任务工具调用次数 / token）与 codegraph 路径复测值。实测前 §7.1 使用预设基线。

| # | 任务提示词 | 判定标准 | 基线实测（调用/token） | codegraph 实测（调用/token） |
| --- | --- | --- | --- | --- |
| 1 | 待定 | 待定 | 待回填 | 待回填 |
| 2 | 待定 | 待定 | 待回填 | 待回填 |
| 3 | 待定 | 待定 | 待回填 | 待回填 |
| 4 | 待定 | 待定 | 待回填 | 待回填 |
| 5 | 待定 | 待定 | 待回填 | 待回填 |
