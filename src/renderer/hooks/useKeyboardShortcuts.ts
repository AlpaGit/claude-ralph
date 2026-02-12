import { useEffect, useCallback, useRef } from "react";

/* ── Shortcut definition ────────────────────────────────── */

/**
 * Descriptor for a single keyboard shortcut.
 *
 * Modifiers are optional booleans -- when `true` the modifier must be held,
 * when `false` or `undefined` the modifier must NOT be held.
 */
export interface ShortcutDefinition {
  /** Unique identifier for the shortcut (e.g. "new-plan"). */
  id: string;
  /** The KeyboardEvent.key value to match (case-insensitive comparison). */
  key: string;
  /** Whether Ctrl (or Cmd on macOS) must be held. */
  ctrl?: boolean;
  /** Whether Shift must be held. */
  shift?: boolean;
  /** Whether Alt must be held. */
  alt?: boolean;
  /** Human-readable label for the shortcut (shown in help dialog / tooltips). */
  label: string;
  /** Human-readable description of what the shortcut does. */
  description: string;
  /**
   * Category for grouping in the help dialog.
   * Defaults to "General" if omitted.
   */
  category?: string;
  /**
   * Whether to call event.preventDefault() when matched.
   * Important for shortcuts that collide with browser defaults (Ctrl+N, Ctrl+R, etc.).
   * Defaults to false.
   */
  preventDefault?: boolean;
  /** Callback executed when the shortcut fires. */
  handler: () => void;
}

/* ── Shortcut config ────────────────────────────────────── */

/**
 * Human-readable shortcut key label.
 * Adapts to macOS vs Windows/Linux conventions.
 */
export function formatShortcutKeys(def: ShortcutDefinition): string {
  const isMac = typeof navigator !== "undefined" && /macintosh|mac os x/i.test(navigator.userAgent);

  const parts: string[] = [];
  if (def.ctrl) parts.push(isMac ? "\u2318" : "Ctrl");
  if (def.shift) parts.push(isMac ? "\u21E7" : "Shift");
  if (def.alt) parts.push(isMac ? "\u2325" : "Alt");

  // Prettify common key names
  let keyLabel = def.key;
  switch (def.key.toLowerCase()) {
    case "escape":
      keyLabel = "Esc";
      break;
    case ",":
      keyLabel = ",";
      break;
    case "/":
      keyLabel = "/";
      break;
    case "?":
      keyLabel = "?";
      break;
    default:
      keyLabel = def.key.toUpperCase();
      break;
  }

  parts.push(keyLabel);
  return parts.join(isMac ? "" : "+");
}

/* ── Hook ───────────────────────────────────────────────── */

/**
 * Elements that should suppress global keyboard shortcuts because the user
 * is typing into them.
 */
const INPUT_TAG_NAMES = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isInputFocused(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (INPUT_TAG_NAMES.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Hook that registers a global `keydown` listener on `document` for the
 * provided shortcut definitions.
 *
 * The listener is attached in the capture phase so it fires before any
 * element-level handlers. Shortcuts are skipped when the active element is
 * an input, textarea, select, or contentEditable (unless the shortcut
 * explicitly requires Ctrl, in which case it fires anyway since Ctrl+key
 * combos are not normal typing sequences).
 *
 * @param shortcuts  Array of shortcut definitions to listen for.
 * @param enabled    Pass `false` to temporarily disable all shortcuts.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[], enabled = true): void {
  // Keep a stable ref to the latest shortcuts to avoid re-registering the
  // listener every time a handler function reference changes.
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      for (const def of shortcutsRef.current) {
        const ctrlMatch = def.ctrl
          ? event.ctrlKey || event.metaKey
          : !event.ctrlKey && !event.metaKey;
        const shiftMatch = def.shift ? event.shiftKey : !event.shiftKey;
        const altMatch = def.alt ? event.altKey : !event.altKey;

        if (!ctrlMatch || !shiftMatch || !altMatch) continue;

        // Case-insensitive key comparison (handles Shift producing "?" from "/")
        if (event.key.toLowerCase() !== def.key.toLowerCase()) continue;

        // Skip when typing in inputs UNLESS the shortcut requires Ctrl/Meta
        // (Ctrl+key combos are never normal text entry).
        if (!def.ctrl && isInputFocused(event)) continue;

        if (def.preventDefault) {
          event.preventDefault();
        }

        event.stopPropagation();
        def.handler();
        return; // Only fire the first matching shortcut
      }
    },
    [], // stable -- reads from ref
  );

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("keydown", handleKeyDown, true); // capture phase
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handleKeyDown, enabled]);
}
