import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRelative = "docs/fork-changes.md";

async function git(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function gitOk(args) {
  try {
    return (await git(args)).trim() || null;
  } catch {
    return null;
  }
}

// fork 基线 = 上游最后一次同步点。优先真实的上游远端 ref，取不到时退回
// 上游同步提交（AGENTS.md 的上游同步流程约定了这个提交标题），两者都缺就要求先 fetch。
async function resolveForkBase() {
  for (const ref of ["upstream/main", "upstream/HEAD", "upstream/master"]) {
    const sha = await gitOk(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (!sha) continue;
    const mergeBase = await gitOk(["merge-base", "HEAD", ref]);
    if (mergeBase) return { sha: mergeBase, label: `merge-base HEAD ${ref}` };
  }
  const syncCommit = await gitOk(["log", "-1", "--format=%H", "--grep=^chore: sync ZCode source"]);
  if (syncCommit) {
    const subject = await gitOk(["log", "-1", "--format=%s", syncCommit]);
    return { sha: syncCommit, label: `上游同步提交 ${subject}` };
  }
  throw new Error(
    "找不到 fork 基线：先执行 `git fetch upstream`（远端应为 https://github.com/zai-org/zcode.git），" +
      "或确认历史里存在标题形如 `chore: sync ZCode source vX.Y.Z` 的上游同步提交。",
  );
}

function parseNameStatus(raw) {
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    const code = status[0];
    if (code === "R" || code === "C") {
      rows.push({ status: code, from: paths[0], to: paths[1] });
    } else {
      rows.push({ status: code, to: paths[0] });
    }
  }
  return rows;
}

function groupKey(file) {
  const parts = file.split("/");
  if (parts.length === 1) return "(仓库根)";
  if (parts[parts.length - 1].includes(".")) parts.pop();
  if (parts[0] === "packages" || parts[0] === "apps") {
    return `${parts.slice(0, Math.min(parts.length, 2)).join("/")}/`;
  }
  return `${parts.join("/")}/`;
}

function renderMarkdown({ base, label, rows, untracked, counts }) {
  const lines = [];
  lines.push("# 本 fork 相对上游的改动清单");
  lines.push("");
  lines.push(
    "本文件由 `node scripts/fork-changes.mjs` 生成，请勿手工编辑；发布或对外分发源码前重跑一次。",
  );
  lines.push("");
  lines.push(
    "用途：Apache-2.0 第 4(b) 条要求分发修改版时对被修改的文件给出显著说明。" +
      "本 fork 不在上游源文件里逐个加“已修改”头注释（那会把同步冲突面扩大到每个 seam），" +
      "改为集中提供本清单，配合 git 历史与 [上游同步规范](upstream-sync.md)、" +
      "[品牌身份 seam](brand-identity.md) 一起构成修改声明。",
  );
  lines.push("");
  lines.push(`- 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
  lines.push(`- 比较基线：\`${base.slice(0, 10)}\`（${label}）`);
  lines.push(
    `- 工作区状态：已跟踪改动 ${counts.tracked} 个文件，未跟踪新增 ${untracked.length} 个文件`,
  );
  lines.push("");
  lines.push("状态含义：`M` 修改、`A` 新增、`D` 删除、`R` 重命名、`?` 未跟踪（尚未提交）。");
  lines.push("");

  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row.to);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const path of untracked) {
    const key = groupKey(path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ status: "?", to: path });
  }

  for (const key of [...groups.keys()].sort()) {
    const items = groups
      .get(key)
      .slice()
      .sort((a, b) => a.to.localeCompare(b.to));
    lines.push(`## ${key}（${items.length}）`);
    lines.push("");
    for (const item of items) {
      const path = item.from ? `${item.from} → ${item.to}` : item.to;
      lines.push(`- \`${item.status}\` ${path}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const base = await resolveForkBase();
const statusByPath = new Map();
for (const row of parseNameStatus(await git(["diff", "--name-status", base.sha]))) {
  statusByPath.set(row.to, row);
}
for (const row of parseNameStatus(await git(["diff", "--cached", "--name-status"]))) {
  statusByPath.set(row.to, row);
}
const rows = [...statusByPath.values()];
const untracked = (await git(["ls-files", "--others", "--exclude-standard"]))
  .split("\n")
  .map((line) => line.trim())
  .filter((path) => path && path !== outputRelative && !path.startsWith("node_modules/"));
const keptRows = rows.filter((row) => row.to !== outputRelative);

const markdown = renderMarkdown({
  base: base.sha,
  label: base.label,
  rows: keptRows,
  untracked,
  counts: { tracked: keptRows.length },
});
const outputPath = resolve(repoRoot, outputRelative);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, markdown, "utf8");
console.log(
  `fork-changes: ${outputRelative} 已生成（基线 ${base.sha.slice(0, 10)}，已跟踪 ${keptRows.length}，未跟踪 ${untracked.length}）`,
);
