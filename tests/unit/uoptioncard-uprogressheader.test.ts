/**
 * Unit tests for UOptionCard and UProgressHeader UI components (disc-004).
 *
 * Strategy: Integration tests (Playwright E2E) are the preferred tier, but these
 * components are not yet wired into a live view with real data. The strongest
 * feasible fallback is source-level structural validation (same approach as
 * toast-zindex.test.ts) plus a production build pass (run separately).
 *
 * Tests validate:
 *   - Exported public API surface (types, constants, barrel exports)
 *   - CSS Module class selectors match component references
 *   - CSS animation keyframes exist (selectPulse, otherReveal)
 *   - Hover/active/selected/disabled state selectors present
 *   - Accessibility attributes (role, aria-*, tabIndex) in JSX source
 *   - Design token compliance (var(--*) references, no stray hex colors)
 *   - UProgressHeader clamping and chip rendering logic
 *   - OTHER_OPTION_VALUE sentinel constant value
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

/**
 * Extract all CSS class selectors from a CSS Module file.
 * Matches .className patterns (including compound like .foo.bar and nested .foo .bar).
 */
function extractCssClasses(css: string): string[] {
  const matches = [...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

/**
 * Extract all @keyframes names from a CSS file.
 */
function extractKeyframeNames(css: string): string[] {
  const matches = [...css.matchAll(/@keyframes\s+([\w-]+)/g)];
  return matches.map((m) => m[1]);
}

/**
 * Extract all var(--xxx) token references from a CSS file.
 */
function extractTokenRefs(css: string): string[] {
  const matches = [...css.matchAll(/var\((--[\w-]+)\)/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

// ---------------------------------------------------------------------------
// Source file paths
// ---------------------------------------------------------------------------

const OPTION_CARD_TSX = "src/renderer/components/ui/UOptionCard.tsx";
const OPTION_CARD_CSS = "src/renderer/components/ui/UOptionCard.module.css";
const PROGRESS_HEADER_TSX = "src/renderer/components/ui/UProgressHeader.tsx";
const PROGRESS_HEADER_CSS = "src/renderer/components/ui/UProgressHeader.module.css";
const BARREL_EXPORT = "src/renderer/components/ui.ts";

// ---------------------------------------------------------------------------
// UOptionCard – CSS Module
// ---------------------------------------------------------------------------

describe("UOptionCard CSS Module", () => {
  const css = readSrc(OPTION_CARD_CSS);
  const classes = extractCssClasses(css);

  it("defines all required CSS class selectors", () => {
    const required = [
      "card",
      "selected",
      "disabled",
      "indicator",
      "indicatorRadio",
      "indicatorCheckbox",
      "indicatorMark",
      "label",
      "badge",
      "content",
      "otherInput"
    ];
    for (const cls of required) {
      expect(classes, `Missing CSS class: .${cls}`).toContain(cls);
    }
  });

  it("has hover scale(1.02) transform on .card", () => {
    expect(css).toMatch(/\.card:hover.*\{[^}]*transform:\s*scale\(1\.02\)/s);
  });

  it("has active scale(1) transform on .card", () => {
    expect(css).toMatch(/\.card:active.*\{[^}]*transform:\s*scale\(1\)/s);
  });

  it("has focus-visible outline for accessibility", () => {
    expect(css).toMatch(/\.card:focus-visible\s*\{[^}]*outline:/s);
  });

  it("defines @keyframes selectPulse animation", () => {
    const keyframes = extractKeyframeNames(css);
    expect(keyframes).toContain("selectPulse");
  });

  it("defines @keyframes otherReveal animation", () => {
    const keyframes = extractKeyframeNames(css);
    expect(keyframes).toContain("otherReveal");
  });

  it("selectPulse uses box-shadow for pulse effect", () => {
    const selectPulseBlock = css.match(
      /@keyframes selectPulse\s*\{[\s\S]*?\n\}/
    );
    expect(selectPulseBlock).not.toBeNull();
    expect(selectPulseBlock![0]).toContain("box-shadow");
  });

  it("selected state applies selectPulse with 0.3s duration", () => {
    expect(css).toMatch(/\.selected\s*\{[^}]*animation:\s*selectPulse\s+0\.3s/);
  });

  it("recommended badge is positioned absolute top-right", () => {
    const badgeBlock = css.match(/\.badge\s*\{[^}]*\}/s);
    expect(badgeBlock).not.toBeNull();
    const badge = badgeBlock![0];
    expect(badge).toContain("position: absolute");
    expect(badge).toMatch(/top:\s*var\(--space-xs\)/);
    expect(badge).toMatch(/right:\s*var\(--space-xs\)/);
  });

  it("uses design tokens — no hardcoded hex color values in non-keyframe rules", () => {
    // Remove @keyframes blocks (they need hardcoded rgba for box-shadow)
    const withoutKeyframes = css.replace(
      /@keyframes[\s\S]*?\n\}/g,
      ""
    );
    // Check for stray hex colors (#xxx or #xxxxxx)
    const hexMatches = [...withoutKeyframes.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
    expect(
      hexMatches,
      `Found hardcoded hex colors outside keyframes: ${hexMatches.map((m) => m[0]).join(", ")}`
    ).toHaveLength(0);
  });

  it("references core design tokens via var()", () => {
    const tokens = extractTokenRefs(css);
    const expectedTokens = [
      "--color-panel",
      "--color-panel-border",
      "--font-sans",
      "--transition-fast",
      "--color-wizard-active-border",
      "--color-wizard-active-bg",
      "--color-accent-2",
      "--color-surface",
      "--radius-sm",
      "--radius-circle",
      "--radius-pill",
      "--opacity-disabled"
    ];
    for (const token of expectedTokens) {
      expect(tokens, `Missing token reference: ${token}`).toContain(token);
    }
  });

  it("disabled state uses cursor: not-allowed", () => {
    expect(css).toMatch(/\.disabled\s*\{[^}]*cursor:\s*not-allowed/s);
  });

  it("otherInput has disabled state with opacity and not-allowed cursor", () => {
    expect(css).toMatch(/\.otherInput:disabled\s*\{[^}]*opacity:/s);
    expect(css).toMatch(/\.otherInput:disabled\s*\{[^}]*cursor:\s*not-allowed/s);
  });
});

// ---------------------------------------------------------------------------
// UOptionCard – TSX Component
// ---------------------------------------------------------------------------

describe("UOptionCard TSX component", () => {
  const tsx = readSrc(OPTION_CARD_TSX);

  it("exports the UOptionCard function component", () => {
    expect(tsx).toMatch(/export\s+function\s+UOptionCard/);
  });

  it("exports the UOptionCardProps interface", () => {
    expect(tsx).toMatch(/export\s+interface\s+UOptionCardProps/);
  });

  it("exports OTHER_OPTION_VALUE constant with '__other__' value", () => {
    expect(tsx).toContain('export const OTHER_OPTION_VALUE = "__other__"');
  });

  it("uses role='option' for accessibility", () => {
    expect(tsx).toContain('role="option"');
  });

  it("sets aria-selected based on isSelected prop", () => {
    expect(tsx).toContain("aria-selected={isSelected}");
  });

  it("sets aria-disabled when disabled", () => {
    expect(tsx).toMatch(/aria-disabled=\{disabled/);
  });

  it("sets tabIndex based on disabled state", () => {
    expect(tsx).toMatch(/tabIndex=\{disabled\s*\?\s*-1\s*:\s*0\}/);
  });

  it("renders a recommended badge when isRecommended is true", () => {
    expect(tsx).toContain("isRecommended");
    expect(tsx).toContain('aria-label="Recommended"');
    expect(tsx).toContain("Recommended");
  });

  it("renders free-text input for Other option when selected", () => {
    expect(tsx).toMatch(/isOther\s*&&\s*isSelected/);
    expect(tsx).toContain('aria-label="Other option text"');
    expect(tsx).toContain('placeholder="Type your answer..."');
  });

  it("handles keyboard activation with Space and Enter", () => {
    expect(tsx).toContain('e.key === " "');
    expect(tsx).toContain('e.key === "Enter"');
    expect(tsx).toContain("e.preventDefault()");
  });

  it("prevents card click propagation from input clicks", () => {
    expect(tsx).toContain("e.stopPropagation()");
  });

  it("auto-focuses Other input when selected via useEffect", () => {
    expect(tsx).toContain("inputRef.current.focus()");
  });

  it("guards click handler against disabled state", () => {
    expect(tsx).toMatch(/if\s*\(\s*!disabled\s*\)\s*onSelect/);
  });

  it("guards keyboard handler against disabled state", () => {
    expect(tsx).toMatch(/if\s*\(disabled\)\s*return/);
  });

  it("props interface includes all required fields", () => {
    const requiredProps = [
      "value: string",
      "label: string",
      "isRecommended: boolean",
      "isSelected: boolean",
      'selectionMode: "single" | "multi"',
      "onSelect: (value: string) => void",
      "onOtherText?: (text: string) => void"
    ];
    for (const prop of requiredProps) {
      expect(tsx, `Missing prop: ${prop}`).toContain(prop);
    }
  });

  it("uses radio indicator for single mode and checkbox for multi", () => {
    expect(tsx).toContain("styles.indicatorRadio");
    expect(tsx).toContain("styles.indicatorCheckbox");
    expect(tsx).toMatch(/isRadio\s*\?\s*styles\.indicatorRadio\s*:\s*styles\.indicatorCheckbox/);
  });
});

// ---------------------------------------------------------------------------
// UProgressHeader – CSS Module
// ---------------------------------------------------------------------------

describe("UProgressHeader CSS Module", () => {
  const css = readSrc(PROGRESS_HEADER_CSS);
  const classes = extractCssClasses(css);

  it("defines all required CSS class selectors", () => {
    const required = [
      "root",
      "chips",
      "chip",
      "chipComplete",
      "track",
      "fill",
      "fillComplete"
    ];
    for (const cls of required) {
      expect(classes, `Missing CSS class: .${cls}`).toContain(cls);
    }
  });

  it("progress bar fill has smooth width transition", () => {
    const fillBlock = css.match(/\.fill\s*\{[^}]*\}/s);
    expect(fillBlock).not.toBeNull();
    const fill = fillBlock![0];
    expect(fill).toMatch(/transition:[\s\S]*width\s+\d+ms/);
  });

  it("fill transition uses cubic-bezier easing", () => {
    expect(css).toMatch(/width\s+\d+ms\s+cubic-bezier/);
  });

  it("track has overflow: hidden for progress containment", () => {
    const trackBlock = css.match(/\.track\s*\{[^}]*\}/s);
    expect(trackBlock).not.toBeNull();
    expect(trackBlock![0]).toContain("overflow: hidden");
  });

  it("chipComplete changes color to --color-completed", () => {
    const chipCompleteBlock = css.match(/\.chipComplete\s*\{[^}]*\}/s);
    expect(chipCompleteBlock).not.toBeNull();
    expect(chipCompleteBlock![0]).toContain("var(--color-completed)");
  });

  it("fillComplete changes background to --color-completed", () => {
    const fillCompleteBlock = css.match(/\.fillComplete\s*\{[^}]*\}/s);
    expect(fillCompleteBlock).not.toBeNull();
    expect(fillCompleteBlock![0]).toContain("var(--color-completed)");
  });

  it("uses mono font for stat display", () => {
    expect(css).toContain("var(--font-mono)");
  });

  it("chips use pill border-radius", () => {
    const chipBlock = css.match(/\.chip\s*\{[^}]*\}/s);
    expect(chipBlock).not.toBeNull();
    expect(chipBlock![0]).toContain("var(--radius-pill)");
  });

  it("uses no hardcoded hex colors", () => {
    const hexMatches = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
    expect(
      hexMatches,
      `Found hardcoded hex colors: ${hexMatches.map((m) => m[0]).join(", ")}`
    ).toHaveLength(0);
  });

  it("references core design tokens via var()", () => {
    const tokens = extractTokenRefs(css);
    const expectedTokens = [
      "--space-md",
      "--space-sm",
      "--color-panel",
      "--color-panel-border",
      "--color-border-soft",
      "--color-surface",
      "--color-muted",
      "--color-completed",
      "--color-status-completed-bg",
      "--color-accent-2",
      "--radius-sm",
      "--radius-pill",
      "--font-mono"
    ];
    for (const token of expectedTokens) {
      expect(tokens, `Missing token reference: ${token}`).toContain(token);
    }
  });
});

