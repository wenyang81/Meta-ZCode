import { brandIdentity } from "@zcode/biz-brand";
import type { ZCodeAppLogoProps } from "@/components/mobile-ui/contract.js";
import { cn } from "@/components/lib/utils.js";

/**
 * 桌面端标题栏左上角同款应用 logo（自带品牌标记，深浅主题通用）。
 * 母版由 biz-brand 持有，见 docs/brand-identity.md。
 * 装饰性图片：调用方负责在旁边给出可读的品牌文字，避免屏幕阅读器重复朗读。
 */
export function ZCodeAppLogo({ className }: ZCodeAppLogoProps) {
  return (
    <img
      src={brandIdentity.logoDataUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      // 稳定的测试/E2E 钩子：打包器可能把 SVG 内联为 data URL，不能靠文件名断言。
      data-app-logo="zcode"
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}
