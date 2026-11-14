# 本 fork 相对上游的改动清单

本文件由 `node scripts/fork-changes.mjs` 生成，请勿手工编辑；发布或对外分发源码前重跑一次。

用途：Apache-2.0 第 4(b) 条要求分发修改版时对被修改的文件给出显著说明。本 fork 不在上游源文件里逐个加“已修改”头注释（那会把同步冲突面扩大到每个 seam），改为集中提供本清单，配合 git 历史与 [上游同步规范](upstream-sync.md)、[品牌身份 seam](brand-identity.md) 一起构成修改声明。

- 生成时间：2026-11-14 17:04:51 UTC
- 比较基线：`fec975905a`（merge-base HEAD upstream/main）
- 工作区状态：已跟踪改动 168 个文件，未跟踪新增 0 个文件

状态含义：`M` 修改、`A` 新增、`D` 删除、`R` 重命名、`?` 未跟踪（尚未提交）。

## (仓库根)（7）

- `A` .env.fusionfinlab.example
- `M` .gitignore
- `M` AGENTS.md
- `M` architecture-policy.yaml
- `M` NOTICE.md
- `M` package.json
- `M` pnpm-lock.yaml

## apps/zcode-cli/（27）

- `M` apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts
- `M` apps/zcode-cli/packages/adapters/src/commands/roots.ts
- `M` apps/zcode-cli/packages/adapters/src/config/file-config.adapter.ts
- `M` apps/zcode-cli/packages/adapters/src/context/index.ts
- `M` apps/zcode-cli/packages/adapters/src/device/cli-device-mid.ts
- `M` apps/zcode-cli/packages/adapters/src/exec/execution-utils.ts
- `M` apps/zcode-cli/packages/adapters/src/logging/index.ts
- `M` apps/zcode-cli/packages/adapters/src/memory-diagnostics/index.ts
- `M` apps/zcode-cli/packages/adapters/src/model/runner-debug.ts
- `M` apps/zcode-cli/packages/adapters/src/skills/roots.ts
- `M` apps/zcode-cli/packages/adapters/src/storage/session-store/paths.ts
- `M` apps/zcode-cli/packages/adapters/src/storage/workspace-hook-trust-store.ts
- `M` apps/zcode-cli/packages/adapters/src/workflow/index.ts
- `M` apps/zcode-cli/packages/bootstrap/src/app/create-app.ts
- `M` apps/zcode-cli/packages/bootstrap/src/app/script-workflow-tool-port.ts
- `M` apps/zcode-cli/packages/bootstrap/src/app/script-workflow-utils.ts
- `M` apps/zcode-cli/packages/bootstrap/src/provider-endpoint-routing-source-headers.ts
- `M` apps/zcode-cli/packages/bootstrap/src/zcode-protocol-entrypoint.ts
- `M` apps/zcode-cli/packages/cli/src/clipboard-image.ts
- `M` apps/zcode-cli/packages/cli/src/provider-runtime-env.ts
- `M` apps/zcode-cli/packages/cli/src/sea-runtime-tools.ts
- `M` apps/zcode-cli/packages/contracts/src/config/index.ts
- `M` apps/zcode-cli/packages/contracts/src/tools/saved-workflow.ts
- `M` apps/zcode-cli/packages/core/src/memory/memory-file-path.ts
- `M` apps/zcode-cli/packages/debug/server/sources.ts
- `M` apps/zcode-cli/packages/telemetry/package.json
- `M` apps/zcode-cli/packages/telemetry/src/bootstrap.ts

## docs/（7）

- `A` docs/brand-identity.md
- `A` docs/data-dir-name.md
- `M` docs/development-mise-runtime.md
- `A` docs/fusionfinlab-local-run.md
- `A` docs/fusionfinlab-packaging.md
- `A` docs/upstream-service-dependencies.md
- `A` docs/upstream-sync.md

## docs/desktop/（2）

- `M` docs/desktop/configurable-data-directory.md
- `M` docs/desktop/windows-installer-overhaul-spec.md

## packages/biz-brand/（7）

