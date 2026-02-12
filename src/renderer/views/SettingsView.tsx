import { useEffect } from "react";
import type { JSX } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import type { ModelRole } from "../stores/settingsStore";
import { UCard, USkeleton } from "../components/ui";
import styles from "./SettingsView.module.css";

/**
 * Ordered list of model roles for display in the configuration table.
 */
const MODEL_ROLES: readonly ModelRole[] = [
  "planning",
  "discovery",
  "execution",
  "wizard",
] as const;

/**
 * Human-readable descriptions for each role.
 */
const ROLE_DESCRIPTIONS: Record<ModelRole, string> = {
  planning: "Generates structured plans from PRD input",
  discovery: "Conducts project interviews and context gathering",
  execution: "Executes individual tasks within a plan",
  wizard: "Provides step-by-step guidance and recommendations",
};

/**
 * Hardcoded version info.
 *
 * In Phase 2 these will be read from electron app.getVersion() via IPC.
 * For now, values are hardcoded from package.json.
 */
const APP_VERSION = "0.1.0";
const ELECTRON_VERSION = "33.x";
const NODE_VERSION = "20.x";
const CHROME_VERSION = "130.x";

/* ── Component ─────────────────────────────────────────── */

/**
 * SettingsView -- model configuration, application preferences, and about info.
 *
 * Route: /settings
 *
 * Reads model configuration from settingsStore. For Phase 1, all model config
 * values are read-only defaults. Full editing support comes in Phase 2.
 */
export function SettingsView(): JSX.Element {
  /* ── Zustand store selectors ─────────────────────────── */
  const modelConfig = useSettingsStore((s) => s.modelConfig);
  const loading = useSettingsStore((s) => s.loading);
  const error = useSettingsStore((s) => s.error);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  /* ── Load settings on mount ──────────────────────────── */
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return (
    <section className={styles.view}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </div>

      <div className={styles.sections}>
        {/* ── Model Configuration ─────────────────────── */}
        <UCard
          title="Model Configuration"
          subtitle="Agent role to model mapping (read-only in Phase 1)"
        >
          {loading ? (
            <div className={styles.loadingRow}>
              <USkeleton variant="text" lines={4} />
            </div>
          ) : error ? (
            <div className={styles.errorPanel}>
              <p>{error}</p>
            </div>
          ) : (
            <table className={styles.modelTable}>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Description</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_ROLES.map((role) => {
                  const config = modelConfig[role];
                  return (
                    <tr key={role}>
                      <td className={styles.roleCell}>{role}</td>
                      <td>{ROLE_DESCRIPTIONS[role]}</td>
                      <td className={styles.modelCell}>
                        {config.modelId}
                        <span className={styles.readOnlyHint}>(default)</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </UCard>

        {/* ── Application Preferences ─────────────────── */}
        <UCard
          title="Application Preferences"
          subtitle="Customization options (coming soon)"
        >
          <p className={styles.placeholderText}>
            Application preferences such as theme selection, notification settings,
            and default project paths will be available in a future release.
          </p>
        </UCard>

        {/* ── About ───────────────────────────────────── */}
        <UCard title="About">
          <div className={styles.aboutGrid}>
            <span className={styles.aboutLabel}>App Version</span>
            <span className={styles.aboutValue}>{APP_VERSION}</span>

            <span className={styles.aboutLabel}>Electron</span>
            <span className={styles.aboutValue}>{ELECTRON_VERSION}</span>

            <span className={styles.aboutLabel}>Node.js</span>
            <span className={styles.aboutValue}>{NODE_VERSION}</span>

            <span className={styles.aboutLabel}>Chromium</span>
            <span className={styles.aboutValue}>{CHROME_VERSION}</span>
          </div>
        </UCard>
      </div>
    </section>
  );
}
