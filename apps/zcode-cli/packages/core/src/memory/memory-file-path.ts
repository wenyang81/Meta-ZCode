import { isAbsolute, relative } from "node:path";

import { DATA_DIR_NAME } from "@zcode/shared";

import { resolveWorkspacePath } from "../tool/path-policy.js";

const SENSITIVE_MEMORY_PATH_SEGMENTS = new Set([
  ".git",
  "hooks",
  ".husky",
  ".githooks",
  "node_modules",
  ".vscode",
  ".idea",
  "head",
  "config",
  "objects",
  "refs",
  ".claude",
  // 工作区契约名固定为 `.zcode`，品牌化的只是用户级数据叶子，两条都必须挡：
  // 只保留其中一个会让品牌包出现「另一半目录不再受保护」的口子。默认叶子下两者同值，Set 自动去重。
  ".zcode",
  DATA_DIR_NAME,
  "skills",
  "commands",
  "agents",
  ".cargo",
  ".devcontainer",
  ".yarn",
  ".mvn",
]);

export function resolveContainedMemoryFilePath(input: {
  filePath: string;
  rootDir: string;
  workingDirectory: string;
  workspaceRoot: string;
}): string | undefined {
  const resolvedPath = resolveWorkspacePath({
    inputPath: input.filePath,
    operation: "write",
    workingDirectory: input.workingDirectory,
    workspaceRoot: input.workspaceRoot,
  });
  const relativePath = relative(input.rootDir, resolvedPath);
  return isContainedRelativePath(relativePath) ? resolvedPath : undefined;
}

export function resolveSafeMemoryFilePath(input: {
  filePath: string;
  rootDir: string;
  workingDirectory: string;
  workspaceRoot: string;
}): string | undefined {
  const resolvedPath = resolveContainedMemoryFilePath(input);
  if (!resolvedPath) return undefined;
  const relativePath = memoryFileRelativePath(input.rootDir, resolvedPath);
  return relativePath && !containsSensitiveMemoryPathSegment(relativePath)
    ? resolvedPath
    : undefined;
}

export function memoryFileRelativePath(rootDir: string, filePath: string): string | undefined {
  const relativePath = relative(rootDir, filePath);
  return isContainedRelativePath(relativePath) ? relativePath : undefined;
}

export function containsSensitiveMemoryPathSegment(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]+/u)
    .some((segment) => SENSITIVE_MEMORY_PATH_SEGMENTS.has(normalizeSensitiveSegment(segment)));
}

function isContainedRelativePath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith("../") &&
    !relativePath.startsWith("..\\") &&
    !isAbsolute(relativePath)
  );
}

function normalizeSensitiveSegment(segment: string): string {
  const withoutControls = segment
    .toLowerCase()
    .replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/gu, "");
  return (withoutControls.split(":", 1)[0] ?? "").replace(/[. ]+$/u, "");
}
