/**
 * 门面：rebuild / ensure / query / stats（spec docs/codegraph-index.md §4）。
 *
 * 性能模型（2026-11-19 实测定型）：
 * - 符号表与 import 说明符：裸 TypeScript 逐文件 parse（~2ms/文件，本仓 ~8453 文件约 20s），流式处理内存有界。
 * - 引用边：查询时对「被查的单个符号」用一次性小 Project 走语言服务懒算（extract.ts），
 *   结果持久缓存进 edge_coverage 表——同一符号全生命周期只算一次。
 * - ensure 只 stat 比对：干净时零解析。
 * - 新鲜度（spec §5.1）：「检测到变化但重抽失败」的文件，其查询结果携带 stale 标记
 *   返回，禁止静默给旧图。
 * - 事件顺序：文件系统（事实源）→ stat 比对 → 重抽 → store 单事务替换。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  createEdgeProject,
  extractFileFacts,
  extractSymbolEdges,
  moduleForPath,
  toPosix,
} from "./extract.js";
import { codegraphIndexPath } from "./indexPath.js";
import { CodegraphStore, type EdgeRow, type FileRow } from "./store.js";
import type {
  CodegraphEdge,
  CodegraphStats,
  CodegraphSymbol,
  StructuralWikiPolicyAdapter,
  StructuralWikiSnapshot,
  SymbolQuery,
  SymbolQueryResult,
} from "./contract.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const PRUNED_DIRS = new Set(["node_modules", "dist", "build", "coverage", "out", ".git", ".dlMeta", ".cache"]);
/** filePath + inbound 方向时最多懒算的导出符号数（语言服务调用贵）。 */
const MAX_INBOUND_SYMBOLS_PER_FILE = 20;
/** 懒算边时的候选引用方上限（文本预筛命中数）。 */
const MAX_EDGE_CANDIDATES = 300;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 非阻塞的文件列表快照（懒算边用；缓存过期时后台刷新，不阻塞查询路径）。 */
function diskFilesFor(ctx: WorkspaceContext): readonly string[] {
  return ctx.filesCache?.files ?? [];
}

interface WorkspaceContext {
  readonly root: string;
  readonly store: CodegraphStore;
  /** 目录遍历结果进程内缓存：stat 比对与候选扫描共享，TTL 内不再重走目录树。 */
  filesCache: { readonly files: readonly string[]; readonly at: number } | null;
}

const FILES_CACHE_TTL_MS = 60_000;

const contexts = new Map<string, WorkspaceContext>();
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(root, next);
  return next;
}

function sha1(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function getContext(root: string): WorkspaceContext {
  const existing = contexts.get(root);
  if (existing) return existing;
  const ctx: WorkspaceContext = { root, store: new CodegraphStore(codegraphIndexPath(root)), filesCache: null };
  contexts.set(root, ctx);
  return ctx;
}

async function getCachedFiles(ctx: WorkspaceContext): Promise<readonly string[]> {
  if (ctx.filesCache && Date.now() - ctx.filesCache.at < FILES_CACHE_TTL_MS) {
    return ctx.filesCache.files;
  }
  const files = await walkSourceFiles(ctx.root);
  ctx.filesCache = { files, at: Date.now() };
  return files;
}

export async function walkSourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!PRUNED_DIRS.has(entry.name)) await visit(full);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        found.push(full);
      }
    }
  }
  await visit(root);
  return found;
}

async function currentStat(root: string, absPath: string): Promise<{ mtimeMs: number; hash: string } | null> {
  let stats;
  try {
    stats = await fsPromises.stat(absPath);
    // 读不出内容（同名目录、权限、瞬时 IO 错误）按「内容已变」处理，交给重抽那一步
    // 记录失败并标 stale（spec §5.1），不在这里把异常抛穿查询路径。
    const content = await fsPromises.readFile(absPath, "utf8");
    return { mtimeMs: stats.mtimeMs, hash: sha1(content) };
  } catch {
    return null;
  }
}

