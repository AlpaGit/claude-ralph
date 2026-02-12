import type { JSX } from "react";
import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { Sidebar } from "../layout/Sidebar";
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

      <Toaster
        position="bottom-right"
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
    </div>
  );
}
