import { NextRequest, NextResponse } from "next/server";
import { start, getWorkflowRun } from "workflow/api";
import * as workflows from "@/app/workflows/examples";
import { WORKFLOW_DEFINITIONS, type WorkflowName } from "@/app/workflows/definitions";

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { workflowName, args } = body as {
			workflowName: WorkflowName;
			args?: unknown[];
		};

		// Find workflow definition
		const definition = WORKFLOW_DEFINITIONS.find((w) => w.name === workflowName);
		if (!definition) {
			return NextResponse.json(
				{ error: `Workflow "${workflowName}" not found` },
				{ status: 404 }
			);
		}

		// Get the workflow function
		const workflowFn = workflows[workflowName as keyof typeof workflows];
		if (typeof workflowFn !== "function") {
			return NextResponse.json(
				{ error: `Workflow "${workflowName}" is not a function` },
				{ status: 400 }
			);
		}

		// Use provided args or default args
		const workflowArgs = args !== undefined ? args : definition.defaultArgs;

		// Start the workflow
		const runId = await start(workflowFn, workflowArgs);
		const runIdString = typeof runId === 'string' ? runId : (runId as any)?.id || String(runId);

		// Get the workflow run to access streaming
		const run = await getWorkflowRun(runIdString);
		
		if (!run) {
			return NextResponse.json(
				{ error: "Failed to get workflow run" },
				{ status: 500 }
			);
		}

		// Get the stream
		const stream = run.stream();

		// Create a response with the stream
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"Connection": "keep-alive",
				"X-Workflow-Run-Id": runIdString,
			},
		});
	} catch (error) {
		console.error("Error starting workflow:", error);
		return NextResponse.json(
			{
				error: "Failed to start workflow",
				details: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 }
		);
	}
}

