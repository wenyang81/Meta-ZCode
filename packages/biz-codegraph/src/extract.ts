/**
 * ts-morph 抽取层。两层设计（性能）：
 * - 符号表：纯 AST 遍历，不碰语言服务——全量 rebuild 对几千文件是分钟级。
 * - 引用边：nameNode.findReferences() 走语言服务，机制与 scripts/dep-refs.mjs 同源，
 *   精确但贵——只对被查询的单个符号懒算，结果持久缓存进 store（replaceEdges）。
 */
import path from "node:path";
import { Node, type Identifier, type SourceFile } from "ts-morph";
import type { EdgeRow, SymbolRow } from "./store.js";

/** 单符号最多收录的引用边数，防超大符号（被全仓引用的类型）拖爆索引与输出。 */
export const MAX_EDGES_PER_SYMBOL = 500;

const KIND_BY_SYNTAX: Record<string, string> = {
  FunctionDeclaration: "function",
  ClassDeclaration: "class",
  InterfaceDeclaration: "interface",
  TypeAliasDeclaration: "type",
  EnumDeclaration: "enum",
  VariableDeclaration: "variable",
};

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

interface NamedDeclaration {
  readonly name: string;
  readonly kind: string;
  readonly nameNode: Identifier;
  readonly line: number;
  readonly isExported: boolean;
}

function namedDeclarations(sf: SourceFile): NamedDeclaration[] {
  const result: NamedDeclaration[] = [];
  for (const stmt of sf.getStatements()) {
    if (
      Node.isFunctionDeclaration(stmt) ||
      Node.isClassDeclaration(stmt) ||
      Node.isInterfaceDeclaration(stmt) ||
      Node.isTypeAliasDeclaration(stmt) ||
      Node.isEnumDeclaration(stmt)
    ) {
      const name = stmt.getName();
      const nameNode = stmt.getNameNode();
      if (name && nameNode) {
        result.push({
          name,
          kind: KIND_BY_SYNTAX[stmt.getKindName()] ?? stmt.getKindName().replace(/Declaration$/, "").toLowerCase(),
          nameNode,
          line: stmt.getStartLineNumber(),
          isExported: stmt.isExported(),
        });
      }
      continue;
    }
    if (Node.isVariableStatement(stmt)) {
      for (const decl of stmt.getDeclarationList().getDeclarations()) {
        const nameNode = decl.getNameNode();
        // 解构声明（ObjectBindingPattern）没有单一符号名，P1 不索引。
        if (!Node.isIdentifier(nameNode)) continue;
        result.push({
          name: nameNode.getText(),
          kind: KIND_BY_SYNTAX.VariableDeclaration ?? "variable",
          nameNode,
          line: decl.getStartLineNumber(),
          isExported: stmt.isExported(),
        });
      }
    }
  }
  return result;
}

export function extractSymbols(root: string, sf: SourceFile): SymbolRow[] {
  const relPath = toPosix(root, sf.getFilePath());
  return namedDeclarations(sf).map((d) => ({
    filePath: relPath,
    name: d.name,
    kind: d.kind,
    line: d.line,
    isExported: d.isExported,
  }));
}

function isReexportReference(node: Node): boolean {
  let current: Node | undefined = node;
  while (current) {
    const kind = current.getKindName();
    if (kind === "ExportSpecifier" || kind === "ExportDeclaration") return true;
    if (kind === "SourceFile") return false;
    current = current.getParent();
  }
  return false;
}

/** 单符号精确引用边（语言服务）。找不到该导出符号时返回 null。 */
export function extractSymbolEdges(
  root: string,
  sf: SourceFile,
  symbolName: string,
): EdgeRow[] | null {
  const relPath = toPosix(root, sf.getFilePath());
  const decl = namedDeclarations(sf).find((d) => d.name === symbolName && d.isExported);
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
        name: decl.name,
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
