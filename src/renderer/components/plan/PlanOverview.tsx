import type { JSX } from "react";
import type { RalphPlan } from "@shared/types";
import { UCard } from "../ui";
import { UStatusPill } from "../ui";
import styles from "./PlanOverview.module.css";

export interface PlanOverviewProps {
  plan: RalphPlan;
}

/**
 * PlanOverview -- displays plan summary, status pill, and key metadata.
 *
 * Renders inside PlanDetailView as the top-level plan info card.
 */
export function PlanOverview({ plan }: PlanOverviewProps): JSX.Element {
  return (
    <UCard
      title="Plan Overview"
      headerAction={<UStatusPill status={plan.status} />}
      className={styles.overview}
    >
      <p className={styles.summary}>{plan.summary}</p>
      <div className={styles.meta}>
        <span>Project: {plan.projectPath}</span>
        <span>Tasks: {plan.tasks.length}</span>
        <span>Runs: {plan.runs.length}</span>
        <span>Created: {new Date(plan.createdAt).toLocaleDateString()}</span>
      </div>
    </UCard>
  );
}
