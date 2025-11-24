import { start } from "workflow/api";
import { handleUserSignup } from "@/workflows/user-signup";
import { NextResponse } from "next/server";

async function test() {
'use step';
console.log("I'm a test");
return {'user': 'Franz'};
}

export async function POST(request: Request) {
	const { email } = await request.json();
const user = await test();
console.log(user);
        return NextResponse.json(user)

	// Executes asynchronously and doesn't block your app
	//await start(handleUserSignup, [email]);

	//return NextResponse.json({
		//message: "User signup workflow started",
	//});
}
