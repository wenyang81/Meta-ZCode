/**
 * 数据目录叶子名的唯一权威；规则、注入点与不改清单见 docs/data-dir-name.md。
 *
 * 本文件同时管两个同名但不同义的点目录：可品牌化的用户数据根叶子，和固定不变的
 * 工作区项目配置目录（见 `WORKSPACE_CONFIG_DIR_NAME`）。生产源码拼路径时不允许再写
 * `".zcode"` 字面量，两个名字都必须走这里，否则改名会只成功一半。
 *
 * 放在 `@zcode/shared` 而不是 `biz-brand`：services、desktop main/host、agent CLI 与打包脚本
 * 这七个路径权威都要读同一个值，`@zcode/shared` 是它们唯一的公共依赖层；`biz-brand` 属于
 * domain 层品牌事实，不持有文件系统语义。
 *
 * 本文件不得 import `node:*`：它经 `packages/shared/src/index.ts` 暴露给浏览器端 bundle。
 */

/** 运行时覆盖变量。只允许 fork 的启动包装与构建 define 注入点写入，业务代码不得自行读取。 */
export const ZCODE_DATA_DIR_NAME_ENV = "ZCODE_DATA_DIR_NAME" as const;

/** 上游默认叶子名。未注入时与上游行为一致，非品牌构建不受影响。 */
export const DEFAULT_DATA_DIR_NAME = ".zcode";

/**
 * 工作区（项目目录）内的点目录名，与用户数据根叶子**不是一回事**：
 * `<workspace>/.zcode/{config.json,skills,commands}` 随 git 仓库走，是跨工具共享的项目级契约，
 * 上游正式版与本 fork 打开同一个项目时必须读到同一份配置，所以它不跟随品牌变量。
 * 代码里 `userDirectorySegments` / `workspaceDirectorySegments` 这类成对命名就是这条分界；
 * 改动任何一处的判定前先看调用方传的是 home 还是 workspacePath。
 */
export const WORKSPACE_CONFIG_DIR_NAME = ".zcode";

/**
 * 单个安全路径段：允许前导点的 ASCII 名，禁止路径分隔符、`.`、`..`、空白与非 ASCII。
 * 目录名带空格或非 ASCII 会让引用它的 shell 包装与 NSIS 字符串拼接出错，
 * 宁可启动即失败，也不在下游加转义兜底。
 */
const DATA_DIR_NAME_PATTERN = /^[.A-Za-z0-9_-]+$/;

/** 归一化覆盖值；未设置或全空白返回 null 交给调用方回落默认值，非法值直接抛错。 */
export function normalizeDataDirName(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed === "." || trimmed === ".." || !DATA_DIR_NAME_PATTERN.test(trimmed)) {
    throw new Error(
      `非法的 ${ZCODE_DATA_DIR_NAME_ENV}=${JSON.stringify(value)}：只允许单个路径段` +
        "（字母、数字、. _ -，且不能是 . 或 ..）",
    );
  }
  return trimmed;
}

/**
 * 构建期注入点：桌面打包脚本用 define 把品牌叶子编进安装包，用户机器不需要再配环境变量。
 * 非构建环境（dev tsx、web、agent CLI、测试）没有这个全局，用 typeof 检查兜底，同 `env.ts` 的做法。
 */
declare const __ZCODE_DATA_DIR_NAME__: string;

/**
 * 解析当前进程应使用的数据目录叶子名：运行时 env 覆盖构建期 define，两者都没有时用上游默认值。
 *
 * env 只在调用时读取，不做进程内缓存：测试与显式注入用它。生产代码一律读
 * `DATA_DIR_NAME`，不要在自己的模块里再调一次本函数。
 */
export function resolveDataDirName(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): string {
  const fromEnv = normalizeDataDirName(env[ZCODE_DATA_DIR_NAME_ENV]);
  if (fromEnv) return fromEnv;
  const fromBuild =
    typeof __ZCODE_DATA_DIR_NAME__ !== "undefined"
      ? normalizeDataDirName(__ZCODE_DATA_DIR_NAME__)
      : null;
  return fromBuild ?? DEFAULT_DATA_DIR_NAME;
}

/**
 * 进程级捕获的叶子名，七个路径权威共用的实际值。
 *
 * 在模块加载期解析一次并由所有调用方复用，是「一个进程内只有一个叶子」这条规则的实现手段：
 * `paths.ts` 的 base 目录同样是启动期一次性捕获，如果每个调用点各自在运行期解析，
 * 中途改 env 就会让两套路径分叉，一半数据落 `.zcode`、一半落品牌叶子。
 * 非法值在这里直接抛错，让进程在产生任何磁盘写入前退出。
 */
export const DATA_DIR_NAME = resolveDataDirName();
