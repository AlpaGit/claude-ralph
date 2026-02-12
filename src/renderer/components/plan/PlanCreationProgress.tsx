import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import styles from "./PlanCreationProgress.module.css";

/* ── Phases ───────────────────────────────────────────── */

/**
 * Phase definitions for plan creation progress.
 * Each phase has a label, description, and a threshold in seconds
 * at which it is considered to have started.
 */
interface Phase {
  label: string;
  description: string;
  /** Seconds elapsed before this phase begins. */
  startsAtSec: number;
}

const PHASES: Phase[] = [
  {
    label: "Initializing",
    description: "Setting up the planning engine and parsing PRD input...",
    startsAtSec: 0,
  },
  {
    label: "Analyzing PRD",
    description: "Reading and understanding the project requirements document...",
    startsAtSec: 3,
  },
  {
    label: "Generating Technical Pack",
    description: "Identifying architecture, risks, dependencies, and test strategy...",
    startsAtSec: 10,
  },
  {
    label: "Building Checklist",
    description: "Creating ordered task checklist with acceptance criteria...",
    startsAtSec: 20,
  },
  {
    label: "Finalizing Plan",
    description: "Validating dependencies and writing plan to database...",
    startsAtSec: 35,
  },
];

/** Expected total duration in seconds (used for progress bar estimation). */
const EXPECTED_DURATION_SEC = 45;

/* ── Helpers ──────────────────────────────────────────── */

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/* ── Props ────────────────────────────────────────────── */

export interface PlanCreationProgressProps {
  /** Whether plan creation is currently in progress. */
  active: boolean;
  /** Optional error message to display if creation fails. */
  error?: string | null;
}

/* ── Component ────────────────────────────────────────── */

/**
 * PlanCreationProgress -- rich progress panel shown during the 30-60s plan
 * creation operation. Displays elapsed time, inferred current phase, and
 * an animated progress bar.
 *
 * Replaces simple "Creating plan..." text with actionable progress info.
 */
export function PlanCreationProgress({
  active,
  error,
}: PlanCreationProgressProps): JSX.Element | null {
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  /* Reset timer when active transitions from false to true */
  useEffect(() => {
    if (active) {
      setStartedAtMs(Date.now());
      setElapsedSec(0);
    } else {
      setStartedAtMs(null);
    }
  }, [active]);

  /* Tick every second while active */
  useEffect(() => {
    if (!active || startedAtMs === null) return;

    const interval = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtMs) / 1000));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [active, startedAtMs]);

  /* Current phase based on elapsed time */
  const currentPhase = useMemo((): Phase => {
    for (let i = PHASES.length - 1; i >= 0; i--) {
      if (elapsedSec >= PHASES[i].startsAtSec) {
        return PHASES[i];
      }
    }
    return PHASES[0];
  }, [elapsedSec]);

  /* Phase index for the step dots */
  const currentPhaseIndex = useMemo(() => {
    for (let i = PHASES.length - 1; i >= 0; i--) {
      if (elapsedSec >= PHASES[i].startsAtSec) return i;
    }
    return 0;
  }, [elapsedSec]);

  /* Progress percentage (capped at 95% -- only reaches 100% on completion) */
  const progressPct = useMemo(() => {
    if (!active) return 100;
    const raw = Math.min(95, (elapsedSec / EXPECTED_DURATION_SEC) * 100);
    return Math.round(raw);
  }, [active, elapsedSec]);

  if (!active && !error) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          {error ? "Plan Creation Failed" : "Creating Plan"}
        </h3>
        <span className={styles.elapsed}>{formatElapsed(elapsedSec)}</span>
      </div>

      {error ? (
        <p className={styles.errorText}>{error}</p>
      ) : (
        <>
          {/* Progress bar */}
          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Plan creation progress"
            />
          </div>

          {/* Phase steps */}
          <div className={styles.phaseSteps}>
            {PHASES.map((phase, idx) => (
              <div
                key={phase.label}
                className={[
                  styles.phaseStep,
                  idx < currentPhaseIndex
                    ? styles.phaseStepDone
                    : idx === currentPhaseIndex
                      ? styles.phaseStepActive
                      : styles.phaseStepPending,
                ].join(" ")}
              >
                <span className={styles.phaseDot} />
                <span className={styles.phaseLabel}>{phase.label}</span>
              </div>
            ))}
          </div>

          {/* Current phase description */}
          <p className={styles.phaseDescription}>
            {currentPhase.description}
          </p>
        </>
      )}
    </div>
  );
}
