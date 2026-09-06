import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { getReputationLookupEnabled } from "../storage/settings";
import { originPattern, setReputationLookupWithPermission } from "./permission";

describe("originPattern", () => {
  it("derives a manifest style origin pattern from an endpoint url", () => {
    expect(originPattern("https://api.verdict.tools/v1/reputation/lookup")).toBe(
      "https://api.verdict.tools/*",
    );
  });
});

describe("setReputationLookupWithPermission", () => {
  it("requests the permission and persists true when it is granted", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);
    const setEnabled = vi.fn().mockResolvedValue(undefined);

    const result = await setReputationLookupWithPermission(true, {
      permissionApi: { request, remove },
      setEnabled,
    });

    expect(result).toBe(true);
    expect(request).toHaveBeenCalledWith(["https://api.verdict.tools/*"]);
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not persist true, and reports false, when the permission is denied", async () => {
    const request = vi.fn().mockResolvedValue(false);
    const remove = vi.fn();
    const setEnabled = vi.fn();

    const result = await setReputationLookupWithPermission(true, {
      permissionApi: { request, remove },
      setEnabled,
    });

    expect(result).toBe(false);
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("persists false and releases the permission when turning it off", async () => {
    const request = vi.fn();
    const remove = vi.fn().mockResolvedValue(true);
    const setEnabled = vi.fn().mockResolvedValue(undefined);

    const result = await setReputationLookupWithPermission(false, {
      permissionApi: { request, remove },
      setEnabled,
    });

    expect(result).toBe(false);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(remove).toHaveBeenCalledWith(["https://api.verdict.tools/*"]);
    expect(request).not.toHaveBeenCalled();
  });

  it("defaults to the real settings.ts store when no setEnabled is injected", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);

    await setReputationLookupWithPermission(true, { permissionApi: { request, remove } });
    await expect(getReputationLookupEnabled()).resolves.toBe(true);
  });
});
