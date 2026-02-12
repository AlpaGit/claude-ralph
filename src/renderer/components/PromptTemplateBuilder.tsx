import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type {
  ContinueDiscoveryInput,
  DiscoveryEvent,
  DiscoveryInterviewState,
  StartDiscoveryInput
} from "@shared/types";

interface PromptTemplateBuilderProps {
  projectPath: string;
  onUsePrompt: (prompt: string) => void;
}

type AnswerState = Record<string, string>;
type WindowWithOptionalApi = Window & { ralphApi?: typeof window.ralphApi };

function getRalphApi(): typeof window.ralphApi | null {
  return (window as WindowWithOptionalApi).ralphApi ?? null;
}

function readinessBadge(score: number): string {
  if (score >= 85) return "Ready";
  if (score >= 60) return "Needs More Detail";
  return "Early Discovery";
}

function formatDiscoveryEventLine(event: DiscoveryEvent): string {
  const time = new Date(event.ts).toLocaleTimeString();
  const label = event.type === "agent" && event.agent ? `${event.type}:${event.agent}` : event.type;
  const details = event.details ? `\n    ${event.details}` : "";
  return `[${time}] [${label}] ${event.message}${details}`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;
  return `${minutes}m${remainingSeconds.toString().padStart(2, "0")}s`;
}

