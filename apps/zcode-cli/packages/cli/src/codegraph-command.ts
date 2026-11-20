import { formatJson } from "@zcode/core";
import { WORKSPACE_CONFIG_DIR_NAME } from "@zcode/shared/dataDirName";
import type {
  StructuralWikiPolicyAdapter,
  StructuralWikiExportResult,
} from "@zcode/biz-codegraph";
import type { GlobalOptions, RunContext } from "@zcode/shared-types";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { invokedCommandName } from "./process-name.js";

type CodegraphModule = typeof import("@zcode/biz-codegraph");

interface CodegraphCommandDependencies {
  cwd?: () => string;
  loadCodegraphModule?: () => Promise<CodegraphModule>;
  /**
   * 结构视图的模块口径与越界告警来自工作区自己的 `scripts/architecture`（那套规则的
   * 唯一所有者）。打包后的 App 在别人仓库里跑时这些脚本不存在，注入失败就走降级口径。
   */
  loadStructuralAdapter?: (root: string) => Promise<StructuralAdapterOutcome>;
}

/** 注入结果：适配器（可缺）+ 一句话说明为什么缺，原样写进输出，不静默降级。 */
interface StructuralAdapterOutcome {
  readonly adapter?: StructuralWikiPolicyAdapter;
  readonly note: string;
}

const CLI = invokedCommandName();

const CODEGRAPH_COMMAND_USAGE = `Usage: ${CLI} codegraph <command> [options]

Commands:
  rebuild [--workspace <path>]        Rebuild the symbol/edge index for the workspace (overwrites it)
  stats   [--workspace <path>]        Report file/symbol/edge counts, last build time and stale ratio
  wiki    [--workspace <path>] [--export <dir>]
                                      Write the structural view (module list, export surfaces,
                                      dependency direction from static imports, boundary warnings)
                                      as markdown. Defaults to
                                      <workspace>/${WORKSPACE_CONFIG_DIR_NAME}/codegraph-wiki; a relative
                                      --export resolves against the workspace, never the index dir.

Both default to the current working directory as the workspace root. The index lives in
<workspace>/${WORKSPACE_CONFIG_DIR_NAME}/codegraph/index.sqlite and is a pure derivative of the source tree.`;

