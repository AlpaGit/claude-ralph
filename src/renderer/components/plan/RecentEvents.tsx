import type { JSX } from "react";
import type { RunEvent } from "@shared/types";
import { UCard } from "../ui";
import styles from "./RecentEvents.module.css";

export interface RecentEventsProps {
  /** Array of recent run events, newest first. */
  events: RunEvent[];
}

/**
 * RecentEvents -- displays a scrollable list of the most recent run events
 * for the current plan context.
 *
 * Each row shows timestamp, event type, and associated task ID.
 */
export function RecentEvents({ events }: RecentEventsProps): JSX.Element {
  return (
    <UCard title="Recent Events" className={styles.panel}>
      {events.length > 0 ? (
        <ul className={styles.list}>
          {events.map((event) => (
            <li key={event.id} className={styles.row}>
              <span className={styles.ts}>{formatTs(event.ts)}</span>
              <span className={styles.type}>{event.type}</span>
              <span className={styles.taskId}>{event.taskId}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No events yet.</p>
      )}
    </UCard>
  );
}

/* ── Helpers ───────────────────────────────────────────── */

/**
 * Format an ISO timestamp into a short human-readable form.
 * Falls back to the raw string if Date parsing fails.
 */
function formatTs(ts: string): string {
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return ts;
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}
