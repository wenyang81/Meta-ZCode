/**
 * 品牌事实的公开契约：只描述「这个产品叫什么、长什么样」，不含行为与 IO。
 * 任何层都可以读取，但不允许在别处再复制一份名称或图形。
 * 见 docs/brand-identity.md。
 */
export interface BrandIdentity {
  /** 打包与文件系统用的 ASCII 名：决定安装目录、%APPDATA%\<productName>、产物文件名。 */
  readonly productName: string;
  /** 界面、托盘、菜单、关于页展示名。 */
  readonly displayName: string;
  /** 展示名的次要文字（wordmark 第二行）。 */
  readonly displayNameEn: string;
  /**
   * i18n 文案里 {brand} 占位符的值（`IntlProvider` 注入），中英文界面统一显示。
   * 可以与 displayName / productName 不同：例如企业名是中文、界面文案用 ASCII 产品名。
   * 窗口标题、托盘、关于页、安装包不读它，仍走 displayName / productName。
   */
  readonly i18nBrandName: string;
  /** electron-builder appId，同时作为打包态 Windows AppUserModelId。 */
  readonly appId: string;
  /** Linux 可执行与包名。 */
  readonly linuxExecutableName: string;
  /** 品牌标记母版（viewBox 0 0 120 120，透明背景）。 */
  readonly logoSvg: string;
  /** 由 logoSvg 编码出的 data URL，供 `<img src>` 直接使用。 */
  readonly logoDataUrl: string;
}
