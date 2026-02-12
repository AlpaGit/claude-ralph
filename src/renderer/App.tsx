import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { RalphPlan, RalphTask, RunEvent, TaskRun, TodoItem } from "@shared/types";
import { PromptTemplateBuilder } from "./components/PromptTemplateBuilder";

type RunLogState = Record<string, string[]>;
type TodoState = Record<string, TodoItem[]>;
type WindowWithOptionalApi = Window & { ralphApi?: typeof window.ralphApi };

function getRalphApi(): typeof window.ralphApi | null {
  return (window as WindowWithOptionalApi).ralphApi ?? null;
}

function statusClass(status: string): string {
  return `status-pill status-${status}`;
}

function taskRunMap(runs: TaskRun[]): Map<string, TaskRun> {
  const map = new Map<string, TaskRun>();
  for (const run of runs) {
    if (!map.has(run.taskId)) {
      map.set(run.taskId, run);
    }
  }
  return map;
}

export function App(): JSX.Element {
  const [projectPath, setProjectPath] = useState("");
  const [prdText, setPrdText] = useState("");
  const [plan, setPlan] = useState<RalphPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [runLogs, setRunLogs] = useState<RunLogState>({});
  const [runTodos, setRunTodos] = useState<TodoState>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [recentEvents, setRecentEvents] = useState<RunEvent[]>([]);

  const reloadPlan = useCallback(async (planId: string) => {
    const api = getRalphApi();
    if (!api) {
      throw new Error("Preload bridge is unavailable. Check Electron preload configuration.");
    }

    const latest = await api.getPlan(planId);
    setPlan(latest);
  }, []);

  const loadPlanFromId = useCallback(
    async (planId: string) => {
      try {
        setError(null);
        await reloadPlan(planId);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Failed to load plan.";
        setError(message);
      }
    },
    [reloadPlan]
  );

  useEffect(() => {
    const api = getRalphApi();
    if (!api) {
      setError("Preload bridge is unavailable (`window.ralphApi` is undefined).");
      return;
    }

    const unsubscribe = api.onRunEvent((event) => {
      setRecentEvents((current) => [event, ...current].slice(0, 25));

      if (event.type === "started") {
        setSelectedRunId(event.runId);
      }

      if (event.type === "log") {
        const line = String((event.payload as { line?: string })?.line ?? "");
        if (line.trim().length > 0) {
          setRunLogs((current) => ({
            ...current,
            [event.runId]: [...(current[event.runId] ?? []), line]
          }));
        }
      }

      if (event.type === "todo_update") {
        const todos = (event.payload as { todos?: TodoItem[] })?.todos ?? [];
        setRunTodos((current) => ({
          ...current,
          [event.runId]: todos
        }));
      }

      if (
        event.type === "task_status" ||
        event.type === "completed" ||
        event.type === "failed" ||
        event.type === "cancelled"
      ) {
        void loadPlanFromId(event.planId);
      }
    });

    return unsubscribe;
  }, [loadPlanFromId]);

  const latestRunByTask = useMemo(() => (plan ? taskRunMap(plan.runs) : new Map()), [plan]);

  const selectedRun = useMemo(
    () => (plan?.runs ?? []).find((run) => run.id === selectedRunId) ?? null,
    [plan, selectedRunId]
  );

  const handleCreatePlan = async (): Promise<void> => {
    const api = getRalphApi();
    if (!api) {
      setError("Preload bridge is unavailable (`window.ralphApi` is undefined).");
      return;
    }

    try {
      setCreatingPlan(true);
      setError(null);
      const created = await api.createPlan({
        prdText,
        projectPath
      });
      await loadPlanFromId(created.planId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to create plan.";
      setError(message);
    } finally {
      setCreatingPlan(false);
    }
  };

  const handleRunTask = async (task: RalphTask): Promise<void> => {
    if (!plan) {
      return;
    }
    const api = getRalphApi();
    if (!api) {
      setError("Preload bridge is unavailable (`window.ralphApi` is undefined).");
      return;
    }

    try {
      setError(null);
      const result = await api.runTask({
        planId: plan.id,
        taskId: task.id
      });
      setSelectedRunId(result.runId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to run task.";
      setError(message);
    }
  };

  const handleRunAll = async (): Promise<void> => {
    if (!plan) {
      return;
    }
    const api = getRalphApi();
    if (!api) {
      setError("Preload bridge is unavailable (`window.ralphApi` is undefined).");
      return;
    }

    try {
      setError(null);
      await api.runAll({
        planId: plan.id
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to run queue.";
      setError(message);
    }
  };

  const handleCancelSelectedRun = async (): Promise<void> => {
    if (!selectedRunId) {
      return;
    }
    const api = getRalphApi();
    if (!api) {
      setError("Preload bridge is unavailable (`window.ralphApi` is undefined).");
      return;
    }

    try {
      await api.cancelRun({ runId: selectedRunId });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to cancel run.";
      setError(message);
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-badge">RALPH ORCHESTRATOR</div>
        <h1>Discovery To Ralph Loop</h1>
        <p>
          Start with a short goal sentence, run an AI discovery interview, generate PRD input, then execute
          checklist tasks one-by-one in isolated Ralph runs.
        </p>
      </header>

      <section className="panel plan-input">
        <PromptTemplateBuilder
          projectPath={projectPath}
          onUsePrompt={(generatedPrompt) => {
            setPrdText(generatedPrompt);
          }}
        />

        <div className="panel-header">
          <h2>Plan Builder</h2>
        </div>

        <label className="label" htmlFor="project-path">
          Project Path
        </label>
        <input
          id="project-path"
          className="text-input"
          value={projectPath}
          onChange={(event) => setProjectPath(event.target.value)}
          placeholder="C:\\path\\to\\repo (recommended for stack inference + Ralph execution)"
        />

        <label className="label" htmlFor="prd-input">
          PRD Input
        </label>
        <textarea
          id="prd-input"
          className="text-area"
          value={prdText}
          onChange={(event) => setPrdText(event.target.value)}
          placeholder="Paste PRD content here..."
        />

        <button
          className="action-btn primary"
          onClick={() => void handleCreatePlan()}
          disabled={creatingPlan || prdText.trim().length < 20}
        >
          {creatingPlan ? "Generating..." : "Generate Ralph Plan"}
        </button>
      </section>

      {error ? <section className="panel error-panel">{error}</section> : null}

      {plan ? (
        <section className="layout-grid">
          <article className="panel">
            <div className="panel-header">
              <h2>Plan Overview</h2>
              <span className={statusClass(plan.status)}>{plan.status}</span>
            </div>
            <p>{plan.summary}</p>
            <div className="meta-row">
              <span>Project: {plan.projectPath}</span>
              <span>Tasks: {plan.tasks.length}</span>
              <span>Runs: {plan.runs.length}</span>
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <h2>Technical Pack</h2>
            </div>
            <div className="two-col">
              <div>
                <h3>Architecture</h3>
                <ul>
                  {plan.technicalPack.architecture_notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Risks</h3>
                <ul>
                  {plan.technicalPack.risks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Dependencies</h3>
                <ul>
                  {plan.technicalPack.dependencies.map((dependency) => (
                    <li key={dependency}>{dependency}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Test Strategy</h3>
                <ul>
                  {plan.technicalPack.test_strategy.map((strategy) => (
                    <li key={strategy}>{strategy}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>

          <article className="panel checklist-panel">
            <div className="panel-header">
              <h2>Checklist</h2>
              <button className="action-btn secondary" onClick={() => void handleRunAll()}>
                Run Next Available Tasks
              </button>
            </div>
            <div className="task-list">
              {plan.tasks.map((task) => {
                const lastRun = latestRunByTask.get(task.id);
                return (
                  <div key={task.id} className="task-card">
                    <div className="task-header">
                      <strong>
                        #{task.ordinal} {task.title}
                      </strong>
                      <span className={statusClass(task.status)}>{task.status}</span>
                    </div>
                    <p>{task.description}</p>
                    <div className="meta-row">
                      <span>ID: {task.id}</span>
                      <span>
                        Depends on: {task.dependencies.length > 0 ? task.dependencies.join(", ") : "none"}
                      </span>
                    </div>
                    {task.acceptanceCriteria.length > 0 ? (
                      <ul className="acceptance-list">
                        {task.acceptanceCriteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="notes">{task.technicalNotes}</p>
                    <div className="task-actions">
                      <button className="action-btn primary" onClick={() => void handleRunTask(task)}>
                        Run Task
                      </button>
                      {lastRun ? (
                        <button
                          className="action-btn ghost"
                          onClick={() => {
                            setSelectedRunId(lastRun.id);
                          }}
                        >
                          Open Latest Run
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="panel run-panel">
            <div className="panel-header">
              <h2>Live Run</h2>
              <div className="panel-header-actions">
                {selectedRun ? <span className={statusClass(selectedRun.status)}>{selectedRun.status}</span> : null}
                <button className="action-btn danger" onClick={() => void handleCancelSelectedRun()}>
                  Cancel Run
                </button>
              </div>
            </div>

            {selectedRun ? (
              <div className="run-content">
                <div className="meta-row">
                  <span>Run: {selectedRun.id}</span>
                  <span>Task: {selectedRun.taskId}</span>
                  <span>Stop reason: {selectedRun.stopReason ?? "n/a"}</span>
                </div>

                <h3>Todo Snapshot</h3>
                <ul>
                  {(runTodos[selectedRun.id] ?? []).map((todo, index) => (
                    <li key={`${todo.content}-${index}`}>
                      <strong>[{todo.status}]</strong> {todo.activeForm || todo.content}
                    </li>
                  ))}
                </ul>

                <h3>Streamed Logs</h3>
                <pre className="log-box">{(runLogs[selectedRun.id] ?? []).join("") || "No streamed logs yet."}</pre>

                {selectedRun.resultText ? (
                  <>
                    <h3>Final Result</h3>
                    <pre className="log-box">{selectedRun.resultText}</pre>
                  </>
                ) : null}
              </div>
            ) : (
              <p>Select a run to inspect live logs and completion details.</p>
            )}
          </article>

          <article className="panel">
            <div className="panel-header">
              <h2>Recent Events</h2>
            </div>
            <ul className="event-list">
              {recentEvents.map((event) => (
                <li key={event.id}>
                  <span>{event.ts}</span>
                  <span>{event.type}</span>
                  <span>{event.taskId}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>
      ) : null}
    </main>
  );
}
