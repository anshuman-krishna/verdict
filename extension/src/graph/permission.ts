import { browser } from "wxt/browser";
import { getReputationLookupEnabled, setGraphContributionEnabled } from "../storage/settings";
import { DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT } from "./endpoint";

// mirrors reputation/permission.ts's own pattern (same reasoning, same
// origin, deliberately a separate copy: see edge.ts's comment on why
// this feature's own files do not import from reputation/). The host
// permission itself is genuinely shared, though: graph/endpoint.ts and
// reputation/endpoint.ts both point at api.verdict.tools, so wxt.config.ts
// declares it once, under optional_host_permissions, and either toggle
// can request or release it.

export interface PermissionApi {
  request: (origins: string[]) => Promise<boolean>;
  remove: (origins: string[]) => Promise<boolean>;
}

const realPermissionApi: PermissionApi = {
  request: (origins) => browser.permissions.request({ origins }),
  remove: (origins) => browser.permissions.remove({ origins }),
};

export function originPattern(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.hostname}/*`;
}

export interface SetGraphContributionOptions {
  endpoint?: string;
  permissionApi?: PermissionApi;
  setEnabled?: (enabled: boolean) => Promise<unknown>;
  // reputation lookup shares this origin's permission; releasing it here
  // while that toggle is still on would silently break it.
  isReputationLookupStillEnabled?: () => Promise<boolean>;
}

export async function setGraphContributionWithPermission(
  enabled: boolean,
  options: SetGraphContributionOptions = {},
): Promise<boolean> {
  const permissionApi = options.permissionApi ?? realPermissionApi;
  const setEnabled = options.setEnabled ?? setGraphContributionEnabled;
  const isReputationLookupStillEnabled =
    options.isReputationLookupStillEnabled ?? getReputationLookupEnabled;
  const origin = originPattern(options.endpoint ?? DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT);

  if (!enabled) {
    await setEnabled(false);
    if (!(await isReputationLookupStillEnabled())) {
      await permissionApi.remove([origin]);
    }
    return false;
  }

  const granted = await permissionApi.request([origin]);
  if (!granted) {
    return false;
  }
  await setEnabled(true);
  return true;
}
