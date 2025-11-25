import { useCallback } from "react";
import { useLocalStorage } from "./use-local-storage";
import type { LogEntry } from "@/components/terminal-log";
import type { Invocation, InvocationStatus } from "@/components/invocations-panel";

// Re-export types for convenience
export type { Invocation, InvocationStatus };

const STORAGE_KEY = "workflow-logs";
const INVOCATIONS_KEY = "workflow-invocations";

// Statuses that indicate an active/pending workflow that needs reconnection
const ACTIVE_STATUSES: InvocationStatus[] = ["invoked", "streaming", "reconnecting"];

// Statuses that should have an end time set
const TERMINAL_STATUSES: InvocationStatus[] = ["done", "error", "failed"];

/**
 * Hook for managing workflow logs with localStorage persistence
 */
export function useWorkflowLogs() {
  const [logs, setLogs, clearLogsStorage, isHydrated] = useLocalStorage<LogEntry[]>(
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

  return { logs, setLogs, addLog, clearLogs: clearLogsStorage, isLogsHydrated: isHydrated };
}

/**
 * Hook for managing workflow invocations with localStorage persistence
 * Automatically marks active invocations as "reconnecting" during deserialization
 */
export function useWorkflowInvocations() {
  const [invocations, setInvocations, clearInvocationsStorage, isHydrated] =
    useLocalStorage<Invocation[]>(INVOCATIONS_KEY, [], {
      deserializer: (value: string) => {
        const parsed = JSON.parse(value);
        // Mark any active invocations as "reconnecting" when loading from storage
        return parsed.map((inv: Invocation) => {
          const status = inv.status as InvocationStatus;
          return {
            ...inv,
            startTime: new Date(inv.startTime),
            endTime: inv.endTime ? new Date(inv.endTime) : undefined,
            // If the status was active (invoked/streaming), mark it as reconnecting
            status: ACTIVE_STATUSES.includes(status) && status !== "reconnecting"
              ? "reconnecting"
              : status,
          };
        });
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
    (
      runId: string,
      status: InvocationStatus,
      result?: unknown,
      error?: string
    ) => {
      setInvocations((prev) =>
        prev.map((inv) =>
          inv.runId === runId
            ? {
                ...inv,
                status,
                endTime: TERMINAL_STATUSES.includes(status)
                  ? new Date()
                  : inv.endTime,
                result: result !== undefined ? result : inv.result,
                error: error !== undefined ? error : inv.error,
              }
            : inv
        )
      );
    },
    [setInvocations]
  );

  const updateInvocationRunId = useCallback(
    (oldRunId: string, newRunId: string, newStatus?: InvocationStatus) => {
      setInvocations((prev) =>
        prev.map((inv) =>
          inv.runId === oldRunId
            ? {
                ...inv,
                runId: newRunId,
                status: newStatus ?? inv.status,
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
    updateInvocationRunId,
    clearInvocations: clearInvocationsStorage,
    isInvocationsHydrated: isHydrated,
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

  // Hydration is complete when both storage sources are hydrated
  const isHydrated = logsHook.isLogsHydrated && invocationsHook.isInvocationsHydrated;

  return {
    ...logsHook,
    ...invocationsHook,
    isHydrated,
    clearAll,
  };
}
