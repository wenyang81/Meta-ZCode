import { afterEach, describe, expect, it, vi } from "vitest";

const UPSTREAM_DEFAULT_ENDPOINT_ORIGIN = "https://zcode.z.ai";

function setBakedOrigin(value: string | undefined) {
  if (value === undefined) {
    delete (globalThis as Record<string, unknown>).__ZCODE_DEFAULT_ENDPOINT_ORIGIN__;
  } else {
    (globalThis as Record<string, unknown>).__ZCODE_DEFAULT_ENDPOINT_ORIGIN__ = value;
  }
}

afterEach(() => {
  setBakedOrigin(undefined);
  vi.resetModules();
});

describe("DEFAULT_ZCODE_ENDPOINT_ORIGIN 构建期注入", () => {
  it("未灼入 define（dev/CLI/测试）时回落上游默认", async () => {
    const mod = await import("../src/zcodeEndpoint.js");
    expect(mod.DEFAULT_ZCODE_ENDPOINT_ORIGIN).toBe(UPSTREAM_DEFAULT_ENDPOINT_ORIGIN);
  });

  it("灼入验证机地址时取 define 值并归一化 origin（去尾斜杠）", async () => {
    setBakedOrigin("http://127.0.0.1:18091/");
    const mod = await import("../src/zcodeEndpoint.js");
    expect(mod.DEFAULT_ZCODE_ENDPOINT_ORIGIN).toBe("http://127.0.0.1:18091");
  });

  it("灼入空串视为未灼入，仍回落上游默认", async () => {
    setBakedOrigin("   ");
    const mod = await import("../src/zcodeEndpoint.js");
    expect(mod.DEFAULT_ZCODE_ENDPOINT_ORIGIN).toBe(UPSTREAM_DEFAULT_ENDPOINT_ORIGIN);
  });

  it("灼入非法地址在模块加载期即报错，不静默回落", async () => {
    setBakedOrigin("ftp://127.0.0.1:18091");
    await expect(import("../src/zcodeEndpoint.js")).rejects.toThrow(/http or https/);
  });
});
