import { DATA_DIR_NAME, WORKSPACE_CONFIG_DIR_NAME, type ZCodeProvider } from "@zcode/shared";

type SkillSourceType = "glm" | "unknown";

// 技能目录有两个来源：用户级数据叶子（品牌包可改名）与工作区契约名（固定 `.zcode`）。
// 两条都放行，否则品牌包里 `~/.dlMeta/skills` 下的技能会被判成 unknown，`/` 面板漏项。
// 路径已小写归一，目录名同样按小写比较，避免大写叶子名匹配不上。
const SKILL_SOURCE_DIR_SEGMENTS = [DATA_DIR_NAME, WORKSPACE_CONFIG_DIR_NAME].map(
  (name) => `/${name.toLowerCase()}/`,
);

export function resolveSkillSourceType(skillPath: string): SkillSourceType {
  const normalized = skillPath.replaceAll("\\", "/").toLowerCase();
  if (SKILL_SOURCE_DIR_SEGMENTS.some((segment) => normalized.includes(`${segment}skills/`))) {
    return "glm";
  }
  if (normalized.includes(`/${DATA_DIR_NAME.toLowerCase()}/cli/plugins/cache/`)) {
    return "glm";
  }
  return "unknown";
}

const SKILL_ID_PROVIDER_RE = /^glm:/;

function isZcodeSkill(skill: { id?: string; path: string; scope?: string }): boolean {
  return (
    // plugin skill 的真实路径在 CLI plugin cache 下，不在 `.zcode/skills`。
    // 服务层已用 scope 标记来源，前端过滤时要放行，否则 `/` 和 `$` 面板会漏掉插件技能。
    skill.scope === "plugin" ||
    (typeof skill.id === "string" && SKILL_ID_PROVIDER_RE.test(skill.id)) ||
    resolveSkillSourceType(skill.path) === "glm"
  );
}

export function filterSkillsForProvider<T extends { path: string; id?: string; scope?: string }>(
  skills: T[],
  _legacyProvider: ZCodeProvider,
): T[] {
  return skills.filter(isZcodeSkill);
}
