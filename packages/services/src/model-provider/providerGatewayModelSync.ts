import type { ProviderSettingsView } from "@zcode/provider";

/**
 * 融智坊（fork）：自托管 OpenAI 兼容网关（MetaRouter）的模型清单不随包内置，
 * 由设置页凭已保存的 API Key 调 `GET {baseUrl}/models` 拉取。
 *
 * <p>执行位置在 Host 节点侧——renderer 直连外部网关会被 CORS 拦截。解析只消费
 * `id` / `display_name`，`type` 非 `chat` 或不支持 `openai` 端点类型的条目跳过，
 * 其余扩展字段忽略：网关后续加字段不影响客户端（见 docs/metarouter-provider.md 第 4 节）。
 * 新模型经 addPersonalModel 领域操作逐个追加（保持拉取顺序，保留用户手工添加的模型）；
 * 不用 overlay 写成员名单——普通 Provider 保存不拥有成员变更，这是配置层的既有边界。</p>
 */

export interface GatewayModelInfo {
  readonly id: string;
  readonly displayName: string;
}

export interface ProviderGatewayModelSyncResult {
  /** 网关当前返回的全部可用模型（已过滤、去重）。 */
  readonly fetched: readonly GatewayModelInfo[];
  /** 本次实际新增到个人层的数量。 */
  readonly addedCount: number;
}

export type ProviderGatewayModelSyncer = (
  providerId: string,
) => Promise<ProviderGatewayModelSyncResult>;

interface GatewayModelsPayload {
  object?: unknown;
  data?: unknown;
}

const REQUEST_TIMEOUT_MS = 15_000;

// 融智坊（fork）：模型清单地址默认取 `{baseUrl}/models`；metarouter 供应商可整体用
// DLMETA_METAROUTER_MODELS_URL 指走（网关把清单挂在别的路径或独立域名时使用）。
// 只对 metarouter 模板的供应商生效，避免用户给其他 OpenAI 兼容供应商时被误改写。
// 见 docs/metarouter-provider.md 第 2 节。
const METAROUTER_TEMPLATE_ID = "metarouter";
const METAROUTER_MODELS_URL_ENV = "DLMETA_METAROUTER_MODELS_URL";

export function createProviderGatewayModelSyncer(deps: {
  getView: () => Promise<ProviderSettingsView>;
  addModel: (providerId: string, modelId: string) => Promise<unknown>;
}): ProviderGatewayModelSyncer {
  return async (providerId) => {
    const view = await deps.getView();
    const provider = view.providers.find((candidate) => candidate.providerId === providerId);
    if (!provider) {
      throw new Error("供应商不存在或已被删除");
    }
    const api = provider.effectiveConfig.api;
    const access = provider.effectiveConfig.access;
    if (api?.type !== "openai-chat-completions") {
      throw new Error("仅 OpenAI 兼容网关支持拉取模型清单");
    }
    const baseUrl = api.baseUrl?.trim().replace(/\/+$/, "");
    const apiKey = access?.type === "api-key" ? (access.apiKey?.trim() ?? "") : "";
    if (!baseUrl || !apiKey) {
      throw new Error("请先填写并保存网关地址与 API Key");
    }
    const envModelsUrl =
      provider.templateId === METAROUTER_TEMPLATE_ID
        ? (process.env[METAROUTER_MODELS_URL_ENV] ?? "").trim()
        : "";
    const response = await fetch(envModelsUrl || `${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const hint = response.status === 401 ? "（API Key 无效或未保存）" : "";
      throw new Error(`网关返回 HTTP ${response.status}${hint}`);
    }
    const payload = (await response.json()) as GatewayModelsPayload;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const fetched: GatewayModelInfo[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const record = row as {
        id?: unknown;
        display_name?: unknown;
        type?: unknown;
        supported_endpoint_types?: unknown;
      };
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (!id || seen.has(id)) continue;
      if (record.type !== undefined && record.type !== "chat") continue;
      if (
        Array.isArray(record.supported_endpoint_types) &&
        !record.supported_endpoint_types.includes("openai")
      ) {
        continue;
      }
      seen.add(id);
      fetched.push({
        id,
        displayName:
          typeof record.display_name === "string" && record.display_name.trim()
            ? record.display_name
            : id,
      });
    }
    const existing = new Set(provider.effectiveConfig.personalModelIds ?? []);
    let addedCount = 0;
    for (const model of fetched) {
      if (existing.has(model.id)) continue;
      await deps.addModel(providerId, model.id);
      existing.add(model.id);
      addedCount += 1;
    }
    return { fetched, addedCount };
  };
}
