# 环境变量说明

本项目（融智坊 / DLMetaWork fork）的环境变量分三类「怎么改才生效」：

| 档位 | 怎么生效 | 典型场景 |
| --- | --- | --- |
| **A 运行期 env** | 设进 dotenv 或进程环境，**重启 dev / 重启应用**即生效 | 指后端地址、网关地址、协议链接 |
| **B 构建期 define** | 只在**打包构建时**读一次，打进产物；运行期改了没用 | 遥测开关、自更新开关 |
| **C 硬编码** | 不认任何 env，必须改代码 | 插件市场 CDN、内置推理地址 |

档位判定依据见 [upstream-service-dependencies.md](upstream-service-dependencies.md)；
A 档的官方登记模板是仓库根 [.env.fusionfinlab.example](../.env.fusionfinlab.example)（不会被自动读取，抄值用）。

## 放到哪个文件（dotenv 加载顺序）

开发态 Host 进程按此顺序加载，**后加载的覆盖先加载的**：

```
仓库根 .env → .env.local → .env.development → .env.development.local
→ packages/desktop/.env → …/.env.local → …/.env.development.local
```

三个坑（详见 example 文件头）：

1. `.env.development` 是随仓库跟踪的上游默认值，且排在 `.env.local` **之后**——覆盖它已有的 key（如 `ZCODE_TEST_BASE_URL`）必须写 `.env.development.local`，写 `.env.local` 会被静默盖掉。
2. 优先级按变量名分不按文件分：非 scoped 名（`DLMETA_BASE_URL`）> scoped 名（`ZCODE_TEST_BASE_URL`）。推荐全用非 scoped 名，一次覆盖 test 和 production 两档。
3. 真实进程环境变量优先于所有 dotenv 文件。临时验证最省事：`DLMETA_METAROUTER_BASE_URL=... pnpm dev:desktop`。

`.env`、`.env.local`、`.env.*.local` 均已 gitignore，**实值不要提交**。

---

## 一、MetaRouter 网关（`DLMETA_` 前缀，自家命名空间）

详细契约见 [metarouter-provider.md](metarouter-provider.md)。改完重启 dev 生效。

| 变量 | 干什么 | 默认值 | 拼接规则 |
| --- | --- | --- | --- |
| `DLMETA_METAROUTER_BASE_URL` | **推理网关根地址**：聊天请求发到 `{base}/chat/completions`；登录页/模型设置页 MetaRouter 地址框的预填值 | `https://www.fusionfinlab.com/token-plan/v1` | **`/v1` 要写进值里**，程序只拼 `chat/completions`；末尾多余 `/` 自动去掉 |
| `DLMETA_METAROUTER_MODELS_URL` | **模型清单地址**：登录页「继续」验证 API Key、设置页「拉取模型」都调它 | `{BASE_URL}/models` | 留空 = 程序拼；设了 = 写**完整地址**（含 `/v1/models`），原样使用 |
| `DLMETA_METAROUTER_API_KEY_URL` | 「获取 API Key」按钮打开的发卡页（纯展示链接） | `https://www.fusionfinlab.com/` | 原样使用，不拼接 |

## 二、登录页协议链接（`VITE_` 前缀，构建期注入 renderer）

| 变量 | 干什么 | 留空回落 |
| --- | --- | --- |
| `VITE_ZCODE_TERMS_URL` | 登录页页脚「用户协议」链接 | `https://zcode.z.ai/terms`（上游） |
| `VITE_ZCODE_PRIVACY_URL` | 登录页页脚「隐私政策」链接 | `https://zcode.z.ai/privacy`（上游） |

**构建期注入**（`packages/desktop/vite.config.ts`），改完要**重启 dev / 重新构建**。地址值是法务决定，文本得真实存在。协议授权登录同机制；`/docs` 文档链接不在此列（仍是 C 档）。

## 三、控制面与认证（指向你自己的后端）

这些决定「账号、登录、计费、分享、远控」连谁。给 `DLMETA_BASE_URL` 一个值就同时覆盖 test 和 production 两档：

