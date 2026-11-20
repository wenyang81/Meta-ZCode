/**
 * 结构视图的渲染与落盘（spec docs/codegraph-index.md §4.2 `zcode codegraph wiki --export`）。
 *
 * 这里只做「快照 → markdown → 磁盘」，不解析源码、不调模型：
 * 快照由 `buildStructuralWiki` 从索引现有表聚合，散文说明是生成器的产物，
 * 生成后并入同一目录，页面结构不变。
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildStructuralWiki } from "./codegraph.js";
import { toPosix } from "./extract.js";
import { codegraphIndexPath } from "./indexPath.js";
import type { QueryOptions } from "./codegraph.js";
import type {
  StructuralWikiModule,
  StructuralWikiPolicyAdapter,
  StructuralWikiSnapshot,
} from "./contract.js";

export interface WikiRenderedFile {
  /** 相对导出目录的路径，如 `index.md`、`modules/packages__services.md`。 */
  readonly path: string;
  readonly content: string;
}

const moduleSlug = (id: string): string => id.replace(/[^a-zA-Z0-9._-]+/g, "__");

const formatCount = (value: number): string => value.toLocaleString("en-US");

function moduleSummary(module: StructuralWikiModule): {
  files: number;
  exports: number;
  filesWithExports: number;
} {
  let exports = 0;
  let filesWithExports = 0;
  for (const file of module.files) {
    if (file.exports.length > 0) filesWithExports += 1;
    exports += file.exports.length;
  }
  return { files: module.files.length, exports, filesWithExports };
}

const directionLine = (
  entries: readonly { module: string; edges: number }[],
  scope: StructuralWikiSnapshot["moduleScope"],
  limit = 12,
): string =>
  entries.length === 0
    ? scope === "policy"
      ? "无跨模块 import"
      : "未计算"
    : entries
        .slice(0, limit)
        .map((entry) => `\`${entry.module}\` ${formatCount(entry.edges)}`)
        .concat(entries.length > limit ? [`…另 ${entries.length - limit} 个模块`] : [])
        .join("、");

const VIOLATIONS_PER_RULE = 20;

