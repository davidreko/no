import { describe, expect, it } from "vitest";
import { parseJudgeResponse, parseSubmitReview } from "../judge";

describe("parseJudgeResponse", () => {
	it("parses a looks-good response", () => {
		const raw = `VERDICT: looks-good

EXPLANATION:
Straightforward rename with no side effects.

CONCERNS:
- none

SIMPLER ALTERNATIVE:
none

QUESTIONS:
- none`;

		const review = parseJudgeResponse(raw);
		expect(review.verdict).toBe("looks-good");
		expect(review.explanation).toContain("Straightforward");
		expect(review.concerns).toEqual([]);
		expect(review.simplerAlternative).toBeNull();
		expect(review.questions).toEqual([]);
	});

	it("parses a pushback response with concerns", () => {
		const raw = `VERDICT: pushback

EXPLANATION:
The plan introduces unnecessary complexity for a simple caching need.

CONCERNS:
- You don't need Redis here, a Map works fine
- The cache middleware is overkill for this use case

SIMPLER ALTERNATIVE:
Add a cache Map<string, {data, expiry}> at module scope in client.ts. Check before fetch, store after. ~15 lines.

QUESTIONS:
- Do you actually need distributed caching?
- What's the expected cache hit rate?`;

		const review = parseJudgeResponse(raw);
		expect(review.verdict).toBe("pushback");
		expect(review.explanation).toContain("unnecessary complexity");
		expect(review.concerns).toHaveLength(2);
		expect(review.concerns[0]).toContain("Redis");
		expect(review.simplerAlternative).toContain("Map<string");
		expect(review.questions).toHaveLength(2);
	});

	it("parses a hard-no response", () => {
		const raw = `VERDICT: hard-no

EXPLANATION:
This will break backwards compatibility with no migration path.

CONCERNS:
- This will break the existing API contract
- No migration path for existing users

SIMPLER ALTERNATIVE:
Don't do this. The current approach works fine.

QUESTIONS:
- none`;

		const review = parseJudgeResponse(raw);
		expect(review.verdict).toBe("hard-no");
		expect(review.explanation).toContain("backwards compatibility");
		expect(review.concerns).toHaveLength(2);
		expect(review.simplerAlternative).toContain("Don't do this");
		expect(review.questions).toEqual([]);
	});

	it("handles missing explanation gracefully", () => {
		const raw = `VERDICT: looks-good

CONCERNS:
- none

SIMPLER ALTERNATIVE:
none

QUESTIONS:
- none`;

		const review = parseJudgeResponse(raw);
		expect(review.verdict).toBe("looks-good");
		expect(review.explanation).toBeNull();
	});

	it("defaults to pushback if verdict is missing", () => {
		const raw = "Some random text with no verdict format";
		const review = parseJudgeResponse(raw);
		expect(review.verdict).toBe("pushback");
	});

	it("handles case-insensitive verdict", () => {
		const raw = `VERDICT: LOOKS-GOOD

CONCERNS:
- none`;

		const review = parseJudgeResponse(raw);
		expect(review.verdict).toBe("looks-good");
	});
});

describe("parseSubmitReview", () => {
	it("parses a structured tool call response", () => {
		const review = parseSubmitReview({
			verdict: "looks-good",
			explanation: "Clean approach, minimal changes.",
			concerns: [],
			simpler_alternative: null,
			questions: [],
		});

		expect(review.verdict).toBe("looks-good");
		expect(review.explanation).toBe("Clean approach, minimal changes.");
		expect(review.concerns).toEqual([]);
		expect(review.simplerAlternative).toBeNull();
		expect(review.questions).toEqual([]);
	});

	it("parses pushback with concerns and alternative", () => {
		const review = parseSubmitReview({
			verdict: "pushback",
			explanation: "Too much abstraction for a simple need.",
			concerns: ["Redis is overkill here", "Cache middleware adds complexity"],
			simpler_alternative: "Use a Map<string, {data, expiry}> at module scope.",
			questions: ["Do you need distributed caching?"],
		});

		expect(review.verdict).toBe("pushback");
		expect(review.concerns).toHaveLength(2);
		expect(review.simplerAlternative).toContain("Map");
		expect(review.questions).toHaveLength(1);
	});

	it("defaults to pushback if verdict is missing", () => {
		const review = parseSubmitReview({
			explanation: "Something went wrong.",
			concerns: [],
			questions: [],
		});

		expect(review.verdict).toBe("pushback");
	});

	it("filters empty strings from arrays", () => {
		const review = parseSubmitReview({
			verdict: "looks-good",
			explanation: "Fine.",
			concerns: ["real concern", ""],
			questions: ["", "real question"],
		});

		expect(review.concerns).toEqual(["real concern"]);
		expect(review.questions).toEqual(["real question"]);
	});
});
