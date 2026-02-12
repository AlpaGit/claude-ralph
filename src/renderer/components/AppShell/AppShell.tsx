import type { JSX } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "../layout/Sidebar";
import styles from "./AppShell.module.css";

/**
 * AppShell -- layout route that wraps every page with a sidebar and main content area.
 * Used as the root element in the router so all child routes render inside <Outlet />.
 *
 * Includes a thin drag-region strip at the top of the content area so users can
 * drag the window from the content side. The sidebar brand area is also draggable.
 */
export function AppShell(): JSX.Element {
  return (
    <div className={styles.shell}>
      <Sidebar />

      <main className={styles.content}>
        <div className={styles.dragStrip} />
        <div className={styles.contentInner}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
