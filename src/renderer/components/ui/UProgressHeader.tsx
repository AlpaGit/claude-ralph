import type { JSX } from "react";
import styles from "./UProgressHeader.module.css";

/* ── Public types ──────────────────────────────────────── */

export interface UProgressHeaderProps {
  /** Current round/batch number (1-based). */
  batchNumber: number;
  /** How many questions have been answered in the current batch. */
  questionsAnswered: number;
  /** Total questions in the current batch (typically 3). */
  totalQuestions: number;
  /** Readiness score as a 0-100 percentage. */
  readinessScore: number;
  /** Additional CSS class names appended to the root element. */
  className?: string;
}

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* ── Component ─────────────────────────────────────────── */

export function UProgressHeader({
  batchNumber,
  questionsAnswered,
  totalQuestions,
  readinessScore,
  className,
}: UProgressHeaderProps): JSX.Element {
  const clamped = clamp(readinessScore, 0, 100);
  const isComplete = clamped >= 85;

  return (
    <div className={cn(styles.root, className)}>
      {/* ── Stat chips ──────────────────────────────────── */}
      <div className={styles.chips}>
        <span className={styles.chip}>Batch #{batchNumber}</span>
        <span className={styles.chip}>
          {questionsAnswered}/{totalQuestions} answered
        </span>
        <span className={cn(styles.chip, isComplete && styles.chipComplete)}>{clamped}% ready</span>
      </div>

      {/* ── Progress bar ────────────────────────────────── */}
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Readiness: ${clamped}%`}
      >
        <div
          className={cn(styles.fill, isComplete && styles.fillComplete)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
