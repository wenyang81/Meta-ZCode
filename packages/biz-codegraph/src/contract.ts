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

/**
 * 结构视图的一个模块。模块 id 的口径由调用方注入的适配器决定：给了 `moduleOf` 就是
 * `architecture-policy.yaml` 的模块（未登记的文件归 `unregistered`），没给就退回索引器
 * 的包级推导（`packages/services`、`apps/zcode-cli`）。快照用 `moduleScope` 说清是哪一种。
 */
export interface StructuralWikiModule {
  readonly id: string;
  /** 该模块内被索引的文件，含各自对外导出的符号；文件按路径升序。 */
  readonly files: readonly {
    readonly path: string;
    readonly exports: readonly {
      readonly name: string;
      readonly kind: string;
      readonly line: number;
    }[];
  }[];
  /** 本模块内文件 import 到其它模块的说明符条数，按条数降序。 */
  readonly dependsOn: readonly { readonly module: string; readonly edges: number }[];
  /** 本模块内文件被其它模块 import 的说明符条数，按条数降序。 */
  readonly dependedBy: readonly { readonly module: string; readonly edges: number }[];
}

/** 一条越界告警。规则由工程侧 architecture 检查脚本产出，本包只转述不实现。 */
export interface StructuralWikiViolation {
  readonly rule: string;
  /** workspace 相对 posix 路径。 */
  readonly file: string;
  readonly module: string | null;
  readonly message: string;
}

/**
 * 结构视图的模块口径与越界告警来源，由调用方注入。
 *
 * 存在这个接口的理由：`architecture-policy.yaml` 的解析和 14 条边界规则的唯一所有者在
 * `scripts/architecture`，本包（会随 App 分发）既不读 YAML 也不重复实现规则；
 * 拿不到适配器时结构视图只降一级口径，不自己造第二套真相。
 */
export interface StructuralWikiPolicyAdapter {
  /** workspace 相对 posix 路径 → policy 模块 id；不属于任何已登记模块时返回 null。 */
  readonly moduleOf: (filePath: string) => string | null;
  /** import 说明符 → 目标文件（workspace 相对 posix）；外部包或解析不到时返回 null。 */
  readonly resolveImport: (filePath: string, specifier: string) => string | null;
  /** 未进 baseline 的越界告警（= 需要处理的那批）。 */
  readonly violations: readonly StructuralWikiViolation[];
  /** 已在 baseline 里认账的告警条数，只用于说明总数。 */
  readonly acknowledgedViolations: number;
}

/** 一次结构视图的完整快照；渲染与落盘由调用方决定，索引侧只负责算。 */
export interface StructuralWikiSnapshot {
  readonly workspace: string;
  readonly builtAt: string;
  readonly files: number;
  readonly symbols: number;
  readonly edges: number;
  /** `policy` = 模块 id 来自 architecture-policy.yaml；`path` = 索引器按路径推的包级口径。 */
  readonly moduleScope: "policy" | "path";
  /** true = 本次有文件重抽失败，快照里那部分数据不可信（spec §5.1）。 */
  readonly stale: boolean;
  readonly staleReason?: string;
  /** 静态 import 里解析不到仓内文件的条数（外部包、动态路径、未登记目录）。 */
  readonly unresolvedImports: number;
  /** 符号级精确引用边的覆盖度；依赖方向已改由 imports 表提供，这个数只说明引用边查到过多少。 */
  readonly coverage: {
    readonly exportedSymbols: number;
    readonly computedSymbolPairs: number;
  };
  readonly violations: readonly StructuralWikiViolation[];
  readonly acknowledgedViolations: number;
  readonly modules: readonly StructuralWikiModule[];
}
