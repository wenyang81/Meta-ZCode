/**
 * SQLite 存储层：索引的唯一所有者（spec §5.4 无第二写入路径）。
 * node:sqlite 同步 API——索引操作都是本地快查询，不需要异步驱动。
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const CODEGRAPH_SCHEMA_VERSION = "3";

export interface FileRow {
  readonly path: string;
  readonly mtimeMs: number;
  readonly hash: string;
  readonly module: string;
}

/**
 * 一条静态 import/export-from 说明符。只存说明符不存解析结果：解析要贴着当前工作区
 * 做（路径别名、exports 回映），把目标文件写死进索引会让一次文件移动就污染图库。
 */
export interface ImportRow {
  readonly filePath: string;
  readonly specifier: string;
  readonly line: number;
  readonly typeOnly: boolean;
}

export interface SymbolRow {
  readonly filePath: string;
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly isExported: boolean;
}

export interface EdgeRow {
  /** 导出符号所属文件（边的 owner：增量重抽时按它删除旧行）。 */
  readonly ownerFile: string;
  readonly name: string;
  readonly fromFile: string;
  readonly fromLine: number;
  readonly toFile: string;
  readonly toLine: number;
  readonly isReexport: boolean;
}

interface FileRowSql {
  path: string;
  mtime_ms: number;
  hash: string;
  module: string;
}

interface SymbolRowSql {
  file_path: string;
  name: string;
  kind: string;
  line: number;
  is_exported: number;
}

interface EdgeRowSql {
  owner_file: string;
  name: string;
  from_file: string;
  from_line: number;
  to_file: string;
  to_line: number;
  is_reexport: number;
}

