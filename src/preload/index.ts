import { contextBridge, ipcRenderer } from "electron";
import type {
  AbandonDiscoveryInput,
  AbortQueueInput,
  ApproveTaskProposalInput,
  ApproveTaskProposalResponse,
  ArchivePlanInput,
  AppSettings,
  CancelDiscoveryInput,
  CancelDiscoveryResponse,
  CancelRunInput,
  CancelRunResponse,
  ContinueDiscoveryInput,
  CreatePlanInput,
  CreatePlanResponse,
  DeletePlanInput,
  DismissTaskProposalInput,
  DiscoveryEvent,
  DiscoveryInterviewState,
  DiscoverySessionSummary,
  GetRunEventsInput,
  GetRunEventsResponse,
  GetWizardGuidanceInput,
  InferStackInput,
  InferStackResult,
  ListPlansInput,
  ListProjectMemoryInput,
  ModelConfigEntry,
  PlanListItem,
  ProjectMemoryItem,
  RalphApi,
  RefreshProjectStackProfileInput,
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
  UpdateAppSettingsInput,
  WizardGuidanceResult,
} from "@shared/types";

// Keep preload runtime minimal: do not import @shared/ipc here because it
// depends on zod/runtime modules that can fail in sandboxed preload contexts.
const IPC_CHANNELS = {
  createPlan: "plan:create",
  getPlan: "plan:get",
  listPlans: "plan:list",
  listProjectMemory: "project-memory:list",
  refreshProjectStackProfile: "project-memory:refresh",
  deletePlan: "plan:delete",
  archivePlan: "plan:archive",
  unarchivePlan: "plan:unarchive",
  runTask: "task:run",
  runAll: "task:runAll",
  cancelRun: "run:cancel",
  retryTask: "task:retry",
  skipTask: "task:skip",
  approveTaskProposal: "proposal:approve",
  dismissTaskProposal: "proposal:dismiss",
  abortQueue: "queue:abort",
  startDiscovery: "discovery:start",
  continueDiscovery: "discovery:continue",
  discoveryEvent: "discovery:event",
  wizardGuidance: "wizard:guidance",
  inferStack: "wizard:inferStack",
  runEvent: "run:event",
  getModelConfig: "config:getModels",
  updateModelConfig: "config:updateModel",
  getAppSettings: "config:getAppSettings",
  updateAppSettings: "config:updateAppSettings",
  discoverySessions: "discovery:sessions",
  discoveryResume: "discovery:resume",
  discoveryAbandon: "discovery:abandon",
  discoveryCancel: "discovery:cancel",
  getRunEvents: "run:getEvents",
} as const;

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

  listProjectMemory(input: ListProjectMemoryInput): Promise<ProjectMemoryItem[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.listProjectMemory, input);
  },

  refreshProjectStackProfile(input: RefreshProjectStackProfileInput): Promise<ProjectMemoryItem> {
    return ipcRenderer.invoke(IPC_CHANNELS.refreshProjectStackProfile, input);
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

  approveTaskProposal(input: ApproveTaskProposalInput): Promise<ApproveTaskProposalResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.approveTaskProposal, input);
  },

  dismissTaskProposal(input: DismissTaskProposalInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.dismissTaskProposal, input);
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

  getAppSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.getAppSettings);
  },

  updateAppSettings(input: UpdateAppSettingsInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateAppSettings, input);
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

  cancelDiscovery(input: CancelDiscoveryInput): Promise<CancelDiscoveryResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.discoveryCancel, input);
  },

  getRunEvents(input: GetRunEventsInput): Promise<GetRunEventsResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.getRunEvents, input);
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
  },
};

contextBridge.exposeInMainWorld("ralphApi", api);
