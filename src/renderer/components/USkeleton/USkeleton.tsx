import type { CSSProperties, JSX } from "react";
import styles from "./USkeleton.module.css";

/* ── Public types ──────────────────────────────────────── */

export type USkeletonVariant = "text" | "card" | "circle";

export interface USkeletonProps {
  /** Shape variant. Defaults to "text". */
  variant?: USkeletonVariant;
  /** Override width (CSS value, e.g. "80%" or "200px"). */
  width?: string | number;
  /** Override height (CSS value, e.g. "1.2em" or "120px"). */
  height?: string | number;
  /** Number of skeleton lines to render (only applies to "text" variant). Defaults to 1. */
  lines?: number;
  /** Gap between skeleton lines (CSS value). Defaults to "0.55rem". */
  lineGap?: string;
  /** Additional CSS class name appended to the root element. */
  className?: string;
  /** Additional inline styles applied to the root element. */
  style?: CSSProperties;
}

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Component ─────────────────────────────────────────── */

export function USkeleton({
  variant = "text",
  width,
  height,
  lines = 1,
  lineGap = "0.55rem",
  className,
  style,
}: USkeletonProps): JSX.Element {
  const baseClass = cn(styles.skeleton, styles[variant], className);

  const overrideStyle: CSSProperties = {
    ...style,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };

  /* Render multiple lines for the "text" variant when lines > 1 */
  if (variant === "text" && lines > 1) {
    return (
      <div
        role="status"
        aria-label="Loading"
        style={{ display: "flex", flexDirection: "column", gap: lineGap }}
      >
        {Array.from({ length: lines }, (_, i) => {
          /* Make the last line shorter for a natural look */
          const isLast = i === lines - 1;
          const lineStyle: CSSProperties = {
            ...overrideStyle,
            ...(isLast && width === undefined ? { width: "65%" } : {}),
          };
          return (
            <span
              key={i}
              className={baseClass}
              style={lineStyle}
              aria-hidden="true"
            />
          );
        })}
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  return (
    <span
      className={baseClass}
      style={overrideStyle}
      role="status"
      aria-label="Loading"
    />
  );
}
