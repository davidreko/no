import { describe, expect, it } from "vitest";
import { classifyComplexity } from "../judge";

describe("classifyComplexity", () => {
	describe("trivial / conversational", () => {
		it.each([
			"hi",
			"hello",
			"thanks",
			"what is this?",
			"hey there",
		])('classifies "%s" as simple (no judge)', (task) => {
			expect(classifyComplexity(task)).toBe("simple");
		});
	});

	describe("simple tasks", () => {
		it.each([
			"fix the typo in README",
			"fix a typo in main.ts",
			"rename the variable",
			"add a comment to the function",
			"change foo to bar",
			"remove the unused import",
			"remove dead code",
			"update the import path",
			"delete the line",
		])('classifies "%s" as simple', (task) => {
			expect(classifyComplexity(task)).toBe("simple");
		});

		it("does not classify long tasks as simple even with simple keywords", () => {
			const longTask =
				"fix the typo in README and also update the docs and change the formatting and add some comments and clean up the code";
			expect(classifyComplexity(longTask)).not.toBe("simple");
		});
	});

	describe("complex tasks", () => {
		it.each([
			"refactor the authentication module",
			"redesign the database schema",
			"implement user authentication with OAuth",
			"build a caching layer for the API",
			"architect the new microservice",
			"migrate the database to PostgreSQL",
			"rewrite the parser from scratch",
			"create a new logging system",
			"add a caching layer to the API",
			"fix the authentication bypass vulnerability",
			"add rate limiting to the API",
			"fix the security issue in session handling",
			"implement permission checks",
			"add encryption for user data",
			"fix concurrency bug in worker pool",
			"integrate with the payment API",
		])('classifies "%s" as complex', (task) => {
			expect(classifyComplexity(task)).toBe("complex");
		});

		it("classifies very long tasks as complex regardless of keywords", () => {
			const words = Array(55).fill("word").join(" ");
			expect(classifyComplexity(words)).toBe("complex");
		});
	});

	describe("moderate tasks", () => {
		it.each([
			"add error handling to the login endpoint",
			"update the test for the user service",
			"move the config to a separate file",
			"fix the bug where users can't log in",
		])('classifies "%s" as moderate', (task) => {
			expect(classifyComplexity(task)).toBe("moderate");
		});
	});
});
