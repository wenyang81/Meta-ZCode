/**
 * 抽取层，两套引擎（2026-11-19 基准：裸 TS 解析 1.9ms/文件 vs ts-morph 包装 ~900ms/文件）：
 * - 符号表 + import 说明符：裸 TypeScript 编译器逐文件 parse（无 Project、无语言服务），全仓分钟内。
 * - 引用边：ts-morph 语言服务 findReferences（与 scripts/dep-refs.mjs 同机制），
 *   精确但贵——只对被查询单符号懒算，结果持久缓存。
 */
import * as fsSync from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  Node,
  Project,
  type Identifier,
  type SourceFile as MorphSourceFile,
  type Node as MorphNode,
} from "ts-morph";
import type { EdgeRow, ImportRow, SymbolRow } from "./store.js";

/** 单符号最多收录的引用边数，防超大符号（被全仓引用的类型）拖爆索引与输出。 */
export const MAX_EDGES_PER_SYMBOL = 500;

/** 模块归属：packages/<x>、apps/<x> 取两段；其余取首段；根下散文件记 "."。 */
export function moduleForPath(root: string, filePath: string): string {
  const rel = path.relative(root, filePath).split(path.sep).join("/");
  const segments = rel.split("/");
  if ((segments[0] === "packages" || segments[0] === "apps") && segments.length > 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments.length > 1 ? (segments[0] ?? ".") : ".";
}

export function toPosix(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

const KIND_BY_SYNTAX: Record<number, string> = {
  [ts.SyntaxKind.FunctionDeclaration]: "function",
  [ts.SyntaxKind.ClassDeclaration]: "class",
  [ts.SyntaxKind.InterfaceDeclaration]: "interface",
  [ts.SyntaxKind.TypeAliasDeclaration]: "type",
  [ts.SyntaxKind.EnumDeclaration]: "enum",
  [ts.SyntaxKind.VariableDeclaration]: "variable",
};

function isExportedNode(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/**
 * 一次 parse 出两份事实：顶层命名声明（符号表）与静态说明符（模块依赖方向）。
 * 分开 parse 会让 rebuild 成本翻倍（本仓 ~8459 文件），所以两者共用同一份 SourceFile。
 */
export function extractFileFacts(
  root: string,
  absPath: string,
  text: string,
): { symbols: SymbolRow[]; imports: ImportRow[] } {
  const relPath = toPosix(root, absPath);
  const sf = ts.createSourceFile(
    absPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const rows: SymbolRow[] = [];
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      const name = stmt.name?.text;
      if (!name) continue;
      rows.push({
        filePath: relPath,
        name,
        kind: KIND_BY_SYNTAX[stmt.kind] ?? "variable",
        line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1,
        isExported: isExportedNode(stmt),
      });
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        // 解构声明（BindingPattern）没有单一符号名，P1 不索引。
        if (!ts.isIdentifier(decl.name)) continue;
        rows.push({
          filePath: relPath,
          name: decl.name.text,
          kind: "variable",
          line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1,
          isExported: isExportedNode(stmt),
        });
      }
    }
  }
  return { symbols: rows, imports: collectImports(sf, relPath) };
}

/**
 * 静态说明符：`import x from`、`export ... from`、`import x = require()`。
 * typeOnly 的判定与 scripts/architecture/policy.mjs 保持一致（`import type {}`、
 * 全部具名成员带 type 都算类型边），否则两处口径会分叉。
 * 动态 `import()` 与 `require()` 不收录：它们的解析结果不可静态确定。
 */
function collectImports(sf: ts.SourceFile, relPath: string): ImportRow[] {
  const rows: ImportRow[] = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const allMembersTypeOnly =
        !!clause &&
        !clause.name &&
        !!named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      rows.push({
        filePath: relPath,
        specifier: node.moduleSpecifier.text,
        line: lineOf(node),
        typeOnly: !!clause?.isTypeOnly || allMembersTypeOnly,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      rows.push({
        filePath: relPath,
        specifier: node.moduleSpecifier.text,
        line: lineOf(node),
        typeOnly: !!node.isTypeOnly,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      rows.push({
        filePath: relPath,
        specifier: node.moduleReference.expression.text,
        line: lineOf(node),
        typeOnly: false,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return rows;
}

function isReexportReference(node: MorphNode): boolean {
  let current: MorphNode | undefined = node;
  while (current) {
    const kind = current.getKindName();
    if (kind === "ExportSpecifier" || kind === "ExportDeclaration") return true;
    if (kind === "SourceFile") return false;
    current = current.getParent();
  }
  return false;
}

interface ExportDeclSite {
  readonly nameNode: Identifier;
  readonly line: number;
}

function findExportDecl(sf: MorphSourceFile, symbolName: string): ExportDeclSite | null {
  for (const stmt of sf.getStatements()) {
    if (
      Node.isFunctionDeclaration(stmt) ||
      Node.isClassDeclaration(stmt) ||
      Node.isInterfaceDeclaration(stmt) ||
      Node.isTypeAliasDeclaration(stmt) ||
      Node.isEnumDeclaration(stmt)
    ) {
      if (stmt.getName() === symbolName) {
        const nameNode = stmt.getNameNode();
        if (nameNode) return { nameNode, line: stmt.getStartLineNumber() };
      }
      continue;
    }
    if (Node.isVariableStatement(stmt) && stmt.isExported()) {
      for (const decl of stmt.getDeclarationList().getDeclarations()) {
        const nameNode = decl.getNameNode();
        if (Node.isIdentifier(nameNode) && nameNode.getText() === symbolName) {
          return { nameNode, line: decl.getStartLineNumber() };
        }
      }
    }
  }
  return null;
}

/**
 * 单符号精确引用边（ts-morph 语言服务）。sf 由调用方经临时 Project 加载；
 * 找不到该导出符号时返回 null。
 */
export function extractSymbolEdges(root: string, sf: MorphSourceFile, symbolName: string): EdgeRow[] | null {
  const relPath = toPosix(root, sf.getFilePath());
  const decl = findExportDecl(sf, symbolName);
  if (!decl) return null;

  const edges: EdgeRow[] = [];
  const seen = new Set<string>();
  for (const refSymbol of decl.nameNode.findReferences()) {
    for (const ref of refSymbol.getReferences()) {
      const node = ref.getNode();
      const refSf = node.getSourceFile();
      const fromFile = toPosix(root, refSf.getFilePath());
      const fromLine = node.getStartLineNumber();
      if (fromFile === relPath && fromLine === decl.line) continue;
      const key = `${fromFile}:${fromLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        ownerFile: relPath,
        name: symbolName,
        fromFile,
        fromLine,
        toFile: relPath,
        toLine: decl.line,
        isReexport: isReexportReference(node),
      });
      if (edges.length >= MAX_EDGES_PER_SYMBOL) return edges;
    }
  }
  return edges;
}

/** 查询懒算边用的临时 Project：带 tsconfig 选项，不预加载文件。 */
export function createEdgeProject(root: string): Project {
  const tsconfig = ["tsconfig.json", "tsconfig.base.json"].find((f) => fsSync.existsSync(path.join(root, f)));
  return new Project({
    ...(tsconfig ? { tsConfigFilePath: path.join(root, tsconfig) } : {}),
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
}
