import { useState } from "react";
import type { IpcError } from "@shared/types";
import { hasIpcErrorDetails } from "../../services/ipcErrorService";
import styles from "./IpcErrorDetails.module.css";

export interface IpcErrorDetailsProps {
  /** The structured IPC error to display. */
  error: IpcError;
  /** Optional class name for the outer container. */
  className?: string;
}

/**
 * Collapsible error details panel for IPC errors.
 *
 * Shows the error message at all times. When the error includes
 * developer-mode details (Zod validation issues, stack traces),
 * renders a collapsible section that can be toggled open.
 */
export function IpcErrorDetails({ error, className }: IpcErrorDetailsProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = hasIpcErrorDetails(error);

  return (
    <div className={`${styles.container}${className ? ` ${className}` : ""}`}>
      <div className={styles.header}>
        <span className={styles.code}>[{error.code}]</span>
        <span className={styles.message}>{error.message}</span>
      </div>

      {hasDetails ? (
        <>
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide error details" : "Show error details"}
          >
            {expanded ? "Hide Details" : "Show Details"}
            <span className={`${styles.chevron}${expanded ? ` ${styles.chevronOpen}` : ""}`}>
              &#x25B6;
            </span>
          </button>

          {expanded ? (
            <div className={styles.details}>
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
                        {issue.code ? <span className={styles.issueCode}>{issue.code}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

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
