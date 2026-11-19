import { useState } from "react";
import { isApiKeyAccess } from "@zcode/provider";
import { LoaderCircle, TriangleAlertIcon } from "lucide-react";
import {
  TID_LOGIN_API_KEY_CANCEL_BUTTON,
  TID_LOGIN_API_KEY_CONTINUE_BUTTON,
  TID_LOGIN_API_KEY_ERROR,
  TID_LOGIN_API_KEY_INPUT,
  TID_LOGIN_API_KEY_SKIP_BUTTON,
} from "@zcode/shared/test-ids";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  buildLoginApiKeyDefaultModelPreferenceFromSelection,
  shouldShowLoginApiKeyLink,
} from "@/login/LoginApiKeyForm.helpers.js";
import { ProviderLogo } from "@/settings/model-provider-section/ProviderLogo.js";
import { useZCodeStore } from "@/store/StoreProvider.js";

/**
 * 融智坊（fork）：登录页 API Key 录入只对接自托管 MetaRouter 网关——
 * 智谱两选项（Z.ai / BigModel）已按产品决策移除（2026-11-18，仍可进主界面后
 * 在模型设置页添加）。验证方式 = 拉一次模型清单（Host 侧 GET {网关}/models 或
 * DLMETA_METAROUTER_MODELS_URL），失败即回滚刚创建的 provider。
 * 见 docs/metarouter-provider.md 第 6 节。
 */
const METAROUTER_TEMPLATE_ID = "metarouter";

interface LoginApiKeyFormProps {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  /** 跳过 = 不写任何 provider 设置直接进主界面（模型需用户稍后自行到模型设置页配置）。 */
  onSkipped: () => void | Promise<void>;
}