export async function runCodegraphCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: CodegraphCommandDependencies,
  args: string[],
  flags: { workspace?: string; exportDir?: string } = {},
): Promise<number> {
  const [subcommand = "stats", ...rest] = args;
  if (rest.length > 0) {
    ctx.stderr.write(`Unexpected arguments: ${rest.join(" ")}\n${CODEGRAPH_COMMAND_USAGE}\n`);
    return 1;
  }
  let root: string;
  try {
    root = resolveWorkspaceRoot((deps.cwd ?? process.cwd)(), flags.workspace);
  } catch (error) {
    ctx.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const codegraph = deps.loadCodegraphModule ?? (() => import("@zcode/biz-codegraph"));
  switch (subcommand) {
    case "rebuild":
      return await runCodegraphRebuild(ctx, options, codegraph, root);
    case "stats":
      return await runCodegraphStats(ctx, options, codegraph, root);
    case "wiki":
      return await runCodegraphWiki(ctx, options, deps, codegraph, root, flags.exportDir);
    default:
      ctx.stderr.write(`Unknown codegraph command: ${subcommand}\n${CODEGRAPH_COMMAND_USAGE}\n`);
      return 1;
  }
}

function resolveWorkspaceRoot(cwd: string, workspaceFlag?: string): string {
  const root = workspaceFlag ? path.resolve(cwd, workspaceFlag) : cwd;
  if (!existsSync(root)) throw new Error(`Workspace not found: ${root}`);
  return root;
}

async function runCodegraphRebuild(
  ctx: RunContext,
  options: GlobalOptions,
  loadCodegraphModule: () => Promise<CodegraphModule>,
  root: string,
): Promise<number> {
  const { rebuildIndex } = await loadCodegraphModule();
  const startedAt = Date.now();
  const counts = await rebuildIndex(root);
  const elapsedMs = Date.now() - startedAt;
  if (options.json) {
    ctx.stdout.write(formatJson({ workspace: root, elapsedMs, counts }));
    return 0;
  }
  ctx.stdout.write(
    `Rebuilt codegraph index for ${root}\n` +
      `  files:   ${counts.files}\n` +
      `  symbols: ${counts.symbols}\n` +
      `  edges:   ${counts.edges} (computed lazily per symbol on first query)\n` +
      `  elapsed: ${elapsedMs}ms\n`,
  );
  return 0;
}

async function runCodegraphStats(
  ctx: RunContext,
  options: GlobalOptions,
  loadCodegraphModule: () => Promise<CodegraphModule>,
  root: string,
): Promise<number> {
  const { codegraphStats, codegraphIndexPath } = await loadCodegraphModule();
  const indexFile = codegraphIndexPath(root);
  if (!existsSync(indexFile)) {
    ctx.stderr.write(
      options.json
        ? formatJson({ workspace: root, indexFile, error: "index-missing" })
        : `No codegraph index at ${indexFile}\nRun \`${CLI} codegraph rebuild\` first.\n`,
    );
    return 1;
  }
  const stats = await codegraphStats(root);
  if (options.json) {
    ctx.stdout.write(
      formatJson({
        workspace: root,
        indexFile,
        files: stats.files,
        symbols: stats.symbols,
        edges: stats.edges,
        builtAt: stats.builtAt,
        staleRatio: stats.staleRatio,
      }),
    );
    return 0;
  }
  ctx.stdout.write(
    `Codegraph index: ${indexFile}\n` +
      `  files:      ${stats.files}\n` +
      `  symbols:    ${stats.symbols}\n` +
      `  edges:      ${stats.edges}\n` +
      `  built at:   ${stats.builtAt || "unknown"}\n` +
      `  stale:      ${(stats.staleRatio * 100).toFixed(1)}% of indexed files changed on disk\n` +
      `  (stale entries are refreshed on the next query; run rebuild for a full refresh)\n`,
  );
  return 0;
}

async function runCodegraphWiki(
  ctx: RunContext,
  options: GlobalOptions,
  deps: CodegraphCommandDependencies,
  loadCodegraphModule: () => Promise<CodegraphModule>,
  root: string,
  exportDir: string | undefined,
): Promise<number> {
  const { codegraphIndexReady, codegraphIndexPath, exportStructuralWiki } = await loadCodegraphModule();
  const indexFile = codegraphIndexPath(root);
  if (!codegraphIndexReady(root).ready) {
    ctx.stderr.write(
      options.json
        ? formatJson({ workspace: root, indexFile, error: "index-missing" })
        : `No codegraph index at ${indexFile}\nRun \`${CLI} codegraph rebuild\` first.\n`,
    );
    return 1;
  }
  const outcome = await (deps.loadStructuralAdapter ?? loadStructuralAdapterFromWorkspace)(root);
  const target = exportDir ?? path.join(root, WORKSPACE_CONFIG_DIR_NAME, "codegraph-wiki");
  let result: StructuralWikiExportResult;
  try {
    result = await exportStructuralWiki(
      root,
      target,
      {},
      { generatedAt: new Date().toISOString() },
      outcome.adapter,
    );
  } catch (error) {
    ctx.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (options.json) {
    ctx.stdout.write(
      formatJson({
        workspace: root,
        outDir: result.outDir,
        pages: result.pages.length,
        modules: result.modules,
        moduleScope: result.moduleScope,
        files: result.files,
        symbols: result.symbols,
        edges: result.edges,
        violations: result.violations,
        stale: result.stale,
        ...(result.staleReason === undefined ? {} : { staleReason: result.staleReason }),
        adapterNote: outcome.note,
      }),
    );
    return 0;
  }
  ctx.stdout.write(
    `Structural wiki: ${result.outDir}\n` +
      `  pages:      ${result.pages.length}\n` +
      `  modules:    ${result.modules} (scope: ${result.moduleScope === "policy" ? "architecture-policy.yaml" : "package-level path"})\n` +
      `  files:      ${result.files}\n` +
      `  symbols:    ${result.symbols}\n` +
      `  edges:      ${result.edges} (symbol-level; dependency columns count static imports)\n` +
      `  warnings:   ${result.violations} unacknowledged boundary violation(s)\n` +
      `  note:       ${outcome.note}\n` +
      (result.stale
        ? `  stale:      true — ${result.staleReason ?? "some files could not be reindexed"}\n`
        : `  stale:      false\n`) +
      `  (pages are a derivative: re-run this command to refresh, do not hand-edit them)\n`,
  );
  return 0;
}

/**
 * scripts/architecture 是无类型 ESM 脚本，这里只声明本文件用到的那几个入口的形状，
 * 不在 CLI 侧复制任何判定逻辑：模块归属、说明符解析、越界告警全部转调工作区自己的脚本。
 */
type PolicyHandle = { readonly brand: "architecture-policy" };
type WorkspaceHandle = { readonly brand: "architecture-workspace" };

interface ArchitectureViolationLike {
  readonly rule: string;
  readonly file: string;
  readonly module: string | null;
  readonly message: string;
}

interface ArchitecturePolicyModule {
  loadPolicy(cwd: string): Promise<PolicyHandle>;
  discoverFiles(policy: PolicyHandle): Promise<string[]>;
  moduleForFile(file: string, policy: PolicyHandle): { readonly id: string } | null;
  resolveImport(
    from: string,
    specifier: string,
    knownFiles: Set<string>,
    workspace: WorkspaceHandle,
  ): string | null;
}

interface ArchitectureResolverModule {
  loadWorkspace(cwd: string): Promise<WorkspaceHandle>;
}

interface ArchitectureCheckModule {
  checkArchitecture(args: { cwd: string }): Promise<{
    readonly newViolations: readonly ArchitectureViolationLike[];
    readonly baselineViolations: readonly unknown[];
  }>;
}

async function loadStructuralAdapterFromWorkspace(root: string): Promise<StructuralAdapterOutcome> {
  const archDir = path.join(root, "scripts", "architecture");
  const files = {
    policy: path.join(archDir, "policy.mjs"),
    resolver: path.join(archDir, "resolver.mjs"),
    check: path.join(archDir, "index.mjs"),
  };
  if (!Object.values(files).every((file) => existsSync(file))) {
    return {
      note: "no scripts/architecture here: modules fall back to package-level scope, dependency direction and boundary warnings are skipped",
    };
  }
  try {
    const policyMod = (await import(pathToFileURL(files.policy).href)) as ArchitecturePolicyModule;
    const resolverMod = (await import(pathToFileURL(files.resolver).href)) as ArchitectureResolverModule;
    const checkMod = (await import(pathToFileURL(files.check).href)) as ArchitectureCheckModule;
    const policy = await policyMod.loadPolicy(root);
    const [knownFiles, workspace] = await Promise.all([
      policyMod.discoverFiles(policy),
      resolverMod.loadWorkspace(root),
    ]);
    const known = new Set(knownFiles);
    const toAbs = (rel: string): string => path.resolve(root, rel);
    const toRel = (abs: string | null): string | null =>
      abs === null ? null : path.relative(root, abs).split(path.sep).join("/");
    const { newViolations, baselineViolations } = await checkMod.checkArchitecture({ cwd: root });
    return {
      adapter: {
        moduleOf: (rel) => policyMod.moduleForFile(toAbs(rel), policy)?.id ?? null,
        resolveImport: (rel, specifier) =>
          toRel(policyMod.resolveImport(toAbs(rel), specifier, known, workspace)),
        violations: newViolations.map((item) => ({
          rule: item.rule,
          file: item.file,
          module: item.module,
          message: item.message,
        })),
        acknowledgedViolations: baselineViolations.length,
      },
      note: "modules and warnings from scripts/architecture + architecture-policy.yaml",
    };
  } catch (error) {
    return {
      note: `scripts/architecture failed to load: ${
        error instanceof Error ? error.message : String(error)
      }; modules fall back to package-level scope`,
    };
  }
}
