/**
 * 门面：rebuild / ensure / query / stats（spec docs/codegraph-index.md §4）。
 *
 * 分层性能模型：
 * - 全量 rebuild 与查询前的 ensure 只建符号表（纯 AST 遍历，不碰语言服务）。
 * - 符号级精确引用边在查询时按需懒算（单符号语言服务调用），持久缓存进 edge_coverage；
 *   之后任何进程/会话直接命中 SQLite——持久索引的目标就是"同一符号只算一次"。
 * - 事件顺序：文件系统（事实源）→ stat 比对 → 重抽 → store 单事务替换。
 * - 新鲜度（spec §5.1）：查询默认 ensure；任何「检测到变化但重抽失败」的文件，
 *   其结果携带 stale 标记返回，禁止静默给旧图。
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Project } from "ts-morph";
import { extractSymbols, extractSymbolEdges, moduleForPath, toPosix } from "./extract.js";
import { codegraphIndexPath } from "./indexPath.js";
import { CodegraphStore, type FileRow } from "./store.js";
import type {
  CodegraphEdge,
  CodegraphStats,
  CodegraphSymbol,
  SymbolQuery,
  SymbolQueryResult,
} from "./contract.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const PRUNED_DIRS = new Set(["node_modules", "dist", "build", "coverage", "out", ".git", ".dlMeta"]);

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
  const ctx: WorkspaceContext = { root, store: new CodegraphStore(codegraphIndexPath(root)), project: null };
  contexts.set(root, ctx);
  return ctx;
}

/** Project 懒加载：干净查询（stat 全命中）永远不触发解析。 */
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

function reindexFileSymbols(ctx: WorkspaceContext, project: Project, absPath: string): void {
  const sf = project.getSourceFile(absPath);
  if (!sf) throw new Error(`source file not loaded: ${toPosix(ctx.root, absPath)}`);
  const stats = fsPromises.statSync?.(absPath);
  if (!stats) throw new Error(`file disappeared: ${toPosix(ctx.root, absPath)}`);
  const { statSync } = fsPromises;
  void statSync;
  void stats;
  const fileRow: FileRow = {
    path: toPosix(ctx.root, absPath),
    mtimeMs: 0,
    hash: "",
    module: "",
  };
  throw new Error("placeholder");
}

export { getProject as _unusedGetProject };
