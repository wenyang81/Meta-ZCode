export const CLI_COMMAND_NAME = "zcode";
// 别名可执行名（SEA 产物复制改名 / npm bin 额外条目）；usage 文案按实际被调用的名字显示。
const CLI_COMMAND_ALIASES: ReadonlySet<string> = new Set(["dlmeta"]);
export const CLI_PROCESS_NAME = "zcode-cli";

/**
 * 用户实际敲的命令名：从进程入口（SEA 下是 exe 路径）的文件名推导。
 * npm bin 模式与开发 tsx 直跑时入口名识别不出来，回落主名 `zcode`——
 * 文案只是多显示一个等价名，不影响功能。
 */
export const invokedCommandName = (argv: readonly string[] = process.argv): string => {
  const entry = argv[1];
  if (!entry) return CLI_COMMAND_NAME;
  const base = entry.split(/[\\/]/).pop()?.replace(/\.(exe|cjs|mjs|js)$/i, "").toLowerCase() ?? "";
  return base === CLI_COMMAND_NAME || CLI_COMMAND_ALIASES.has(base) ? base : CLI_COMMAND_NAME;
};

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
