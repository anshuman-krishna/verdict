import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { getGraphContributionEnabled } from "../storage/settings";
import { originPattern, setGraphContributionWithPermission } from "./permission";

describe("originPattern", () => {
  it("derives a manifest style origin pattern from an endpoint url", () => {
    expect(originPattern("https://api.verdict.tools/v1/graph/contribute")).toBe(
      "https://api.verdict.tools/*",
    );
  });
});

describe("setGraphContributionWithPermission", () => {
  it("requests the permission and persists true when it is granted", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);
    const setEnabled = vi.fn().mockResolvedValue(undefined);

    const result = await setGraphContributionWithPermission(true, {
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

    const result = await setGraphContributionWithPermission(true, {
      permissionApi: { request, remove },
      setEnabled,
    });

    expect(result).toBe(false);
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("persists false and releases the permission when turning it off and reputation lookup does not need it either", async () => {
    const request = vi.fn();
    const remove = vi.fn().mockResolvedValue(true);
    const setEnabled = vi.fn().mockResolvedValue(undefined);

    const result = await setGraphContributionWithPermission(false, {
      permissionApi: { request, remove },
      setEnabled,
      isReputationLookupStillEnabled: async () => false,
    });

    expect(result).toBe(false);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(remove).toHaveBeenCalledWith(["https://api.verdict.tools/*"]);
  });

  it("does not release the shared origin permission when reputation lookup still needs it", async () => {
    const request = vi.fn();
    const remove = vi.fn().mockResolvedValue(true);
    const setEnabled = vi.fn().mockResolvedValue(undefined);

    const result = await setGraphContributionWithPermission(false, {
      permissionApi: { request, remove },
      setEnabled,
      isReputationLookupStillEnabled: async () => true,
    });

    expect(result).toBe(false);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("defaults to the real settings.ts store when no setEnabled is injected", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);

    await setGraphContributionWithPermission(true, { permissionApi: { request, remove } });
    await expect(getGraphContributionEnabled()).resolves.toBe(true);
  });
});
