import { useState, useCallback, useEffect } from "react";
import type { JSX } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { usePlanStore } from "../../stores/planStore";
import type { PlanSummary } from "../../stores/planStore";
import { UStatusPill } from "../UStatusPill/UStatusPill";
import styles from "./Sidebar.module.css";

/* ── Helpers ─────────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Truncate a string to `max` characters, appending ellipsis if trimmed. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "\u2026";
}

/**
 * Format an ISO timestamp into a relative "time ago" string.
 * Keeps things simple: seconds, minutes, hours, days, weeks, months.
 */
function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return "";

  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/* ── Navigation items ────────────────────────────────────── */

interface NavItem {
  to: string;
  label: string;
  /** End prop for NavLink -- true means exact match only. */
  end?: boolean;
  /** Keyboard shortcut hint shown in tooltip. */
  shortcutHint?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Plans", end: true },
  { to: "/discovery", label: "Discovery", shortcutHint: "Ctrl+N" },
  { to: "/settings", label: "Settings", shortcutHint: "Ctrl+," },
];

/* ── PlanListItem ────────────────────────────────────────── */

interface PlanListItemProps {
  plan: PlanSummary;
  collapsed: boolean;
}

function PlanListItem({ plan, collapsed }: PlanListItemProps): JSX.Element {
  if (collapsed) {
    return (
      <NavLink
        to={`/plan/${plan.id}`}
        className={({ isActive }) =>
          cn(styles.planItem, styles.planItemCollapsed, isActive && styles.planItemActive)
        }
        title={plan.summary}
      >
        <UStatusPill status={plan.status} showDot label="" className={styles.planDotOnly} />
      </NavLink>
    );
  }

  return (
    <NavLink
      to={`/plan/${plan.id}`}
      className={({ isActive }) =>
        cn(styles.planItem, isActive && styles.planItemActive)
      }
    >
      <span className={styles.planSummary}>{truncate(plan.summary, 40)}</span>
      <span className={styles.planMeta}>
        <UStatusPill status={plan.status} className={styles.planPill} />
        <span className={styles.planTime}>{timeAgo(plan.createdAt)}</span>
      </span>
    </NavLink>
  );
}

/* ── Sidebar ─────────────────────────────────────────────── */

export interface SidebarProps {
  /** Additional CSS class names appended to the root element. */
  className?: string;
}

/**
 * Sidebar -- primary navigation for the app.
 *
 * Shows:
 * - App logo / title at top
 * - Navigation links (Plans, Discovery, Settings)
 * - Collapsible plan list below the Plans link showing recent plans with status pills
 * - "New Plan" button
 * - Collapse / expand toggle
 *
 * Reads from planStore.plansList for the plan list.
 * Width: ~280px expanded, ~60px collapsed.
 */
export function Sidebar({ className }: SidebarProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [planListOpen, setPlanListOpen] = useState(true);
  const navigate = useNavigate();

  const plansList = usePlanStore((s) => s.plansList);
  const loadPlanList = usePlanStore((s) => s.loadPlanList);

  // Load plans on mount.
  useEffect(() => {
    void loadPlanList();
  }, [loadPlanList]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const togglePlanList = useCallback(() => {
    setPlanListOpen((prev) => !prev);
  }, []);

  const handleNewPlan = useCallback(() => {
    navigate("/");
  }, [navigate]);

  return (
    <aside
      className={cn(
        styles.sidebar,
        collapsed && styles.sidebarCollapsed,
        className
      )}
    >
      {/* ── Brand ──────────────────────────────────────────── */}
      <div className={styles.brand}>
        <span className={styles.brandBadge}>R</span>
        {!collapsed && <span className={styles.brandTitle}>Ralph</span>}
      </div>

      {/* ── Navigation links ───────────────────────────────── */}
      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <div key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(styles.navLink, isActive && styles.navLinkActive)
              }
              title={
                collapsed
                  ? item.shortcutHint
                    ? `${item.label} (${item.shortcutHint})`
                    : item.label
                  : item.shortcutHint
                    ? `${item.label} (${item.shortcutHint})`
                    : undefined
              }
            >
              <span className={styles.navIcon}>{item.label.charAt(0)}</span>
              {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
            </NavLink>

            {/* ── Plan list (below Plans link) ─────────────── */}
            {item.label === "Plans" && !collapsed && plansList.length > 0 && (
              <div className={styles.planSection}>
                <button
                  type="button"
                  className={styles.planToggle}
                  onClick={togglePlanList}
                  aria-expanded={planListOpen}
                  aria-label={planListOpen ? "Collapse plan list" : "Expand plan list"}
                >
                  <span
                    className={cn(
                      styles.planChevron,
                      planListOpen && styles.planChevronOpen
                    )}
                    aria-hidden="true"
                  >
                    {"\u25B6"}
                  </span>
                  <span className={styles.planToggleLabel}>
                    Recent Plans ({plansList.length})
                  </span>
                </button>

                {planListOpen && (
                  <div className={styles.planList} role="list">
                    {plansList.map((plan) => (
                      <PlanListItem
                        key={plan.id}
                        plan={plan}
                        collapsed={collapsed}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Collapsed plan dots */}
            {item.label === "Plans" && collapsed && plansList.length > 0 && (
              <div className={styles.planListCollapsed}>
                {plansList.slice(0, 5).map((plan) => (
                  <PlanListItem
                    key={plan.id}
                    plan={plan}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* ── Spacer ─────────────────────────────────────────── */}
      <div className={styles.spacer} />

      {/* ── New Plan button ────────────────────────────────── */}
      <button
        type="button"
        className={styles.newPlanBtn}
        onClick={handleNewPlan}
        title={collapsed ? "New Plan (Ctrl+N)" : "New Plan (Ctrl+N)"}
      >
        <span className={styles.newPlanIcon} aria-hidden="true">+</span>
        {!collapsed && <span>New Plan</span>}
      </button>

      {/* ── Collapse toggle ────────────────────────────────── */}
      <button
        type="button"
        className={styles.collapseBtn}
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span
          className={cn(
            styles.collapseIcon,
            collapsed && styles.collapseIconFlipped
          )}
          aria-hidden="true"
        >
          {"\u00AB"}
        </span>
      </button>
    </aside>
  );
}
