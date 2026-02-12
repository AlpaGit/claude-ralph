/**
 * Structural validation tests for UDiscoveryBreadcrumb component (back-navigation).
 *
 * Strategy: Integration tests (Playwright E2E) are the preferred tier — the
 * discovery-flow.e2e.ts already exercises the DiscoveryView inside the live
 * Electron app. As a complementary fallback layer, these tests use source-level
 * structural validation (same approach as uquestionbatch.test.ts) to verify:
 *   - Exported public API surface (UDiscoveryBreadcrumb, UDiscoveryBreadcrumbProps)
 *   - CSS Module class selectors match component references
 *   - Accessibility attributes (nav role, aria-label, aria-current)
 *   - Design token compliance (no hardcoded hex colors)
 *   - Core design token references via var()
 *   - Focus-visible outline for interactive crumbs and return button
 *   - Past-round viewing banner with "Return to current" action
 *   - Null return when history is empty (smart rendering)
 *   - Imports from discoveryStore for DiscoveryHistoryEntry type
 *   - Integration with DiscoveryView (renders breadcrumb with correct props)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "..", "..");

function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

function extractCssClasses(css: string): string[] {
  const matches = [...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

function extractTokenRefs(css: string): string[] {
  const matches = [...css.matchAll(/var\((--[\w-]+)\)/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

// ---------------------------------------------------------------------------
// Source file paths
// ---------------------------------------------------------------------------

const BREADCRUMB_TSX = "src/renderer/components/ui/UDiscoveryBreadcrumb.tsx";
const BREADCRUMB_CSS = "src/renderer/components/ui/UDiscoveryBreadcrumb.module.css";

// ---------------------------------------------------------------------------
// UDiscoveryBreadcrumb – CSS Module
// ---------------------------------------------------------------------------

describe("UDiscoveryBreadcrumb CSS Module", () => {
  const css = readSrc(BREADCRUMB_CSS);
  const classes = extractCssClasses(css);

  it("defines all required CSS class selectors", () => {
    const required = [
      "root",
      "trail",
      "crumbGroup",
      "crumb",
      "crumbClickable",
      "crumbActive",
      "crumbCurrent",
      "crumbRound",
      "crumbScore",
      "currentLabel",
      "separator",
      "pastBanner",
      "pastBannerText",
      "returnButton",
    ];
    for (const cls of required) {
      expect(classes, `Missing CSS class: .${cls}`).toContain(cls);
    }
  });

  it("uses design tokens — no hardcoded hex color values", () => {
    const hexMatches = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
    expect(
      hexMatches,
      `Found hardcoded hex colors: ${hexMatches.map((m) => m[0]).join(", ")}`
    ).toHaveLength(0);
  });

  it("references core design tokens via var()", () => {
    const tokens = extractTokenRefs(css);
    const expectedTokens = [
      "--space-sm",
      "--space-md",
      "--color-border-soft",
      "--color-surface",
      "--color-muted",
      "--color-accent-2",
      "--color-wizard-active-bg",
      "--color-thinking-text",
      "--color-warning",
      "--color-surface-warm",
      "--font-mono",
      "--radius-pill",
      "--radius-sm",
      "--transition-fast",
    ];
    for (const token of expectedTokens) {
      expect(tokens, `Missing token reference: ${token}`).toContain(token);
    }
  });

  it("crumbClickable has hover state styles", () => {
    expect(css).toMatch(/\.crumbClickable:hover\s*\{/);
  });

  it("crumbClickable has focus-visible outline for accessibility", () => {
    expect(css).toMatch(/\.crumbClickable:focus-visible\s*\{[^}]*outline:/s);
  });

  it("returnButton has focus-visible outline for accessibility", () => {
    expect(css).toMatch(/\.returnButton:focus-visible\s*\{[^}]*outline:/s);
  });

  it("returnButton has hover state", () => {
    expect(css).toMatch(/\.returnButton:hover\s*\{/);
  });

  it("pastBanner uses dashed border with warning color", () => {
    const bannerBlock = css.match(/\.pastBanner\s*\{[^}]*\}/s);
    expect(bannerBlock).not.toBeNull();
    expect(bannerBlock![0]).toMatch(/border:\s*[\d.]+px\s+dashed/);
    expect(bannerBlock![0]).toContain("var(--color-warning)");
  });

  it("separator uses CSS ::after pseudo-element for the arrow", () => {
    expect(css).toMatch(/\.separator::after\s*\{/);
    expect(css).toContain("content:");
  });

  it("crumbActive uses accent-2 border color for selected state", () => {
    const activeBlock = css.match(/\.crumbActive\s*\{[^}]*\}/s);
    expect(activeBlock).not.toBeNull();
    expect(activeBlock![0]).toContain("var(--color-accent-2)");
  });
});

// ---------------------------------------------------------------------------
// UDiscoveryBreadcrumb – TSX Component
// ---------------------------------------------------------------------------

describe("UDiscoveryBreadcrumb TSX component", () => {
  const tsx = readSrc(BREADCRUMB_TSX);

  // ── Exported API ────────────────────────────────────────

  it("exports the UDiscoveryBreadcrumb function component", () => {
    expect(tsx).toMatch(/export\s+function\s+UDiscoveryBreadcrumb/);
  });

  it("exports the UDiscoveryBreadcrumbProps interface", () => {
    expect(tsx).toMatch(/export\s+interface\s+UDiscoveryBreadcrumbProps/);
  });

  it("props interface includes all required fields", () => {
    const requiredProps = [
      "history: DiscoveryHistoryEntry[]",
      "currentRound: number",
      "currentReadinessScore: number",
      "viewingHistoryIndex: number | null",
      "onNavigateToRound: (historyIndex: number) => void",
      "onReturnToCurrent: () => void",
    ];
    for (const prop of requiredProps) {
      expect(tsx, `Missing prop: ${prop}`).toContain(prop);
    }
  });

  it("has optional className prop", () => {
    expect(tsx).toContain("className?: string");
  });

  // ── Imports ────────────────────────────────────────────

  it("imports DiscoveryHistoryEntry type from discoveryStore", () => {
    expect(tsx).toMatch(
      /import\s+type\s*\{\s*DiscoveryHistoryEntry\s*\}\s*from\s*"\.\.\/\.\.\/stores\/discoveryStore"/
    );
  });

  it("imports CSS module", () => {
    expect(tsx).toContain('from "./UDiscoveryBreadcrumb.module.css"');
  });

  // ── Smart rendering ────────────────────────────────────

  it("returns null when history is empty", () => {
    expect(tsx).toMatch(/if\s*\(\s*history\.length\s*===\s*0\s*\)\s*return\s+null/);
  });

  it("return type is JSX.Element | null", () => {
    expect(tsx).toContain("JSX.Element | null");
  });

  // ── Accessibility ──────────────────────────────────────

  it("uses <nav> element with aria-label", () => {
    expect(tsx).toContain("<nav");
    expect(tsx).toContain('aria-label="Discovery round navigation"');
  });

  it("uses aria-current='step' on the active crumb", () => {
    expect(tsx).toContain('aria-current={isActive ? "step" : undefined}');
    expect(tsx).toContain('aria-current={!isViewingPast ? "step" : undefined}');
  });

  it("uses aria-hidden on separator", () => {
    expect(tsx).toContain('aria-hidden="true"');
  });

  it("all interactive crumbs use button elements with type='button'", () => {
    expect(tsx).toContain('type="button"');
    // Should have buttons, not anchors
    expect(tsx).not.toContain("<a ");
  });

  // ── Past round crumbs ─────────────────────────────────

  it("renders history entries via map", () => {
    expect(tsx).toContain("history.map((entry, index)");
  });

  it("calls onNavigateToRound when a past crumb is clicked", () => {
    expect(tsx).toContain("onNavigateToRound(index)");
  });

  it("shows round number in crumb (R{entry.round})", () => {
    expect(tsx).toContain("R{entry.round}");
  });

  it("shows readiness score in crumb", () => {
    expect(tsx).toContain("{entry.readinessScore}%");
  });

  // ── Current round crumb ────────────────────────────────

  it("renders a current round crumb with 'current' label", () => {
    expect(tsx).toContain("R{currentRound}");
    expect(tsx).toContain("{currentReadinessScore}%");
    expect(tsx).toContain("current");
    expect(tsx).toContain("styles.currentLabel");
  });

  it("current crumb calls onReturnToCurrent when viewing past", () => {
    expect(tsx).toContain("isViewingPast ? onReturnToCurrent : undefined");
  });

  // ── Past-round viewing banner ──────────────────────────

  it("renders a past-round viewing banner when isViewingPast", () => {
    expect(tsx).toContain("styles.pastBanner");
    expect(tsx).toContain("styles.pastBannerText");
    expect(tsx).toContain("Viewing Round");
  });

  it("banner has a 'Return to current' button", () => {
    expect(tsx).toContain("Return to current");
    expect(tsx).toContain("styles.returnButton");
  });

  it("return button calls onReturnToCurrent", () => {
    expect(tsx).toContain("onClick={onReturnToCurrent}");
  });

  // ── Conditional CSS classes ────────────────────────────

  it("applies crumbActive class to the viewed entry", () => {
    expect(tsx).toContain("isActive && styles.crumbActive");
  });

  it("applies crumbClickable class to non-active entries", () => {
    expect(tsx).toContain("!isActive && styles.crumbClickable");
  });

  it("applies crumbCurrent class to the current round crumb", () => {
    expect(tsx).toContain("styles.crumbCurrent");
  });
});

// ---------------------------------------------------------------------------
// UDiscoveryBreadcrumb ↔ DiscoveryView integration
// ---------------------------------------------------------------------------

describe("UDiscoveryBreadcrumb ↔ DiscoveryView integration", () => {
  const viewTsx = readSrc("src/renderer/views/DiscoveryView.tsx");

  it("DiscoveryView imports UDiscoveryBreadcrumb", () => {
    expect(viewTsx).toMatch(/import\s*\{\s*UDiscoveryBreadcrumb\s*\}\s*from/);
  });

  it("DiscoveryView renders <UDiscoveryBreadcrumb> with all required props", () => {
    expect(viewTsx).toContain("<UDiscoveryBreadcrumb");
    expect(viewTsx).toContain("history={history}");
    expect(viewTsx).toContain("currentRound={interview.round}");
    expect(viewTsx).toContain("currentReadinessScore={interview.readinessScore}");
    expect(viewTsx).toContain("viewingHistoryIndex={viewingHistoryIndex}");
    expect(viewTsx).toContain("onNavigateToRound={navigateToRound}");
    expect(viewTsx).toContain("onReturnToCurrent={returnToCurrent}");
  });

  it("DiscoveryView subscribes to history and viewingHistoryIndex from store", () => {
    expect(viewTsx).toContain("s.history");
    expect(viewTsx).toContain("s.viewingHistoryIndex");
  });

  it("DiscoveryView subscribes to navigateToRound and returnToCurrent actions", () => {
    expect(viewTsx).toContain("s.navigateToRound");
    expect(viewTsx).toContain("s.returnToCurrent");
  });

  it("DiscoveryView computes displayedInterview from history when viewing past", () => {
    expect(viewTsx).toContain("displayedInterview");
    expect(viewTsx).toContain("history[viewingHistoryIndex].interview");
  });

  it("DiscoveryView computes displayedAnswerMap from history when viewing past", () => {
    expect(viewTsx).toContain("displayedAnswerMap");
    expect(viewTsx).toContain("history[viewingHistoryIndex].answerMap");
  });

  it("DiscoveryView uses displayedInterview for rendering panels", () => {
    expect(viewTsx).toContain("displayedInterview.round");
    expect(viewTsx).toContain("displayedInterview.readinessScore");
    expect(viewTsx).toContain("displayedInterview.directionSummary");
    expect(viewTsx).toContain("displayedInterview.inferredContext");
    expect(viewTsx).toContain("displayedInterview.questions");
    expect(viewTsx).toContain("displayedInterview.prdInputDraft");
  });

  it("DiscoveryView hides bottom actions when viewing past round", () => {
    expect(viewTsx).toContain("!isViewingPast");
  });

  it("DiscoveryView passes disabled={isViewingPast} to UQuestionBatch", () => {
    expect(viewTsx).toContain("disabled={isViewingPast}");
  });
});
