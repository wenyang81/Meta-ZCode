/**
 * biz-codegraph 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 调用方只依赖 contract 类型；ts-morph / node:sqlite 细节留在模块内部。
 */
import type { SymbolQuery, SymbolQueryResult } from "./contract.js";

export function exampleSymbolQuery(): SymbolQuery {
  return {
    symbol: "createToolRegistry",
    direction: "inbound",
    limit: 20,
  };
}

export function describeResult(result: SymbolQueryResult): string {
  if (result.stale) {
    return `索引过期（${result.staleReason ?? "unknown"}），改用 Grep 复核`;
  }
  return `${result.symbols.length} 个符号 / ${result.edges.length} 条引用边`;
}