/** 单文件符号表 + import 说明符重抽（裸 TS ~2ms）。replaceFile/invalidate 连带作废关联缓存边。 */
function reindexFileSymbols(ctx: WorkspaceContext, absPath: string): void {
  const rel = toPosix(ctx.root, absPath);
  let stats;
  try {
    stats = statSync(absPath);
  } catch {
    throw new Error(`file disappeared: ${rel}`);
  }
  const text = readFileSync(absPath, "utf8");
  const fileRow: FileRow = {
    path: rel,
    mtimeMs: stats.mtimeMs,
    hash: sha1(text),
    module: moduleForPath(ctx.root, absPath),
  };
  const facts = extractFileFacts(ctx.root, absPath, text);
  ctx.store.replaceFile(fileRow, facts.symbols, facts.imports);
  // 该文件作为「引用方」参与的其它 owner 缓存边随内容变更作废（spec §5.1 不静默给旧边）。
  ctx.store.invalidateEdgesFrom(rel);
}

/** 全量重建（CLI rebuild 入口）。覆盖式：清库 → 逐文件流式抽符号表。 */
export async function rebuildIndex(root: string): Promise<{ files: number; symbols: number; edges: number }> {
  const ctx = contexts.get(root) ?? getContext(root);
  const files = await getCachedFiles(ctx);
  for (const file of ctx.store.listFiles()) ctx.store.removeFile(file.path);
  let errorCount = 0;
  let firstError: string | null = null;
  for (const abs of files) {
    try {
      reindexFileSymbols(ctx, abs);
    } catch (error) {
      // 单文件不可读/不可解析：跳过（索引缺席 ≠ 旧数据，不违反 §5.1）；错误计数进 meta 供 stats 观测。
      errorCount += 1;
      if (!firstError) {
        firstError = `${toPosix(ctx.root, abs)}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
  ctx.store.setMeta("built_at", new Date().toISOString());
  ctx.store.setMeta("rebuild_error_count", String(errorCount));
  ctx.store.setMeta("rebuild_first_error", firstError ?? "");
  return ctx.store.counts();
}

interface EnsureReport {
  readonly reindexed: readonly string[];
  readonly failed: ReadonlyMap<string, string>;
}

/** 查询前按需增量：mtime 未变零读取；mtime 变了读内容比 hash；新文件补录。 */
async function ensureIndex(ctx: WorkspaceContext): Promise<EnsureReport> {
  const reindexed: string[] = [];
  const failed = new Map<string, string>();
  const changedPaths: string[] = [];

  for (const row of ctx.store.listFiles()) {
    const abs = path.join(ctx.root, row.path);
    let stats;
    try {
      stats = await fsPromises.stat(abs);
    } catch {
      ctx.store.removeFile(row.path);
      continue;
    }
    if (Number(stats.mtimeMs) === row.mtimeMs) continue;
    const disk = await currentStat(ctx.root, abs);
    if (disk && disk.hash === row.hash) {
      ctx.store.updateFileMtime(row.path, disk.mtimeMs);
      continue;
    }
    changedPaths.push(abs);
  }

  const diskFiles = await getCachedFiles(ctx);
  const indexed = new Set(ctx.store.listFiles().map((f) => f.path));
  const missing = diskFiles.filter((abs) => !indexed.has(toPosix(ctx.root, abs)));

  if (changedPaths.length === 0 && missing.length === 0) {
    return { reindexed, failed };
  }

  for (const abs of [...changedPaths, ...missing]) {
    const rel = toPosix(ctx.root, abs);
    try {
      reindexFileSymbols(ctx, abs);
      reindexed.push(rel);
    } catch (error) {
      failed.set(rel, error instanceof Error ? error.message : String(error));
    }
  }
  return { reindexed, failed };
}

const CONTRACT_KINDS: readonly CodegraphSymbol["kind"][] = [
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "variable",
  "method",
  "property",
];

function kindToContract(kind: string): CodegraphSymbol["kind"] {
  return (CONTRACT_KINDS as readonly string[]).includes(kind)
    ? (kind as CodegraphSymbol["kind"])
    : "variable";
}

function toContractSymbol(row: {
  filePath: string;
  name: string;
  kind: string;
  line: number;
  isExported: boolean;
  module?: string;
}): CodegraphSymbol {
  return {
    name: row.name,
    kind: kindToContract(row.kind),
    location: { filePath: row.filePath, line: row.line },
    isExported: row.isExported,
    module: row.module ?? "",
  };
}

function toContractEdge(edge: EdgeRow): CodegraphEdge {
  return {
    from: { filePath: edge.fromFile, line: edge.fromLine },
    to: { filePath: edge.toFile, line: edge.toLine },
    name: edge.name,
    isReexport: edge.isReexport,
  };
}

export interface QueryOptions {
  /** false 时不做增量重抽、只校验并标注 stale（测试 stale 标记用）；运行时工具默认 true。 */
  readonly ensure?: boolean;
}

export async function querySymbols(
  root: string,
  query: SymbolQuery,
  options: QueryOptions = {},
): Promise<SymbolQueryResult> {
  const ctx = contexts.get(root) ?? getContext(root);
  let failed = new Map<string, string>();
  if (options.ensure !== false) {
    const report = await withLock(root, () => ensureIndex(ctx));
    failed = new Map(report.failed);
  }
  const limit = Math.min(query.limit ?? 100, 500);
  const direction = query.direction ?? "both";
  const symbols: CodegraphSymbol[] = [];
  const edges: CodegraphEdge[] = [];
  const targetFiles = new Set<string>();

  const collectInbound = (ownerFile: string, name: string): void => {
    if (direction === "outbound") return;
    if (!ctx.store.isEdgeCovered(ownerFile, name)) {
      try {
        // 引用方不在 owner 的 import 闭包里（它们 import owner），所以 program 必须包含
        // 候选引用方。先按符号名做文本预筛（正则词边界），再把 owner+候选装进一次性
        // 小 Project 跑 findReferences——2026-11-19 实测：预筛 1.2s + 求边 6.5s，
        // 结果持久缓存，同一符号只算一次。直接全仓 findReferences 会 OOM/超 10 分钟。
        const abs = path.join(ctx.root, ownerFile);
        const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`);
        const candidates: string[] = [];
        for (const file of diskFilesFor(ctx)) {
          if (file === abs) continue;
          let text: string;
          try {
            text = readFileSync(file, "utf8");
          } catch {
            continue;
          }
          if (pattern.test(text)) {
            candidates.push(file);
            if (candidates.length >= MAX_EDGE_CANDIDATES) break;
          }
        }
        const project = createEdgeProject(ctx.root);
        // 用 addSourceFileAtPathIfExists 而不是 addSourceFilesAtPaths：后者按 glob 匹配，
        // Windows 的「\\」绝对路径一个都匹配不上，曾让全部懒算边静默为空并误报 stale。
        const sf = project.addSourceFileAtPathIfExists(abs);
        if (!sf) {
          failed.set(ownerFile, `source file not loaded: ${ownerFile}`);
          return;
        }
        for (const candidate of candidates) project.addSourceFileAtPathIfExists(candidate);
        const computed = extractSymbolEdges(ctx.root, sf, name);
        if (!computed) {
          failed.set(ownerFile, `export not found: ${name}`);
          return;
        }
        ctx.store.replaceEdges(ownerFile, name, computed);
      } catch (error) {
        failed.set(ownerFile, error instanceof Error ? error.message : String(error));
        return;
      }
    }
    for (const edge of ctx.store.inboundEdges(ownerFile, name)) {
      if (edges.length >= limit) return;
      edges.push(toContractEdge(edge));
    }
  };

  if (query.symbol) {
    for (const row of ctx.store.symbolsByName(query.symbol, limit)) {
      symbols.push(
        toContractSymbol({
          ...row,
          module: moduleForPath(ctx.root, path.join(ctx.root, row.filePath)),
        }),
      );
      targetFiles.add(row.filePath);
      collectInbound(row.filePath, row.name);
    }
  }
  if (query.filePath) {
    const rel = toPosix(ctx.root, path.resolve(ctx.root, query.filePath));
    targetFiles.add(rel);
    if (!query.symbol) {
      for (const row of ctx.store.symbolsForFile(rel)) {
        symbols.push(toContractSymbol({ ...row, module: moduleForPath(ctx.root, path.join(ctx.root, rel)) }));
      }
    }
    if (direction !== "inbound") {
      for (const edge of ctx.store.outboundEdges(rel)) {
        if (edges.length >= limit) break;
        edges.push(toContractEdge(edge));
      }
    } else if (!query.symbol) {
      const exported = ctx.store.symbolsForFile(rel).filter((s) => s.isExported);
      for (const s of exported.slice(0, MAX_INBOUND_SYMBOLS_PER_FILE)) {
        collectInbound(rel, s.name);
      }
    }
  }

  const staleTargets = [...targetFiles].filter((f) => failed.has(f));
  return {
    symbols,
    edges,
    stale: staleTargets.length > 0,
    staleReason:
      staleTargets.length > 0
        ? `重索引失败: ${staleTargets
            .slice(0, 5)
            .map((f) => `${f}: ${failed.get(f) ?? ""}`)
            .join("; ")}`
        : undefined,
  };
}

