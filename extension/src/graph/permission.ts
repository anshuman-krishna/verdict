import { browser } from "wxt/browser";
import { getReputationLookupEnabled, setGraphContributionEnabled } from "../storage/settings";
import { DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT } from "./endpoint";
import { clearContributionQueue } from "./queue";


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
  isReputationLookupStillEnabled?: () => Promise<boolean>;
  clearQueue?: () => Promise<void>;
}

export async function setGraphContributionWithPermission(
  enabled: boolean,
  options: SetGraphContributionOptions = {},
): Promise<boolean> {
  const permissionApi = options.permissionApi ?? realPermissionApi;
  const setEnabled = options.setEnabled ?? setGraphContributionEnabled;
  const isReputationLookupStillEnabled =
    options.isReputationLookupStillEnabled ?? getReputationLookupEnabled;
  const clearQueue = options.clearQueue ?? clearContributionQueue;
  const origin = originPattern(options.endpoint ?? DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT);

  if (!enabled) {
    await setEnabled(false);
    // PRIVACY.md section 5, off means nothing already queued goes out either
    await clearQueue();
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
