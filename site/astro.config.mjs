import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  // the content security policy runs scripts from files only, never inline
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
