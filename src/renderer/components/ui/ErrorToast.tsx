/**
 * ErrorToast -- custom toast renderer for error toasts with expandable IPC error details.
 *
 * Used by toastService.error() when a structured IpcError is provided.
 * Renders a "Details" button that expands to show the full error code,
 * validation issues, and stack trace.
 *
 * Uses react-hot-toast's toast.custom() API, which passes a Toast object
 * to the render function. We read t.visible to drive enter/exit animations.
 */
import { useState, useCallback } from "react";
import toast, { type Toast } from "react-hot-toast";
import type { IpcError } from "@shared/types";
import { hasIpcErrorDetails } from "../../services/ipcErrorService";
import styles from "./ErrorToast.module.css";

export interface ErrorToastProps {
  /** The react-hot-toast Toast instance (provides id and visible state). */
  t: Toast;
  /** Human-readable error summary shown as the main toast text. */
  message: string;
  /** Structured IPC error with optional details for the expandable section. */
  error: IpcError;
}

/**
 * Custom error toast component with collapsible details.
 *
 * Renders:
 * - Error icon + message + dismiss button (always visible)
 * - "Details" toggle button (only when IpcError has details/stack)
 * - Expandable section: error code, validation issues, stack trace
 */
export function ErrorToast({ t, message, error }: ErrorToastProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const showDetails = hasIpcErrorDetails(error);

  const handleDismiss = useCallback(() => {
    toast.dismiss(t.id);
  }, [t.id]);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className={`${styles.toast}${t.visible ? "" : ` ${styles.toastExiting}`}`} role="alert">
      {/* ── Header: icon + message + dismiss ──────────────── */}
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          ❌
        </span>
        <span className={styles.message}>{message}</span>
        <button
          type="button"
          className={styles.dismiss}
          onClick={handleDismiss}
          aria-label="Dismiss error"
        >
          ✕
        </button>
      </div>

      {/* ── Details toggle ────────────────────────────────── */}
      {showDetails ? (
        <>
          <button
            type="button"
            className={styles.detailsToggle}
            onClick={handleToggle}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide error details" : "Show error details"}
          >
            Details
            <span className={`${styles.chevron}${expanded ? ` ${styles.chevronOpen}` : ""}`}>
              &#x25B6;
            </span>
          </button>

          {expanded ? (
            <div className={styles.details}>
              {/* Error code */}
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Code:</span>
                <span className={styles.detailValue}>{error.code}</span>
              </div>

              {/* Full error message (if different from toast summary) */}
              {error.message !== message ? (
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Message:</span>
                  <span className={styles.detailValue}>{error.message}</span>
                </div>
              ) : null}

              {/* Validation issues */}
              {error.details && error.details.length > 0 ? (
                <div className={styles.issuesSection}>
                  <p className={styles.sectionTitle}>Validation Issues</p>
                  <ul className={styles.issueList}>
                    {error.details.map((issue, idx) => (
                      <li key={idx} className={styles.issueItem}>
                        <span className={styles.issuePath}>
                          {issue.path.length > 0 ? issue.path.join(".") : "(root)"}
                        </span>
                        <span className={styles.issueMessage}>{issue.message}</span>
                        {issue.expected ? (
                          <span className={styles.issueMeta}>
                            expected: <strong>{issue.expected}</strong>
                            {issue.received ? (
                              <>
                                {" "}
                                | received: <strong>{issue.received}</strong>
                              </>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Stack trace */}
              {error.stack ? (
                <div className={styles.stackSection}>
                  <p className={styles.sectionTitle}>Stack Trace</p>
                  <pre className={styles.stackTrace}>{error.stack}</pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
