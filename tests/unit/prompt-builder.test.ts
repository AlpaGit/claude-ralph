/**
 * Unit tests for the PromptBuilder registry, parameter schemas, template
 * rendering, and the pre-populated singleton.
 *
 * These are the strongest feasible tests: the PromptBuilder is a pure
 * synchronous registry with Zod validation — no external dependencies,
 * no IPC, no Claude API calls. Every public method and edge case can be
 * tested directly.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { PromptBuilder, type PromptTemplate } from "../../src/main/runtime/prompts/prompt-builder";
import { prompts, PROMPT_NAMES, type PromptName } from "../../src/main/runtime/prompts";

// ---------------------------------------------------------------------------
// PromptBuilder class — core behavior
// ---------------------------------------------------------------------------

describe("PromptBuilder — core class", () => {
  it("registers a template and retrieves it by name", () => {
    const builder = new PromptBuilder();
    const schema = z.object({ name: z.string() });
    const template: PromptTemplate<typeof schema> = {
      description: "test template",
      schema,
      render: (p) => `Hello ${p.name}!`
    };

    builder.register("greet", template);

    expect(builder.has("greet")).toBe(true);
    expect(builder.get("greet")).toBeDefined();
    expect(builder.get("greet")?.description).toBe("test template");
  });

  it("render() validates params and returns the rendered string", () => {
    const builder = new PromptBuilder();
    const schema = z.object({ name: z.string().min(1) });
    builder.register("greet", {
      description: "greeting",
      schema,
      render: (p) => `Hello ${p.name}!`
    });

    const result = builder.render("greet", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("render() throws ZodError on invalid params", () => {
    const builder = new PromptBuilder();
    const schema = z.object({ name: z.string().min(1) });
    builder.register("greet", {
      description: "greeting",
      schema,
      render: (p) => `Hello ${p.name}!`
    });

    expect(() => builder.render("greet", { name: "" })).toThrow();
  });

  it("render() throws on unknown template name", () => {
    const builder = new PromptBuilder();
    expect(() => builder.render("nonexistent", {})).toThrow(
      'PromptBuilder: unknown template "nonexistent"'
    );
  });

  it("register() throws on duplicate template name", () => {
    const builder = new PromptBuilder();
    const schema = z.object({});
    const template: PromptTemplate<typeof schema> = {
      description: "a",
      schema,
      render: () => "a"
    };

    builder.register("foo", template);
    expect(() => builder.register("foo", template)).toThrow(
      'PromptBuilder: duplicate template name "foo"'
    );
  });

  it("has() returns false for unregistered names", () => {
    const builder = new PromptBuilder();
    expect(builder.has("nope")).toBe(false);
  });

  it("get() returns undefined for unregistered names", () => {
    const builder = new PromptBuilder();
    expect(builder.get("nope")).toBeUndefined();
  });

  it("list() returns all registered template names", () => {
    const builder = new PromptBuilder();
    const schema = z.object({});
    builder.register("a", { description: "a", schema, render: () => "a" });
    builder.register("b", { description: "b", schema, render: () => "b" });
    builder.register("c", { description: "c", schema, render: () => "c" });

    const names = builder.list();
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("list() returns empty array when no templates registered", () => {
    const builder = new PromptBuilder();
    expect(builder.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Singleton registry — completeness
// ---------------------------------------------------------------------------

describe("prompts singleton — registry completeness", () => {
  const allNames = Object.values(PROMPT_NAMES);

  it("has exactly 21 templates registered", () => {
    expect(prompts.list()).toHaveLength(21);
  });

  it("every PROMPT_NAMES constant is registered", () => {
    for (const name of allNames) {
      expect(prompts.has(name)).toBe(true);
    }
  });

  it("PROMPT_NAMES values are all unique strings", () => {
    const unique = new Set(allNames);
    expect(unique.size).toBe(allNames.length);
  });

  it("every registered template has a non-empty description", () => {
    for (const name of allNames) {
      const template = prompts.get(name);
      expect(template?.description).toBeTruthy();
      expect(typeof template?.description).toBe("string");
      expect(template!.description.length).toBeGreaterThan(10);
    }
  });

  it("every registered template has a Zod schema", () => {
    for (const name of allNames) {
      const template = prompts.get(name);
      expect(template?.schema).toBeDefined();
      // Verify it has a parse method (Zod schema duck check)
      expect(typeof template?.schema.parse).toBe("function");
    }
  });

  it("every registered template has a render function", () => {
    for (const name of allNames) {
      const template = prompts.get(name);
      expect(typeof template?.render).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// Discovery template rendering
// ---------------------------------------------------------------------------

describe("discovery templates — render output", () => {
  it("stack-refresh interpolates path and context", () => {
    const result = prompts.render(PROMPT_NAMES.STACK_REFRESH, {
      normalizedPath: "/projects/my-app",
      additionalContext: "uses React 19"
    });
    expect(result).toContain("/projects/my-app");
    expect(result).toContain("uses React 19");
    expect(result).toContain("Stack profile refresh request");
  });

  it("stack-refresh uses 'none' when additionalContext is empty", () => {
    const result = prompts.render(PROMPT_NAMES.STACK_REFRESH, {
      normalizedPath: "/path",
      additionalContext: ""
    });
    expect(result).toContain("none");
  });

  it("discovery-start interpolates all fields", () => {
    const result = prompts.render(PROMPT_NAMES.DISCOVERY_START, {
      seedSentence: "Build a task manager",
      additionalContext: "must be fast",
      projectPath: "/my/project",
      hasProjectPath: true
    });
    expect(result).toContain("Build a task manager");
    expect(result).toContain("must be fast");
    expect(result).toContain("/my/project");
    expect(result).toContain("existing codebase");
    expect(result).not.toContain("new/unspecified project");
  });

  it("discovery-start shows 'new/unspecified project' when hasProjectPath is false", () => {
    const result = prompts.render(PROMPT_NAMES.DISCOVERY_START, {
      seedSentence: "Build something",
      additionalContext: "",
      projectPath: "",
      hasProjectPath: false
    });
    expect(result).toContain("new/unspecified project");
  });

  it("discovery-continue interpolates answer history", () => {
    const result = prompts.render(PROMPT_NAMES.DISCOVERY_CONTINUE, {
      seedSentence: "Improve perf",
      additionalContext: "",
      projectPath: "/app",
      formattedAnswerHistory: "Q1: A1\nQ2: A2",
      formattedLatestAnswers: "Q3: A3"
    });
    expect(result).toContain("Q1: A1");
    expect(result).toContain("Q3: A3");
    expect(result).toContain("Continue discovery with follow-up answers");
  });

  it("discovery-orchestrator interpolates agent limits", () => {
    const result = prompts.render(PROMPT_NAMES.DISCOVERY_ORCHESTRATOR, {
      discoveryContext: "some context",
      projectPath: "/path",
      hasProjectPath: true,
      stackCacheSummary: "cached data",
      includeStackSpecialist: true,
      minAgents: 2,
      maxAgents: 6
    });
    expect(result).toContain("between 2 and 6 jobs");
    expect(result).toContain("Stack refresh required this round:\nyes");
  });

  it("discovery-synthesis includes specialist summaries", () => {
    const result = prompts.render(PROMPT_NAMES.DISCOVERY_SYNTHESIS, {
      discoveryContext: "the context",
      specialistSummary: "### stack-analyst\n{...}",
      failedSpecialistSummary: "none"
    });
    expect(result).toContain("### stack-analyst");
    expect(result).toContain("EXACTLY 3 high-impact clarification questions");
  });

  it("specialist-analysis interpolates jobId and objective", () => {
    const result = prompts.render(PROMPT_NAMES.SPECIALIST_ANALYSIS, {
      jobId: "prd-goal-analyst",
      discoveryContext: "context here",
      objective: "Clarify product objective"
    });
    expect(result).toContain('specialist agent "prd-goal-analyst"');
    expect(result).toContain("Clarify product objective");
  });

  it("infer-stack-existing includes project path", () => {
    const result = prompts.render(PROMPT_NAMES.INFER_STACK_EXISTING, {
      normalizedPath: "/my/project",
      projectGoal: "Desktop app",
      constraints: "Windows only",
      currentStack: "Electron"
    });
    expect(result).toContain("software architecture analyst");
    expect(result).toContain("/my/project");
    expect(result).toContain("Windows only");
  });

  it("infer-stack-new shows advisor role", () => {
    const result = prompts.render(PROMPT_NAMES.INFER_STACK_NEW, {
      projectGoal: "SaaS platform",
      constraints: "",
      currentStack: ""
    });
    expect(result).toContain("software architecture advisor for a new project");
    expect(result).toContain("SaaS platform");
  });
});

// ---------------------------------------------------------------------------
// Wizard template rendering
// ---------------------------------------------------------------------------

describe("wizard templates — render output", () => {
  it("wizard-guidance interpolates all step fields", () => {
    const result = prompts.render(PROMPT_NAMES.WIZARD_GUIDANCE, {
      stepId: "step-1",
      stepTitle: "Define Scope",
      stepGoal: "Clarify boundaries",
      stepCurrentData: "some data",
      stepNote: "important note",
      allStepsSummary: "1. [step-1] Define Scope\n...",
      draftPrompt: "Build a task manager..."
    });
    expect(result).toContain("step-1");
    expect(result).toContain("Define Scope");
    expect(result).toContain("Clarify boundaries");
    expect(result).toContain("important note");
    expect(result).toContain("Build a task manager...");
    expect(result).toContain("interactive PRD planning coach");
  });

  it("wizard-guidance uses 'none' for empty stepNote", () => {
    const result = prompts.render(PROMPT_NAMES.WIZARD_GUIDANCE, {
      stepId: "s1",
      stepTitle: "T",
      stepGoal: "G",
      stepCurrentData: "",
      stepNote: "",
      allStepsSummary: "",
      draftPrompt: ""
    });
    expect(result).toContain("note: none");
  });
});

// ---------------------------------------------------------------------------
// Planner template rendering
// ---------------------------------------------------------------------------

describe("planner templates — render output", () => {
  it("create-plan embeds PRD text", () => {
    const result = prompts.render(PROMPT_NAMES.CREATE_PLAN, {
      prdText: "# My PRD\n\nBuild a thing.",
      projectHistoryContext: "Prior task completed authentication."
    });
    expect(result).toContain("# My PRD");
    expect(result).toContain("Prior task completed authentication.");
    expect(result).toContain("Ralph planning engine");
  });

  it("create-plan shows 'none' when projectHistoryContext is empty", () => {
    const result = prompts.render(PROMPT_NAMES.CREATE_PLAN, {
      prdText: "PRD content",
      projectHistoryContext: ""
    });
    expect(result).toContain("none");
  });
});

// ---------------------------------------------------------------------------
// Task stage template rendering
// ---------------------------------------------------------------------------

describe("task stage templates — render output", () => {
  it("task-implementation includes context and injections", () => {
    const result = prompts.render(PROMPT_NAMES.TASK_IMPLEMENTATION, {
      taskContext: "Plan: build auth\nTask: implement login",
      retryInjection: "\nRetry #2\n",
      worktreeInjection: "\ncwd=/app, branch=feat-1\n"
    });
    expect(result).toContain("stage: implementation");
    expect(result).toContain("implement login");
    expect(result).toContain("Retry #2");
    expect(result).toContain("branch=feat-1");
    expect(result).toContain("Do NOT run git commit or git merge");
  });

  it("task-architecture-review includes review objectives and quality gate", () => {
    const result = prompts.render(PROMPT_NAMES.TASK_ARCHITECTURE_REVIEW, {
      taskContext: "Plan: refactor\nTask: extract module"
    });
    expect(result).toContain("stage: architecture-review");
    expect(result).toContain("SOLID");
    expect(result).toContain("SRP");
    expect(result).toContain("Quality gate rules");
    expect(result).toContain("needs_refactor");
  });

  it("task-architecture-refactor includes findings and actions", () => {
    const result = prompts.render(PROMPT_NAMES.TASK_ARCHITECTURE_REFACTOR, {
      taskContext: "context",
      architectureFindings: "- duplication in auth module",
      recommendedActions: "- Extract shared helper"
    });
    expect(result).toContain("duplication in auth module");
    expect(result).toContain("Extract shared helper");
    expect(result).toContain("stage: architecture-refactor");
  });

  it("task-tester includes testing policy", () => {
    const result = prompts.render(PROMPT_NAMES.TASK_TESTER, {
      taskContext: "test context"
    });
    expect(result).toContain("stage: tester");
    expect(result).toContain("integration/e2e/system tests");
    expect(result).toContain("Unit tests are fallback-only");
  });

  it("task-committer includes commit policy", () => {
    const result = prompts.render(PROMPT_NAMES.TASK_COMMITTER, {
      taskContext: "commit context",
      worktreeInjection: "\ncwd=/app\n"
    });
    expect(result).toContain("stage: committer");
    expect(result).toContain("Conventional Commits");
    expect(result).toContain("Co-authored-by");
    expect(result).toContain("cwd=/app");
  });

  it("phase-merge includes all merge parameters", () => {
    const result = prompts.render(PROMPT_NAMES.PHASE_MERGE, {
      cwd: "/repo",
      targetBranch: "main",
      phaseNumber: 3,
      branchesList: "1. feat-auth\n2. feat-db",
      mergeContext: "Both tasks completed successfully",
      validationCommands: "1. npm test\n2. npm run build"
    });
    expect(result).toContain("/repo");
    expect(result).toContain("main");
    expect(result).toContain("Phase number: 3");
    expect(result).toContain("feat-auth");
    expect(result).toContain("npm test");
    expect(result).toContain("no-fast-forward merge commits");
  });

  it("phase-stabilize includes stabilization parameters", () => {
    const result = prompts.render(PROMPT_NAMES.PHASE_STABILIZE, {
      cwd: "/repo",
      phaseNumber: 2,
      integrationBranch: "phase-2-integration",
      targetBranch: "main",
      contextSummary: "Phase 2 tasks done",
      validationCommands: "npm test"
    });
    expect(result).toContain("phase integration stabilization");
    expect(result).toContain("phase-2-integration");
    expect(result).toContain("Phase number: 2");
    expect(result).toContain("Phase 2 tasks done");
  });
});

// ---------------------------------------------------------------------------
// Subagent template rendering
// ---------------------------------------------------------------------------

describe("subagent templates — render output", () => {
  it("ralph-worker-impl returns implementation instructions", () => {
    const result = prompts.render(PROMPT_NAMES.SUBAGENT_RALPH_WORKER_IMPL, {});
    expect(result).toContain("implement only the requested task");
    expect(result).toContain("Do NOT run git commit or git merge");
  });

  it("ralph-worker-refactor returns refactor instructions", () => {
    const result = prompts.render(PROMPT_NAMES.SUBAGENT_RALPH_WORKER_REFACTOR, {});
    expect(result).toContain("targeted refactors");
    expect(result).toContain("Do NOT run git commit or git merge");
  });

  it("stack-architect returns stack inference instructions", () => {
    const result = prompts.render(PROMPT_NAMES.SUBAGENT_STACK_ARCHITECT, {});
    expect(result).toContain("technology stacks");
    expect(result).toContain("pragmatic defaults");
  });

  it("prd-interviewer returns interviewer instructions", () => {
    const result = prompts.render(PROMPT_NAMES.SUBAGENT_PRD_INTERVIEWER, {});
    expect(result).toContain("PRD interviewing specialist");
    expect(result).toContain("actionable, implementation-ready");
  });
});

// ---------------------------------------------------------------------------
// Schema validation — rejection cases
// ---------------------------------------------------------------------------

describe("prompt schema validation — rejection", () => {
  it("discovery-start rejects empty seedSentence", () => {
    expect(() =>
      prompts.render(PROMPT_NAMES.DISCOVERY_START, {
        seedSentence: "",
        additionalContext: "",
        projectPath: "",
        hasProjectPath: false
      })
    ).toThrow();
  });

  it("specialist-analysis rejects empty jobId", () => {
    expect(() =>
      prompts.render(PROMPT_NAMES.SPECIALIST_ANALYSIS, {
        jobId: "",
        discoveryContext: "context",
        objective: "obj"
      })
    ).toThrow();
  });

  it("task-implementation rejects missing taskContext", () => {
    expect(() =>
      prompts.render(PROMPT_NAMES.TASK_IMPLEMENTATION, {
        retryInjection: "",
        worktreeInjection: ""
      } as any)
    ).toThrow();
  });

  it("create-plan rejects empty prdText", () => {
    expect(() =>
      prompts.render(PROMPT_NAMES.CREATE_PLAN, {
        prdText: "",
        projectHistoryContext: ""
      })
    ).toThrow();
  });

  it("phase-merge rejects missing cwd", () => {
    expect(() =>
      prompts.render(PROMPT_NAMES.PHASE_MERGE, {
        cwd: "",
        targetBranch: "main",
        phaseNumber: 1,
        branchesList: "1. branch",
        mergeContext: "",
        validationCommands: ""
      })
    ).toThrow();
  });

  it("discovery-orchestrator rejects non-positive minAgents", () => {
    expect(() =>
      prompts.render(PROMPT_NAMES.DISCOVERY_ORCHESTRATOR, {
        discoveryContext: "ctx",
        projectPath: "",
        hasProjectPath: false,
        stackCacheSummary: "",
        includeStackSpecialist: false,
        minAgents: 0,
        maxAgents: 6
      })
    ).toThrow();
  });

  it("stack-refresh rejects empty normalizedPath", () => {
    expect(() =>
      prompts.render(PROMPT_NAMES.STACK_REFRESH, {
        normalizedPath: "",
        additionalContext: ""
      })
    ).toThrow();
  });

  it("wizard-guidance rejects empty stepId", () => {
    expect(() =>
      prompts.render(PROMPT_NAMES.WIZARD_GUIDANCE, {
        stepId: "",
        stepTitle: "T",
        stepGoal: "G",
        stepCurrentData: "",
        stepNote: "",
        allStepsSummary: "",
        draftPrompt: ""
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PROMPT_NAMES type safety
// ---------------------------------------------------------------------------

describe("PROMPT_NAMES — type safety", () => {
  it("all values match kebab-case or subagent-prefixed kebab-case", () => {
    const kebabPattern = /^(?:subagent-)?[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/;
    for (const name of Object.values(PROMPT_NAMES)) {
      expect(name).toMatch(kebabPattern);
    }
  });

  it("PromptName type accepts all PROMPT_NAMES values", () => {
    // TypeScript-level check: this should compile without error.
    const names: PromptName[] = Object.values(PROMPT_NAMES);
    expect(names.length).toBeGreaterThan(0);
  });
});
