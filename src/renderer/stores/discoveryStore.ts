import { create } from "zustand";
import type {
  DiscoveryAnswer,
  DiscoveryEvent,
  DiscoveryInterviewState,
  DiscoverySessionSummary,
  StartDiscoveryInput,
  ContinueDiscoveryInput,
} from "@shared/types";
import { toastService } from "../services/toastService";

/* ── Answer map: questionId -> answer text ─────────────── */

export type AnswerMap = Record<string, string>;

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

  // ── Session management ────────────────────────────────
  /** Active discovery sessions retrieved from the backend. */
  activeSessions: DiscoverySessionSummary[];
  /** Whether the active-sessions check is in progress. */
  checkingSessions: boolean;

  // ── Actions ──────────────────────────────────────────

  /** Update the seed sentence input. */
  setSeedSentence: (value: string) => void;
  /** Update the project path input. */
  setProjectPath: (value: string) => void;
  /** Update the additional context input. */
  setAdditionalContext: (value: string) => void;
  /** Update a single answer in the answer map. */
  setAnswer: (questionId: string, answer: string) => void;
  /** Set the copy notice. */
  setCopyNotice: (notice: string | null) => void;

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
  activeSessions: [] as DiscoverySessionSummary[],
  checkingSessions: false,
};

/* ── Store ─────────────────────────────────────────────── */

export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  ...initialState,

  // ── Simple setters ──────────────────────────────────

  setProjectPath: (value: string) => set({ projectPath: value }),
  setSeedSentence: (value: string) => set({ seedSentence: value }),
  setAdditionalContext: (value: string) => set({ additionalContext: value }),
  setAnswer: (questionId: string, answer: string) =>
    set((state) => ({ answerMap: { ...state.answerMap, [questionId]: answer } })),
  setCopyNotice: (notice: string | null) => set({ copyNotice: notice }),

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
      thinkingStartedAtMs: startedAt,
      lastDiscoveryDurationSec: null,
      lastEventAtMs: null,
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

      // Build initial answer map from the returned questions.
      const newAnswerMap: AnswerMap = {};
      for (const q of result.questions) {
        newAnswerMap[q.id] = "";
      }

      set({
        interview: result,
        answerMap: newAnswerMap,
        lastReadyAtIso: new Date().toISOString(),
        copyNotice: "Discovery output is ready. PRD Input has been updated.",
      });
      toastService.success("Discovery completed. PRD input is ready.");

      _discoveryUnsubscribe = unsubscribe;
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to start discovery.";
      set({ error: message });
      toastService.error(message);
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

    const startedAt = Date.now();
    set({
      loading: true,
      error: null,
      copyNotice: null,
      thinkingStartedAtMs: startedAt,
      lastDiscoveryDurationSec: null,
    });

    try {
      const api = getApi();
      const payload: ContinueDiscoveryInput = {
        sessionId: interview.sessionId,
        answers: answerPayload,
      };
      const nextState = await api.continueDiscovery(payload);

      // Merge new question IDs into answer map, keep existing answers.
      const mergedMap: AnswerMap = { ...answerMap };
      for (const q of nextState.questions) {
        if (!(q.id in mergedMap)) {
          mergedMap[q.id] = "";
        }
      }

      set((state) => ({
        interview: nextState,
        answerMap: mergedMap,
        submittedAnswers: [...state.submittedAnswers, ...answerPayload],
        lastReadyAtIso: new Date().toISOString(),
        copyNotice: "Discovery updated. PRD Input has been refreshed.",
      }));
      toastService.success("Discovery updated. PRD input refreshed.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to continue discovery.";
      set({ error: message });
      toastService.error(message);
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

      // Build answer map from the returned questions
      const newAnswerMap: AnswerMap = {};
      for (const q of state.questions) {
        newAnswerMap[q.id] = "";
      }

      set({
        interview: state,
        projectPath:
          get().activeSessions.find((session) => session.id === sessionId)?.projectPath ?? get().projectPath,
        seedSentence: state.directionSummary,
        answerMap: newAnswerMap,
        activeSessions: [],
        lastReadyAtIso: new Date().toISOString(),
        copyNotice: `Resumed discovery session (round ${state.round}).`,
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to resume discovery session.";
      set({ error: message });
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
