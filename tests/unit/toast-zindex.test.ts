/**
 * Toast z-index layering regression tests.
 *
 * Validates that the z-index stacking order across the application ensures
 * toast notifications (react-hot-toast Toaster) always paint above all other
 * overlays, including the ULogViewer fullscreen mode.
 *
 * Root cause: react-hot-toast Toaster defaults to z-index 9999. The ULogViewer
 * fullscreen overlay was also z-index 9999, causing toasts to be hidden behind
 * the log viewer when in fullscreen mode.
 *
 * Fix: Toaster containerStyle.zIndex raised to 10000; ULogViewer fullscreen
 * lowered to 9998.
 *
 * These tests parse the actual source files to guard against regressions.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "..", "..");

/** Read a source file relative to the project root. */
function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

/**
 * Extract all z-index integer values from a CSS file.
 * Matches both `z-index: <number>` (CSS) patterns.
 */
function extractCssZIndexes(css: string): number[] {
  const matches = [...css.matchAll(/z-index:\s*(\d+)/g)];
  return matches.map((m) => Number(m[1]));
}

/**
 * Extract inline zIndex values from a TSX/JSX file.
 * Matches `zIndex: <number>` patterns in inline styles.
 */
function extractInlineZIndexes(tsx: string): number[] {
  const matches = [...tsx.matchAll(/zIndex:\s*(\d+)/g)];
  return matches.map((m) => Number(m[1]));
}

// ---------------------------------------------------------------------------
// Source paths
// ---------------------------------------------------------------------------

const APPSHELL_TSX = "src/renderer/components/AppShell/AppShell.tsx";
const ULOGVIEWER_CSS = "src/renderer/components/ui/ULogViewer.module.css";
const UMODAL_CSS = "src/renderer/components/UModal/UModal.module.css";
const DISCOVERY_CSS = "src/renderer/views/DiscoveryView.module.css";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Toast z-index layering (p1-01 regression guard)", () => {
  // ── AppShell Toaster ────────────────────────────────────────────────────

  describe("AppShell Toaster containerStyle", () => {
    it("sets containerStyle with zIndex: 10000 on the Toaster component", () => {
      const src = readSrc(APPSHELL_TSX);

      // The Toaster should have containerStyle={{ zIndex: 10000 }}
      expect(src).toContain("containerStyle={{ zIndex: 10000 }}");
    });

    it("Toaster zIndex (10000) is strictly greater than ULogViewer fullscreen z-index", () => {
      const appShellSrc = readSrc(APPSHELL_TSX);
      const logViewerCss = readSrc(ULOGVIEWER_CSS);

      const toasterZIndexes = extractInlineZIndexes(appShellSrc);
      const logViewerZIndexes = extractCssZIndexes(logViewerCss);

      // Toaster must have exactly one zIndex declaration
      expect(toasterZIndexes).toHaveLength(1);
      const toasterZ = toasterZIndexes[0];

      // ULogViewer fullscreen should have z-index present
      expect(logViewerZIndexes.length).toBeGreaterThanOrEqual(1);

      // The highest z-index in ULogViewer must be below Toaster's zIndex
      const maxLogViewerZ = Math.max(...logViewerZIndexes);
      expect(toasterZ).toBeGreaterThan(maxLogViewerZ);
    });
  });

  // ── ULogViewer fullscreen ───────────────────────────────────────────────

  describe("ULogViewer fullscreen z-index", () => {
    it("uses z-index 9998 for fullscreen mode (not 9999)", () => {
      const css = readSrc(ULOGVIEWER_CSS);

      // The fullscreen rule should have z-index: 9998
      // Extract the .viewer.fullscreen block to check its specific z-index
      const fullscreenBlock = css.match(
        /\.viewer\.fullscreen\s*\{[^}]*z-index:\s*(\d+)/
      );
      expect(fullscreenBlock).not.toBeNull();
      expect(Number(fullscreenBlock![1])).toBe(9998);
    });

    it("fullscreen z-index must NOT equal the react-hot-toast default of 9999", () => {
      const css = readSrc(ULOGVIEWER_CSS);
      const fullscreenBlock = css.match(
        /\.viewer\.fullscreen\s*\{[^}]*z-index:\s*(\d+)/
      );
      expect(fullscreenBlock).not.toBeNull();
      expect(Number(fullscreenBlock![1])).not.toBe(9999);
    });
  });

  // ── Global stacking order ──────────────────────────────────────────────

  describe("Global z-index stacking order invariant", () => {
    it("maintains correct layer hierarchy: toast > fullscreen > modal", () => {
      const appShellSrc = readSrc(APPSHELL_TSX);
      const logViewerCss = readSrc(ULOGVIEWER_CSS);
      const modalCss = readSrc(UMODAL_CSS);
      const discoveryCss = readSrc(DISCOVERY_CSS);

      // Extract all z-index values
      const toasterZ = extractInlineZIndexes(appShellSrc)[0]; // 10000
      const logViewerFullscreenZ = Number(
        logViewerCss.match(
          /\.viewer\.fullscreen\s*\{[^}]*z-index:\s*(\d+)/
        )![1]
      );
      const modalBackdropZ = Number(
        modalCss.match(/\.backdrop\s*\{[^}]*z-index:\s*(\d+)/)![1]
      );
      const modalDialogZ = Number(
        modalCss.match(/\.dialog\s*\{[^}]*z-index:\s*(\d+)/)![1]
      );
      const discoveryOverlayZ = Number(
        discoveryCss.match(/\.resumeOverlay\s*\{[^}]*z-index:\s*(\d+)/)![1]
      );

      // Invariant: toast > fullscreen log viewer > modals
      expect(toasterZ).toBeGreaterThan(logViewerFullscreenZ);
      expect(logViewerFullscreenZ).toBeGreaterThan(modalDialogZ);
      expect(modalDialogZ).toBeGreaterThanOrEqual(modalBackdropZ);

      // Discovery overlay should be at modal level, not above fullscreen
      expect(discoveryOverlayZ).toBeLessThan(logViewerFullscreenZ);

      // Concrete expected values (document the contract)
      expect(toasterZ).toBe(10000);
      expect(logViewerFullscreenZ).toBe(9998);
      expect(modalBackdropZ).toBe(1000);
      expect(modalDialogZ).toBe(1001);
      expect(discoveryOverlayZ).toBe(1000);
    });
  });
});
