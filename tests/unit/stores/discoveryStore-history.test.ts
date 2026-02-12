// @vitest-environment jsdom

/**
 * Unit tests for discoveryStore — history / back-navigation.
 *
 * Tests cover:
 * - Initial history state (empty history, viewingHistoryIndex = null)
 * - History snapshot pushed on submitBatch success
 * - History snapshot pushed on continueDiscovery success
 * - Snapshot contains correct round, interview, answerMap, readinessScore
 * - Multiple rounds accumulate history entries
 * - viewingHistoryIndex reset to null after each advance
 * - navigateToRound: sets viewingHistoryIndex correctly
 * - navigateToRound: rejects out-of-bounds index (negative, beyond length)
 * - returnToCurrent: clears viewingHistoryIndex to null
 * - startDiscovery: clears history and viewingHistoryIndex
 * - resumeSession: clears history and viewingHistoryIndex
 * - reset: clears history and viewingHistoryIndex
 * - History entries are immutable snapshots (answerMap is a copy)
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
    sessionId: "sess-hist-001",
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
    prdInputDraft: "A web application for task management.",
    readinessScore: 35,
    missingCriticalInfo: ["Authentication strategy", "Deployment target"],
    ...overrides,
  };
}

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

function makeRound3State(): DiscoveryInterviewState {
  return makeInterviewState({
    round: 3,
    readinessScore: 88,
    questions: [
      makeQuestion({ id: "q7" }),
      makeQuestion({ id: "q8" }),
    ],
    missingCriticalInfo: [],
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
  history: [],
  viewingHistoryIndex: null,
};

// ── Tests ──────────────────────────────────────────────

describe("discoveryStore — history / back-navigation", () => {
  let api: MockRalphApi;

  beforeEach(() => {
    api = installMockRalphApi();
    useDiscoveryStore.setState(initialState);
  });

  // ── Initial state ──────────────────────────────────

  describe("initial history state", () => {
    it("should have empty history array", () => {
      expect(useDiscoveryStore.getState().history).toEqual([]);
    });

    it("should have viewingHistoryIndex = null", () => {
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });
  });

  // ── History snapshot on submitBatch ─────────────────

  describe("submitBatch — history snapshot", () => {
    it("should push a history snapshot when submitBatch succeeds", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "React + Node", q2: "", q3: "Custom answer" },
      });

      await useDiscoveryStore.getState().submitBatch();

      const { history } = useDiscoveryStore.getState();
      expect(history).toHaveLength(1);
    });

    it("snapshot should contain the previous round's interview state", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "React + Node", q2: "", q3: "Custom answer" },
      });

      await useDiscoveryStore.getState().submitBatch();

      const snapshot = useDiscoveryStore.getState().history[0];
      expect(snapshot.round).toBe(1);
      expect(snapshot.interview).toBe(round1);
      expect(snapshot.readinessScore).toBe(35);
    });

    it("snapshot should contain a copy of the answer map", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      const originalAnswerMap = { q1: "React + Node", q2: "", q3: "Custom answer" };
      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { ...originalAnswerMap },
      });

      await useDiscoveryStore.getState().submitBatch();

      const snapshot = useDiscoveryStore.getState().history[0];
      expect(snapshot.answerMap).toEqual(originalAnswerMap);
    });

    it("snapshot should have a completedAtIso timestamp", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
      });

      const before = new Date().toISOString();
      await useDiscoveryStore.getState().submitBatch();
      const after = new Date().toISOString();

      const snapshot = useDiscoveryStore.getState().history[0];
      expect(snapshot.completedAtIso).toBeTruthy();
      expect(snapshot.completedAtIso >= before).toBe(true);
      expect(snapshot.completedAtIso <= after).toBe(true);
    });

    it("should reset viewingHistoryIndex to null after submitBatch", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
        viewingHistoryIndex: 0, // Simulate user was viewing a past round
      });

      await useDiscoveryStore.getState().submitBatch();

      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });

    it("should NOT push history when submitBatch fails", async () => {
      const round1 = makeInterviewState();
      api.continueDiscovery.mockRejectedValue(new Error("Network error"));

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "answer1", q2: "answer2", q3: "answer3" },
      });

      await useDiscoveryStore.getState().submitBatch();

      expect(useDiscoveryStore.getState().history).toHaveLength(0);
    });
  });

  // ── Multiple rounds ────────────────────────────────

  describe("multiple rounds — history accumulation", () => {
    it("should accumulate history entries across multiple rounds", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      const round3 = makeRound3State();

      // Round 1 → Round 2
      api.continueDiscovery.mockResolvedValue(round2);
      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "a1", q2: "a2", q3: "a3" },
      });
      await useDiscoveryStore.getState().submitBatch();

      // Round 2 → Round 3
      api.continueDiscovery.mockResolvedValue(round3);
      useDiscoveryStore.setState({
        ...useDiscoveryStore.getState(),
        answerMap: { q4: "a4", q5: "a5", q6: "a6" },
      });
      await useDiscoveryStore.getState().submitBatch();

      const { history } = useDiscoveryStore.getState();
      expect(history).toHaveLength(2);
      expect(history[0].round).toBe(1);
      expect(history[0].readinessScore).toBe(35);
      expect(history[1].round).toBe(2);
      expect(history[1].readinessScore).toBe(65);
    });

    it("current interview should be the latest round", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      const round3 = makeRound3State();

      // Round 1 → Round 2
      api.continueDiscovery.mockResolvedValue(round2);
      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "a1", q2: "a2", q3: "a3" },
      });
      await useDiscoveryStore.getState().submitBatch();

      // Round 2 → Round 3
      api.continueDiscovery.mockResolvedValue(round3);
      useDiscoveryStore.setState({
        ...useDiscoveryStore.getState(),
        answerMap: { q4: "a4", q5: "a5", q6: "a6" },
      });
      await useDiscoveryStore.getState().submitBatch();

      expect(useDiscoveryStore.getState().interview?.round).toBe(3);
    });
  });

  // ── navigateToRound ────────────────────────────────

  describe("navigateToRound", () => {
    it("should set viewingHistoryIndex to the given index", () => {
      // Set up history with one entry
      useDiscoveryStore.setState({
        history: [
          {
            round: 1,
            interview: makeInterviewState(),
            answerMap: { q1: "a1" },
            readinessScore: 35,
            completedAtIso: "2025-01-01T00:00:00.000Z",
          },
        ],
      });

      useDiscoveryStore.getState().navigateToRound(0);
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBe(0);
    });

    it("should reject negative index", () => {
      useDiscoveryStore.setState({
        history: [
          {
            round: 1,
            interview: makeInterviewState(),
            answerMap: { q1: "a1" },
            readinessScore: 35,
            completedAtIso: "2025-01-01T00:00:00.000Z",
          },
        ],
      });

      useDiscoveryStore.getState().navigateToRound(-1);
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });

    it("should reject index >= history.length", () => {
      useDiscoveryStore.setState({
        history: [
          {
            round: 1,
            interview: makeInterviewState(),
            answerMap: { q1: "a1" },
            readinessScore: 35,
            completedAtIso: "2025-01-01T00:00:00.000Z",
          },
        ],
      });

      useDiscoveryStore.getState().navigateToRound(1); // Only index 0 is valid
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });

    it("should reject index when history is empty", () => {
      useDiscoveryStore.getState().navigateToRound(0);
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });

    it("should allow navigating between multiple history entries", () => {
      useDiscoveryStore.setState({
        history: [
          {
            round: 1,
            interview: makeInterviewState(),
            answerMap: { q1: "a1" },
            readinessScore: 35,
            completedAtIso: "2025-01-01T00:00:00.000Z",
          },
          {
            round: 2,
            interview: makeRound2State(),
            answerMap: { q4: "a4" },
            readinessScore: 65,
            completedAtIso: "2025-01-01T01:00:00.000Z",
          },
        ],
      });

      useDiscoveryStore.getState().navigateToRound(0);
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBe(0);

      useDiscoveryStore.getState().navigateToRound(1);
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBe(1);
    });
  });

  // ── returnToCurrent ────────────────────────────────

  describe("returnToCurrent", () => {
    it("should set viewingHistoryIndex to null", () => {
      useDiscoveryStore.setState({ viewingHistoryIndex: 0 });
      useDiscoveryStore.getState().returnToCurrent();
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });

    it("should be idempotent when already on current", () => {
      useDiscoveryStore.getState().returnToCurrent();
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });
  });

  // ── startDiscovery — history reset ─────────────────

  describe("startDiscovery — history reset", () => {
    it("should clear history when starting a new discovery", async () => {
      const round1 = makeInterviewState();
      api.startDiscovery.mockResolvedValue(round1);

      useDiscoveryStore.setState({
        seedSentence: "Build a task management app",
        history: [
          {
            round: 1,
            interview: makeInterviewState(),
            answerMap: { q1: "old" },
            readinessScore: 35,
            completedAtIso: "2025-01-01T00:00:00.000Z",
          },
        ],
        viewingHistoryIndex: 0,
      });

      await useDiscoveryStore.getState().startDiscovery();

      expect(useDiscoveryStore.getState().history).toEqual([]);
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });
  });

  // ── resumeSession — history reset ──────────────────

  describe("resumeSession — history reset", () => {
    it("should clear history when resuming a session", async () => {
      const round1 = makeInterviewState({ round: 3, readinessScore: 50 });
      api.resumeDiscoverySession.mockResolvedValue(round1);

      useDiscoveryStore.setState({
        history: [
          {
            round: 1,
            interview: makeInterviewState(),
            answerMap: { q1: "old" },
            readinessScore: 35,
            completedAtIso: "2025-01-01T00:00:00.000Z",
          },
        ],
        viewingHistoryIndex: 0,
        activeSessions: [
          {
            id: "sess-hist-001",
            projectPath: "/test/project",
            seedSentence: "Build a task app",
            roundNumber: 3,
            readinessScore: 50,
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      });

      await useDiscoveryStore.getState().resumeSession("sess-hist-001");

      expect(useDiscoveryStore.getState().history).toEqual([]);
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });
  });

  // ── reset — history cleanup ────────────────────────

  describe("reset — history cleanup", () => {
    it("should clear history and viewingHistoryIndex", () => {
      useDiscoveryStore.setState({
        history: [
          {
            round: 1,
            interview: makeInterviewState(),
            answerMap: { q1: "a1" },
            readinessScore: 35,
            completedAtIso: "2025-01-01T00:00:00.000Z",
          },
        ],
        viewingHistoryIndex: 0,
        interview: makeInterviewState(),
      });

      useDiscoveryStore.getState().reset();

      expect(useDiscoveryStore.getState().history).toEqual([]);
      expect(useDiscoveryStore.getState().viewingHistoryIndex).toBeNull();
    });
  });

  // ── Snapshot immutability ──────────────────────────

  describe("snapshot immutability", () => {
    it("answerMap in snapshot is a separate copy from current state", async () => {
      const round1 = makeInterviewState();
      const round2 = makeRound2State();
      api.continueDiscovery.mockResolvedValue(round2);

      useDiscoveryStore.setState({
        interview: round1,
        answerMap: { q1: "original", q2: "", q3: "" },
      });

      await useDiscoveryStore.getState().submitBatch();

      // Current answerMap should have new question IDs
      const currentMap = useDiscoveryStore.getState().answerMap;
      expect(currentMap).toHaveProperty("q4");
      expect(currentMap).not.toHaveProperty("q1");

      // Snapshot should still have original answers
      const snapshot = useDiscoveryStore.getState().history[0];
      expect(snapshot.answerMap).toHaveProperty("q1");
      expect(snapshot.answerMap.q1).toBe("original");
    });
  });
});
