import { create } from "zustand";
import type {
  DiscoveryAnswer,
  DiscoveryEvent,
  DiscoveryInterviewState,
  DiscoverySessionSummary,
  StartDiscoveryInput,
  ContinueDiscoveryInput,
} from "@shared/types";
import { parseIpcError } from "../services/ipcErrorService";
import { toastService } from "../services/toastService";

/* ── Answer map: questionId -> answer text ─────────────── */

export type AnswerMap = Record<string, string>;

/* ── History snapshot for back-navigation ──────────────── */

/** A snapshot of a completed discovery round, used for back-navigation. */
export interface DiscoveryHistoryEntry {
  /** The round number (1-based) for this snapshot. */
  round: number;
  /** The interview state as it was when this round was active. */
  interview: DiscoveryInterviewState;
  /** The answer map as it was during this round. */
  answerMap: AnswerMap;
  /** The readiness score at this point. */
  readinessScore: number;
  /** ISO timestamp when this round completed. */
  completedAtIso: string;
}

/* ── State interface ───────────────────────────────────── */

interface DiscoveryState {
  // ── Input fields ─────────────────────────────────────
  /** Optional project path for repository-aware discovery. */
  projectPath: string;
  /** Seed sentence describing the project goal. */
  seedSentence: string;
  /** Optional additional context (business context, constraints, etc.). */
  additionalContext: string;

  // ── Interview state ──────────────────────────────────
  /** The current interview state returned by the backend. */
  interview: DiscoveryInterviewState | null;
  /** Answer map: questionId -> answer text for the current round. */
  answerMap: AnswerMap;
  /** Accumulated answers submitted across all rounds (DiscoveryAnswer[]). */
  submittedAnswers: DiscoveryAnswer[];
  /** Streamed discovery events (status, logs, agent messages). Newest first. */
  events: DiscoveryEvent[];

  // ── Loading / error ──────────────────────────────────
  /** Whether a discovery call is currently in flight. */
  loading: boolean;
  /** Last error message from any discovery operation. */
  error: string | null;

  // ── Timing ───────────────────────────────────────────
  /** Epoch ms when current thinking started (null when idle). */
  thinkingStartedAtMs: number | null;
  /** Epoch ms of last received discovery event (null before first event). */
  lastEventAtMs: number | null;
  /** Duration in seconds of the last completed discovery cycle. */
  lastDiscoveryDurationSec: number | null;
  /** ISO string of when interview was last ready. */
  lastReadyAtIso: string | null;

  // ── Notifications ────────────────────────────────────
  /** Transient copy / status notice shown to the user. */
  copyNotice: string | null;

  // ── Batch state ─────────────────────────────────────────
  /** Index of the current question within the batch (0-based, max 2 for 3 questions). */
  currentBatchIndex: number;
  /** Set of question IDs that were explicitly skipped by the user. */
  skippedQuestions: string[];

  // ── Session management ────────────────────────────────
  /** Active discovery sessions retrieved from the backend. */
  activeSessions: DiscoverySessionSummary[];
  /** Whether the active-sessions check is in progress. */
  checkingSessions: boolean;

  // ── History / back-navigation ──────────────────────────
  /** Stack of completed round snapshots for back-navigation. */
  history: DiscoveryHistoryEntry[];
  /**
   * When non-null, the user is viewing a past round snapshot.
   * Index into the `history` array. null means viewing the current (latest) round.
   */
  viewingHistoryIndex: number | null;

  // ── Actions ──────────────────────────────────────────

  /** Update the seed sentence input. */
  setSeedSentence: (value: string) => void;
  /** Update the project path input. */
  setProjectPath: (value: string) => void;
  /** Update the additional context input. */
  setAdditionalContext: (value: string) => void;
  /** Update a single answer in the answer map. Accepts a string or string[] (multi-select). */
  setAnswer: (questionId: string, answer: string | string[]) => void;
  /** Set the copy notice. */
  setCopyNotice: (notice: string | null) => void;
  /** Mark a question as skipped and record an empty sentinel in the answer map. */
  skipQuestion: (questionId: string) => void;
  /** Navigate to a specific question within the current batch (0-based). */
  setCurrentBatchIndex: (index: number) => void;
  /** Submit the current batch of answers (excluding skips) and advance to the next round. */
  submitBatch: () => Promise<void>;

