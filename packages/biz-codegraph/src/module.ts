/**
 * biz-codegraph 模块清单（architecture-governance managed 模块）。
 * 层：adapters（ts-morph 解析、node:sqlite 读写、fs 都在本模块内，不对公开契约暴露）。
 * 修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const bizCodegraphModule = {
  id: "biz-codegraph",
  requires: ["shared"],
  provides: ["biz-codegraph"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
