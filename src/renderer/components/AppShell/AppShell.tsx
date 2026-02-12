import type { JSX } from "react";
import { NavLink, Outlet } from "react-router-dom";
import styles from "./AppShell.module.css";

/** Navigation entry rendered in the sidebar. */
interface NavItem {
  to: string;
  label: string;
  /** End prop for NavLink -- true means exact match only. */
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Plans", end: true },
  { to: "/discovery", label: "Discovery" },
  { to: "/settings", label: "Settings" },
];

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * AppShell -- layout route that wraps every page with a sidebar and main content area.
 * Used as the root element in the router so all child routes render inside <Outlet />.
 */
export function AppShell(): JSX.Element {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandBadge}>RALPH</span>
          <span className={styles.brandTitle}>Orchestrator</span>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(styles.navLink, isActive && styles.navLinkActive)
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
