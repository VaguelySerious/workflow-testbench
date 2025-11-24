"use client";

import { useState, useEffect } from "react";
import { WORKFLOW_DEFINITIONS } from "@/app/workflows/definitions";
import { WorkflowButton } from "@/components/workflow-button";
import { TerminalLog, type LogEntry } from "@/components/terminal-log";

const STORAGE_KEY = "workflow-logs";

export default function Home() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runningWorkflows, setRunningWorkflows] = useState<Set<string>>(
    new Set()
  );

  // Load logs from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setLogs(
          parsed.map((log: LogEntry) => ({
            ...log,
            timestamp: new Date(log.timestamp),
          }))
        );
      } catch (error) {
        console.error("Failed to parse stored logs:", error);
      }
    }
  }, []);

  // Save logs to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }, [logs]);

  const addLog = (type: LogEntry["type"], message: string, runId?: string) => {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type,
      message,
      runId,
    };
    setLogs((prev) => [...prev, entry]);
  };

  const clearLogs = () => {
    setLogs([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const startWorkflow = async (workflowName: string, args: unknown[]) => {
    addLog("info", `Starting workflow: ${workflowName}`);

    try {
      const response = await fetch("/api/workflows/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflowName,
          args,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        addLog(
          "error",
          `Failed to start workflow: ${error.error || "Unknown error"}${
            error.details ? ` - ${error.details}` : ""
          }`
        );
        return;
      }

      const runId = response.headers.get("X-Workflow-Run-Id");
      if (!runId) {
        addLog("error", "No run ID returned from server");
        return;
      }

      addLog("info", `Started run ${runId}`, runId);
      setRunningWorkflows((prev) => new Set(prev).add(workflowName));

      // Read the stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((line) => line.trim());

            for (const line of lines) {
              addLog("stream", line, runId);
            }
          }
        } catch (streamError) {
          addLog(
            "error",
            `Stream error: ${
              streamError instanceof Error
                ? streamError.message
                : String(streamError)
            }`,
            runId
          );
        }
      }

      // Wait for the workflow result
      await awaitWorkflowResult(runId, workflowName);
    } catch (error) {
      addLog(
        "error",
        `Error starting workflow: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const awaitWorkflowResult = async (runId: string, workflowName: string) => {
    try {
      const response = await fetch("/api/workflows/await", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ runId }),
      });

      if (!response.ok) {
        const error = await response.json();
        addLog(
          "error",
          `Failed to await workflow result: ${error.error || "Unknown error"}${
            error.details ? ` - ${error.details}` : ""
          }`,
          runId
        );
      } else {
        const data = await response.json();
        addLog(
          "result",
          `Workflow completed: ${JSON.stringify(data.result)}`,
          runId
        );
      }
    } catch (error) {
      addLog(
        "error",
        `Error awaiting workflow result: ${
          error instanceof Error ? error.message : String(error)
        }`,
        runId
      );
    } finally {
      setRunningWorkflows((prev) => {
        const next = new Set(prev);
        next.delete(workflowName);
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            Workflow DevKit Examples
          </h1>
          <p className="text-muted-foreground text-lg">
            Select a workflow to start a run and view its output in the terminal
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Workflow List */}
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Available Workflows</h2>
            <div className="grid grid-cols-1 gap-4 max-h-[calc(100vh-280px)] overflow-y-auto pr-2">
              {WORKFLOW_DEFINITIONS.map((workflow) => (
                <WorkflowButton
                  key={workflow.name}
                  workflow={workflow}
                  isRunning={runningWorkflows.has(workflow.name)}
                  onStart={startWorkflow}
                />
              ))}
            </div>
          </div>

          {/* Right Column - Terminal Log */}
          <div className="h-[calc(100vh-200px)]">
            <TerminalLog logs={logs} onClear={clearLogs} />
          </div>
        </div>
      </div>
    </div>
  );
}