// ---------------------------------------------------------------------------
// UProgressHeader – TSX Component
// ---------------------------------------------------------------------------

describe("UProgressHeader TSX component", () => {
  const tsx = readSrc(PROGRESS_HEADER_TSX);

  it("exports the UProgressHeader function component", () => {
    expect(tsx).toMatch(/export\s+function\s+UProgressHeader/);
  });

  it("exports the UProgressHeaderProps interface", () => {
    expect(tsx).toMatch(/export\s+interface\s+UProgressHeaderProps/);
  });

  it("props interface includes all required fields", () => {
    const requiredProps = [
      "batchNumber: number",
      "questionsAnswered: number",
      "totalQuestions: number",
      "readinessScore: number"
    ];
    for (const prop of requiredProps) {
      expect(tsx, `Missing prop: ${prop}`).toContain(prop);
    }
  });

  it("uses role='progressbar' for accessibility", () => {
    expect(tsx).toContain('role="progressbar"');
  });

  it("sets aria-valuenow, aria-valuemin, aria-valuemax", () => {
    expect(tsx).toContain("aria-valuenow={clamped}");
    expect(tsx).toContain("aria-valuemin={0}");
    expect(tsx).toContain("aria-valuemax={100}");
  });

  it("sets descriptive aria-label for the progress bar", () => {
    expect(tsx).toMatch(/aria-label=\{.*Readiness.*%.*\}/);
  });

  it("clamps readiness score to 0-100 range", () => {
    expect(tsx).toContain("clamp(readinessScore, 0, 100)");
  });

  it("marks readiness >= 85 as complete", () => {
    expect(tsx).toMatch(/isComplete\s*=\s*clamped\s*>=\s*85/);
  });

  it("renders batch number chip", () => {
    expect(tsx).toMatch(/Batch\s*#\{batchNumber\}/);
  });

  it("renders answered/total chip", () => {
    expect(tsx).toContain("{questionsAnswered}/{totalQuestions} answered");
  });

  it("renders readiness percentage chip", () => {
    expect(tsx).toContain("{clamped}% ready");
  });

  it("applies chipComplete class when isComplete", () => {
    expect(tsx).toContain("isComplete && styles.chipComplete");
  });

  it("applies fillComplete class when isComplete", () => {
    expect(tsx).toContain("isComplete && styles.fillComplete");
  });

  it("sets progress bar width via inline style", () => {
    expect(tsx).toMatch(/style=\{\{\s*width:\s*`\$\{clamped\}%`/);
  });
});

// ---------------------------------------------------------------------------
// Barrel exports (ui.ts)
// ---------------------------------------------------------------------------

describe("Barrel exports (ui.ts)", () => {
  const barrel = readSrc(BARREL_EXPORT);

  it("re-exports UOptionCard component", () => {
    expect(barrel).toMatch(
      /export\s*\{\s*UOptionCard[\s,]/
    );
  });

  it("re-exports OTHER_OPTION_VALUE constant", () => {
    expect(barrel).toContain("OTHER_OPTION_VALUE");
  });

  it("re-exports UOptionCardProps type", () => {
    expect(barrel).toMatch(/export\s+type\s*\{\s*UOptionCardProps\s*\}/);
  });

  it("re-exports UProgressHeader component", () => {
    expect(barrel).toMatch(
      /export\s*\{\s*UProgressHeader\s*\}/
    );
  });

  it("re-exports UProgressHeaderProps type", () => {
    expect(barrel).toMatch(/export\s+type\s*\{\s*UProgressHeaderProps\s*\}/);
  });

  it("imports UOptionCard from the correct path", () => {
    expect(barrel).toContain('./ui/UOptionCard"');
  });

  it("imports UProgressHeader from the correct path", () => {
    expect(barrel).toContain('./ui/UProgressHeader"');
  });
});

// ---------------------------------------------------------------------------
// Cross-component consistency
// ---------------------------------------------------------------------------

describe("Cross-component consistency", () => {
  const optionCardCss = readSrc(OPTION_CARD_CSS);
  const progressCss = readSrc(PROGRESS_HEADER_CSS);

  it("both components use tokens.css custom properties (no @import needed with CSS Modules)", () => {
    // Both should reference design tokens from tokens.css
    const optionTokens = extractTokenRefs(optionCardCss);
    const progressTokens = extractTokenRefs(progressCss);

    // Shared tokens: both should reference the panel/surface layer
    expect(optionTokens).toContain("--color-panel");
    expect(progressTokens).toContain("--color-panel");
    expect(optionTokens).toContain("--color-surface");
    expect(progressTokens).toContain("--color-surface");
  });

  it("both CSS files use cursor: pointer for interactive elements", () => {
    expect(optionCardCss).toContain("cursor: pointer");
    // UProgressHeader is display-only, so it should NOT have cursor: pointer
    expect(progressCss).not.toContain("cursor: pointer");
  });

  it("UOptionCard card uses 2px border (brutalist) and UProgressHeader uses 1px border (compact)", () => {
    // UOptionCard is a primary interactive element — heavier border
    expect(optionCardCss).toMatch(/\.card\s*\{[^}]*border:\s*2px\s+solid/s);
    // UProgressHeader is a compact status bar — lighter border
    expect(progressCss).toMatch(/\.root\s*\{[^}]*border:\s*1px\s+solid/s);
  });
});
