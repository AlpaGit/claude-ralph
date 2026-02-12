import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/ipc";
import type {
  AbandonDiscoveryInput,
  AbortQueueInput,
  ArchivePlanInput,
  CancelRunInput,
  CancelRunResponse,
  ContinueDiscoveryInput,
  CreatePlanInput,
  CreatePlanResponse,
  DeletePlanInput,
  DiscoveryEvent,
  DiscoveryInterviewState,
  DiscoverySessionSummary,
  GetWizardGuidanceInput,
  InferStackInput,
  InferStackResult,
  ListPlansInput,
  ModelConfigEntry,
  PlanListItem,
  RalphApi,
  RalphPlan,
  ResumeDiscoveryInput,
  RetryTaskInput,
  RetryTaskResponse,
  RunAllInput,
  RunAllResponse,
  RunEvent,
  RunTaskInput,
  RunTaskResponse,
  SkipTaskInput,
  StartDiscoveryInput,
  UnarchivePlanInput,
  UpdateModelConfigInput,
  WizardGuidanceResult
} from "@shared/types";

const api: RalphApi = {
  createPlan(input: CreatePlanInput): Promise<CreatePlanResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.createPlan, input);
  },

  getPlan(planId: string): Promise<RalphPlan | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.getPlan, { planId });
  },

  listPlans(input: ListPlansInput): Promise<PlanListItem[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.listPlans, input);
  },

  deletePlan(input: DeletePlanInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.deletePlan, input);
  },

  archivePlan(input: ArchivePlanInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.archivePlan, input);
  },

  unarchivePlan(input: UnarchivePlanInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.unarchivePlan, input);
  },

  runTask(input: RunTaskInput): Promise<RunTaskResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.runTask, input);
  },

  runAll(input: RunAllInput): Promise<RunAllResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.runAll, input);
  },

  cancelRun(input: CancelRunInput): Promise<CancelRunResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.cancelRun, input);
  },

  retryTask(input: RetryTaskInput): Promise<RetryTaskResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.retryTask, input);
  },

  skipTask(input: SkipTaskInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.skipTask, input);
  },

  abortQueue(input: AbortQueueInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.abortQueue, input);
  },

  startDiscovery(input: StartDiscoveryInput): Promise<DiscoveryInterviewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.startDiscovery, input);
  },

  continueDiscovery(input: ContinueDiscoveryInput): Promise<DiscoveryInterviewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.continueDiscovery, input);
  },

  getWizardGuidance(input: GetWizardGuidanceInput): Promise<WizardGuidanceResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.wizardGuidance, input);
  },

  inferStack(input: InferStackInput): Promise<InferStackResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.inferStack, input);
  },

  getModelConfig(): Promise<ModelConfigEntry[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.getModelConfig);
  },

  updateModelConfig(input: UpdateModelConfigInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateModelConfig, input);
  },

  getDiscoverySessions(): Promise<DiscoverySessionSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.discoverySessions);
  },

  resumeDiscoverySession(input: ResumeDiscoveryInput): Promise<DiscoveryInterviewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.discoveryResume, input);
  },

  abandonDiscoverySession(input: AbandonDiscoveryInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.discoveryAbandon, input);
  },

  onDiscoveryEvent(handler: (event: DiscoveryEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: DiscoveryEvent) => {
      handler(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.discoveryEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.discoveryEvent, listener);
    };
  },

  onRunEvent(handler: (event: RunEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: RunEvent) => {
      handler(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.runEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.runEvent, listener);
    };
  }
};

contextBridge.exposeInMainWorld("ralphApi", api);