- `A` packages/biz-brand/package.json
- `A` packages/biz-brand/src/contract.example.ts
- `A` packages/biz-brand/src/CONTRACT.md
- `A` packages/biz-brand/src/contract.ts
- `A` packages/biz-brand/src/index.ts
- `A` packages/biz-brand/src/module.ts
- `A` packages/biz-brand/tsconfig.json

## packages/desktop/（38）

- `M` packages/desktop/build/icon_installer.ico
- `M` packages/desktop/build/icon_installer.png
- `M` packages/desktop/build/icon_windows.png
- `M` packages/desktop/build/icon.ico
- `M` packages/desktop/build/icon.png
- `M` packages/desktop/build/icons/1024x1024.png
- `M` packages/desktop/build/icons/128x128.png
- `M` packages/desktop/build/icons/16x16.png
- `M` packages/desktop/build/icons/24x24.png
- `M` packages/desktop/build/icons/256x256.png
- `M` packages/desktop/build/icons/32x32.png
- `M` packages/desktop/build/icons/48x48.png
- `M` packages/desktop/build/icons/512x512.png
- `M` packages/desktop/build/icons/64x64.png
- `M` packages/desktop/electron-builder.config.js
- `M` packages/desktop/package.json
- `M` packages/desktop/scripts/desktop-product-identity.mjs
- `A` packages/desktop/scripts/render-brand-icons.mjs
- `M` packages/desktop/src/host/index.ts
- `M` packages/desktop/src/host/remotePromptAttachments.ts
- `M` packages/desktop/src/host/sourceServerDirectory.ts
- `M` packages/desktop/src/main/about.ts
- `M` packages/desktop/src/main/aboutWindow.ts
- `M` packages/desktop/src/main/desktopApplicationLocaleBootstrap.ts
- `M` packages/desktop/src/main/desktopApplicationMenu.ts
- `M` packages/desktop/src/main/desktopChromiumHardwareAccelerationBootstrap.ts
- `M` packages/desktop/src/main/desktopCommandHandlers.ts
- `M` packages/desktop/src/main/desktopDataBaseDirBootstrap.ts
- `M` packages/desktop/src/main/desktopHostProcess.ts
- `M` packages/desktop/src/main/desktopRuntimeEnv.ts
- `M` packages/desktop/src/main/desktopTray.ts
- `M` packages/desktop/src/main/exportLogs.ts
- `M` packages/desktop/src/main/index.ts
- `M` packages/desktop/src/main/mcpUserDirectory/index.ts
- `M` packages/desktop/src/renderer/index.html
- `M` packages/desktop/test/desktopProductIdentity.test.ts
- `M` packages/desktop/tsup.config.ts
- `M` packages/desktop/vite.config.ts

## packages/server/（6）

- `M` packages/server/src/remote/connect.ts
- `M` packages/server/src/remote/deployShared.ts
- `M` packages/server/src/remote/zcodeAgentBundleWrapper.ts
- `M` packages/server/src/remote/zcodeAgentDevDeploy.ts
- `M` packages/server/src/source-server/sourceServerProbe.ts
- `M` packages/server/src/source-server/transportAdapter.ts

## packages/services/（27）

- `M` packages/services/src/commands/commandsService.ts
- `M` packages/services/src/data-sync/commandDataSync.ts
- `M` packages/services/src/data-sync/hookDataSync.ts
- `M` packages/services/src/data-sync/skillDataSync.ts
- `M` packages/services/src/feedback/compactLogArchive.ts
- `M` packages/services/src/hooks/hooksService.ts
- `M` packages/services/src/mcp-sync/mcpSyncService.ts
- `M` packages/services/src/node.ts
- `M` packages/services/src/onboarding/localUsageEvidence.ts
- `M` packages/services/src/paths.ts
- `M` packages/services/src/plugin-sync/pluginSyncService.ts
- `M` packages/services/src/project-storage/default-workspace/migration.ts
- `M` packages/services/src/project-storage/migrate-projects.ts
- `M` packages/services/src/runtime-tools/providerRuntimeResolver.ts
- `M` packages/services/src/session/sourceServerWorkspaceAliasRepo.ts
- `M` packages/services/src/setting/settingService.ts
- `M` packages/services/src/settings-sync/settingsSyncService.ts
- `M` packages/services/src/skill-sync/skillSyncService.ts
- `M` packages/services/src/skills/skillsService.ts
- `M` packages/services/src/storage/adapters/rootsResolver.ts
- `M` packages/services/src/subagents/subagentRuntimeConfig.ts
- `M` packages/services/src/subagents/subagentsService.ts
- `M` packages/services/src/subagents/subagentStorage.ts
- `M` packages/services/src/telemetry/telemetryCore.ts
- `M` packages/services/src/zcode-agent/modelTrajectoryFileTail.ts
- `M` packages/services/src/zcode-agent/zcodeAgentService.ts
- `M` packages/services/src/zcode-agent/zcodeTaskServiceAdapter.ts

