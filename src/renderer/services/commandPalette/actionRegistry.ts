/**
 * Action Registry for the Command Palette.
 *
 * A lightweight, observable registry that holds all searchable commands.
 * Actions can be registered and unregistered dynamically — views can add
 * contextual commands on mount and clean them up on unmount.
 *
 * The registry is a singleton (module-scoped) so it can be imported from
 * anywhere in the renderer without React context, but actions that need
 * React Router navigation should be registered via the useCommandPalette
 * hook which has access to useNavigate().
 */

import type { PaletteAction, PaletteSearchResult } from "./types";
import { fuzzyMatchCommand } from "../fuzzyMatch";

/* ── Listener type ────────────────────────────────────────── */

type RegistryListener = () => void;

/* ── Registry ─────────────────────────────────────────────── */

/** Internal map of id → action. */
const actions = new Map<string, PaletteAction>();

/** Subscribed listeners notified on any mutation. */
const listeners = new Set<RegistryListener>();

/** Notify all listeners that the registry contents changed. */
function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Register a single action. Overwrites any existing action with the same id.
 * Returns an unregister function for cleanup.
 */
export function registerAction(action: PaletteAction): () => void {
  actions.set(action.id, action);
  notify();
  return () => unregisterAction(action.id);
}

/**
 * Register multiple actions at once. Returns a single cleanup function
 * that removes all of them.
 */
export function registerActions(batch: PaletteAction[]): () => void {
  for (const action of batch) {
    actions.set(action.id, action);
  }
  notify();
  return () => {
    for (const action of batch) {
      actions.delete(action.id);
    }
    notify();
  };
}

/** Remove an action by id. No-op if the id is not registered. */
export function unregisterAction(id: string): void {
  if (actions.delete(id)) {
    notify();
  }
}

/** Get a snapshot of all registered actions. */
export function getActions(): PaletteAction[] {
  return Array.from(actions.values());
}

/** Get a single action by id (or undefined). */
export function getAction(id: string): PaletteAction | undefined {
  return actions.get(id);
}

/**
 * Search all registered actions with fuzzy matching.
 *
 * Returns results sorted by score (descending). Actions with score 0
 * (no match) are excluded.
 *
 * When `query` is empty, returns all actions sorted alphabetically
 * by category then label — this is the "browse all" behavior.
 */
export function searchActions(query: string): PaletteSearchResult[] {
  const all = getActions();

  if (query.trim().length === 0) {
    // Browse mode: return all, sorted by category → label
    return all
      .sort((a, b) => {
        const catCmp = a.category.localeCompare(b.category);
        return catCmp !== 0 ? catCmp : a.label.localeCompare(b.label);
      })
      .map((action) => ({ action, score: 1, matchedIndices: [] }));
  }

  const results: PaletteSearchResult[] = [];

  for (const action of all) {
    const match = fuzzyMatchCommand(query, action.label, action.description);
    if (match.score > 0) {
      results.push({
        action,
        score: match.score,
        matchedIndices: match.matchedIndices,
      });
    }
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Subscribe to registry mutations. The listener is called whenever actions
 * are added or removed.
 *
 * Returns an unsubscribe function.
 */
export function subscribe(listener: RegistryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Remove all registered actions and listeners. Useful for testing.
 */
export function resetRegistry(): void {
  actions.clear();
  listeners.clear();
}
