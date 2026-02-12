import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import type { DiscoveryEvent, DiscoverySessionSummary } from "@shared/types";
import { useDiscoveryStore } from "../stores/discoveryStore";
import { UButton } from "../components/ui/UButton";
import { UTextArea } from "../components/UTextArea/UTextArea";
import { UStatusPill } from "../components/UStatusPill/UStatusPill";
import { USkeleton } from "../components/USkeleton/USkeleton";
import { toastService } from "../services/toastService";
import styles from "./DiscoveryView.module.css";

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

function readinessBadge(score: number): string {
  if (score >= 85) return "Ready";
  if (score >= 60) return "Needs More Detail";
  return "Early Discovery";
}

function readinessStatus(score: number): string {
  if (score >= 85) return "completed";
  if (score >= 60) return "in_progress";
  return "pending";
}

function formatDiscoveryEventLine(event: DiscoveryEvent): string {
  const time = new Date(event.ts).toLocaleTimeString();
  const label =
    event.type === "agent" && event.agent
      ? `${event.type}:${event.agent}`
      : event.type;
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
  if (event.type !== "agent") return null;

  if (event.agent && event.agent.trim().length > 0) {
    return event.agent.trim();
  }

  const startMatch = event.message.match(
    /^Starting specialist agent:\s(.+)$/
  );
  if (startMatch) return startMatch[1].trim();

  const completeMatch = event.message.match(
    /^Completed specialist agent:\s(.+?)(\s\(|$)/
  );
  if (completeMatch) return completeMatch[1].trim();

  return null;
}

/* ── Component ─────────────────────────────────────────── */

/**
 * DiscoveryView -- full AI discovery interview flow.
 *
 * Renders seed sentence input, optional context, AI feedback panel,
 * discovery output with inferred context, question cards with answer
 * inputs, and PRD preview. Uses discoveryStore for all state.
 *
 * Route: /discovery
 */
export function DiscoveryView(): JSX.Element {
  const navigate = useNavigate();

  // ── Store slices ─────────────────────────────────────
  const seedSentence = useDiscoveryStore((s) => s.seedSentence);
  const additionalContext = useDiscoveryStore((s) => s.additionalContext);
  const interview = useDiscoveryStore((s) => s.interview);
  const answerMap = useDiscoveryStore((s) => s.answerMap);
  const events = useDiscoveryStore((s) => s.events);
  const loading = useDiscoveryStore((s) => s.loading);
  const error = useDiscoveryStore((s) => s.error);
  const thinkingStartedAtMs = useDiscoveryStore((s) => s.thinkingStartedAtMs);
  const lastEventAtMs = useDiscoveryStore((s) => s.lastEventAtMs);
  const lastDiscoveryDurationSec = useDiscoveryStore((s) => s.lastDiscoveryDurationSec);
  const lastReadyAtIso = useDiscoveryStore((s) => s.lastReadyAtIso);
  const copyNotice = useDiscoveryStore((s) => s.copyNotice);

  // ── Session management slices ───────────────────────
  const activeSessions = useDiscoveryStore((s) => s.activeSessions);
  const checkingSessions = useDiscoveryStore((s) => s.checkingSessions);

  // ── Store actions ────────────────────────────────────
  const setSeedSentence = useDiscoveryStore((s) => s.setSeedSentence);
  const setAdditionalContext = useDiscoveryStore((s) => s.setAdditionalContext);
  const setAnswer = useDiscoveryStore((s) => s.setAnswer);
  const setCopyNotice = useDiscoveryStore((s) => s.setCopyNotice);
  const startDiscovery = useDiscoveryStore((s) => s.startDiscovery);
  const continueDiscovery = useDiscoveryStore((s) => s.continueDiscovery);
  const checkActiveSessions = useDiscoveryStore((s) => s.checkActiveSessions);
  const resumeSession = useDiscoveryStore((s) => s.resumeSession);
  const abandonSession = useDiscoveryStore((s) => s.abandonSession);
  const cancelDiscovery = useDiscoveryStore((s) => s.cancelDiscovery);
  const reset = useDiscoveryStore((s) => s.reset);

  // ── Resume dialog state ────────────────────────────
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  // Check for active sessions on mount
  useEffect(() => {
    // Only check if there is no active interview already loaded
    if (!interview) {
      void checkActiveSessions();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show resume dialog when active sessions are found
  useEffect(() => {
    if (activeSessions.length > 0 && !interview && !loading) {
      setShowResumeDialog(true);
    } else {
      setShowResumeDialog(false);
    }
  }, [activeSessions, interview, loading]);

  const handleResumeSession = useCallback(
    (sessionId: string): void => {
      setShowResumeDialog(false);
      void resumeSession(sessionId);
    },
    [resumeSession]
  );

  const handleStartFresh = useCallback((): void => {
    // Abandon all active sessions and close the dialog
    for (const session of activeSessions) {
      void abandonSession(session.id);
    }
    setShowResumeDialog(false);
  }, [activeSessions, abandonSession]);

  // ── Local tick timer for live elapsed display ────────
  const [tickMs, setTickMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!loading) return;
    const interval = window.setInterval(() => setTickMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [loading]);

  // ── Derived / memoized values ────────────────────────

  const currentRoundAnswered = useMemo(() => {
    if (!interview) return 0;
    return interview.questions.filter(
      (q) => (answerMap[q.id] ?? "").trim().length > 0
    ).length;
  }, [answerMap, interview]);

  const liveFeedbackText = useMemo(() => {
    if (events.length === 0) return "Waiting for AI feedback...";
    return events
      .map((event) => formatDiscoveryEventLine(event))
      .join("\n");
  }, [events]);

  const thinkingElapsedSec = useMemo(() => {
    if (!loading || thinkingStartedAtMs === null) return 0;
    return Math.floor((tickMs - thinkingStartedAtMs) / 1000);
  }, [loading, thinkingStartedAtMs, tickMs]);

  const secondsSinceLastEvent = useMemo(() => {
    if (!loading || lastEventAtMs === null) return null;
    return Math.max(0, Math.floor((tickMs - lastEventAtMs) / 1000));
  }, [loading, lastEventAtMs, tickMs]);

  const specialistProgress = useMemo(() => {
    const started = new Set<string>();
    const completed = new Set<string>();
    for (const event of events) {
      const id = extractSpecialistId(event);
      if (!id) continue;
      if (event.message.startsWith("Starting specialist agent:")) started.add(id);
      if (event.message.startsWith("Completed specialist agent:")) completed.add(id);
    }
    return {
      started: started.size,
      completed: completed.size,
      startedNames: Array.from(started),
      completedNames: Array.from(completed),
    };
  }, [events]);

  const liveStatusText = useMemo(() => {
    if (!loading) {
      if (lastDiscoveryDurationSec === null) return "Latest discovery events.";
      return `Last discovery cycle finished in ${formatDuration(lastDiscoveryDurationSec)}.`;
    }
    if (events.length === 0)
      return "Booting discovery runtime and preparing specialist jobs...";
    if (secondsSinceLastEvent === null) return "Waiting for first runtime event...";
    if (secondsSinceLastEvent <= 8)
      return "Actively receiving updates from AI specialists.";
    if (secondsSinceLastEvent <= 25)
      return "Still working. A specialist is likely processing a longer step.";
    return "Long-running analysis in progress. This is normal for deep codebase scans.";
  }, [loading, lastDiscoveryDurationSec, events.length, secondsSinceLastEvent]);

  // ── Handlers ─────────────────────────────────────────

  const handleCancelDiscovery = (): void => {
    void cancelDiscovery();
  };

  const handleStartDiscovery = (): void => {
    // projectPath is empty for now; discovery can function without it
    void startDiscovery("");
  };

  const handleContinueDiscovery = (): void => {
    void continueDiscovery();
  };

  const handleCopyPrdInput = async (): Promise<void> => {
    if (!interview) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(interview.prdInputDraft);
        setCopyNotice("PRD input copied to clipboard.");
        toastService.success("PRD input copied to clipboard.");
      } else {
        setCopyNotice("Clipboard API not available in this environment.");
        toastService.warning("Clipboard API not available in this environment.");
      }
    } catch {
      setCopyNotice("Failed to copy PRD input.");
      toastService.error("Failed to copy PRD input.");
    }
  };

  const handleUsePlanInput = (): void => {
    if (!interview) return;
    // Navigate to plan list view with PRD text in location state.
    // The plan creation UI (when built) will read this state to pre-fill.
    navigate("/", { state: { prdText: interview.prdInputDraft } });
  };

  // ── Render ───────────────────────────────────────────

  return (
    <section className={styles.view}>
      {/* ── Resume dialog ─────────────────────────── */}
      {showResumeDialog && activeSessions.length > 0 ? (
        <div className={styles.resumeOverlay}>
          <div className={styles.resumeDialog} role="dialog" aria-label="Resume discovery session">
            <h3 className={styles.resumeTitle}>Active Discovery Session Found</h3>
            <div className={styles.resumeSessionList}>
              {activeSessions.map((session: DiscoverySessionSummary) => (
                <div key={session.id} className={styles.resumeSessionItem}>
                  <div className={styles.resumeSessionInfo}>
                    <p className={styles.resumeSessionSeed}>
                      {session.seedSentence.length > 80
                        ? `${session.seedSentence.slice(0, 80)}...`
                        : session.seedSentence}
                    </p>
                    <div className={styles.resumeSessionMeta}>
                      <span>Round {session.roundNumber}</span>
                      <span>Readiness: {session.readinessScore}%</span>
                      {session.projectPath ? (
                        <span>
                          {session.projectPath.length > 40
                            ? `...${session.projectPath.slice(-40)}`
                            : session.projectPath}
                        </span>
                      ) : null}
                      <span>
                        Updated: {new Date(session.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className={styles.resumeSessionActions}>
                    <UButton
                      variant="primary"
                      size="sm"
                      onClick={() => handleResumeSession(session.id)}
                    >
                      Resume
                    </UButton>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.resumeDialogFooter}>
              <UButton variant="ghost" onClick={handleStartFresh}>
                Start Fresh (abandon all)
              </UButton>
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.sections}>
        {/* ── Header ─────────────────────────────────── */}
        <div>
          <h2>Interactive PRD Discovery</h2>
          <p className={styles.headerNotice}>
            Write one short goal sentence. AI specialists will inspect the project
            (if path is set), ask detailed questions, and build a ready-to-use PRD
            input draft.
          </p>
        </div>

        {/* ── Seed sentence + optional context ────────── */}
        <div className={styles.inputSection}>
          <UTextArea
            label="Goal Sentence"
            value={seedSentence}
            onChange={(e) => setSeedSentence(e.target.value)}
            placeholder="Example: improve API reliability and deployment confidence without breaking public endpoints."
            autoResize
          />

          <details>
            <summary className={styles.advancedToggle}>Optional Context</summary>
            <div className={styles.advancedContent}>
              <UTextArea
                label="Additional Context (optional)"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="Business context, deadlines, constraints, known issues, etc."
                autoResize
              />
            </div>
          </details>

          <div className={styles.actions}>
            <UButton
              variant="secondary"
              onClick={handleStartDiscovery}
              loading={loading}
            >
              {loading ? "Starting Discovery..." : "Start Discovery Interview"}
            </UButton>
            <UButton variant="ghost" onClick={reset}>
              Reset Discovery
            </UButton>
          </div>
        </div>

        {/* ── Error notice ────────────────────────────── */}
        {error ? <p className={styles.errorText}>{error}</p> : null}

        {/* ── Discovery skeleton (initial analysis, no events yet) ── */}
        {loading && !interview && events.length === 0 ? (
          <div className={styles.discoverySkeleton}>
            <div className={styles.discoverySkeletonHeader}>
              <USkeleton variant="text" width="45%" height="1.3em" />
              <USkeleton variant="text" width="80px" height="1.3em" />
            </div>
            <USkeleton variant="text" lines={2} />
            <div className={styles.discoverySkeletonCards}>
              <div className={styles.discoverySkeletonCard}>
                <USkeleton variant="text" width="60%" height="1.1em" />
                <USkeleton variant="text" lines={3} />
              </div>
              <div className={styles.discoverySkeletonCard}>
                <USkeleton variant="text" width="50%" height="1.1em" />
                <USkeleton variant="text" lines={2} />
              </div>
              <div className={styles.discoverySkeletonCard}>
                <USkeleton variant="text" width="55%" height="1.1em" />
                <USkeleton variant="text" lines={2} />
              </div>
            </div>
            <p className={styles.discoverySkeletonNotice}>
              Specialist agents are analyzing the project. Results will stream in shortly.
            </p>
          </div>
        ) : null}

        {/* ── AI Feedback panel (live events) ─────────── */}
        {loading || events.length > 0 ? (
          <div className={styles.feedbackCard}>
            <div className={styles.feedbackHeader}>
              <h3>AI Feedback (Live)</h3>
              <div className={styles.feedbackHeaderActions}>
                <div className={styles.thinkingIndicator}>
                  <span className={styles.thinkingPulse} />
                  <span>
                    {loading
                      ? `Thinking for ${formatDuration(thinkingElapsedSec)}`
                      : "Idle"}
                  </span>
                  {loading ? (
                    <span className={styles.thinkingDots} aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : null}
                </div>
                {loading ? (
                  <UButton
                    variant="danger"
                    size="sm"
                    onClick={handleCancelDiscovery}
                  >
                    Cancel Discovery
                  </UButton>
                ) : null}
              </div>
            </div>
            <div className={styles.metaRow}>
              <span>Events: {events.length}</span>
              <span>
                {secondsSinceLastEvent === null
                  ? "Last update: waiting..."
                  : `Last update: ${secondsSinceLastEvent}s ago`}
              </span>
              <span>
                Specialists: {specialistProgress.completed}/
                {Math.max(5, specialistProgress.started)} done
              </span>
            </div>

            {/* Specialist progress tracker */}
            {specialistProgress.started > 0 ? (
              <div className={styles.specialistTracker}>
                {specialistProgress.startedNames.map((name) => {
                  const isDone = specialistProgress.completedNames.includes(name);
                  return (
                    <div
                      key={name}
                      className={cn(
                        styles.specialistItem,
                        isDone ? styles.specialistDone : styles.specialistRunning
                      )}
                    >
                      <span className={styles.specialistDot} />
                      <span className={styles.specialistName}>{name}</span>
                      <span className={styles.specialistStatus}>
                        {isDone ? "done" : "running"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <p
              className={cn(
                styles.statusText,
                loading && (secondsSinceLastEvent ?? 0) > 20 && styles.warningText
              )}
            >
              {liveStatusText}
            </p>
            <pre className={styles.logBox}>{liveFeedbackText}</pre>
          </div>
        ) : null}

        {/* ── Discovery output ready card ─────────────── */}
        {!loading && interview ? (
          <div className={styles.feedbackCard}>
            <div className={styles.outputHeader}>
              <h3>Discovery Output Ready</h3>
              <UStatusPill status="completed" label="ready" />
            </div>
            <p className={styles.headerNotice}>
              PRD Input has been auto-updated.
              {lastReadyAtIso ? (
                <span className={styles.readyTimestamp}>
                  {" "}
                  ({new Date(lastReadyAtIso).toLocaleTimeString()})
                </span>
              ) : null}
            </p>
            <div className={styles.actions}>
              <UButton variant="primary" onClick={handleUsePlanInput}>
                Use as Plan Input
              </UButton>
              <UButton
                variant="ghost"
                onClick={() => void handleCopyPrdInput()}
              >
                Copy PRD Input
              </UButton>
            </div>
          </div>
        ) : null}

        {/* ── Interview state panels ──────────────────── */}
        {interview ? (
          <>
            {/* Status card */}
            <div className={styles.statusCard}>
              <div className={styles.statusHeader}>
                <h3>Discovery Status</h3>
                <UStatusPill
                  status={readinessStatus(interview.readinessScore)}
                  label={readinessBadge(interview.readinessScore)}
                />
              </div>
              <div className={styles.metaRow}>
                <span>Round: {interview.round}</span>
                <span>Readiness: {interview.readinessScore}%</span>
                <span>
                  Questions answered this round: {currentRoundAnswered}/
                  {interview.questions.length}
                </span>
              </div>
              <p className={styles.directionText}>
                <strong>Direction:</strong> {interview.directionSummary}
              </p>
            </div>

            {/* Inferred context */}
            <div className={styles.contextCard}>
              <h3>Inferred Context</h3>
              <p className={styles.contextField}>
                <strong>Stack:</strong> {interview.inferredContext.stack}
              </p>
              <p className={styles.contextField}>
                <strong>Documentation:</strong>{" "}
                {interview.inferredContext.documentation}
              </p>
              <p className={styles.contextField}>
                <strong>Scope:</strong> {interview.inferredContext.scope}
              </p>

              {interview.inferredContext.painPoints.length > 0 ? (
                <>
                  <h4>Likely Pain Points</h4>
                  <ul className={styles.contextList}>
                    {interview.inferredContext.painPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {interview.inferredContext.constraints.length > 0 ? (
                <>
                  <h4>Likely Constraints</h4>
                  <ul className={styles.contextList}>
                    {interview.inferredContext.constraints.map((constraint) => (
                      <li key={constraint}>{constraint}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {interview.inferredContext.signals.length > 0 ? (
                <>
                  <h4>Signals</h4>
                  <ul className={styles.contextList}>
                    {interview.inferredContext.signals.map((signal) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>

            {/* Question cards */}
            <div className={styles.questionsCard}>
              <h3>Detailed Questions</h3>
              {interview.questions.length > 0 ? (
                <ul className={styles.questionList}>
                  {interview.questions.map((question) => (
                    <li key={question.id} className={styles.questionItem}>
                      <div className={styles.questionText}>
                        {question.question}
                      </div>
                      <p className={styles.questionReason}>
                        Why this matters: {question.reason}
                      </p>
                      <UTextArea
                        value={answerMap[question.id] ?? ""}
                        onChange={(e) =>
                          setAnswer(question.id, e.target.value)
                        }
                        placeholder="Your answer..."
                        autoResize
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.noQuestions}>
                  No more questions right now. The draft is likely ready for
                  planning.
                </p>
              )}
            </div>

            {/* Missing critical info */}
            {interview.missingCriticalInfo.length > 0 ? (
              <div className={styles.missingCard}>
                <h3>Missing Critical Info</h3>
                <ul className={styles.missingList}>
                  {interview.missingCriticalInfo.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Bottom actions */}
            <div className={styles.bottomActions}>
              <UButton
                variant="secondary"
                onClick={handleContinueDiscovery}
                loading={loading}
                disabled={loading || interview.questions.length === 0}
              >
                {loading
                  ? "Updating Discovery..."
                  : "Submit Answers And Continue"}
              </UButton>
              <UButton variant="primary" onClick={handleUsePlanInput}>
                Use as Plan Input
              </UButton>
              <UButton
                variant="ghost"
                onClick={() => void handleCopyPrdInput()}
              >
                Copy PRD Input
              </UButton>
            </div>

            {copyNotice ? (
              <p className={styles.copyNotice}>{copyNotice}</p>
            ) : null}

            {/* PRD preview */}
            <details>
              <summary className={styles.prdPreviewToggle}>
                Preview Generated PRD Input
              </summary>
              <pre className={styles.prdPreview}>
                {interview.prdInputDraft}
              </pre>
            </details>
          </>
        ) : null}
      </div>
    </section>
  );
}