export function LoginApiKeyForm({ onCancel, onSaved, onSkipped }: LoginApiKeyFormProps) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const { modelSelectionService, providerSettingsService } = useServices();
  const markApiKeyLoginSuccess = useZCodeStore((state) => state.markApiKeyLoginSuccess);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
  // 网关地址默认取内置模板（已在 Host 解码处按 DLMETA_METAROUTER_BASE_URL 解析），
  // 用户可覆盖；null 表示未编辑过，展示模板默认值。
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null);
  const metarouterTemplate = providerSettingsView?.providerTemplates.find(
    (item) => item.templateId === METAROUTER_TEMPLATE_ID,
  );
  const templateBaseUrl =
    metarouterTemplate?.config.api?.type === "openai-chat-completions"
      ? (metarouterTemplate.config.api.baseUrl ?? "")
      : "";
  const baseUrl = (baseUrlDraft ?? templateBaseUrl).trim();

  const apiKeyUrl = isApiKeyAccess(metarouterTemplate?.config.access)
    ? metarouterTemplate.config.access.apiKeyManagementUrl
    : undefined;
  // 用户已经输入或回填 API Key 后，右侧获取入口会挤占密码输入区域。
  const showApiKeyLink = shouldShowLoginApiKeyLink(apiKeyValue, apiKeyUrl ?? undefined);

  const saveApiKeyProvider = async () => {
    const apiKey = apiKeyValue.trim();
    if (!apiKey) {
      setError(intl.formatMessage({ id: "login.apiKey.emptyError" }));
      return;
    }
    if (!metarouterTemplate || !isApiKeyAccess(metarouterTemplate.config.access)) {
      setError(
        intl.formatMessage(
          { id: "login.apiKey.providerMissingError" },
          { provider: "MetaRouter" },
        ),
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // 用户输入的网关地址覆盖模板 baseUrl，落库路径与设置页一致。
      const created = await providerSettingsService.createPersonalProvider({
        templateId: METAROUTER_TEMPLATE_ID,
        initialConfig: {
          access: { type: metarouterTemplate.config.access.type, apiKey },
          api: {
            type: "openai-chat-completions",
            baseUrl: baseUrl.replace(/\/+$/, ""),
          },
        },
      });
      // 「继续」= 先落库再拉一次模型清单验证：HTTP 401/断网都会在这里失败。
      // 失败即删除刚创建的 provider，避免残留坏配置导致下次登录再创建出重复实例。
      try {
        await providerSettingsService.syncProviderGatewayModels(created.providerId);
      } catch (syncError) {
        await providerSettingsService.deletePersonalProvider(created.providerId);
        setError(
          intl.formatMessage(
            { id: "login.apiKey.validationFailed" },
            { error: syncError instanceof Error ? syncError.message : String(syncError) },
          ),
        );
        return;
      }
      const defaultModelPreference = buildLoginApiKeyDefaultModelPreferenceFromSelection(
        await modelSelectionService.getView(),
        created.providerId,
      );
      markApiKeyLoginSuccess(defaultModelPreference);
      await onSaved();
    } catch (saveError) {
      logger.error("[LoginEntry] 保存 API Key provider 失败", {
        templateId: METAROUTER_TEMPLATE_ID,
        error: saveError,
      });
      setError(
        intl.formatMessage(
          { id: "login.apiKey.saveError" },
          {
            error: saveError instanceof Error ? saveError.message : String(saveError),
          },
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const skipLogin = async () => {
    setSkipping(true);
    setError(null);
    try {
      // 跳过不写任何 provider 设置（MetaRouter 无 family 域概念），直接以未配置状态进主界面。
      await onSkipped();
    } catch (skipError) {
      logger.error("[LoginEntry] 跳过 API Key 登录失败", {
        error: skipError,
      });
      setError(
        intl.formatMessage(
          { id: "login.apiKey.skipError" },
          {
            error: skipError instanceof Error ? skipError.message : String(skipError),
          },
        ),
      );
    } finally {
      setSkipping(false);
    }
  };

  const busy = saving || skipping;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "login.apiKey.title" })}
        </h2>
        <div className="space-y-2">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-ui-base text-foreground">
            <ProviderLogo logo={{ type: "builtin", key: METAROUTER_TEMPLATE_ID }} className="size-4" />
            {intl.formatMessage({ id: "login.apiKey.provider.metarouter" })}
          </div>
          <Input
            id="login-metarouter-base-url"
            type="text"
            size="lg"
            className="h-10 w-full text-ui-base"
            value={baseUrl}
            placeholder={intl.formatMessage({ id: "login.apiKey.baseUrl.placeholder" })}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => setBaseUrlDraft(event.target.value)}
          />
          <div className="relative">
            <Input
              id="login-api-key"
              type="password"
              size="lg"
              className={`h-10 w-full text-ui-base ${showApiKeyLink ? "pr-28" : ""}`}
              data-testid={TID_LOGIN_API_KEY_INPUT}
              aria-label={intl.formatMessage({
                id: "login.apiKey.placeholder",
              })}
              value={apiKeyValue}
              placeholder={intl.formatMessage({
                id: "login.apiKey.placeholder",
              })}
              autoComplete="off"
              onChange={(event) => {
                setApiKeyValue(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && apiKeyValue.trim() && !busy) {
                  void saveApiKeyProvider();
                }
              }}
            />
            {showApiKeyLink ? (
              <button
                type="button"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ui-base font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  if (apiKeyUrl) {
                    platform.openExternal(apiKeyUrl);
                  }
                }}
              >
                {intl.formatMessage({ id: "login.apiKey.getApiKey" })}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" data-testid={TID_LOGIN_API_KEY_ERROR}>
          <TriangleAlertIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col items-center gap-2">
        <Button
          type="button"
          className="h-10 w-fit min-w-50 px-6 text-ui-base font-medium"
          size="lg"
          data-testid={TID_LOGIN_API_KEY_CONTINUE_BUTTON}
          disabled={!apiKeyValue.trim() || !baseUrl.trim() || busy}
          onClick={() => void saveApiKeyProvider()}
        >
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.apiKey.continue" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-fit min-w-50 px-6 text-ui-base font-medium"
          size="lg"
          data-testid={TID_LOGIN_API_KEY_CANCEL_BUTTON}
          disabled={busy}
          onClick={onCancel}
        >
          {intl.formatMessage({ id: "login.apiKey.cancel" })}
        </Button>
        <Button
          type="button"
          variant="link"
          className="mt-0.5 h-7 w-fit text-ui-base text-foreground-subtle hover:text-foreground"
          data-testid={TID_LOGIN_API_KEY_SKIP_BUTTON}
          disabled={busy}
          onClick={() => void skipLogin()}
        >
          {skipping ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.skip" })}
        </Button>
      </div>
    </div>
  );
}
