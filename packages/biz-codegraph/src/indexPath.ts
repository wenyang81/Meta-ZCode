import path from "node:path";
import { WORKSPACE_CONFIG_DIR_NAME } from "@zcode/shared/dataDirName";

/**
 * 索引文件落点：`<workspace>/.dlMeta/codegraph/index.sqlite`。
 * 叶子名走 @zcode/shared/dataDirName 唯一权威（spec docs/codegraph-index.md §3）；
 * 本地 workspace 按目录自然隔离，索引内仍记录 workspaceIdentity 关联（codegraph.ts）。
 */
export function codegraphIndexPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_CONFIG_DIR_NAME, "codegraph", "index.sqlite");
}
