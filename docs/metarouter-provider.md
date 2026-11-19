# MetaRouter 供应商接入规范（融智坊）

> 状态：已实现（本 spec 与实现同轮落地）。上游同步时注意：本文描述的分组、预设列表、
> 内置模板均为 fork 改动，合并上游若冲突以「融智坊产品优先」为准。
> 关联：[品牌身份](brand-identity.md)、[上游服务地址分档](upstream-service-dependencies.md)。

## 1. 背景与产品规则

模型设置页原来是上游的智谱家族（Z.ai / Start Plan / BigModel）。融智坊fork 里，
客户端的推理流量走自家的 MetaRouter 网关，规则改为：

- **左侧列表**：默认只有「融智坊」组与 MetaRouter 一个条目；上游智谱预设
  （Z.ai / Start Plan）不再出现在默认列表。
- **添加供应商目录**：顶部新增「融智坊」组，只放 MetaRouter 卡片；原「智谱」组
  取消，四个模板（Z.ai Coding Plan / Z.ai API / BigModel Coding Plan / BigModel API）
  并入「其他」组——上游产品仍可添加，只是不再置顶、不再预置。
- **连接方式**：MetaRouter 走 API Key（与其他 OpenAI 兼容供应商一致，设置页粘贴密钥）。
- **模型清单**：不写死。凭已保存的 API Key 调网关 `GET {baseUrl}/models`
  （OpenAI `/v1/models` 形状），拉回的模型写入该供应商的个人层配置
  （`personalModelIds`），聊天页与设置页模型列表照常渲染。

## 2. 地址与环境变量（A 档：运行时 env）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DLMETA_METAROUTER_BASE_URL` | `https://www.fusionfinlab.com/token-plan/v1` | MetaRouter 网关 OpenAI 兼容根地址（含 `/v1`）；聊天 `{base}/chat/completions`，模型清单默认 `{base}/models` |
| `DLMETA_METAROUTER_MODELS_URL` | `{DLMETA_METAROUTER_BASE_URL}/models` | 模型清单地址（2026-11-18 登录页接入时新增）：登录页与设置页「拉取模型」都改走它验证 API Key 并取模型列表。仅对 metarouter 模板的供应商生效，不误伤其他 OpenAI 兼容供应商；网关把清单挂在别的路径或独立域名时才需要单独给 |
| `DLMETA_METAROUTER_API_KEY_URL` | `https://www.fusionfinlab.com/` | 「获取 API Key」发卡页链接（2026-11-18 env 化）：登录页与设置页的获取入口。三个 MetaRouter env 统一 `DLMETA_` 前缀（2026-11-18 用户指定，自 `ZCODE_` 改名）；默认值同日改为站点根（原 `/token-plan/`） |

- 内置清单里 metarouter 模板的 `baseUrl` 写的是占位标记
  `metarouter-base-url-env-placeholder`，`access.apiKeyManagementUrl`（发卡页）写的是
  `metarouter-api-key-url-placeholder`，两者在内置清单解码收口处
  （`packages/provider-node/src/zcode-builtin-release.ts`）统一替换为 env 值。
  上游 `zcode-builtin.json` 是静态 JSON 不认 env，这个替换是 fork 行为。
- dev/打包都读同一变量；打包发布按 `.env.fusionfinlab.example` 注入。

## 3. 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 内置模板（metarouter 卡片、默认 baseUrl） | `config/provider/zcode-builtin.json`（prod）与 `zcode-builtin.test.json`（dev），schema 见 `packages/provider/src/config/provider-data-schema.ts` | 两份都要加，`revision` 各自 +1 |
| 家族元数据（组名、图标、按 host 归族） | `packages/shared/src/model-provider-family.ts`（`MODEL_PROVIDER_FAMILY_SPECS` 加 `metarouter`） | `resolveModelProviderFamilyIdByBaseURL` 按 `www.fusionfinlab.com` 归族 |
| 左侧列表默认可见性 | `packages/ui/src/settings/model-provider-section/`（`constants.ts` 预设、`ProviderTemplatePicker.tsx` 分组） | fork 改动：智谱预设与置顶组让位 |
| 用户实例（API Key、personalModelIds） | `~/.zcode/v2/provider_config.json`（`packages/provider-node/src/personal-provider-config-repository.ts`） | UI 保存走 `providerPersonalSave.ts` 既有路径，本特性不新增落盘格式 |
| 远端模型清单 | 网关 `GET {base}/models`，Bearer API Key | 拉取动作在设置页触发；结果映射为 `personalModelIds` |

