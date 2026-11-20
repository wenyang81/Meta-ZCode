/**
 * 结构视图（spec docs/codegraph-index.md §4.1 `CodegraphModules` / §4.2 `wiki --export`）的回归。
 * 覆盖三件容易写坏的事：import 说明符入库、模块口径与依赖方向来自注入的适配器、
 * 导出落点的两条硬规矩（不许是工作区根、不许是索引目录）。
 */
import { describe, expect, it } from "vitest";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildStructuralWiki,
  closeCodegraphIndex,
  codegraphIndexPath,
  exportStructuralWiki,
  rebuildIndex,
  renderStructuralWiki,
  type StructuralWikiPolicyAdapter,
} from "../src/index.js";
import { extractFileFacts } from "../src/extract.js";

const SOURCE = {
  "pkgA/a.ts":
    'import { beta } from "../pkgB/b.js";\nimport { readFileSync } from "node:fs";\n' +
    'export function alpha() { return beta() + readFileSync("x", "utf8").length; }\n' +
    "export type Alias = number;\n",
  "pkgA/barrel.ts": 'export * from "./a.js";\n',
  "pkgB/b.ts": "export function beta() { return 2; }\nconst helper = 1;\n",
  "misc.ts": "export const loose = 1;\n",
};

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zcode-codegraph-wiki-"));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsPromises.mkdir(path.dirname(abs), { recursive: true });
    await fsPromises.writeFile(abs, text, "utf8");
  }
  return root;
}

