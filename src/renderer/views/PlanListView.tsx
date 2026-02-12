import { useEffect, useMemo, useState, useCallback } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { usePlanStore } from "../stores/planStore";
import type { PlanSummary } from "../stores/planStore";
import { UStatusPill, USkeleton } from "../components/ui";
import styles from "./PlanListView.module.css";

/* ── Helpers ───────────────────────────────────────────── */

/**
 * Format an ISO timestamp into a human-readable relative string.
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

/**
 * Format an ISO timestamp into a short localized date string.
 */
function shortDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Truncate a path string for display, showing only the last N segments.
 */
function truncatePath(path: string, segments: number = 2): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= segments) return path;
  return ".../" + parts.slice(-segments).join("/");
}

/* ── Component ─────────────────────────────────────────── */

/**
 * PlanListView -- shows all saved plans as cards with search filtering.
 *
 * Route: /
 *
 * Reads plansList from planStore, displays each plan as a clickable card
 * with summary, status pill, project path, and created date. Includes a
 * search input that filters by summary text (case-insensitive).
 */
export function PlanListView(): JSX.Element {
  const navigate = useNavigate();

  /* ── Zustand store selectors ─────────────────────────── */
  const plansList = usePlanStore((s) => s.plansList);
  const loadingList = usePlanStore((s) => s.loadingList);
  const error = usePlanStore((s) => s.error);
  const loadPlanList = usePlanStore((s) => s.loadPlanList);

  /* ── Local search state ──────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState("");

  /* ── Load plans on mount ─────────────────────────────── */
  useEffect(() => {
    void loadPlanList();
  }, [loadPlanList]);

  /* ── Filtered list ───────────────────────────────────── */
  const filteredPlans = useMemo((): PlanSummary[] => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) return plansList;
    return plansList.filter(
      (plan) =>
        plan.summary.toLowerCase().includes(query) ||
        plan.projectPath.toLowerCase().includes(query)
    );
  }, [plansList, searchQuery]);

  /* ── Callbacks ───────────────────────────────────────── */
  const handleCardClick = useCallback(
    (planId: string) => {
      navigate(`/plan/${planId}`);
    },
    [navigate]
  );

  const handleCardKeyDown = useCallback(
    (planId: string, event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigate(`/plan/${planId}`);
      }
    },
    [navigate]
  );

  /* ── Loading state ───────────────────────────────────── */
  if (loadingList && plansList.length === 0) {
    return (
      <section className={styles.view}>
        <div className={styles.header}>
          <h1 className={styles.title}>Plans</h1>
        </div>
        <div className={styles.skeletonStack}>
          <USkeleton variant="card" height="120px" />
          <USkeleton variant="card" height="120px" />
          <USkeleton variant="card" height="120px" />
        </div>
      </section>
    );
  }

  /* ── Error state ─────────────────────────────────────── */
  if (error && plansList.length === 0) {
    return (
      <section className={styles.view}>
        <div className={styles.header}>
          <h1 className={styles.title}>Plans</h1>
        </div>
        <div className={styles.errorPanel}>
          <p>{error}</p>
        </div>
      </section>
    );
  }

  /* ── Empty state ─────────────────────────────────────── */
  if (plansList.length === 0) {
    return (
      <section className={styles.view}>
        <div className={styles.header}>
          <h1 className={styles.title}>Plans</h1>
        </div>
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>No plans yet</h3>
          <p className={styles.emptyText}>
            Create a plan by running Discovery or importing PRD text.
          </p>
        </div>
      </section>
    );
  }

  /* ── Main render ─────────────────────────────────────── */
  return (
    <section className={styles.view}>
      <div className={styles.header}>
        <h1 className={styles.title}>Plans</h1>
      </div>

      {/* Search input */}
      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search plans by summary or path..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search plans"
        />
      </div>

      {/* Match count when filtering */}
      {searchQuery.trim().length > 0 ? (
        <p className={styles.matchCount}>
          {filteredPlans.length} of {plansList.length} plan
          {plansList.length !== 1 ? "s" : ""} matching
        </p>
      ) : null}

      {/* No matches */}
      {filteredPlans.length === 0 && searchQuery.trim().length > 0 ? (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>No matching plans</h3>
          <p className={styles.emptyText}>
            Try a different search term.
          </p>
        </div>
      ) : null}

      {/* Plan cards grid */}
      <div className={styles.cardGrid}>
        {filteredPlans.map((plan) => (
          <div
            key={plan.id}
            className={styles.planCard}
            role="button"
            tabIndex={0}
            onClick={() => handleCardClick(plan.id)}
            onKeyDown={(e) => handleCardKeyDown(plan.id, e)}
            aria-label={`Open plan: ${plan.summary}`}
          >
            <div className={styles.planCardHeader}>
              <p className={styles.planSummary}>{plan.summary}</p>
              <UStatusPill status={plan.status} />
            </div>

            <div className={styles.planMeta}>
              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Path:</span>
                {truncatePath(plan.projectPath)}
              </span>
              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Created:</span>
                {shortDate(plan.createdAt)}
              </span>
              <span className={styles.metaItem}>
                {timeAgo(plan.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
