import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { JSX } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { usePlanStore } from "../stores/planStore";
import type { PlanSummary } from "../stores/planStore";
import { UStatusPill, USkeleton, UConfirmModal } from "../components/ui";
import { PlanCreationProgress } from "../components/plan/PlanCreationProgress";
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

/**
 * Simple class name joiner.
 */
function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Types ─────────────────────────────────────────────── */

interface ConfirmState {
  type: "delete" | "archive" | "unarchive";
  planId: string;
  planSummary: string;
}

/* ── Component ─────────────────────────────────────────── */

/**
 * PlanListView -- shows all saved plans as cards with search filtering,
 * archive toggle, and per-card delete/archive actions with confirmation dialogs.
 *
 * Route: /
 *
 * Reads plansList from planStore, displays each plan as a clickable card
 * with summary, status pill, project path, timestamps, and action buttons.
 * Includes a debounced search input (300ms) and an archive toggle.
 */
export function PlanListView(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  /* ── Zustand store selectors ─────────────────────────── */
  const plansList = usePlanStore((s) => s.plansList);
  const loadingList = usePlanStore((s) => s.loadingList);
  const creating = usePlanStore((s) => s.creating);
  const error = usePlanStore((s) => s.error);
  const loadPlanList = usePlanStore((s) => s.loadPlanList);
  const createPlan = usePlanStore((s) => s.createPlan);
  const deletePlan = usePlanStore((s) => s.deletePlan);
  const archivePlan = usePlanStore((s) => s.archivePlan);
  const unarchivePlan = usePlanStore((s) => s.unarchivePlan);

  /* ── Local state ─────────────────────────────────────── */
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);

  /* ── Plan creation from Discovery (location.state.prdText + projectPath) ── */
  const discoveryState = location.state as { prdText?: string; projectPath?: string } | null;
  const incomingPrd = discoveryState?.prdText ?? null;
  const incomingProjectPath = discoveryState?.projectPath?.trim() ?? "";
  const prdConsumedRef = useRef(false);

  useEffect(() => {
    if (incomingPrd && !prdConsumedRef.current && !creating) {
      prdConsumedRef.current = true;
      setCreationError(null);
      void (async () => {
        try {
          const planId = await createPlan(incomingPrd, incomingProjectPath);
          navigate(`/plan/${planId}`, { replace: true });
        } catch (caught) {
          const msg = caught instanceof Error ? caught.message : "Failed to create plan.";
          setCreationError(msg);
        }
      })();
    }
  }, [incomingPrd, incomingProjectPath, creating, createPlan, navigate]);

  /* ── Debounce search input (300ms) ───────────────────── */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  /* ── Load plans on mount and when archive filter changes ── */
  useEffect(() => {
    void loadPlanList({ archived: showArchived ? true : undefined });
  }, [loadPlanList, showArchived]);

  /* ── Filtered list (client-side search on top of server data) ── */
  const filteredPlans = useMemo((): PlanSummary[] => {
    const query = debouncedSearch.trim().toLowerCase();
    if (query.length === 0) return plansList;
    return plansList.filter(
      (plan) =>
        plan.summary.toLowerCase().includes(query) ||
        plan.projectPath.toLowerCase().includes(query)
    );
  }, [plansList, debouncedSearch]);

  /* ── Navigation callback ─────────────────────────────── */
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

  /* ── Action handlers ─────────────────────────────────── */

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, plan: PlanSummary) => {
      e.stopPropagation();
      setConfirmState({ type: "delete", planId: plan.id, planSummary: plan.summary });
    },
    []
  );

  const handleArchiveClick = useCallback(
    (e: React.MouseEvent, plan: PlanSummary) => {
      e.stopPropagation();
      if (plan.archivedAt) {
        setConfirmState({ type: "unarchive", planId: plan.id, planSummary: plan.summary });
      } else {
        setConfirmState({ type: "archive", planId: plan.id, planSummary: plan.summary });
      }
    },
    []
  );

  const handleConfirm = useCallback(async () => {
    if (!confirmState) return;
    setActionLoading(true);
    try {
      if (confirmState.type === "delete") {
        await deletePlan(confirmState.planId);
      } else if (confirmState.type === "archive") {
        await archivePlan(confirmState.planId);
      } else if (confirmState.type === "unarchive") {
        await unarchivePlan(confirmState.planId);
      }
      setConfirmState(null);
    } finally {
      setActionLoading(false);
    }
  }, [confirmState, deletePlan, archivePlan, unarchivePlan]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmState(null);
  }, []);

  /* ── Confirmation dialog content ─────────────────────── */
  const confirmTitle = confirmState
    ? confirmState.type === "delete"
      ? "Delete Plan"
      : confirmState.type === "archive"
        ? "Archive Plan"
        : "Unarchive Plan"
    : "";

  const confirmLabel = confirmState
    ? confirmState.type === "delete"
      ? "Delete"
      : confirmState.type === "archive"
        ? "Archive"
        : "Unarchive"
    : "";

  const confirmVariant: "primary" | "danger" = confirmState?.type === "delete" ? "danger" : "primary";

  /* ── Loading state ───────────────────────────────────── */
  if (loadingList && plansList.length === 0) {
    return (
      <section className={styles.view}>
        <div className={styles.header}>
          <h1 className={styles.title}>Plans</h1>
        </div>
        <div className={styles.skeletonStack}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <div className={styles.skeletonCardHeader}>
                <USkeleton variant="text" width="70%" />
                <USkeleton variant="text" width="60px" height="1.4em" />
              </div>
              <USkeleton variant="text" lines={2} />
              <div className={styles.skeletonCardMeta}>
                <USkeleton variant="text" width="40%" />
                <USkeleton variant="text" width="25%" />
              </div>
            </div>
          ))}
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

  /* ── Main render ─────────────────────────────────────── */
  return (
    <section className={styles.view}>
      <div className={styles.header}>
        <h1 className={styles.title}>Plans</h1>
        <button
          type="button"
          className={styles.createPlanBtn}
          onClick={() => navigate("/discovery")}
        >
          Start Discovery
        </button>
      </div>

      {/* Plan creation progress panel */}
      {creating || creationError ? (
        <PlanCreationProgress active={creating} error={creationError} />
      ) : null}

      {/* Search and filter controls */}
      <div className={styles.controlsRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search plans by summary or path... (Ctrl+F)"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          aria-label="Search plans"
          title="Search plans (Ctrl+F)"
        />

        <button
          type="button"
          className={cn(styles.archiveToggle, showArchived && styles.archiveToggleActive)}
          onClick={() => setShowArchived((prev) => !prev)}
          aria-pressed={showArchived}
          aria-label={showArchived ? "Showing archived plans" : "Show archived plans"}
        >
          {showArchived ? "Showing Archived" : "Show Archived"}
        </button>
      </div>

      {/* Match count when filtering */}
      {debouncedSearch.trim().length > 0 ? (
        <p className={styles.matchCount}>
          {filteredPlans.length} of {plansList.length} plan
          {plansList.length !== 1 ? "s" : ""} matching
        </p>
      ) : null}

      {/* Empty state -- no plans at all */}
      {plansList.length === 0 && !loadingList ? (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>
            {showArchived ? "No archived plans" : "No plans yet"}
          </h3>
          <p className={styles.emptyText}>
            {showArchived
              ? "Archived plans will appear here."
              : "Create a plan by running Discovery or importing PRD text."}
          </p>
          {!showArchived ? (
            <button
              type="button"
              className={styles.emptyActionBtn}
              onClick={() => navigate("/discovery")}
            >
              Start Discovery
            </button>
          ) : null}
        </div>
      ) : null}

      {/* No matches from search */}
      {filteredPlans.length === 0 && debouncedSearch.trim().length > 0 && plansList.length > 0 ? (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>No matching plans</h3>
          <p className={styles.emptyText}>Try a different search term.</p>
        </div>
      ) : null}

      {/* Plan cards grid */}
      <div className={styles.cardGrid}>
        {filteredPlans.map((plan) => (
          <div
            key={plan.id}
            className={cn(styles.planCard, plan.archivedAt && styles.planCardArchived)}
            role="button"
            tabIndex={0}
            onClick={() => handleCardClick(plan.id)}
            onKeyDown={(e) => handleCardKeyDown(plan.id, e)}
            aria-label={`Open plan: ${plan.summary}`}
          >
            <div className={styles.planCardHeader}>
              <p className={styles.planSummary}>{plan.summary}</p>
              <div className={styles.statusRow}>
                <UStatusPill status={plan.status} />
                {plan.archivedAt ? (
                  <span className={styles.archivedBadge}>Archived</span>
                ) : null}
              </div>
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
              <span className={styles.metaItem}>{timeAgo(plan.createdAt)}</span>
            </div>

            {/* Action buttons */}
            <div className={styles.cardActions}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={(e) => handleArchiveClick(e, plan)}
                aria-label={plan.archivedAt ? `Unarchive plan: ${plan.summary}` : `Archive plan: ${plan.summary}`}
              >
                {plan.archivedAt ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                className={cn(styles.actionBtn, styles.actionBtnDanger)}
                onClick={(e) => handleDeleteClick(e, plan)}
                aria-label={`Delete plan: ${plan.summary}`}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Confirmation modal */}
      <UConfirmModal
        open={confirmState !== null}
        onCancel={handleCancelConfirm}
        onConfirm={handleConfirm}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        confirmVariant={confirmVariant}
        loading={actionLoading}
      >
        {confirmState?.type === "delete" ? (
          <p>
            This will permanently delete the plan and all associated tasks, runs, and logs.
            This cannot be undone.
          </p>
        ) : confirmState?.type === "archive" ? (
          <p>
            Archive <strong>{confirmState.planSummary}</strong>? Archived plans are hidden
            from the default view but can be restored at any time.
          </p>
        ) : confirmState?.type === "unarchive" ? (
          <p>
            Restore <strong>{confirmState.planSummary}</strong> from the archive? It will
            appear in the main plans list again.
          </p>
        ) : null}
      </UConfirmModal>
    </section>
  );
}
