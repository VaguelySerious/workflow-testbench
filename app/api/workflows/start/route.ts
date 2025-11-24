import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import * as workflows from "@/app/workflows/examples";
import {
	WORKFLOW_DEFINITIONS,
	type WorkflowName,
} from "@/app/workflows/definitions";

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { workflowName, args } = body as {
			workflowName: WorkflowName;
			args?: unknown[];
		};

		// Find workflow definition
		const definition = WORKFLOW_DEFINITIONS.find(
			(w) => w.name === workflowName,
		);
		if (!definition) {
			return NextResponse.json(
				{ error: `Workflow "${workflowName}" not found` },
				{ status: 404 },
			);
		}

		// Get the workflow function
		const workflowFn = workflows[
			workflowName as keyof typeof workflows
		] as () => Promise<unknown>;
		if (typeof workflowFn !== "function") {
			return NextResponse.json(
				{ error: `Workflow "${workflowName}" is not a function` },
				{ status: 400 },
			);
		}

		// Use provided args or default args
		const workflowArgs = args !== undefined ? args : definition.defaultArgs;

		// Start the workflow
		// @ts-expect-error - we're doing arbitrary calls to unknown functions
		const run = await start(workflowFn, workflowArgs);

		console.log("Start returned:", typeof run, run);

		if (!run) {
			return NextResponse.json(
				{ error: "Failed to get workflow run" },
				{ status: 500 },
			);
		}

		// Extract run ID from the Run object
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const runObj = run as any;
		const runId =
			typeof run === "string"
				? run
				: runObj?.runId || runObj?.id || String(run);
		console.log("Extracted runId:", runId);

		// Try to get the stream using the stream() method if it exists
		let stream: ReadableStream | null = null;
		if (typeof runObj.stream === "function") {
			try {
				stream = runObj.stream();
				console.log("Got stream from run.stream()");
			} catch (error) {
				console.error("Error calling run.stream():", error);
			}
		}

		// If there's a readable stream, return it with the run ID
		if (stream) {
			console.log("Returning stream response with runId:", runId);
			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"X-Workflow-Run-Id": runId,
				},
			});
		}

		// Otherwise, just return the run ID
		console.log("No stream available, returning JSON with runId:", runId);
		return NextResponse.json({
			runId,
			status: "started",
		});
	} catch (error) {
		console.error("Error starting workflow:", error);
		return NextResponse.json(
			{
				error: "Failed to start workflow",
				details: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 },
		);
	}
}
