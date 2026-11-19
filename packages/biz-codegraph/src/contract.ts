/**
 * 符号索引公开契约（docs/codegraph-index.md §4）。
 * 只描述「查什么、返回什么」，不含 ts-morph / sqlite 细节——那些是 adapters 内部实现。
 * spec §5 不变量对调用方可见的部分：结果携带 stale 标记，禁止静默返回旧图。
 */

export interface SymbolLocation {
  readonly filePath: string;
  readonly line: number;
}

export interface CodegraphSymbol {
  readonly name: string;
  readonly kind: "function" | "class" | "interface" | "type" | "enum" | "variable" | "method" | "property";
  readonly location: SymbolLocation;
  readonly isExported: boolean;
  readonly module: string;
}

export interface CodegraphEdge {
  /** 引用发生位置。 */
  readonly from: SymbolLocation;
  /** 声明位置。 */
  readonly to: SymbolLocation;
  /** 被引用的导出符号名。 */
  readonly name: string;
  /** true = 经 export ... from 再导出链路（非直接使用）。 */
  readonly isReexport: boolean;
}

export type CodegraphQueryDirection = "inbound" | "outbound" | "both";

export interface SymbolQuery {
  readonly symbol?: string;
  readonly filePath?: string;
  readonly direction?: CodegraphQueryDirection;
  readonly limit?: number;
}

export interface SymbolQueryResult {
  readonly symbols: readonly CodegraphSymbol[];
  readonly edges: readonly CodegraphEdge[];
  readonly stale: boolean;
  readonly staleReason?: string;
}

export interface ModuleBoundaryQuery {
  readonly filePath?: string;
  readonly module?: string;
}

export interface ModuleBoundaryResult {
  readonly modules: readonly {
    readonly id: string;
    readonly files: readonly string[];
    readonly dependsOn: readonly string[];
  }[];
  readonly stale: boolean;
  readonly staleReason?: string;
}

export interface CodegraphStats {
  readonly files: number;
  readonly symbols: number;
  readonly edges: number;
  readonly builtAt: string;
  readonly staleRatio: number;
}
