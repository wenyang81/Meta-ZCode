---
name: repo-wiki
description: 从 codegraph 结构视图生成/更新人看的模块 wiki 文档。用户输入 /repo-wiki 或要求「生成 wiki / 更新模块文档」时使用。
disable-model-invocation: true
---

# Repo Wiki（结构数据 → 模块文档）

两步流程：第一步是纯机械导出（不花 token），第二步由当前会话的模型把结构数据写成带解释的文档。本 skill 是这两步的编排者。

## 第一步：机械数据（命令，不用模型）

结构数据来自 `zcode codegraph wiki` 的导出，落点 `<workspace>/.dlMeta/codegraph-wiki/`（衍生品目录，已被 gitignore，随时可重生成覆盖——**绝不手改、也绝不把散文写进去**）。

1. 运行 `dlmeta codegraph wiki`（`zcode codegraph wiki` 等价；打包产物里两个 exe 同一份 blob）。
   - 开发仓里没有装 `dlmeta`/`zcode` 二进制时，用仓库根的 tsx 入口代替：
     `node --disable-warning=DEP0205 --import tsx apps/zcode-cli/packages/cli/src/main.ts codegraph wiki`
   - 报 `No codegraph index` 时先跑 `dlmeta codegraph rebuild`（同样的入口替换规则），再重试。
2. 记下输出里的 `builtAt`（索引构建时间，写在 index.md 头部）和页数。后续每个文档都要带这个时间戳，用于判断文档是否过期。

## 第二步：写文档（模型，分批做）

### 范围与节奏

- 用户点名了模块就只做点名的；没点名时**每轮最多 3~5 个模块**，做完汇报再继续，不要一口气吃完 140 个模块。
- 优先级：先看 `docs/wiki/index.md` 账本（不存在就现场建），跳过已且未过期的模块；过期或缺失的优先。

### 每个模块的产出

落点：`docs/wiki/modules/<模块页同名>.md`（模块页链接目标名照抄 index.md 里的链接，不要自己推 slug）。这份文件进 git、可评审，是「卡片持久存」的载体。

写之前必读两样：
1. `.dlMeta/codegraph-wiki/modules/<同名>.md` —— 该模块的导出面、依赖方向、越界告警（机械事实，不许与之矛盾）；
2. 模块的关键源文件（从导出面里挑 3~8 个真正承重的），用证据说话。

文档结构（中文，与仓库文档一致）：

```markdown
---
module: <模块 id>
basedOn: <builtAt 时间戳>
---
# <模块 id>

## 这个模块是干什么的
（3~6 句白话，说清职责与存在理由，不抄导出面）

## 关键入口
（符号 → 文件:行号，每条一句话说明它为什么承重）

## 依赖关系解读
（从机械数据里的 dependsOn/dependedBy 挑出有含义的边解释：谁依赖它、它为什么依赖谁；
不逐条罗列。unregistered 桶「被依赖」为空是口径问题，不是坏味道，照实说明即可）

## 改它要小心什么
（越界告警、单所有者约束、易碎点；没有就写「无特别约束」，不硬凑）
```

### 硬规矩

- 只写代码里看得见的结论；推断要标「待确认」。不发明文件、符号、依赖。
- 机械数据与源码冲突时，以源码为准，并在「改它要小心什么」里点出索引滞后。
- 每写完一批：更新 `docs/wiki/index.md` 账本（模块 id、basedOn、一句话摘要），跑 `pnpm docs:stale-phrases:check` 确认没踩禁用措辞。

## 过期判定

账本里的 `basedOn` 落后于本次导出的 builtAt 的模块即过期。提示用户可以只重做变化过的模块（对比新旧模块页的导出面/依赖差异，没变的模块直接沿用）。
