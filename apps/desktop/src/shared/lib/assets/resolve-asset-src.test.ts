import { describe, expect, it, vi } from "vitest";
import {
  clearResolvedAssetSrcCache,
  resolveAssetSrc
} from "./resolve-asset-src";

describe("resolveAssetSrc", () => {
  it("returns remote sources unchanged", async () => {
    await expect(
      resolveAssetSrc(
        "https://example.com/cat.png",
        true,
        vi.fn(),
        vi.fn((value) => `converted:${value}`)
      )
    ).resolves.toBe("https://example.com/cat.png");
  });

  it("resolves local assets through tauri and caches the result", async () => {
    clearResolvedAssetSrcCache();
    const invokeFn = vi.fn().mockResolvedValue("C:/vault/assets/cat.png");
    const convertFileSrcFn = vi.fn((value: string) => `asset://${value}`);

    await expect(
      resolveAssetSrc("/assets/cat.png", true, invokeFn, convertFileSrcFn)
    ).resolves.toBe("asset://C:/vault/assets/cat.png");
    await expect(
      resolveAssetSrc("/assets/cat.png", true, invokeFn, convertFileSrcFn)
    ).resolves.toBe("asset://C:/vault/assets/cat.png");
    expect(invokeFn).toHaveBeenCalledTimes(1);
    expect(convertFileSrcFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the original source on resolution failure", async () => {
    clearResolvedAssetSrcCache();
    await expect(
      resolveAssetSrc(
        "/assets/missing.png",
        true,
        vi.fn().mockRejectedValue(new Error("missing")),
        vi.fn((value) => `asset://${value}`)
      )
    ).resolves.toBe("/assets/missing.png");
  });

  it("does not cache a failed resolution fallback", async () => {
    clearResolvedAssetSrcCache();
    const invokeFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("missing"))
      .mockResolvedValueOnce("C:/vault/assets/cat.png");
    const convertFileSrcFn = vi.fn((value: string) => `asset://${value}`);

    await expect(
      resolveAssetSrc("/assets/cat.png", true, invokeFn, convertFileSrcFn)
    ).resolves.toBe("/assets/cat.png");
    await expect(
      resolveAssetSrc("/assets/cat.png", true, invokeFn, convertFileSrcFn)
    ).resolves.toBe("asset://C:/vault/assets/cat.png");
    expect(invokeFn).toHaveBeenCalledTimes(2);
  });
});