function extractSpecialistId(event: DiscoveryEvent): string | null {
  if (event.type !== "agent") {
    return null;
  }

  if (event.agent && event.agent.trim().length > 0) {
    return event.agent.trim();
  }

  const startMatch = event.message.match(/^Starting specialist agent:\s(.+)$/);
  if (startMatch) {
    return startMatch[1].trim();
  }

  const completeMatch = event.message.match(/^Completed specialist agent:\s(.+?)(\s\(|$)/);
  if (completeMatch) {
    return completeMatch[1].trim();
  }

  return null;
}

export function PromptTemplateBuilder({ projectPath, onUsePrompt }: PromptTemplateBuilderProps): JSX.Element {
  const [seedSentence, setSeedSentence] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [interview, setInterview] = useState<DiscoveryInterviewState | null>(null);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [discoveryEvents, setDiscoveryEvents] = useState<DiscoveryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null);
  const [lastEventAtMs, setLastEventAtMs] = useState<number | null>(null);
  const [lastDiscoveryDurationSec, setLastDiscoveryDurationSec] = useState<number | null>(null);
  const [tickMs, setTickMs] = useState<number>(() => Date.now());
  const [lastReadyAtIso, setLastReadyAtIso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const currentRoundAnswered = useMemo(() => {
    if (!interview) return 0;
    return interview.questions.filter((question) => (answers[question.id] ?? "").trim().length > 0).length;
  }, [answers, interview]);

  const liveFeedbackText = useMemo(() => {
    if (discoveryEvents.length === 0) {
      return "Waiting for AI feedback...";
    }
    return discoveryEvents
      .slice()
      .reverse()
      .map((event) => formatDiscoveryEventLine(event))
      .join("\n");
  }, [discoveryEvents]);

  const thinkingElapsedSec = useMemo(() => {
    if (!loading || thinkingStartedAtMs === null) {
      return 0;
    }
    return Math.floor((tickMs - thinkingStartedAtMs) / 1000);
  }, [loading, thinkingStartedAtMs, tickMs]);

  const secondsSinceLastEvent = useMemo(() => {
    if (!loading || lastEventAtMs === null) {
      return null;
    }
    return Math.max(0, Math.floor((tickMs - lastEventAtMs) / 1000));
  }, [loading, lastEventAtMs, tickMs]);

  const specialistProgress = useMemo(() => {
    const started = new Set<string>();
    const completed = new Set<string>();

    for (const event of discoveryEvents) {
      const id = extractSpecialistId(event);
      if (!id) continue;

      if (event.message.startsWith("Starting specialist agent:")) {
        started.add(id);
      }
      if (event.message.startsWith("Completed specialist agent:")) {
        completed.add(id);
      }
    }

    return {
      started: started.size,
      completed: completed.size
    };
  }, [discoveryEvents]);

  const liveStatusText = useMemo(() => {
    if (!loading) {
      if (lastDiscoveryDurationSec === null) {
        return "Latest discovery events.";
      }
      return `Last discovery cycle finished in ${formatDuration(lastDiscoveryDurationSec)}.`;
    }

    if (discoveryEvents.length === 0) {
      return "Booting discovery runtime and preparing specialist jobs...";
    }

    if (secondsSinceLastEvent === null) {
      return "Waiting for first runtime event...";
    }

    if (secondsSinceLastEvent <= 8) {
      return "Actively receiving updates from AI specialists.";
    }

    if (secondsSinceLastEvent <= 25) {
      return "Still working. A specialist is likely processing a longer step.";
    }

    return "Long-running analysis in progress. This is normal for deep codebase scans.";
  }, [loading, lastDiscoveryDurationSec, discoveryEvents.length, secondsSinceLastEvent]);

  useEffect(() => {
    const api = getRalphApi();
    if (!api) {
      return;
    }

    const unsubscribe = api.onDiscoveryEvent((event) => {
      setDiscoveryEvents((current) => [event, ...current].slice(0, 120));
      const parsedTs = Date.parse(event.ts);
      setLastEventAtMs(Number.isNaN(parsedTs) ? Date.now() : parsedTs);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!loading) {
      return;
    }

    const interval = window.setInterval(() => {
      setTickMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loading]);

  const handleStartDiscovery = async (): Promise<void> => {
    const brief = seedSentence.trim();
    if (brief.length < 5) {
      setError("Please enter a short goal sentence (at least 5 characters).");
      return;
    }

    const api = getRalphApi();
    if (!api) {
      setError("Preload bridge unavailable. Cannot start discovery interview.");
      return;
    }

    setLoading(true);
    const startedAt = Date.now();
    setThinkingStartedAtMs(startedAt);
    setLastDiscoveryDurationSec(null);
    setTickMs(startedAt);
    setLastEventAtMs(null);
    setError(null);
    setCopyNotice(null);
    setDiscoveryEvents([]);

    try {
      const payload: StartDiscoveryInput = {
        projectPath,
        seedSentence: brief,
        additionalContext: additionalContext.trim()
      };
      const initialState = await api.startDiscovery(payload);
      setInterview(initialState);
      setAnswers(
        Object.fromEntries(initialState.questions.map((question) => [question.id, ""]))
      );
      onUsePrompt(initialState.prdInputDraft);
      setLastReadyAtIso(new Date().toISOString());
      setCopyNotice("Discovery output is ready. PRD Input has been updated below.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to start discovery interview.";
      setError(message);
    } finally {
      setLoading(false);
      setThinkingStartedAtMs(null);
      setLastDiscoveryDurationSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }
  };

  const handleContinueDiscovery = async (): Promise<void> => {
    if (!interview) return;

    const api = getRalphApi();
    if (!api) {
      setError("Preload bridge unavailable. Cannot continue discovery interview.");
      return;
    }

    const answerPayload = interview.questions
      .map((question) => ({
        questionId: question.id,
        answer: (answers[question.id] ?? "").trim()
      }))
      .filter((item) => item.answer.length > 0);

    if (answerPayload.length === 0) {
      setError("Answer at least one question before continuing.");
      return;
    }

    setLoading(true);
    const startedAt = Date.now();
    setThinkingStartedAtMs(startedAt);
    setLastDiscoveryDurationSec(null);
    setTickMs(startedAt);
    setError(null);
    setCopyNotice(null);

    try {
      const payload: ContinueDiscoveryInput = {
        sessionId: interview.sessionId,
        answers: answerPayload
      };
      const nextState = await api.continueDiscovery(payload);
      setInterview(nextState);
      setAnswers((current) => {
        const merged = { ...current };
        for (const question of nextState.questions) {
          if (!(question.id in merged)) {
            merged[question.id] = "";
          }
        }
        return merged;
      });
      onUsePrompt(nextState.prdInputDraft);
      setLastReadyAtIso(new Date().toISOString());
      setCopyNotice("Discovery updated. PRD Input has been refreshed below.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to continue discovery interview.";
      setError(message);
    } finally {
      setLoading(false);
      setThinkingStartedAtMs(null);
      setLastDiscoveryDurationSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }
  };

  const handleCopyPrdInput = async (): Promise<void> => {
    if (!interview) return;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(interview.prdInputDraft);
        setCopyNotice("PRD input copied to clipboard.");
      } else {
        setCopyNotice("Clipboard API not available in this environment.");
      }
    } catch {
      setCopyNotice("Failed to copy PRD input.");
    }
  };

  const handleReset = (): void => {
    setInterview(null);
    setAnswers({});
    setDiscoveryEvents([]);
    setThinkingStartedAtMs(null);
    setLastEventAtMs(null);
    setLastDiscoveryDurationSec(null);
    setLastReadyAtIso(null);
    setError(null);
    setCopyNotice(null);
  };

  return (
    <section className="template-builder">
      <div className="panel-header">
        <h2>Interactive PRD Discovery</h2>
      </div>

      <p className="notice-text">
        Write one short goal sentence. AI specialists will inspect the project (if path is set), ask detailed
        questions, and build a ready-to-use PRD input draft.
      </p>

      <label className="label" htmlFor="discovery-seed">
        Goal Sentence
      </label>
      <textarea
        id="discovery-seed"
        className="text-area compact-area"
        value={seedSentence}
        onChange={(event) => setSeedSentence(event.target.value)}
        placeholder="Example: improve API reliability and deployment confidence without breaking public endpoints."
      />

      <details className="advanced-settings">
        <summary className="label">Optional Context</summary>
        <div className="advanced-settings-content">
          <label className="label" htmlFor="discovery-extra">
            Additional Context (optional)
          </label>
          <textarea
            id="discovery-extra"
            className="text-area compact-area"
            value={additionalContext}
            onChange={(event) => setAdditionalContext(event.target.value)}
            placeholder="Business context, deadlines, constraints, known issues, etc."
          />
        </div>
      </details>

      <div className="wizard-actions">
        <button className="action-btn secondary" onClick={() => void handleStartDiscovery()} disabled={loading}>
          {loading ? "Starting Discovery..." : "Start Discovery Interview"}
        </button>
        <button className="action-btn ghost" onClick={handleReset}>
          Reset Discovery
        </button>
      </div>

      {error ? <p className="notice-text error-text">{error}</p> : null}

      {(loading || discoveryEvents.length > 0) ? (
        <div className="wizard-guidance-card">
          <div className="discovery-live-header">
            <h3>AI Feedback (Live)</h3>
            <div className="thinking-indicator">
              <span className="thinking-pulse" />
              <span>{loading ? `Thinking for ${formatDuration(thinkingElapsedSec)}` : "Idle"}</span>
              {loading ? (
                <span className="thinking-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              ) : null}
            </div>
          </div>
          <div className="meta-row">
            <span>Events: {discoveryEvents.length}</span>
            <span>
              {secondsSinceLastEvent === null ? "Last update: waiting..." : `Last update: ${secondsSinceLastEvent}s ago`}
            </span>
            <span>Specialists done: {specialistProgress.completed}/{Math.max(5, specialistProgress.started)}</span>
          </div>
          <p className={`notice-text ${loading && (secondsSinceLastEvent ?? 0) > 20 ? "warning-text" : ""}`}>
            {liveStatusText}
          </p>
          <pre className="log-box">{liveFeedbackText}</pre>
        </div>
      ) : null}

      {!loading && interview ? (
        <div className="wizard-guidance-card">
          <div className="panel-header">
            <h3>Discovery Output Ready</h3>
            <span className="status-pill status-completed">ready</span>
          </div>
          <p className="notice-text">
            PRD Input has been auto-updated in the plan builder.
            {lastReadyAtIso ? ` (${new Date(lastReadyAtIso).toLocaleTimeString()})` : ""}
          </p>
          <div className="wizard-actions">
            <button className="action-btn primary" onClick={() => onUsePrompt(interview.prdInputDraft)}>
              Apply PRD Input Again
            </button>
            <button className="action-btn ghost" onClick={() => void handleCopyPrdInput()}>
              Copy PRD Input
            </button>
          </div>
        </div>
      ) : null}

      {interview ? (
        <>
          <div className="wizard-guidance-card">
            <div className="panel-header">
              <h3>Discovery Status</h3>
              <span className="status-pill status-in_progress">{readinessBadge(interview.readinessScore)}</span>
            </div>
            <div className="meta-row">
              <span>Round: {interview.round}</span>
              <span>Readiness: {interview.readinessScore}%</span>
              <span>
                Questions answered this round: {currentRoundAnswered}/{interview.questions.length}
              </span>
            </div>
            <p>
              <strong>Direction:</strong> {interview.directionSummary}
            </p>
          </div>

          <div className="wizard-guidance-card">
            <h3>Inferred Context</h3>
            <p>
              <strong>Stack:</strong> {interview.inferredContext.stack}
            </p>
            <p>
              <strong>Documentation:</strong> {interview.inferredContext.documentation}
            </p>
            <p>
              <strong>Scope:</strong> {interview.inferredContext.scope}
            </p>

            {interview.inferredContext.painPoints.length > 0 ? (
              <>
                <h4>Likely Pain Points</h4>
                <ul>
                  {interview.inferredContext.painPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {interview.inferredContext.constraints.length > 0 ? (
              <>
                <h4>Likely Constraints</h4>
                <ul>
                  {interview.inferredContext.constraints.map((constraint) => (
                    <li key={constraint}>{constraint}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {interview.inferredContext.signals.length > 0 ? (
              <>
                <h4>Signals</h4>
                <ul>
                  {interview.inferredContext.signals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div className="wizard-guidance-card">
            <h3>Detailed Questions</h3>
            {interview.questions.length > 0 ? (
              <ul className="suggested-edits">
                {interview.questions.map((question) => (
                  <li key={question.id}>
                    <div>
                      <strong>{question.question}</strong>
                    </div>
                    <div className="meta-row">
                      <span>Why this matters: {question.reason}</span>
                    </div>
                    <textarea
                      className="text-area compact-area"
                      value={answers[question.id] ?? ""}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.value
                        }))
                      }
                      placeholder="Your answer..."
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p>No more questions right now. The draft is likely ready for planning.</p>
            )}
          </div>

          {interview.missingCriticalInfo.length > 0 ? (
            <div className="wizard-guidance-card">
              <h3>Missing Critical Info</h3>
              <ul>
                {interview.missingCriticalInfo.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="template-actions">
            <button
              className="action-btn secondary"
              onClick={() => void handleContinueDiscovery()}
              disabled={loading || interview.questions.length === 0}
            >
              {loading ? "Updating Discovery..." : "Submit Answers And Continue"}
            </button>
            <button className="action-btn primary" onClick={() => onUsePrompt(interview.prdInputDraft)}>
              Use As PRD Input
            </button>
            <button className="action-btn ghost" onClick={() => void handleCopyPrdInput()}>
              Copy PRD Input
            </button>
          </div>

          {copyNotice ? <p className="notice-text">{copyNotice}</p> : null}

          <details>
            <summary className="label">Preview Generated PRD Input</summary>
            <pre className="log-box prompt-preview">{interview.prdInputDraft}</pre>
          </details>
        </>
      ) : null}
    </section>
  );
}
