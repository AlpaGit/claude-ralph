import type { CSSProperties, JSX } from "react";
import styles from "./UStatusPill.module.css";

/**
 * Automatic color mapping for known plan / task / run status values.
 *
 * pending   = #6b7280  (gray)
 * in_progress = #d97706  (amber)
 * completed = #15803d  (green)
 * failed    = #b91c1c  (red)
 * cancelled = #6b7280  (gray)
 * draft     = #6b7280  (gray)
 * ready     = #156f67  (teal)
 * running   = #d97706  (amber)
 * queued    = #6b7280  (gray)
 */
const STATUS_COLOR_MAP: Record<string, string> = {
  pending: "#6b7280",
  in_progress: "#d97706",
  completed: "#15803d",
  failed: "#b91c1c",
  cancelled: "#6b7280",
  draft: "#6b7280",
  ready: "#156f67",
  running: "#d97706",
  queued: "#6b7280",
  skipped: "#9333ea"
};

const STATUS_BG_MAP: Record<string, string> = {
  pending: "#eceff1",
  in_progress: "#fde68a",
  completed: "#bbf7d0",
  failed: "#fecaca",
  cancelled: "#dbeafe",
  draft: "#eceff1",
  ready: "#d1faf0",
  running: "#fde68a",
  queued: "#eceff1",
  skipped: "#f3e8ff"
};

export interface UStatusPillProps {
  /** The status value to display (e.g. "pending", "completed"). */
  status: string;
  /** Optional label override. Defaults to the status string with underscores replaced by spaces. */
  label?: string;
  /** Show a small colored dot before the label. Defaults to true. */
  showDot?: boolean;
  /** Additional CSS class names appended to the root element. */
  className?: string;
}

export function UStatusPill({
  status,
  label,
  showDot = true,
  className
}: UStatusPillProps): JSX.Element {
  const normalizedStatus = status.toLowerCase().trim();
  const color = STATUS_COLOR_MAP[normalizedStatus] ?? "#6b7280";
  const bg = STATUS_BG_MAP[normalizedStatus] ?? "#eceff1";
  const displayLabel = label ?? normalizedStatus.replace(/_/g, " ");

  const rootClass = className ? `${styles.pill} ${className}` : styles.pill;

  const cssVars: CSSProperties = {
    "--pill-color": color,
    "--pill-bg": bg
  } as CSSProperties;

  return (
    <span className={rootClass} style={cssVars}>
      {showDot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {displayLabel}
    </span>
  );
}
