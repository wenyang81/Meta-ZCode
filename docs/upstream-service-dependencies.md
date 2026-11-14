# 上游服务依赖清单

本 fork（融智坊 / FusionFinLab）继承自 `zai-org/zcode`，运行期会向智谱侧托管服务发起请求。
这份清单把**所有出站依赖**按「能不能不改代码就指走」分档，供二开决策使用：哪些必须自建、
哪些换个环境变量就够、哪些只是文案链接可以慢慢改。

只登记运行期真实发起的请求。构建期产物（图标栅格化、fork 改动清单）不在此列。

## 判定口径

| 档 | 含义 | 处置成本 |
| --- | --- | --- |
| **A 运行期 env 可指走** | 存在环境变量或用户配置，改值即生效，无需动代码 | 低：配置即可 |
| **B 仅构建期 define** | 值在打包时注入（`__ZCODE_*__`），运行期不可改 | 中：需重新构建 |
| **C 硬编码，必须改码** | 字面量直接写在源码或随包 JSON 里，env 覆盖不到 | 高：改代码并补 seam |

分档依据是一个容易误判的机制：`rewriteZCodeEndpointUrl()`
（[packages/shared/src/zcodeEndpoint.ts:388](../packages/shared/src/zcodeEndpoint.ts)）
只改写 **origin 恰好等于 `https://zcode.z.ai`** 的 URL。所以把 `ZCODE_BASE_URL` 指到自己的网关，
只会带走 `zcode.z.ai` 这一族，`cdn-zcode.z.ai`、`cdn.codegeex.cn`、`open.bigmodel.cn` 都不受影响。
另一处易误判：OAuth provider 配置里的字面量（如
[packages/services/src/oauth/providers/zaiProviderConfig.ts:22](../packages/services/src/oauth/providers/zaiProviderConfig.ts)）
只是 fallback，`createZaiProviderRuntimeConfig()` 会按 env 重新解析，所以认证属于 A 档而不是 C 档。

## 1. 账号与认证（全部 A 档）

| 服务 | 默认地址 | 发起进程 / 传输 | env 开关 |
| --- | --- | --- | --- |
| ZCode 控制面 origin | `https://zcode.z.ai`（`zcodeEndpoint.ts:3`，TEST 与 DEFAULT **同域**） | Host，HTTPS REST | `ZCODE_ENV`、`ZCODE_BASE_URL`、`ZCODE_ENDPOINT_ORIGIN`、`ZCODE_{TEST,PRODUCTION}_BASE_URL` |
| 设备码式登录 | `/api/v1/oauth/cli/init`、`/api/v1/oauth/cli/poll/{flowId}`、`/api/v1/oauth/profile` | Host + Agent CLI，REST 轮询 | 同上 |
| OAuth 换 token / 刷新 | `/api/v1/oauth/token` | Host，REST | `ZAI_OAUTH_TOKEN_URL`、`BIGMODEL_OAUTH_TOKEN_URL` |
| Z.ai 授权页 / 用户信息 | `https://chat.z.ai/api/oauth/authorize`、`/api/oauth/userinfo` | 浏览器流程 + Host REST | `ZAI_OAUTH_AUTHORIZE_URL`、`ZAI_OAUTH_ORIGIN`、`ZAI_OAUTH_CLIENT_ID`（当前公开 client_id `client_P8X5CMWmlaRO9gyO-KSqtg`） |
| Z.ai 业务登录 | `https://api.z.ai/api/auth/z/login` | Host + CLI，REST | `ZAI_BUSINESS_BASE_URL`、`ZAI_BUSINESS_LOGIN_URL` |
| BigModel 授权 / 用户信息 | `https://bigmodel.cn/login`、`/api/biz/customer/getCustomerInfo` | 浏览器流程 + Host REST | `BIGMODEL_OAUTH_*`、`BIGMODEL_API_BASE_URL`、`BIGMODEL_OAUTH_APP_ID`（appId 当前为 `"zcode"`） |
| 套餐与计费 | `/api/v1/zcode-plan/billing/{current,balance,preview,claim}`、`/pay/batch-preview`、`/api/biz/subscription/list` | Host，REST | 随 `ZCODE_BASE_URL` / `ZAI_BUSINESS_BASE_URL` / `BIGMODEL_API_BASE_URL` |

登录态恢复依赖 userinfo，**不能离线进入主界面**；应用本身可以在全部域名不可达时启动（见第 6 节）。

## 2. 模型推理

