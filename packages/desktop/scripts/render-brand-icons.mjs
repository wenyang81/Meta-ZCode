#!/usr/bin/env node

/**
 * 由 `@zcode/biz-brand` 的品牌母版派生 `packages/desktop/build/` 图标集与仓库根 `public/`
 * 的同名图标集（README 头图、UpdateStatusDialog 的 macOS dock 图标）。
 *
 * 仓库没有栅格化依赖（sharp / @resvg），这里改用本机 Edge/Chrome headless 截图：
 * 输入只有母版 SVG 与目标尺寸，产物可重跑覆盖，见 docs/brand-identity.md「派生图标」。
 *
 * macOS 产物（icon.icns / icon_installer.icns / dmg_background*.png）需要 iconutil，
 * Windows 与 Linux 上无法生成，本脚本不碰它们。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { brandIdentity } from "@zcode/biz-brand";

const desktopRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(desktopRoot, "../..");

/** 与上游图标同构：深色圆角方块 + 居中品牌标记。 */
const TILE_VIEWPORT = 512;
const TILE_CORNER_RADIUS = 118;
const MARK_INSET = 72;

export const BRAND_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
/** ICO 容器收录的尺寸；256 用 PNG-in-ICO，Vista 之后的 Windows Shell 直接解码。 */
export const BRAND_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const SCREENSHOT_TIMEOUT_MS = 45_000;

export function createIconPage(size) {
  const markBox = TILE_VIEWPORT - MARK_INSET * 2;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent;
      }
      svg {
        display: block;
      }
    </style>
  </head>
  <body>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      width="${size}"
      height="${size}"
      viewBox="0 0 ${TILE_VIEWPORT} ${TILE_VIEWPORT}"
    >
      <defs>
        <linearGradient id="brandIconTile" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#000000" />
          <stop offset="100%" stop-color="#151718" />
        </linearGradient>
      </defs>
      <rect
        x="0"
        y="0"
        width="${TILE_VIEWPORT}"
        height="${TILE_VIEWPORT}"
        rx="${TILE_CORNER_RADIUS}"
        ry="${TILE_CORNER_RADIUS}"
        fill="url(#brandIconTile)"
      />
      <image
        x="${MARK_INSET}"
        y="${MARK_INSET}"
        width="${markBox}"
        height="${markBox}"
        href="${brandIdentity.logoDataUrl}"
      />
    </svg>
  </body>
</html>
`;
}

/** PNG-in-ICO：ICONDIR + 每项 16 字节 ICONDIRENTRY，图像数据直接放整张 PNG。 */
export function createIcoFile(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let imageOffset = header.length + entries.length * 16;
  const parts = [header];
  for (const entry of entries) {
    const descriptor = Buffer.alloc(16);
    // 256 在单字节宽高里写成 0，这是 ICO 约定而不是缺省值。
    descriptor.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0);
    descriptor.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1);
    descriptor.writeUInt8(0, 2);
    descriptor.writeUInt8(0, 3);
    descriptor.writeUInt16LE(1, 4);
    descriptor.writeUInt16LE(32, 6);
    descriptor.writeUInt32LE(entry.png.length, 8);
    descriptor.writeUInt32LE(imageOffset, 12);
    parts.push(descriptor);
    imageOffset += entry.png.length;
  }
  for (const entry of entries) {
    parts.push(entry.png);
  }
  return Buffer.concat(parts);
}

function candidateBrowsers() {
  const override = process.env.ZCODE_BRAND_ICON_BROWSER?.trim();
  if (override) {
    return [override];
  }
  if (process.platform === "win32") {
    return [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
}

function resolveBrowser() {
  for (const candidate of candidateBrowsers()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "找不到 Edge/Chrome 可执行文件；安装其一或设置 ZCODE_BRAND_ICON_BROWSER 指向浏览器路径",
  );
}

function runScreenshot(browser, htmlPath, pngPath, size, userDataDir) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--default-background-color=00000000",
        `--window-size=${size},${size}`,
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-background-networking",
        "--metrics-recording-only",
        "--disable-extensions",
        `--screenshot=${pngPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    // 修复原因：Edge headless 偶发写完 PNG 后不退出（首次启动的同步/上报子流程挂住），
    // 之前脚本会永久等待 exit。产物已经落盘时按超时收尾，未落盘才判失败。
    const timer = setTimeout(() => {
      if (existsSync(pngPath)) {
        child.kill();
        resolvePromise();
        return;
      }
      child.kill();
      rejectPromise(new Error(`浏览器截图 ${size}x${size} 超时未产出 ${pngPath}`));
    }, SCREENSHOT_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(pngPath)) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`浏览器截图 ${size}x${size} 失败 (exit=${code})：${stderr.trim() || pngPath}`),
      );
    });
  });
}

