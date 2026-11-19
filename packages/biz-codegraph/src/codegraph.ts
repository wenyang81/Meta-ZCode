/**
 * 门面：rebuild / ensure / query / stats（spec docs/codegraph-index.md §4）。
 *
 * 分层性能模型（2026-11-19 全量 findReferences 实测超 10 分钟后定型）：
 * - 全量 rebuild 与查询前的 ensure 只建符号表（纯 AST 遍历，不碰语言服务）。
 * - 符号级精确引用边在查询时对「被查的那个符号」懒算，持久缓存进 edge_coverage 表；
 *   之后任何进程/会话直接命中 SQLite——持久索引保证同一符号只算一次。
 * - 事件顺序：文件系统（事实源）→ stat 比对 → 重抽 → store 单事务替换。
 * - 新鲜度（spec §5.1）：查询默认先 ensure；任何「检测到变化但重抽失败」的文件，
 *   其结果携带 stale 标记返回，禁止静默给旧图。
 */
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Project, FileSystemRefreshResult } from "ts-morph";
import { extractSymbols, extractSymbolEdges, moduleForPath, toPosix } from "./extract.js";
import { codegraphIndexPath } from "./indexPath.js";
import { CodegraphStore, type EdgeRow, type FileRow } from "./store.js";
import type {
  CodegraphEdge,
  CodegraphStats,
  CodegraphSymbol,
  SymbolQuery,
  SymbolQueryResult,
} from "./contract.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const PRUNED_DIRS = new Set(["node_modules", "dist", "build", "coverage", "out", ".git", ".dlMeta"]);
/** filePath + inbound 方向时最多懒算的导出符号数（语言服务调用贵，防一次性算全文件）。 */
const MAX_INBOUND_SYMBOLS_PER_FILE = 20;

interface WorkspaceContext {
  readonly root: string;
  readonly store: CodegraphStore;
  project: Project | null;
}

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

function sourceGlobs(root: string): string[] {
  const exclude = [
    "!**/node_modules/**",
    "!**/dist/**",
    "!**/build/**",
    "!**/coverage/**",
    "!**/out/**",
  ];
  const repoShape = [
    "packages/*/src/**/*.{ts,tsx,mts,cts}",
    "packages/*/test/**/*.{ts,tsx,mts,cts}",
    "apps/*/src/**/*.{ts,tsx,mts,cts}",
    "apps/*/test/**/*.{ts,tsx,mts,cts}",
  ];
  const generic = ["src/**/*.{ts,tsx,mts,cts}", "lib/**/*.{ts,tsx,mts,cts}", "test/**/*.{ts,tsx,mts,cts}"];
  const isRepoShaped = existsSync(path.join(root, "packages")) || existsSync(path.join(root, "apps"));
  return [...(isRepoShaped ? repoShape : generic), ...exclude];
}

function loadProject(root: string): Project {
  const tsconfig = ["tsconfig.json", "tsconfig.base.json"].find((f) => existsSync(path.join(root, f)));
  const project = new Project({
    ...(tsconfig ? { tsConfigFilePath: path.join(root, tsconfig) } : {}),
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: false,
  });
  project.addSourceFilesAtPaths(sourceGlobs(root).map((g) => path.join(root, g)));
  return project;
}

function getContext(root: string): WorkspaceContext {
  const existing = contexts.get(root);
  if (existing) return existing;
  const ctx: WorkspaceContext = {
    root,
    store: new CodegraphStore(codegraphIndexPath(root)),
    project: null,
  };
  contexts.set(root, ctx);
  return ctx;
}

/** Project 懒加载：干净查询（stat 全命中）永远不触发全仓解析。 */
function getProject(ctx: WorkspaceContext): Project {
  if (!ctx.project) ctx.project = loadProject(ctx.root);
  return ctx.project;
}

async function walkSourceFiles(root: string): Promise<string[]> {
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
  } catch {
    return null;
  }
  const content = await fsPromises.readFile(absPath, "utf8");
  return { mtimeMs: stats.mtimeMs, hash: sha1(content) };
}

