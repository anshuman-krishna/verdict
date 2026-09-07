import { defineConfig } from "vite";
import { resolve } from "node:path";

// PLAN.md week 7: the python canary job drives the shipped extractor rather than reimplementing it,
// so the extractor needs to exist as something node can run. This is that build, and it is
// deliberately separate from the wxt build: nothing here goes into the extension bundle, so it is
// not subject to SPEC.md section 14's 8 mb cap and does not appear in a release zip.
//
// happy-dom stays external and is resolved from extension/node_modules at run time, which keeps
// this artefact small and keeps the dom implementation a development dependency rather than
// something bundled.
export default defineConfig({
  build: {
    ssr: true,
    target: "node20",
    outDir: ".output/canary",
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/canary/cli.ts"),
      formats: ["es"],
    },
    rollupOptions: {
      external: ["happy-dom", /^node:/],
      output: { entryFileNames: "extract.mjs" },
    },
  },
});
