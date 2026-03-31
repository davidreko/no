import { describe, expect, it } from "vitest";
import { addUsage, emptyUsage, estimateCost } from "../types";

describe("token usage", () => {
	describe("emptyUsage", () => {
		it("returns all zeros", () => {
			const usage = emptyUsage();
			expect(usage.inputTokens).toBe(0);
			expect(usage.outputTokens).toBe(0);
			expect(usage.cacheReadTokens).toBe(0);
			expect(usage.cacheCreationTokens).toBe(0);
		});
	});

	describe("addUsage", () => {
		it("sums two usage objects", () => {
			const a = {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 10,
				cacheCreationTokens: 5,
			};
			const b = {
				inputTokens: 200,
				outputTokens: 100,
				cacheReadTokens: 20,
				cacheCreationTokens: 10,
			};
			const result = addUsage(a, b);
			expect(result).toEqual({
				inputTokens: 300,
				outputTokens: 150,
				cacheReadTokens: 30,
				cacheCreationTokens: 15,
			});
		});

		it("works with empty usage", () => {
			const a = {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			};
			const result = addUsage(a, emptyUsage());
			expect(result).toEqual(a);
		});
	});

	describe("estimateCost", () => {
		it("calculates cost for sonnet", () => {
			const usage = {
				inputTokens: 1_000_000,
				outputTokens: 100_000,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			};
			const cost = estimateCost(usage, "claude-sonnet-4-6");
			// 1M * $3/M + 100K * $15/M = $3 + $1.50 = $4.50
			expect(cost).toBeCloseTo(4.5);
		});

		it("calculates cost with cache tokens", () => {
			const usage = {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			};
			const cost = estimateCost(usage, "claude-sonnet-4-6");
			// cache read: 1M * $3/M * 0.1 = $0.30
			// cache create: 1M * $3/M * 1.25 = $3.75
			expect(cost).toBeCloseTo(4.05);
		});

		it("falls back to sonnet pricing for unknown models", () => {
			const usage = {
				inputTokens: 1_000_000,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			};
			const cost = estimateCost(usage, "some-unknown-model");
			expect(cost).toBeCloseTo(3.0);
		});
	});
});
