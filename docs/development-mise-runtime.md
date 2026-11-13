# mise 开发运行时

## 背景

仓库根目录和 `apps/zcode-cli` 都依赖 Node / pnpm 版本一致性。此前根目录只在 `package.json` 的 `engines.node` 标注 `>=24.0.0`，而 Agent 子工程通过 `.node-version` 和 `packageManager` 固定到 Node `24.14.0`、pnpm `10.33.2`。新机器或新 worktree 容易先装错运行时，再在 Electron、Vite 或 Agent 构建阶段暴露问题。

## 目标

- 进入仓库后可以通过 `mise install` 准备开发运行时。
- `mise run dev` 默认启动桌面测试环境，便于本地开发。
- `mise run dev` 使用独立的数据根目录，避免与正式安装包共享账号凭据、设置和任务索引。
- 常用 Web、桌面生产环境、远控调试和校验命令都有稳定别名。
- 不改变现有 pnpm scripts 的真实执行逻辑，mise 只做版本和入口编排。
- mise 是可选开发入口，Git pre-push 不要求安装 mise；推送使用当前环境中的 Node / pnpm，详见 [Pre-push Hook](testing/pre-push-hook.md#开发环境与版本管理工具)。

## 约定

- Node 固定为 `24.14.0`，与 `apps/zcode-cli/.node-version` 保持一致。
- pnpm 固定为 `10.33.2`，与 `apps/zcode-cli/package.json` 的 `packageManager` 保持一致。
- Electron 安装阶段通过 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 下载，避免首次安装依赖时直连 GitHub release 超时。
- 任务入口仍调用根目录 `package.json` 中已有脚本，避免 desktop / web / agent 的启动语义分叉。
- `dev` 任务调用 `pnpm dev:desktop:test`，并注入 `ZCODE_DATA_BASE_DIR=$HOME/.zcode-dev-home`；实际应用数据落到 `$HOME/.zcode-dev-home/.zcode/`。
- Dev 数据目录不会从正式环境自动复制凭据、设置、任务历史或插件状态；首次启动需要重新登录和配置。
- 隔离的判定条件是「未打包运行 + 显式设置 `ZCODE_DATA_BASE_DIR`」，不限于 `mise run dev` 入口：源码启动 `pnpm dev:desktop:test`、e2e 与冒烟脚本注入该变量时同样进入隔离态。
- `applyEarlyDataBaseDirBootstrap()` 在隔离态下跳过 `setting.json` 的 `dataBaseDir` 覆盖，让 `packages/services/src/paths.ts` 的优先级（`setDataBaseDir()` > env > home）按 env 生效。打包运行（正式版）仍以 `setting.json` 为准，行为不变。
- 之所以需要这条规则：`setting.json` 是全局单一文件，正式版把 `dataBaseDir` 钉到自定义目录后，早期 bootstrap 会无条件用它覆盖 env，导致 dev 与正式版共享同一份任务索引与凭据。共享数据根还会放大版本差：dev 的 schema 校验读不懂正式版写下的历史记录，启动即刷 `task-index-repo 读取 task index meta_json 非法`。
- 生产环境桌面启动使用 `dev-desktop-prod`，不继承 `dev` 任务的数据目录变量。
- 数据目录隔离不改变 OAuth 回调协议。正式包与 Dev 仍使用 `zcode://`，因此 Dev 登录时应先退出其他 ZCode 实例，避免回调被错误进程接收。

## 与 3996dcbdb3 回滚的关系

`3996dcbdb3`（revert storage-profile 系列）撤掉了源码 Desktop 按 `app.isPackaged=false`
自动选 `$HOME/.zcode-dev/` 的能力，也顺带撤掉了本入口的隔离。现在 storage profile 不再
参与，mise 入口注入 `ZCODE_DATA_BASE_DIR` 是唯一的隔离手段；`$HOME/.zcode-dev/` 属于
废弃目录，不再被任何启动路径使用。

上面的隔离规则只决定「显式 env 与 `setting.json` 谁优先」，不重新引入 storage profile，
也不自动挑选目录：隔离态下仍然只用调用方显式给出的 `ZCODE_DATA_BASE_DIR`，未设置该变量
时行为与 `3996dcbdb3` 之后完全一致。

## 验证

- `mise install`
- `mise run bootstrap`
- `mise run dev`
- `mise run typecheck`
- `mise run lint`
