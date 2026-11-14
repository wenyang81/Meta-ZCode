import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR_NAME } from "@zcode/shared";

export function getDefaultSessionDbPath(): string {
  return join(homedir(), DATA_DIR_NAME, "cli", "db", "db.sqlite");
}
