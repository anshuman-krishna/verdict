import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  // without this the zips take their name from package.json and come out
  // as extension-0.1.0-chrome.zip. SITE.md's /install page tells people to
  // download verdict-chrome.zip, and scripts/release-manifest.mjs records
  // whatever is actually produced, so the name is fixed here rather than
  // in either of those.
  zip: {
    name: "verdict",
  },
  manifest: {
    name: "Verdict",
    description:
      "Estimates how much of a product's review history looks authentic.",
    // extension/public/icons/rosette.svg records how these were generated:
    // the same rosettePath math ui/rosette.ts draws per report
    // (DESIGN.md section 7), filled rather than stroked so it stays
    // legible at 16px, in a fixed "clean" band instance rather than a
    // literal report.
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
    // neither permission below carries a runtime prompt (Chrome's
    // install-time warnings list omits both). "alarms" is what
    // background.ts uses to periodically check the graph contribution
    // queue: an MV3 service worker can be killed and restarted at any
    // time, and a plain setTimeout/setInterval does not survive that the
    // way a registered alarm does. "storage" is chrome.storage.sync,
    // SPEC.md section 10's "prefs mirrored to chrome.storage.sync where
    // it makes sense" (storage/syncedBoolean.ts).
    permissions: ["alarms", "storage"],
    host_permissions: [],
    // SPEC.md section 4 / section 8 (reputation lookup) and PRIVACY.md
    // section 5 (graph contribution) both live under api.verdict.tools,
    // so this one optional_host_permissions entry covers both. Neither
    // is granted at install: reputation/permission.ts and
    // graph/permission.ts each request it at runtime, only the moment
    // someone turns their own options page toggle on, inside that
    // click's own user gesture, and each only releases it once neither
    // toggle needs it any more.
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