## 4. 接口契约（网关）

- `GET {base}/models`，头 `Authorization: Bearer <apiKey>`。
- 响应：`{"object":"list","data":[{ "id","object":"model","owned_by","display_name",
  "description","type":"chat","supported_endpoint_types":["openai"], ... }]}`。
- 客户端只消费 `id`（+ `display_name` 作展示名，缺省回落 `id`）；`type !== "chat"`
  或不支持 `openai` 端点类型的条目跳过；其余扩展字段忽略——网关以后加字段不影响客户端。

## 5. 验收场景

1. 冷启动 → 模型设置左侧只有「融智坊」组 + MetaRouter；添加供应商目录顶部是
   「融智坊」组（MetaRouter 卡片），智谱四项出现在「其他」组末尾。
2. 选 MetaRouter → 粘贴 API Key → 保存后点「拉取模型」→ 列表出现网关返回的模型；
   Key 错误/断网 → 显示失败提示，不改本地已存模型。
3. `DLMETA_METAROUTER_BASE_URL` 指向局域网网关 → 请求打到该地址（抓包/日志确认），
   不出现对上游 `*.z.ai` / `bigmodel.cn` 的推理请求。
4. 聊天页可选 MetaRouter 拉取到的模型并正常对话。

## 6. 登录页接入（2026-11-18）

欢迎页「使用 API key」**只对接 MetaRouter 网关**：Z.ai / BigModel 两个选项已按产品决策
从登录页移除（同日二次决策），登录表单不再有供应商下拉——固定渲染 MetaRouter 品牌行 +
「网关地址」+「API Key」三个输入位。上游供应商仍可在进入主界面后的模型设置页添加。

- **表单**：网关地址默认值取内置模板的 baseUrl（即 `DLMETA_METAROUTER_BASE_URL` 在 Host
  解码收口处已解析的值），可覆盖；「获取 API Key」链接用模板的 `apiKeyManagementUrl`。
- **验证**：点「继续」= 先 `createPersonalProvider`（api.baseUrl 用用户输入覆盖模板），
  再复用设置页同一条 `syncProviderGatewayModels` 服务调用拉取模型清单——清单地址按
  `DLMETA_METAROUTER_MODELS_URL`（缺省 `{base}/models`）。HTTP 401/断网/清单为空等失败
  会在这一步暴露。
- **失败回滚**：验证失败即删除刚创建的 provider 并显示错误，避免残留坏配置导致下次
  登录再创建出重复实例；成功则写默认模型偏好、`markApiKeyLoginSuccess` 进入主界面。
- **跳过按钮**：「暂时跳过」保留在「取消」下方，**不写任何 provider 设置**（含不写
  `providerFamilyDomain`——MetaRouter 无 family 概念），直接以未配置状态走
  `onComplete("skip")` 进主界面；模型需用户稍后到模型设置页自行配置。
- **执行位置**：模型清单请求在 Host 侧（`providerGatewayModelSync.ts`），renderer 直连
  外部网关会被 CORS 拦截；env 读取也在 Host 进程。
- **随选项移除的死代码**：helpers 的 provider 选择/跳过函数与 locale 的
  `login.apiKey.provider.{zai,bigmodel}`、`login.apiKey.providerLabel`、`login.skip`
  键已删；`TID_LOGIN_API_KEY_PROVIDER_*` / `TID_LOGIN_API_KEY_SKIP_BUTTON` 测试 id 仍留在
  shared 注册表（pending 测试目录仍在引用，随其复核一并清理）。

验收场景：

1. 登录页「使用 API key」只有 MetaRouter 一个供应商位；地址留空（用 env 默认）+ 正确 Key
   → 「继续」后直接进入主界面，模型设置里能看到该 provider 与拉取到的模型清单。
2. 故意填错 Key → 「继续」后报「网关验证失败：…HTTP 401…」，设置页不出现半成品 provider。
3. 设置 `DLMETA_METAROUTER_MODELS_URL` 指向独立清单地址 → 登录验证与设置页「拉取模型」
   都打到该地址（抓包确认），聊天推理仍走 `{base}/chat/completions`。
4. 登录页地址输入框改成局域网地址 → 请求打到该地址（`DLMETA_METAROUTER_BASE_URL` 不再参与
   该实例）。
