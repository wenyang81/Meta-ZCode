# biz-brand

本 fork 的品牌事实唯一所有者：产品名与图形母版。上游 `ZCode` 标识分散在构建身份表、
React 组件内联 SVG、主进程原生外壳与派生图标四类位置，本模块收口前两类的数据来源，
让 fork 的 diff 停留在 seam 上。见 `docs/brand-identity.md`。

不变量：

- 纯数据：无 IO、无 `await`、无 JSX、无 React 依赖。任何需要渲染的形态由消费方组件决定。
- `logoSvg` 是图形唯一母版，`logoDataUrl` 由它派生；图标派生脚本同样只用它。
- 图形优先经 data URL 交给 `<img>`，而不是内联进宿主文档：母版里的 `hexGrad` 等 gradient id
  因此不会与同页面其它 SVG 抢名字。唯一例外是 `packages/desktop/src/renderer/index.html` 与
  `packages/web/index.html` 的首屏启动壳——它们在 JS 入口执行前就要绘制，静态 HTML 不能 import
  TS 常量，只能内联母版副本；改 `logoSvg` 时必须同步这两处（每页各只有一份内联 SVG，id 不冲突）。
- 名称分两个轴：`productName` 是 ASCII，决定安装目录、`%APPDATA%\<productName>` 与运行时应用名
  （`app.name` / `process.title`，因此也是菜单与托盘 `{appName}` 插值取到的字符串）；
  `displayName` 是人看的中文名字，决定界面正文标识与关于页中文文案。两者不可互换。

与其它模块的交集：

- 消费方通过 `brandIdentity` 读取：`packages/ui`（logo 组件、启动壳、About/wordmark）、
  `packages/web`（登录页、文档标题）、`packages/desktop`（应用名、窗口与托盘图标、关于页）、
  `packages/shared`（菜单与托盘文案的 `{appName}` 插值参数）。
- 构建期身份表 `packages/desktop/scripts/desktop-product-identity.mjs` 取 `appId` /
  `productName` / `linuxExecutableName`，但 flavor（production/preview）与 `ZCODE_ENV`
  两个正交轴的判定仍留在原处，本模块不表达构建环境语义。
- 不覆盖：`.zcode` 数据目录名、`zcode://` deep link scheme、`ZCODE_*` 环境变量前缀、
  i18n 正文文案。改这些属于数据迁移或全量文案决策，不是品牌决策。
