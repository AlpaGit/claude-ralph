import { useEffect } from "react";
import type { JSX } from "react";
import { useSettingsStore, AVAILABLE_MODELS } from "../stores/settingsStore";
import type { AgentRole } from "../stores/settingsStore";
import { UCard, USkeleton } from "../components/ui";
import styles from "./SettingsView.module.css";

/**
 * Ordered list of agent roles for display in the configuration table.
 */
const AGENT_ROLES: readonly AgentRole[] = [
  "discovery_specialist",
  "plan_synthesis",
  "task_execution",
] as const;

/**
 * Human-readable labels for each agent role.
 */
const ROLE_LABELS: Record<AgentRole, string> = {
  discovery_specialist: "Discovery Specialist",
  plan_synthesis: "Plan Synthesis",
  task_execution: "Task Execution",
};

/**
 * Human-readable descriptions for each agent role.
 */
const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  discovery_specialist: "Conducts project interviews and context gathering",
  plan_synthesis: "Generates structured plans from PRD input",
  task_execution: "Executes individual tasks within a plan",
};

/**
 * Hardcoded version info.
 *
 * In a future phase these will be read from electron app.getVersion() via IPC.
 * For now, values are hardcoded from package.json.
 */
const APP_VERSION = "0.1.0";
const ELECTRON_VERSION = "33.x";
const NODE_VERSION = "20.x";
const CHROME_VERSION = "130.x";

/* -- Component -- */

/**
 * SettingsView -- model configuration, application preferences, and about info.
 *
 * Route: /settings
 *
 * Shows editable model configuration via dropdown selects. Changes are saved
 * immediately on selection (no separate save button).
 */
export function SettingsView(): JSX.Element {
  /* -- Zustand store selectors -- */
  const modelConfig = useSettingsStore((s) => s.modelConfig);
  const loading = useSettingsStore((s) => s.loading);
  const error = useSettingsStore((s) => s.error);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const updateModelForRole = useSettingsStore((s) => s.updateModelForRole);

  /* -- Load settings on mount -- */
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  /**
   * Handle model select change. Saves immediately via IPC.
   */
  function handleModelChange(role: AgentRole, modelId: string): void {
    void updateModelForRole(role, modelId);
  }

  return (
    <section className={styles.view}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </div>

      <div className={styles.sections}>
        {/* -- Model Configuration -- */}
        <UCard
          title="Model Configuration"
          subtitle="Select which model to use for each agent role"
        >
          {loading ? (
            <div className={styles.loadingRow}>
              <USkeleton variant="text" lines={3} />
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
                {AGENT_ROLES.map((role) => {
                  const entry = modelConfig[role];
                  const currentModelId = entry?.modelId ?? "";
                  return (
                    <tr key={role}>
                      <td className={styles.roleCell}>{ROLE_LABELS[role]}</td>
                      <td>{ROLE_DESCRIPTIONS[role]}</td>
                      <td className={styles.modelCell}>
                        <select
                          className={styles.modelSelect}
                          value={currentModelId}
                          onChange={(e) => handleModelChange(role, e.target.value)}
                          aria-label={`Model for ${ROLE_LABELS[role]}`}
                        >
                          {AVAILABLE_MODELS.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </UCard>

        {/* -- Application Preferences -- */}
        <UCard
          title="Application Preferences"
          subtitle="Customization options (coming soon)"
        >
          <p className={styles.placeholderText}>
            Application preferences such as theme selection, notification settings,
            and default project paths will be available in a future release.
          </p>
        </UCard>

        {/* -- About -- */}
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