/** 越界告警按规则分组；规则本身不在本包实现，条目由调用方注入的适配器带来。 */
function renderViolations(snapshot: StructuralWikiSnapshot): string[] {
  const lines = ["## 越界告警", ""];
  if (snapshot.violations.length === 0) {
    lines.push(
      snapshot.acknowledgedViolations === 0
        ? "- 无。当前工作区的模块边界、层方向、循环依赖与深导入检查全部干净。"
        : `- 无未认账告警；另有 ${formatCount(
            snapshot.acknowledgedViolations,
          )} 条已写进 \`.architecture-baseline.json\` 的历史告警，完整清单见 \`pnpm architecture:check\`。`,
      "",
    );
    return lines;
  }
  const byRule = new Map<string, typeof snapshot.violations>();
  for (const violation of snapshot.violations) {
    byRule.set(violation.rule, [...(byRule.get(violation.rule) ?? []), violation]);
  }
  lines.push(
    `- 未认账告警 ${formatCount(snapshot.violations.length)} 条（已认账 ${formatCount(
      snapshot.acknowledgedViolations,
    )} 条）。完整判定与逐条修复以 \`pnpm architecture:check\` 为准，本节只是同一份结果的结构化视图。`,
    "",
  );
  for (const [rule, entries] of [...byRule.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )) {
    lines.push(`### \`${rule}\`（${formatCount(entries.length)} 条）`, "");
    for (const entry of entries.slice(0, VIOLATIONS_PER_RULE)) {
      lines.push(`- \`${entry.file}\`${entry.module ? `（模块 \`${entry.module}\`）` : ""}：${entry.message}`);
    }
    if (entries.length > VIOLATIONS_PER_RULE) {
      lines.push(`- …另 ${formatCount(entries.length - VIOLATIONS_PER_RULE)} 条未列出。`);
    }
    lines.push("");
  }
  return lines;
}

/**
 * 概览页 + 每模块一页。
 * 页面里的口径必须写明白：模块 id 来自哪一种划分、依赖方向数的是什么、越界告警从哪来。
 */
export function renderStructuralWiki(
  snapshot: StructuralWikiSnapshot,
  meta: { readonly generatedAt: string },
): WikiRenderedFile[] {
  const dependencyBasis =
    snapshot.moduleScope === "policy"
      ? [
          "- **依赖方向**：索引里的静态 `import` / `export ... from` 说明符，按模块聚合；动态 `import()` 与 " +
            "`require()` 不在统计内。",
          `  - 解析沿用 \`scripts/architecture\` 的文件集合（policy 各模块 roots 下 discover 到的文件），与 \`pnpm architecture:check\` 同一口径；` +
            `roots 之外的文件只作为引用方出现，不会成为被依赖目标，所以 \`unregistered\` 一行的「被依赖」通常是空的。`,
          `  - 解析不到仓内文件的 ${formatCount(snapshot.unresolvedImports)} 条（外部包、roots 之外的目标）不计入依赖表。`,
        ]
      : [
          "- **依赖方向：未计算**。本次没有拿到模块口径适配器（工作区缺 `architecture-policy.yaml` 与 " +
            "`scripts/architecture`），依赖列一律留空；模块清单与导出面仍然有效。",
        ];

  const overview = [
    "# 代码库结构视图",
    "",
    `> 生成时间：${meta.generatedAt}`,
    `> 工作区：${snapshot.workspace}`,
    `> 索引构建于：${snapshot.builtAt || "未知"}`,
    "",
    `- 文件 ${formatCount(snapshot.files)} · 符号 ${formatCount(snapshot.symbols)} · 引用边 ${formatCount(snapshot.edges)}`,
    `- 模块：${snapshot.modules.length} 个（口径：${
      snapshot.moduleScope === "policy" ? "`architecture-policy.yaml`" : "路径推导的包级"
    }）`,
    `- 符号级引用边：已计算过精确边的导出符号 ${formatCount(snapshot.coverage.computedSymbolPairs)} 个 / 导出符号 ${formatCount(
      snapshot.coverage.exportedSymbols,
    )} 个（查询时懒算并缓存，未查过的符号不贡献边数）`,
    snapshot.stale
      ? `- **新鲜度：存在未能重抽的文件，下列数据不可整份采信**。原因：${snapshot.staleReason ?? "未记录"}`
      : "- 新鲜度：索引与磁盘一致",
    "",
    "## 模块清单",
    "",
    "| 模块 | 文件 | 导出符号 | 依赖（出，按 import 条数） | 被依赖（入，按 import 条数） |",
    "| --- | --- | --- | --- | --- |",
    ...snapshot.modules.map((module) => {
      const summary = moduleSummary(module);
      return `| [\`${module.id}\`](./modules/${moduleSlug(module.id)}.md) | ${formatCount(summary.files)} | ${formatCount(summary.exports)} | ${directionLine(module.dependsOn, snapshot.moduleScope, 4)} | ${directionLine(module.dependedBy, snapshot.moduleScope, 4)} |`;
    }),
    "",
    "## 读这份视图时注意",
    "",
    `- **模块 id 口径**：${
      snapshot.moduleScope === "policy"
        ? "与 `architecture-policy.yaml` 的模块划分对齐；`unregistered` 桶里是还没登记进 policy 的文件。"
        : "由索引器按路径推导（`packages/<x>`、`apps/<x>`），只到包级，比 policy 的模块粗。"
    }`,
    ...dependencyBasis,
    "- 本视图不含散文说明。说明由生成器产出后并入同一目录，页面结构不变。",
    "",
    ...renderViolations(snapshot),
  ];

  const pages = snapshot.modules.map((module) => {
    const summary = moduleSummary(module);
    const moduleViolations = snapshot.violations.filter((entry) => entry.module === module.id);
    const lines = [
      `# ${module.id}`,
      "",
      `- 文件 ${formatCount(summary.files)} · 导出符号 ${formatCount(summary.exports)}`,
      `- 依赖（出，按 import 条数）：${directionLine(module.dependsOn, snapshot.moduleScope)}`,
      `- 被依赖（入，按 import 条数）：${directionLine(module.dependedBy, snapshot.moduleScope)}`,
      "",
      ...(moduleViolations.length === 0
        ? []
        : [
            `## 越界告警（${formatCount(moduleViolations.length)} 条）`,
            "",
            ...moduleViolations
              .slice(0, VIOLATIONS_PER_RULE)
              .map((entry) => `- \`${entry.rule}\` · ${entry.file}：${entry.message}`),
            ...(moduleViolations.length > VIOLATIONS_PER_RULE
              ? [`- …另 ${formatCount(moduleViolations.length - VIOLATIONS_PER_RULE)} 条未列出。`]
              : []),
            "",
          ]),
      "## 文件与导出面",
      "",
    ];
    const listed = module.files.filter((file) => file.exports.length > 0);
    for (const file of listed) {
      lines.push(`### ${file.path}`, "");
      for (const symbol of file.exports) {
        lines.push(`- \`${symbol.name}\`（${symbol.kind}，第 ${symbol.line} 行）`);
      }
      lines.push("");
    }
    const skipped = summary.files - listed.length;
    if (skipped > 0) {
      lines.push(`> 另有 ${formatCount(skipped)} 个文件没有对外导出符号，未在此列出。`, "");
    }
    return { path: `modules/${moduleSlug(module.id)}.md`, content: lines.join("\n") };
  });

  return [{ path: "index.md", content: overview.join("\n") }, ...pages];
}

/** 一次导出的结果：写了哪些页，以及快照本身的规模、口径与新鲜度（调用方要如实报告这几件事）。 */
export interface StructuralWikiExportResult {
  readonly outDir: string;
  readonly pages: readonly WikiRenderedFile[];
  readonly modules: number;
  readonly moduleScope: StructuralWikiSnapshot["moduleScope"];
  readonly files: number;
  readonly symbols: number;
  readonly edges: number;
  readonly violations: number;
  readonly stale: boolean;
  readonly staleReason?: string;
}

/**
 * 导出到指定目录。落点有两条硬规矩：不许盖掉工作区根目录本身，
 * 也不许写进索引自己的目录（`<workspace>/<契约目录>/codegraph`）——那里只有 store 说了算。
 */
export async function exportStructuralWiki(
  root: string,
  outDir: string,
  options: QueryOptions = {},
  meta: { readonly generatedAt?: string } = {},
  adapter?: StructuralWikiPolicyAdapter,
): Promise<StructuralWikiExportResult> {
  const workspace = path.resolve(root);
  const target = path.resolve(workspace, outDir);
  const indexDir = path.dirname(codegraphIndexPath(workspace));
  if (target === workspace) {
    throw new Error(`导出目录不能是工作区根目录：${toPosix(workspace, target)}`);
  }
  if (target === indexDir || target.startsWith(indexDir + path.sep)) {
    throw new Error(
      `导出目录落在索引自己的目录里（${toPosix(workspace, indexDir)}），索引是纯派生物但只由它自己写；换一个目录。`,
    );
  }

  const snapshot = await buildStructuralWiki(workspace, options, adapter);
  const rendered = renderStructuralWiki(snapshot, {
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
  });

  await mkdir(path.join(target, "modules"), { recursive: true });
  for (const file of rendered) {
    await writeFile(path.join(target, file.path), file.content, "utf8");
  }

  // 删掉本次没再产出的旧页：模块消失后留一份僵尸页，比少一份更难解释。
  const keep = new Set(rendered.map((file) => file.path));
  const moduleDir = path.join(target, "modules");
  const existing = await readdir(moduleDir, { withFileTypes: true });
  for (const entry of existing) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (keep.has(`modules/${entry.name}`)) continue;
    await rm(path.join(moduleDir, entry.name), { force: true });
  }

  return {
    outDir: target,
    pages: rendered,
    modules: snapshot.modules.length,
    moduleScope: snapshot.moduleScope,
    files: snapshot.files,
    symbols: snapshot.symbols,
    edges: snapshot.edges,
    violations: snapshot.violations.length,
    stale: snapshot.stale,
    ...(snapshot.staleReason === undefined ? {} : { staleReason: snapshot.staleReason }),
  };
}
