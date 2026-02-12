import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const sharedAlias = resolve("src/shared");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": sharedAlias
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          chunkFileNames: "[name].js"
        }
      }
    },
    resolve: {
      alias: {
        "@shared": sharedAlias
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@shared": sharedAlias
      }
    }
  }
});
