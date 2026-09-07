import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  // otherwise the zips are named from package.json, and /install tells people to download verdict-
  zip: {
    name: "verdict",
  },
  manifest: {
    name: "Verdict",
    description:
      "Estimates how much of a product's review history looks authentic.",
    // the same curve ui/rosette.ts draws, filled rather than stroked so it survives 16px
    icons: {
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    },
    action: {
      default_icon: {
        16: "icons/16.png",
        32: "icons/32.png",
        48: "icons/48.png",
        128: "icons/128.png",
      },
    },
    // neither carries an install warning. alarms survives the worker being killed; setInterval does
    // not. storage is chrome.storage.sync, for preferences only
    permissions: ["alarms", "storage"],
    host_permissions: [],
    // covers both opt ins. never granted at install: each is requested inside the click that enables
    // it, and released once neither needs it
    optional_host_permissions: ["https://api.verdict.tools/*"],
    // SPEC.md section 11: scoped to the production domain and localhost
    // only, so no other site can ever reach the bridge in background.ts.
    externally_connectable: {
      matches: ["https://verdict.tools/*", "http://localhost/*"],
    },
    browser_specific_settings: {
      gecko: {
        id: "verdict@verdict.tools",
      },
    },
  },
});
