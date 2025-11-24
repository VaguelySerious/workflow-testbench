"use client";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WorkflowDefinition } from "@/app/workflows/definitions";
import { Loader2 } from "lucide-react";

interface WorkflowButtonProps {
	workflow: WorkflowDefinition;
	isRunning: boolean;
	onStart: (workflowName: string, args: unknown[]) => void;
}

export function WorkflowButton({
	workflow,
	isRunning,
	onStart,
}: WorkflowButtonProps) {
	return (
		<Card className="hover:shadow-lg transition-shadow">
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="text-lg">{workflow.displayName}</CardTitle>
					{isRunning && (
						<Badge variant="secondary" className="flex items-center gap-1">
							<Loader2 className="h-3 w-3 animate-spin" />
							Running
						</Badge>
					)}
				</div>
				<CardDescription>{workflow.description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{workflow.defaultArgs.length > 0 && (
					<div className="text-xs space-y-1">
						<div className="text-muted-foreground font-medium">
							Default Arguments:
						</div>
						<code className="block bg-muted px-2 py-1 rounded text-xs overflow-x-auto">
							{JSON.stringify(workflow.defaultArgs, null, 2)}
						</code>
					</div>
				)}
				<Button
					onClick={() => onStart(workflow.name, workflow.defaultArgs)}
					disabled={isRunning}
					className="w-full"
				>
					{isRunning ? (
						<>
							<Loader2 className="h-4 w-4 animate-spin" />
							Running...
						</>
					) : (
						"Start Workflow"
					)}
				</Button>
			</CardContent>
		</Card>
	);
}

