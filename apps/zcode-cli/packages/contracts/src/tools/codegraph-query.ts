// ============================================================
// CodegraphQuery Tool - 查询工作区符号/依赖索引
// ============================================================
//
// fork 专属能力（规格 docs/codegraph-index.md §4.1）：把「谁引用了这个导出」「这个文件导出什么」
// 这类符号级问题从反复 grep/read 扫描改成一次索引查询。真正的解析、存储与新鲜度校验都在
// `@zcode/biz-codegraph`，本文件只定模型面看到的入参与结果。
//
// 契约里刻意只放 `文件:行号` 而不放源码文本：索引是定位器，读代码仍走 Read，
// 这样两边不会各自维护一份「代码长什么样」的真相。

import { z } from "zod";
import type { ToolCallId, TraceId } from "../interfaces/shared.js";
import { toToolJsonSchema } from "./json-schema.js";

export const CODEGRAPH_QUERY_TOOL_NAME = "CodegraphQuery";

/** 与 biz-codegraph 的抽取器同一套 kind 词表，不在这层另起分类。 */
export const CodegraphSymbolKindSchema = z.enum([
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "variable",
  "method",
  "property",
]);

export const CodegraphQueryDirectionSchema = z.enum(["inbound", "outbound", "both"]);

export const CodegraphQueryInputSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .optional()
    .describe("Exported symbol name to look up, e.g. `querySymbols`."),
  filePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Workspace-relative source file whose export surface and edges to return, e.g. `packages/shared/src/grep.ts`.",
    ),
  direction: CodegraphQueryDirectionSchema.optional().describe(
    "inbound = who references the symbol (precise, computed on demand), both (default). outbound is file-level only and needs `filePath`; a symbol's own dependencies are not covered.",
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Maximum edges to return (default 50, hard cap 200)."),
});

export type CodegraphQueryInput = z.infer<typeof CodegraphQueryInputSchema>;

export const CodegraphQueryInputJsonSchema = toToolJsonSchema(CodegraphQueryInputSchema);

// -----------------------------------------------
// Output Types
// -----------------------------------------------

export const CodegraphSymbolHitSchema = z
  .object({
    name: z.string(),
    kind: CodegraphSymbolKindSchema,
    filePath: z.string(),
    line: z.number().int().nonnegative(),
    exported: z.boolean(),
    module: z.string(),
  })
  .strict();

export const CodegraphEdgeHitSchema = z
  .object({
    name: z.string(),
    fromFile: z.string(),
    fromLine: z.number().int().nonnegative(),
    toFile: z.string(),
    toLine: z.number().int().nonnegative(),
    /** true = 经 `export ... from` 再导出链路命中，不是直接引用。 */
    reexport: z.boolean(),
  })
  .strict();

export const CodegraphQueryOutputSchema = z
  .object({
    symbols: z.array(CodegraphSymbolHitSchema),
    edges: z.array(CodegraphEdgeHitSchema),
    truncated: z.boolean(),
    /** 索引没能重新解析某个变更文件；这些条目可能是旧的（规格 §5.1 禁止静默返回旧图）。 */
    stale: z.boolean(),
    staleReason: z.string().optional(),
  })
  .strict();

export type CodegraphSymbolHit = z.infer<typeof CodegraphSymbolHitSchema>;
export type CodegraphEdgeHit = z.infer<typeof CodegraphEdgeHitSchema>;
export type CodegraphQueryOutput = z.infer<typeof CodegraphQueryOutputSchema>;

export const CodegraphQueryOutputJsonSchema = toToolJsonSchema(CodegraphQueryOutputSchema);

// -----------------------------------------------
// Tool Call Structure
// -----------------------------------------------

export interface CodegraphQueryToolCall {
  id: ToolCallId;
  name: "CodegraphQuery";
  input: CodegraphQueryInput;
  traceId: TraceId;
  startedAt: Date;
}

export interface CodegraphQueryToolResult {
  toolCallId: ToolCallId;
  output: CodegraphQueryOutput;
  traceId: TraceId;
  durationMs: number;
}
