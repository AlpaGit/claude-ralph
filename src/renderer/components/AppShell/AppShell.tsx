import { useState, useMemo, useCallback } from "react";
import type { JSX } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { Sidebar } from "../layout/Sidebar";
import {
  useKeyboardShortcuts,
  type ShortcutDefinition,
} from "../../hooks/useKeyboardShortcuts";
import { KeyboardShortcutHelp } from "../KeyboardShortcutHelp/KeyboardShortcutHelp";
import styles from "./AppShell.module.css";

/**
 * AppShell -- layout route that wraps every page with a sidebar and main content area.
 * Used as the root element in the router so all child routes render inside <Outlet />.
 *
 * Includes a thin drag-region strip at the top of the content area so users can
 * drag the window from the content side. The sidebar brand area is also draggable.
 *
 * Mounts the react-hot-toast <Toaster /> provider so toast notifications are
 * available on all routes.
 *
 * Registers global keyboard shortcuts via useKeyboardShortcuts hook.
 * Ctrl+/ or ? opens the keyboard shortcut help dialog.
 */
export function AppShell(): JSX.Element {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);

  /* ── Shortcut handlers ─────────────────────────────────── */

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const handleNewPlanDiscovery = useCallback(() => {
    navigate("/discovery");
  }, [navigate]);

  const handleRunAll = useCallback(async () => {
    const api = window.ralphApi;
    if (!api) return;
    // The "run all" shortcut only makes sense when a plan is loaded.
    // We read the current URL to extract planId if we are on a plan detail page.
    const match = window.location.hash.match(/^#\/plan\/([^/]+)/);
    if (!match) return;
    const planId = match[1];
    try {
      await api.runAll({ planId });
    } catch {
      // Error will be surfaced via toast / plan reload
    }
  }, []);

  const handleEscape = useCallback(() => {
    // If the help dialog is open, the UModal's own Escape handler will close
    // it before this fires (because the modal keydown handler stops
    // propagation). This handler therefore only needs to handle the case
    // where no modal is open.

    // Attempt to cancel the active run by reading the current route.
    const runMatch = window.location.hash.match(/^#\/run\/([^/]+)/);
    if (runMatch) {
      const runId = runMatch[1];
      const api = window.ralphApi;
      if (api) {
        void api.cancelRun({ runId });
      }
    }
  }, []);

  const handleFocusSearch = useCallback(() => {
    // Focus the search input on the plan list page.
    // We look for the search input by its aria-label since CSS module classes
    // are hashed and unreliable for selectors.
    const searchInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search plans"]'
    );
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }, []);

  const handleOpenSettings = useCallback(() => {
    navigate("/settings");
  }, [navigate]);

  /* ── Shortcut definitions ──────────────────────────────── */

  const shortcuts: ShortcutDefinition[] = useMemo(
    () => [
      {
        id: "new-plan",
        key: "n",
        ctrl: true,
        label: "Ctrl+N",
        description: "New plan / Start discovery",
        category: "Navigation",
        preventDefault: true,
        handler: handleNewPlanDiscovery,
      },
      {
        id: "run-all",
        key: "r",
        ctrl: true,
        label: "Ctrl+R",
        description: "Run all tasks (on plan detail page)",
        category: "Actions",
        preventDefault: true,
        handler: () => void handleRunAll(),
      },
      {
        id: "escape",
        key: "Escape",
        label: "Esc",
        description: "Cancel current run / Close modal",
        category: "Actions",
        handler: handleEscape,
      },
      {
        id: "focus-search",
        key: "f",
        ctrl: true,
        label: "Ctrl+F",
        description: "Focus search in plan list",
        category: "Navigation",
        preventDefault: true,
        handler: handleFocusSearch,
      },
      {
        id: "open-settings",
        key: ",",
        ctrl: true,
        label: "Ctrl+,",
        description: "Open settings",
        category: "Navigation",
        preventDefault: true,
        handler: handleOpenSettings,
      },
      {
        id: "help-ctrl-slash",
        key: "/",
        ctrl: true,
        label: "Ctrl+/",
        description: "Show keyboard shortcuts",
        category: "General",
        preventDefault: true,
        handler: openHelp,
      },
      {
        id: "help-question",
        key: "?",
        shift: true,
        label: "?",
        description: "Show keyboard shortcuts",
        category: "General",
        handler: openHelp,
      },
    ],
    [
      handleNewPlanDiscovery,
      handleRunAll,
      handleEscape,
      handleFocusSearch,
      handleOpenSettings,
      openHelp,
    ]
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className={styles.shell}>
      <Sidebar />

      <main className={styles.content}>
        <div className={styles.dragStrip} />
        <div className={styles.contentInner}>
          <Outlet />
        </div>
      </main>

      <Toaster
        position="bottom-right"
        containerStyle={{ zIndex: 10000 }}
        toastOptions={{
          style: {
            background: "#1a1a1a",
            color: "#e6e6e6",
            border: "2px solid #d97706",
            borderRadius: "8px",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: "0.875rem",
            boxShadow: "4px 4px 0 #000",
            padding: "12px 16px",
            maxWidth: "420px",
          },
          success: {
            style: { borderColor: "#15803d" },
            duration: 4000,
          },
          error: {
            style: { borderColor: "#b91c1c" },
            duration: 6000,
          },
          duration: 4000,
        }}
      />

      <KeyboardShortcutHelp
        open={helpOpen}
        onClose={closeHelp}
        shortcuts={shortcuts}
      />
    </div>
  );
}
