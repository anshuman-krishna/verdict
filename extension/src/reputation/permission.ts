import { browser } from "wxt/browser";
import { getGraphContributionEnabled, setReputationLookupEnabled } from "../storage/settings";
import { DEFAULT_REPUTATION_ENDPOINT } from "./endpoint";

// optional rather than declared, so nobody is asked at install. the prompt happens inside the
// checkbox's own change event, which permissions.request requires

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
  // contribution shares this origin, so the permission is only released when neither toggle needs it
  isGraphContributionStillEnabled?: () => Promise<boolean>;
}

// on persists only if the permission was granted; off releases it unless contribution still needs it.
// returns what was actually stored, since a denied request means the toggle did not turn on
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