/** 符号表重抽（不含语言服务）。作序：replaceFile 会连带作废该文件导出符号的缓存边。 */
function reindexFileSymbols(ctx: WorkspaceContext, project: Project, absPath: string): void {
  const sf = project.getSourceFile(absPath);
  if (!sf) throw new Error(`source file not loaded: ${toPosix(ctx.root, absPath)}`);
  const stats = statSync(absPath);
  const rel = toPosix(ctx.root, absPath);
  const fileRow: FileRow = {
    path: rel,
    mtimeMs: stats.mtimeMs,
    hash: sha1(sf.getFullText()),
    module: moduleForPath(ctx.root, absPath),
  };
  ctx.store.replaceFile(fileRow, extractSymbols(ctx.root, sf));
  // 该文件作为「引用方」参与的其它 owner 缓存边随内容变更作废（spec §5.1 不静默给旧边）。
  ctx.store.invalidateEdgesFrom(rel);
}

function rebuildAll(ctx: WorkspaceContext, project: Project): void {
  for (const sf of project.getSourceFiles()) {
    reindexFileSymbols(ctx, project, sf.getFilePath());
  }
  ctx.store.setMeta("built_at", new Date().toISOString());
}

/** 全量重建（CLI rebuild 入口）。覆盖式：先清库再逐文件抽符号表。同步阻塞，CLI 专用。 */
export function rebuildIndex(root: string): { files: number; symbols: number; edges: number } {
  const ctx = contexts.get(root) ?? getContext(root);
  const project = getProject(ctx);
  for (const file of ctx.store.listFiles()) ctx.store.removeFile(file.path);
  rebuildAll(ctx, project);
  return ctx.store.counts();
}

interface EnsureReport {
  readonly reindexed: readonly string[];
  readonly failed: ReadonlyMap<string, string>;
}

/**
 * 查询前按需增量：mtime 未变的文件零读取；mtime 变了才读内容比 hash。
 * 变更/新增文件需要 Project（懒加载）；删除只清库不碰 Project。
 */
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

  const loaded = new Set(
    (ctx.project?.getSourceFiles() ?? []).map((sf) => toPosix(ctx.root, sf.getFilePath())),
  );
  const diskFiles = await walkSourceFiles(ctx.root);
  const missing = diskFiles.filter((abs) => !loaded.has(toPosix(ctx.root, abs)));

  if (changedPaths.length === 0 && missing.length === 0) {
    return { reindexed, failed };
  }

  const project = getProject(ctx);
  for (const abs of changedPaths) {
    const rel = toPosix(ctx.root, abs);
    try {
      let sf = project.getSourceFile(abs);
      if (!sf) {
        project.addSourceFilesAtPaths([abs]);
        sf = project.getSourceFile(abs);
      } else if (sf.refreshFromFileSystemSync() === FileSystemRefreshResult.Deleted) {
        ctx.store.removeFile(rel);
        project.removeSourceFile(sf);
        continue;
      }
      if (!sf) throw new Error(`source file could not be loaded: ${rel}`);
      reindexFileSymbols(ctx, project, abs);
      reindexed.push(rel);
    } catch (error) {
      failed.set(rel, error instanceof Error ? error.message : String(error));
    }
  }
  if (missing.length > 0) {
    project.addSourceFilesAtPaths(missing);
    for (const abs of missing) {
      try {
        reindexFileSymbols(ctx, project, abs);
        reindexed.push(toPosix(ctx.root, abs));
      } catch (error) {
        failed.set(toPosix(ctx.root, abs), error instanceof Error ? error.message : String(error));
      }
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
  /** false 时不做增量重抽、只校验并标注 stale（测试用）；运行时工具保持默认 true。 */
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
        const project = getProject(ctx);
        const sf = project.getSourceFile(path.join(ctx.root, ownerFile));
        if (!sf) {
          failed.set(ownerFile, `source file not loaded: ${ownerFile}`);
          return;
        }
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
        toContractSymbol({ ...row, module: moduleForPath(ctx.root, path.join(ctx.root, row.filePath)) }),
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