async function disposeWorkspace(root: string): Promise<void> {
  closeCodegraphIndex(root);
  await fsPromises.rm(root, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

/** 假 policy：两个模块 + 一个未登记桶；只解析仓内相对路径，外部说明符一律解析不到。 */
function fakeAdapter(violations: StructuralWikiPolicyAdapter["violations"] = []): StructuralWikiPolicyAdapter {
  const known = new Set(Object.keys(SOURCE));
  return {
    moduleOf: (rel) =>
      rel.startsWith("pkgA/") ? "pkg-a" : rel.startsWith("pkgB/") ? "pkg-b" : null,
    resolveImport: (from, specifier) => {
      if (!specifier.startsWith(".")) return null;
      const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
      const target = joined.replace(/\.js$/, ".ts");
      return known.has(target) ? target : null;
    },
    violations,
    acknowledgedViolations: 3,
  };
}

describe("codegraph import 说明符抽取", () => {
  it("收静态 import / export-from / import=，跳过动态 import，并标出类型边", () => {
    const text =
      'import type { A } from "./a.js";\nimport { B } from "./b.js";\n' +
      'export * from "./c.js";\nimport d = require("./d.js");\n' +
      'export async function load() { return (await import("./e.js")).e; }\n';
    const facts = extractFileFacts("/tmp", "/tmp/x.ts", text);
    expect(facts.imports.map((row) => `${row.specifier}:${row.typeOnly}`)).toEqual([
      "./a.js:true",
      "./b.js:false",
      "./c.js:false",
      "./d.js:false",
    ]);
    expect(facts.imports[0]?.line).toBe(1);
    expect(facts.symbols.map((row) => row.name)).toEqual(["load"]);
  });
});

describe("codegraph 结构视图", () => {
  it("注入了 policy 适配器时：模块口径按 policy，依赖方向来自 import 表", async () => {
    const root = await createWorkspace(SOURCE);
    try {
      await rebuildIndex(root);
      const snapshot = await buildStructuralWiki(root, {}, fakeAdapter());
      expect(snapshot.moduleScope).toBe("policy");
      expect(snapshot.modules.map((module) => module.id)).toEqual(["pkg-a", "pkg-b", "unregistered"]);

      const pkgA = snapshot.modules[0];
      const pkgB = snapshot.modules[1];
      expect(pkgA?.dependsOn).toEqual([{ module: "pkg-b", edges: 1 }]);
      expect(pkgB?.dependedBy).toEqual([{ module: "pkg-a", edges: 1 }]);
      // barrel 的 `export * from "./a.js"` 是同模块内部依赖，不进依赖表。
      expect(pkgA?.dependedBy).toEqual([]);
      // node:fs 解析不到仓内文件，如实计成未解析条数而不是静默丢掉。
      expect(snapshot.unresolvedImports).toBe(1);
      expect(snapshot.acknowledgedViolations).toBe(3);
      expect(snapshot.modules[2]?.files.map((file) => file.path)).toEqual(["misc.ts"]);
      expect(snapshot.coverage.exportedSymbols).toBeGreaterThan(0);
    } finally {
      await disposeWorkspace(root);
    }
  });

  it("没有适配器时：退回包级口径，依赖方向留空而不是造第二套解析器", async () => {
    const root = await createWorkspace(SOURCE);
    try {
      await rebuildIndex(root);
      const snapshot = await buildStructuralWiki(root, {});
      expect(snapshot.moduleScope).toBe("path");
      expect(snapshot.modules.map((module) => module.id)).toEqual([".", "pkgA", "pkgB"]);
      expect(snapshot.modules.every((module) => module.dependsOn.length === 0)).toBe(true);
      expect(snapshot.unresolvedImports).toBe(0);

      const pages = renderStructuralWiki(snapshot, { generatedAt: "2026-11-19T00:00:00Z" });
      const index = pages.find((page) => page.path === "index.md");
      expect(index?.content).toContain("依赖方向：未计算");
      expect(index?.content).toContain("未计算");
    } finally {
      await disposeWorkspace(root);
    }
  });

  it("越界告警由适配器带进来，原样渲染成本页与模块页的章节", async () => {
    const root = await createWorkspace(SOURCE);
    try {
      await rebuildIndex(root);
      const violations = [
        {
          rule: "module-dependency",
          file: "pkgA/a.ts",
          module: "pkg-a",
          message: '模块 pkg-a 未声明依赖 pkg-b（import "../pkgB/b.js"）',
        },
      ];
      const snapshot = await buildStructuralWiki(root, {}, fakeAdapter(violations));
      expect(snapshot.violations).toEqual(violations);

      const pages = renderStructuralWiki(snapshot, { generatedAt: "2026-11-19T00:00:00Z" });
      const overview = pages.find((page) => page.path === "index.md")?.content ?? "";
      expect(overview).toContain("## 越界告警");
      expect(overview).toContain("`module-dependency`（1 条）");
      expect(overview).toContain("已认账 3 条");
      const modulePage = pages.find((page) => page.path === "modules/pkg-a.md")?.content ?? "";
      expect(modulePage).toContain("## 越界告警（1 条）");
      expect(modulePage).toContain("模块 pkg-a 未声明依赖 pkg-b");
    } finally {
      await disposeWorkspace(root);
    }
  });
});

describe("codegraph 结构视图导出", () => {
  it("拒绝写进工作区根与索引目录", async () => {
    const root = await createWorkspace(SOURCE);
    try {
      await rebuildIndex(root);
      await expect(exportStructuralWiki(root, ".")).rejects.toThrow(/工作区根目录/);
      await expect(exportStructuralWiki(root, path.dirname(codegraphIndexPath(root)))).rejects.toThrow(
        /索引自己的目录/,
      );
    } finally {
      await disposeWorkspace(root);
    }
  });

  it("写出概览页与模块页，并清掉上一轮遗留的僵尸页", async () => {
    const root = await createWorkspace(SOURCE);
    const outDir = path.join(root, "site", "wiki");
    try {
      await rebuildIndex(root);
      const result = await exportStructuralWiki(root, outDir, {}, { generatedAt: "2026-11-19T00:00:00Z" }, fakeAdapter());
      expect(result.moduleScope).toBe("policy");
      expect(result.modules).toBe(3);
      expect(result.outDir).toBe(outDir);
      await expect(fsPromises.readFile(path.join(outDir, "index.md"), "utf8")).resolves.toContain(
        "## 模块清单",
      );
      await expect(
        fsPromises.readFile(path.join(outDir, "modules", "pkg-b.md"), "utf8",
        ),
      ).resolves.toContain("# pkg-b");

      await fsPromises.writeFile(path.join(outDir, "modules", "gone.md"), "# 旧模块\n", "utf8");
      await exportStructuralWiki(root, outDir, {}, { generatedAt: "2026-11-19T01:00:00Z" }, fakeAdapter());
      await expect(fsPromises.readFile(path.join(outDir, "modules", "gone.md"), "utf8")).rejects.toThrow();
    } finally {
      await disposeWorkspace(root);
    }
  });
});
