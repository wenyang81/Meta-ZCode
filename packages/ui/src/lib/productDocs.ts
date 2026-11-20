// 产品文档入口统一收口，避免不同菜单跳到不一致的文档站。
// 地址的唯一所有者是 biz-brand（docs/brand-identity.md）；这里只读通，让上游的调用点保持原样。
import { brandIdentity } from "@zcode/biz-brand";

export const ZCODE_PRODUCT_DOCS_URL = brandIdentity.productDocsUrl;