| 变量 | 干什么 | 备注 |
| --- | --- | --- |
| `DLMETA_BASE_URL` | 控制面 origin：登录、计费、目录刷新、分享 API、远控中继、强更门槛、自更新、image_search MCP **全部自动跟随** | 只改写 origin 恰好等于 `zcode.z.ai` 的 URL；`cdn-zcode.z.ai` / `api.z.ai` / `bigmodel.cn` **不跟**。原 `ZCODE_BASE_URL`（上游同名变量）已改名：与上游 ZCode 共存的机器上机器级 setx 不再互相污染；host 子进程 env 保留 `ZCODE_BASE_URL` 别名字段仅供官方插件 manifest 模板解析 |
| `ZCODE_ENV` | 后端档位：`test` / `production` | dev 启动脚本自动注入，一般不手填 |
| `ZAI_OAUTH_ORIGIN` | Z.ai OAuth 授权页 + userinfo | |
| `ZAI_BUSINESS_BASE_URL` | Z.ai 业务登录、用量/配额 | |
| `BIGMODEL_API_BASE_URL` | BigModel OAuth、用量配额 | |
| `ZAI_OAUTH_CLIENT_ID` | OAuth 应用标识（公开值不是密钥） | 上游值属智谱应用，换自己的 |
| `ZAI_OAUTH_ENABLED` / `BIGMODEL_OAUTH_ENABLED` | `false` = 登录页隐藏该 provider | 认证不走这两族建议直接关 |
| `ZAI_OAUTH_TOKEN_URL` 等 4 条 | token/授权页/userinfo/业务登录端点路径定制 | 不设自动跟随第 1 节 origin 拼接 |
| `BIGMODEL_OAUTH_APP_ID` / `APP_SECRET` | BigModel OAuth 应用凭据 | **`APP_SECRET` 是真凭据：只放 `.env.*.local`，绝不提交** |
| `DLMETA_OAUTH_ALLOW_INSECURE_HTTP` | 放行 http 授权地址（局域网联调） | 仅开发/测试；打包生产绝不带。原 `ZCODE_OAUTH_ALLOW_INSECURE_HTTP` 已改名进 DLMETA_ 命名空间，上游 ZCode 不读 |

前置条件：你的后端要按**同名 path** 实现（`/api/v1/oauth/cli/init` 等），只换域名不改路径。完整路径清单见 example 第 3 节。

## 四、数据目录（`DLMETA_` 前缀）

权威定义在 `packages/shared/src/dataDirName.ts`，规则见 [data-dir-name.md](data-dir-name.md)。

| 变量 | 干什么 | 默认 |
| --- | --- | --- |
| `DLMETA_DATA_DIR_NAME` | 用户数据根的**叶子名**（`~/.dlMeta` 这一段） | `.dlMeta`；只允许启动包装与构建注入点写，业务代码不得读 |
| `DLMETA_DATA_BASE_DIR` | 数据根整体覆盖（上游同义变量 `ZCODE_DATA_BASE_DIR` 互不读取） | `~/{叶子名}` |
| `DLMETA_DESKTOP_USER_DATA_DIR` | Electron userData 目录（登录态/localStorage 落点） | `%APPDATA%/{应用名}` |

效果：同机安装上游 ZCode（数据根 `.zcode`）与本 fork（`.dlMeta`）天然隔离，不靠「打包时记得设变量」。

## 五、运行身份与开发调试（桌面端）

| 变量 | 干什么 | 备注 |
| --- | --- | --- |
| `ZCODE_PREVIEW_IDENTITY` | `1` = 生产后端 + Preview 身份（可与正式版并排安装） | 打包时给 |
| `ZCODE_DESKTOP_APPLICATION_NAME` | 覆盖运行时应用名（连带 userData 目录） | e2e 隔离用 |
| `ZCODE_DESKTOP_HOME_DIR` | 覆盖应用看到的 HOME | e2e 用 |
| `ZCODE_DESKTOP_SESSION_DATA_DIR` | 会话数据目录覆盖 | e2e/Chromedriver 用 |

