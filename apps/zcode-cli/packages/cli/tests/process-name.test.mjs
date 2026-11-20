import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { invokedCommandName } from "../src/process-name.ts";

const execFileAsync = promisify(execFile);
const cli = resolve(import.meta.dirname, "../dist/zcode.cjs");

test("invokedCommandName 按入口文件名识别主名与别名，识别不了回落主名", () => {
  // SEA 产物：argv[1] 是 exe 路径。
  assert.equal(invokedCommandName(["node", "F:/x/zcode.exe", "codegraph"]), "zcode");
  assert.equal(invokedCommandName(["node", "F:/x/dlmeta.exe", "codegraph"]), "dlmeta");
  assert.equal(invokedCommandName(["node", "F:/x/DLMETA.EXE", "codegraph"]), "dlmeta");
  // npm bin：shim 指向同一 bundle，名字仍是 zcode。
  assert.equal(invokedCommandName(["node", "/x/dist/zcode.cjs", "doctor"]), "zcode");
  // 开发直跑 tsx / 无入口：回落主名。
  assert.equal(invokedCommandName(["node", "/x/src/main.ts", "wiki"]), "zcode");
  assert.equal(invokedCommandName(["node"]), "zcode");
});

test("sets the visible process name before running commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cli, "doctor", "--json"]);
  const payload = JSON.parse(stdout);

  assert.equal(payload.cli.name, "zcode");
  assert.equal(payload.cli.processName, "zcode-cli");
  assert.equal(payload.runtime.processTitle, "zcode-cli");
});
