import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeCodegraphIndex, codegraphIndexPath, querySymbols, rebuildIndex } from "../src/index.js";

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zcode-codegraph-"));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsPromises.mkdir(path.dirname(abs), { recursive: true });
    await fsPromises.writeFile(abs, text, "utf8");
  }
  return root;
}

/** Windows 上没关句柄的临时目录删不掉；关库后再删，删失败也只记录（不掩盖前面的断言）。 */
async function disposeWorkspace(root: string): Promise<void> {
  closeCodegraphIndex(root);
  await fsPromises.rm(root, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

/** 让 mtime 明确晚于索引里记的那一份：同毫秒写入会被 NTFS 的粒度抹平，ensure 就看不到变更。 */
async function touchLater(abs: string): Promise<void> {
  const future = new Date(Date.now() + 60_000);
  await fsPromises.utimes(abs, future, future);
}

describe("codegraph 新鲜度（spec §5.1 / §7 P1-2~3）", () => {
  it("查询时增量：新增的导出无需 rebuild 即可查到", async () => {
    const root = await createWorkspace({
      "a.ts": "export function alpha() { return 1; }\n",
      "b.ts": "import { alpha } from \"./a.js\";\nexport const useAlpha = () => alpha();\n",
    });
    try {
      await rebuildIndex(root);
      expect(existsSync(codegraphIndexPath(root))).toBe(true);

      const before = await querySymbols(root, { symbol: "gamma" });
      expect(before.symbols).toHaveLength(0);

      await fsPromises.writeFile(
        path.join(root, "a.ts"),
        "export function alpha() { return 1; }\nexport function gamma() { return 2; }\n",
        "utf8",
      );
      await touchLater(path.join(root, "a.ts"));

      const after = await querySymbols(root, { symbol: "gamma" });
      expect(after.symbols.map((symbol) => symbol.location.filePath)).toEqual(["a.ts"]);
      expect(after.stale).toBe(false);
    } finally {
      await disposeWorkspace(root);
    }
  });

  it("引用边可查且第二次查询命中缓存", async () => {
    const root = await createWorkspace({
      "a.ts": "export function alpha() { return 1; }\n",
      "b.ts": "import { alpha } from \"./a.js\";\nexport const useAlpha = () => alpha();\n",
    });
    try {
      await rebuildIndex(root);
      const first = await querySymbols(root, { symbol: "alpha", direction: "inbound" });
      expect(first.edges.map((edge) => `${edge.from.filePath}:${edge.name}`)).toContain(
        "b.ts:alpha",
      );
      const second = await querySymbols(root, { symbol: "alpha", direction: "inbound" });
      expect(second.edges).toHaveLength(first.edges.length);
    } finally {
      await disposeWorkspace(root);
    }
  });

  it("删除文件后索引条目同步消失", async () => {
    const root = await createWorkspace({
      "a.ts": "export function alpha() { return 1; }\n",
      "gone.ts": "export function goneSymbol() { return 1; }\n",
    });
    try {
      await rebuildIndex(root);
      expect((await querySymbols(root, { symbol: "goneSymbol" })).symbols).toHaveLength(1);

      await fsPromises.rm(path.join(root, "gone.ts"));
      const after = await querySymbols(root, { symbol: "goneSymbol" });
      expect(after.symbols).toHaveLength(0);
    } finally {
      await disposeWorkspace(root);
    }
  });

  it("变更文件重抽失败时结果带 stale，不静默给旧图", async () => {
    const root = await createWorkspace({
      "a.ts": "export function alpha() { return 1; }\n",
    });
    try {
      await rebuildIndex(root);
      expect((await querySymbols(root, { symbol: "alpha" })).symbols).toHaveLength(1);

      // 用同名目录顶掉源文件：stat 仍成功（mtime 变了 → 触发重抽），读取必然失败，
      // 这就是「检测到变化但重抽失败」这条 §5.1 分支。
      await fsPromises.rm(path.join(root, "a.ts"));
      await fsPromises.mkdir(path.join(root, "a.ts"));

      const result = await querySymbols(root, { symbol: "alpha" });
      expect(result.stale).toBe(true);
      expect(result.staleReason).toContain("a.ts");
    } finally {
      await fsPromises.rm(path.join(root, "a.ts"), { recursive: true, force: true }).catch(() => {});
      await disposeWorkspace(root);
    }
  });
});
