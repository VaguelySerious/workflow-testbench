"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Loader2,
	CheckCircle2,
	XCircle,
	Unplug,
	RefreshCw,
} from "lucide-react";

export interface Invocation {
	runId: string;
	workflowName: string;
	status:
		| "invoked"
		| "streaming"
		| "disconnected"
		| "stream_complete"
		| "done"
		| "error";
	startTime: Date;
	endTime?: Date;
	result?: unknown;
	error?: string;
}

interface InvocationsPanelProps {
	invocations: Invocation[];
	onDisconnect?: (runId: string) => void;
	onReconnect?: (runId: string) => void;
}

export function InvocationsPanel({
	invocations,
	onDisconnect,
	onReconnect,
}: InvocationsPanelProps) {
	const formatTime = (date: Date) => {
		return date.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	};

	const getStatusIcon = (status: Invocation["status"]) => {
		switch (status) {
			case "invoked":
			case "streaming":
				return <Loader2 className="h-3 w-3 animate-spin" />;
			case "done":
				return <CheckCircle2 className="h-3 w-3" />;
			case "error":
			case "disconnected":
				return <XCircle className="h-3 w-3" />;
			case "stream_complete":
				return <CheckCircle2 className="h-3 w-3" />;
		}
	};

	const getStatusBadge = (
		status: Invocation["status"],
		result?: unknown,
		error?: string,
	) => {
		const variants = {
			invoked: "secondary" as const,
			streaming: "secondary" as const,
			stream_complete: "default" as const,
			done: "default" as const,
			error: "destructive" as const,
			disconnected: "destructive" as const,
		};

		const statusLabel = status.replace("_", " ");

		const badge = (
			<Badge variant={variants[status]} className="flex items-center gap-1">
				{getStatusIcon(status)}
				{statusLabel}
			</Badge>
		);

		if (status === "done" && result !== undefined) {
			return (
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="cursor-help">{badge}</div>
					</TooltipTrigger>
					<TooltipContent side="left" className="max-w-md">
						<pre className="text-xs whitespace-pre-wrap">
							{JSON.stringify(result, null, 2)}
						</pre>
					</TooltipContent>
				</Tooltip>
			);
		}

		if ((status === "error" || status === "disconnected") && error) {
			return (
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="cursor-help">{badge}</div>
					</TooltipTrigger>
					<TooltipContent side="left" className="max-w-md bg-destructive">
						<div className="space-y-1">
							<div className="font-semibold">Error Details:</div>
							<div className="text-xs whitespace-pre-wrap">{error}</div>
						</div>
					</TooltipContent>
				</Tooltip>
			);
		}

		return badge;
	};

	return (
		<Card className="h-full flex flex-col">
			<CardHeader className="pb-3">
				<CardTitle className="text-lg">Workflow Invocations</CardTitle>
			</CardHeader>
			<CardContent className="flex-1 overflow-hidden">
				<div className="h-full overflow-y-auto space-y-2">
					{invocations.length === 0 ? (
						<div className="text-sm text-muted-foreground">
							No workflow runs yet. Click &quot;Start&quot; on any workflow to
							begin.
						</div>
					) : (
						invocations.map((invocation) => {
							const isStreaming = invocation.status === "streaming";
							const isDisconnected = invocation.status === "disconnected";
							const canReconnect =
								isDisconnected ||
								invocation.status === "stream_complete" ||
								invocation.status === "done";

							return (
								<div
									key={invocation.runId}
									className="border rounded-lg p-3 space-y-2 text-sm"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="font-mono text-xs truncate flex-1">
											{invocation.runId}...
										</span>
										<div className="flex items-center gap-1">
											{getStatusBadge(
												invocation.status,
												invocation.result,
												invocation.error,
											)}
											{isStreaming && onDisconnect && (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															size="icon"
															variant="ghost"
															className="h-6 w-6"
															onClick={() => onDisconnect(invocation.runId)}
														>
															<Unplug className="h-3 w-3" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>
														Disconnect from stream
													</TooltipContent>
												</Tooltip>
											)}
											{canReconnect && onReconnect && (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															size="icon"
															variant="ghost"
															className="h-6 w-6"
															onClick={() => onReconnect(invocation.runId)}
														>
															<RefreshCw className="h-3 w-3" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>Reconnect to stream</TooltipContent>
												</Tooltip>
											)}
										</div>
									</div>
									<div className="text-xs space-y-1">
										<div className="font-medium">{invocation.workflowName}</div>
										<div className="text-muted-foreground">
											Started: {formatTime(invocation.startTime)}
										</div>
										{invocation.endTime && (
											<div className="text-muted-foreground">
												Ended: {formatTime(invocation.endTime)}
											</div>
										)}
									</div>
								</div>
							);
						})
					)}
				</div>
			</CardContent>
		</Card>
	);
}
