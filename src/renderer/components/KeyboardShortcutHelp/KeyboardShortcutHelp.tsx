import type { JSX } from "react";
import { useMemo } from "react";
import { UModal } from "../UModal/UModal";
import type { ShortcutDefinition } from "../../hooks/useKeyboardShortcuts";
import { formatShortcutKeys } from "../../hooks/useKeyboardShortcuts";
import styles from "./KeyboardShortcutHelp.module.css";

/* ── Props ──────────────────────────────────────────────── */

export interface KeyboardShortcutHelpProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Called when the dialog should close. */
  onClose: () => void;
  /** The full list of registered shortcuts to display. */
  shortcuts: ShortcutDefinition[];
}

/* ── Component ──────────────────────────────────────────── */

/**
 * KeyboardShortcutHelp -- a modal dialog that shows all registered keyboard
 * shortcuts grouped by category in a two-column grid.
 *
 * Accessible via Ctrl+/ or the ? key.
 */
export function KeyboardShortcutHelp({
  open,
  onClose,
  shortcuts,
}: KeyboardShortcutHelpProps): JSX.Element | null {
  /** Group shortcuts by category. */
  const groups = useMemo(() => {
    const map = new Map<string, ShortcutDefinition[]>();
    for (const sc of shortcuts) {
      const cat = sc.category ?? "General";
      const list = map.get(cat) ?? [];
      list.push(sc);
      map.set(cat, list);
    }
    return Array.from(map.entries());
  }, [shortcuts]);

  return (
    <UModal
      open={open}
      onClose={onClose}
      title="Keyboard Shortcuts"
      className={styles.dialog}
    >
      <div className={styles.content}>
        {groups.map(([category, items]) => (
          <div key={category} className={styles.group}>
            <h3 className={styles.groupTitle}>{category}</h3>
            <div className={styles.grid} role="list">
              {items.map((sc) => (
                <div key={sc.id} className={styles.row} role="listitem">
                  <kbd className={styles.kbd}>{formatShortcutKeys(sc)}</kbd>
                  <span className={styles.desc}>{sc.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <p className={styles.hint}>
          Press <kbd className={styles.kbdInline}>Esc</kbd> to close this dialog.
        </p>
      </div>
    </UModal>
  );
}
