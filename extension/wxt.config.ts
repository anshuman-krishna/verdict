import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  manifest: {
    name: "Grain",
    description:
      "Estimates how much of a product's review history looks authentic.",
    permissions: [],
    host_permissions: [],
    browser_specific_settings: {
      gecko: {
        id: "extension@grain.tools",
      },
    },
  },
});
