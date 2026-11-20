/**
 * 数据目录叶子名门禁：禁止生产源码再写死 `.zcode` 路径段。
 *
 * 为什么需要它：叶子名改可配置后（docs/data-dir-name.md），只要有一个权威还留着字面量，
 * 品牌构建就会把一半数据写进 `.zcode`、一半写进 `.dlMeta`，而且不报错。上游同步又会把
 * 旧写法原样带回来，所以这条必须进 push 合同，而不是靠人记住。
 *
 * 用法：
 *   node scripts/check-data-dir-literal.mjs                 # 全仓扫描（改造收口后用）
 *   node scripts/check-data-dir-literal.mjs packages/shared packages/services   # 分批迁移时按目录扫
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const toPosix = (path) => path.replaceAll("\\", "/");
/** 唯一所有者本人必须写字面量作为默认值。 */
const WHITELIST = new Set(["packages/shared/src/dataDirName.ts"]);
const EXCEPTIONS_FILE = "scripts/data-dir-literal-exceptions.json";
const SOURCE_EXT = /\.(ts|tsx|mjs)$/;
// bundled-agents 是打包时整仓复制的产物（.gitignore:12），里面的 .zcode 字面量随上游源码
// 原样存在，收口责任在源码侧；产物目录不扫，否则出过包的机器永远过不了这条门禁。
const EXCLUDED_DIR =
  /(^|\/)(dist|out|node_modules|test|tests|__tests__|e2e|__mocks__|fixtures|bundled-agents)($|\/)/;
const EXCLUDED_FILE = /(\.(test|spec)\.[cm]?[jt]sx?|\.d\.ts)$/;
/**
 * 叶子必须独占一个完整路径段：前面是路径起点（`~`、`/` 或字符串/模板边界），后面是 `/`
 * 或引号/反引号/空白/行尾。
 * 这样 `.zcode-plugin`、`.zcode-share`、`.zcode-install-manifest`、`.zcode-beta` 不会被误伤，
 * 而 `".zcode"`、`".zcode/cli"`、`"~/.zcode/v2"` 都会命中；
 * `engines.zcode`、`com.zcode/official-mcp-auth` 这类前置标识符的反向域名也不命中。
 */
const LEAF_PATTERN = /(^|[~/"'`])\.zcode([/`'"\s]|$)/;

/**
 * 去掉行内注释，只留代码部分。
 * 逐字符跟踪字符串状态：注释里的示例路径（`// 读 ~/.zcode/cli/config.json`）不该算违规，
 * 字符串里的 `//`（URL、正则）又不该被当成注释起点。
 */
function stripComments(line) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += line[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && (line[i + 1] === "/" || line[i + 1] === "*")) break;
    out += ch;
  }
  return out;
}

/** 整行注释（含 JSDoc 的 ` * ` 续行）不参与匹配。 */
function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    !trimmed ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("*/")
  );
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR.test(`/${toPosix(relative(ROOT, path))}`)) continue;
      yield* walk(path);
    } else if (SOURCE_EXT.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) {
      yield path;
    }
  }
}

const scopes = process.argv.slice(2).map((scope) => resolve(ROOT, scope));
const scoped = scopes.length > 0;

/**
 * 例外清单：`{ path, reason }`，按文件整份豁免。
 * 门禁只回答「用户级数据叶子有没有被写死」，工作区契约名、发给模型的英文提示词、
 * 刻意读上游目录的兼容代码和不随品牌包分发的工程脚本都是合法例外——但必须写清理由，
 * 且引用的文件还存在。理由为空或文件已删除/改名一律直接失败，避免例外清单变成无人认领的垃圾场。
 */
async function loadExceptions() {
  const raw = JSON.parse(await readFile(join(ROOT, EXCEPTIONS_FILE), "utf8"));
  const problems = [];
  const byPath = new Map();
  for (const entry of raw.exceptions ?? []) {
    const path = toPosix(entry?.path ?? "");
    if (!path) problems.push("例外条目缺少 path");
    else if (byPath.has(path)) problems.push(`例外条目重复：${path}`);
    else if (!(entry.reason ?? "").trim()) problems.push(`例外条目缺少 reason：${path}`);
    else {
      try {
        await readFile(join(ROOT, path));
      } catch {
        problems.push(`例外条目指向不存在的文件：${path}`);
      }
      byPath.set(path, entry.reason.trim());
    }
  }
  return { byPath, problems };
}

const { byPath: exceptions, problems: exceptionProblems } = await loadExceptions();
const hits = [];
const seenExceptionPaths = new Set();
for (const scope of scoped ? scopes : [ROOT]) {
  for await (const file of walk(scope)) {
    const rel = toPosix(relative(ROOT, file));
    if (WHITELIST.has(rel)) continue;
    const lines = (await readFile(file, "utf8")).split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (isCommentLine(lines[i])) continue;
      const code = stripComments(lines[i].replace(/\r$/, ""));
      if (!code.trim() || !LEAF_PATTERN.test(code)) continue;
      if (exceptions.has(rel)) {
        seenExceptionPaths.add(rel);
        continue;
      }
      hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

// 过期例外只在全仓扫描时判定：分批迁移时按目录扫，清单里其余文件本就不在扫描范围内。
const staleExceptions = scoped
  ? []
  : [...exceptions.keys()].filter((path) => !seenExceptionPaths.has(path));
for (const path of staleExceptions) {
  exceptionProblems.push(`例外条目已无命中，请从 ${EXCEPTIONS_FILE} 删除：${path}`);
}

if (hits.length || exceptionProblems.length) {
  console.log(
    [
      `data-dir-literal: FAILED`,
      `hits: ${hits.length}`,
      `scope: ${scoped ? scopes.map((s) => relative(ROOT, s).replaceAll("\\", "/") || ".").join(", ") : "全仓"}`,
      "",
      ...hits,
      ...(exceptionProblems.length ? ["", "例外清单问题:", ...exceptionProblems] : []),
      hits.length
        ? [
            "",
            "用户级数据叶子必须走 @zcode/shared 的 DATA_DIR_NAME，工作区级用 WORKSPACE_CONFIG_DIR_NAME。",
            `确认属于工作区契约名、英文提示词、上游兼容读取或工程脚本时，写进 ${EXCEPTIONS_FILE} 并给出理由；`,
            "能改成常量的生产路径不要加例外。规范见 docs/data-dir-name.md。",
          ].join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  process.exit(1);
}
console.log(`data-dir-literal: OK（0 处写死叶子名，例外 ${exceptions.size} 个文件）`);
