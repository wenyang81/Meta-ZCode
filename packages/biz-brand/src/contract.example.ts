/**
 * biz-brand 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 消费方只读 brandIdentity，不在本地复制名称字面量或 SVG 图形。
 */
import { brandIdentity } from "./index.js";

export function exampleBrandBadge(): { title: string; logoSrc: string } {
  return {
    title: brandIdentity.displayName,
    logoSrc: brandIdentity.logoDataUrl,
  };
}