/**
 * 索引是否已就绪（spec §5.1：缺失时返回明确提示，绝不「查询顺带全量重建」）。
 * 只查文件存在与行数，不 stat 每个源文件——运行时工具每次查询都要过这道门。
 */
export function codegraphIndexReady(root: string): { ready: boolean; files: number } {
  if (!existsSync(codegraphIndexPath(root))) return { ready: false, files: 0 };
  const ctx = contexts.get(root) ?? getContext(root);
  const files = ctx.store.counts().files;
  return { ready: files > 0, files };
}

/**
 * 释放某个 workspace 的索引句柄与进程内缓存。
 * Windows 上没关的 SQLite 文件锁会让临时目录删不掉，测试与长驻进程的收尾都要走这里。
 */
export function closeCodegraphIndex(root: string): void {
  const ctx = contexts.get(root);
  if (!ctx) return;
  contexts.delete(root);
  locks.delete(root);
  ctx.store.close();
}

export async function codegraphStats(root: string): Promise<CodegraphStats> {
  const ctx = contexts.get(root) ?? getContext(root);
  const counts = ctx.store.counts();
  const files = ctx.store.listFiles();
  let staleCount = 0;
  for (const file of files) {
    try {
      const stats = await fsPromises.stat(path.join(ctx.root, file.path));
      if (Number(stats.mtimeMs) !== file.mtimeMs) staleCount += 1;
    } catch {
      staleCount += 1;
    }
  }
  return {
    files: counts.files,
    symbols: counts.symbols,
    edges: counts.edges,
    builtAt: ctx.store.getMeta("built_at") ?? "",
    staleRatio: counts.files === 0 ? 0 : staleCount / counts.files,
  };
}