  /** Start a new discovery interview session. */
  startDiscovery: () => Promise<void>;
  /** Continue the interview by submitting current answers. */
  continueDiscovery: () => Promise<void>;
  /** Check for active (resumable) discovery sessions. */
  checkActiveSessions: () => Promise<void>;
  /** Resume a persisted session by ID. Hydrates the store from latest_state_json. */
  resumeSession: (sessionId: string) => Promise<void>;
  /** Abandon (discard) a persisted session by ID. */
  abandonSession: (sessionId: string) => Promise<void>;
  /** Cancel an in-progress discovery session. */
  cancelDiscovery: () => Promise<void>;
  /**
   * Navigate to a past round snapshot by its index in the history array.
   * Sets viewingHistoryIndex so the UI renders the historical state.
   */
  navigateToRound: (historyIndex: number) => void;
  /**
   * Return to the current (latest) round, clearing the history view.
   */
  returnToCurrent: () => void;
  /** Reset the store to its initial state. */
  reset: () => void;
}

/* ── Helpers ───────────────────────────────────────────── */

function getApi(): typeof window.ralphApi {
  const api = window.ralphApi;
  if (!api) {
    throw new Error("Preload bridge is unavailable (window.ralphApi is undefined).");
  }
  return api;
}

/** Config for the shared continue-discovery call helper. */
interface ContinueCallConfig {
  /** Pre-built answer payload to send to the backend. */
  answerPayload: DiscoveryAnswer[];
  /** Build the next answer map from the returned interview state. */
  buildNextAnswerMap: (
    nextState: DiscoveryInterviewState,
    currentAnswerMap: AnswerMap
  ) => AnswerMap;
  /** Copy notice shown on success. */
  successNotice: string;
  /** Toast message shown on success. */
  successToast: string;
}

/**
 * Shared helper that executes a continueDiscovery API call with standardised
 * loading / error / timing lifecycle. Both submitBatch and continueDiscovery
 * delegate to this to avoid duplicating the guard, state-setup, error-handling,
 * and finally blocks.
 */
function executeContinueCall(
  config: ContinueCallConfig,
  set: (
    fn:
      | Partial<DiscoveryState>
      | ((state: DiscoveryState) => Partial<DiscoveryState>)
  ) => void,
  get: () => DiscoveryState
): Promise<void> {
  const { interview, answerMap } = get();
  if (!interview) {
    set({ error: "No active discovery session." });
    return Promise.resolve();
  }

  const { answerPayload, buildNextAnswerMap, successNotice, successToast } =
    config;

  const startedAt = Date.now();
  set({
    loading: true,
    error: null,
    copyNotice: null,
    thinkingStartedAtMs: startedAt,
    lastDiscoveryDurationSec: null,
  });

  const api = getApi();
  const payload: ContinueDiscoveryInput = {
    sessionId: interview.sessionId,
    answers: answerPayload,
  };

  return api
    .continueDiscovery(payload)
    .then((nextState) => {
      const nextMap = buildNextAnswerMap(nextState, answerMap);

      set((state) => {
        // Push a snapshot of the current round into history before advancing.
        const snapshot: DiscoveryHistoryEntry = {
          round: state.interview!.round,
          interview: state.interview!,
          answerMap: { ...state.answerMap },
          readinessScore: state.interview!.readinessScore,
          completedAtIso: new Date().toISOString(),
        };

        return {
          interview: nextState,
          answerMap: nextMap,
          submittedAnswers: [...state.submittedAnswers, ...answerPayload],
          currentBatchIndex: 0,
          skippedQuestions: [],
          lastReadyAtIso: new Date().toISOString(),
          copyNotice: successNotice,
          history: [...state.history, snapshot],
          viewingHistoryIndex: null,
        };
      });
      toastService.success(successToast);
    })
    .catch((caught) => {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message });
      toastService.error(ipcError.message, ipcError);
    })
    .finally(() => {
      set({
        loading: false,
        thinkingStartedAtMs: null,
        lastDiscoveryDurationSec: Math.max(
          0,
          Math.floor((Date.now() - startedAt) / 1000)
        ),
      });
    });
}

/* ── Answer-map builders ──────────────────────────────── */

/** Creates a fresh answer map with empty entries for every question. */
function buildFreshAnswerMap(nextState: DiscoveryInterviewState): AnswerMap {
  const map: AnswerMap = {};
  for (const q of nextState.questions) {
    map[q.id] = "";
  }
  return map;
}

/** Merges new question IDs into the existing answer map, keeping prior answers. */
function buildMergedAnswerMap(
  nextState: DiscoveryInterviewState,
  currentMap: AnswerMap
): AnswerMap {
  const merged: AnswerMap = { ...currentMap };
  for (const q of nextState.questions) {
    if (!(q.id in merged)) {
      merged[q.id] = "";
    }
  }
  return merged;
}

