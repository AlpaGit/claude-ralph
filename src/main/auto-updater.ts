/**
 * Auto-updater module for Claude Ralph Desktop.
 *
 * Checks GitHub Releases for new versions and notifies the user
 * when an update is available. Only runs in packaged builds —
 * silently no-ops during development.
 */
import { app } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

/**
 * Initialize the auto-updater. Should be called once after app.whenReady().
 *
 * In development (non-packaged) builds this function does nothing,
 * because electron-updater requires a real installer context to work.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    return;
  }

  // Don't auto-download — let the user decide.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[AutoUpdater] Checking for updates…");
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    console.log(`[AutoUpdater] Update available: v${info.version}`);
    // Download in the background so it's ready on next quit.
    void autoUpdater.downloadUpdate();
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[AutoUpdater] Application is up to date.");
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    console.log(
      `[AutoUpdater] Update v${info.version} downloaded. Will install on quit.`
    );
  });

  autoUpdater.on("error", (error: Error) => {
    // Non-fatal — the app continues to work with the current version.
    console.error("[AutoUpdater] Error:", error.message);
  });

  // Initial check after a short delay so the window renders first.
  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
      console.error("[AutoUpdater] Check failed:", error);
    });
  }, 10_000);
}
