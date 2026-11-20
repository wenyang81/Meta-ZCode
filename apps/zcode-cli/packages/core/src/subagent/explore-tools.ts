// 对齐文件搜索型子 agent 的工具面。direct branch 会暴露 Glob/Grep；
// embedded search branch 则通过 Bash find/grep 接管搜索。注意：白名单刻意不含任何
// 文件写工具（Write/Edit/ApplyPatch），因此 Bash 是唯一的副作用入口。Explore 继承父会话的权限模式与
// Plan 状态，Bash 是否只读由 shell AST 判定（非只读命令按父会话模式询问或拒绝），prompt 也禁止修改。
// CodegraphQuery（docs/codegraph-index.md）两个分支都在：它查的是符号索引，不是文本搜索，
// embedded search 关掉 Glob/Grep 时它反而是符号级问题仅剩的结构化入口。
export const EXPLORE_AGENT_ALLOWED_TOOLS = [
  "ToolSearch",
  "DeferredToolCall",
  "Bash",
  "Glob",
  "Grep",
  "CodegraphQuery",
  "Read",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
] as const;

export type ExploreAgentAllowedTool = (typeof EXPLORE_AGENT_ALLOWED_TOOLS)[number];

export const EXPLORE_AGENT_EMBEDDED_SEARCH_ALLOWED_TOOLS = [
  "ToolSearch",
  "DeferredToolCall",
  "Bash",
  "CodegraphQuery",
  "Read",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
] as const;

// 排序即 Explore 提示里的选用优先级：符号级问题（谁引用、导出面）先查索引，
// 查不到再落回文本搜索，最后才 Read（spec §4.3 的路由规则）。
const EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY = [
  "CodegraphQuery",
  "Glob",
  "Grep",
  "Read",
  "Bash",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
] as const satisfies readonly ExploreAgentAllowedTool[];
const EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY_SET = new Set<ExploreAgentAllowedTool>(
  EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY,
);

export function buildExploreAllowedTools(
  options: {
    embeddedSearchEnabled?: boolean;
  } = {},
): readonly ExploreAgentAllowedTool[] {
  return options.embeddedSearchEnabled
    ? EXPLORE_AGENT_EMBEDDED_SEARCH_ALLOWED_TOOLS
    : EXPLORE_AGENT_ALLOWED_TOOLS;
}

export function formatExploreAllowedToolsForAgentDescription(
  options: {
    embeddedSearchEnabled?: boolean;
  } = {},
): string {
  const allowedTools = buildExploreAllowedTools(options);
  const allowedToolSet = new Set(allowedTools);
  const prioritizedTools = EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY.filter((tool) =>
    allowedToolSet.has(tool),
  );
  const unprioritizedTools = allowedTools.filter(
    (tool) =>
      tool !== "ToolSearch" &&
      tool !== "DeferredToolCall" &&
      !EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY_SET.has(tool),
  );
  return [...prioritizedTools, ...unprioritizedTools].join(", ");
}