| 服务 | 默认地址 | 档位 | 说明 |
| --- | --- | --- | --- |
| 控制面模型网关 | `https://zcode.z.ai/api/v1/{zcode-plan,off-peak,highspeed}/anthropic` | **A** | Start/闲时/高速套餐，Anthropic 兼容 `/v1/messages` |
| Coding Plan 直连 | `https://api.z.ai/api/anthropic`、`https://open.bigmodel.cn/api/anthropic` | **C** | 写在随包 `config/provider/zcode-builtin.json` 里；`rewriteZCodeEndpointUrl` 改不到 `open.bigmodel.cn` |
| 超算套餐 URL 重写 | `open.bigmodel.cn:443/api/anthropic/v1/messages` → `${origin}/api/v1/ultra/...` | **C** | [apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts:9](../apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts)，两条重写规则硬编码 |
| 标准 API 模板 | `api.z.ai/api/paas/v4`、`open.bigmodel.cn/api/paas/v4` | **A** | 用户填 key 的模板，不自动启用 |
| 第三方模板（Kimi/DeepSeek/OpenAI/Anthropic/OpenRouter/Ark/Dashscope…） | 各自官方域 | 不适用 | 用户自配，与智谱无关 |
| 内置目录远端刷新 | `GET {origin}/api/v1/client/configs` → 响应内签名 URL → CDN 取 `zcode-builtin.json` | **A** | 60s 轮询、成功间隔 1 小时、失败指数退避并回退随包版本（LKG） |
| 托管 image_search MCP | `${ZCODE_BASE_URL}/api/v1/mcp/server/image_search` | **A** | 插件自带 `.mcp.json` |
| 个人 provider 配置 | 本地 `~/.zcode/v2/provider_config.json` | — | 唯一写者 `ProviderConfigService`；`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 可改路径 |

无强制默认模型：CLI 明确禁止取「Registry 首项」
（[apps/zcode-cli/packages/bootstrap/src/app/runtime-config.ts:66](../apps/zcode-cli/packages/bootstrap/src/app/runtime-config.ts)），
新会话可以完全不绑模型。**因此「模型只用自己的 provider」在架构上成立**，前提是绕开第 2 行的两个 C 档地址。

## 3. 内容分发与更新

| 服务 | 默认地址 | 档位 | 失败行为 |
| --- | --- | --- | --- |
| 插件市场清单 | `https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json` | **C** | 静默按插件降级；UI 对 Claude 源隐藏 `refreshFailure` |
| 插件图标 | 同 CDN `/assets/` + `icon-sources.json` | **C** | 图片裂开 |
| 插件 zip | 同 CDN `/plugins/<name>/<version>/plugin.zip`（sha256 校验） | 由清单给出 | 安装报错上抛 |
| Claude 官方插件源 | git clone `https://github.com/anthropics/claude-plugins-official.git` | **C** | 静默 |
| 强制更新门槛 | `GET {origin}/api/v1/client/configs` 的 `minimalVersion` | **A** | fail-open；dev/preview 直接跳过 |
| 应用自动更新 | `GET {origin}/api/v1/releases/electron/manifest`（自定义 `ManifestUpdateProvider`，非 electron-updater 默认） | **A** | 提示「检查更新失败」，不阻塞启动；签名走 `verifyUpdateCodeSignature` + 自定义 NSIS 校验 |
| SSH 远端运行资产 | `https://cdn-zcode.z.ai/zcode/electron/releases`、国内 `https://cdn.codegeex.cn/...` | **B** | 构建 define `__ZCODE_REMOTE_CDN_RELEASE_ROOTS__`；运行期有 `ZCODE_REMOTE_ASSET_CDN_BASE_URL` |

## 4. 遥测与崩溃（构建期开关，可整体关掉）

| 服务 | 默认地址 | 档位 | 说明 |
| --- | --- | --- | --- |
| 业务事件上报 | `POST {origin}/api/v1/event/report` | **B** | define `__ZCODE_TELEMETRY_REPORT_ENDPOINT__`，置空即 no-op |
| 阿里云 ARMS RUM | 构建注入 | **B** | 含 Crashpad **minidump 抓取**（`patches/@arms/rum-electron@0.0.3.patch`），置空即 `enable:false` |
| 营销触点 | `/api/v1/marketing/touch[/action]` | **A** | 带 `deviceMid`；只管 banner/popup 投放 |
| CLI OTLP | `OTEL_EXPORTER_OTLP_*ENDPOINT` | **A** | 标准 OTel env |

两条遥测路径都在**登录前**就用匿名 `deviceMid`（存于 `telemetry-state.json`）上报，且源码里没有
面向用户的遥测开关。私有构建应把两个 build define 置空。

## 5. 分享、远控与第三方

