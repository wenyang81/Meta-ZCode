# 本 fork 相对上游的改动清单

本文件由 `node scripts/fork-changes.mjs` 生成，请勿手工编辑；发布或对外分发源码前重跑一次。

用途：Apache-2.0 第 4(b) 条要求分发修改版时对被修改的文件给出显著说明。本 fork 不在上游源文件里逐个加“已修改”头注释（那会把同步冲突面扩大到每个 seam），改为集中提供本清单，配合 git 历史与 [上游同步规范](upstream-sync.md)、[品牌身份 seam](brand-identity.md) 一起构成修改声明。

- 生成时间：2026-11-13 14:31:51 UTC
- 比较基线：`c5904686ea`（上游同步提交 chore: sync ZCode source v3.18.1）
- 工作区状态：已跟踪改动 60 个文件，未跟踪新增 14 个文件

状态含义：`M` 修改、`A` 新增、`D` 删除、`R` 重命名、`?` 未跟踪（尚未提交）。

## (仓库根)（5）

- `M` AGENTS.md
- `M` architecture-policy.yaml
- `M` NOTICE.md
- `M` package.json
- `M` pnpm-lock.yaml

## docs/（3）

- `?` docs/brand-identity.md
- `M` docs/development-mise-runtime.md
- `?` docs/upstream-sync.md

## docs/desktop/（2）

- `M` docs/desktop/configurable-data-directory.md
- `M` docs/desktop/windows-installer-overhaul-spec.md

## docs/qgraphflow/zcode-repo-architecture/（3）

- `?` docs/qgraphflow/zcode-repo-architecture/diagram.svg
- `?` docs/qgraphflow/zcode-repo-architecture/graph.json
- `?` docs/qgraphflow/zcode-repo-architecture/index.html

## packages/biz-brand/（7）

- `?` packages/biz-brand/package.json
- `?` packages/biz-brand/src/contract.example.ts
- `?` packages/biz-brand/src/CONTRACT.md
- `?` packages/biz-brand/src/contract.ts
- `?` packages/biz-brand/src/index.ts
- `?` packages/biz-brand/src/module.ts
- `?` packages/biz-brand/tsconfig.json

## packages/desktop/（28）

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
- `?` packages/desktop/scripts/render-brand-icons.mjs
- `M` packages/desktop/src/main/about.ts
- `M` packages/desktop/src/main/aboutWindow.ts
- `M` packages/desktop/src/main/desktopApplicationMenu.ts
- `M` packages/desktop/src/main/desktopDataBaseDirBootstrap.ts
- `M` packages/desktop/src/main/desktopRuntimeEnv.ts
- `M` packages/desktop/src/main/desktopTray.ts
- `M` packages/desktop/src/main/index.ts
- `M` packages/desktop/src/renderer/index.html
- `M` packages/desktop/test/desktopProductIdentity.test.ts
- `M` packages/desktop/tsup.config.ts

## packages/shared/（1）

- `M` packages/shared/src/desktopMenu.ts

## packages/ui/（17）

- `M` packages/ui/package.json
- `M` packages/ui/src/App.tsx
- `D` packages/ui/src/assets/Z.svg
- `M` packages/ui/src/components/mobile-ui/module.ts
- `M` packages/ui/src/components/mobile-ui/ZCodeAppLogo.tsx
- `M` packages/ui/src/components/ui/ZCodeAboutLogo.tsx
- `M` packages/ui/src/highspeed/HighspeedShareNoticeCard.tsx
- `M` packages/ui/src/i18n/locales/en-US.ts
- `M` packages/ui/src/i18n/locales/ja-JP.ts
- `M` packages/ui/src/i18n/locales/ko-KR.ts
- `M` packages/ui/src/i18n/locales/ru-RU.ts
- `M` packages/ui/src/i18n/locales/zh-CN.ts
- `M` packages/ui/src/root/RootStartupLoading.tsx
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

## scripts/（1）

- `?` scripts/fork-changes.mjs

