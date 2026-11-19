import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATA_DIR_NAME,
  DLMETA_DATA_DIR_NAME_ENV,
  normalizeDataDirName,
  resolveDataDirName,
} from "../src/dataDirName.js";

describe("数据目录叶子名", () => {
  it("未注入任何覆盖时回落 fork 默认叶子 .dlMeta（与同机上游 .zcode 隔离）", () => {
    expect(resolveDataDirName({})).toBe(DEFAULT_DATA_DIR_NAME);
    expect(resolveDataDirName({ [DLMETA_DATA_DIR_NAME_ENV]: "" })).toBe(DEFAULT_DATA_DIR_NAME);
    expect(resolveDataDirName({ [DLMETA_DATA_DIR_NAME_ENV]: "   " })).toBe(DEFAULT_DATA_DIR_NAME);
  });

  it("注入值去掉首尾空白后生效", () => {
    expect(resolveDataDirName({ [DLMETA_DATA_DIR_NAME_ENV]: "  .dlMeta  " })).toBe(".dlMeta");
  });

  it("只接受单个安全路径段", () => {
    for (const value of [".dlMeta", "data_dir-1", "_x"]) {
      expect(normalizeDataDirName(value)).toBe(value);
    }
  });

  it.each([
    ["路径分隔符", "a/b"],
    ["反斜杠", "a\\b"],
    ["上级目录", ".."],
    ["当前目录", "."],
    ["绝对路径", "/etc"],
    ["盘符绝对路径", "C:/tmp"],
    ["含空格", "my dir"],
    ["非 ASCII", "融智坊"],
  ])("拒绝%s：%s", (_label, value) => {
    expect(() => normalizeDataDirName(value)).toThrow(/DLMETA_DATA_DIR_NAME/);
    expect(() => resolveDataDirName({ [DLMETA_DATA_DIR_NAME_ENV]: value })).toThrow(
      /DLMETA_DATA_DIR_NAME/,
    );
  });
});