## packages/shared/（9）

- `A` packages/shared/src/dataDirName.ts
- `M` packages/shared/src/desktopMenu.ts
- `M` packages/shared/src/index.ts
- `M` packages/shared/src/managed-worktree/layout.ts
- `M` packages/shared/src/managed-worktree/module.ts
- `M` packages/shared/src/workspace-hook-config.ts
- `M` packages/shared/src/workspace-hook-mutation.ts
- `M` packages/shared/src/zcode-agent-runtime.ts
- `A` packages/shared/test/dataDirName.test.ts

## packages/ui/（21）

- `M` packages/ui/package.json
- `M` packages/ui/src/App.tsx
- `D` packages/ui/src/assets/Z.svg
- `M` packages/ui/src/components/mobile-ui/module.ts
- `M` packages/ui/src/components/mobile-ui/ZCodeAppLogo.tsx
- `M` packages/ui/src/components/ui/ZCodeAboutLogo.tsx
- `M` packages/ui/src/components/workflow-timeline/workflowRunSave.ts
- `M` packages/ui/src/highspeed/HighspeedShareNoticeCard.tsx
- `M` packages/ui/src/i18n/locales/en-US.ts
- `M` packages/ui/src/i18n/locales/ja-JP.ts
- `M` packages/ui/src/i18n/locales/ko-KR.ts
- `M` packages/ui/src/i18n/locales/ru-RU.ts
- `M` packages/ui/src/i18n/locales/zh-CN.ts
- `M` packages/ui/src/lib/skillSourceFilter.ts
- `M` packages/ui/src/onboarding/OnboardingDialog.tsx
- `M` packages/ui/src/root/RootStartupLoading.tsx
- `M` packages/ui/src/settings/commandsSettingsShared.ts
- `M` packages/ui/src/styles.css
- `M` packages/ui/src/v4/ConversationDraftEmptyState.tsx
- `M` packages/ui/src/WelcomeScreen.tsx
- `M` packages/ui/src/WindowsTopLeftLogo.tsx

## packages/web/（7）

- `M` packages/web/index.html
- `M` packages/web/package.json
- `M` packages/web/public/favicon.ico
- `M` packages/web/src/auth/module.ts
- `M` packages/web/src/auth/webAuthLocale.ts
- `M` packages/web/src/web-remote-control/module.ts
- `M` packages/web/src/web-remote-control/ui/webRemoteControlBrand.tsx

## packages/zcode-server-cli/（5）

- `M` packages/zcode-server-cli/scripts/verify-proxy-stdio-docker.mjs
- `M` packages/zcode-server-cli/scripts/verify-remote-ssh.mjs
- `M` packages/zcode-server-cli/src/cli.ts
- `M` packages/zcode-server-cli/src/runtime/paths.ts
- `M` packages/zcode-server-cli/src/runtime/releaseManager.ts

## scripts/（4）

- `A` scripts/check-data-dir-literal.mjs
- `A` scripts/data-dir-literal-exceptions.json
- `M` scripts/engineering-test-files.json
- `A` scripts/fork-changes.mjs

## scripts/zcode-distribution/（1）

- `M` scripts/zcode-distribution/installer.mjs

