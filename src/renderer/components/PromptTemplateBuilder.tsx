import { useEffect } from "react";
import type { JSX } from "react";
import { useDiscoveryStore } from "../stores/discoveryStore";

/**
 * PromptTemplateBuilder -- thin legacy wrapper.
 *
 * The full discovery flow has been decomposed into DiscoveryView (route: /discovery)
 * and discoveryStore (Zustand). This wrapper preserves the old App.tsx interface
 * (projectPath + onUsePrompt callback) so the legacy file still compiles.
 *
 * When App.tsx is fully retired in favour of the router-based shell, this
 * file can be removed entirely. Use DiscoveryView for the route-based flow.
 *
 * @deprecated Use DiscoveryView instead.
 */

interface PromptTemplateBuilderProps {
  projectPath: string;
  onUsePrompt: (prompt: string) => void;
}

export function PromptTemplateBuilder({
  projectPath: _projectPath,
  onUsePrompt,
}: PromptTemplateBuilderProps): JSX.Element {
  const interview = useDiscoveryStore((s) => s.interview);

  // Forward prdInputDraft to the legacy onUsePrompt callback whenever the
  // interview state changes (i.e. after startDiscovery or continueDiscovery).
  useEffect(() => {
    if (interview?.prdInputDraft) {
      onUsePrompt(interview.prdInputDraft);
    }
  }, [interview, onUsePrompt]);

  return (
    <section>
      <p>
        Discovery has moved to the <strong>/discovery</strong> route. Use the sidebar navigation to
        access the full discovery interview flow.
      </p>
    </section>
  );
}
