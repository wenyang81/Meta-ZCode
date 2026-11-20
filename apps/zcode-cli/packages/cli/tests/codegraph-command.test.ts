/**
 * `zcode codegraph wiki` 的 CLI 薄壳回归（spec docs/codegraph-index.md §4.2）。
 * 只验转调与出口文案：索引与渲染逻辑由 packages/biz-codegraph/tests 覆盖，这里除最后一条外全部打桩。
 */
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WORKSPACE_CONFIG_DIR_NAME } from "@zcode/shared/dataDirName";
import type { GlobalOptions, RunContext } from "@zcode/shared-types";
import { runCodegraphCommand } from "../src/codegraph-command.js";

const TEXT: GlobalOptions = { force: false, json: false, noColor: false, verbose: false };
const JSON_OUT: GlobalOptions = { ...TEXT, json: true };

type CapturedStream = NodeJS.WriteStream & { output(): string };

function stream(): CapturedStream {
  let buffer = "";
  return {
    output: () => buffer,
    write(chunk: string | Uint8Array): boolean {
      buffer += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    },
  } as CapturedStream;
}

function context(): RunContext & { stdout: CapturedStream; stderr: CapturedStream } {
  return {
    argv: ["zcode", "codegraph"],
    stdin: { isTTY: false } as NodeJS.ReadStream,
    stdout: stream(),
    stderr: stream(),
  };
}

/** 工作区根必须是真实目录：薄壳先做存在性校验，臆造路径会在断言之前就失败。 */
async function withWorkspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zcode-codegraph-cli-"));
  try {
    return await run(root);
  } finally {
    await fsPromises.rm(root, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}

const fakeExportResult = {
  outDir: "F:/stub/out",
  pages: [{ path: "index.md", content: "# 代码库结构视图\n" }],
  modules: 3,
  moduleScope: "policy" as const,
  files: 10,
  symbols: 20,
  edges: 5,
  violations: 1,
  stale: false,
};

function fakeModule(overrides: Record<string, unknown> = {}) {
  return {
    codegraphIndexReady: () => ({ ready: true, files: 10 }),
    codegraphIndexPath: (root: string) =>
      path.join(root, WORKSPACE_CONFIG_DIR_NAME, "codegraph", "index.sqlite"),
    exportStructuralWiki: async () => fakeExportResult,
    ...overrides,
  } as never;
}

const adapterStub = {
  moduleOf: () => null,
  resolveImport: () => null,
  violations: [],
  acknowledgedViolations: 0,
};

test("wiki：索引缺失时拒绝并指路 rebuild，不静默重建", () =>
  withWorkspace(async (root) => {
    const ctx = context();
    const code = await runCodegraphCommand(
      ctx,
      TEXT,
      {
        cwd: () => root,
        loadCodegraphModule: async () =>
          fakeModule({ codegraphIndexReady: () => ({ ready: false, files: 0 }) }),
        loadStructuralAdapter: async () => ({ note: "unused" }),
      },
      ["wiki"],
    );
    assert.equal(code, 1);
    assert.match(ctx.stderr.output(), /No codegraph index/);
    assert.match(ctx.stderr.output(), /zcode codegraph rebuild/);
  }));

test("wiki：默认落点是契约目录下的 codegraph-wiki，适配器缺席时如实说明", () =>
  withWorkspace(async (root) => {
    const ctx = context();
    let seenOutDir = "";
    let seenAdapter: unknown = "unset";
    const code = await runCodegraphCommand(
      ctx,
      JSON_OUT,
      {
        cwd: () => root,
        loadCodegraphModule: async () =>
          fakeModule({
            exportStructuralWiki: async (
              _workspace: string,
              outDir: string,
              _options: unknown,
              _meta: unknown,
              adapter: unknown,
            ) => {
              seenOutDir = outDir;
              seenAdapter = adapter;
              return { ...fakeExportResult, outDir };
            },
          }),
        loadStructuralAdapter: async () => ({ note: "no scripts/architecture here" }),
      },
      ["wiki"],
    );
    assert.equal(code, 0);
    assert.equal(seenOutDir, path.join(root, WORKSPACE_CONFIG_DIR_NAME, "codegraph-wiki"));
    assert.equal(seenAdapter, undefined);
    const payload = JSON.parse(ctx.stdout.output()) as Record<string, unknown>;
    assert.equal(payload.adapterNote, "no scripts/architecture here");
    assert.equal(payload.moduleScope, "policy");
    assert.equal(payload.violations, 1);
    assert.ok(!("staleReason" in payload));
  }));

test("wiki：--export 原样透传，相对落点交给库层按工作区判定", () =>
  withWorkspace(async (root) => {
    const ctx = context();
    let seenOutDir = "";
    const code = await runCodegraphCommand(
      ctx,
      TEXT,
      {
        cwd: () => root,
        loadCodegraphModule: async () =>
          fakeModule({
            exportStructuralWiki: async (_workspace: string, outDir: string) => {
              seenOutDir = outDir;
              return { ...fakeExportResult, outDir };
            },
          }),
        loadStructuralAdapter: async () => ({ adapter: adapterStub, note: "policy loaded" }),
      },
      ["wiki"],
      { exportDir: "site/wiki" },
    );
    assert.equal(code, 0);
    assert.equal(seenOutDir, "site/wiki");
    assert.match(ctx.stdout.output(), /Structural wiki: site\/wiki/);
    assert.match(ctx.stdout.output(), /scope: architecture-policy\.yaml/);
    assert.match(ctx.stdout.output(), /warnings:\s+1 unacknowledged/);
  }));

test("wiki：库层拒绝落点时把原因原样报出来", () =>
  withWorkspace(async (root) => {
    const ctx = context();
    const code = await runCodegraphCommand(
      ctx,
      TEXT,
      {
        cwd: () => root,
        loadCodegraphModule: async () =>
          fakeModule({
            exportStructuralWiki: async () => {
              throw new Error("导出目录落在索引自己的目录里");
            },
          }),
        loadStructuralAdapter: async () => ({ note: "policy loaded" }),
      },
      ["wiki"],
    );
    assert.equal(code, 1);
    assert.match(ctx.stderr.output(), /索引自己的目录/);
  }));

test("wiki：默认落点不在索引目录内，真实库层允许写入并拒绝索引目录", () =>
  withWorkspace(async (root) => {
    await fsPromises.mkdir(path.join(root, "src"), { recursive: true });
    await fsPromises.writeFile(path.join(root, "src", "a.ts"), "export const alpha = 1;\n", "utf8");
    const {
      closeCodegraphIndex,
      exportStructuralWiki,
      rebuildIndex,
    } = await import("@zcode/biz-codegraph");
    await rebuildIndex(root);
    const result = await exportStructuralWiki(
      root,
      path.join(root, WORKSPACE_CONFIG_DIR_NAME, "codegraph-wiki"),
    );
    assert.equal(result.moduleScope, "path");
    await assert.rejects(
      () =>
        exportStructuralWiki(
          root,
          path.join(root, WORKSPACE_CONFIG_DIR_NAME, "codegraph", "wiki"),
        ),
      /索引自己的目录/,
    );
    closeCodegraphIndex(root);
  }));
