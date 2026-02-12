import type { JSX } from "react";
import { useParams } from "react-router-dom";

/**
 * PlanDetailView -- shows a single plan with its checklist tasks.
 * Route: /plan/:planId
 */
export function PlanDetailView(): JSX.Element {
  const { planId } = useParams<{ planId: string }>();

  return (
    <section className="view-stub">
      <h2>Plan Detail</h2>
      <p>
        Viewing plan: <code>{planId ?? "unknown"}</code>
      </p>
    </section>
  );
}
