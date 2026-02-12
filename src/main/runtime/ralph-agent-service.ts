/**
 * RalphAgentService — thin orchestration facade that delegates to focused
 * domain modules.
 *
 * After Track 1 decomposition, the actual logic lives in:
 * - DiscoveryAgent    (discovery flow, stack inference, stack profile caching)
 * - TaskAgent         (multi-stage task pipeline, phase merge, stabilization)
 * - PlannerAgent      (PRD → technical plan generation)
 * - WizardService     (interactive PRD wizard guidance)
 *
 * This class retains the single public surface that task-runner.ts consumes,
 * providing backward-compatible method signatures and re-exports.
 */

import type {
  AgentRole,
  GetWizardGuidanceInput,
  InferStackInput,
  InferStackResult,
  WizardGuidanceResult
} from "@shared/types";
import { DEFAULT_MODEL_BY_ROLE } from "./agent-constants";
import {
  DiscoveryAgent,
  type DiscoveryCallbacks,
  type DiscoveryOutput,
  type StackProfileCache,
  type StackProfileStore,
  type StartDiscoveryArgs,
  type ContinueDiscoveryArgs
} from "./discovery-agent";
import {
  TaskAgent,
  type RunTaskArgs,
  type RunTaskResult,
  type MergePhaseArgs,
  type MergePhaseResult,
  type StabilizePhaseIntegrationArgs,
  type StabilizePhaseIntegrationResult
} from "./task-agent";
import { PlannerAgent, type CreatePlanArgs, type CreatePlanResult } from "./planner-agent";
import { WizardService } from "./wizard-service";

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------

export type { StackProfileCache, StackProfileStore } from "./discovery-agent";
export { DiscoveryAgent } from "./discovery-agent";
export { TaskAgent } from "./task-agent";
export { PlannerAgent } from "./planner-agent";
export { WizardService } from "./wizard-service";

// Re-export interface types so existing consumers keep compiling
export type {
  RunTaskArgs,
  RunTaskResult,
  RunTaskCallbacks,
  RetryContext,
  CommitterCallbacks,
  MergePhaseArgs,
  MergePhaseResult,
  StabilizePhaseIntegrationArgs,
  StabilizePhaseIntegrationResult
} from "./task-agent";
export type { CreatePlanArgs, CreatePlanResult } from "./planner-agent";

/** Map of agent role to model ID, loaded from model_config DB table. */
export type ModelConfigMap = Map<AgentRole, string>;

// ---------------------------------------------------------------------------
// RalphAgentService
// ---------------------------------------------------------------------------

export class RalphAgentService {
  private readonly modelConfig: ModelConfigMap;
  private readonly discovery: DiscoveryAgent;
  private readonly taskAgent: TaskAgent;
  private readonly planner: PlannerAgent;
  private readonly wizard: WizardService;

  constructor(modelConfig?: ModelConfigMap, stackProfileStore?: StackProfileStore) {
    this.modelConfig = modelConfig ?? new Map();
    const modelResolver = this.getModel.bind(this);
    this.discovery = new DiscoveryAgent(modelResolver, stackProfileStore);
    this.taskAgent = new TaskAgent(modelResolver);
    this.planner = new PlannerAgent(modelResolver);
    this.wizard = new WizardService(modelResolver);
  }

  /**
   * Resolve the model ID for a given agent role.
   * Falls back to opinionated defaults when no DB config exists.
   */
  private getModel(role: AgentRole): string {
    return this.modelConfig.get(role) ?? DEFAULT_MODEL_BY_ROLE[role];
  }

  // -------------------------------------------------------------------------
  // Discovery delegation
  // -------------------------------------------------------------------------

  async refreshStackProfile(args: {
    projectPath: string;
    additionalContext?: string;
    callbacks?: DiscoveryCallbacks;
  }): Promise<StackProfileCache> {
    return this.discovery.refreshStackProfile(args);
  }

  async startDiscovery(args: StartDiscoveryArgs): Promise<DiscoveryOutput> {
    return this.discovery.startDiscovery(args);
  }

  async continueDiscovery(args: ContinueDiscoveryArgs): Promise<DiscoveryOutput> {
    return this.discovery.continueDiscovery(args);
  }

  async inferStack(input: InferStackInput): Promise<InferStackResult> {
    return this.discovery.inferStack(input);
  }

  // -------------------------------------------------------------------------
  // Wizard guidance delegation
  // -------------------------------------------------------------------------

  async getWizardGuidance(input: GetWizardGuidanceInput): Promise<WizardGuidanceResult> {
    return this.wizard.getWizardGuidance(input);
  }

  // -------------------------------------------------------------------------
  // Plan creation delegation
  // -------------------------------------------------------------------------

  async createPlan(args: CreatePlanArgs): Promise<CreatePlanResult> {
    return this.planner.createPlan(args);
  }

  // -------------------------------------------------------------------------
  // Task execution delegation
  // -------------------------------------------------------------------------

  async runTask(args: RunTaskArgs): Promise<RunTaskResult> {
    return this.taskAgent.runTask(args);
  }

  // -------------------------------------------------------------------------
  // Phase merge delegation
  // -------------------------------------------------------------------------

  async mergePhaseWithCommitter(args: MergePhaseArgs): Promise<MergePhaseResult> {
    return this.taskAgent.mergePhaseWithCommitter(args);
  }

  // -------------------------------------------------------------------------
  // Phase stabilization delegation
  // -------------------------------------------------------------------------

  async stabilizePhaseIntegrationWithCommitter(
    args: StabilizePhaseIntegrationArgs
  ): Promise<StabilizePhaseIntegrationResult> {
    return this.taskAgent.stabilizePhaseIntegrationWithCommitter(args);
  }
}
