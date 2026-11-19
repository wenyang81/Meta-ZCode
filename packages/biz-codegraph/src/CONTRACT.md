# biz-codegraph

符号索引库：把工作区源码抽取为持久符号图（文件→符号→跨文件引用边），供 Agent
运行时查询，替代反复 list/read/grep 扫描。spec 见 [docs/codegraph-index.md](../../../docs/codegraph-index.md)。

不变量：

- **stale 校验**：查询返回前校验目标文件 `mtime + hash`，过期条目必须带 `stale` 标记返回，禁止静默给旧图。
- **只读边界**：运行时查询不写任何工作区文件；SQLite 是索引唯一存储，仅本模块写入。
- **workspace 身份键**：索引隔离键为 `workspaceIdentity?.trim() || workspacePath`，不纯按路径。

与其它模块的交集：

- `apps/zcode-cli/packages/core` 的工具注册薄壳（ToolEntry 转调本模块，不含逻辑）。
- CLI 子命令 `zcode codegraph rebuild/stats` 触发全量重建。
- 索引文件位置遵循数据目录品牌契约叶子（`@zcode/shared` 的数据目录常量）。
