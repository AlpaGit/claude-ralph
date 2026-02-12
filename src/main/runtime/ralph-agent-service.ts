/**
 * ralph-agent-service.ts — Re-export barrel for decomposed agent modules.
 *
 * The original RalphAgentService god class has been fully decomposed into:
 * - {@link DiscoveryAgent}  — discovery flow, stack inference, stack profile caching
 * - {@link TaskAgent}       — multi-stage task pipeline, phase merge, stabilization
 * - {@link PlannerAgent}    — PRD → technical plan generation
 * - {@link WizardService}   — interactive PRD wizard guidance
 *
 * TaskRunner now instantiates these modules directly via
 * {@link createModelResolver} from agent-constants.ts.
 *
 * This file exists solely as a re-export surface so any external import
 * paths that referenced "ralph-agent-service" continue to resolve.
 */

// Agent modules
export { DiscoveryAgent } from "./discovery-agent";
export { TaskAgent } from "./task-agent";
export { PlannerAgent } from "./planner-agent";
export { WizardService } from "./wizard-service";

// Discovery types
export type { StackProfileCache, StackProfileStore } from "./discovery-agent";

// Task agent types
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

// Planner types
export type { CreatePlanArgs, CreatePlanResult } from "./planner-agent";

// Model configuration (canonical home: agent-constants.ts)
export { type ModelConfigMap, createModelResolver } from "./agent-constants";
