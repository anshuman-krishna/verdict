import { browser } from "wxt/browser";
import { getReputationLookupEnabled, setGraphContributionEnabled } from "../storage/settings";
import { DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT } from "./endpoint";


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
