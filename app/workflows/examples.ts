export function throwError() {
	throw new Error("Error from imported helper module");
}

export function callThrower() {
	throwError();
}

import {
	createHook,
	createWebhook,
	FatalError,
	fetch,
	getStepMetadata,
	getWorkflowMetadata,
	getWritable,
	type RequestWithResponse,
	RetryableError,
	sleep,
} from "workflow";

//////////////////////////////////////////////////////////

async function writeToStream(str: string) {
	"use step";
	const writable = getWritable();
	const writer = writable.getWriter();
	await writer.write(new TextEncoder().encode(str));
	writer.releaseLock();
}

export async function add(a: number, b: number) {
	"use step";
	await writeToStream(`adding ${a} and ${b}\n`);
	return a + b;
}

export async function addTenWorkflow(input: number) {
	"use workflow";
	await writeToStream(`Starting addTenWorkflow with input: ${input}\n`);
	const a = await add(input, 2);
	const b = await add(a, 3);
	const c = await add(b, 5);
	await writeToStream(`Final result: ${c}\n`);
	return c;
}

//////////////////////////////////////////////////////////

export async function topLevelErrorWorkflow() {
	"use workflow";
	await writeToStream("About to throw top-level error\n");
	throw new Error("Top-level workflow error");
}

//////////////////////////////////////////////////////////

// Helper functions to test nested stack traces
function deepFunction() {
	throw new Error("Error from deeply nested function");
}

function middleFunction() {
	deepFunction();
}

function topLevelHelper() {
	middleFunction();
}

export async function nestedErrorWorkflow() {
	"use workflow";
	await writeToStream("Starting nestedErrorWorkflow - will throw error\n");
	topLevelHelper();
	return "never reached";
}

//////////////////////////////////////////////////////////

async function randomDelay(v: string) {
	"use step";
	await new Promise((resolve) => setTimeout(resolve, Math.random() * 3000));
	return v.toUpperCase();
}

export async function promiseAllWorkflow() {
	"use workflow";
	await writeToStream("Starting Promise.all with 3 random delays\n");
	const [a, b, c] = await Promise.all([
		randomDelay("a"),
		randomDelay("b"),
		randomDelay("c"),
	]);
	await writeToStream(`Promise.all completed: ${a + b + c}\n`);
	return a + b + c;
}

//////////////////////////////////////////////////////////

async function specificDelay(delay: number, v: string) {
	"use step";
	await new Promise((resolve) => setTimeout(resolve, delay));
	return v.toUpperCase();
}

export async function promiseRaceWorkflow() {
	"use workflow";
	await writeToStream("Starting Promise.race with 3 delays\n");
	const winner = await Promise.race([
		specificDelay(10000, "a"),
		specificDelay(100, "b"), // "b" should always win
		specificDelay(20000, "c"),
	]);
	await writeToStream(`Winner: ${winner}\n`);
	return winner;
}

//////////////////////////////////////////////////////////

async function stepThatFails() {
	"use step";
	throw new FatalError("step failed");
}

export async function promiseAnyWorkflow() {
	"use workflow";
	await writeToStream("Starting Promise.any - first success wins\n");
	const winner = await Promise.any([
		stepThatFails(),
		specificDelay(1000, "b"), // "b" should always win
		specificDelay(3000, "c"),
	]);
	await writeToStream(`Winner: ${winner}\n`);
	return winner;
}

//////////////////////////////////////////////////////////

