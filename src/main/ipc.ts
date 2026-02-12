import { ipcMain } from "electron";
import { z } from "zod";
import {
  abortQueueInputSchema,
  archivePlanInputSchema,
  cancelRunInputSchema,
  continueDiscoveryInputSchema,
  createPlanInputSchema,
  deletePlanInputSchema,
  discoveryAbandonInputSchema,
  discoveryCancelInputSchema,
  discoveryResumeInputSchema,
  getWizardGuidanceInputSchema,
  getPlanInputSchema,
  inferStackInputSchema,
  IPC_CHANNELS,
  listPlansInputSchema,
  retryTaskInputSchema,
  runAllInputSchema,
  runTaskInputSchema,
  skipTaskInputSchema,
  startDiscoveryInputSchema,
  unarchivePlanInputSchema,
  updateModelConfigInputSchema
} from "@shared/ipc";
import type { IpcError, IpcZodIssue } from "@shared/types";
import { TaskRunner } from "./runtime/task-runner";

/**
 * true when running in electron-vite dev mode.
 * In production builds, import.meta.env.DEV is false.
 */
const isDev: boolean = !!(import.meta.env?.DEV ?? (process.env.NODE_ENV !== "production"));

/**
 * Build a structured IpcError from an unknown thrown value.
 *
 * In development mode: preserves the original error message, Zod validation
 * issue details (field paths, expected vs received), and stack traces.
 * In production mode: returns a sanitized generic message with an error code.
 */
function formatIpcError(error: unknown): IpcError {
  // Zod v4 validation errors
  if (error instanceof z.ZodError) {
    const issues: IpcZodIssue[] = error.issues.map((issue) => {
      const mapped: IpcZodIssue = {
        path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: issue.message,
        code: issue.code
      };
      // Zod v4 invalid_type issues include expected type
      if ("expected" in issue && typeof issue.expected === "string") {
        mapped.expected = issue.expected;
      }
      // Include the received input value as a string for dev diagnostics
      if (isDev && "input" in issue && issue.input !== undefined) {
        mapped.received = typeof issue.input === "string"
          ? issue.input
          : JSON.stringify(issue.input);
      }
      return mapped;
    });

    const result: IpcError = {
      message: isDev
        ? `Validation failed: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
        : "Invalid input.",
      code: "VALIDATION_ERROR",
      ...(isDev ? { details: issues } : {}),
      ...(isDev && error.stack ? { stack: error.stack } : {})
    };
    return result;
  }

  // Standard Error instances
  if (error instanceof Error) {
    const result: IpcError = {
      message: isDev ? error.message : "An unexpected error occurred.",
      code: "INTERNAL_ERROR",
      ...(isDev && error.stack ? { stack: error.stack } : {})
    };
    return result;
  }

  // Unknown thrown values
  return {
    message: isDev ? String(error) : "An unexpected error occurred.",
    code: "UNKNOWN_ERROR"
  };
}

/**
 * Create an Error whose message is a JSON-serialized IpcError.
 * Electron's ipcMain.handle serializes thrown errors by extracting .message,
 * so we encode the structured payload as JSON in the message field.
 * The renderer can detect and parse this via parseIpcError().
 */
function createIpcError(error: unknown): Error {
  const ipcError = formatIpcError(error);
  return new Error(JSON.stringify(ipcError));
}

export function registerIpcHandlers(taskRunner: TaskRunner): void {
  ipcMain.handle(IPC_CHANNELS.createPlan, async (_event, rawInput) => {
    try {
      const input = createPlanInputSchema.parse(rawInput);
      return await taskRunner.createPlan(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getPlan, async (_event, rawInput) => {
    try {
      const input = getPlanInputSchema.parse(rawInput);
      return taskRunner.getPlan(input.planId);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.listPlans, async (_event, rawInput) => {
    try {
      const input = listPlansInputSchema.parse(rawInput);
      return taskRunner.listPlans(input.filter);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.deletePlan, async (_event, rawInput) => {
    try {
      const input = deletePlanInputSchema.parse(rawInput);
      taskRunner.deletePlan(input.planId);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.archivePlan, async (_event, rawInput) => {
    try {
      const input = archivePlanInputSchema.parse(rawInput);
      taskRunner.archivePlan(input.planId);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.unarchivePlan, async (_event, rawInput) => {
    try {
      const input = unarchivePlanInputSchema.parse(rawInput);
      taskRunner.unarchivePlan(input.planId);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.runTask, async (_event, rawInput) => {
    try {
      const input = runTaskInputSchema.parse(rawInput);
      return await taskRunner.runTask(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.runAll, async (_event, rawInput) => {
    try {
      const input = runAllInputSchema.parse(rawInput);
      return await taskRunner.runAll(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.cancelRun, async (_event, rawInput) => {
    try {
      const input = cancelRunInputSchema.parse(rawInput);
      return await taskRunner.cancelRun(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.retryTask, async (_event, rawInput) => {
    try {
      const input = retryTaskInputSchema.parse(rawInput);
      return await taskRunner.retryTask(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.skipTask, async (_event, rawInput) => {
    try {
      const input = skipTaskInputSchema.parse(rawInput);
      taskRunner.skipTask(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.abortQueue, async (_event, rawInput) => {
    try {
      const input = abortQueueInputSchema.parse(rawInput);
      taskRunner.abortQueue(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.startDiscovery, async (_event, rawInput) => {
    try {
      const input = startDiscoveryInputSchema.parse(rawInput);
      return await taskRunner.startDiscovery(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.continueDiscovery, async (_event, rawInput) => {
    try {
      const input = continueDiscoveryInputSchema.parse(rawInput);
      return await taskRunner.continueDiscovery(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.wizardGuidance, async (_event, rawInput) => {
    try {
      const input = getWizardGuidanceInputSchema.parse(rawInput);
      return await taskRunner.getWizardGuidance(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.inferStack, async (_event, rawInput) => {
    try {
      const input = inferStackInputSchema.parse(rawInput);
      return await taskRunner.inferStack(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getModelConfig, async () => {
    try {
      return taskRunner.getModelConfig();
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.updateModelConfig, async (_event, rawInput) => {
    try {
      const input = updateModelConfigInputSchema.parse(rawInput);
      taskRunner.updateModelForRole(input.agentRole, input.modelId);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.discoverySessions, async () => {
    try {
      return taskRunner.getActiveDiscoverySessions();
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.discoveryResume, async (_event, rawInput) => {
    try {
      const input = discoveryResumeInputSchema.parse(rawInput);
      return taskRunner.resumeDiscoverySession(input.sessionId);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.discoveryAbandon, async (_event, rawInput) => {
    try {
      const input = discoveryAbandonInputSchema.parse(rawInput);
      taskRunner.abandonDiscoverySession(input.sessionId);
    } catch (error) {
      throw createIpcError(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.discoveryCancel, async (_event, rawInput) => {
    try {
      const input = discoveryCancelInputSchema.parse(rawInput);
      return taskRunner.cancelDiscovery(input);
    } catch (error) {
      throw createIpcError(error);
    }
  });
}
