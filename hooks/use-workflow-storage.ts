import { useCallback } from "react";
import { useLocalStorage } from "./use-local-storage";
import type { LogEntry } from "@/components/terminal-log";
import type { Invocation } from "@/components/invocations-panel";

const STORAGE_KEY = "workflow-logs";
const INVOCATIONS_KEY = "workflow-invocations";

/**
 * Hook for managing workflow logs with localStorage persistence
 */
export function useWorkflowLogs() {
  const [logs, setLogs, clearLogsStorage] = useLocalStorage<LogEntry[]>(
    STORAGE_KEY,
    [],
    {
      deserializer: (value: string) => {
        const parsed = JSON.parse(value);
        return parsed.map((log: LogEntry) => ({
          ...log,
          timestamp: new Date(log.timestamp),
        }));
      },
    }
  );

  const addLog = useCallback(
    (type: LogEntry["type"], message: string, runId?: string) => {
      const entry: LogEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type,
        message,
        runId,
      };
      setLogs((prev) => [...prev, entry]);
    },
    [setLogs]
  );

  return { logs, setLogs, addLog, clearLogs: clearLogsStorage };
}

/**
 * Hook for managing workflow invocations with localStorage persistence
 */
export function useWorkflowInvocations() {
  const [invocations, setInvocations, clearInvocationsStorage] =
    useLocalStorage<Invocation[]>(INVOCATIONS_KEY, [], {
      deserializer: (value: string) => {
        const parsed = JSON.parse(value);
        return parsed.map((inv: Invocation) => ({
          ...inv,
          startTime: new Date(inv.startTime),
          endTime: inv.endTime ? new Date(inv.endTime) : undefined,
        }));
      },
    });

  const addInvocation = useCallback(
    (runId: string, workflowName: string) => {
      const invocation: Invocation = {
        runId,
        workflowName,
        status: "invoked",
        startTime: new Date(),
      };
      setInvocations((prev) => [invocation, ...prev]);
    },
    [setInvocations]
  );

  const updateInvocationStatus = useCallback(
    (runId: string, status: Invocation["status"], result?: unknown) => {
      setInvocations((prev) =>
        prev.map((inv) =>
          inv.runId === runId
            ? {
                ...inv,
                status,
                endTime:
                  status === "done" || status === "error"
                    ? new Date()
                    : inv.endTime,
                result: result !== undefined ? result : inv.result,
              }
            : inv
        )
      );
    },
    [setInvocations]
  );

  return {
    invocations,
    setInvocations,
    addInvocation,
    updateInvocationStatus,
    clearInvocations: clearInvocationsStorage,
  };
}

/**
 * Combined hook for all workflow storage needs
 */
export function useWorkflowStorage() {
  const logsHook = useWorkflowLogs();
  const invocationsHook = useWorkflowInvocations();

  const clearAll = useCallback(() => {
    logsHook.clearLogs();
    invocationsHook.clearInvocations();
  }, [logsHook, invocationsHook]);

  return {
    ...logsHook,
    ...invocationsHook,
    clearAll,
  };
}

