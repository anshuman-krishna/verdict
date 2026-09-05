import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  manifest: {
    name: "Verdict",
    description:
      "Estimates how much of a product's review history looks authentic.",
    permissions: [],
    host_permissions: [],
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
