/**
 * Unit tests for UQuestionBatch container component (disc-005).
 *
 * Strategy: Integration tests (Playwright E2E) are the preferred tier — the
 * discovery-flow.e2e.ts already exercises UQuestionBatch inside the live
 * Electron app. As a complementary fallback layer, these tests use source-level
 * structural validation (same approach as uoptioncard-uprogressheader.test.ts)
 * to verify:
 *   - Exported public API surface (UQuestionBatch, UQuestionBatchProps)
 *   - CSS Module class selectors match component references
 *   - CSS animation keyframes (slideInLeft) with correct stagger delays
 *   - prefers-reduced-motion media query disables animation
 *   - Skip control per question (skip button + skipped badge)
 *   - Submit Batch button using UButton primary variant
 *   - Accessibility attributes (role="listbox", aria-label)
 *   - Design token compliance (no hardcoded hex colors)
 *   - "Other" free-text fallback integration with UOptionCard
 *   - Empty state rendering
 *   - Selection mode hint rendering (single vs multi)
 *   - Answer count and skipped count display
 *   - QuestionBlock sub-component decomposition (SRP)
 *   - UOptionCard integration (renders per option with selectionMode pass-through)
 *   - parseSelectedOptions JSON array parsing logic
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

const BATCH_TSX = "src/renderer/components/ui/UQuestionBatch.tsx";
const BATCH_CSS = "src/renderer/components/ui/UQuestionBatch.module.css";

// ---------------------------------------------------------------------------
// UQuestionBatch – CSS Module
// ---------------------------------------------------------------------------

describe("UQuestionBatch CSS Module", () => {
  const css = readSrc(BATCH_CSS);
  const classes = extractCssClasses(css);

  it("defines all required CSS class selectors", () => {
    const required = [
      "root",
      "questionItem",
      "questionHeader",
      "questionText",
      "questionNumber",
      "questionReason",
      "selectionHint",
      "optionsGrid",
      "skipRow",
      "skipBtn",
      "skipped",
      "skippedBadge",
      "batchFooter",
      "batchHint",
      "emptyState",
      "emptyText",
    ];
    for (const cls of required) {
      expect(classes, `Missing CSS class: .${cls}`).toContain(cls);
    }
  });

  it("defines @keyframes slideInLeft animation", () => {
    const keyframes = extractKeyframeNames(css);
    expect(keyframes).toContain("slideInLeft");
  });

  it("slideInLeft animates from translateX(30px)+opacity:0 to translateX(0)+opacity:1", () => {
    const slideBlock = css.match(
      /@keyframes slideInLeft\s*\{[\s\S]*?\n\}/
    );
    expect(slideBlock).not.toBeNull();
    const block = slideBlock![0];
    expect(block).toContain("translateX(30px)");
    expect(block).toContain("opacity: 0");
    expect(block).toContain("translateX(0)");
    expect(block).toContain("opacity: 1");
  });

  it("questionItem uses slideInLeft animation with 300ms ease-out", () => {
    const itemBlock = css.match(/\.questionItem\s*\{[^}]*\}/s);
    expect(itemBlock).not.toBeNull();
    expect(itemBlock![0]).toMatch(/animation:\s*slideInLeft\s+300ms\s+ease-out/);
  });

  it("stagger: nth-child(1) has 0ms delay", () => {
    expect(css).toMatch(/\.questionItem:nth-child\(1\)\s*\{[^}]*animation-delay:\s*0ms/s);
  });

  it("stagger: nth-child(2) has 100ms delay", () => {
    expect(css).toMatch(/\.questionItem:nth-child\(2\)\s*\{[^}]*animation-delay:\s*100ms/s);
  });

  it("stagger: nth-child(3) has 200ms delay", () => {
    expect(css).toMatch(/\.questionItem:nth-child\(3\)\s*\{[^}]*animation-delay:\s*200ms/s);
  });

  it("has prefers-reduced-motion media query that disables animation", () => {
    expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    // Inside the media query, questionItem animation should be set to none
    const reducedBlock = css.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\}/
    );
    expect(reducedBlock).not.toBeNull();
    expect(reducedBlock![0]).toContain("animation: none");
  });

  it("skipped state reduces opacity", () => {
    const skippedBlock = css.match(/\.skipped\s*\{[^}]*\}/s);
    expect(skippedBlock).not.toBeNull();
    expect(skippedBlock![0]).toMatch(/opacity:\s*0\.55/);
  });

  it("skipped optionsGrid has pointer-events: none", () => {
    expect(css).toMatch(/\.skipped\s+\.optionsGrid\s*\{[^}]*pointer-events:\s*none/s);
  });

  it("skipBtn has focus-visible outline for accessibility", () => {
    expect(css).toMatch(/\.skipBtn:focus-visible\s*\{[^}]*outline:/s);
  });

  it("skipBtn disabled state has not-allowed cursor", () => {
    expect(css).toMatch(/\.skipBtn:disabled\s*\{[^}]*cursor:\s*not-allowed/s);
  });

  it("batchFooter has dashed border-top separator", () => {
    const footerBlock = css.match(/\.batchFooter\s*\{[^}]*\}/s);
    expect(footerBlock).not.toBeNull();
    expect(footerBlock![0]).toMatch(/border-top:\s*1px\s+dashed/);
  });

  it("emptyState uses dashed border style", () => {
    const emptyBlock = css.match(/\.emptyState\s*\{[^}]*\}/s);
    expect(emptyBlock).not.toBeNull();
    expect(emptyBlock![0]).toMatch(/border:\s*2px\s+dashed/);
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
      "--space-lg",
      "--space-sm",
      "--space-xs",
      "--color-panel",
      "--color-panel-border",
      "--color-muted",
      "--color-text",
      "--color-border-soft",
      "--color-accent-2",
      "--color-surface-warm",
      "--radius-panel",
      "--radius-sm",
      "--radius-pill",
      "--shadow-panel",
      "--font-mono",
      "--transition-fast",
      "--opacity-disabled",
      "--color-border-dashed",
      "--color-status-pending-bg",
    ];
    for (const token of expectedTokens) {
      expect(tokens, `Missing token reference: ${token}`).toContain(token);
    }
  });

  it("questionItem has 2px solid border (brutalist style)", () => {
    const itemBlock = css.match(/\.questionItem\s*\{[^}]*\}/s);
    expect(itemBlock).not.toBeNull();
    expect(itemBlock![0]).toMatch(/border:\s*2px\s+solid/);
  });

  it("questionNumber uses mono font", () => {
    const numberBlock = css.match(/\.questionNumber\s*\{[^}]*\}/s);
    expect(numberBlock).not.toBeNull();
    expect(numberBlock![0]).toContain("var(--font-mono)");
  });

  it("selectionHint uses uppercase transform", () => {
    const hintBlock = css.match(/\.selectionHint\s*\{[^}]*\}/s);
    expect(hintBlock).not.toBeNull();
    expect(hintBlock![0]).toContain("text-transform: uppercase");
  });
});

// ---------------------------------------------------------------------------
// UQuestionBatch – TSX Component
// ---------------------------------------------------------------------------

describe("UQuestionBatch TSX component", () => {
  const tsx = readSrc(BATCH_TSX);

  // ── Exported API ────────────────────────────────────────

  it("exports the UQuestionBatch function component", () => {
    expect(tsx).toMatch(/export\s+function\s+UQuestionBatch/);
  });

  it("exports the UQuestionBatchProps interface", () => {
    expect(tsx).toMatch(/export\s+interface\s+UQuestionBatchProps/);
  });

  it("props interface includes all required fields", () => {
    const requiredProps = [
      "questions: DiscoveryQuestion[]",
      "skippedQuestions: string[]",
      "onAnswer: (questionId: string, answer: string | string[]) => void",
      "onSkip: (questionId: string) => void",
      "onSubmitBatch: () => void",
      "isSubmitting: boolean",
    ];
    for (const prop of requiredProps) {
      expect(tsx, `Missing prop: ${prop}`).toContain(prop);
    }
  });

  it("answers prop uses AnswerMap type from discoveryStore", () => {
    expect(tsx).toMatch(/import\s+type\s*\{\s*AnswerMap\s*\}\s*from/);
    expect(tsx).toContain("answers: AnswerMap");
  });

  // ── Child component integration ────────────────────────

  it("imports UOptionCard and OTHER_OPTION_VALUE from UOptionCard", () => {
    expect(tsx).toMatch(/import\s*\{\s*UOptionCard,\s*OTHER_OPTION_VALUE\s*\}\s*from\s*"\.\/UOptionCard"/);
  });

  it("imports UButton from UButton", () => {
    expect(tsx).toMatch(/import\s*\{\s*UButton\s*\}\s*from\s*"\.\/UButton"/);
  });

  it("renders UOptionCard for each option within questions", () => {
    expect(tsx).toContain("<UOptionCard");
    expect(tsx).toContain("key={opt.value}");
    expect(tsx).toContain("value={opt.value}");
    expect(tsx).toContain("label={opt.label}");
    expect(tsx).toContain("isRecommended={opt.isRecommended}");
    expect(tsx).toContain("selectionMode={question.selectionMode}");
  });

  it("passes disabled state to UOptionCard combining isSkipped and isSubmitting", () => {
    expect(tsx).toContain("disabled={isSkipped || isSubmitting}");
  });

  it("renders UButton with primary variant for submit", () => {
    expect(tsx).toContain('<UButton');
    expect(tsx).toContain('variant="primary"');
    expect(tsx).toContain("onClick={onSubmitBatch}");
  });

  it("UButton shows loading state and disables during submission", () => {
    expect(tsx).toContain("loading={isSubmitting}");
    expect(tsx).toContain("disabled={isSubmitting}");
  });

  it("submit button text changes during submission", () => {
    expect(tsx).toContain("Submit Batch");
    expect(tsx).toContain("Submitting");
  });

  // ── QuestionBlock sub-component (SRP) ──────────────────

  it("defines a private QuestionBlock sub-component for SRP", () => {
    expect(tsx).toMatch(/function\s+QuestionBlock\s*\(/);
    // It should NOT be exported
    expect(tsx).not.toMatch(/export\s+function\s+QuestionBlock/);
  });

  it("QuestionBlock has a typed QuestionBlockProps interface", () => {
    expect(tsx).toMatch(/interface\s+QuestionBlockProps/);
    // Interface should NOT be exported
    expect(tsx).not.toMatch(/export\s+interface\s+QuestionBlockProps/);
  });

  it("renders QuestionBlock for each question via map", () => {
    expect(tsx).toContain("questions.map((question, index)");
    expect(tsx).toContain("<QuestionBlock");
    expect(tsx).toContain("key={question.id}");
  });

  // ── Question header and metadata ───────────────────────

  it("renders question text in the header", () => {
    expect(tsx).toContain("{question.question}");
  });

  it("renders question number badge (Q1, Q2, Q3)", () => {
    expect(tsx).toMatch(/Q\{index\s*\+\s*1\}/);
  });

  it("renders question reason with 'Why this matters' prefix", () => {
    expect(tsx).toContain("Why this matters: {question.reason}");
  });

  it("renders selection mode hint (single vs multi)", () => {
    expect(tsx).toContain("Select one");
    expect(tsx).toContain("Select all that apply");
  });

  // ── Options grid and accessibility ─────────────────────

  it("options grid uses role='listbox' for accessibility", () => {
    expect(tsx).toContain('role="listbox"');
  });

  it("options grid has aria-label set to question text", () => {
    expect(tsx).toContain("aria-label={question.question}");
  });

  it("appends an 'Other' option to the predefined options", () => {
    expect(tsx).toContain("OTHER_OPTION_VALUE");
    expect(tsx).toContain("Other (type your own answer)");
  });

  it("marks recommended option via isRecommended comparison", () => {
    expect(tsx).toContain("opt === question.recommendedOption");
  });

  // ── Skip controls ─────────────────────────────────────

  it("renders skip button per question", () => {
    expect(tsx).toContain("Skip this question");
    expect(tsx).toContain('type="button"');
    expect(tsx).toContain("styles.skipBtn");
  });

  it("skip button calls onSkip with question.id", () => {
    expect(tsx).toMatch(/onSkip\(question\.id\)/);
  });

  it("skip button is disabled during submission", () => {
    expect(tsx).toMatch(/disabled=\{isSubmitting\}/);
  });

  it("shows 'Skipped' badge when question is skipped", () => {
    expect(tsx).toContain("Skipped");
    expect(tsx).toContain("styles.skippedBadge");
  });

  it("applies skipped CSS class when question is skipped", () => {
    expect(tsx).toContain("isSkipped && styles.skipped");
  });

  // ── Batch footer ──────────────────────────────────────

  it("displays answered count in batch footer", () => {
    expect(tsx).toContain("{answeredCount}/{questions.length} answered");
  });

  it("conditionally shows skipped count in batch footer", () => {
    expect(tsx).toMatch(/skippedCount\s*>\s*0/);
    expect(tsx).toContain("skipped");
  });

  // ── Empty state ────────────────────────────────────────

  it("renders empty state when questions array is empty", () => {
    expect(tsx).toMatch(/if\s*\(\s*questions\.length\s*===\s*0\s*\)/);
    expect(tsx).toContain("styles.emptyState");
    expect(tsx).toContain("styles.emptyText");
    expect(tsx).toContain("ready for planning");
  });

  // ── Other/free-text integration ────────────────────────

  it("tracks otherTexts in local component state", () => {
    expect(tsx).toMatch(/useState<Record<string,\s*string>>\s*\(\s*\{\s*\}\s*\)/);
  });

  it("passes onOtherText callback only for Other options", () => {
    expect(tsx).toContain("isOther ? handleOtherText : undefined");
  });

  // ── Multi-select answer parsing ────────────────────────

  it("defines parseSelectedOptions helper for JSON array parsing", () => {
    expect(tsx).toMatch(/function\s+parseSelectedOptions/);
  });

  it("parseSelectedOptions handles JSON-stringified arrays", () => {
    expect(tsx).toContain('raw.startsWith("[")');
    expect(tsx).toContain("JSON.parse(raw)");
    expect(tsx).toContain("Array.isArray(parsed)");
  });

  it("parseSelectedOptions handles empty/undefined input", () => {
    expect(tsx).toMatch(/if\s*\(\s*!raw\s*\|\|\s*raw\.trim\(\)\.length\s*===\s*0\s*\)/);
  });

  it("parseSelectedOptions falls back to single-value array for plain strings", () => {
    expect(tsx).toContain("return [raw]");
  });

  // ── Single-select Other detection ──────────────────────

  it("detects Other selection in single mode by exclusion from options", () => {
    expect(tsx).toContain("!question.options.includes(rawAnswer)");
  });

  // ── Multi-select toggle logic ──────────────────────────

  it("handles multi-select toggle for regular options", () => {
    expect(tsx).toContain("selected.includes(optionValue)");
    expect(tsx).toContain("selected.filter((v) => v !== optionValue)");
    expect(tsx).toContain("[...selected, optionValue]");
  });

  it("handles multi-select toggle for Other option", () => {
    expect(tsx).toContain("[...selected, OTHER_OPTION_VALUE]");
  });

  it("handles Other free-text in multi-select mode with 'other:' prefix", () => {
    expect(tsx).toContain('`other:${text}`');
    expect(tsx).toContain('v.startsWith("other:")');
  });

  // ── Imports ────────────────────────────────────────────

  it("imports DiscoveryQuestion type from shared types", () => {
    expect(tsx).toMatch(/import\s+type\s*\{\s*DiscoveryQuestion\s*\}\s*from\s*"@shared\/types"/);
  });

  it("imports React hooks (useCallback, useMemo, useState)", () => {
    expect(tsx).toContain("useCallback");
    expect(tsx).toContain("useMemo");
    expect(tsx).toContain("useState");
  });
});

// ---------------------------------------------------------------------------
// Cross-component consistency with UOptionCard
// ---------------------------------------------------------------------------

describe("UQuestionBatch ↔ UOptionCard integration", () => {
  const batchTsx = readSrc(BATCH_TSX);
  const batchCss = readSrc(BATCH_CSS);
  const optionCardCss = readSrc("src/renderer/components/ui/UOptionCard.module.css");

  it("both CSS modules reference the same panel token family", () => {
    const batchTokens = extractTokenRefs(batchCss);
    const cardTokens = extractTokenRefs(optionCardCss);
    expect(batchTokens).toContain("--color-panel");
    expect(cardTokens).toContain("--color-panel");
    expect(batchTokens).toContain("--color-panel-border");
    expect(cardTokens).toContain("--color-panel-border");
  });

  it("UQuestionBatch passes all required UOptionCard props", () => {
    // Verify each required UOptionCard prop is provided in the JSX
    const requiredCardProps = [
      "value=",
      "label=",
      "isRecommended=",
      "isSelected=",
      "selectionMode=",
      "onSelect=",
      "disabled=",
    ];
    for (const prop of requiredCardProps) {
      expect(
        batchTsx,
        `UQuestionBatch missing UOptionCard prop: ${prop}`
      ).toContain(prop);
    }
  });

  it("UQuestionBatch uses OTHER_OPTION_VALUE sentinel from UOptionCard", () => {
    // Should import and use the same sentinel, not define its own
    expect(batchTsx).toContain("OTHER_OPTION_VALUE");
    expect(batchTsx).not.toContain('"__other__"'); // Should not redefine it
  });

  it("both CSS modules use the same border weight for panel-level containers", () => {
    // UQuestionBatch questionItem and UOptionCard card both use 2px solid borders
    expect(batchCss).toMatch(/\.questionItem\s*\{[^}]*border:\s*2px\s+solid/s);
    expect(optionCardCss).toMatch(/\.card\s*\{[^}]*border:\s*2px\s+solid/s);
  });
});

// ---------------------------------------------------------------------------
// UQuestionBatch — disabled prop (back-navigation read-only mode)
// ---------------------------------------------------------------------------

describe("UQuestionBatch disabled prop", () => {
  const tsx = readSrc(BATCH_TSX);

  it("props interface includes optional disabled field", () => {
    expect(tsx).toContain("disabled?: boolean");
  });

  it("disabled prop defaults to false in destructuring", () => {
    expect(tsx).toContain("disabled = false");
  });

  it("submit batch footer is hidden when disabled", () => {
    // The footer should be wrapped in !disabled conditional
    expect(tsx).toContain("!disabled");
    expect(tsx).toContain("styles.batchFooter");
  });

  it("disabled state is combined with isSubmitting for QuestionBlock", () => {
    // QuestionBlock's isSubmitting should combine disabled || isSubmitting
    expect(tsx).toContain("isSubmitting={isSubmitting || disabled}");
  });

  it("disabled prop has JSDoc comment explaining its purpose", () => {
    expect(tsx).toMatch(/disabled.*\?.*boolean/);
    expect(tsx).toContain("read-only");
  });
});

// ---------------------------------------------------------------------------
// UQuestionBatch ↔ DiscoveryView integration
// ---------------------------------------------------------------------------

describe("UQuestionBatch ↔ DiscoveryView integration", () => {
  const viewTsx = readSrc("src/renderer/views/DiscoveryView.tsx");

  it("DiscoveryView imports UQuestionBatch", () => {
    expect(viewTsx).toMatch(/import\s*\{\s*UQuestionBatch\s*\}\s*from/);
  });

  it("DiscoveryView renders <UQuestionBatch> with all required props", () => {
    expect(viewTsx).toContain("<UQuestionBatch");
    expect(viewTsx).toContain("questions={");
    expect(viewTsx).toContain("answers={");
    expect(viewTsx).toContain("skippedQuestions={");
    expect(viewTsx).toContain("onAnswer={");
    expect(viewTsx).toContain("onSkip={");
    expect(viewTsx).toContain("onSubmitBatch={");
    expect(viewTsx).toContain("isSubmitting={");
  });

  it("DiscoveryView passes disabled={isViewingPast} to UQuestionBatch", () => {
    expect(viewTsx).toContain("disabled={isViewingPast}");
  });
});
