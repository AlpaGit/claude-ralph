import type { JSX } from "react";
import { useParams } from "react-router-dom";

/**
 * LiveRunView -- real-time log streaming for an active run.
 * Route: /run/:runId
 */
export function LiveRunView(): JSX.Element {
  const { runId } = useParams<{ runId: string }>();

  return (
    <section className="view-stub">
      <h2>Live Run</h2>
      <p>
        Watching run: <code>{runId ?? "unknown"}</code>
      </p>
    </section>
  );
}
