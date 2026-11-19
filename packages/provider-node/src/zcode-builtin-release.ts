import { z } from "zod";
import {
  parseZCodeBuiltinModelConfigRules,
  parseZCodeBuiltinProviderConfigRules,
  type ModelConfigRules,
  type ProviderConfigMap,
  type ProviderTemplateMap,
} from "@zcode/provider";

export const ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION = 1 as const;
const RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi";

export interface ZCodeBuiltinConfigContent {
  readonly providers: ProviderConfigMap;
  readonly providerTemplates: ProviderTemplateMap;
  readonly modelConfigRules: ModelConfigRules;
}

export interface ZCodeBuiltinRelease {
  readonly schemaVersion: typeof ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION;
  readonly revision: number;
  readonly config: ZCodeBuiltinConfigContent;
}

const releaseSchema = z
  .object({
    schemaVersion: z.literal(ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    config: z
      .object({
        providerConfigRules: z.unknown(),
        modelConfigRules: z.unknown(),
      })
      .strict(),
  })
  .strict();

// 融智坊（fork）：上游内置清单是静态 JSON，不认环境变量。metarouter 模板的 baseUrl
// 在清单里写成占位标记 `metarouter-base-url-env-placeholder`、发卡页链接写成
// `metarouter-api-key-url-placeholder`，这里在解码收口处统一替换为环境变量值
// （缺省回落融智坊默认值），使 dev（.env 注入 host 进程）与打包（真实进程环境）
// 都能把网关指走。见 docs/metarouter-provider.md 第 2 节。
const METAROUTER_TEMPLATE_ID = "metarouter";
const METAROUTER_BASE_URL_ENV = "DLMETA_METAROUTER_BASE_URL";
const METAROUTER_DEFAULT_BASE_URL = "https://www.fusionfinlab.com/token-plan/v1";
const METAROUTER_API_KEY_URL_ENV = "DLMETA_METAROUTER_API_KEY_URL";
const METAROUTER_DEFAULT_API_KEY_URL = "https://www.fusionfinlab.com/";

function applyMetarouterEnvOverrides(providerConfigRules: unknown): unknown {
  const rawBaseUrl = (process.env[METAROUTER_BASE_URL_ENV] ?? "").trim();
  const baseUrl = (rawBaseUrl || METAROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const rawApiKeyUrl = (process.env[METAROUTER_API_KEY_URL_ENV] ?? "").trim();
  // 发卡页是独立网页，不做去尾斜杠归一（与 baseUrl 拼路径的语义不同），保持原值。
  const apiKeyUrl = rawApiKeyUrl || METAROUTER_DEFAULT_API_KEY_URL;
  const templateRules = (
    providerConfigRules as
      | {
          templateRules?: Array<{
            templateId?: string;
            config?: { api?: { baseUrl?: string }; access?: { apiKeyManagementUrl?: string } };
          }>;
        }
      | undefined
  )?.templateRules;
  for (const rule of templateRules ?? []) {
    if (rule.templateId !== METAROUTER_TEMPLATE_ID) continue;
    if (rule.config?.api) {
      rule.config.api.baseUrl = baseUrl;
    }
    if (rule.config?.access) {
      rule.config.access.apiKeyManagementUrl = apiKeyUrl;
    }
  }
  return providerConfigRules;
}

export function decodeZCodeBuiltinRelease(input: unknown): ZCodeBuiltinRelease {
  const parsed = releaseSchema.parse(input);
  const { providers, providerTemplates } = parseZCodeBuiltinProviderConfigRules(
    applyMetarouterEnvOverrides(parsed.config.providerConfigRules),
  );
  // ZAPI 已退出产品，旧 Remote Release 或 LKG 不能在 Renderer 静态入口删除后
  // 又通过目标 Host Registry 将它重新发布。拒绝整份不兼容 Release，让 Source 回落到兼容候选。
  if (providers.has(RETIRED_ZAPI_PROVIDER_ID)) {
    throw new Error(`ZCode Built-in Release 包含已退出的 Provider: ${RETIRED_ZAPI_PROVIDER_ID}`);
  }
  return Object.freeze({
    schemaVersion: ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: parsed.revision,
    config: Object.freeze({
      providers,
      providerTemplates,
      modelConfigRules: parseZCodeBuiltinModelConfigRules(parsed.config.modelConfigRules),
    }),
  });
}

export function encodeZCodeBuiltinRelease(release: ZCodeBuiltinRelease): object {
  return {
    schemaVersion: ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: release.revision,
    config: {
      providerConfigRules: {
        templateRules: release.config.providerTemplates.toJSON(),
        providerRules: release.config.providers.toJSON(),
      },
      modelConfigRules: release.config.modelConfigRules.toZCodeBuiltinJSON(),
    },
  };
}

export function serializeZCodeBuiltinRelease(release: ZCodeBuiltinRelease): string {
  return JSON.stringify(encodeZCodeBuiltinRelease(release));
}
