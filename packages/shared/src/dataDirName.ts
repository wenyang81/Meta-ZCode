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

/** 运行时覆盖变量。只允许 fork 的启动包装与构建 define 注入点写入，业务代码不得自行读取。
 *  变量名用 fork 自己的 DLMETA_ 命名空间，不与上游/其他 ZCode 系产品的环境变量互相踩。 */
export const DLMETA_DATA_DIR_NAME_ENV = "DLMETA_DATA_DIR_NAME" as const;

/** fork 命名空间的数据根覆盖变量（上游同义变量是 ZCODE_DATA_BASE_DIR，互不读取）。
 *  「隔离开发态」判定与 dev/e2e 注入都用它。 */
export const DLMETA_DATA_BASE_DIR_ENV = "DLMETA_DATA_BASE_DIR" as const;

/** fork 命名空间的 Electron userData 目录覆盖变量（登录态/localStorage 落点）。 */
export const DLMETA_DESKTOP_USER_DATA_DIR_ENV = "DLMETA_DESKTOP_USER_DATA_DIR" as const;

/** fork 默认叶子名。未注入任何覆盖时（dev 无 define、打包没配变量）也落 `.dlMeta`，
 *  与同机上游正式版的 `.zcode` 天然隔离——这是 2026-11-16 打包验证事故（品牌包读到
 *  上游会话）的根治：隔离不再依赖「打包时记得设变量」。上游仍为 `.zcode`。 */
export const DEFAULT_DATA_DIR_NAME = ".dlMeta";

/**
 * 工作区（项目目录）内的点目录名，与用户数据根叶子**同品牌但不同义**：
 * `<workspace>/.dlMeta/{config.json,skills,commands,plans}` 随项目目录走。
 * 2026-11-17 起跟随品牌改成 `.dlMeta`（用户确认）：上游正式版继续读写 `<workspace>/.zcode`，
 * 两个工具打开同一项目时项目级配置不再互通（各自一份）。
 * 代码里 `userDirectorySegments` / `workspaceDirectorySegments` 这类成对命名就是这条分界；
 * 改动任何一处的判定前先看调用方传的是 home 还是 workspacePath。
 */
export const WORKSPACE_CONFIG_DIR_NAME = ".dlMeta";

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
      `非法的 ${DLMETA_DATA_DIR_NAME_ENV}=${JSON.stringify(value)}：只允许单个路径段` +
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
  const fromEnv = normalizeDataDirName(env[DLMETA_DATA_DIR_NAME_ENV]);
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
