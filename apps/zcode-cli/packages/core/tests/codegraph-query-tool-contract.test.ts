import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolCallId, createTraceId, type CodegraphQueryOutput } from "@zcode/contracts";
import { buildExploreAgentPrompt } from "../src/subagent/explore.js";
import { codegraphQueryToolEntry } from "../src/tool/handlers/codegraph-query.js";
import type { ToolExecutionContext } from "../src/tool/types.js";
import { expectV2CommonContract } from "./tool-contract-assertions.js";

function createContext(root: string): ToolExecutionContext {
  return {
    toolCallId: createToolCallId("codegraph"),
    traceId: createTraceId(),
    abortSignal: new AbortController().signal,
    workingDirectory: root,
    workspaceRoot: root,
  } as ToolExecutionContext;
}

describe("CodegraphQuery tool contract", () => {
  it("satisfies the v2 common contract", () => {
    expectV2CommonContract(codegraphQueryToolEntry);
  });

  it("spells the routing rule and the fallbacks in the model-visible description", () => {
    const description = codegraphQueryToolEntry.metadata.description;
    // 路由顺序（spec §4.3）：符号级问题先查索引，且结果只是 file:line，串类问题仍归 Grep。
    expect(description).toContain("Prefer it over repeated Grep/Read sweeps");
    expect(description).toContain("Results are `file:line` locations only");
    expect(description).toContain("Still use Grep for string literals");
    expect(description).toContain("`stale` is true");
    // 索引缺席必须把「退回文本搜索 + 怎么开启」一次说清，否则模型会反复重试本工具。
    expect(description).toContain("index is missing");
    expect(description).toContain("zcode codegraph rebuild");
  });

  it("rejects an empty query before touching the index", async () => {
    // 校验分支在就绪判定之前，所以这里连索引都不用存在。
    const result = await codegraphQueryToolEntry.handler(
      {},
      createContext(join(tmpdir(), "zcode-codegraph-not-created")),
    );
    expect(result).toMatchObject({
      result: false,
      message: expect.stringContaining("codegraph_query_invalid_input"),
    });
  });

  it("refuses symbol-only outbound instead of answering an empty edge list", async () => {
    // spec §4.1：outbound 只有文件级缓存边。空结果会被模型读成「它没有依赖」，
    // 所以这条方向必须说「答不了」并给出可用的问法。
    const result = await codegraphQueryToolEntry.handler(
      { symbol: "alpha", direction: "outbound" },
      createContext(join(tmpdir(), "zcode-codegraph-not-created")),
    );
    const message = (result as { message: string }).message;
    expect(message).toContain("codegraph_outbound_needs_file_path");
    expect(message).toContain("direction: \"inbound\"");
  });
});

describe("CodegraphQuery against a real workspace index", () => {
  const files = {
    "src/a.ts": "export function alpha() { return 1; }\n",
    "src/b.ts": 'import { alpha } from "./a";\nexport const useAlpha = () => alpha();\n',
  };
  let emptyRoot = "";
  let indexedRoot = "";

  beforeAll(async () => {
    emptyRoot = await mkdtemp(join(tmpdir(), "zcode-codegraph-empty-"));
    indexedRoot = await mkdtemp(join(tmpdir(), "zcode-codegraph-ready-"));
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(indexedRoot, rel);
      await mkdir(join(abs, ".."), { recursive: true });
      await writeFile(abs, text, "utf8");
    }
    const { rebuildIndex } = await import("@zcode/biz-codegraph");
    await rebuildIndex(indexedRoot);
  });

  afterAll(async () => {
    const { closeCodegraphIndex } = await import("@zcode/biz-codegraph");
    closeCodegraphIndex(indexedRoot);
    closeCodegraphIndex(emptyRoot);
    await rm(indexedRoot, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    await rm(emptyRoot, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });

  it("fails with an actionable message when the workspace has no index", async () => {
    const result = await codegraphQueryToolEntry.handler({ symbol: "alpha" }, createContext(emptyRoot));
    expect(result).toMatchObject({
      result: false,
      message: expect.stringContaining("codegraph_index_missing"),
    });
    expect((result as { message: string }).message).toContain("zcode codegraph rebuild");
  });

  it("projects symbol hits and gives the model file:line first", async () => {
    const output = (await codegraphQueryToolEntry.handler(
      { symbol: "alpha", direction: "inbound" },
      createContext(indexedRoot),
    )) as CodegraphQueryOutput;
    expect(output.symbols.map((symbol) => symbol.filePath)).toContain("src/a.ts");
    expect(output.edges.map((edge) => edge.fromFile)).toContain("src/b.ts");

    const content = codegraphQueryToolEntry.formatModelContent!(output) as string;
    // 位置在行首：模型下一步就是拿它去 Read。import 行和调用行各算一条入边。
    expect(content.startsWith('<codegraph symbols="1" edges="2">\nsrc/a.ts:1  alpha')).toBe(true);
    expect(content).toContain("src/b.ts:1  ->  src/a.ts:1  alpha");
    expect(content).toContain("src/b.ts:2  ->  src/a.ts:1  alpha");
  });

  it("names an empty result as a missing answer, not a broken tool", async () => {
    const content = codegraphQueryToolEntry.formatModelContent!({
      symbols: [],
      edges: [],
      truncated: false,
      stale: false,
    }) as string;
    expect(content).toContain("No symbol or edge matched");
    expect(content).toContain("confirm with Grep");
  });

  it("repeats the stale warning inside the payload so the model cannot miss it", async () => {
    const content = codegraphQueryToolEntry.formatModelContent!({
      symbols: [
        { name: "alpha", kind: "function", filePath: "src/a.ts", line: 1, exported: true, module: "src" },
      ],
      edges: [],
      truncated: false,
      stale: true,
      staleReason: "重索引失败: src/a.ts: Unexpected token",
    }) as string;
    expect(content).toContain('stale="true"');
    expect(content).toContain("stale: 重索引失败: src/a.ts");
    expect(content).toContain("Verify the stale entries with Grep or Read");
  });
});

describe("Explore routes symbol questions to CodegraphQuery", () => {
  it.each([false, true])("puts the symbol-index guideline first (embedded search: %s)", (embedded) => {
    const prompt = buildExploreAgentPrompt({ embeddedSearchEnabled: embedded });
    expect(prompt).toContain("Use CodegraphQuery for symbol-level questions");
    const guideline = prompt.indexOf("Use CodegraphQuery");
    const textSearch = embedded
      ? prompt.indexOf("Use `find` via Bash")
      : prompt.indexOf("Use Glob for broad file pattern matching");
    expect(guideline).toBeLessThan(textSearch);
  });
});
