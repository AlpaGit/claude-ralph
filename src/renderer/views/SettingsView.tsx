import { useEffect, useState } from "react";
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
  "architecture_specialist",
  "tester",
  "committer",
] as const;

/**
 * Human-readable labels for each agent role.
 */
const ROLE_LABELS: Record<AgentRole, string> = {
  discovery_specialist: "Discovery Specialist",
  plan_synthesis: "Plan Synthesis",
  task_execution: "Task Execution",
  architecture_specialist: "Architecture Specialist",
  tester: "Tester",
  committer: "Committer",
};

/**
 * Human-readable descriptions for each agent role.
 */
const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  discovery_specialist: "Conducts project interviews and context gathering",
  plan_synthesis: "Generates structured plans from PRD input",
  task_execution: "Executes individual tasks within a plan",
  architecture_specialist:
    "Reviews architecture, service boundaries, SOLID/SRP, and duplicate code; proposes refactors",
  tester: "Validates implementation with integration tests first, then unit fallback",
  committer:
    "Verifies worktree changes, commits with Conventional Commits, and performs controlled merges",
};

/** Default version placeholder shown while loading. */
const VERSION_LOADING = "—";

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
  const appSettings = useSettingsStore((s) => s.appSettings);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const updateModelForRole = useSettingsStore((s) => s.updateModelForRole);
  const updateAppSettings = useSettingsStore((s) => s.updateAppSettings);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");

  /* -- Version info from main process -- */
  const [appVersion, setAppVersion] = useState(VERSION_LOADING);
  const [electronVersion, setElectronVersion] = useState(VERSION_LOADING);
  const [nodeVersion, setNodeVersion] = useState(VERSION_LOADING);
  const [chromeVersion, setChromeVersion] = useState(VERSION_LOADING);

  /* -- Load settings and version info on mount -- */
  useEffect(() => {
    void loadSettings();
    void window.ralphApi.getAppVersion().then((info) => {
      setAppVersion(info.appVersion);
      setElectronVersion(info.electronVersion);
      setNodeVersion(info.nodeVersion);
      setChromeVersion(info.chromeVersion);
    });
  }, [loadSettings]);

  useEffect(() => {
    setDiscordWebhookUrl(appSettings.discordWebhookUrl);
  }, [appSettings.discordWebhookUrl]);

  /**
   * Handle model select change. Saves immediately via IPC.
   */
  function handleModelChange(role: AgentRole, modelId: string): void {
    void updateModelForRole(role, modelId);
  }

  function handleSaveAppSettings(): void {
    void updateAppSettings({
      discordWebhookUrl: discordWebhookUrl.trim(),
    });
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
          subtitle="Runtime integrations and notification settings"
        >
          <div className={styles.preferenceGroup}>
            <label htmlFor="discord-webhook-url" className={styles.preferenceLabel}>
              Discord Webhook URL
            </label>
            <input
              id="discord-webhook-url"
              className={styles.preferenceInput}
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={discordWebhookUrl}
              onChange={(event) => setDiscordWebhookUrl(event.target.value)}
            />
            <p className={styles.preferenceHint}>
              When set, each specialist/stage agent posts what it is doing and what it found.
              Leave empty to disable Discord notifications.
            </p>
            <button
              type="button"
              className={styles.savePreferencesBtn}
              onClick={handleSaveAppSettings}
            >
              Save Preferences
            </button>
          </div>
        </UCard>

        {/* -- About -- */}
        <UCard title="About">
          <div className={styles.aboutGrid}>
            <span className={styles.aboutLabel}>App Version</span>
            <span className={styles.aboutValue}>{appVersion}</span>

            <span className={styles.aboutLabel}>Electron</span>
            <span className={styles.aboutValue}>{electronVersion}</span>

            <span className={styles.aboutLabel}>Node.js</span>
            <span className={styles.aboutValue}>{nodeVersion}</span>

            <span className={styles.aboutLabel}>Chromium</span>
            <span className={styles.aboutValue}>{chromeVersion}</span>
          </div>
        </UCard>
      </div>
    </section>
  );
}