interface ImportRowSql {
  file_path: string;
  specifier: string;
  line: number;
  type_only: number;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  mtime_ms INTEGER NOT NULL,
  hash TEXT NOT NULL,
  module TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS symbols (
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  is_exported INTEGER NOT NULL,
  PRIMARY KEY (file_path, name, line)
);
CREATE TABLE IF NOT EXISTS edges (
  owner_file TEXT NOT NULL,
  name TEXT NOT NULL,
  from_file TEXT NOT NULL,
  from_line INTEGER NOT NULL,
  to_file TEXT NOT NULL,
  to_line INTEGER NOT NULL,
  is_reexport INTEGER NOT NULL,
  PRIMARY KEY (owner_file, name, from_file, from_line)
);
CREATE INDEX IF NOT EXISTS edges_from ON edges (from_file);
CREATE INDEX IF NOT EXISTS edges_owner ON edges (owner_file, name);
CREATE TABLE IF NOT EXISTS edge_coverage (
  owner_file TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (owner_file, name)
);
CREATE TABLE IF NOT EXISTS imports (
  file_path TEXT NOT NULL,
  specifier TEXT NOT NULL,
  line INTEGER NOT NULL,
  type_only INTEGER NOT NULL,
  PRIMARY KEY (file_path, line, specifier)
);
`;

function toFileRow(r: FileRowSql): FileRow {
  return { path: r.path, mtimeMs: Number(r.mtime_ms), hash: r.hash, module: r.module };
}

function toSymbolRow(r: SymbolRowSql): SymbolRow {
  return { filePath: r.file_path, name: r.name, kind: r.kind, line: Number(r.line), isExported: r.is_exported === 1 };
}

function toEdgeRow(r: EdgeRowSql): EdgeRow {
  return {
    ownerFile: r.owner_file,
    name: r.name,
    fromFile: r.from_file,
    fromLine: Number(r.from_line),
    toFile: r.to_file,
    toLine: Number(r.to_line),
    isReexport: r.is_reexport === 1,
  };
}

function toImportRow(r: ImportRowSql): ImportRow {
  return { filePath: r.file_path, specifier: r.specifier, line: Number(r.line), typeOnly: r.type_only === 1 };
}

export class CodegraphStore {
  private readonly db: DatabaseSync;

  constructor(indexPath: string) {
    mkdirSync(path.dirname(indexPath), { recursive: true });
    this.db = new DatabaseSync(indexPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA_SQL);
    const version = this.getMeta("schema_version");
    if (version !== CODEGRAPH_SCHEMA_VERSION) {
      // schema 不兼容时整库重建：索引是纯派生物，丢弃零成本（spec §3 事实源在文件系统）。
      this.db.exec(
        "DELETE FROM meta; DELETE FROM files; DELETE FROM symbols; DELETE FROM edges; DELETE FROM edge_coverage; DELETE FROM imports;",
      );
      this.setMeta("schema_version", CODEGRAPH_SCHEMA_VERSION);
    }
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  listFiles(): FileRow[] {
    return (this.db.prepare("SELECT path, mtime_ms, hash, module FROM files").all() as unknown as FileRowSql[]).map(toFileRow);
  }

  /** 全仓静态 import 说明符（结构视图的依赖方向数据源：一次读全表，量级 ~4 万行）。 */
  listImports(): ImportRow[] {
    return (
      this.db
        .prepare("SELECT file_path, specifier, line, type_only FROM imports ORDER BY file_path, line")
        .all() as unknown as ImportRowSql[]
    ).map(toImportRow);
  }

  updateFileMtime(pathValue: string, mtimeMs: number): void {
    this.db.prepare("UPDATE files SET mtime_ms = ? WHERE path = ?").run(mtimeMs, pathValue);
  }

  removeFile(pathValue: string): void {
    this.db.prepare("DELETE FROM files WHERE path = ?").run(pathValue);
    this.db.prepare("DELETE FROM symbols WHERE file_path = ?").run(pathValue);
    this.db.prepare("DELETE FROM edges WHERE owner_file = ? OR from_file = ?").run(pathValue, pathValue);
    this.db.prepare("DELETE FROM edge_coverage WHERE owner_file = ?").run(pathValue);
    this.db.prepare("DELETE FROM imports WHERE file_path = ?").run(pathValue);
  }

  /** 符号表与 import 表同步替换：两者来自同一次 parse，拆开写会让结构视图读到新旧混叠。 */
  replaceFile(file: FileRow, symbols: readonly SymbolRow[], imports: readonly ImportRow[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM files WHERE path = ?").run(file.path);
      this.db.prepare("DELETE FROM symbols WHERE file_path = ?").run(file.path);
      this.db.prepare("DELETE FROM edges WHERE owner_file = ?").run(file.path);
      this.db.prepare("DELETE FROM edge_coverage WHERE owner_file = ?").run(file.path);
      this.db.prepare("DELETE FROM imports WHERE file_path = ?").run(file.path);
      this.db
        .prepare("INSERT INTO files (path, mtime_ms, hash, module) VALUES (?, ?, ?, ?)")
        .run(file.path, file.mtimeMs, file.hash, file.module);
      const insertSymbol = this.db.prepare(
        "INSERT OR IGNORE INTO symbols (file_path, name, kind, line, is_exported) VALUES (?, ?, ?, ?, ?)",
      );
      for (const s of symbols) {
        insertSymbol.run(s.filePath, s.name, s.kind, s.line, s.isExported ? 1 : 0);
      }
      const insertImport = this.db.prepare(
        "INSERT OR IGNORE INTO imports (file_path, specifier, line, type_only) VALUES (?, ?, ?, ?)",
      );
      for (const i of imports) {
        insertImport.run(i.filePath, i.specifier, i.line, i.typeOnly ? 1 : 0);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** 单符号精确边持久缓存：查询时懒算一次，之后所有会话直接命中。 */
  replaceEdges(ownerFile: string, name: string, edges: readonly EdgeRow[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM edges WHERE owner_file = ? AND name = ?").run(ownerFile, name);
      const insertEdge = this.db.prepare(
        "INSERT OR IGNORE INTO edges (owner_file, name, from_file, from_line, to_file, to_line, is_reexport) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const e of edges) {
        insertEdge.run(
          e.ownerFile,
          e.name,
          e.fromFile,
          e.fromLine,
          e.toFile,
          e.toLine,
          e.isReexport ? 1 : 0,
        );
      }
      this.db
        .prepare("INSERT OR IGNORE INTO edge_coverage (owner_file, name) VALUES (?, ?)")
        .run(ownerFile, name);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  isEdgeCovered(ownerFile: string, name: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 AS ok FROM edge_coverage WHERE owner_file = ? AND name = ?")
        .get(ownerFile, name) !== undefined
    );
  }

  /** 已算过精确边的「声明文件+符号名」对数；结构视图用它说明边覆盖了多少导出符号。 */
  coveredPairCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM edge_coverage").get() as { c: number | bigint };
    return Number(row.c);
  }

  /** 引用点所在文件变更后，其作为 from_file 参与的旧边全部作废，相关 owner 的缓存一并失效。 */
  invalidateEdgesFrom(fromFile: string): void {
    const owners = this.affectedCoverageOwners(fromFile);
    this.db.prepare("DELETE FROM edges WHERE from_file = ?").run(fromFile);
    const clear = this.db.prepare("DELETE FROM edge_coverage WHERE owner_file = ?");
    for (const owner of owners) clear.run(owner);
  }

  private affectedCoverageOwners(fromFile: string): string[] {
    return (
      this.db
        .prepare("SELECT DISTINCT owner_file FROM edges WHERE from_file = ?")
        .all(fromFile) as unknown as { owner_file: string }[]
    ).map((r) => r.owner_file);
  }

  inboundEdges(ownerFile: string, name: string): EdgeRow[] {
    return (
      this.db
        .prepare(
          "SELECT owner_file, name, from_file, from_line, to_file, to_line, is_reexport FROM edges WHERE owner_file = ? AND name = ?",
        )
        .all(ownerFile, name) as unknown as EdgeRowSql[]
    ).map(toEdgeRow);
  }

  outboundEdges(fromFile: string): EdgeRow[] {
    return (
      this.db
        .prepare(
          "SELECT owner_file, name, from_file, from_line, to_file, to_line, is_reexport FROM edges WHERE from_file = ?",
        )
        .all(fromFile) as unknown as EdgeRowSql[]
    ).map(toEdgeRow);
  }

  symbolsForFile(filePath: string): SymbolRow[] {
    return (
      this.db
        .prepare("SELECT file_path, name, kind, line, is_exported FROM symbols WHERE file_path = ? ORDER BY line")
        .all(filePath) as unknown as SymbolRowSql[]
    ).map(toSymbolRow);
  }

  symbolsByName(name: string, limit: number): SymbolRow[] {
    return (
      this.db
        .prepare(
          "SELECT file_path, name, kind, line, is_exported FROM symbols WHERE name = ? ORDER BY is_exported DESC, file_path LIMIT ?",
        )
        .all(name, limit) as unknown as SymbolRowSql[]
    ).map(toSymbolRow);
  }

  counts(): { files: number; symbols: number; edges: number } {
    const files = (this.db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number | bigint }).c;
    const symbols = (this.db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number | bigint }).c;
    const edges = (this.db.prepare("SELECT COUNT(*) AS c FROM edges").get() as { c: number | bigint }).c;
    return { files: Number(files), symbols: Number(symbols), edges: Number(edges) };
  }

  close(): void {
    this.db.close();
  }
}
