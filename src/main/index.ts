import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppDatabase } from "./runtime/app-database";
import { TaskRunner } from "./runtime/task-runner";
import { registerIpcHandlers } from "./ipc";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let mainWindow: BrowserWindow | null = null;
let database: AppDatabase | null = null;
let taskRunner: TaskRunner | null = null;

function createWindow(): BrowserWindow {
  const isMac = process.platform === "darwin";

  const win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1040,
    minHeight: 740,
    // macOS: "hiddenInset" hides the title bar and insets the traffic lights.
    // Windows: "hidden" removes the default title bar; titleBarOverlay renders
    // native window-control buttons (minimize / maximize / close) on top.
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac
      ? {}
      : {
          titleBarOverlay: {
            color: "#1a1a1a",
            symbolColor: "#e0e0e0",
            height: 36
          }
        }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const migrationsDir = app.isPackaged
    ? join(process.resourcesPath, "migrations")
    : join(app.getAppPath(), "resources", "migrations");

  database = new AppDatabase(
    join(app.getPath("userData"), "ralph-desktop.sqlite"),
    migrationsDir
  );
  taskRunner = new TaskRunner(database, () => mainWindow);
  registerIpcHandlers(taskRunner);

  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  database?.close();
});

void bootstrap().catch((error) => {
  console.error("[ralph-desktop] Failed to bootstrap app:", error);
  app.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("[ralph-desktop] Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("[ralph-desktop] Uncaught exception:", error);
});