| 服务 | 默认地址 | 档位 |
| --- | --- | --- |
| 会话分享 API | `${origin}/api/v1/shares/*`，产物 PUT 到服务端签名的 `download_url` | **A** |
| 分享落地页 CTA | `https://zcode.z.ai`（`packages/web/src/share/ConversationShareLandingPage.tsx:102`） | **C** |
| 分享页 base / 回调 | `{origin}/cn/share`、`/cn/share/callback` | A（`ZCODE_CONVERSATION_SHARE_WEB_URL`） |
| 手机远控中继 | `wss://zcode.z.ai/api/v1/remote/ws2` + `/api/v1/remote/{device,token,notification/*}` | **A** |
| 飞书 / Lark | `open.feishu.cn`、`accounts.feishu.cn`、`applink.feishu.cn`、`*.larksuite.com` | **C** |
| 微信 iLink / Telegram | `ilinkai.weixin.qq.com`、`api.telegram.org` | **C** |
| 反馈表单 / 社区 | `config/default.json:2-7` 里烤进飞书表单与 Discord 邀请 | 可远端覆盖，本地兜底是 C |
| 用户协议 / 隐私 | `https://zcode.z.ai/{terms,privacy}` | **A**（2026-11-15 起：`VITE_ZCODE_TERMS_URL` / `VITE_ZCODE_PRIVACY_URL`，构建期注入 renderer，见 `.env.fusionfinlab` 第 4 节；文档链接仍为 C） |
| 奖励 / 更新日志页 | `{origin}/(cn|en)/{rewards,changelog}` | **A** |
| Gen-UI iframe CSP 白名单 | 含 `zcode.z.ai` 与公共 CDN（jsdelivr/unpkg/esm.sh/gstatic…） | **C** |
| 打包元数据 | `homepage https://zcode.z.ai`、`maintainer "ZCode <dev@zcode.z.ai>"` | **C**（仅影响 Linux .desktop 等） |

## 6. 离线与未登录可运行性

- **可离线启动**：强制更新 fail-open、遥测可空、内置目录回退随包版本，全部域名不可达时窗口仍能创建。
- **不能离线使用**：登录、登录态恢复、套餐 entitlement、插件市场刷新、分享、手机远控。
- **未登录可见**：模型设置的两条预设供应商与定价卡片（`Authorization` 仅在存在 JWT 时附加，
  详情页传 `remotePreviewEnabled: false`，静态卡片照常渲染）。

## 7. 处置建议

1. **先做 A 档**：一组 env（`ZCODE_BASE_URL`、`ZAI_*`、`BIGMODEL_*`、`ZCODE_TELEMETRY_REPORT_ENDPOINT`、
   `ZCODE_ARMS_RUM_ENDPOINT`）把控制面、认证、计费、遥测整体指到自己的后端，不动代码即可跑通。
   注意 `ZCODE_ENV=test` 与 production 默认同域，指走时两边都要给。
2. **再收 C 档里的三处硬骨头**：插件市场 CDN、`zcode-builtin.json` 内的 `open.bigmodel.cn`/`api.z.ai`
   推理地址、以及超算套餐重写。这三处决定「完全不碰智谱托管」能否成立，建议按 seam 方式集中到
   `packages/biz-brand` 之外的新受控模块（如 `biz-endpoints`），而不是散点替换。
3. **C 档里的文案类**（docs 链接、分享落地页 CTA、打包 homepage）等真实域名定了再改；
   terms/privacy 已升 A 档（见上表），只差你把 URL 填进 `.env.fusionfinlab`。
4. **B 档**在每次正式构建的 env 里固化，写进 CI 变量清单即可，不改源码。

## 验收场景

1. 仅设置 A 档 env、不改任何代码时，登录与聊天走自建后端，日志中不出现 `zcode.z.ai` 请求。
2. 断网启动：窗口正常创建，无未捕获异常；恢复网络后市场与 entitlement 能自刷新。
3. 置空两个遥测 define 后重新构建，抓包无 `event/report` 与 ARMS 上报。
4. 完成 C 档收口后，`grep -rn "cdn-zcode\.z\.ai\|open\.bigmodel\.cn\|zcode\.z\.ai" packages apps config` 的
   剩余命中全部落在「明确保留」列表内（Apache-2.0 归属文本、上游注释、以及尚未处理项）。

## 相关代码

- [packages/shared/src/zcodeEndpoint.ts](../packages/shared/src/zcodeEndpoint.ts) — 域名集中定义、env 解析、`rewriteZCodeEndpointUrl`
- [packages/shared/src/plugin-marketplaces.ts](../packages/shared/src/plugin-marketplaces.ts) — 市场清单与 Claude 源
- [packages/services/src/oauth/providers/](../packages/services/src/oauth/providers/) — Z.ai / BigModel provider 配置与 env 重解析
- [packages/provider-node/src/zcode-builtin-remote-synchronizer.ts](../packages/provider-node/src/zcode-builtin-remote-synchronizer.ts) — 内置目录远端刷新与 LKG 回退
- [packages/desktop/src/main/forceUpdateGuard.ts](../packages/desktop/src/main/forceUpdateGuard.ts) — 强制更新门槛与 fail-open
- [packages/desktop/src/main/manifestUpdateProvider.ts](../packages/desktop/src/main/manifestUpdateProvider.ts) — 自更新清单
- [packages/shared/src/env.ts](../packages/shared/src/env.ts) — 遥测与自动更新的构建期 define
