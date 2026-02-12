import { ipcMain } from "electron";
import {
  archivePlanInputSchema,
  cancelRunInputSchema,
  continueDiscoveryInputSchema,
  createPlanInputSchema,
  deletePlanInputSchema,
  getWizardGuidanceInputSchema,
  getPlanInputSchema,
  inferStackInputSchema,
  IPC_CHANNELS,
  listPlansInputSchema,
  runAllInputSchema,
  runTaskInputSchema,
  startDiscoveryInputSchema,
  unarchivePlanInputSchema,
  updateModelConfigInputSchema
} from "@shared/ipc";
import { TaskRunner } from "./runtime/task-runner";

function formatIpcError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown IPC error.";
}

export function registerIpcHandlers(taskRunner: TaskRunner): void {
  ipcMain.handle(IPC_CHANNELS.createPlan, async (_event, rawInput) => {
    try {
      const input = createPlanInputSchema.parse(rawInput);
      return await taskRunner.createPlan(input);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.getPlan, async (_event, rawInput) => {
    try {
      const input = getPlanInputSchema.parse(rawInput);
      return taskRunner.getPlan(input.planId);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.listPlans, async (_event, rawInput) => {
    try {
      const input = listPlansInputSchema.parse(rawInput);
      return taskRunner.listPlans(input.filter);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.deletePlan, async (_event, rawInput) => {
    try {
      const input = deletePlanInputSchema.parse(rawInput);
      taskRunner.deletePlan(input.planId);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.archivePlan, async (_event, rawInput) => {
    try {
      const input = archivePlanInputSchema.parse(rawInput);
      taskRunner.archivePlan(input.planId);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.unarchivePlan, async (_event, rawInput) => {
    try {
      const input = unarchivePlanInputSchema.parse(rawInput);
      taskRunner.unarchivePlan(input.planId);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.runTask, async (_event, rawInput) => {
    try {
      const input = runTaskInputSchema.parse(rawInput);
      return await taskRunner.runTask(input);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.runAll, async (_event, rawInput) => {
    try {
      const input = runAllInputSchema.parse(rawInput);
      return await taskRunner.runAll(input);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.cancelRun, async (_event, rawInput) => {
    try {
      const input = cancelRunInputSchema.parse(rawInput);
      return await taskRunner.cancelRun(input);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.startDiscovery, async (_event, rawInput) => {
    try {
      const input = startDiscoveryInputSchema.parse(rawInput);
      return await taskRunner.startDiscovery(input);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.continueDiscovery, async (_event, rawInput) => {
    try {
      const input = continueDiscoveryInputSchema.parse(rawInput);
      return await taskRunner.continueDiscovery(input);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.wizardGuidance, async (_event, rawInput) => {
    try {
      const input = getWizardGuidanceInputSchema.parse(rawInput);
      return await taskRunner.getWizardGuidance(input);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.inferStack, async (_event, rawInput) => {
    try {
      const input = inferStackInputSchema.parse(rawInput);
      return await taskRunner.inferStack(input);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.getModelConfig, async () => {
    try {
      return taskRunner.getModelConfig();
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.updateModelConfig, async (_event, rawInput) => {
    try {
      const input = updateModelConfigInputSchema.parse(rawInput);
      taskRunner.updateModelForRole(input.agentRole, input.modelId);
    } catch (error) {
      throw new Error(formatIpcError(error));
    }
  });
}