async function renderSize(browser, scratchDir, size) {
  const htmlPath = join(scratchDir, `brand-${size}.html`);
  const pngPath = join(scratchDir, `brand-${size}.png`);
  // 每个尺寸用独立 profile：同一 user-data-dir 复用会命中 Edge 的单实例锁，第二次截图请求会挂住。
  const profileDir = join(scratchDir, "profiles", String(size));
  await writeFile(htmlPath, createIconPage(size), "utf8");
  await rm(pngPath, { force: true });
  try {
    await runScreenshot(browser, htmlPath, pngPath, size, profileDir);
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }

  const png = await readFile(pngPath);
  const isPng = png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const width = isPng ? png.readUInt32BE(16) : 0;
  const height = isPng ? png.readUInt32BE(20) : 0;
  if (!isPng || width !== size || height !== size) {
    throw new Error(
      `截图产物异常：期望 ${size}x${size} 实际 ${width}x${height}，请检查浏览器 headless 参数`,
    );
  }
  return png;
}

async function writeAsset(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
  return filePath;
}

export async function renderBrandIcons({
  sizes = BRAND_ICON_SIZES,
  icoSizes = BRAND_ICO_SIZES,
} = {}) {
  const browser = resolveBrowser();
  const scratchDir = resolve(workspaceRoot, ".cache", "brand-icons");
  await mkdir(scratchDir, { recursive: true });

  const rendered = new Map();
  for (const size of sizes) {
    rendered.set(size, await renderSize(browser, scratchDir, size));
  }

  const written = [];
  for (const [size, png] of rendered) {
    written.push(await writeAsset(join(desktopRoot, "build", "icons", `${size}x${size}.png`), png));
    written.push(
      await writeAsset(join(workspaceRoot, "public", "logo", "icons", `${size}x${size}.png`), png),
    );
  }

  const master = rendered.get(1024) ?? [...rendered.values()].at(-1);
  for (const name of ["icon.png", "icon_windows.png", "icon_installer.png"]) {
    written.push(await writeAsset(join(desktopRoot, "build", name), master));
  }
  // public/icon_512@2x.png 名为 512@2x，实际内容一直是 1024 母版（macOS dock 用）。
  written.push(await writeAsset(join(workspaceRoot, "public", "icon_512@2x.png"), master));

  const icoEntries = icoSizes
    .filter((size) => rendered.has(size))
    .map((size) => ({ size, png: rendered.get(size) }));
  if (icoEntries.length > 0) {
    const ico = createIcoFile(icoEntries);
    for (const name of ["icon.ico", "icon_installer.ico"]) {
      written.push(await writeAsset(join(desktopRoot, "build", name), ico));
    }
    written.push(await writeAsset(join(workspaceRoot, "public", "logo", "icons", "icon.ico"), ico));
    written.push(
      await writeAsset(
        join(workspaceRoot, "packages", "web", "public", "favicon.ico"),
        createIcoFile(icoEntries.filter((entry) => entry.size <= 48)),
      ),
    );
  }

  return { browser, written };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { browser, written } = await renderBrandIcons();
  console.log(`[brand-icons] browser=${browser}`);
  for (const file of written) {
    console.log(`[brand-icons] wrote ${file}`);
  }
}
