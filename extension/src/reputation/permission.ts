import { browser } from "wxt/browser";
import { getGraphContributionEnabled, setReputationLookupEnabled } from "../storage/settings";
import { DEFAULT_REPUTATION_ENDPOINT } from "./endpoint";

// SPEC.md section 4: the reviewer graph service is opt in. wxt.config.ts
// declares api.verdict.tools under optional_host_permissions rather than
// host_permissions, so nobody installing Verdict is asked to grant it: the
// browser only prompts here, at the moment someone actually turns the
// toggle on, per chrome.permissions.request()'s own requirement that it
// run inside a user gesture (the checkbox's own change event).

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
  // graph/endpoint.ts's contribution endpoint lives on the same
  // api.verdict.tools origin as this one, so they share one granted host
  // permission. Releasing it here would silently break contribution if
  // that toggle is still on, so turning reputation lookup off only
  // releases the permission when this also reports false.
  isGraphContributionStillEnabled?: () => Promise<boolean>;
}

// turning the toggle on requests the host permission first and only
// persists the setting if it was granted; turning it off persists the
// setting and releases the permission, the least privilege state for
// someone who no longer wants this running, unless graph contribution
// still needs the same origin. Returns the state that actually ended up
// stored, since a denied request means "on" did not happen, which the
// caller (the options page) needs to re-render.
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
