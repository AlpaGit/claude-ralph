import type { JSX } from "react";
import type { DiscoveryHistoryEntry } from "../../stores/discoveryStore";
import styles from "./UDiscoveryBreadcrumb.module.css";

/* ── Public types ──────────────────────────────────────── */

export interface UDiscoveryBreadcrumbProps {
  /** Completed round snapshots (from discoveryStore.history). */
  history: DiscoveryHistoryEntry[];
  /** The current (latest) round number. */
  currentRound: number;
  /** The current round's readiness score. */
  currentReadinessScore: number;
  /**
   * Which history index is currently being viewed.
   * null means the user is on the current (latest) round.
   */
  viewingHistoryIndex: number | null;
  /** Callback when the user clicks a past round breadcrumb. */
  onNavigateToRound: (historyIndex: number) => void;
  /** Callback when the user clicks the current round breadcrumb (return to latest). */
  onReturnToCurrent: () => void;
  /** Additional CSS class names appended to the root element. */
  className?: string;
}

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Component ─────────────────────────────────────────── */

/**
 * UDiscoveryBreadcrumb -- shows discovery round progression with back-navigation.
 *
 * Renders a horizontal breadcrumb trail: Round 1 > Round 2 > ... > Round N (current).
 * Past rounds are clickable buttons. The active round (either historical or current)
 * is visually highlighted. A "viewing past round" banner appears when navigating back.
 */
export function UDiscoveryBreadcrumb({
  history,
  currentRound,
  currentReadinessScore,
  viewingHistoryIndex,
  onNavigateToRound,
  onReturnToCurrent,
  className,
}: UDiscoveryBreadcrumbProps): JSX.Element | null {
  // Only show breadcrumb when there's history to navigate (at least one past round)
  if (history.length === 0) return null;

  const isViewingPast = viewingHistoryIndex !== null;

  return (
    <nav
      className={cn(styles.root, className)}
      aria-label="Discovery round navigation"
    >
      <div className={styles.trail}>
        {/* Past round crumbs */}
        {history.map((entry, index) => {
          const isActive = viewingHistoryIndex === index;
          return (
            <span key={`round-${entry.round}`} className={styles.crumbGroup}>
              <button
                type="button"
                className={cn(
                  styles.crumb,
                  isActive && styles.crumbActive,
                  !isActive && styles.crumbClickable
                )}
                onClick={() => onNavigateToRound(index)}
                aria-current={isActive ? "step" : undefined}
                title={`Round ${entry.round} — ${entry.readinessScore}% ready`}
              >
                <span className={styles.crumbRound}>R{entry.round}</span>
                <span className={styles.crumbScore}>{entry.readinessScore}%</span>
              </button>
              <span className={styles.separator} aria-hidden="true" />
            </span>
          );
        })}

        {/* Current round crumb */}
        <button
          type="button"
          className={cn(
            styles.crumb,
            styles.crumbCurrent,
            !isViewingPast && styles.crumbActive,
            isViewingPast && styles.crumbClickable
          )}
          onClick={isViewingPast ? onReturnToCurrent : undefined}
          aria-current={!isViewingPast ? "step" : undefined}
          title={`Round ${currentRound} (current) — ${currentReadinessScore}% ready`}
        >
          <span className={styles.crumbRound}>R{currentRound}</span>
          <span className={styles.crumbScore}>{currentReadinessScore}%</span>
          {!isViewingPast ? (
            <span className={styles.currentLabel}>current</span>
          ) : null}
        </button>
      </div>

      {/* Past-round viewing banner */}
      {isViewingPast ? (
        <div className={styles.pastBanner}>
          <span className={styles.pastBannerText}>
            Viewing Round {history[viewingHistoryIndex].round}
          </span>
          <button
            type="button"
            className={styles.returnButton}
            onClick={onReturnToCurrent}
          >
            Return to current
          </button>
        </div>
      ) : null}
    </nav>
  );
}
