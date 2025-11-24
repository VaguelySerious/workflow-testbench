"use client";

import { useRef } from "react";
import { WORKFLOW_DEFINITIONS } from "@/app/workflows/definitions";
import { WorkflowButton } from "@/components/workflow-button";
import { TerminalLog } from "@/components/terminal-log";
import { InvocationsPanel } from "@/components/invocations-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkflowStorage } from "@/hooks";

export default function Home() {
	// Track active stream abort controllers
	const streamAbortControllers = useRef<Map<string, AbortController>>(
		new Map(),
	);

	// Use custom hooks for localStorage management
	const {
		logs,
		addLog,
		invocations,
		setInvocations,
		addInvocation,
		updateInvocationStatus,
		clearAll,
	} = useWorkflowStorage();

	const readStream = async (
		runId: string,
		reader: ReadableStreamDefaultReader<Uint8Array>,
	) => {
		const decoder = new TextDecoder();
		const abortController = new AbortController();
		streamAbortControllers.current.set(runId, abortController);

		try {
			while (true) {
				if (abortController.signal.aborted) {
					reader.cancel();
					break;
				}

				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				const lines = chunk.split("\n").filter((line) => line.trim());

				for (const line of lines) {
					addLog("stream", line, runId);
				}
			}

			if (!abortController.signal.aborted) {
				// Stream completed successfully
				updateInvocationStatus(runId, "stream_complete");
				addLog("info", "Stream completed", runId);
			}
		} catch (streamError) {
			if (!abortController.signal.aborted) {
				addLog(
					"error",
					`Stream error: ${
						streamError instanceof Error
							? streamError.message
							: String(streamError)
					}`,
					runId,
				);
				updateInvocationStatus(
					runId,
					"disconnected",
					undefined,
					streamError instanceof Error
						? streamError.message
						: String(streamError),
				);
			}
		} finally {
			streamAbortControllers.current.delete(runId);
		}
	};

	const startWorkflow = async (workflowName: string, args: unknown[]) => {
		let runId: string | null = null;

		try {
			// Create invocation with "invoked" status
			const tempId = `temp-${crypto.randomUUID()}`;
			addLog("info", `Starting workflow: ${workflowName}`);
			addInvocation(tempId, workflowName);

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
				const errorMsg = `${error.error || "Unknown error"}${
					error.details ? ` - ${error.details}` : ""
				}`;
				addLog("error", `Failed to start workflow: ${errorMsg}`);
				updateInvocationStatus(tempId, "error", undefined, errorMsg);
				return;
			}

			// Check if this is a streaming response or JSON response
			const contentType = response.headers.get("Content-Type");
			const isStream = contentType?.includes("text/event-stream");

			if (isStream) {
				// Streaming response
				runId = response.headers.get("X-Workflow-Run-Id");

				if (!runId) {
					const errorMsg = "No run ID returned from server";
					addLog("error", errorMsg);
					updateInvocationStatus(tempId, "error", undefined, errorMsg);
					return;
				}

				// Update with real run ID and "streaming" status
				setInvocations((prev) =>
					prev.map((inv) =>
						inv.runId === tempId
							? { ...inv, runId: runId as string, status: "streaming" as const }
							: inv,
					),
				);

				addLog("info", `Started run ${runId}`, runId);

				// Read the stream
				const reader = response.body?.getReader();
				if (reader) {
					await readStream(runId, reader);
				}
			} else {
				// JSON response
				const data = await response.json();
				runId = data.runId;

				if (!runId) {
					const errorMsg = "No run ID returned from server";
					addLog("error", errorMsg);
					updateInvocationStatus(tempId, "error", undefined, errorMsg);
					return;
				}

				// Update with real run ID
				setInvocations((prev) =>
					prev.map((inv) =>
						inv.runId === tempId
							? { ...inv, runId: runId as string, status: "streaming" as const }
							: inv,
					),
				);

				addLog("info", `Started run ${runId} (no stream available)`, runId);
			}

			// Wait for the workflow result
			await awaitWorkflowResult(runId);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			addLog("error", `Error starting workflow: ${errorMsg}`);
			if (runId) {
				updateInvocationStatus(runId, "error", undefined, errorMsg);
			}
		}
	};

	const disconnectStream = (runId: string) => {
		const controller = streamAbortControllers.current.get(runId);
		if (controller) {
			controller.abort();
			streamAbortControllers.current.delete(runId);
			updateInvocationStatus(runId, "disconnected");
			addLog("info", "Disconnected from stream", runId);
		}
	};

	const reconnectStream = async (runId: string) => {
		try {
			addLog("info", `Reconnecting to stream for run ${runId}`, runId);
			updateInvocationStatus(runId, "streaming");

			const response = await fetch("/api/workflows/stream", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ runId }),
			});

			if (!response.ok) {
				const error = await response.json();
				const errorMsg = `${error.error || "Unknown error"}${
					error.details ? ` - ${error.details}` : ""
				}`;
				addLog("error", `Failed to reconnect: ${errorMsg}`, runId);
				updateInvocationStatus(runId, "disconnected", undefined, errorMsg);
				return;
			}

			const reader = response.body?.getReader();
			if (reader) {
				await readStream(runId, reader);
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			addLog("error", `Error reconnecting to stream: ${errorMsg}`, runId);
			updateInvocationStatus(runId, "disconnected", undefined, errorMsg);
		}
	};

	const awaitWorkflowResult = async (runId: string) => {
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
				const errorMsg = `${error.error || "Unknown error"}${
					error.details ? ` - ${error.details}` : ""
				}`;
				addLog("error", `Failed to await workflow result: ${errorMsg}`, runId);
				updateInvocationStatus(runId, "error", undefined, errorMsg);
			} else {
				const data = await response.json();
				addLog(
					"result",
					`Workflow completed: ${JSON.stringify(data.result)}`,
					runId,
				);
				updateInvocationStatus(runId, "done", data.result);
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			addLog("error", `Error awaiting workflow result: ${errorMsg}`, runId);
			updateInvocationStatus(runId, "error", undefined, errorMsg);
		}
	};

	return (
		<TooltipProvider delayDuration={0}>
			<div className="min-h-screen bg-background p-6">
				<div className="max-w-[1800px] mx-auto space-y-6">
					<div className="space-y-1">
						<h1 className="text-3xl font-bold tracking-tight">
							Workflow DevKit Examples
						</h1>
						<p className="text-muted-foreground">
							Select a workflow to start a run and view its output
						</p>
					</div>

					<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
						{/* Left Column - Workflow List */}
						<div className="space-y-3">
							<h2 className="text-lg font-semibold">Available Workflows</h2>
							<div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
								{WORKFLOW_DEFINITIONS.map((workflow) => (
									<WorkflowButton
										key={workflow.name}
										workflow={workflow}
										onStart={startWorkflow}
									/>
								))}
							</div>
						</div>

						{/* Middle Column - Invocations */}
						<div className="h-[calc(100vh-180px)]">
							<InvocationsPanel
								invocations={invocations}
								onDisconnect={disconnectStream}
								onReconnect={reconnectStream}
							/>
						</div>

						{/* Right Column - Terminal Log */}
						<div className="h-[calc(100vh-180px)]">
							<TerminalLog logs={logs} onClear={clearAll} />
						</div>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}
