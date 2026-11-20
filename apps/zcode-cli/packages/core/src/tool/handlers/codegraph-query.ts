// ============================================================
// CodegraphQuery Tool Handler
// ============================================================
// 薄壳（规格 docs/codegraph-index.md §5.5）：只做入参校验、索引就绪判定与结果投影，
// 解析/存储/新鲜度全部在 @zcode/biz-codegraph。这里刻意用动态 import：ts-morph 与
// TypeScript 编译器只在工具真正被调用时才进内存，不影响会话启动。

import {
  CODEGRAPH_QUERY_TOOL_NAME,
  CodegraphQueryInputJsonSchema,
  CodegraphQueryInputSchema,
  CodegraphQueryOutputJsonSchema,
  CodegraphQueryOutputSchema,
  type CodegraphQueryInput,
  type CodegraphQueryOutput,
  type ModelMessageContent,
} from "@zcode/contracts";
import type { ToolEntry, ToolHandler, ToolHandlerFailure } from "../types.js";

const CODEGRAPH_TIMEOUT_MS = 90_000;
const CODEGRAPH_MODEL_BYTES = 20_000;
const DEFAULT_EDGE_LIMIT = 50;
const MAX_EDGE_LIMIT = 200;

/** 业务失败码：数值只是日志位，判别键在 message 前缀（同 ListModels 的做法）。 */
const CODEGRAPH_ERROR_CODE = {
  INVALID_INPUT: 41,
  INDEX_MISSING: 42,
  OUTBOUND_NEEDS_FILE_PATH: 43,
} as const;

const CODEGRAPH_QUERY_DESCRIPTION = `Symbol-level dependency queries against this workspace's persistent code index. Prefer it over repeated Grep/Read sweeps for "who uses X" questions.

- Give \`symbol\` (an exported name) or \`filePath\` (workspace-relative), never neither. \`symbol\` returns its declaration sites plus who references it; \`filePath\` returns that file's export surface plus its edges.
- \`direction\`: \`inbound\` = who references the symbol (the precise, per-symbol answer), \`both\` (default). \`outbound\` is file-level only — the index records a file's outgoing edges as a by-product of other symbols' inbound pass, so it is sparse; a symbol's own dependencies are not answerable here.
- Still use Grep for string literals, comments, config files, and languages the index does not parse; use Read for code.
- Results are \`file:line\` locations only — the index stores no source text. Open a hit with Read.
- When \`stale\` is true, some changed file could not be re-parsed: verify those specific hits with Grep/Read instead of trusting them.
- A failing call saying the index is missing means nothing was built yet — fall back to Grep, and tell the user \`zcode codegraph rebuild\` can enable this tool.`;

function invalidInputFailure(message: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode: CODEGRAPH_ERROR_CODE.INVALID_INPUT,
    message: `codegraph_query_invalid_input: ${message}`,
  };
}

function indexMissingFailure(root: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode: CODEGRAPH_ERROR_CODE.INDEX_MISSING,
    message:
      `codegraph_index_missing: no symbol index for ${root} yet, so nothing can be answered from it. ` +
      "Fall back to Grep/Read for this question. The user can build the index with `zcode codegraph rebuild`.",
  };
}

