import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { USkeleton, UStatusPill } from "../components/ui";
import { useProjectMemoryStore } from "../stores/projectMemoryStore";
import styles from "./ProjectMemoryView.module.css";

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

export function ProjectMemoryView(): JSX.Element {
  const navigate = useNavigate();
  const items = useProjectMemoryStore((s) => s.items);
  const loading = useProjectMemoryStore((s) => s.loading);
  const refreshingProjectId = useProjectMemoryStore((s) => s.refreshingProjectId);
  const error = useProjectMemoryStore((s) => s.error);
  const loadProjectMemory = useProjectMemoryStore((s) => s.loadProjectMemory);
  const refreshStackProfile = useProjectMemoryStore((s) => s.refreshStackProfile);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);

    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    void loadProjectMemory(debouncedSearch);
  }, [loadProjectMemory, debouncedSearch]);

  const hasItems = useMemo(() => items.length > 0, [items.length]);

  return (
    <section className={styles.view}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Project Memory</h1>
          <p className={styles.subtitle}>Stack profile + recent plans per project.</p>
        </div>
      </div>

      <div className={styles.controls}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search by project name or path..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Search project memory"
        />
      </div>

      {error ? <div className={styles.errorPanel}>{error}</div> : null}

      {loading && !hasItems ? (
        <div className={styles.skeletonStack}>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className={styles.skeletonCard}>
              <USkeleton variant="text" width="45%" height="1.2em" />
              <USkeleton variant="text" width="80%" />
              <USkeleton variant="text" lines={2} />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && !hasItems ? (
        <div className={styles.emptyState}>
          <h3>No project memory yet</h3>
          <p>Create a plan or run discovery to populate per-project memory.</p>
        </div>
      ) : null}

      <div className={styles.cardGrid}>
        {items.map((item) => (
          <article key={item.projectId} className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.projectName}>{item.displayName}</h2>
                <p className={styles.projectPath}>{item.projectPath}</p>
              </div>
              <button
                type="button"
                className={styles.refreshButton}
                onClick={() => void refreshStackProfile(item.projectId)}
                disabled={refreshingProjectId === item.projectId}
              >
                {refreshingProjectId === item.projectId ? "Refreshing..." : "Refresh stack profile"}
              </button>
            </div>

            <div className={styles.metaRow}>
              <span>Last stack refresh: {formatDate(item.lastStackRefreshAt)}</span>
              <span>Updated: {formatDate(item.updatedAt)}</span>
            </div>

            <section className={styles.stackSection}>
              <h3>Stack Profile</h3>
              {item.stackProfile ? (
                <>
                  <p className={styles.stackSummary}>{item.stackProfile.stackSummary}</p>
                  <div className={styles.pillRow}>
                    <span className={styles.metaPill}>
                      Confidence {Math.round(item.stackProfile.confidence)}%
                    </span>
                    {item.stackProfile.stackHints.slice(0, 5).map((hint) => (
                      <span key={hint} className={styles.metaPill}>
                        {hint}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className={styles.muted}>No stack profile saved yet.</p>
              )}
            </section>

            <section className={styles.plansSection}>
              <h3>Recent Plans</h3>
              {item.recentPlans.length === 0 ? (
                <p className={styles.muted}>No plans yet for this project.</p>
              ) : (
                <div className={styles.planList}>
                  {item.recentPlans.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      className={styles.planButton}
                      onClick={() => navigate(`/plan/${plan.id}`)}
                    >
                      <span className={styles.planSummary}>{plan.summary}</span>
                      <UStatusPill status={plan.status} className={styles.planStatus} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          </article>
        ))}
      </div>
    </section>
  );
}