注：上游时代的 `ZCODE_DESKTOP_USER_DATA_DIR` / `ZCODE_DATA_BASE_DIR` 旧名已不再读取，
统一用第四节的 `DLMETA_*` 变量（改名映射见 data-dir-name.md）。

## 六、可选覆盖（A 档，按需）

| 变量 | 干什么 |
| --- | --- |
| `ZCODE_CONVERSATION_SHARE_WEB_URL` | 分享回链 base（网页端打开分享的地址），自动跟随 origin，一般不用设 |
| `ZCODE_REMOTE_ASSET_CDN_BASE_URL` | SSH 远端运行资产下载地址（上游默认智谱 CDN） |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 内置模型目录指到自己的 JSON（可切断远端刷新） |
| `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` | 用户自配 provider 落盘路径（默认 `~/.dlMeta/v2/provider_config.json`） |

## 七、B 档：构建期才有用（写了 dotenv 没用）

打包时由 `scripts/build-time-config.mjs` 注入 `__ZCODE_*__`，**运行期不读 process.env**——只能作为构建时的环境变量给，然后重新构建：

| 构建时变量 | 干什么 | 置空效果 |
| --- | --- | --- |
| `ZCODE_TELEMETRY_REPORT_ENDPOINT` | 业务事件上报 | 整体 no-op |
| `ZCODE_ARMS_RUM_ENDPOINT` | 阿里云 RUM（含崩溃 minidump） | `enable: false` |
| `ZCODE_AUTO_UPDATE` | 自更新总开关 | 关闭自动更新 |
| `DLMETA_BUILD_DEFAULT_ENDPOINT_ORIGIN` | 灼入默认控制面 origin（`__ZCODE_DEFAULT_ENDPOINT_ORIGIN__`，进桌面 main/host/renderer） | 回落上游 `https://zcode.z.ai`；验证包用它烤本机地址，替代旧「改源码→发布前恢复」；二开自有命名空间，上游 ZCode 不读。原 `ZCODE_BUILD_DEFAULT_ENDPOINT_ORIGIN` 已改名 |

私有构建建议在 CI/打包环境里显式置空前两个。

## 八、C 档：写了也没用（列出来防止白改）

以下不认任何 env，必须改代码（收口顺序见 upstream-service-dependencies.md 第 7 节）：

- 插件市场清单/图标/zip：`cdn-zcode.z.ai`
- Claude 官方插件源：github 仓库 clone 地址
- 内置模型推理地址：`config/provider/zcode-builtin.json` 里的 `open.bigmodel.cn` / `api.z.ai`（×6）
- 超算套餐 URL 重写：`official-coding-plan-gateway.ts` 两条硬编码规则
- 文档链接（值已收口到 `brandIdentity.productDocsUrl`，改 `packages/biz-brand/src/index.ts` 一行，见 docs/brand-identity.md 2.2）、分享落地页 CTA、反馈表单/Discord、Gen-UI iframe 白名单

例外：metarouter 模板的 `baseUrl` / `apiKeyManagementUrl` 虽也在这个 JSON 里，但走占位符在解码时被 `DLMETA_METAROUTER_*` 替换，属于 A 档（见第一节）。

---

## 速查：我改了 X，要做什么才生效

| 改了什么 | 生效动作 |
| --- | --- |
| `DLMETA_METAROUTER_*`、`DLMETA_BASE_URL`、`ZAI_*`、`BIGMODEL_*` | 重启 dev（或重启应用） |
| `VITE_ZCODE_TERMS_URL` / `VITE_ZCODE_PRIVACY_URL` | 重启 dev（vite 构建期注入） |
| dotenv 文件本身新增/改名 | 重启 dev |
| `ZCODE_TELEMETRY_REPORT_ENDPOINT` 等 B 档 | 重新打包构建 |
| 插件市场、内置推理地址（C 档） | 改代码 + 重新构建 |
