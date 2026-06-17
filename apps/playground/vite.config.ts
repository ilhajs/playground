import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const FRAME_ANCESTORS = "frame-ancestors *";

function allowFraming(): Plugin {
  return {
    name: "allow-framing",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
        next();
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: `/*\n  Content-Security-Policy: ${FRAME_ANCESTORS}\n`,
      });
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [allowFraming()],
  resolve: {
    alias: {
      shedit: path.resolve(__dirname, "../../packages/shedit/src/index.ts"),
    },
    dedupe: ["typescript"],
  },
});
