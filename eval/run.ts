import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUBMIT_REVIEW_TOOL } from "../src/judge";
import { getJudgePrompt } from "../src/prompts/judge";
import { loadEnv } from "../src/setup";

// --- Types ---

interface EvalCase {
	name: string;
	expectedVerdict: "looks-good" | "pushback" | "hard-no";
	why: string;
	task: string;
	plan: string;
}

interface EvalResult {
	name: string;
	expected: string;
	actual: string;
	pass: boolean;
	explanation: string;
}

// --- Runner ---

async function runEval() {
	await loadEnv();
	const casesPath = resolve(import.meta.dirname!, "cases.json");
	const cases: EvalCase[] = JSON.parse(readFileSync(casesPath, "utf-8"));

	const model = process.argv[2] || "claude-sonnet-4-6";
	console.log(`\nRunning judge eval: ${cases.length} cases on ${model}\n`);

	const client = new Anthropic();
	const judgePrompt = getJudgePrompt();
	const results: EvalResult[] = [];
	let passed = 0;
	let failed = 0;

	for (const c of cases) {
		process.stdout.write(`  ${c.name} ... `);

		const toolDef = {
			name: SUBMIT_REVIEW_TOOL.name,
			description: SUBMIT_REVIEW_TOOL.description,
			input_schema: SUBMIT_REVIEW_TOOL.input_schema,
		};

		let message = await client.messages.create({
			model,
			max_tokens: 4096,
			system: judgePrompt,
			tools: [toolDef],
			messages: [
				{
					role: "user",
					content: `# Original Task\n${c.task}\n\n# Proposed Plan\n${c.plan}`,
				},
			],
		});

		// If the judge wrote text without calling the tool, nudge it
		if (
			message.stop_reason === "end_turn" &&
			!message.content.some((b) => b.type === "tool_use")
		) {
			message = await client.messages.create({
				model,
				max_tokens: 1024,
				system: judgePrompt,
				tools: [toolDef],
				messages: [
					{
						role: "user",
						content: `# Original Task\n${c.task}\n\n# Proposed Plan\n${c.plan}`,
					},
					{ role: "assistant", content: message.content },
					{
						role: "user",
						content:
							"Now submit your verdict using the submit_review tool.",
					},
				],
			});
		}

		// Extract verdict from tool call
		const toolUse = message.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
		);

		const input = toolUse?.input as Record<string, unknown> | undefined;
		const actual = (input?.verdict as string) ?? "unknown";
		const explanation =
			(input?.explanation as string) ?? "(no explanation)";
		const pass = actual === c.expectedVerdict;

		if (pass) {
			passed++;
			console.log(`\x1b[32m✓ ${actual}\x1b[0m`);
		} else {
			failed++;
			console.log(
				`\x1b[31m✗ got ${actual}, expected ${c.expectedVerdict}\x1b[0m`,
			);
			console.log(`    ${explanation}`);
		}

		results.push({
			name: c.name,
			expected: c.expectedVerdict,
			actual,
			pass,
			explanation,
		});
	}

	// --- Scorecard ---

	console.log("\n─────────────────────────────────────────");
	console.log(
		`  Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m out of ${cases.length}`,
	);
	console.log(`  Accuracy: ${((passed / cases.length) * 100).toFixed(1)}%`);

	// Breakdown by verdict type
	const byExpected = new Map<string, { total: number; correct: number }>();
	for (const r of results) {
		const entry = byExpected.get(r.expected) ?? { total: 0, correct: 0 };
		entry.total++;
		if (r.pass) entry.correct++;
		byExpected.set(r.expected, entry);
	}

	console.log("\n  By verdict:");
	for (const [verdict, { total, correct }] of byExpected) {
		const pct = ((correct / total) * 100).toFixed(0);
		console.log(`    ${verdict}: ${correct}/${total} (${pct}%)`);
	}

	// Show failures
	const failures = results.filter((r) => !r.pass);
	if (failures.length > 0) {
		console.log("\n  Failures:");
		for (const f of failures) {
			console.log(
				`    ${f.name}: expected ${f.expected}, got ${f.actual}`,
			);
			console.log(`      ${f.explanation}`);
		}
	}

	console.log();

	// Exit with error if accuracy is below threshold
	const accuracy = passed / cases.length;
	if (accuracy < 0.8) {
		console.log(
			`\x1b[31m  FAIL: accuracy ${(accuracy * 100).toFixed(1)}% is below 80% threshold\x1b[0m\n`,
		);
		process.exit(1);
	}
}

runEval().catch((err) => {
	console.error(err);
	process.exit(1);
});