interface WikiModuleEntry {
  readonly files: { readonly path: string; readonly exports: { readonly name: string; readonly kind: string; readonly line: number }[] }[];
  readonly dependsOn: Map<string, number>;
  readonly dependedBy: Map<string, number>;
}

/** 注入了 policy 适配器、但文件不属于任何已登记模块时的归属桶。 */
const UNREGISTERED_MODULE = "unregistered";

/**
 * 结构视图快照（spec §4.1 `CodegraphModules`）：模块清单、每模块的文件与导出面、
 * 模块间依赖方向、越界告警。全部从索引现有表聚合，不额外解析源码、不调模型。
 *
 * 依赖方向的数据源是索引里的**静态 import 说明符**（不是按符号懒算的精确引用边），
 * 所以它是全量而非下界；代价是动态 `import()`、`require()` 与外部包不计入。
 *
 * 模块口径与越界告警由调用方注入适配器：`architecture-policy.yaml` 的解析和那 14 条
 * 规则的唯一所有者在 `scripts/architecture`，本包不重复实现，也不自己读 YAML。
 * 没有适配器时依赖方向留空并在渲染端标注「未计算」——不在这里造第二套解析器。
 */
export async function buildStructuralWiki(
  root: string,
  options: QueryOptions = {},
  adapter?: StructuralWikiPolicyAdapter,
): Promise<StructuralWikiSnapshot> {
  const ctx = contexts.get(root) ?? getContext(root);
  let failed = new Map<string, string>();
  if (options.ensure !== false) {
    const report = await withLock(root, () => ensureIndex(ctx));
    failed = new Map(report.failed);
  }

  const rows = ctx.store.listFiles();
  const indexedModule = new Map(rows.map((row) => [row.path, row.module] as const));
  const byModule = new Map<string, WikiModuleEntry>();
  const entryFor = (module: string): WikiModuleEntry => {
    const existing = byModule.get(module);
    if (existing) return existing;
    const created: WikiModuleEntry = { files: [], dependsOn: new Map(), dependedBy: new Map() };
    byModule.set(module, created);
    return created;
  };
  // 无适配器时用索引里存的包级口径；有适配器时以 policy 为准，未登记的文件归进 unregistered。
  const classify = (rel: string): string =>
    adapter
      ? (adapter.moduleOf(rel) ?? UNREGISTERED_MODULE)
      : (indexedModule.get(rel) ?? moduleForPath(ctx.root, path.join(ctx.root, rel)));

  let exportedSymbols = 0;
  for (const row of rows) {
    const entry = entryFor(classify(row.path));
    const symbols = ctx.store.symbolsForFile(row.path).filter((symbol) => symbol.isExported);
    exportedSymbols += symbols.length;
    entry.files.push({
      path: row.path,
      exports: symbols.map((symbol) => ({
        name: symbol.name,
        kind: kindToContract(symbol.kind),
        line: symbol.line,
      })),
    });
  }

  let unresolvedImports = 0;
  if (adapter) {
    for (const imp of ctx.store.listImports()) {
      const fromModule = classify(imp.filePath);
      const target = adapter.resolveImport(imp.filePath, imp.specifier);
      if (target === null) {
        // 外部包、动态别名或 policy 未登记目录：不是本仓模块，不进依赖表。
        unresolvedImports += 1;
        continue;
      }
      const targetModule = classify(target);
      // 同模块内的 import 不进依赖表：这里要回答的是「谁跨了模块」。
      if (targetModule === fromModule) continue;
      const from = entryFor(fromModule);
      from.dependsOn.set(targetModule, (from.dependsOn.get(targetModule) ?? 0) + 1);
      const to = entryFor(targetModule);
      to.dependedBy.set(fromModule, (to.dependedBy.get(fromModule) ?? 0) + 1);
    }
  }

  const rank = (counts: Map<string, number>) =>
    [...counts.entries()]
      .map(([module, edges]) => ({ module, edges }))
      .sort((a, b) => b.edges - a.edges || a.module.localeCompare(b.module));

  const modules = [...byModule.entries()]
    .map(([id, entry]) => ({
      id,
      files: [...entry.files].sort((a, b) => a.path.localeCompare(b.path)),
      dependsOn: rank(entry.dependsOn),
      dependedBy: rank(entry.dependedBy),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const staleTargets = rows.filter((row) => failed.has(row.path)).map((row) => row.path);
  const counts = ctx.store.counts();
  return {
    workspace: ctx.root,
    builtAt: ctx.store.getMeta("built_at") ?? "",
    files: counts.files,
    symbols: counts.symbols,
    edges: counts.edges,
    moduleScope: adapter ? "policy" : "path",
    stale: staleTargets.length > 0,
    staleReason:
      staleTargets.length > 0
        ? `重索引失败: ${staleTargets
            .slice(0, 5)
            .map((f) => `${f}: ${failed.get(f) ?? ""}`)
            .join("; ")}`
        : undefined,
    unresolvedImports,
    coverage: { exportedSymbols, computedSymbolPairs: ctx.store.coveredPairCount() },
    violations: adapter?.violations ?? [],
    acknowledgedViolations: adapter?.acknowledgedViolations ?? 0,
    modules,
  };
}
