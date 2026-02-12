/**
 * React hook that registers the default navigation + app actions into the
 * command palette action registry.
 *
 * Must be called inside a React Router context (needs useNavigate).
 * Typically mounted once in AppShell.
 *
 * Also exposes a `useRegisterActions` hook for views to add contextual
 * actions that are cleaned up on unmount.
 */

import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { registerActions, registerAction } from "./actionRegistry";
import { focusPlanSearchInput } from "../domHelpers";
import { usePlanStore } from "../../stores/planStore";
import type { PaletteAction, ActionCategory } from "./types";

/* ── Default actions (registered once in AppShell) ────────── */

/**
 * Registers the core set of navigation, shortcut, and app actions.
 * Returns a cleanup function that removes them all.
 *
 * Call this from AppShell so navigation callbacks have access to
 * the router context.
 */
export function useDefaultActions(): void {
  const navigate = useNavigate();

  const actions: PaletteAction[] = useMemo(
    () => [
      /* ── Navigation ─────────────────────────────────────── */
      {
        id: "nav:plans",
        label: "Go to Plans",
        description: "View all plans",
        category: "Navigation" as ActionCategory,
        handler: () => navigate("/"),
      },
      {
        id: "nav:discovery",
        label: "Go to Discovery",
        description: "Start a new plan or continue a discovery session",
        category: "Navigation" as ActionCategory,
        shortcut: "Ctrl+N",
        handler: () => navigate("/discovery"),
      },
      {
        id: "nav:project-memory",
        label: "Go to Project Memory",
        description: "View and manage project memory entries",
        category: "Navigation" as ActionCategory,
        handler: () => navigate("/project-memory"),
      },
      {
        id: "nav:settings",
        label: "Go to Settings",
        description: "Configure app settings and model preferences",
        category: "Navigation" as ActionCategory,
        shortcut: "Ctrl+,",
        handler: () => navigate("/settings"),
      },

      /* ── Shortcuts (mirror existing keyboard shortcuts) ── */
      {
        id: "shortcut:focus-search",
        label: "Focus Search",
        description: "Focus the plan search input",
        category: "Shortcut" as ActionCategory,
        shortcut: "Ctrl+F",
        handler: focusPlanSearchInput,
      },
      {
        id: "shortcut:keyboard-help",
        label: "Keyboard Shortcuts",
        description: "Show all keyboard shortcuts",
        category: "Shortcut" as ActionCategory,
        shortcut: "Ctrl+/",
        // TODO: This dispatches a synthetic KeyboardEvent to trigger AppShell's
        // capture-phase Ctrl+/ handler. This implicit coupling should be replaced
        // with a shared callback or lifted state when the palette UI is integrated
        // into AppShell (next task).
        handler: () => {
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "/",
              ctrlKey: true,
              bubbles: true,
            })
          );
        },
      },

      /* ── App actions ────────────────────────────────────── */
      {
        id: "action:refresh-plans",
        label: "Refresh Plans",
        description: "Reload the plan list from the database",
        category: "Action" as ActionCategory,
        handler: () => {
          void usePlanStore.getState().loadPlanList();
        },
      },
    ],
    [navigate]
  );

  useEffect(() => {
    return registerActions(actions);
  }, [actions]);
}

/* ── Dynamic registration hook for views ──────────────────── */

/**
 * Hook for views to register contextual actions that are automatically
 * cleaned up when the component unmounts.
 *
 * @example
 * ```tsx
 * useRegisterActions([
 *   { id: "plan:run-all", label: "Run All Tasks", ... }
 * ]);
 * ```
 */
export function useRegisterActions(actions: PaletteAction[]): void {
  useEffect(() => {
    if (actions.length === 0) return;
    return registerActions(actions);
  }, [actions]);
}

/**
 * Hook for views to register a single contextual action.
 * Cleaned up on unmount or when the action changes.
 */
export function useRegisterAction(action: PaletteAction | null): void {
  useEffect(() => {
    if (!action) return;
    return registerAction(action);
  }, [action]);
}
