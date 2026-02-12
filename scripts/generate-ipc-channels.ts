/**
 * Build-time IPC Channel Code Generator
 *
 * Reads src/shared/ipc.ts, extracts all IPC_CHANNELS key-value pairs,
 * and generates src/preload/channel-names.ts with typed string constants
 * and a Set for the preload contextBridge whitelist.
 *
 * This eliminates manual sync between shared/ipc.ts and preload/index.ts,
 * preventing desync bugs where channel strings diverge.
 *
 * Usage:
 *   npx tsx scripts/generate-ipc-channels.ts [--check] [--output <path>]
 *
 * Flags:
 *   --check   Verify generated output matches existing file (CI mode).
 *             Exits with code 1 if files differ.
 *   --output  Override output path (default: src/preload/channel-names.ts).
 *             Useful for --check to write to a temp file.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { extractChannels, generateCode } from "./ipc-channel-core";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_PATH = resolve(ROOT, "src/shared/ipc.ts");
const DEFAULT_OUTPUT_PATH = resolve(ROOT, "src/preload/channel-names.ts");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const outputIdx = args.indexOf("--output");
  const outputPath =
    outputIdx !== -1 && args[outputIdx + 1]
      ? resolve(args[outputIdx + 1])
      : DEFAULT_OUTPUT_PATH;

  // Read source
  const source = readFileSync(SOURCE_PATH, "utf-8");
  const entries = extractChannels(source);

  // Generate code
  const generated = generateCode(entries);

  if (isCheck) {
    // CI verification mode: generate to temp, compare with committed file
    let tmpDir: string | undefined;
    try {
      tmpDir = mkdtempSync(join(tmpdir(), "ipc-gen-"));
      const tmpFile = join(tmpDir, "channel-names.ts");
      writeFileSync(tmpFile, generated, "utf-8");

      let existing: string;
      try {
        existing = readFileSync(outputPath, "utf-8");
      } catch {
        console.error(
          `✗ Generated file does not exist: ${outputPath}\n` +
            "  Run 'npm run generate:ipc' to create it."
        );
        process.exit(1);
      }

      if (existing !== generated) {
        console.error(
          "✗ Generated IPC channels are out of date.\n" +
            `  Source: ${SOURCE_PATH}\n` +
            `  Output: ${outputPath}\n` +
            "  Run 'npm run generate:ipc' and commit the result."
        );
        process.exit(1);
      }

      console.log(`✓ IPC channels are up to date (${entries.length} channels).`);
    } finally {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  } else {
    // Normal generation mode
    writeFileSync(outputPath, generated, "utf-8");
    console.log(
      `✓ Generated ${outputPath} (${entries.length} channels from ${SOURCE_PATH}).`
    );
  }
}

main();
