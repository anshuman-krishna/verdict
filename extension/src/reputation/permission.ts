import { browser } from "wxt/browser";
import { getGraphContributionEnabled, setReputationLookupEnabled } from "../storage/settings";
import { DEFAULT_REPUTATION_ENDPOINT } from "./endpoint";


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

export interface SetReputationLookupOptions {
  endpoint?: string;
  permissionApi?: PermissionApi;
  setEnabled?: (enabled: boolean) => Promise<unknown>;
  isGraphContributionStillEnabled?: () => Promise<boolean>;
}

export async function setReputationLookupWithPermission(
  enabled: boolean,
  options: SetReputationLookupOptions = {},
): Promise<boolean> {
  const permissionApi = options.permissionApi ?? realPermissionApi;
  const setEnabled = options.setEnabled ?? setReputationLookupEnabled;
  const isGraphContributionStillEnabled =
    options.isGraphContributionStillEnabled ?? getGraphContributionEnabled;
  const origin = originPattern(options.endpoint ?? DEFAULT_REPUTATION_ENDPOINT);

  if (!enabled) {
    await setEnabled(false);
    if (!(await isGraphContributionStillEnabled())) {
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
