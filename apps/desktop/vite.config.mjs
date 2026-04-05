import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";

const host = process.env.TAURI_DEV_HOST;
const isTest = process.env.VITEST === "true";

export default defineConfig(async () => ({
  plugins: [solid({ hot: !isTest })],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
    testTimeout: 10000,
    server: {
      deps: {
        inline: true,
      },
    },
  },
}));
