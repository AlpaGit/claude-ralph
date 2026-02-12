// @vitest-environment jsdom

/**
 * Unit tests for discoveryStore (Zustand store) — batch state management.
 *
 * Tests cover:
 * - Initial batch state (currentBatchIndex, skippedQuestions)
 * - setCurrentBatchIndex setter
 * - setAnswer with plain string
 * - setAnswer with string[] (multi-select JSON serialization)
 * - skipQuestion action (add to skippedQuestions, clear answer)
 * - skipQuestion idempotency (no duplicate IDs)
 * - submitBatch: sends only non-empty answers, excludes skipped questions
 * - submitBatch: all-skipped sends empty answers array
 * - submitBatch: resets batch state on success (currentBatchIndex=0, skippedQuestions=[])
 * - submitBatch: builds fresh answer map from next state
 * - submitBatch: accumulates submittedAnswers across rounds
 * - submitBatch: sets error when no interview active
 * - submitBatch: handles API error gracefully
 * - continueDiscovery: resets batch state on success
 * - continueDiscovery: merges answer map (keeps existing answers)
 * - startDiscovery: resets batch state
 * - resumeSession: initializes batch state to 0/[]
 * - reset: clears batch state
 *
 * All tests mock window.ralphApi via installMockRalphApi and reset store
 * state between tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { installMockRalphApi, type MockRalphApi } from "../../../src/test-utils/mock-ralph-api";

// Mock the toastService to avoid react-hot-toast DOM operations in jsdom
vi.mock("../../../src/renderer/services/toastService", () => ({
  toastService: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Must import the store AFTER mocking toastService and installing the API
import { useDiscoveryStore } from "../../../src/renderer/stores/discoveryStore";
import type { DiscoveryInterviewState, DiscoveryQuestion } from "@shared/types";

// ── Helpers ──────────────────────────────────────────────

function makeQuestion(overrides?: Partial<DiscoveryQuestion>): DiscoveryQuestion {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    question: "What is your preferred tech stack?",
    reason: "Understanding the stack helps shape architecture recommendations.",
    question_type: "multiple_choice",
    options: ["React + Node", "Vue + Python", "Angular + Java", "Svelte + Go"],
    recommendedOption: "React + Node",
    selectionMode: "single",
    ...overrides,
  };
}

function makeInterviewState(
  overrides?: Partial<DiscoveryInterviewState>
): DiscoveryInterviewState {
  return {
    sessionId: "sess-001",
    round: 1,
    directionSummary: "A web application for task management",
    inferredContext: {
      stack: "React + Node",
      documentation: "Minimal",
      scope: "MVP",
      painPoints: ["No existing architecture"],
      constraints: ["Must ship in 2 weeks"],
      signals: ["Solo developer"],
    },
    questions: [
      makeQuestion({ id: "q1" }),
      makeQuestion({ id: "q2", selectionMode: "multi" }),
      makeQuestion({ id: "q3" }),
    ],
    prdInputDraft: "A web application for task management with real-time collaboration features and user authentication. The system should support multiple workspaces and integrate with common third-party services.",
    readinessScore: 35,
    missingCriticalInfo: ["Authentication strategy", "Deployment target"],
    ...overrides,
  };
}

/** Build a round-2 interview state with new question IDs. */
function makeRound2State(): DiscoveryInterviewState {
  return makeInterviewState({
    round: 2,
    readinessScore: 65,
    questions: [
      makeQuestion({ id: "q4" }),
      makeQuestion({ id: "q5" }),
      makeQuestion({ id: "q6" }),
    ],
    missingCriticalInfo: ["Deployment target"],
  });
}

/** Initial (clean) state for the discoveryStore (data-only fields). */
const initialState = {
  projectPath: "",
  seedSentence: "",
  additionalContext: "",
  interview: null,
  answerMap: {},
  submittedAnswers: [],
  events: [],
  loading: false,
  error: null,
  thinkingStartedAtMs: null,
  lastEventAtMs: null,
  lastDiscoveryDurationSec: null,
  lastReadyAtIso: null,
  copyNotice: null,
  currentBatchIndex: 0,
  skippedQuestions: [],
  activeSessions: [],
  checkingSessions: false,
};

// ── Tests ──────────────────────────────────────────────

