# 上游同步规范（二开项目）

本项目是 `zai-org/zcode` 的 fork（二开）。所有二开代码与官方原版代码必须保持可同步，本规范是长期无痛同步的前提。

## 远端约定

| 远端 | 地址 | 用途 |
| ---- | ---- | ---- |
| `origin` | `https://github.com/wenyang81/Meta-ZCode.git` | 自己的 fork，推二开代码 |
| `upstream` | `https://github.com/zai-org/zcode.git` | 官方原版，只拉更新，不推送 |

远端只配置一次（已完成）：

```
git remote add upstream https://github.com/zai-org/zcode.git
git remote -v
```

## 分支策略

```
upstream/main        # 官方主线
    ↓ merge
main（origin）       # 干净基准分支：只同步上游，禁止写任何业务代码
    ↓ 切分支
biz/<feature>        # 二开业务分支：办公面板、MCP、业务逻辑全部在这里
```

- `main` 永远尽量贴近原版，同步上游只在 `main` 上操作，冲突最少。
- 所有二开代码在 `biz/*` 分支开发，验收后合并回 `main` 推到 `origin`。
- 业务代码解耦原则：新增业务放到独立包（如 `packages/biz-office`），不大面积侵入 `packages/desktop` / `packages/ui` 底层。侵入越深，每次同步冲突越多。
- 直接在 `main` 上写业务代码是同步炸掉的根源，禁止。

## 日常同步上游（标准流程）

推荐 merge（保留两条历史，对二开项目友好），不用 rebase（容易把业务提交搞乱）。

```
# 1. 拉取上游所有分支、标签（不会覆盖本地代码）
git fetch upstream

# 2. 切到基准分支
git checkout main

# 3. 合并上游
git merge upstream/main

# 4. 推回自己的 fork
git push origin main

# 5. 业务分支合入上游更新
git checkout biz/<feature>
git merge main
```

### 冲突处理

Git 会提示冲突文件，打开看标记：

```
<<<<<<< HEAD
你的修改
=======
上游官方新代码
>>>>>>> upstream/main
```

处理完：

```
git add <files>
git commit        # 完成合并提交
```

### 同步后必做

- `pnpm verify:pre-push`（工作区、Lint、schema 与架构检查）。
- `pnpm typecheck`、`pnpm lint`。
- 上游若删除了功能或模块，按 AGENTS.md 核心原则：同步清理指令和技能中的引用，不自行恢复已移除的模块或内部依赖。
