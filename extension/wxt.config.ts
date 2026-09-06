import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
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
    permissions: [],
    host_permissions: [],
    // SPEC.md section 4 / section 8: the k anonymous reputation lookup is
    // opt in and off by default. optional_host_permissions means nobody
    // installing Verdict is asked to grant this: reputation/permission.ts
    // requests it at runtime, only the moment someone turns the options
    // page toggle on, inside that click's own user gesture.
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
