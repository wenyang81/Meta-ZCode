import type { BrandIdentity } from "./contract.js";

/**
 * 品牌标记母版，与 meta-fusionfinlab/portal 的 public/logo.svg 同形：
 * 六边形分子轮廓（蓝→绿渐变）+ 中心菱形（左深蓝 / 右青绿）+ 顶点节点。
 *
 * 母版只在这里存一份。之所以用字符串而不是 .svg 资产：domain 层不做 IO，
 * 且 data URL 交给 `<img>` 后是独立文档，`hexGrad` 这类 gradient id 不会和
 * 同页面其它内联 SVG 抢名字。
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <linearGradient id="diaLeft" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <linearGradient id="diaRight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#059669"/>
      <stop offset="100%" stop-color="#16a34a"/>
    </linearGradient>
  </defs>
  <polygon points="60,10 103,35 103,85 60,110 17,85 17,35" fill="none" stroke="url(#hexGrad)" stroke-width="4" stroke-linejoin="round"/>
  <g stroke="#bfdbfe" stroke-width="1.6">
    <line x1="60" y1="10" x2="60" y2="110"/>
    <line x1="17" y1="35" x2="103" y2="85"/>
    <line x1="103" y1="35" x2="17" y2="85"/>
  </g>
  <g>
    <circle cx="60" cy="10" r="4.5" fill="#2563eb"/>
    <circle cx="103" cy="35" r="4.5" fill="#059669"/>
    <circle cx="103" cy="85" r="4.5" fill="#2563eb"/>
    <circle cx="60" cy="110" r="4.5" fill="#059669"/>
    <circle cx="17" cy="85" r="4.5" fill="#2563eb"/>
    <circle cx="17" cy="35" r="4.5" fill="#059669"/>
  </g>
  <polygon points="60,42 60,78 40,60" fill="url(#diaLeft)"/>
  <polygon points="60,42 60,78 80,60" fill="url(#diaRight)"/>
  <circle cx="60" cy="34" r="7" fill="#3b82f6" opacity="0.25"/>
  <circle cx="60" cy="34" r="4" fill="#1e3a8a"/>
</svg>`;

export const brandIdentity: BrandIdentity = {
  productName: "FusionFinLab",
  displayName: "融智坊",
  displayNameEn: "FUSIONFINLAB",
  appId: "com.meta.fusionfinlab.desktop",
  linuxExecutableName: "fusionfinlab",
  logoSvg: LOGO_SVG,
  logoDataUrl: `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`,
};
