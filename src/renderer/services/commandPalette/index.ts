/**
 * Command Palette — public API.
 *
 * Re-exports types, the action registry, and React hooks so consumers can
 * import everything from a single path:
 *
 * ```ts
 * import { searchActions, useDefaultActions, type PaletteAction } from "../services/commandPalette";
 * ```
 */

/* ── Types ────────────────────────────────────────────────── */
export type {
  PaletteAction,
  PaletteSearchResult,
  ActionCategory,
} from "./types";

/* ── Registry ─────────────────────────────────────────────── */
export {
  registerAction,
  registerActions,
  unregisterAction,
  getActions,
  getAction,
  searchActions,
  subscribe,
  resetRegistry,
} from "./actionRegistry";

/* ── React hooks ──────────────────────────────────────────── */
export {
  useDefaultActions,
  useRegisterActions,
  useRegisterAction,
} from "./useCommandActions";