// Name should not conflict with genStream in 3_streams.ts
// TODO: swc transform should mangle names to avoid conflicts
async function genReadableStream() {
	"use step";
	await writeToStream("Starting genReadableStream\n");
	return new ReadableStream({
		async start(controller) {
			for (let i = 0; i < 10; i++) {
				controller.enqueue(new TextEncoder().encode(`${i}\n`));
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
			controller.close();
		},
	});
}

export async function readableStreamWorkflow() {
	"use workflow";
	await writeToStream("calling genReadableStream\n");
	const stream = await genReadableStream();
	await writeToStream(`genReadableStream returned ${stream}\n`);
	return stream;
}

//////////////////////////////////////////////////////////

export async function hookWorkflow(token: string, customData: string) {
	"use workflow";

	type Payload = { message: string; customData: string; done?: boolean };

	const hook = createHook<Payload>({
		token,
		metadata: { customData },
	});

	await writeToStream(`Created hook with token: ${token}\n`);

	const payloads: Payload[] = [];
	for await (const payload of hook) {
		await writeToStream(`Received payload: ${JSON.stringify(payload)}\n`);
		payloads.push(payload);

		if (payload.done) {
			break;
		}
	}

	await writeToStream(`Hook completed with ${payloads.length} payloads\n`);
	return payloads;
}

//////////////////////////////////////////////////////////

async function sendWebhookResponse(req: RequestWithResponse) {
	"use step";
	const body = await req.text();
	await req.respondWith(new Response("Hello from webhook!"));
	return body;
}

export async function webhookWorkflow(
	token: string,
	token2: string,
	token3: string,
) {
	"use workflow";

	type Payload = { url: string; method: string; body: string };
	const payloads: Payload[] = [];

	const webhookWithDefaultResponse = createWebhook({ token });
	await writeToStream(`Created webhook 1 with token: ${token}\n`);

	const res = new Response("Hello from static response!", { status: 402 });
	const webhookWithStaticResponse = createWebhook({
		token: token2,
		respondWith: res,
	});
	await writeToStream(`Created webhook 2 with token: ${token2}\n`);

	const webhookWithManualResponse = createWebhook({
		token: token3,
		respondWith: "manual",
	});
	await writeToStream(`Created webhook 3 with token: ${token3}\n`);

	// Webhook with default response
	{
		await writeToStream("Waiting for webhook 1...\n");
		const req = await webhookWithDefaultResponse;
		await writeToStream(`Webhook 1 received: ${req.method} ${req.url}\n`);
		const body = await req.text();
		payloads.push({ url: req.url, method: req.method, body });
	}

	// Webhook with static response
	{
		await writeToStream("Waiting for webhook 2...\n");
		const req = await webhookWithStaticResponse;
		await writeToStream(`Webhook 2 received: ${req.method} ${req.url}\n`);
		const body = await req.text();
		payloads.push({ url: req.url, method: req.method, body });
	}

	// Webhook with manual response
	{
		await writeToStream("Waiting for webhook 3...\n");
		const req = await webhookWithManualResponse;
		await writeToStream(`Webhook 3 received: ${req.method} ${req.url}\n`);
		const body = await sendWebhookResponse(req);
		payloads.push({ url: req.url, method: req.method, body });
	}

	await writeToStream(
		`All webhooks completed with ${payloads.length} responses\n`,
	);
	return payloads;
}

//////////////////////////////////////////////////////////

export async function sleepingWorkflow() {
	"use workflow";
	const startTime = Date.now();
	await writeToStream(
		`Sleeping for 10 seconds starting at ${new Date(startTime).toISOString()}\n`,
	);
	await sleep("10s");
	const endTime = Date.now();
	await writeToStream(`Woke up after ${endTime - startTime}ms\n`);
	return { startTime, endTime };
}

//////////////////////////////////////////////////////////

async function nullByteStep() {
	"use step";
	return "null byte \0";
}

export async function nullByteWorkflow() {
	"use workflow";
	await writeToStream("Testing null byte handling\n");
	const a = await nullByteStep();
	await writeToStream(`Result contains null byte: ${a.includes("\0")}\n`);
	return a;
}

//////////////////////////////////////////////////////////

async function stepWithMetadata() {
	"use step";
	const stepMetadata = getStepMetadata();
	const workflowMetadata = getWorkflowMetadata();
	return { stepMetadata, workflowMetadata };
}

export async function workflowAndStepMetadataWorkflow() {
	"use workflow";
	const workflowMetadata = getWorkflowMetadata();
	await writeToStream(`Workflow run ID: ${workflowMetadata.workflowRunId}\n`);
	await writeToStream(
		`Workflow started at: ${workflowMetadata.workflowStartedAt}\n`,
	);

	const { stepMetadata, workflowMetadata: innerWorkflowMetadata } =
		await stepWithMetadata();

	await writeToStream(`Step metadata collected\n`);
	return {
		workflowMetadata: {
			workflowRunId: workflowMetadata.workflowRunId,
			workflowStartedAt: workflowMetadata.workflowStartedAt,
			url: workflowMetadata.url,
		},
		stepMetadata,
		innerWorkflowMetadata,
	};
}

//////////////////////////////////////////////////////////

async function stepWithOutputStreamBinary(
	writable: WritableStream,
	text: string,
) {
	"use step";
	const writer = writable.getWriter();
	// binary data
	await writer.write(new TextEncoder().encode(text));
	writer.releaseLock();
}

async function stepWithOutputStreamObject(
	writable: WritableStream,
	obj: unknown,
) {
	"use step";
	const writer = writable.getWriter();
	// object data
	await writer.write(obj);
	writer.releaseLock();
}

async function stepCloseOutputStream(writable: WritableStream) {
	"use step";
	await writable.close();
}

export async function outputStreamWorkflow() {
	"use workflow";
	await writeToStream("Testing output streams\n");
	const writable = getWritable();
	const namedWritable = getWritable({ namespace: "test" });
	await sleep("1s");
	await stepWithOutputStreamBinary(writable, "Hello, world!");
	await sleep("1s");
	await stepWithOutputStreamBinary(namedWritable, "Hello, named stream!");
	await sleep("1s");
	await stepWithOutputStreamObject(writable, { foo: "test" });
	await sleep("1s");
	await stepWithOutputStreamObject(namedWritable, { foo: "bar" });
	await sleep("1s");
	await stepCloseOutputStream(writable);
	await stepCloseOutputStream(namedWritable);
	await writeToStream("Output streams closed\n");
	return "done";
}

//////////////////////////////////////////////////////////

async function stepWithOutputStreamInsideStep(text: string) {
	"use step";
	// Call getWritable directly inside the step function
	const writable = getWritable();
	const writer = writable.getWriter();
	await writer.write(new TextEncoder().encode(text));
	writer.releaseLock();
}

async function stepWithNamedOutputStreamInsideStep(
	namespace: string,
	obj: unknown,
) {
	"use step";
	// Call getWritable with namespace directly inside the step function
	const writable = getWritable({ namespace });
	const writer = writable.getWriter();
	await writer.write(obj);
	writer.releaseLock();
}

async function stepCloseOutputStreamInsideStep(namespace?: string) {
	"use step";
	// Call getWritable directly inside the step function and close it
	const writable = getWritable({ namespace });
	await writable.close();
}

export async function outputStreamInsideStepWorkflow() {
	"use workflow";
	await writeToStream("Testing output streams inside steps\n");
	await sleep("1s");
	await stepWithOutputStreamInsideStep("Hello from step!");
	await sleep("1s");
	await stepWithNamedOutputStreamInsideStep("step-ns", {
		message: "Hello from named stream in step!",
	});
	await sleep("1s");
	await stepWithOutputStreamInsideStep("Second message");
	await sleep("1s");
	await stepWithNamedOutputStreamInsideStep("step-ns", { counter: 42 });
	await sleep("1s");
	await stepCloseOutputStreamInsideStep();
	await stepCloseOutputStreamInsideStep("step-ns");
	await writeToStream("Output streams inside steps test complete\n");
	return "done";
}

//////////////////////////////////////////////////////////

export async function fetchWorkflow() {
	"use workflow";
	await writeToStream("Fetching data from JSONPlaceholder API\n");
	const response = await fetch("https://jsonplaceholder.typicode.com/todos/1");
	const data = await response.json();
	await writeToStream(`Received: ${JSON.stringify(data)}\n`);
	return data;
}

//////////////////////////////////////////////////////////

export async function promiseRaceStressTestDelayStep(
	dur: number,
	resp: number,
): Promise<number> {
	"use step";
	await writeToStream(`sleep ${resp} / ${dur}\n`);
	await new Promise((resolve) => setTimeout(resolve, dur));
	await writeToStream(`${resp} done\n`);
	return resp;
}

export async function promiseRaceStressTestWorkflow() {
	"use workflow";
	await writeToStream("Starting Promise.race stress test with 5 promises\n");

	const promises = new Map<number, Promise<number>>();
	const done: number[] = [];
	for (let i = 0; i < 5; i++) {
		const resp = i;
		const dur = 1000 * 5 * i; // 5 seconds apart
		await writeToStream(`sched ${resp} / ${dur}\n`);
		promises.set(i, promiseRaceStressTestDelayStep(dur, resp));
	}

	while (promises.size > 0) {
		await writeToStream(`promises.size ${promises.size}\n`);
		const res = await Promise.race(promises.values());
		await writeToStream(`${res}\n`);
		done.push(res);
		promises.delete(res);
	}

	await writeToStream(
		`Promise.race stress test complete: ${JSON.stringify(done)}\n`,
	);
	return done;
}

//////////////////////////////////////////////////////////

async function stepThatRetriesAndSucceeds() {
	"use step";
	const { attempt } = getStepMetadata();
	await writeToStream(`stepThatRetriesAndSucceeds - attempt: ${attempt}\n`);

	// Fail on attempts 1 and 2, succeed on attempt 3
	if (attempt < 3) {
		await writeToStream(
			`Attempt ${attempt} - throwing error to trigger retry\n`,
		);
		throw new Error(`Failed on attempt ${attempt}`);
	}

	await writeToStream(`Attempt ${attempt} - succeeding\n`);
	return attempt;
}

export async function retryAttemptCounterWorkflow() {
	"use workflow";
	await writeToStream("Starting retry attempt counter workflow\n");

	// This step should fail twice and succeed on the third attempt
	const finalAttempt = await stepThatRetriesAndSucceeds();

	await writeToStream(
		`Workflow completed with final attempt: ${finalAttempt}\n`,
	);
	return { finalAttempt };
}

//////////////////////////////////////////////////////////

async function stepThatThrowsRetryableError() {
	"use step";
	const { attempt, stepStartedAt } = getStepMetadata();
	if (attempt === 1) {
		throw new RetryableError("Retryable error", {
			retryAfter: "10s",
		});
	}
	return {
		attempt,
		stepStartedAt,
		duration: Date.now() - stepStartedAt.getTime(),
	};
}

export async function crossFileErrorWorkflow() {
	"use workflow";
	await writeToStream("Testing cross-file error handling\n");
	// This will throw an error from the imported helpers.ts file
	callThrower();
	return "never reached";
}

//////////////////////////////////////////////////////////

export async function retryableAndFatalErrorWorkflow() {
	"use workflow";
	await writeToStream("Testing retryable and fatal error handling\n");

	await writeToStream("Calling step that throws retryable error\n");
	const retryableResult = await stepThatThrowsRetryableError();
	await writeToStream(
		`Retryable step succeeded on attempt ${retryableResult.attempt}\n`,
	);

	let gotFatalError = false;
	try {
		await writeToStream("Calling step that throws fatal error\n");
		await stepThatFails();
	} catch (error: unknown) {
		if (FatalError.is(error)) {
			gotFatalError = true;
			await writeToStream("Caught fatal error as expected\n");
		}
	}

	return { retryableResult, gotFatalError };
}

//////////////////////////////////////////////////////////

export async function hookCleanupTestWorkflow(
	token: string,
	customData: string,
) {
	"use workflow";

	type Payload = { message: string; customData: string };

	const hook = createHook<Payload>({
		token,
		metadata: { customData },
	});

	await writeToStream(`Created hook with token: ${token}\n`);
	await writeToStream("Waiting for one payload...\n");

	// Wait for exactly one payload
	const payload = await hook;

	await writeToStream(`Received payload: ${JSON.stringify(payload)}\n`);
	await writeToStream("Hook cleanup test completed\n");

	return {
		message: payload.message,
		customData: payload.customData,
		hookCleanupTestData: "workflow_completed",
	};
}

//////////////////////////////////////////////////////////

export async function stepFunctionPassingWorkflow() {
	"use workflow";
	await writeToStream("Testing step function passing\n");
	// Pass a step function reference to another step
	const result = await stepWithStepFunctionArg(doubleNumber);
	await writeToStream(`Result: ${result}\n`);
	return result;
}

async function stepWithStepFunctionArg(stepFn: (x: number) => Promise<number>) {
	"use step";
	// Call the passed step function reference
	const result = await stepFn(10);
	return result * 2;
}

async function doubleNumber(x: number) {
	"use step";
	return x * 2;
}
