import { browser } from "wxt/browser";
import { handleBridgeMessage } from "../bridge/handler";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";

// SPEC.md section 11. externally_connectable in wxt.config.ts already
// scopes who can even reach this listener to the production site and
// localhost, so this only has to validate the message shape, not the
// sender's origin.
export default defineBackground(() => {
  browser.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    handleBridgeMessage(message, { bundledRules: BUNDLED_AMAZON_RULES }).then(sendResponse);
    return true;
  });
});
