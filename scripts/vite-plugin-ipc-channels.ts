/**
 * Vite plugin that regenerates src/preload/channel-names.ts from
 * src/shared/ipc.ts at the start of every build or dev server start.
 *
 * This ensures the preload channel constants are always in sync with the
 * authoritative IPC_CHANNELS definition, without requiring a manual
 * `npm run generate:ipc` step.
 *
 * Usage in electron.vite.config.ts:
 *   import { ipcChannelsPlugin } from "./scripts/vite-plugin-ipc-channels";
 *   // Add to the preload config's plugins array
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { extractChannels, generateCode } from "./ipc-channel-core";

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function ipcChannelsPlugin(): Plugin {
  // Note: import.meta.dirname is unreliable here because electron-vite bundles
  // the config into a temp .mjs file, shifting the dirname. Vite's resolved
  // config.root is the canonical project root.
  let rootDir = process.cwd();

  return {
    name: "ipc-channels-generator",

    configResolved(config) {
      rootDir = config.root;
    },

    /**
     * Runs at the start of every build / dev serve.
     * Reads the source, generates code, and writes only if content changed
     * (avoids unnecessary HMR triggers during dev).
     */
    buildStart() {
      const sourcePath = resolve(rootDir, "src/shared/ipc.ts");
      const outputPath = resolve(rootDir, "src/preload/channel-names.ts");

      const source = readFileSync(sourcePath, "utf-8");
      const entries = extractChannels(source);
      const generated = generateCode(entries);

      let existing = "";
      try {
        existing = readFileSync(outputPath, "utf-8");
      } catch {
        // File doesn't exist yet — will be created
      }

      if (existing !== generated) {
        writeFileSync(outputPath, generated, "utf-8");
        console.log(
          `[ipc-channels-generator] Regenerated channel-names.ts (${entries.length} channels)`
        );
      }
    }
  };
}
