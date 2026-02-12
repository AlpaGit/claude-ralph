/**
 * Types for the Command Palette action registry.
 *
 * An action represents a single invocable command that can be discovered
 * through the Ctrl+K palette via fuzzy search.
 */

/* ── Action categories ────────────────────────────────────── */

export type ActionCategory = "Navigation" | "Shortcut" | "Action";

/* ── Core action descriptor ───────────────────────────────── */

export interface PaletteAction {
  /** Unique identifier (e.g. "nav:settings", "action:new-plan"). */
  id: string;
  /** Human-readable label shown in search results. */
  label: string;
  /** Short description shown below the label. */
  description: string;
  /** Grouping category for visual sections in the palette UI. */
  category: ActionCategory;
  /**
   * Human-readable shortcut string for display (e.g. "Ctrl+N").
   * Undefined when no keyboard shortcut is bound.
   */
  shortcut?: string;
  /** Callback to invoke when the action is selected. */
  handler: () => void;
}

/* ── Search result with score ─────────────────────────────── */

export interface PaletteSearchResult {
  action: PaletteAction;
  /** Fuzzy-match score — higher is better. */
  score: number;
  /** Character indices in the matched field for highlight rendering. */
  matchedIndices: number[];
}
