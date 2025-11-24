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

export async function add(a: number, b: number) {
	"use step";

	const writable = getWritable();
	const writer = writable.getWriter();
	await writer.write(new TextEncoder().encode(`adding ${a} and ${b}\n`));
	writer.releaseLock();

	return a + b;
}

export async function addTenWorkflow(input: number) {
	"use workflow";
	const a = await add(input, 2);
	const b = await add(a, 3);
	const c = await add(b, 5);
	return c;
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
	const [a, b, c] = await Promise.all([
		randomDelay("a"),
		randomDelay("b"),
		randomDelay("c"),
	]);
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
	const winner = await Promise.race([
		specificDelay(10000, "a"),
		specificDelay(100, "b"), // "b" should always win
		specificDelay(20000, "c"),
	]);
	return winner;
}

//////////////////////////////////////////////////////////

async function stepThatFails() {
	"use step";
	throw new FatalError("step failed");
}

export async function promiseAnyWorkflow() {
	"use workflow";
	const winner = await Promise.any([
		stepThatFails(),
		specificDelay(1000, "b"), // "b" should always win
		specificDelay(3000, "c"),
	]);
	return winner;
}

//////////////////////////////////////////////////////////

// Name should not conflict with genStream in 3_streams.ts
// TODO: swc transform should mangle names to avoid conflicts
async function genReadableStream() {
	"use step";
	const writable = getWritable();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();
	return new ReadableStream({
		async start(controller) {
			for (let i = 0; i < 10; i++) {
				await writer.write(encoder.encode(`enqueueing ${i}\n`));
				controller.enqueue(encoder.encode(`${i}\n`));
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
			await writer.write(encoder.encode("closing controller\n"));
			writer.releaseLock();
			controller.close();
		},
	});
}

export async function readableStreamWorkflow() {
	"use workflow";
	const writable = getWritable();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();

	await writer.write(encoder.encode("calling genReadableStream\n"));
	const stream = await genReadableStream();
	await writer.write(encoder.encode(`genReadableStream returned ${stream}\n`));
	writer.releaseLock();
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

	const payloads: Payload[] = [];
	for await (const payload of hook) {
		payloads.push(payload);

		if (payload.done) {
			break;
		}
	}

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

	const writable = getWritable();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();

	type Payload = { url: string; method: string; body: string };
	const payloads: Payload[] = [];

	const webhookWithDefaultResponse = createWebhook({ token });

	const res = new Response("Hello from static response!", { status: 402 });
	await writer.write(encoder.encode(`Created response: ${res}\n`));
	const webhookWithStaticResponse = createWebhook({
		token: token2,
		respondWith: res,
	});
	const webhookWithManualResponse = createWebhook({
		token: token3,
		respondWith: "manual",
	});

	// Webhook with default response
	{
		const req = await webhookWithDefaultResponse;
		const body = await req.text();
		payloads.push({ url: req.url, method: req.method, body });
	}

	// Webhook with static response
	{
		const req = await webhookWithStaticResponse;
		const body = await req.text();
		payloads.push({ url: req.url, method: req.method, body });
	}

	// Webhook with manual response
	{
		const req = await webhookWithManualResponse;
		const body = await sendWebhookResponse(req);
		payloads.push({ url: req.url, method: req.method, body });
	}

	writer.releaseLock();
	return payloads;
}

//////////////////////////////////////////////////////////

export async function sleepingWorkflow() {
	"use workflow";
	const startTime = Date.now();
	await sleep("10s");
	const endTime = Date.now();
	return { startTime, endTime };
}

//////////////////////////////////////////////////////////

async function nullByteStep() {
	"use step";
	return "null byte \0";
}

export async function nullByteWorkflow() {
	"use workflow";
	const a = await nullByteStep();
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
	const { stepMetadata, workflowMetadata: innerWorkflowMetadata } =
		await stepWithMetadata();
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
	return "done";
}

//////////////////////////////////////////////////////////

export async function fetchWorkflow() {
	"use workflow";
	const response = await fetch("https://jsonplaceholder.typicode.com/todos/1");
	const data = await response.json();
	return data;
}

//////////////////////////////////////////////////////////

export async function promiseRaceStressTestDelayStep(
	dur: number,
	resp: number,
): Promise<number> {
	"use step";

	const writable = getWritable();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();

	await writer.write(encoder.encode(`sleep ${resp} / ${dur}\n`));
	await new Promise((resolve) => setTimeout(resolve, dur));

	await writer.write(encoder.encode(`${resp} done\n`));
	writer.releaseLock();
	return resp;
}

export async function promiseRaceStressTestWorkflow() {
	"use workflow";

	const writable = getWritable();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();

	const promises = new Map<number, Promise<number>>();
	const done: number[] = [];
	for (let i = 0; i < 5; i++) {
		const resp = i;
		const dur = 1000 * 5 * i; // 5 seconds apart
		await writer.write(encoder.encode(`sched ${resp} / ${dur}\n`));
		promises.set(i, promiseRaceStressTestDelayStep(dur, resp));
	}

	while (promises.size > 0) {
		await writer.write(encoder.encode(`promises.size ${promises.size}\n`));
		const res = await Promise.race(promises.values());
		await writer.write(encoder.encode(`${res}\n`));
		done.push(res);
		promises.delete(res);
	}

	writer.releaseLock();
	return done;
}

//////////////////////////////////////////////////////////

async function stepThatRetriesAndSucceeds() {
	"use step";
	const { attempt } = getStepMetadata();
	const writable = getWritable();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();

	await writer.write(
		encoder.encode(`stepThatRetriesAndSucceeds - attempt: ${attempt}\n`),
	);

	// Fail on attempts 1 and 2, succeed on attempt 3
	if (attempt < 3) {
		await writer.write(
			encoder.encode(`Attempt ${attempt} - throwing error to trigger retry\n`),
		);
		writer.releaseLock();
		throw new Error(`Failed on attempt ${attempt}`);
	}

	await writer.write(encoder.encode(`Attempt ${attempt} - succeeding\n`));
	writer.releaseLock();
	return attempt;
}

export async function retryAttemptCounterWorkflow() {
	"use workflow";
	const writable = getWritable();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();

	await writer.write(
		encoder.encode("Starting retry attempt counter workflow\n"),
	);

	// This step should fail twice and succeed on the third attempt
	const finalAttempt = await stepThatRetriesAndSucceeds();

	await writer.write(
		encoder.encode(`Workflow completed with final attempt: ${finalAttempt}\n`),
	);
	writer.releaseLock();
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
	// This will throw an error from the imported helpers.ts file
	callThrower();
	return "never reached";
}

//////////////////////////////////////////////////////////

export async function retryableAndFatalErrorWorkflow() {
	"use workflow";

	const retryableResult = await stepThatThrowsRetryableError();

	let gotFatalError = false;
	try {
		await stepThatFails();
	} catch (error: unknown) {
		if (FatalError.is(error)) {
			gotFatalError = true;
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

	// Wait for exactly one payload
	const payload = await hook;

	return {
		message: payload.message,
		customData: payload.customData,
		hookCleanupTestData: "workflow_completed",
	};
}

//////////////////////////////////////////////////////////

export async function stepFunctionPassingWorkflow() {
	"use workflow";
	// Pass a step function reference to another step
	const result = await stepWithStepFunctionArg(doubleNumber);
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
