import { brandIdentity } from "@zcode/biz-brand";
import { cn } from "@/components/lib/utils.js";

/** 关于页 / 欢迎页品牌标记。母版在 biz-brand，见 docs/brand-identity.md。 */
export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={brandIdentity.logoDataUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0", className)}
    />
  );
}

/** 分享卡片等窄位使用的品牌标记；与关于页同一渲染路径，尺寸由调用方的宽度样式决定。 */
export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return <ZCodeAboutLogo className={className} />;
}
