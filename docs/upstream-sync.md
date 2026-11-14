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

## 同步前先知道的四件事

这四条都会让"照流程做"失败，2026-11-14 同步 v3.18.2 时全部撞到过。

1. **网络**：办公网连不上 `github.com`——它被解析到非 GitHub 的 IP（`api.github.com`/`ssh.github.com` 在 20.205.243.x，`github.com` 却给了 20.6.7.17），443 直接超时；强制走正确 IP 仍被 reset，所以还有 SNI 层拦截。换手机热点可通。链路会突然抖回去，所以每条联网命令都自带熔断，不要裸跑 `git fetch`：

   ```
   git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch upstream
   ```

   全局 `~/.gitconfig` 里 `http.lowspeedlimit=0` 会让 git 永不超时，中途被 reset 就挂成一个没有日志的僵尸进程（曾经挂了 13 小时）。这是用户机器配置，不要改它，用 `-c` 临时带上即可。

2. **`origin` 是 single-branch 克隆**：`remote.origin.fetch` 只映射 `main`。后果是 GitHub 上其他分支 `git fetch origin` 永远拉不到，`git push -u` 之后 `@{upstream}` 也报 `not stored as a remote-tracking branch`。一次性放开：

   ```
   git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
   git fetch origin
   ```

   `upstream` 的 refspec 本来就是通配，不用动。

3. **本仓库是浅克隆**：`.git/shallow` 存在，同步基线提交带 `grafted` 标记。同步和 `merge-base` 不受影响，但 `git blame` 和任何按更早历史算范围的工具会撞到边界。要补全得 `git fetch --unshallow upstream`（下载量大，挂机再跑）。

4. **跟 `main`，不要跟 tag**：上游每个版本压成一个提交推上 `main`（作者 `ZCode Source Sync Bot`，标题形如 `chore: sync ZCode source v3.18.2`），而 tag 是滞后的——`main` 已经到 3.18.2 时最新 tag 还停在 `v3.17.2`。按 tag 同步会漏掉最近的改动。

## 日常同步上游（照着做）

推荐 merge（保留两条历史，对二开项目友好），不用 rebase（容易把业务提交搞乱）。

### 第 1 步：先量差距，不改任何东西

```
git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch upstream --tags
git log --oneline main..upstream/main        # 每行 = 一个上游版本
git diff --stat main..upstream/main | tail -1
```

### 第 2 步：先演练合并，别急着切分支

这是最关键的一步。用 `merge-tree` 在不碰工作区的前提下真跑一遍三方合并：

```
git merge-tree --write-tree --name-only biz/<feature> upstream/main
```

退出码 0 且只输出一个 tree OID = 零冲突。想确认自己的改动没被吃掉，就在那棵树里抽查：

```
t=<上一步输出的 OID>
git show $t:package.json | grep -E '"version"|fork:changes'      # 上游版本号 + 我们的脚本
git show $t:packages/desktop/src/main/index.ts | grep -c isExplicitDevDataBaseDir
git ls-tree -r --name-only $t | grep -E "biz-brand|\.env\.fusionfinlab\.example"
```

冲突在这一步就暴露，不会把工作区搞成半合并状态。v3.18.2 实测：46 文件、+1971/−171，与二开改动只重叠 `package.json`（上游只改 version 行）和 `packages/desktop/src/main/index.ts`（上游改第 298 行 import 块，我们改第 7 行和第 2262 行），零冲突。

### 第 3 步：关掉在跑的开发程序

`dev:desktop` 的 tsup/vite watcher 盯着源码。同步会一次换掉几十个文件，watcher 中途重建，屏幕上就是"旧编译产物混新源码"——看着像 bug，其实是产物过期。先停 dev，同步过程中也别重启。

顺带一个坑：未跟踪文件会让 `check-push-worktree` 直接拒绝推送。`docs/qgraphflow/` 这类可再生产物在 `biz/*` 分支已被 `.gitignore` 忽略，但 **`main` 没忽略**（main 要保持贴近原版，不加本地规则），所以在 main 上推之前先把它移出仓库，回到 biz 分支再放回来。

### 第 4 步：同步基准分支

```
git checkout main
git merge --ff-only upstream/main     # 用 --ff-only：main 只准快进，出现分叉说明有人往 main 写过东西
ZCODE_AFFECTED_TEST_BASE=origin/main git push origin main
```

### 第 5 步：业务分支合入

```
git checkout biz/<feature>
git merge main
```

### 第 6 步：判断要不要重装依赖

不要无条件 `pnpm install`。上游经常只改 version 行：

```
git diff <同步前的 HEAD>..HEAD --name-only | grep -E "package\.json$"
git diff <同步前的 HEAD>..HEAD --numstat -- pnpm-lock.yaml
```

`pnpm-lock.yaml` 没变且 `package.json` 的差异只有 version，就不用装。v3.18.2 实测正是这种情况。

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

```
pnpm typecheck
pnpm lint
pnpm fork:changes          # 重新生成改动清单；基线会自动指向新的 sync 提交
```

然后过门禁（`pnpm verify:pre-push` 或随 push 由 `.husky/pre-push` 自动跑）。

上游若删除了功能或模块，按 AGENTS.md 核心原则：同步清理指令和技能中的引用，不自行恢复已移除的模块或内部依赖。

**关于 `origin/staging`：不要建这条分支。** `scripts/engineering-tests/scope.mjs` 的 `firstPushBase()` 在「某分支第一次推送」（远端 sha 全零）时硬要求 `origin/staging`，缺了就 `exit 2`。那是智谱**内网**的集成分支，公开仓库 `zai-org/zcode` 里根本没有（只有 `main` 和 `feat/ui-plugin`）。在 fork 里建同名分支不会多同步到任何代码，反而因为它不随 `main` 前进，会让 `merge-base` 算出越来越旧的分叉点，把已经进 main 的改动也算成"本次改动"，选中范围越来越大。

正确做法是用脚本自己认的覆盖变量（`scope.mjs:43` 读 `ZCODE_AFFECTED_TEST_BASE`）：

```
export ZCODE_AFFECTED_TEST_BASE=origin/main
```

语义正好等于"以干净基准分支为基线"。分支推上去之后第二次起走的是远端 sha，不再需要它；但每开一条新 `biz/*` 分支首推都会再撞一次，所以把它写进每次同步的固定动作。

**如实标注这一步的性质**：加了覆盖之后，`test:engineering:affected --scope push` 会打印 `选中 169/169` 然后 `已跳过工程测试（未执行测试），不因此阻止 Push`。这是**豁免通过**，不是跑过了 169 个规格。要真覆盖，就在门禁之外按本次改动涉及的包单独跑测试，别把跳过写成通过。

### 关于 Apache-2.0

上游同步不改变合规要求：`LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md` 相对上游保持零删改，对外分发源码前重新跑 `pnpm fork:changes` 生成改动清单。