/* ── Initial state (data-only, no actions) ─────────────── */

const initialState = {
  projectPath: "",
  seedSentence: "",
  additionalContext: "",
  interview: null,
  answerMap: {} as AnswerMap,
  submittedAnswers: [] as DiscoveryAnswer[],
  events: [] as DiscoveryEvent[],
  loading: false,
  error: null as string | null,
  thinkingStartedAtMs: null as number | null,
  lastEventAtMs: null as number | null,
  lastDiscoveryDurationSec: null as number | null,
  lastReadyAtIso: null as string | null,
  copyNotice: null as string | null,
  currentBatchIndex: 0,
  skippedQuestions: [] as string[],
  activeSessions: [] as DiscoverySessionSummary[],
  checkingSessions: false,
  history: [] as DiscoveryHistoryEntry[],
  viewingHistoryIndex: null as number | null,
};

/* ── Store ─────────────────────────────────────────────── */

export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  ...initialState,

  // ── Simple setters ──────────────────────────────────

  setProjectPath: (value: string) => set({ projectPath: value }),
  setSeedSentence: (value: string) => set({ seedSentence: value }),
  setAdditionalContext: (value: string) => set({ additionalContext: value }),
  setAnswer: (questionId: string, answer: string | string[]) =>
    set((state) => ({
      answerMap: {
        ...state.answerMap,
        [questionId]: Array.isArray(answer) ? JSON.stringify(answer) : answer,
      },
    })),
  setCopyNotice: (notice: string | null) => set({ copyNotice: notice }),

  skipQuestion: (questionId: string) =>
    set((state) => ({
      skippedQuestions: state.skippedQuestions.includes(questionId)
        ? state.skippedQuestions
        : [...state.skippedQuestions, questionId],
      answerMap: { ...state.answerMap, [questionId]: "" },
    })),

  setCurrentBatchIndex: (index: number) => set({ currentBatchIndex: index }),

  // ── Submit batch ────────────────────────────────────

  submitBatch: async (): Promise<void> => {
    const { interview, answerMap } = get();
    if (!interview) {
      set({ error: "No active discovery session." });
      return;
    }

    // Collect only non-empty answers. Skipped questions are excluded from the
    // payload entirely — the backend .min(0) allows an empty array for
    // all-skipped batches, but individual entries must satisfy .min(1).
    const answerPayload: DiscoveryAnswer[] = interview.questions
      .map((q) => ({
        questionId: q.id,
        answer: (answerMap[q.id] ?? "").trim(),
      }))
      .filter((item) => item.answer.length > 0);

    return executeContinueCall(
      {
        answerPayload,
        buildNextAnswerMap: (nextState) => buildFreshAnswerMap(nextState),
        successNotice: "Batch submitted. Next questions are ready.",
        successToast: "Batch submitted. Next questions ready.",
      },
      set,
      get
    );
  },

  // ── Start discovery ─────────────────────────────────

  startDiscovery: async (): Promise<void> => {
    const { projectPath, seedSentence, additionalContext } = get();
    const brief = seedSentence.trim();

    if (brief.length < 5) {
      set({ error: "Please enter a short goal sentence (at least 5 characters)." });
      return;
    }

    const startedAt = Date.now();
    set({
      loading: true,
      error: null,
      copyNotice: null,
      submittedAnswers: [],
      events: [],
      currentBatchIndex: 0,
      skippedQuestions: [],
      thinkingStartedAtMs: startedAt,
      lastDiscoveryDurationSec: null,
      lastEventAtMs: null,
      history: [],
      viewingHistoryIndex: null,
    });

    try {
      const api = getApi();

      // Subscribe to discovery events for this session.
      const unsubscribe = api.onDiscoveryEvent((event: DiscoveryEvent) => {
        const parsedTs = Date.parse(event.ts);
        const eventMs = Number.isNaN(parsedTs) ? Date.now() : parsedTs;
        set((state) => ({
          events: [event, ...state.events].slice(0, 120),
          lastEventAtMs: eventMs,
        }));
      });

      const payload: StartDiscoveryInput = {
        projectPath: projectPath.trim(),
        seedSentence: brief,
        additionalContext: additionalContext.trim(),
      };
      const result = await api.startDiscovery(payload);

      set({
        interview: result,
        answerMap: buildFreshAnswerMap(result),
        currentBatchIndex: 0,
        skippedQuestions: [],
        lastReadyAtIso: new Date().toISOString(),
        copyNotice: "Discovery output is ready. PRD Input has been updated.",
      });
      toastService.success("Discovery completed. PRD input is ready.");

      _discoveryUnsubscribe = unsubscribe;
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message });
      toastService.error(ipcError.message, ipcError);
    } finally {
      set((state) => ({
        loading: false,
        thinkingStartedAtMs: null,
        lastDiscoveryDurationSec: Math.max(
          0,
          Math.floor((Date.now() - startedAt) / 1000)
        ),
      }));
    }
  },

  // ── Continue discovery ──────────────────────────────

  continueDiscovery: async (): Promise<void> => {
    const { interview, answerMap } = get();
    if (!interview) {
      set({ error: "No active discovery session." });
      return;
    }

    // Build answer payload from current answer map.
    const answerPayload: DiscoveryAnswer[] = interview.questions
      .map((q) => ({
        questionId: q.id,
        answer: (answerMap[q.id] ?? "").trim(),
      }))
      .filter((item) => item.answer.length > 0);

    if (answerPayload.length === 0) {
      set({ error: "Answer at least one question before continuing." });
      return;
    }

    return executeContinueCall(
      {
        answerPayload,
        buildNextAnswerMap: buildMergedAnswerMap,
        successNotice: "Discovery updated. PRD Input has been refreshed.",
        successToast: "Discovery updated. PRD input refreshed.",
      },
      set,
      get
    );
  },

  // ── Session management ─────────────────────────────

  checkActiveSessions: async (): Promise<void> => {
    set({ checkingSessions: true });
    try {
      const api = getApi();
      const sessions = await api.getDiscoverySessions();
      set({ activeSessions: sessions });
    } catch {
      // Non-critical: if this fails we simply show no resume dialog
      set({ activeSessions: [] });
    } finally {
      set({ checkingSessions: false });
    }
  },

  resumeSession: async (sessionId: string): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const api = getApi();
      const state = await api.resumeDiscoverySession({ sessionId });

      set({
        interview: state,
        projectPath:
          get().activeSessions.find((session) => session.id === sessionId)?.projectPath ?? get().projectPath,
        seedSentence: state.directionSummary,
        answerMap: buildFreshAnswerMap(state),
        currentBatchIndex: 0,
        skippedQuestions: [],
        activeSessions: [],
        lastReadyAtIso: new Date().toISOString(),
        copyNotice: `Resumed discovery session (round ${state.round}).`,
        // History is not available for resumed sessions — start fresh from current round
        history: [],
        viewingHistoryIndex: null,
      });
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message });
      toastService.error(ipcError.message, ipcError);
    } finally {
      set({ loading: false });
    }
  },

  abandonSession: async (sessionId: string): Promise<void> => {
    try {
      const api = getApi();
      await api.abandonDiscoverySession({ sessionId });
      set((state) => ({
        activeSessions: state.activeSessions.filter((s) => s.id !== sessionId),
      }));
    } catch {
      // Non-critical: UI can proceed even if abandon fails
    }
  },

  // ── Cancel discovery ────────────────────────────────

  cancelDiscovery: async (): Promise<void> => {
    const { interview } = get();
    if (!interview) return;

    try {
      const api = getApi();
      await api.cancelDiscovery({ sessionId: interview.sessionId });
    } catch {
      // Non-critical: the backend may have already completed or cleaned up
    }

    // Unsubscribe from discovery events
    if (_discoveryUnsubscribe) {
      _discoveryUnsubscribe();
      _discoveryUnsubscribe = null;
    }

    // Reset loading state but preserve the interview data if available
    set({
      loading: false,
      thinkingStartedAtMs: null,
      error: "Discovery cancelled.",
    });
  },

  // ── History navigation ──────────────────────────────

  navigateToRound: (historyIndex: number): void => {
    const { history } = get();
    if (historyIndex < 0 || historyIndex >= history.length) return;
    set({ viewingHistoryIndex: historyIndex });
  },

  returnToCurrent: (): void => {
    set({ viewingHistoryIndex: null });
  },

  // ── Reset ───────────────────────────────────────────

  reset: (): void => {
    if (_discoveryUnsubscribe) {
      _discoveryUnsubscribe();
      _discoveryUnsubscribe = null;
    }
    set(initialState);
  },
}));

/** Module-level holder for the discovery event unsubscribe callback. */
let _discoveryUnsubscribe: (() => void) | null = null;