describe("discoveryStore — batch state management", () => {
  let api: MockRalphApi;

  beforeEach(() => {
    api = installMockRalphApi();
    useDiscoveryStore.setState(initialState);
  });

  // ── Initial state ──────────────────────────────────

  describe("initial batch state", () => {
    it("should have currentBatchIndex = 0", () => {
      expect(useDiscoveryStore.getState().currentBatchIndex).toBe(0);
    });

    it("should have empty skippedQuestions", () => {
      expect(useDiscoveryStore.getState().skippedQuestions).toEqual([]);
    });
  });

  // ── setCurrentBatchIndex ───────────────────────────

  describe("setCurrentBatchIndex", () => {
    it("should set currentBatchIndex to the given value", () => {
      useDiscoveryStore.getState().setCurrentBatchIndex(2);
      expect(useDiscoveryStore.getState().currentBatchIndex).toBe(2);
    });

    it("should allow setting back to 0", () => {
      useDiscoveryStore.getState().setCurrentBatchIndex(1);
      useDiscoveryStore.getState().setCurrentBatchIndex(0);
      expect(useDiscoveryStore.getState().currentBatchIndex).toBe(0);
    });
  });

  // ── setAnswer ──────────────────────────────────────

  describe("setAnswer", () => {
    it("should store a plain string answer", () => {
      useDiscoveryStore.getState().setAnswer("q1", "React + Node");
      expect(useDiscoveryStore.getState().answerMap["q1"]).toBe("React + Node");
    });

    it("should JSON.stringify a string[] (multi-select)", () => {
      useDiscoveryStore.getState().setAnswer("q2", ["React + Node", "Vue + Python"]);
      const stored = useDiscoveryStore.getState().answerMap["q2"];
      expect(stored).toBe(JSON.stringify(["React + Node", "Vue + Python"]));
      // Should be valid JSON that parses back to the array
      expect(JSON.parse(stored)).toEqual(["React + Node", "Vue + Python"]);
    });

    it("should overwrite a previous answer", () => {
      useDiscoveryStore.getState().setAnswer("q1", "React + Node");
      useDiscoveryStore.getState().setAnswer("q1", "Vue + Python");
      expect(useDiscoveryStore.getState().answerMap["q1"]).toBe("Vue + Python");
    });

    it("should handle empty array for multi-select", () => {
      useDiscoveryStore.getState().setAnswer("q2", []);
      expect(useDiscoveryStore.getState().answerMap["q2"]).toBe("[]");
    });
  });

  // ── skipQuestion ───────────────────────────────────

  describe("skipQuestion", () => {
    it("should add question ID to skippedQuestions", () => {
      useDiscoveryStore.getState().skipQuestion("q1");
      expect(useDiscoveryStore.getState().skippedQuestions).toEqual(["q1"]);
    });

    it("should set answer to empty string for skipped question", () => {
      // First set an answer, then skip
      useDiscoveryStore.getState().setAnswer("q1", "React + Node");
      useDiscoveryStore.getState().skipQuestion("q1");
      expect(useDiscoveryStore.getState().answerMap["q1"]).toBe("");
    });

    it("should not duplicate question ID when skipped twice", () => {
      useDiscoveryStore.getState().skipQuestion("q1");
      useDiscoveryStore.getState().skipQuestion("q1");
      expect(useDiscoveryStore.getState().skippedQuestions).toEqual(["q1"]);
    });

    it("should allow skipping multiple distinct questions", () => {
      useDiscoveryStore.getState().skipQuestion("q1");
      useDiscoveryStore.getState().skipQuestion("q3");
      expect(useDiscoveryStore.getState().skippedQuestions).toEqual(["q1", "q3"]);
    });
  });

  // ── submitBatch ────────────────────────────────────

  describe("submitBatch", () => {
    it("should set error when no interview is active", async () => {
      await useDiscoveryStore.getState().submitBatch();
      expect(useDiscoveryStore.getState().error).toBe("No active discovery session.");
    });

    it("should send only non-empty answers (excluding skipped)", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      // Set up store with an active interview and partial answers
      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "React + Node", q2: "", q3: "My custom answer" },
      });

      // Skip q2 (it already has empty answer, but explicitly skip it)
      useDiscoveryStore.getState().skipQuestion("q2");

      await useDiscoveryStore.getState().submitBatch();

      // Should have called continueDiscovery with non-empty answers only
      expect(api.continueDiscovery).toHaveBeenCalledTimes(1);
      const callArgs = api.continueDiscovery.mock.calls[0][0];
      expect(callArgs.sessionId).toBe("sess-001");
      expect(callArgs.answers).toEqual([
        { questionId: "q1", answer: "React + Node" },
        { questionId: "q3", answer: "My custom answer" },
      ]);
      // Skipped q2 should NOT appear in answers (no empty string entry)
    });

    it("should send empty answers array when all questions are skipped", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "", q2: "", q3: "" },
      });

      // Skip all questions
      useDiscoveryStore.getState().skipQuestion("q1");
      useDiscoveryStore.getState().skipQuestion("q2");
      useDiscoveryStore.getState().skipQuestion("q3");

      await useDiscoveryStore.getState().submitBatch();

      const callArgs = api.continueDiscovery.mock.calls[0][0];
      expect(callArgs.answers).toEqual([]);
    });

    it("should correctly send JSON-serialized multi-select answers", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({ interview: round1, answerMap: {} });

      // Set multi-select answer (serialized as JSON string)
      useDiscoveryStore.getState().setAnswer("q1", "Single choice");
      useDiscoveryStore.getState().setAnswer("q2", ["Option A", "Option B"]);
      useDiscoveryStore.getState().skipQuestion("q3");

      await useDiscoveryStore.getState().submitBatch();

      const callArgs = api.continueDiscovery.mock.calls[0][0];
      expect(callArgs.answers).toEqual([
        { questionId: "q1", answer: "Single choice" },
        { questionId: "q2", answer: JSON.stringify(["Option A", "Option B"]) },
      ]);
    });

    it("should reset currentBatchIndex to 0 on success", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
        currentBatchIndex: 2,
      });

      await useDiscoveryStore.getState().submitBatch();

      expect(useDiscoveryStore.getState().currentBatchIndex).toBe(0);
    });

    it("should clear skippedQuestions on success", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "", q3: "answer3" },
      });
      useDiscoveryStore.getState().skipQuestion("q2");

      await useDiscoveryStore.getState().submitBatch();

      expect(useDiscoveryStore.getState().skippedQuestions).toEqual([]);
    });

    it("should build a fresh answer map from the new interview state", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
      });

      await useDiscoveryStore.getState().submitBatch();

      const answerMap = useDiscoveryStore.getState().answerMap;
      // Should have fresh empty entries for new questions only
      expect(answerMap).toEqual({ q4: "", q5: "", q6: "" });
      // Old question IDs should NOT be present
      expect(answerMap).not.toHaveProperty("q1");
      expect(answerMap).not.toHaveProperty("q2");
      expect(answerMap).not.toHaveProperty("q3");
    });

    it("should accumulate submittedAnswers across multiple rounds", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "a1", q2: "a2", q3: "" },
        submittedAnswers: [{ questionId: "q-prev", answer: "prev-answer" }],
      });

      await useDiscoveryStore.getState().submitBatch();

      const submitted = useDiscoveryStore.getState().submittedAnswers;
      expect(submitted).toHaveLength(3); // 1 prior + 2 new (q3 was empty)
      expect(submitted[0]).toEqual({ questionId: "q-prev", answer: "prev-answer" });
      expect(submitted[1]).toEqual({ questionId: "q1", answer: "a1" });
      expect(submitted[2]).toEqual({ questionId: "q2", answer: "a2" });
    });

    it("should update interview to the next state", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
      });

      await useDiscoveryStore.getState().submitBatch();

      expect(useDiscoveryStore.getState().interview).toBe(round2);
      expect(useDiscoveryStore.getState().interview?.round).toBe(2);
    });

    it("should set loading=true during API call and loading=false after", async () => {
      const round1 = makeInterviewState();
      let resolvePromise: (value: DiscoveryInterviewState) => void;
      const pendingPromise = new Promise<DiscoveryInterviewState>((resolve) => {
        resolvePromise = resolve;
      });
      api.continueDiscovery.mockReturnValue(pendingPromise);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
      });

      const promise = useDiscoveryStore.getState().submitBatch();
      expect(useDiscoveryStore.getState().loading).toBe(true);

      resolvePromise!(makeRound2State());
      await promise;

      expect(useDiscoveryStore.getState().loading).toBe(false);
    });

    it("should handle API error gracefully", async () => {
      const round1 = makeInterviewState();
      api.continueDiscovery.mockRejectedValue(new Error("Network error"));

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
      });

      await useDiscoveryStore.getState().submitBatch();

      const state = useDiscoveryStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toBeTruthy();
      // Interview should remain unchanged
      expect(state.interview).toBe(round1);
    });

    it("should set success notice and toast on success", async () => {
      const { toastService } = await import("../../../src/renderer/services/toastService");
      const round1 = makeInterviewState();
      api.continueDiscovery.mockResolvedValue(makeRound2State());

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
      });

      await useDiscoveryStore.getState().submitBatch();

      expect(useDiscoveryStore.getState().copyNotice).toBe(
        "Batch submitted. Next questions are ready."
      );
      expect(toastService.success).toHaveBeenCalledWith(
        "Batch submitted. Next questions ready."
      );
    });
  });

  // ── continueDiscovery ──────────────────────────────

  describe("continueDiscovery — batch state reset", () => {
    it("should reset currentBatchIndex and skippedQuestions on success", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
        currentBatchIndex: 2,
        skippedQuestions: ["q2"],
      });

      await useDiscoveryStore.getState().continueDiscovery();

      expect(useDiscoveryStore.getState().currentBatchIndex).toBe(0);
      expect(useDiscoveryStore.getState().skippedQuestions).toEqual([]);
    });

    it("should merge answer map (keep existing + add new empty entries)", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
      });

      await useDiscoveryStore.getState().continueDiscovery();

      const map = useDiscoveryStore.getState().answerMap;
      // Old answers should be preserved
      expect(map["q1"]).toBe("answer1");
      expect(map["q2"]).toBe("answer2");
      expect(map["q3"]).toBe("answer3");
      // New questions get empty entries
      expect(map["q4"]).toBe("");
      expect(map["q5"]).toBe("");
      expect(map["q6"]).toBe("");
    });

    it("should require at least one answer", async () => {
      const round1 = makeInterviewState();
      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "", q2: "", q3: "" },
      });

      await useDiscoveryStore.getState().continueDiscovery();

      expect(api.continueDiscovery).not.toHaveBeenCalled();
      expect(useDiscoveryStore.getState().error).toBe(
        "Answer at least one question before continuing."
      );
    });
  });

  // ── startDiscovery ─────────────────────────────────

  describe("startDiscovery — batch state reset", () => {
    it("should reset batch state when starting a new discovery", async () => {
      const round1 = makeInterviewState();
      api.startDiscovery.mockResolvedValue(round1);

      // Set dirty batch state
      useDiscoveryStore.setState({
        seedSentence: "Build a task management app",
        currentBatchIndex: 2,
        skippedQuestions: ["old-q1", "old-q2"],
      });

      await useDiscoveryStore.getState().startDiscovery();

      expect(useDiscoveryStore.getState().currentBatchIndex).toBe(0);
      expect(useDiscoveryStore.getState().skippedQuestions).toEqual([]);
    });

    it("should build fresh answer map from returned questions", async () => {
      const round1 = makeInterviewState();
      api.startDiscovery.mockResolvedValue(round1);

      useDiscoveryStore.setState({
        seedSentence: "Build a task management app",
      });

      await useDiscoveryStore.getState().startDiscovery();

      expect(useDiscoveryStore.getState().answerMap).toEqual({
        q1: "",
        q2: "",
        q3: "",
      });
    });
  });

  // ── resumeSession ──────────────────────────────────

  describe("resumeSession — batch state initialization", () => {
    it("should initialize batch state to 0/[] when resuming", async () => {
      const round1 = makeInterviewState({ round: 3, readinessScore: 50 });
      api.resumeDiscoverySession.mockResolvedValue(round1);

      // Set dirty batch state to prove it gets reset
      useDiscoveryStore.setState({
        currentBatchIndex: 2,
        skippedQuestions: ["old-q"],
        activeSessions: [
          {
            id: "sess-001",
            projectPath: "/test/project",
            seedSentence: "Build a task app",
            roundNumber: 3,
            readinessScore: 50,
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      });

      await useDiscoveryStore.getState().resumeSession("sess-001");

      expect(useDiscoveryStore.getState().currentBatchIndex).toBe(0);
      expect(useDiscoveryStore.getState().skippedQuestions).toEqual([]);
    });

    it("should build fresh answer map from resumed questions", async () => {
      const round1 = makeInterviewState();
      api.resumeDiscoverySession.mockResolvedValue(round1);

      useDiscoveryStore.setState({
        activeSessions: [
          {
            id: "sess-001",
            projectPath: "/test/project",
            seedSentence: "Build a task app",
            roundNumber: 1,
            readinessScore: 35,
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      });

      await useDiscoveryStore.getState().resumeSession("sess-001");

      expect(useDiscoveryStore.getState().answerMap).toEqual({
        q1: "",
        q2: "",
        q3: "",
      });
    });
  });

  // ── reset ──────────────────────────────────────────

  describe("reset — batch state cleanup", () => {
    it("should reset batch state to initial values", () => {
      useDiscoveryStore.setState({
        currentBatchIndex: 2,
        skippedQuestions: ["q1", "q2"],
        answerMap: { q1: "some answer" },
        interview: makeInterviewState(),
      });

      useDiscoveryStore.getState().reset();

      expect(useDiscoveryStore.getState().currentBatchIndex).toBe(0);
      expect(useDiscoveryStore.getState().skippedQuestions).toEqual([]);
      expect(useDiscoveryStore.getState().answerMap).toEqual({});
      expect(useDiscoveryStore.getState().interview).toBeNull();
    });
  });
});
