export const moduleDefinition = {
  id: "managed-worktree-shared",
  // layout.ts 的托管工作区家目录段复用 @zcode/shared 的数据目录叶子 owner（docs/data-dir-name.md）。
  requires: ["shared"],
  provides: ["managed-worktree-layout", "workspace-hook-trust-identity"],
} as const;
