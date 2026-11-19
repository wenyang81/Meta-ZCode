import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR_NAME } from "@zcode/shared";
import { setDataBaseDir } from "@zcode/services/node";
import { isElectronAppPackaged } from "./desktopElectronApp.js";
import { DLMETA_DATA_BASE_DIR_ENV } from "@zcode/shared/dataDirName";

/**
 * 隔离态：未打包运行（源码 dev / e2e / 冒烟）且调用方显式给出了 DLMETA_DATA_BASE_DIR。
 * 命中时 setting.json 里的 `dataBaseDir` 不再覆盖数据根，见 docs/development-mise-runtime.md「约定」。
 * 早期 bootstrap 与 app-ready 后的设置加载都必须用这一判定，避免两条写入路径语义分叉。
 */
export function isExplicitDevDataBaseDir(): boolean {
  return !isElectronAppPackaged() && Boolean(process.env[DLMETA_DATA_BASE_DIR_ENV]?.trim());
}

export function resolveBootstrapSettingsFile(homePath: string = homedir()): string {
  return join(homePath, DATA_DIR_NAME, "v2", "setting.json");
}

export function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(
  settingsFile: string = resolveBootstrapSettingsFile(),
): string | null {
  if (!existsSync(settingsFile)) {
    return null;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapDataBaseDir(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applyEarlyDataBaseDirBootstrap(): string | null {
  // 修复原因：setting.json 是全局单一文件，正式版把 dataBaseDir 钉到自定义目录后，
  // 这里无条件覆盖会让 dev / e2e 显式注入的 DLMETA_DATA_BASE_DIR 失效，两套版本因此共享
  // 同一份任务索引与凭据，跨版本读取直接刷 task-index meta_json 非法。
  // 隔离态下跳过覆盖，让 services/paths.ts 的 env 优先级生效；打包运行行为不变。
  // 见 docs/development-mise-runtime.md「约定」。
  if (isExplicitDevDataBaseDir()) {
    return null;
  }

  const dataBaseDir = readBootstrapDataBaseDirFromDisk();
  if (dataBaseDir) {
    // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录，
    // 导致后续再切换到自定义目录时，日志和 crash dump 落在两套路径里。
    setDataBaseDir(dataBaseDir);
  }
  return dataBaseDir;
}