const codegraphQueryHandler: ToolHandler = async (input, context) => {
  const parsed = CodegraphQueryInputSchema.parse(input) as CodegraphQueryInput;
  if (!parsed.symbol && !parsed.filePath) {
    return invalidInputFailure("provide `symbol`, `filePath`, or both");
  }
  // outbound 只有「引用方文件」维度的缓存边（spec §4.1）：符号级 outbound 没算过，
  // 返回空列表会被模型读成「它没有依赖」，所以这里直接说不覆盖面，并给出下一步。
  if (parsed.direction === "outbound" && !parsed.filePath) {
    return {
      result: false,
      errorCode: CODEGRAPH_ERROR_CODE.OUTBOUND_NEEDS_FILE_PATH,
      message:
        "codegraph_outbound_needs_file_path: outgoing edges are recorded per referencing file, not per symbol, " +
        "so a symbol-only outbound question can't be answered from the index. Pass `filePath` with `direction: \"outbound\"` " +
        "for that file's recorded edges, or ask `direction: \"inbound\"` for who references the symbol.",
    } satisfies ToolHandlerFailure;
  }

  const root = context.workspaceRoot;
  const { codegraphIndexReady, querySymbols } = await import("@zcode/biz-codegraph");
  if (!codegraphIndexReady(root).ready) return indexMissingFailure(root);

  const limit = Math.min(parsed.limit ?? DEFAULT_EDGE_LIMIT, MAX_EDGE_LIMIT);
  const result = await querySymbols(root, {
    ...(parsed.symbol ? { symbol: parsed.symbol } : {}),
    ...(parsed.filePath ? { filePath: parsed.filePath } : {}),
    ...(parsed.direction ? { direction: parsed.direction } : {}),
    limit,
  });

  return {
    symbols: result.symbols.map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      filePath: symbol.location.filePath,
      line: symbol.location.line,
      exported: symbol.isExported,
      module: symbol.module,
    })),
    edges: result.edges.map((edge) => ({
      name: edge.name,
      fromFile: edge.from.filePath,
      fromLine: edge.from.line,
      toFile: edge.to.filePath,
      toLine: edge.to.line,
      reexport: edge.isReexport,
    })),
    truncated: result.edges.length >= limit,
    stale: result.stale,
    ...(result.staleReason === undefined ? {} : { staleReason: result.staleReason }),
  } satisfies CodegraphQueryOutput;
};

/**
 * 模型面：一行一条命中，位置在前、名字在后——模型下一步动作就是拿这个位置去 Read，
 * 所以把它放在行首最显眼处，而不是包成一串 JSON 字段。
 */
function formatCodegraphQueryModelContent(output: unknown): ModelMessageContent {
  const parsed = CodegraphQueryOutputSchema.safeParse(output);
  if (!parsed.success) return "CodegraphQuery returned an invalid result.";
  const { symbols, edges, stale, staleReason } = parsed.data;

  if (symbols.length === 0 && edges.length === 0) {
    // 空结果要说成「索引里没有这个答案」，否则模型容易读成「工具没答上来」。
    return [
      '<codegraph symbols="0" edges="0">',
      "No symbol or edge matched. The name may not be exported, or it lives in a file the index does not parse — confirm with Grep.",
      "</codegraph>",
    ].join("\n");
  }

  const lines = [
    `<codegraph symbols="${symbols.length}" edges="${edges.length}"${stale ? ' stale="true"' : ""}>`,
    ...symbols.map(
      (symbol) =>
        `${symbol.filePath}:${symbol.line}  ${symbol.name}  (${symbol.kind}${symbol.exported ? ", exported" : ""}; module ${symbol.module})`,
    ),
    ...edges.map(
      (edge) =>
        `${edge.fromFile}:${edge.fromLine}  ->  ${edge.toFile}:${edge.toLine}  ${edge.name}${edge.reexport ? "  (re-export)" : ""}`,
    ),
  ];
  if (stale && staleReason) {
    lines.push(`stale: ${staleReason}`);
    lines.push("Verify the stale entries with Grep or Read before relying on them.");
  }
  lines.push("</codegraph>");
  return lines.join("\n");
}

export const codegraphQueryToolEntry: ToolEntry = {
  capability: "Query the workspace symbol/dependency index for declarations and cross-file references",
  metadata: {
    name: CODEGRAPH_QUERY_TOOL_NAME,
    description: CODEGRAPH_QUERY_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: CODEGRAPH_TIMEOUT_MS,
    maxOutputBytes: CODEGRAPH_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
    searchHint: "symbol references, callers, export surface, module dependencies",
  },
  handler: codegraphQueryHandler,
  inputSchema: CodegraphQueryInputJsonSchema,
  outputSchema: CodegraphQueryOutputJsonSchema,
  runtimeInputSchema: CodegraphQueryInputSchema,
  runtimeOutputSchema: CodegraphQueryOutputSchema,
  formatModelContent: formatCodegraphQueryModelContent,
  permission: {
    permission: "codegraphQuery",
    reason: "CodegraphQuery reads the workspace symbol index",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: CODEGRAPH_MODEL_BYTES,
    maxModelBytes: CODEGRAPH_MODEL_BYTES,
    strategy: "truncate",
    preview: { maxBytes: CODEGRAPH_MODEL_BYTES, direction: "head" },
  },
  timeout: {
    kind: "timed",
    defaultMs: CODEGRAPH_TIMEOUT_MS,
    maxMs: CODEGRAPH_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage:
      "CodegraphQuery runs synchronous index work and cannot be cancelled mid-query",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
